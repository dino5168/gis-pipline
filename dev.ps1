<#
一次啟動開發環境（各開一個 PowerShell 視窗）：
  Martin 圖磚  http://127.0.0.1:3000/catalog
  FastAPI      http://127.0.0.1:8000/docs
  前端 Vite    http://localhost:5173
用法：.\dev.ps1            全部啟動
      .\dev.ps1 -Only web   只啟動其中一個（tiles / api / web）
#>
param([ValidateSet('all', 'tiles', 'api', 'web')][string]$Only = 'all')
$root = $PSScriptRoot
$jobs = [ordered]@{
    tiles = "& '$root\tiles\start-martin.ps1'"
    api   = "Set-Location '$root\api'; uv run uvicorn app.main:app --reload --port 8000"
    web   = "Set-Location '$root\web'; npm run dev"
}
foreach ($k in $jobs.Keys) {
    if ($Only -ne 'all' -and $Only -ne $k) { continue }
    Start-Process pwsh -ArgumentList '-NoExit', '-Command', "`$Host.UI.RawUI.WindowTitle='$k'; $($jobs[$k])"
}
