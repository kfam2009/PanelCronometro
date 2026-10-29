// PanelCronometro - pantalla de llegadas 3x1 para carreras, sin vMix ni OBS.
// Panel:    http://<esta-pc>:5100/          (desde la PC o el celular, misma red)
// Pantalla: http://127.0.0.1:5100/pantalla.html   (a pantalla completa en el monitor/HDMI de la LED)
import http from 'node:http';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Carrera } from './lib/carrera.mjs';
import { Go2rtc } from './lib/camaras.mjs';

export const VERSION = '1.3.1';
const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5100);
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const logosDir = path.join(dataDir, 'logos');
const videosDir = path.join(dataDir, 'videos');
fss.mkdirSync(logosDir, { recursive: true }); fss.mkdirSync(videosDir, { recursive: true });
const configFile = path.join(dataDir, 'config.json');

export const AREAS = {
  completa: 'Toda la salida (la salida HDMI ya es 3:1)',
  banda: 'Banda 3:1 arriba de la salida',
  centro: 'Banda 3:1 en el centro de la salida',
  led: '768×256 arriba a la izquierda (píxel a píxel)',
  custom: 'Personalizada',
};
const DEFAULTS = {
  link: '', segundos: 8, area: 'banda', custom: { x: 0, y: 0, w: 1920, h: 640 },
  camaras: [], camara: '', rotarSeg: 20, color: '#ffd400',
  // Videos y YouTube a pantalla completa: medios = lista, alAire = { id, n } (n cambia cada vez que se manda, asi vuelve a empezar)
  medios: [], alAire: null, ajuste: 'llenar', sonido: true,
  logos: [
    { id: 'maxicronos', archivo: 'img/maxicronos.png', nombre: 'Maxi Cronos', activo: true, fijo: true },
    { id: 'panelgo', archivo: 'img/panelgo.png', nombre: 'Panel Go', activo: true, fijo: true },
  ],
};
let config = structuredClone(DEFAULTS);
try { config = { ...config, ...JSON.parse(await fs.readFile(configFile, 'utf8')) }; } catch {}
for (const d of DEFAULTS.logos) if (!config.logos.some(l => l.id === d.id)) config.logos.push(structuredClone(d));
let saving = Promise.resolve();
const save = () => (saving = saving.then(async () => {
  await fs.writeFile(configFile + '.tmp', JSON.stringify(config, null, 2));
  await fs.rename(configFile + '.tmp', configFile);
}).catch(() => {}));

const carrera = new Carrera({ dataDir, getConfig: () => config, save });
const go2rtc = new Go2rtc({ root, logFile: path.join(dataDir, 'go2rtc.log') });
carrera.ready.then(() => { if (config.link) carrera.connect(); });
go2rtc.apply(config.camaras);

// Estado de cada camara IP: { estado: 'ok'|'clave'|'red', error, t }
// Con 'clave' no se vuelve a intentar hasta que se corrija la direccion (o se toque REINTENTAR):
// varias camaras (Foscam y otras) bloquean a la PC entera despues de varios intentos fallidos.
const camEstado = new Map();
let probing = false;
async function vigilarCamara() {
  const c = camaraActual();
  if (probing || !c || c.tipo !== 'ip') return;
  const e = camEstado.get(c.id);
  if (e && (e.estado === 'ok' || e.estado === 'clave' || Date.now() - e.t < 20000)) return;
  probing = true;
  try { camEstado.set(c.id, { ...(await go2rtc.probe(c.id)), t: Date.now() }); } finally { probing = false; }
}
setInterval(() => vigilarCamara().catch(() => {}), 2000).unref();

// Camara que se ve ahora en la pantalla (fija o rotando)
// Fuentes para el lugar de la camara: las camaras y tambien los videos y YouTube (id 'm:<id>')
const fuentes = () => [...config.camaras, ...config.medios.map(m => ({ ...m, id: 'm:' + m.id, medio: true }))];
function camaraActual() {
  const cams = fuentes();
  if (!cams.length || !config.camara) return null;
  if (config.camara === 'rotar') return cams[Math.floor(Date.now() / (Math.max(5, config.rotarSeg) * 1000)) % cams.length];
  return cams.find(c => c.id === config.camara) || null;
}
function lanUrls() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${PORT}/`);
}
function estado() {
  return {
    version: VERSION, urls: lanUrls(), areas: AREAS, go2rtc: go2rtc.state(),
    config: { ...config }, camaraActual: camaraActual()?.id || null, ...carrera.summary(),
    camEstado: Object.fromEntries(config.camaras.map(c => [c.id, c.tipo === 'usb' ? { estado: 'ok', error: '' } : camEstado.get(c.id) || { estado: 'probando', error: '' }])),
  };
}
function pantalla() {
  let cam = camaraActual();
  // la pantalla solo se conecta a una camara IP que ya respondio bien (asi no insiste con una clave mal)
  if (cam && cam.tipo === 'ip' && camEstado.get(cam.id)?.estado !== 'ok') cam = null;
  return {
    ...carrera.screenData(), segundos: config.segundos, area: config.area, custom: config.custom, color: config.color,
    camara: cam ? { id: cam.id, tipo: cam.tipo, nombre: cam.nombre, usb: cam.usb || '', src: cam.archivo || '', yt: cam.yt || '' } : null,
    logos: config.logos.filter(l => l.activo).map(l => l.archivo),
    medio: medioAlAire(), ajuste: config.ajuste, sonido: config.sonido,
  };
}

function medioAlAire() {
  const a = config.alAire, m = a && config.medios.find(x => x.id === a.id);
  return m ? { id: m.id, n: a.n, tipo: m.tipo, src: m.archivo || '', yt: m.yt || '', repetir: Boolean(m.repetir), nombre: m.nombre } : null;
}

// ---- Cambios de configuracion (todo validado) ----
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
async function setConfig(d) {
  if ('segundos' in d) config.segundos = Math.min(30, Math.max(3, Number(d.segundos) || 8));
  if ('area' in d && d.area in AREAS) config.area = d.area;
  if (d.custom) for (const k of ['x', 'y', 'w', 'h']) if (Number.isFinite(Number(d.custom[k]))) config.custom[k] = Math.max(0, Math.round(Number(d.custom[k])));
  if ('camara' in d) config.camara = d.camara === 'rotar' || fuentes().some(c => c.id === d.camara) ? d.camara : '';
  if ('rotarSeg' in d) config.rotarSeg = Math.min(600, Math.max(5, Number(d.rotarSeg) || 20));
  if ('color' in d && /^#[0-9a-f]{6}$/i.test(d.color)) config.color = d.color;
  if ('ajuste' in d && ['llenar', 'entero'].includes(d.ajuste)) config.ajuste = d.ajuste;
  if ('sonido' in d) config.sonido = Boolean(d.sonido);
  await save();
}
async function setCamaras(list) {
  if (!Array.isArray(list) || list.length > 16) throw Error('Lista de cámaras inválida');
  const prevCams = config.camaras;
  config.camaras = list.map(c => ({
    id: typeof c.id === 'string' && /^[a-z0-9]{4,16}$/i.test(c.id) ? c.id : crypto.randomBytes(4).toString('hex'),
    nombre: str(c.nombre, 40) || 'Cámara', tipo: c.tipo === 'usb' ? 'usb' : 'ip',
    url: c.tipo === 'usb' ? '' : str(c.url, 500), usb: c.tipo === 'usb' ? str(c.usb, 200) : '',
    compat: c.tipo === 'ip' && (Boolean(c.compat) || /^srt:/i.test(String(c.url || '').trim())),
  })).filter(c => c.tipo === 'usb' || /^(rtsp|rtsps|srt|rtmp|http|https):\/\//i.test(c.url));
  if (config.camara && config.camara !== 'rotar' && !fuentes().some(c => c.id === config.camara)) config.camara = '';
  // si cambio la direccion de una camara, se vuelve a probar
  const prev = new Map(prevCams.map(c => [c.id, c.url + (c.compat ? '#c' : '')]));
  for (const c of config.camaras) if (prev.get(c.id) !== c.url + (c.compat ? '#c' : '')) camEstado.delete(c.id);
  for (const id of camEstado.keys()) if (!config.camaras.some(c => c.id === id)) camEstado.delete(id);
  await save();
  go2rtc.apply(config.camaras);
}
async function subirLogo({ nombre, data }) {
  const m = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,([a-z0-9+/=]+)$/i.exec(String(data || ''));
  if (!m) throw Error('La imagen tiene que ser PNG, JPG, WEBP, GIF o SVG');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw Error('La imagen es muy grande (máximo 8 MB)');
  const id = crypto.randomBytes(5).toString('hex'), ext = m[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  await fs.writeFile(path.join(logosDir, `${id}.${ext}`), buf);
  config.logos.push({ id, archivo: `media/${id}.${ext}`, nombre: str(nombre, 60) || 'Publicidad', activo: true });
  await save();
}
async function setLogos(list) {
  if (!Array.isArray(list)) throw Error('Lista inválida');
  const byId = new Map(config.logos.map(l => [l.id, l])), next = [];
  for (const x of list) { const l = byId.get(x.id); if (l) { next.push({ ...l, activo: Boolean(x.activo), nombre: str(x.nombre, 60) || l.nombre }); byId.delete(x.id); } }
  for (const l of byId.values()) {
    if (l.fijo) next.push(l); // los logos de fabrica no se borran, solo se apagan
    else await fs.unlink(path.join(logosDir, path.basename(l.archivo))).catch(() => {});
  }
  config.logos = next;
  await save();
}
// ---- Videos y YouTube ----
const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv'];
// El video se recibe "en crudo" (no en JSON) y se va escribiendo al disco: puede pesar varios GB
function subirVideo(req, url) {
  const ext = str(url.searchParams.get('ext'), 5).toLowerCase();
  if (!VIDEO_EXT.includes(ext)) throw Error('El video tiene que ser MP4, MOV, WEBM o MKV (MP4 es el más seguro)');
  const id = crypto.randomBytes(5).toString('hex'), file = path.join(videosDir, `${id}.${ext}`);
  return new Promise((ok, bad) => {
    let n = 0; const out = fss.createWriteStream(file);
    const fail = e => { out.destroy(); fs.unlink(file).catch(() => {}); bad(e); };
    req.on('data', d => { n += d.length; if (n > 8 * 1024 ** 3) { req.destroy(); fail(Error('El video es muy grande (máximo 8 GB)')); } });
    req.on('aborted', () => fail(Error('Se cortó la subida')));
    req.pipe(out);
    out.on('error', fail);
    out.on('finish', async () => {
      if (!n) return fail(Error('El archivo llegó vacío'));
      config.medios.push({ id, tipo: 'video', nombre: str(url.searchParams.get('nombre'), 60) || 'Video', archivo: `media/videos/${id}.${ext}`, repetir: false });
      await save(); ok();
    });
  });
}
export function youtubeId(u) {
  const s = String(u || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i.exec(s);
  return m ? m[1] : null;
}
async function agregarYoutube({ url, nombre }) {
  const yt = youtubeId(url);
  if (!yt) throw Error('No es un link de YouTube válido (ej. https://www.youtube.com/watch?v=... o https://youtu.be/...)');
  let titulo = str(nombre, 60);
  if (!titulo) try { titulo = str((await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${yt}`, { signal: AbortSignal.timeout(4000) }).then(r => r.json())).title, 60); } catch {}
  config.medios.push({ id: crypto.randomBytes(5).toString('hex'), tipo: 'youtube', nombre: titulo || 'YouTube', yt, repetir: true });
  await save();
}
async function setMedios(list) {
  if (!Array.isArray(list)) throw Error('Lista inválida');
  const byId = new Map(config.medios.map(m => [m.id, m])), next = [];
  for (const x of list) { const m = byId.get(x.id); if (m) { next.push({ ...m, nombre: str(x.nombre, 60) || m.nombre, repetir: Boolean(x.repetir) }); byId.delete(x.id); } }
  for (const m of byId.values()) if (m.archivo) await fs.unlink(path.join(videosDir, path.basename(m.archivo))).catch(() => {});
  config.medios = next;
  if (config.alAire && !next.some(m => m.id === config.alAire.id)) config.alAire = null;
  if (config.camara && config.camara !== 'rotar' && !fuentes().some(c => c.id === config.camara)) config.camara = '';
  await save();
}
async function alAire(id) {
  config.alAire = id && config.medios.some(m => m.id === id) ? { id, n: Date.now() } : null;
  await save();
}
// La pantalla avisa que termino un video sin repetir: se vuelve a los resultados
async function finVideo({ id, n }) {
  if (config.alAire && config.alAire.id === id && config.alAire.n === n) { config.alAire = null; await save(); }
}
const VTYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/webm' };
// Videos con "Range" (el navegador pide de a pedazos y puede saltar o repetir sin bajar todo)
async function serveVideo(req, res, rel) {
  const file = path.resolve(videosDir, rel);
  if (!file.startsWith(videosDir + path.sep)) return json(res, 403, { error: 'Ruta no permitida' });
  let size; try { size = (await fs.stat(file)).size; } catch { return json(res, 404, { error: 'No encontrado' }); }
  const type = VTYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]), end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start < 0) start = 0;
    if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-cache' });
    return fss.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size, 'Cache-Control': 'no-cache' });
  fss.createReadStream(file).pipe(res);
}

// Abre la pantalla a pantalla completa en el segundo monitor (Windows)
function abrirPantalla() {
  if (process.platform !== 'win32') throw Error('Abrir la pantalla automáticamente funciona en Windows');
  const ps = path.join(root, 'scripts', 'AbrirPantalla.ps1');
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps, '-Port', String(PORT)], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

// ---- HTTP ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const json = (res, code, v) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(v)); };
const body = req => new Promise((ok, bad) => { let n = 0; const c = []; req.on('data', d => { n += d.length; if (n > 12e6) { bad(Error('Demasiado grande')); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c).toString('utf8'))); req.on('error', bad); });

async function serveFile(res, base, rel) {
  const file = path.resolve(base, rel);
  if (file !== base && !file.startsWith(base + path.sep)) return json(res, 403, { error: 'Ruta no permitida' });
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch { json(res, 404, { error: 'No encontrado' }); }
}

const ROUTES = {
  'POST /api/link': d => carrera.setLink(d.link),
  'POST /api/reconectar': () => carrera.connect(),
  'POST /api/simular': d => carrera.simulate(str(d.bib, 20)),
  'POST /api/cargar': d => { carrera.scan(Math.min(5000, Number(d.max) || 1000)).catch(e => { carrera.status.error = e.message; }); },
  'POST /api/borrar': () => carrera.clear(),
  'POST /api/config': d => setConfig(d),
  'POST /api/camaras': d => setCamaras(d.camaras),
  'POST /api/logos': d => setLogos(d.logos),
  'POST /api/camaras/reintentar': d => { camEstado.delete(str(d.id, 20)); },
  'POST /api/logos/subir': d => subirLogo(d),
  'POST /api/abrir-pantalla': () => abrirPantalla(),
  'POST /api/medios': d => setMedios(d.medios),
  'POST /api/medios/youtube': d => agregarYoutube(d),
  'POST /api/aire': d => alAire(str(d.id, 20)),
  'POST /api/aire/fin': d => finVideo({ id: str(d.id, 20), n: Number(d.n) }),
};

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/go2rtc/')) return go2rtc.proxy(req, res, url.pathname.slice(7) + url.search);
    if (req.method === 'GET' && url.pathname === '/api/estado') return json(res, 200, estado());
    if (req.method === 'GET' && url.pathname === '/api/pantalla') return json(res, 200, pantalla());
    if (req.method === 'POST' && url.pathname === '/api/medios/subir') {
      try { await subirVideo(req, url); } catch (e) { return json(res, 400, { error: e.message }); }
      return json(res, 200, estado());
    }
    const route = ROUTES[`${req.method} ${url.pathname}`];
    if (route) {
      const d = req.method === 'POST' ? JSON.parse((await body(req)) || '{}') : {};
      try { await route(d); } catch (e) { return json(res, 400, { error: e.message }); }
      return json(res, 200, estado());
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Ruta desconocida' });
    if (url.pathname.startsWith('/media/videos/')) return serveVideo(req, res, decodeURIComponent(url.pathname.slice(14)));
    if (url.pathname.startsWith('/media/')) return serveFile(res, logosDir, decodeURIComponent(url.pathname.slice(7)));
    return serveFile(res, path.join(root, 'public'), decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1)));
  } catch (e) { json(res, 400, { error: e.message }); }
});
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/go2rtc/')) go2rtc.upgrade(req, socket, head, url.pathname.slice(7) + url.search);
  else socket.destroy();
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`PanelCronometro ${VERSION}\nPanel: http://127.0.0.1:${PORT}/\n${lanUrls().map(u => 'Desde el celular: ' + u).join('\n')}\nPantalla: http://127.0.0.1:${PORT}/pantalla.html`);
  });
  const bye = () => { go2rtc.stop(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
