<#
把 martin.yaml 的 PostGIS 圖磚預先產生成 MBTiles（tiles\mbtiles\<資料表>.mbtiles），給 start-martin.ps1 預設模式使用。

- 每張表從 martin.yaml 的 minzoom 產生到 -MaxZoom（預設 18）；z19 以上由前端放大 z18 圖磚。
- 小比例尺精簡：minzoom～-LiteMaxZoom（預設 13）的圖磚只帶 gid 與 $LiteProperties（畫圖用的材料、管徑），
  避免全市畫面一張圖磚 1～2MB；點選時前端再向 /api/pipes/{gid} 取完整屬性。-LiteMaxZoom 0 表示不精簡。
  精簡版的 Martin 設定由本腳本依 martin.yaml 自動產生（來源 <表>__lite、layer_id 同表名），不必手寫。
- 範圍：-Bbox（經緯度 西,南,東,北），預設台北市全境；一定要給，不給 martin-cp 會產生全世界。空白圖磚不存。
- 先產生到 tiles\mbtiles-build\，全部成功才搬進 tiles\mbtiles\。
  Martin（MBTiles 模式）執行中會鎖住檔案，搬移失敗時請先停止 Martin 再執行一次。
- 資料庫密碼從 pgpass.conf（或 PGPASSWORD）讀取，不寫入檔案。
- 2D 產完後接著產生 3D 管線格網（tiles\pipes3d\<資料表>.sqlite，API /api/pipes3d/16/{x}/{y} 讀取；
  api\app\pipes3d_tiles.py）。-No3D 只產 2D、-Only3D 只產 3D。3D 換檔不必重啟 API。

用法：
    .\build-mbtiles.ps1                       # 全部資料表
    .\build-mbtiles.ps1 -Source utl_pipe      # 只產生指定的（可多個，以逗號分隔）
    .\build-mbtiles.ps1 -MaxZoom 17 -LiteMaxZoom 0
#>
param(
    [string[]]$Source,
    [int]$MaxZoom = 18,
    [int]$LiteMaxZoom = 13,
    [string]$Bbox = '121.45,24.95,121.68,25.22',
    [int]$Concurrency = 8,
    [switch]$No3D,
    [switch]$Only3D,
    [string]$Database = 'gis',
    [string]$User = 'postgres',
    [string]$DbHost = 'localhost',
    [int]$Port = 5432
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
. (Join-Path $root 'pg-env.ps1')
$martinCp = Find-MartinTool 'martin-cp.exe'
$mbtilesExe = Find-MartinTool 'mbtiles.exe'
$config = Join-Path $root 'martin.yaml'

# 精簡圖磚保留的欄位（前端 pipeStyle.ts 畫圖／篩選用到的；改了前端用到的欄位要同步）
$LiteProperties = [ordered]@{ material = 'text'; dia_width = 'float8' }

# ---- 讀 martin.yaml 的 postgres.tables：每張表的設定行與 minzoom
$tables = [ordered]@{}   # 名稱 → @{ Lines = 設定行（不含 properties）; Props = 欄位; MinZoom }
$inTables = $false; $cur = $null; $inProps = $false
foreach ($line in Get-Content -LiteralPath $config -Encoding utf8) {
    if ($line -match '^  tables:\s*$') { $inTables = $true; continue }
    if (-not $inTables) { continue }
    if ($line -match '^\S') { break }
    if ($line -match '^    ([A-Za-z0-9_]+):\s*$') {
        $cur = @{ Lines = [Collections.Generic.List[string]]::new(); Props = [ordered]@{}; MinZoom = 0 }
        $tables[$Matches[1]] = $cur; $inProps = $false; continue
    }
    if (-not $cur -or $line -match '^\s*(#.*)?$') { continue }
    if ($line -match '^      properties:\s*$') { $inProps = $true; continue }
    if ($inProps -and $line -match '^        ([A-Za-z0-9_]+):\s*(\S+)') { $cur.Props[$Matches[1]] = $Matches[2]; continue }
    $inProps = $false
    if ($line -match '^      (minzoom|maxzoom):') {
        if ($line -match '^      minzoom:\s*(\d+)') { $cur.MinZoom = [int]$Matches[1] }
        continue   # 縮放範圍由 martin-cp 參數決定
    }
    $cur.Lines.Add(($line -replace '\s+#.*$', ''))
}
if (-not $tables.Count) { throw "在 $config 找不到 postgres.tables。" }

if ($Source) {
    $Source = $Source | ForEach-Object { $_ -split ',' } | Where-Object { $_ }
    $unknown = $Source | Where-Object { -not $tables.Contains($_) }
    if ($unknown) { throw "martin.yaml 沒有這些來源：$($unknown -join ', ')。可用：$($tables.Keys -join ', ')" }
    $todo = $Source
}
else { $todo = @($tables.Keys) }

if ($No3D -and $Only3D) { throw '-No3D 與 -Only3D 不能同時使用。' }

function Invoke-Pipes3DBuild {
    Write-Host "產生 3D 管線格網：$($todo -join ', ') …"
    Push-Location (Join-Path $root '..\api')
    try {
        $env:PYTHONIOENCODING = 'utf-8'
        uv run python -m app.pipes3d_tiles @todo
        if ($LASTEXITCODE -ne 0) { throw "3D 格網產生失敗（結束代碼 $LASTEXITCODE）。" }
    }
    finally { Pop-Location }
}
if ($Only3D) { Invoke-Pipes3DBuild; return }

$build = Join-Path $root 'mbtiles-build'
$out = Join-Path $root 'mbtiles'
New-Item -ItemType Directory -Force $build, $out | Out-Null

# ---- 產生精簡版設定（來源 <表>__lite，MVT 圖層名稱 layer_id 仍是表名，前端不用分辨）
$liteConfig = Join-Path $build 'martin-lite.yaml'
$y = [Collections.Generic.List[string]]::new()
$y.Add('# build-mbtiles.ps1 自動產生，勿手改'); $y.Add('postgres:')
$y.Add('  connection_string: ${MARTIN_PG_URL}'); $y.Add('  auto_publish: false'); $y.Add('  tables:')
foreach ($s in $todo) {
    $t = $tables[$s]
    $missing = $LiteProperties.Keys | Where-Object { -not $t.Props.Contains($_) }
    if ($missing) { throw "$s 的 properties 沒有精簡圖磚需要的欄位：$($missing -join ', ')" }
    $y.Add("    ${s}__lite:")
    $y.Add("      layer_id: $s")
    foreach ($l in $t.Lines) { $y.Add($l) }
    $y.Add('      properties:')
    foreach ($k in $LiteProperties.Keys) { $y.Add("        ${k}: $($LiteProperties[$k])") }
}
Set-Content -LiteralPath $liteConfig -Value $y -Encoding utf8

function Invoke-MartinCp([string]$Cfg, [string]$Src, [string]$File, [int]$From, [int]$To, [switch]$Append) {
    $a = @('-c', $Cfg, '-s', $Src, '-o', $File, '--bbox', $Bbox, '--min-zoom', $From, '--max-zoom', $To, '--concurrency', $Concurrency)
    if ($Append) { $a += @('--on-duplicate', 'abort') }
    & $martinCp @a
    if ($LASTEXITCODE -ne 0) { throw "martin-cp 產生 $Src（z$From～z$To）失敗（結束代碼 $LASTEXITCODE）。" }
}

Set-MartinPgUrl -Database $Database -User $User -DbHost $DbHost -Port $Port
$results = @()
try {
    foreach ($s in $todo) {
        $min = $tables[$s].MinZoom
        if ($min -gt $MaxZoom) { throw "$s 的 minzoom $min 大於 -MaxZoom $MaxZoom。" }
        $file = Join-Path $build "$s.mbtiles"
        if (Test-Path $file) { Remove-Item $file }
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $liteTo = [math]::Min($LiteMaxZoom, $MaxZoom)
        if ($liteTo -ge $min) {
            # 先產完整版（決定 metadata 的欄位清單），再把精簡版的小比例尺加進同一檔案
            Write-Host "產生 $s：完整 z$($liteTo + 1)～z$MaxZoom、精簡 z$min～z$liteTo …"
            if ($liteTo -lt $MaxZoom) { Invoke-MartinCp $config $s $file ($liteTo + 1) $MaxZoom }
            Invoke-MartinCp $liteConfig "${s}__lite" $file $min $liteTo -Append:($liteTo -lt $MaxZoom)
            & $mbtilesExe meta-set $file minzoom $min | Out-Null
            & $mbtilesExe meta-set $file maxzoom $MaxZoom | Out-Null
            $range = "z$min～z$MaxZoom（精簡 ～z$liteTo）"
        }
        else {
            Write-Host "產生 $s：完整 z$min～z$MaxZoom …"
            Invoke-MartinCp $config $s $file $min $MaxZoom
            $range = "z$min～z$MaxZoom"
        }
        $sw.Stop()
        $results += [pscustomobject]@{
            來源 = $s; 層級 = $range
            秒數 = [math]::Round($sw.Elapsed.TotalSeconds, 1)
            MB   = [math]::Round((Get-Item $file).Length / 1MB, 1)
        }
    }
}
finally { Clear-MartinPgUrl }

# 全部成功才替換正式檔案
foreach ($s in $todo) {
    try { Move-Item -Force (Join-Path $build "$s.mbtiles") (Join-Path $out "$s.mbtiles") }
    catch { throw "無法替換 $out\$s.mbtiles（Martin 可能正在使用），請停止 Martin 後再執行一次。$_" }
}
Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
$results | Format-Table -AutoSize
Write-Host "2D 完成，檔案在 $out。Martin 若正在執行，請重新啟動才會讀到新檔。"
if (-not $No3D) { Invoke-Pipes3DBuild }
