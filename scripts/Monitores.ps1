# PanelCronometro - lista las salidas de video (monitores, HDMI) de esta PC, en JSON para el panel.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$list = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  [pscustomobject]@{ id = $_.DeviceName; principal = $_.Primary; x = $_.Bounds.X; y = $_.Bounds.Y; w = $_.Bounds.Width; h = $_.Bounds.Height }
})
ConvertTo-Json -InputObject $list -Compress
