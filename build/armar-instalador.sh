#!/bin/bash
# Arma el instalador de Windows: PanelCronometro-Instalador-<version>.exe
# Uso: build/armar-instalador.sh <carpeta con node.exe, go2rtc.exe, ffmpeg.exe> <carpeta de salida>
# Necesita: node 20+, go 1.22+, python3 con Pillow. El codigo del programa va cifrado (app.pack).
set -euo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd)
BIN=$(cd "$1" && pwd); OUT=$(mkdir -p "$2" && cd "$2" && pwd)
V=$(node -p "require('$SRC/package.json').version")
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
for f in node.exe go2rtc.exe ffmpeg.exe; do [ -f "$BIN/$f" ] || { echo "Falta $BIN/$f"; exit 1; }; done

cp -r "$SRC/build/windows" "$T/go"
mkdir -p "$T/payload/runtime" "$T/payload/tools"
# 1) programa cifrado + arranque
KEY=$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))")
node "$SRC/build/empaquetar.mjs" "$T/payload" "$KEY"
mv "$T/payload/arranque.txt" "$T/go/lanzador/arranque.txt"
# 2) clave mezclada dentro del lanzador
read K1 K2 < <(node -e "
const k=Buffer.from(process.argv[1]),m=require('crypto').randomBytes(k.length);
const x=Buffer.from(k.map((b,i)=>b^m[i]));console.log([...x].join(','),[...m].join(','))" "$KEY")
sed -i "s/{KEY1}/{$K1}/; s/{KEY2}/{$K2}/" "$T/go/lanzador/main.go"
# 3) icono
python3 "$T/go/rsrc.py" "$SRC/public/img/panelgo.png" "$T/go/lanzador/rsrc_windows_amd64.syso" "$T/payload/panelcronometro.ico"
cp "$T/go/lanzador/rsrc_windows_amd64.syso" "$T/go/instalador/"
# 4) lanzador (sin ventana de consola)
(cd "$T/go" && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o "$T/payload/PanelCronometro.exe" ./lanzador)
# 5) contenido
cp "$BIN/node.exe" "$T/payload/runtime/node.exe"
cp "$BIN/go2rtc.exe" "$BIN/ffmpeg.exe" "$T/payload/tools/"
(cd "$T/payload" && python3 -c "
import zipfile,os
z=zipfile.ZipFile('$T/go/instalador/payload.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6)
for r,_,fs in os.walk('.'):
  for f in fs:
    p=os.path.join(r,f)[2:]; z.write(p,p.replace(os.sep,'/'))
z.close()")
printf '%s' "$V" > "$T/go/instalador/version.txt"
# 6) instalador
(cd "$T/go" && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$OUT/PanelCronometro-Instalador-$V.exe" ./instalador)
ls -la "$OUT/PanelCronometro-Instalador-$V.exe"
