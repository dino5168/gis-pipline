<#
start-martin.ps1 / build-mbtiles.ps1 共用：找 Martin 工具、從 pgpass.conf（或 PGPASSWORD）組連線字串。
密碼只放進環境變數 MARTIN_PG_URL，不寫入任何檔案；用完呼叫 Clear-MartinPgUrl。
#>

# 找 Martin 附帶的執行檔（martin.exe / martin-cp.exe / mbtiles.exe）：
# 環境變數 MARTIN_EXE 所在資料夾 → tiles\tools\martin\ → 9-Result\tools\martin\ → PATH
function Find-MartinTool([string]$Name) {
    $dirs = @(
        $(if ($env:MARTIN_EXE) { Split-Path $env:MARTIN_EXE }),
        (Join-Path $PSScriptRoot 'tools\martin'),
        (Join-Path $PSScriptRoot '..\..\9-Result\tools\martin')
    )
    foreach ($d in $dirs) {
        if ($d -and (Test-Path (Join-Path $d $Name))) { return (Resolve-Path (Join-Path $d $Name)).Path }
    }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "找不到 $Name，請設定環境變數 MARTIN_EXE（martin.exe 的完整路徑，其他工具放同一資料夾）。"
}

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

function Set-MartinPgUrl {
    param(
        [string]$Database = 'gis',
        [string]$User = 'postgres',
        [string]$DbHost = 'localhost',
        [int]$Port = 5432
    )
    $pgpass = if ($env:PGPASSFILE) { $env:PGPASSFILE } else { Join-Path $env:APPDATA 'postgresql\pgpass.conf' }
    $password = $env:PGPASSWORD
    if (-not $password -and (Test-Path $pgpass)) {
        $want = @($DbHost, "$Port", $Database, $User)
        foreach ($line in Get-Content -LiteralPath $pgpass -Encoding utf8) {
            if (-not $line -or $line.StartsWith('#')) { continue }
            $f = Split-PgPassLine $line
            if ($f.Count -lt 5) { continue }
            $ok = $true
            for ($k = 0; $k -lt 4; $k++) { if ($f[$k] -ne '*' -and $f[$k] -ne $want[$k]) { $ok = $false; break } }
            if ($ok) { $password = $f[4]; break }
        }
    }
    if (-not $password) {
        throw "在 $pgpass 找不到 ${DbHost}:${Port}:${Database}:${User} 的密碼，也沒有設定 PGPASSWORD。"
    }
    $u = [uri]::EscapeDataString($User)
    $p = [uri]::EscapeDataString($password)
    $d = [uri]::EscapeDataString($Database)
    $env:MARTIN_PG_URL = "postgresql://${u}:${p}@${DbHost}:${Port}/${d}"
}

function Clear-MartinPgUrl { Remove-Item Env:MARTIN_PG_URL -ErrorAction SilentlyContinue }
