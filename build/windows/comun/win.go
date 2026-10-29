//go:build windows

// Funciones de Windows compartidas por el lanzador y el instalador (solo biblioteca estandar).
package comun

import (
	"net/http"
	"os/exec"
	"syscall"
	"time"
	"unsafe"
)

const Puerto = "5100"
const URL = "http://127.0.0.1:" + Puerto + "/"

var (
	user32     = syscall.NewLazyDLL("user32.dll")
	messageBox = user32.NewProc("MessageBoxW")
)

const (
	MB_OK       = 0x00000000
	MB_YESNO    = 0x00000004
	MB_ICONINFO = 0x00000040
	MB_ICONWARN = 0x00000030
	MB_ICONQ    = 0x00000020
	IDYES       = 6
)

func Mensaje(titulo, texto string, flags uintptr) int {
	t, _ := syscall.UTF16PtrFromString(titulo)
	m, _ := syscall.UTF16PtrFromString(texto)
	r, _, _ := messageBox.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), flags|0x00010000 /*MB_SETFOREGROUND*/)
	return int(r)
}

// Oculto: sin ventana negra de consola
func Oculto(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return cmd
}

func Corriendo() bool {
	c := http.Client{Timeout: 1500 * time.Millisecond}
	r, err := c.Get(URL + "api/estado")
	if err != nil {
		return false
	}
	r.Body.Close()
	return r.StatusCode == 200
}

func Cerrar() bool {
	c := http.Client{Timeout: 3 * time.Second}
	r, err := c.Post(URL+"api/salir", "application/json", nil)
	if err != nil {
		return false
	}
	r.Body.Close()
	for i := 0; i < 20 && Corriendo(); i++ {
		time.Sleep(250 * time.Millisecond)
	}
	return true
}

func AbrirNavegador(u string) {
	Oculto(exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", u)).Start()
}
