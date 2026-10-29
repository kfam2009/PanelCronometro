# PanelCronometro

Pantalla de llegadas **3x1** para carreras, con cámaras en vivo, **sin vMix ni OBS**.
Hecho por **Panel Go** para **Maxi Cronos**.

Se conecta al link del *presenter* de RaceResult que da el cronometrista y muestra en la pantalla LED
(por el HDMI de la notebook):

- **Llegada en grande** cuando cruza alguien (puesto, nombre, tiempo, distancia, dorsal, categoría).
- Si llegan **3 o más juntos**, un solo cartel **"¡LLEGADAS!"** con todos.
- Cuando no llega nadie, va rotando: **últimas llegadas**, **posiciones completas** de cada distancia
  (de a 7) y, cada 3 páginas, un **logo o publicidad**.
- **Cámara en vivo** a la izquierda (IP por RTSP/SRT, o USB/capturadora), fija o rotando entre varias.

Todo se maneja desde un **panel** que se abre en la PC o en el **celular** (misma red).

## Instalación (Windows)

1. Instalar **Node.js LTS** (https://nodejs.org) si la PC no lo tiene.
2. Copiar esta carpeta a la PC (por ejemplo `Videos\PanelCronometro`).
3. Para las cámaras IP hace falta `tools\go2rtc.exe`. Si en la PC está el panel de domos
   (`Videos\panelgo-ptz`), `Iniciar.cmd` lo copia solo. Si no, bajarlo de
   https://github.com/AlexxIT/go2rtc/releases (`go2rtc_win64.zip`) y ponerlo en `tools\`.
4. Para **SRT** y el **modo compatible** hace falta `tools\ffmpeg.exe` con soporte SRT: bajar
   `ffmpeg-master-latest-win64-gpl.zip` de https://github.com/BtbN/FFmpeg-Builds/releases y copiar
   `bin\ffmpeg.exe` a `tools\`. (El ffmpeg del panel de domos sirve para RTSP, pero no trae SRT.)
5. Doble clic en **Iniciar.cmd**: arranca el programa y abre el panel.
6. Para entrar desde el celular, ejecutar una vez **PermitirCelular.cmd** (pide permisos).

## Uso

1. **Cronometraje**: pegar el link del presenter y **GUARDAR**. Tiene que decir **CONECTADO**.
2. **CARGAR TODOS** trae los resultados que ya existan (para tener las tablas desde el principio).
3. **Cámaras**: agregar las IP (dirección RTSP/SRT) o USB, **GUARDAR CÁMARAS**, y elegir cuál va en la pantalla.
4. **Logos y publicidad**: subir imágenes; tocarlas para prender/apagar.
5. **ABRIR EN LA PANTALLA**: la abre a pantalla completa en el segundo monitor (el HDMI de la LED).
   También se puede abrir con **AbrirPantalla.cmd**. Para cerrarla: Alt+F4.
6. **Dónde va en la salida HDMI**: si el procesador de la LED toma la imagen 1:1, elegir la opción que
   coincida (banda arriba, centrada, 768×256, o personalizada).

**Pruebas**: escribir un dorsal y **SIMULAR LLEGADA** (entra como si hubiera cruzado).
**BORRAR TODO** antes de cada evento nuevo.

Si se corta la conexión en vivo, cada 20 segundos el programa revisa igual los dorsales que todavía
no llegaron, así no se pierde ninguna llegada.

## Técnico

- `server.mjs`: servidor (Node 20+, sin dependencias). Puerto 5100 (`PORT` para cambiarlo).
- `lib/carrera.mjs`: conexión con RaceResult (websocket del presenter + chipcheck), tablas y guardado.
- `lib/camaras.mjs`: go2rtc solo en 127.0.0.1; la pantalla lo usa a través de `/go2rtc/` (mismo origen), por WebRTC.
  Modo compatible (y siempre en SRT): ffmpeg lee la cámara y se la pasa a go2rtc sin recodificar.
- `public/pantalla.html`: diseño 1920×640 (3:1) que se escala al área elegida.
- `data/` (no se sube a GitHub): configuración, llegadas guardadas, logos subidos.
- Tests: `npm test` (incluye un RaceResult de prueba con websocket).
