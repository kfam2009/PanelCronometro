// RaceResult de prueba: presenter (config, window, chipcheck) + websocket de llegadas
import http from 'node:http';
import crypto from 'node:crypto';

export const CORREDORES = [
  [1, '6.', 1, ', Dangelo Ríos Andrea de los angeles', '41:30', 2, '6 KM', '41:33'],
  [2, '19.', 2, ', Graciela zambrano', '1:32:53', 8, '6 KM', '1:33:03'],
  [10, '', 10, ', Veronica Aguila', '', -1, '6 KM', ''],
  [253, '1.', 253, ', Luciano Galvan', '1:13:05', 1, '16 KM', '1:13:08'],
];

export function fakeRaceResult() {
  const sockets = new Set();
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.searchParams.get('key') !== 'CLAVE') { res.writeHead(403); return res.end('bad key'); }
    const send = v => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (u.pathname === '/api/presenter/config') return send({ Name: 'LLEGADAS' });
    if (u.pathname === '/api/presenter/window') return send({ HeadLine1: 'CARRERA DE PRUEBA', Fields: ['Rango', 'Dorsal', 'Nombre', 'Neto', 'Cat.Pos', 'Dist.', 'Tiempo'].map(Label => ({ Label })) });
    if (u.pathname === '/api/presenter/chipcheck') return send(CORREDORES.filter(c => String(c[2]) === u.searchParams.get('value')));
    res.writeHead(404); res.end();
  });
  srv.on('upgrade', (req, socket) => {
    const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
  });
  // Manda un cruce por el websocket (texto, sin mascara, como un servidor)
  srv.cruza = rec => {
    const msg = Buffer.from(JSON.stringify(rec));
    const head = msg.length < 126 ? Buffer.from([0x81, msg.length]) : Buffer.from([0x81, 126, msg.length >> 8, msg.length & 255]);
    for (const s of sockets) s.write(Buffer.concat([head, msg]));
  };
  srv.conectados = () => sockets.size;
  return srv;
}
