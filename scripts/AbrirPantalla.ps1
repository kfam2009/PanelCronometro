# PanelCronometro - abre la pantalla a pantalla completa en la salida elegida en el panel (ej. el HDMI de la LED).
# Sin eleccion (o si esa salida ya no esta): el monitor que no es el principal; si hay uno solo, ese. Para cerrarla: Alt+F4.
param([int]$Port = 5100, [string]$Monitor = '', [string]$Root = '', [string]$DataDir = '')
$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }
if (-not $DataDir) { $DataDir = Join-Path $Root 'data' }
$log = Join-Path $DataDir 'abrir-pantalla.log'
function Log($m) { Add-Content -Path $log -Value ((Get-Date -Format 'HH:mm:ss') + ' ' + $m) }
trap { Log ('ERROR: ' + $_.Exception.Message); exit 1 }
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W32 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
}
'@
[void][W32]::SetProcessDPIAware()  # medidas reales en pixeles (si Windows tiene escala 125/150%)
Add-Type -AssemblyName System.Windows.Forms
Log "---- Monitor pedido: '$Monitor'"
$profileDir = Join-Path $DataDir 'perfil-pantalla'

$screens = [System.Windows.Forms.Screen]::AllScreens
$target = $null
if ($Monitor) { $target = $screens | Where-Object { $_.DeviceName -eq $Monitor } | Select-Object -First 1 }
if (-not $target) { $target = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1 }
if (-not $target) { $target = $screens | Select-Object -First 1 }
$b = $target.Bounds
$screens | ForEach-Object { Log ("  {0} principal={1} {2},{3} {4}x{5}" -f $_.DeviceName, $_.Primary, $_.Bounds.X, $_.Bounds.Y, $_.Bounds.Width, $_.Bounds.Height) }
Log ("Destino: {0} {1},{2} {3}x{4}" -f $target.DeviceName, $b.X, $b.Y, $b.Width, $b.Height)

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
Log "Navegador: $browser"
Log ("Opciones: " + ($flags -join ' '))
$p = Start-Process -FilePath $browser -ArgumentList $flags -PassThru
Log "Iniciado pid $($p.Id)"
# control: donde quedo la ventana
Start-Sleep -Seconds 4
Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*perfil-pantalla*' } | ForEach-Object {
  $gp = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  if ($gp -and $gp.MainWindowHandle -ne 0) { $r = New-Object W32+RECT; [void][W32]::GetWindowRect($gp.MainWindowHandle, [ref]$r); Log ("Ventana pid {0}: {1},{2} a {3},{4} '{5}'" -f $gp.Id, $r.L, $r.T, $r.R, $r.B, $gp.MainWindowTitle) }
}
Log 'fin'
