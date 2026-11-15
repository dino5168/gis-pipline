<#
啟動 Martin 向量圖磚服務（設定檔：martin.yaml）。

密碼從 pgpass.conf（或環境變數 PGPASSWORD）讀取，組成連線字串放進
環境變數 MARTIN_PG_URL 交給 Martin，不會寫入任何檔案。

用法：
    .\start-martin.ps1 [-Database gis] [-User postgres] [-DbHost localhost] [-Port 5432] [其他 martin 參數]
例：
    .\start-martin.ps1
    .\start-martin.ps1 --tui        # 以終端機儀表板顯示狀態
#>
param(
    [string]$Database = 'gis',
    [string]$User = 'postgres',
    [string]$DbHost = 'localhost',
    [int]$Port = 5432
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
# martin.exe 位置：環境變數 MARTIN_EXE → 本資料夾 tools\ → 9-Result\tools\ → PATH
$martin = @(
    $env:MARTIN_EXE,
    (Join-Path $root 'tools\martin\martin.exe'),
    (Join-Path $root '..\..\9-Result\tools\martin\martin.exe')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $martin) { $martin = (Get-Command martin -ErrorAction SilentlyContinue).Source }
if (-not $martin) { throw '找不到 martin.exe，請設定環境變數 MARTIN_EXE。' }
$pgpass = if ($env:PGPASSFILE) { $env:PGPASSFILE } else { Join-Path $env:APPDATA 'postgresql\pgpass.conf' }

function Split-PgPassLine([string]$line) {
    # 以未跳脫的冒號分成 5 欄，並還原 \: 與 \\
    $fields = [Collections.Generic.List[string]]::new()
    $sb = [Text.StringBuilder]::new()
    for ($i = 0; $i -lt $line.Length; $i++) {
        $c = $line[$i]
        if ($c -eq '\' -and $i + 1 -lt $line.Length) { [void]$sb.Append($line[++$i]) }
        elseif ($c -eq ':' -and $fields.Count -lt 4) { $fields.Add($sb.ToString()); [void]$sb.Clear() }
        else { [void]$sb.Append($c) }
    }
    $fields.Add($sb.ToString())
    return , $fields
}

function Find-PgPassword {
    if ($env:PGPASSWORD) { return $env:PGPASSWORD }
    if (-not (Test-Path $pgpass)) { return $null }
    $want = @($DbHost, "$Port", $Database, $User)
    foreach ($line in Get-Content -LiteralPath $pgpass -Encoding utf8) {
        if (-not $line -or $line.StartsWith('#')) { continue }
        $f = Split-PgPassLine $line
        if ($f.Count -lt 5) { continue }
        $ok = $true
        for ($k = 0; $k -lt 4; $k++) { if ($f[$k] -ne '*' -and $f[$k] -ne $want[$k]) { $ok = $false; break } }
        if ($ok) { return $f[4] }
    }
    return $null
}

$password = Find-PgPassword
if (-not $password) {
    throw "在 $pgpass 找不到 ${DbHost}:${Port}:${Database}:${User} 的密碼，也沒有設定 PGPASSWORD。"
}
$u = [uri]::EscapeDataString($User)
$p = [uri]::EscapeDataString($password)
$d = [uri]::EscapeDataString($Database)
$env:MARTIN_PG_URL = "postgresql://${u}:${p}@${DbHost}:${Port}/${d}"

Write-Host "Martin 啟動中：http://127.0.0.1:3000/catalog （Ctrl+C 停止）"
try {
    & $martin --config (Join-Path $root 'martin.yaml') @args
}
finally {
    Remove-Item Env:MARTIN_PG_URL -ErrorAction SilentlyContinue
}
