# PanelCronometro - deja entrar al panel desde el celular u otra PC de la red (firewall de Windows).
# Se ejecuta una sola vez (pide permisos de administrador).
param([int]$Port = 5100)
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Port', $Port)
  exit
}
try {
  # Si alguna vez se cancelo el aviso del firewall, Windows dejo reglas que bloquean a node.exe
  Get-NetFirewallRule -Direction Inbound -Action Block -ErrorAction SilentlyContinue | Where-Object {
    ($_ | Get-NetFirewallApplicationFilter).Program -match 'node(\.exe)?$' } | Remove-NetFirewallRule
  $rule = 'PanelCronometro'
  Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
  Write-Host "Listo: desde el celular se puede entrar al panel (puerto $Port)." -ForegroundColor Green
  (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress | ForEach-Object { Write-Host "  http://${_}:$Port/" }
} catch { Write-Host $_.Exception.Message -ForegroundColor Red }
Read-Host "`nEnter para cerrar"
