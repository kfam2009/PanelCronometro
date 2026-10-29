// PanelCronometro - motor de resultados: llegadas en vivo de RaceResult (link del presenter).
import fs from 'node:fs/promises';
import path from 'node:path';
import { WsClient } from './wsclient.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Link del presenter: https://events.raceresult.com/presenters/?event=431907&n=NOMBRE&k=CLAVE
export function parseLink(link) {
  let u;
  try { u = new URL(String(link || '').trim().replace(/^\+/, '')); } catch { throw Error('Link inválido'); }
  const event = u.searchParams.get('event'), name = u.searchParams.get('n'), key = u.searchParams.get('k');
  if (!event || !name || !key) throw Error('Tiene que ser el link del presenter de RaceResult (con event, n y k)');
  return { event, name, key, host: u.origin };
}
export function query(p, screen = 0, index = 0) {
  return `eventid=${encodeURIComponent(p.event)}&name=${encodeURIComponent(p.name)}&key=${encodeURIComponent(p.key)}&lang=&screen=${screen}&index=${index}`;
}

// "Graciela zambrano" -> "Graciela Zambrano"; ", Nombre" -> "Nombre"; "Apellido, Nombre" -> "Nombre Apellido"
export function cleanName(s) {
  let n = String(s || '').replace(/<[^>]*>/g, '').trim().replace(/^,\s*/, '').replace(/\s*,\s*$/, '');
  const m = /^([^,]+),\s*(.+)$/.exec(n); if (m) n = `${m[2]} ${m[1]}`;
  return n.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/\s+/g, ' ');
}
const num = v => { const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10); return Number.isFinite(n) && n > 0 ? n : null; };
const txt = v => String(v ?? '').replace(/<[^>]*>/g, '').trim();

// Columnas de la lista del presenter -> campos (por etiqueta, con el orden conocido como respaldo)
const DEFAULT_LABELS = ['Rango', 'Dorsal', 'Nombre', 'Neto', 'Cat.Pos', 'Dist.', 'Tiempo'];
export function fieldMap(labels = DEFAULT_LABELS) {
  const L = labels.map(l => String(l || '').toLowerCase());
  const find = (re, not) => L.findIndex(l => re.test(l) && !(not && not.test(l)));
  const m = {
    pos: find(/rang|^pos|puesto|lugar|clasif|place/, /cat|edad|sexo|gen/),
    bib: find(/dorsal|bib|n[uú]m|nro/),
    nombre: find(/nombre|name|atleta|corredor/),
    neto: find(/neto|chip|net/),
    cat: find(/cat|edad|grupo/),
    dist: find(/dist|carrera|contest|prueba|competen/),
    tiempo: find(/tiempo|time|oficial|gun|bruto/, /neto|chip|net/),
  };
  if (m.tiempo < 0 && m.neto >= 0) m.tiempo = m.neto;
  return m;
}
// Registro del websocket / chipcheck: [pid, campo1, campo2, ...]
export function toArrival(rec, map) {
  const f = rec.slice(1), get = k => (map[k] >= 0 ? f[map[k]] : undefined);
  const tiempo = txt(get('neto')) || txt(get('tiempo'));
  return {
    pid: rec[0], bib: txt(get('bib')), nombre: cleanName(get('nombre')),
    pos: num(get('pos')), dist: txt(get('dist')) || 'General', tiempo, oficial: txt(get('tiempo')),
    cat: num(get('cat')), finished: Boolean(tiempo),
  };
}

export class Carrera {
  constructor({ dataDir, getConfig, save }) {
    this.getConfig = getConfig; this.save = save;
    this.file = path.join(dataDir, 'llegadas.json');
    this.arrivals = new Map();   // pid -> corredor (con o sin tiempo)
    this.order = [];             // pids en el orden en que llegaron en vivo
    this.feed = [];              // avisos para la pantalla: { seq, pid }
    this.seq = Date.now();       // crece siempre, aunque se reinicie el programa
    this.status = { conectado: false, error: '', ultimoMensaje: 0 };
    this.map = fieldMap(); this.listName = '';
    this.ws = null; this.gen = 0; this.scanning = false; this.checking = false;
    this.ready = this.load();
  }
  link() { const l = this.getConfig().link; return l ? parseLink(l) : null; }

  // ---- Guardado ----
  async load() {
    try {
      const d = JSON.parse(await fs.readFile(this.file, 'utf8'));
      for (const a of d.arrivals || []) this.arrivals.set(a.pid, a);
      this.order = (d.order || []).filter(p => this.arrivals.has(p));
    } catch {}
  }
  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const data = JSON.stringify({ arrivals: [...this.arrivals.values()], order: this.order });
      fs.writeFile(this.file + '.tmp', data).then(() => fs.rename(this.file + '.tmp', this.file)).catch(() => {});
    }, 300);
  }

  // ---- Conexion con RaceResult ----
  async get(route, p = this.link(), extra = '') {
    const r = await fetch(`${p.host}/api/presenter/${route}?${query(p)}${extra}`, { signal: AbortSignal.timeout(10000) });
    const t = await r.text();
    if (!r.ok) throw Error(`RaceResult ${r.status}: ${t.slice(0, 120)}`);
    try { return JSON.parse(t); } catch { return t; }
  }
  async setLink(link) {
    const clean = String(link || '').trim().replace(/^\+/, '');
    if (!clean) { this.getConfig().link = ''; await this.save(); this.disconnect(); return; }
    const p = parseLink(clean);
    await this.get('config', p).catch(e => { throw Error('RaceResult rechazó el link: ' + e.message); });
    this.getConfig().link = clean;
    await this.save();
    this.connect();
  }
  async loadFields() {
    try {
      const w = await this.get('window');
      if (Array.isArray(w?.Fields) && w.Fields.length) { this.map = fieldMap(w.Fields.map(f => f.Label)); this.listName = w.HeadLine1 || ''; }
    } catch (e) { this.status.error = e.message; }
  }
  disconnect() { this.gen++; clearInterval(this.guard); try { this.ws?.close(); } catch {} this.ws = null; this.status = { conectado: false, error: '', ultimoMensaje: 0 }; }
  connect() {
    this.disconnect();
    const gen = this.gen;
    let p; try { p = this.link(); } catch (e) { this.status.error = e.message; return; }
    if (!p) return;
    const open = async () => {
      if (gen !== this.gen) return;
      await this.loadFields();
      if (gen !== this.gen) return;
      let ws;
      try { ws = new WsClient(`${p.host.replace(/^http/, 'ws')}/api/presenter/websocket?${query(p)}`, { origin: p.host }); }
      catch (e) { this.status.error = e.message; return setTimeout(open, 3000); }
      this.ws = ws;
      ws.on('open', () => { if (gen === this.gen) this.status = { ...this.status, conectado: true, error: '' }; });
      ws.on('message', m => {
        if (gen !== this.gen) return;
        this.status.ultimoMensaje = Date.now();
        let d; try { d = JSON.parse(m); } catch { return; }
        for (const r of Array.isArray(d?.[0]) ? d : [d]) if (Array.isArray(r)) this.arrive(r, true);
      });
      ws.on('close', () => { if (gen !== this.gen) return; this.status.conectado = false; this.ws = null; setTimeout(open, 2000); });
      ws.on('error', e => { if (gen === this.gen) this.status.error = `Sin conexión con RaceResult (${e.message}), reintentando...`; });
    };
    open();
    // Respaldo: cada 20 s revisa los dorsales que todavia no llegaron (por si se corta la conexion en vivo)
    this.guard = setInterval(() => { if (gen === this.gen) this.checkPending().catch(() => {}); }, 20000);
    this.guard.unref?.();
  }
  async checkPending() {
    if (this.scanning || this.checking) return; const p = this.link(); if (!p) return;
    const pend = [...this.arrivals.values()].filter(a => !a.finished && a.bib).map(a => a.bib);
    if (!pend.length) return;
    this.checking = true;
    try {
      for (let i = 0; i < pend.length; i += 8) {
        const res = await Promise.all(pend.slice(i, i + 8).map(b => this.get('chipcheck', p, `&value=${encodeURIComponent(b)}`).catch(() => [])));
        for (const l of res) for (const x of Array.isArray(l) ? l : []) {
          const prev = this.arrivals.get(x[0]), a = toArrival(x, this.map);
          if (prev && !prev.finished && a.finished) this.arrive(x, true);
        }
      }
    } finally { this.checking = false; }
  }

  arrive(rec, live) {
    const a = { ...toArrival(rec, this.map), t: Date.now() };
    if (a.pid == null || !a.nombre) return null;
    this.arrivals.set(a.pid, a);
    if (live) {
      this.order = [...this.order.filter(p => p !== a.pid), a.pid];
      this.feed = [...this.feed, { seq: ++this.seq, pid: a.pid }].slice(-40);
    }
    this.persist();
    return a;
  }
  // Prueba: trae un dorsal como si acabara de cruzar
  async simulate(bib) {
    const p = this.link(); if (!p) throw Error('Primero cargá el link de cronometraje');
    if (!String(bib).trim()) throw Error('Escribí un dorsal');
    const list = await this.get('chipcheck', p, `&value=${encodeURIComponent(bib)}`).catch(() => []);
    if (!Array.isArray(list) || !list.length) throw Error(`Dorsal ${bib}: no está en esta carrera`);
    await this.loadFields();
    return list.map(x => this.arrive(x, true)).filter(Boolean);
  }
  // Carga todos los resultados recorriendo dorsales (para armar las tablas desde cero)
  async scan(max = 1000) {
    if (this.scanning) return; const p = this.link(); if (!p) throw Error('Primero cargá el link de cronometraje');
    this.scanning = { hechos: 0, total: max, encontrados: 0 };
    await this.loadFields();
    try {
      for (let i = 1; i <= max; i += 10) {
        const res = await Promise.all(Array.from({ length: Math.min(10, max - i + 1) }, (_, k) => this.get('chipcheck', p, `&value=${i + k}`).catch(() => [])));
        for (const l of res) for (const x of Array.isArray(l) ? l : []) if (this.arrive(x, false)) this.scanning.encontrados++;
        this.scanning.hechos = Math.min(max, i + 9);
        await sleep(60);
      }
    } finally { this.scanning = false; }
  }
  clear() { this.arrivals.clear(); this.order = []; this.feed = []; this.persist(); }

  // ---- Tablas ----
  distances() { return [...new Set([...this.arrivals.values()].map(a => a.dist))].sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) || a.localeCompare(b)); }
  table(dist) {
    return [...this.arrivals.values()].filter(a => a.finished && (!dist || a.dist === dist))
      .sort((a, b) => (a.pos ?? 1e9) - (b.pos ?? 1e9) || a.tiempo.localeCompare(b.tiempo));
  }
  recent(n = 10) { return this.order.slice(-n).reverse().map(p => this.arrivals.get(p)).filter(Boolean); }
  summary() {
    return {
      status: { ...this.status, scanning: this.scanning }, evento: this.listName,
      total: this.arrivals.size, llegaron: [...this.arrivals.values()].filter(a => a.finished).length,
      distancias: this.distances().map(d => ({ dist: d, n: this.table(d).length })), recientes: this.recent(15),
    };
  }
  screenData() {
    return {
      seq: this.seq, feed: this.feed.map(f => ({ seq: f.seq, a: this.arrivals.get(f.pid) })).filter(f => f.a),
      recientes: this.recent(7), tablas: Object.fromEntries(this.distances().map(d => [d, this.table(d)])), evento: this.listName,
    };
  }
}
