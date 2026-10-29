//go:build windows

// PanelCronometro.exe: arranca el programa (oculto) y abre el panel en el navegador.
//   PanelCronometro.exe           abre (si ya estaba corriendo, solo abre el panel)
//   PanelCronometro.exe --cerrar  lo cierra
package main

import (
	_ "embed"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"panelcronometro/build/comun"
)

//go:embed arranque.txt
var arranque string

// clave del paquete, guardada mezclada (se arma en el momento)
var k1 = []byte{KEY1}
var k2 = []byte{KEY2}

func clave() string {
	b := make([]byte, len(k1))
	for i := range k1 {
		b[i] = k1[i] ^ k2[i]
	}
	return string(b)
}

func main() {
	const titulo = "PanelCronometro"
	if len(os.Args) > 1 && os.Args[1] == "--cerrar" {
		if comun.Cerrar() {
			comun.Mensaje(titulo, "PanelCronometro se cerró.", comun.MB_ICONINFO)
		} else {
			comun.Mensaje(titulo, "PanelCronometro no estaba abierto.", comun.MB_ICONINFO)
		}
		return
	}
	if comun.Corriendo() {
		comun.AbrirNavegador(comun.URL)
		return
	}
	exe, _ := os.Executable()
	dir := filepath.Dir(exe)
	datos := filepath.Join(os.Getenv("LOCALAPPDATA"), "PanelCronometro", "data")
	os.MkdirAll(datos, 0o755)
	logPath := filepath.Join(datos, "programa.log")
	log, _ := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)

	cmd := exec.Command(filepath.Join(dir, "runtime", "node.exe"), "--no-warnings", "--import", strings.TrimSpace(arranque), "-e", "0")
	cmd.Dir = datos
	cmd.Env = append(os.Environ(), "PC_ROOT="+dir, "PC_KEY="+clave(), "DATA_DIR="+datos, "PORT="+comun.Puerto)
	cmd.Stdout, cmd.Stderr = log, log
	comun.Oculto(cmd)
	if err := cmd.Start(); err != nil {
		comun.Mensaje(titulo, "No se pudo iniciar PanelCronometro:\n"+err.Error()+"\n\nProbá reinstalarlo.", comun.MB_ICONWARN)
		return
	}
	salio := make(chan struct{})
	go func() { cmd.Wait(); close(salio) }()
	for i := 0; i < 60; i++ {
		select {
		case <-salio:
			log.Close()
			b, _ := os.ReadFile(logPath)
			txt := strings.TrimSpace(string(b))
			if strings.Contains(txt, "EADDRINUSE") {
				txt = "El puerto " + comun.Puerto + " lo está usando otro programa."
			} else if len(txt) > 600 {
				txt = txt[len(txt)-600:]
			}
			comun.Mensaje(titulo, "PanelCronometro no pudo arrancar.\n\n"+txt, comun.MB_ICONWARN)
			return
		case <-time.After(250 * time.Millisecond):
		}
		if comun.Corriendo() {
			comun.AbrirNavegador(comun.URL)
			// el lanzador termina; el programa sigue corriendo oculto
			cmd.Process.Release()
			return
		}
	}
	comun.AbrirNavegador(comun.URL)
}
