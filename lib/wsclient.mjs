// Cliente WebSocket minimo (solo recibir texto) con los encabezados de un navegador,
// para que RaceResult acepte la conexion igual que al presenter web.
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

export class WsClient extends EventEmitter {
  constructor(url, { origin, userAgent } = {}) {
    super();
    const u = new URL(url), secure = u.protocol === 'wss:';
    const key = crypto.randomBytes(16).toString('base64');
    const req = (secure ? https : http).request({
      host: u.hostname, port: u.port || (secure ? 443 : 80), path: u.pathname + u.search, method: 'GET',
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key,
        Origin: origin || `https://${u.host}`, 'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Cache-Control': 'no-cache', Pragma: 'no-cache',
      },
      timeout: 15000,
    });
    this.req = req; this.buf = Buffer.alloc(0); this.parts = []; this.closed = false;
    req.on('upgrade', (res, socket, head) => {
      const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      if (res.headers['sec-websocket-accept'] !== accept) { socket.destroy(); return this.fail('Respuesta WebSocket invalida'); }
      this.socket = socket; socket.setNoDelay(true); socket.setKeepAlive(true, 15000);
      socket.on('data', d => this.data(d));
      socket.on('close', () => this.end(1006));
      socket.on('error', e => this.fail(e.message));
      this.emit('open');
      if (head?.length) this.data(head);
    });
    req.on('response', res => { let b = ''; res.on('data', c => b += c); res.on('end', () => this.fail(`HTTP ${res.statusCode} ${b.slice(0, 120)}`)); });
    req.on('timeout', () => { req.destroy(); this.fail('Tiempo de espera agotado'); });
    req.on('error', e => this.fail(e.message));
    req.end();
  }
  fail(msg) { if (this.closed) return; this.emit('error', new Error(msg)); this.end(1006); }
  end(code) { if (this.closed) return; this.closed = true; try { this.socket?.destroy(); } catch {} this.emit('close', code); }
  close() { if (this.closed) return; try { this.send(0x8, Buffer.alloc(0)); } catch {} this.end(1000); }
  send(op, payload) { // los frames del cliente van enmascarados
    const mask = crypto.randomBytes(4), len = payload.length;
    const head = len < 126 ? Buffer.from([0x80 | op, 0x80 | len]) : Buffer.from([0x80 | op, 0x80 | 126, len >> 8, len & 255]);
    const body = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
    this.socket?.write(Buffer.concat([head, mask, body]));
  }
  data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1], fin = b0 & 0x80, op = b0 & 0x0f, masked = b1 & 0x80;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      const mk = masked ? this.buf.subarray(off, off + 4) : null; if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let p = this.buf.subarray(off, off + len); this.buf = this.buf.subarray(off + len);
      if (mk) p = Buffer.from(p.map((b, i) => b ^ mk[i % 4]));
      if (op === 0x9) { this.send(0xA, p); continue; }           // ping -> pong
      if (op === 0x8) { this.end(p.length >= 2 ? p.readUInt16BE(0) : 1000); return; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.parts.push(p);
        if (fin) { const msg = Buffer.concat(this.parts).toString('utf8'); this.parts = []; this.emit('message', msg); }
      }
    }
  }
}
