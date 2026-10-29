// PanelCronometro - camaras IP por go2rtc (RTSP/SRT/HTTP -> video en el navegador, sin recodificar).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';

export const GO2RTC_PORT = Number(process.env.GO2RTC_PORT || 1985);

// Nombre seguro para go2rtc a partir del id de la camara
export const streamName = id => 'cam_' + String(id).replace(/[^a-z0-9_-]/gi, '');

export function go2rtcConfig(camaras, port = GO2RTC_PORT) {
  const streams = {};
  for (const c of camaras) if (c.tipo === 'ip' && c.url) streams[streamName(c.id)] = String(c.url).trim();
  return { api: { listen: `127.0.0.1:${port}` }, rtsp: { listen: '' }, webrtc: { listen: '' }, srtp: { listen: '' }, log: { level: 'error' }, streams };
}

export class Go2rtc {
  constructor({ root }) {
    this.exe = [process.env.GO2RTC_PATH, path.join(root, 'tools', 'go2rtc.exe'), path.join(root, 'tools', 'go2rtc')].find(p => p && fs.existsSync(p)) || null;
    this.proc = null; this.lastConfig = ''; this.error = '';
  }
  state() { return { instalado: Boolean(this.exe), corriendo: Boolean(this.proc), error: this.error }; }
  apply(camaras) {
    const cfg = JSON.stringify(go2rtcConfig(camaras));
    if (cfg === this.lastConfig && this.proc) return;
    this.lastConfig = cfg;
    this.stop();
    if (!this.exe) { this.error = 'Falta tools/go2rtc.exe: las cámaras IP no se van a ver'; return; }
    if (!camaras.some(c => c.tipo === 'ip' && c.url)) { this.error = ''; return; }
    const p = spawn(this.exe, ['-config', cfg], { windowsHide: true, stdio: 'ignore' });
    this.proc = p; this.error = '';
    p.on('error', e => { this.error = 'No se pudo iniciar go2rtc: ' + e.message; this.proc = null; });
    p.on('exit', () => { if (this.proc === p) { this.proc = null; setTimeout(() => { if (!this.proc && this.lastConfig === cfg) { this.lastConfig = ''; this.apply(camaras); } }, 3000); } });
  }
  stop() { const p = this.proc; this.proc = null; try { p?.kill(); } catch {} }

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
      const headers = Object.entries({ ...req.headers, host: `127.0.0.1:${GO2RTC_PORT}` }).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      up.write(`${req.method} ${rest} HTTP/1.1\r\n${headers}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket); socket.pipe(up);
    });
    const close = () => { up.destroy(); socket.destroy(); };
    up.on('error', close); socket.on('error', close);
  }
}
