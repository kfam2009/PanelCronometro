import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLink, cleanName, fieldMap, toArrival, Carrera } from '../lib/carrera.mjs';
import { go2rtcConfig, streamName } from '../lib/camaras.mjs';
import { fakeRaceResult, CORREDORES } from './fake-raceresult.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw Error('tiempo agotado'); await wait(50); } };

test('Lee el link del presenter (también con + adelante)', () => {
  const L = 'https://events.raceresult.com/presenters/?event=431907&n=LLEGAS%20TRAIL&k=Jn7C';
  assert.deepEqual(parseLink('+' + L), { event: '431907', name: 'LLEGAS TRAIL', key: 'Jn7C', host: 'https://events.raceresult.com' });
  assert.throws(() => parseLink('https://events.raceresult.com/431907'));
});
test('Nombres prolijos', () => {
  assert.equal(cleanName(', Graciela zambrano'), 'Graciela Zambrano');
  assert.equal(cleanName('PEREZ, juan martin'), 'Juan Martin Perez');
});
test('Registro de RaceResult -> llegada', () => {
  const m = fieldMap();
  const a = toArrival(CORREDORES[0], m);
  assert.equal(a.pos, 6); assert.equal(a.bib, '1'); assert.equal(a.tiempo, '41:30'); assert.equal(a.cat, 2); assert.equal(a.dist, '6 KM'); assert.equal(a.finished, true);
  const b = toArrival(CORREDORES[2], m);
  assert.equal(b.finished, false); assert.equal(b.pos, null);
});
test('Config de go2rtc: solo cámaras IP, nombres seguros', () => {
  const c = go2rtcConfig([{ id: 'ab12', tipo: 'ip', url: ' rtsp://x/1 ' }, { id: 'cd34', tipo: 'usb', usb: 'Cam' }], 1999);
  assert.deepEqual(c.streams, { cam_ab12: 'rtsp://x/1' });
  assert.equal(c.api.listen, '127.0.0.1:1999');
  assert.equal(streamName('a/b..c'), 'cam_abc');
});

test('Circuito completo con un RaceResult de prueba: link, en vivo, simular, cargar todos, tablas y guardado', async () => {
  const rr = fakeRaceResult(); await new Promise(r => rr.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
  const config = { link: '' };
  const C = new Carrera({ dataDir: dir, getConfig: () => config, save: async () => {} });
  try {
    await C.ready;
    await assert.rejects(C.setLink(`http://127.0.0.1:${rr.address().port}/presenters/?event=1&n=X&k=MAL`), /rechazó/);
    await C.setLink(`http://127.0.0.1:${rr.address().port}/presenters/?event=1&n=X&k=CLAVE`);
    await until(() => C.status.conectado && rr.conectados() > 0);
    assert.equal(C.listName, 'CARRERA DE PRUEBA');
    // cruce en vivo por el websocket
    rr.cruza(CORREDORES[3]);
    await until(() => C.recent().length === 1);
    assert.equal(C.recent()[0].nombre, 'Luciano Galvan');
    const seq1 = C.screenData().seq;
    // simular un dorsal
    await C.simulate('1');
    assert.equal(C.screenData().seq, seq1 + 1);
    await assert.rejects(C.simulate('999'), /no está/);
    // cargar todos
    await C.scan(300);
    assert.equal(C.summary().total, 4); assert.equal(C.summary().llegaron, 3);
    assert.deepEqual(C.distances(), ['6 KM', '16 KM']);
    assert.deepEqual(C.table('6 KM').map(a => a.pos), [6, 19]);
    // queda guardado
    await wait(400);
    const C2 = new Carrera({ dataDir: dir, getConfig: () => config, save: async () => {} });
    await C2.ready; assert.equal(C2.arrivals.size, 4); assert.equal(C2.recent()[0].bib, '1');
    C2.disconnect();
  } finally { C.disconnect(); rr.close(); clearTimeout(C.saveTimer); }
});
