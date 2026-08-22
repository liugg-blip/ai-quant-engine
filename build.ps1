# 量化引擎 v10.0 一键构建
#   0) 可选 -Refresh：重新抓取全市场标的库快照（需联网，约 1 分钟）
#   1) 内联 ECharts + 标的库 + app.js -> QUANT_ENGINE_v10.html （完全离线单文件）
#   2) 生成 app.ico
#   3) 编译 QUANT_ENGINE_v10.exe（HTML 作为内嵌资源）
param([switch]$Refresh)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src  = Join-Path $root 'src'
$dist = $root                      # 产物直接放项目根目录
$csc  = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "找不到 C# 编译器: $csc (需要 .NET Framework 4.x)" }

$html    = Join-Path $dist 'QUANT_ENGINE_v10.html'
$exe     = Join-Path $dist 'QUANT_ENGINE_v10.exe'
$ico     = Join-Path $src  'app.ico'
$tmpIcon = Join-Path $env:TEMP 'qe_makeicon.exe'

if ($Refresh) {
  Write-Host '[0/3] 抓取全市场标的库快照 ...'
  & node (Join-Path $root 'fetch-universe.js')
  if ($LASTEXITCODE -ne 0) { throw '抓取标的库失败（接口限流时稍后重试，或直接省略 -Refresh 用现有快照）' }
}

Write-Host '[1/3] 打包单文件 HTML ...'
& node (Join-Path $root 'build.js')
if ($LASTEXITCODE -ne 0) { throw '打包 HTML 失败' }

Write-Host '[2/3] 生成图标 ...'
$a = @('/nologo', '/target:exe', "/out:$tmpIcon", '/reference:System.Drawing.dll', (Join-Path $src 'MakeIcon.cs'))
& $csc $a
& $tmpIcon $ico | Write-Host

Write-Host '[3/3] 编译 EXE ...'
$b = @(
  '/nologo', '/target:winexe', '/codepage:65001', '/optimize+',
  "/win32icon:$ico",
  "/resource:$html,QE.html",
  '/reference:System.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
  "/out:$exe",
  (Join-Path $src 'Launcher.cs')
)
if (Get-Process -Name 'QUANT_ENGINE_v10' -ErrorAction SilentlyContinue) {
  throw '终端正在运行，exe 被占用。请先关闭「量化引擎」窗口再构建'
}
& $csc $b
if ($LASTEXITCODE -ne 0) { throw "编译 EXE 失败（csc 退出码 $LASTEXITCODE）" }

Get-Item $html, $exe | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,2)}}, LastWriteTime |
  Format-Table -AutoSize | Out-String | Write-Host
Write-Host "构建完成 -> $dist"
