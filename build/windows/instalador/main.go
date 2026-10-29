//go:build windows

// Instalador de PanelCronometro (un solo .exe). Tambien desinstala: Desinstalar.exe o /desinstalar.
// Instala en %LOCALAPPDATA%\Programs\PanelCronometro (no necesita permisos de administrador),
// los datos quedan en %LOCALAPPDATA%\PanelCronometro\data.
package main

import (
	"archive/zip"
	"bytes"
	_ "embed"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"panelcronometro/build/comun"
)

//go:embed payload.zip
var payload []byte

//go:embed version.txt
var version string

const titulo = "PanelCronometro"
const regKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PanelCronometro`

var (
	destino = filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "PanelCronometro")
	datos   = filepath.Join(os.Getenv("LOCALAPPDATA"), "PanelCronometro")
	menu    = filepath.Join(os.Getenv("APPDATA"), `Microsoft\Windows\Start Menu\Programs\PanelCronometro`)
)

func main() {
	exe, _ := os.Executable()
	if strings.EqualFold(filepath.Base(exe), "Desinstalar.exe") || (len(os.Args) > 1 && strings.EqualFold(os.Args[1], "/desinstalar")) {
		desinstalar()
		return
	}
	instalar(exe)
}

func powershell(script string) error {
	return comun.Oculto(exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script)).Run()
}
func q(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// Regla del firewall para entrar al panel desde el celular (pide permiso de administrador una vez)
func firewall(agregar bool) {
	cmd := `netsh advfirewall firewall delete rule name=PanelCronometro`
	if agregar {
		cmd += ` & netsh advfirewall firewall add rule name=PanelCronometro dir=in action=allow protocol=TCP localport=` + comun.Puerto + ` profile=any`
	}
	powershell(`Start-Process cmd.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '/c ` + cmd + `'`)
}

func instalar(exe string) {
	v := strings.TrimSpace(version)
	if comun.Mensaje(titulo+" "+v, "¿Instalar PanelCronometro "+v+" en esta PC?\n\nPantalla de llegadas 3x1 · Panel Go para Maxi Cronos.\nNo hace falta instalar ningún otro programa.", comun.MB_YESNO|comun.MB_ICONQ) != comun.IDYES {
		return
	}
	fmt.Println("PanelCronometro " + v + " - instalando...")
	if comun.Corriendo() {
		fmt.Println("Cerrando la versión que estaba abierta...")
		comun.Cerrar()
		if comun.Corriendo() {
			// una version vieja que no sabe cerrarse sola: se cierra lo que use el puerto
			powershell(`Get-NetTCPConnection -LocalPort ` + comun.Puerto + ` -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`)
		}
		time.Sleep(time.Second)
	}
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err == nil {
		err = extraer(zr)
	}
	if err != nil {
		comun.Mensaje(titulo, "No se pudo instalar:\n"+err.Error()+"\n\nSi PanelCronometro está abierto, cerralo y probá de nuevo.", comun.MB_ICONWARN)
		return
	}
	// el instalador queda como desinstalador
	if b, err := os.ReadFile(exe); err == nil {
		os.WriteFile(filepath.Join(destino, "Desinstalar.exe"), b, 0o755)
	}
	fmt.Println("Creando accesos directos...")
	app, ico := filepath.Join(destino, "PanelCronometro.exe"), filepath.Join(destino, "panelcronometro.ico")
	os.MkdirAll(menu, 0o755)
	powershell(`$s = New-Object -ComObject WScript.Shell
function L($p, $t, $a, $d) { $l = $s.CreateShortcut($p); $l.TargetPath = $t; $l.Arguments = $a; $l.IconLocation = ` + q(ico) + `; $l.WorkingDirectory = ` + q(destino) + `; $l.Description = $d; $l.Save() }
L (Join-Path ([Environment]::GetFolderPath('Desktop')) 'PanelCronometro.lnk') ` + q(app) + ` '' 'Pantalla de llegadas'
L ` + q(filepath.Join(menu, "PanelCronometro.lnk")) + ` ` + q(app) + ` '' 'Pantalla de llegadas'
L ` + q(filepath.Join(menu, "Cerrar PanelCronometro.lnk")) + ` ` + q(app) + ` '--cerrar' 'Cierra el programa'
L ` + q(filepath.Join(menu, "Desinstalar PanelCronometro.lnk")) + ` ` + q(filepath.Join(destino, "Desinstalar.exe")) + ` '' 'Desinstalar'`)
	// aparece en "Agregar o quitar programas"
	for _, kv := range [][2]string{{"DisplayName", "PanelCronometro"}, {"DisplayVersion", v}, {"Publisher", "Panel Go"},
		{"DisplayIcon", ico}, {"InstallLocation", destino}, {"UninstallString", `"` + filepath.Join(destino, "Desinstalar.exe") + `" /desinstalar`}} {
		comun.Oculto(exec.Command("reg.exe", "add", regKey, "/v", kv[0], "/t", "REG_SZ", "/d", kv[1], "/f")).Run()
	}
	for _, k := range []string{"NoModify", "NoRepair"} {
		comun.Oculto(exec.Command("reg.exe", "add", regKey, "/v", k, "/t", "REG_DWORD", "/d", "1", "/f")).Run()
	}
	fmt.Println("Permiso para entrar desde el celular (Windows va a pedir confirmación)...")
	firewall(true)
	fmt.Println("Listo.")
	comun.Mensaje(titulo, "PanelCronometro quedó instalado.\n\nSe abre con el acceso directo del escritorio. Para cerrarlo: menú Inicio > PanelCronometro > Cerrar PanelCronometro.", comun.MB_ICONINFO)
	comun.Oculto(exec.Command(app)).Start()
}

func extraer(zr *zip.Reader) error {
	var total, hecho int64
	for _, f := range zr.File {
		total += int64(f.UncompressedSize64)
	}
	for _, f := range zr.File {
		p := filepath.Join(destino, filepath.FromSlash(f.Name))
		if !strings.HasPrefix(p, destino+string(os.PathSeparator)) {
			continue
		}
		if f.FileInfo().IsDir() {
			os.MkdirAll(p, 0o755)
			continue
		}
		os.MkdirAll(filepath.Dir(p), 0o755)
		r, err := f.Open()
		if err != nil {
			return err
		}
		w, err := os.Create(p)
		if err != nil {
			r.Close()
			return fmt.Errorf("%s: %v", f.Name, err)
		}
		buf := make([]byte, 1<<20)
		for {
			n, er := r.Read(buf)
			if n > 0 {
				if _, ew := w.Write(buf[:n]); ew != nil {
					r.Close()
					w.Close()
					return ew
				}
				hecho += int64(n)
				fmt.Printf("\r  Copiando archivos... %3d%%", hecho*100/total)
			}
			if er == io.EOF {
				break
			}
			if er != nil {
				r.Close()
				w.Close()
				return er
			}
		}
		r.Close()
		if err := w.Close(); err != nil {
			return err
		}
	}
	fmt.Println()
	return nil
}

func desinstalar() {
	if comun.Mensaje(titulo, "¿Desinstalar PanelCronometro?", comun.MB_YESNO|comun.MB_ICONQ) != comun.IDYES {
		return
	}
	borrarDatos := comun.Mensaje(titulo, "¿Borrar también la configuración, las llegadas, los logos y los videos guardados?\n\n(Elegí No si lo vas a volver a instalar.)", comun.MB_YESNO|comun.MB_ICONQ) == comun.IDYES
	comun.Cerrar()
	os.Remove(filepath.Join(powershellDesktop(), "PanelCronometro.lnk"))
	os.RemoveAll(menu)
	comun.Oculto(exec.Command("reg.exe", "delete", regKey, "/f")).Run()
	firewall(false)
	if borrarDatos {
		os.RemoveAll(datos)
	}
	comun.Mensaje(titulo, "PanelCronometro se desinstaló.", comun.MB_ICONINFO)
	// la carpeta se borra cuando este programa termina
	comun.Oculto(exec.Command("cmd.exe", "/c", "ping 127.0.0.1 -n 3 >nul & rmdir /s /q \""+destino+"\"")).Start()
}

func powershellDesktop() string {
	out, err := comun.Oculto(exec.Command("powershell.exe", "-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')")).Output()
	if err != nil {
		return filepath.Join(os.Getenv("USERPROFILE"), "Desktop")
	}
	return strings.TrimSpace(string(out))
}
