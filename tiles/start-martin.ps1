<#
啟動 Martin 向量圖磚服務。

兩種模式（圖磚網址、來源名稱相同，前端不用改）：
  預設    送預先產生的 MBTiles（tiles\mbtiles\*.mbtiles，設定檔 martin-mbtiles.yaml），不查資料庫。
          資料更新後要先執行 .\build-mbtiles.ps1 重新產生。
  -Live   即時從 PostGIS 產生（設定檔 martin.yaml）。剛匯入資料、還沒重產 MBTiles 時用。
          密碼從 pgpass.conf（或環境變數 PGPASSWORD）讀取，只放進環境變數 MARTIN_PG_URL，不寫入檔案。

用法：
    .\start-martin.ps1 [-Live] [-Database gis] [-User postgres] [-DbHost localhost] [-Port 5432] [其他 martin 參數]
例：
    .\start-martin.ps1
    .\start-martin.ps1 -Live
    .\start-martin.ps1 --tui        # 以終端機儀表板顯示狀態
#>
param(
    [switch]$Live,
    [string]$Database = 'gis',
    [string]$User = 'postgres',
    [string]$DbHost = 'localhost',
    [int]$Port = 5432
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
. (Join-Path $root 'pg-env.ps1')
$martin = Find-MartinTool 'martin.exe'

if ($Live) {
    Set-MartinPgUrl -Database $Database -User $User -DbHost $DbHost -Port $Port
    $config = Join-Path $root 'martin.yaml'
    $mode = '即時（PostGIS）'
}
else {
    $dir = Join-Path $root 'mbtiles'
    if (-not (Get-ChildItem -Path $dir -Filter *.mbtiles -ErrorAction SilentlyContinue)) {
        throw "$dir 沒有 .mbtiles 檔。請先執行 .\build-mbtiles.ps1，或用 .\start-martin.ps1 -Live 即時產生。"
    }
    $env:MARTIN_MBTILES_DIR = $dir
    $config = Join-Path $root 'martin-mbtiles.yaml'
    $mode = 'MBTiles'
}

Write-Host "Martin 啟動中（$mode）：http://127.0.0.1:3000/catalog （Ctrl+C 停止）"
try {
    & $martin --config $config @args
}
finally {
    Clear-MartinPgUrl
    Remove-Item Env:MARTIN_MBTILES_DIR -ErrorAction SilentlyContinue
}
