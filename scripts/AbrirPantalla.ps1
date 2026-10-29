# PanelCronometro - abre la pantalla a pantalla completa en el segundo monitor (el HDMI de la LED).
# Si hay un solo monitor, la abre en ese. Para cerrarla: Alt+F4.
param([int]$Port = 5100)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$profileDir = Join-Path $root 'data\perfil-pantalla'

$screens = [System.Windows.Forms.Screen]::AllScreens
$target = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
if (-not $target) { $target = $screens | Select-Object -First 1 }
$b = $target.Bounds

$browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) { throw 'No se encontro Edge ni Chrome' }

# Si ya estaba abierta, se cierra la anterior
Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*perfil-pantalla*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500

$flags = @(
  '--kiosk', "http://127.0.0.1:$Port/pantalla.html", '--edge-kiosk-type=fullscreen',
  "--window-position=$($b.X),$($b.Y)", "--window-size=$($b.Width),$($b.Height)",
  "--user-data-dir=`"$profileDir`"", '--no-first-run', '--disable-session-crashed-bubble', '--disable-infobars',
  '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--disable-features=Translate'
)
Start-Process -FilePath $browser -ArgumentList $flags
