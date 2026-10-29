// PanelCronometro - camaras IP por go2rtc (RTSP/SRT/HTTP -> video en el navegador, sin recodificar).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { WsClient } from './wsclient.mjs';

export const GO2RTC_PORT = Number(process.env.GO2RTC_PORT || 1985);

// Nombre seguro para go2rtc a partir del id de la camara
export const streamName = id => 'cam_' + String(id).replace(/[^a-z0-9_-]/gi, '');

// Modo compatible: ffmpeg recibe la camara y le pasa a go2rtc el mismo video (sin recodificar) con los tiempos
// en orden. Hace falta con camaras como algunas Foscam, donde go2rtc solo deja pasar los cuadros completos.
export function go2rtcConfig(camaras, port = GO2RTC_PORT, ffmpeg = null) {
  const streams = {};
  for (const c of camaras) {
    if (c.tipo !== 'ip' || !c.url) continue;
    const url = String(c.url).trim();
    streams[streamName(c.id)] = c.compat && ffmpeg ? `ffmpeg:${url}#video=copy` : url;
  }
  // rtsp: canal interno por donde el modo compatible (ffmpeg) le entrega el video a go2rtc; solo esta PC
  const cfg = { api: { listen: `127.0.0.1:${port}`, origin: '*' }, rtsp: { listen: `127.0.0.1:${port + 16570}` }, webrtc: { listen: '' }, srtp: { listen: '' }, log: { level: 'info' }, streams };
  if (ffmpeg) cfg.ffmpeg = { bin: ffmpeg };
  return cfg;
}

export class Go2rtc {
  constructor({ root, logFile = null }) {
    this.logFile = logFile;
    this.exe = [process.env.GO2RTC_PATH, path.join(root, 'tools', 'go2rtc.exe'), path.join(root, 'tools', 'go2rtc')].find(p => p && fs.existsSync(p)) || null;
    // ffmpeg para el modo compatible: el de esta carpeta, o el del panel de domos si esta al lado
    this.ffmpeg = [process.env.FFMPEG_PATH, path.join(root, 'tools', 'ffmpeg.exe'), path.join(path.dirname(root), 'panelgo-ptz', 'tools', 'ffmpeg.exe')].find(p => p && fs.existsSync(p)) || null;
    this.proc = null; this.lastConfig = ''; this.error = '';
  }
  state() { return { instalado: Boolean(this.exe), corriendo: Boolean(this.proc), error: this.error, ffmpeg: Boolean(this.ffmpeg) }; }
  apply(camaras) {
    const cfg = JSON.stringify(go2rtcConfig(camaras, GO2RTC_PORT, this.ffmpeg));
    if (cfg === this.lastConfig && this.proc) return;
    this.lastConfig = cfg;
    this.stop();
    if (!this.exe) { this.error = 'Falta tools/go2rtc.exe: las cámaras IP no se van a ver'; return; }
    if (!camaras.some(c => c.tipo === 'ip' && c.url)) { this.error = ''; return; }
    // el registro de go2rtc queda en data/go2rtc.log para ver problemas de camaras
    const log = this.logFile ? fs.openSync(this.logFile, 'a') : 'ignore';
    const p = spawn(this.exe, ['-config', cfg], { windowsHide: true, stdio: ['ignore', log, log] });
    if (typeof log === 'number') fs.closeSync(log);
    this.proc = p; this.error = '';
    p.on('error', e => { this.error = 'No se pudo iniciar go2rtc: ' + e.message; this.proc = null; });
    p.on('exit', () => { if (this.proc === p) { this.proc = null; setTimeout(() => { if (!this.proc && this.lastConfig === cfg) { this.lastConfig = ''; this.apply(camaras); } }, 3000); } });
  }
  stop() { const p = this.proc; this.proc = null; try { p?.kill(); } catch {} }

  // Prueba una camara pidiendole el video a go2rtc (una sola conexion) y contesta:
  // 'ok' | 'clave' (usuario/clave incorrectos: NO reintentar, la camara se bloquea) | 'red' (no responde)
  probe(id, timeout = 9000) {
    return new Promise(resolve => {
      if (!this.proc) return resolve({ estado: 'red', error: 'go2rtc no está corriendo' });
      let done = false, ws;
      const end = r => { if (done) return; done = true; clearTimeout(t); try { ws?.close(); } catch {} resolve(r); };
      const t = setTimeout(() => end({ estado: 'red', error: 'La cámara no responde' }), timeout);
      try { ws = new WsClient(`ws://127.0.0.1:${GO2RTC_PORT}/api/ws?src=${encodeURIComponent(streamName(id))}`, { origin: `http://127.0.0.1:${GO2RTC_PORT}` }); }
      catch (e) { return end({ estado: 'red', error: e.message }); }
      ws.on('open', () => ws.send(0x1, Buffer.from(JSON.stringify({ type: 'mse', value: 'avc1.640029,avc1.64002A,avc1.640033,hvc1.1.6.L153.B0,mp4a.40.2,flac,opus' }))));
      ws.on('message', m => {
        let d; try { d = JSON.parse(m); } catch { return; }
        if (d.type === 'error') end(clasificar(d.value));
        else if (d.type === 'mse') end({ estado: 'ok', error: '' });
      });
      ws.on('error', e => end({ estado: 'red', error: e.message }));
    });
  }

  // /go2rtc/... se reenvia a go2rtc (asi la pantalla usa el mismo origen y go2rtc queda solo en esta PC)
  proxy(req, res, rest) {
    const r = http.request({ host: '127.0.0.1', port: GO2RTC_PORT, path: rest, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${GO2RTC_PORT}` } }, up => {
      res.writeHead(up.statusCode || 502, up.headers); up.pipe(res);
    });
    r.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('go2rtc no responde'); });
    req.pipe(r);
  }
  upgrade(req, socket, head, rest) {
    const up = net.connect(GO2RTC_PORT, '127.0.0.1', () => {
      // go2rtc rechaza websockets de otro origen: se presenta como si viniera de el mismo
      const h = { ...req.headers, host: `127.0.0.1:${GO2RTC_PORT}` }; delete h.origin;
      const headers = Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      up.write(`${req.method} ${rest} HTTP/1.1\r\n${headers}\r\n\r\n`);
      if (head?.length) up.write(head);
      // video en vivo: sin demora de Nagle (si no, los paquetes chicos se traban y la imagen se congela)
      up.setNoDelay(true); socket.setNoDelay(true);
      up.pipe(socket); socket.pipe(up);
    });
    const close = () => { up.destroy(); socket.destroy(); };
    up.on('error', close); socket.on('error', close);
  }
}

// Errores de go2rtc: la clave mal se distingue para no insistir (las Foscam y otras bloquean la PC entera)
export function clasificar(msg) {
  const m = String(msg || '');
  if (/user\/pass|401|unauthori[sz]ed|forbidden|403|wrong.*(user|pass)|auth/i.test(m)) return { estado: 'clave', error: 'Usuario o clave incorrectos' };
  return { estado: 'red', error: m.replace(/^.*?:\s*/, '') || 'La cámara no responde' };
}
