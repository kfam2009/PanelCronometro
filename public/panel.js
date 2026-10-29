// PanelCronometro - panel de configuracion (PC o celular)
const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
let st = null, busy = false, camDraft = null, usbList = [];
const sigs = {};
// Solo se redibuja lo que cambio: si se rearman los botones mientras se hace clic, el clic se pierde
const changed = (k, v) => { const s = JSON.stringify(v); if (sigs[k] === s) return false; sigs[k] = s; return true; };

function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 4500); }
async function api(route, data) {
  const r = await fetch('/api/' + route, { ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : { cache: 'no-store' }), signal: AbortSignal.timeout(data ? 25000 : 8000) });
  const j = await r.json(); if (!r.ok) throw Error(j.error || 'No se pudo completar'); return j;
}
async function act(route, data, msg) {
  if (busy) return; busy = true;
  try { st = await api(route, data || {}); render(); if (msg) toast(msg); }
  catch (e) { toast(e.name === 'TimeoutError' ? 'El programa no respondió, probá de nuevo' : e.message); }
  finally { busy = false; }
}
const ago = t => { if (!t) return 'sin datos todavía'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`; };
const focused = id => document.activeElement === $(id);

function render() {
  if (!st) return;
  const S = st.status, C = st.config;
  $('#ver').textContent = 'PanelCronometro ' + st.version;
  // Cronometraje
  if (!focused('#link') && changed('link', C.link)) $('#link').value = C.link || '';
  $('#conn').textContent = !C.link ? 'SIN LINK' : S.conectado ? 'CONECTADO' : 'RECONECTANDO';
  $('#conn').className = 'pill' + (S.conectado ? ' ok' : C.link ? ' warn' : '');
  $('#info').textContent = [S.error, st.evento, C.link && S.conectado && `último dato ${ago(S.ultimoMensaje)}`, `${st.llegaron} con tiempo de ${st.total} corredores`,
    S.scanning && `Cargando dorsales ${S.scanning.hechos}/${S.scanning.total} (${S.scanning.encontrados} encontrados)`].filter(Boolean).join(' · ');
  // Pantalla
  if (changed('area', [st.areas, C.area, C.custom])) {
    $('#area').replaceChildren(...Object.entries(st.areas).map(([k, v]) => new Option(v, k))); $('#area').value = C.area;
    $('#custom').hidden = C.area !== 'custom';
    for (const k of ['x', 'y', 'w', 'h']) $('#c' + k).value = C.custom[k];
  }
  if (!focused('#seg') && changed('seg', C.segundos)) $('#seg').value = C.segundos;
  if (!focused('#color') && changed('color', C.color)) $('#color').value = C.color;
  // Camaras
  const g = st.go2rtc;
  $('#g2r').textContent = g.error ? 'CÁMARAS IP: ' + (g.instalado ? 'ERROR' : 'FALTA go2rtc') : g.corriendo ? 'CÁMARAS IP LISTAS' : 'SIN CÁMARAS IP';
  $('#g2r').className = 'pill' + (g.error ? ' bad' : g.corriendo ? ' ok' : '');
  $('#g2r').title = g.error || '';
  if (changed('camSel', [C.camaras.map(c => [c.id, c.nombre]), C.camara]) && !focused('#camSel')) {
    $('#camSel').replaceChildren(new Option('Sin cámara (solo resultados)', ''), ...C.camaras.map(c => new Option(c.nombre, c.id)), ...(C.camaras.length > 1 ? [new Option('Rotar entre todas', 'rotar')] : []));
    $('#camSel').value = C.camara || '';
  }
  $('#rotWrap').hidden = C.camara !== 'rotar';
  if (!focused('#rotSeg') && changed('rot', C.rotarSeg)) $('#rotSeg').value = C.rotarSeg;
  if (!camDraft && changed('cams', [C.camaras, st.camaraActual, st.camEstado])) drawCams(C.camaras, st.camaraActual);
  // Logos
  if (changed('logos', C.logos)) {
    $('#logos').replaceChildren(...C.logos.map(l => {
      const d = el('div', 'logo' + (l.activo ? ' on' : '')); d.title = l.activo ? 'Prendido: tocá para apagarlo' : 'Apagado: tocá para prenderlo';
      const img = el('img'); img.src = l.archivo; img.alt = '';
      d.append(img, el('span', '', l.nombre));
      d.onclick = () => act('logos', { logos: C.logos.map(x => x.id === l.id ? { ...x, activo: !x.activo } : x) });
      if (!l.fijo) { const x = el('button', 'x', '×'); x.title = 'Borrar'; x.onclick = e => { e.stopPropagation(); if (confirm(`¿Borrar "${l.nombre}"?`)) act('logos', { logos: C.logos.filter(y => y.id !== l.id) }, 'Imagen borrada'); }; d.append(x); }
      return d;
    }));
  }
  // Video y YouTube
  const aire = C.alAire && C.medios.find(m => m.id === C.alAire.id);
  $('#aire').textContent = aire ? 'AL AIRE: ' + aire.nombre : 'RESULTADOS';
  $('#aire').className = 'pill' + (aire ? ' live' : ' ok');
  $('#volver').hidden = !aire;
  if (!focused('#ajuste') && changed('ajuste', C.ajuste)) $('#ajuste').value = C.ajuste;
  if (changed('sonido', C.sonido)) $('#sonido').checked = C.sonido;
  if (changed('medios', [C.medios, C.alAire?.id])) {
    $('#medios').replaceChildren(...(C.medios.length ? C.medios.map(m => {
      const r = el('div', 'med' + (aire?.id === m.id ? ' on' : ''));
      const tag = el('span', 'pill', m.tipo === 'youtube' ? 'YOUTUBE' : 'VIDEO');
      let rep = el('span');
      if (m.tipo === 'video') {
        rep = el('label', 'chk'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = Boolean(m.repetir);
        cb.onchange = () => act('medios', { medios: C.medios.map(x => x.id === m.id ? { ...x, repetir: cb.checked } : x) });
        rep.title = 'Sin tildar: al terminar vuelve solo a los resultados'; rep.append(cb, document.createTextNode('repetir'));
      }
      const go = el('button', 'btn mini ' + (aire?.id === m.id ? '' : 'go'), aire?.id === m.id ? 'DE NUEVO' : 'AL AIRE');
      go.title = 'Mostrarlo a pantalla completa'; go.onclick = () => act('aire', { id: m.id }, 'Al aire: ' + m.nombre);
      const x = el('button', 'btn del mini', '×'); x.title = 'Borrar';
      x.onclick = () => { if (confirm(`¿Borrar "${m.nombre}"?`)) act('medios', { medios: C.medios.filter(y => y.id !== m.id) }, 'Borrado'); };
      r.append(tag, el('span', 'n', m.nombre), rep, go, x);
      return r;
    }) : [el('p', 'muted', 'Subí un video o pegá un link de YouTube. AL AIRE lo muestra a pantalla completa; mientras tanto las llegadas esperan y salen después.')]));
  }
  // Llegadas
  if (changed('list', st.recientes.map(a => [a.pid, a.t]))) {
    $('#list').replaceChildren(...(st.recientes.length ? st.recientes.map(a => {
      const r = el('div', 'it');
      r.append(el('b', '', a.pos ? a.pos + '°' : '-'), el('span', 'n', a.nombre), el('span', 'm', `#${a.bib} · ${a.dist}${a.cat ? ' · Cat. ' + a.cat + '°' : ''}`), el('b', 't', a.tiempo || '--'));
      return r;
    }) : [el('p', 'muted', 'Todavía no llegó nadie. Para probar: escribí un dorsal y tocá SIMULAR LLEGADA.')]));
  }
  if (changed('urls', st.urls)) $('#urls').textContent = st.urls.length ? 'Desde el celular: ' + st.urls.filter(u => u.includes('192.168.') || u.includes('10.')).concat(st.urls).slice(0, 1).join('') : '';
}

// ---- Camaras (se editan en borrador y se guardan juntas) ----
function drawCams(list, actual) {
  const box = $('#cams'); box.replaceChildren();
  if (!list.length) box.append(el('p', 'muted', 'No hay cámaras. Agregá una IP o una USB/capturadora.'));
  list.forEach((c, i) => {
    const row = el('div', 'cam' + (actual === c.id ? ' on' : ''));
    const name = el('input'); name.value = c.nombre; name.placeholder = 'Nombre'; name.oninput = () => edit(i, { nombre: name.value });
    const tipo = el('span', 'pill', c.tipo === 'usb' ? 'USB' : 'IP');
    let src;
    if (c.tipo === 'usb') {
      src = el('select');
      const opts = [...new Set([...usbList, c.usb].filter(Boolean))];
      src.replaceChildren(new Option(opts.length ? 'Elegí el dispositivo' : 'Tocá acá para buscar dispositivos', ''), ...opts.map(o => new Option(o, o)));
      src.value = c.usb || ''; src.onfocus = loadUsb; src.onchange = () => edit(i, { usb: src.value });
    } else { src = el('input'); src.value = c.url; src.placeholder = 'rtsp://usuario:clave@IP:554/...'; src.oninput = () => edit(i, { url: src.value }); }
    // Modo compatible (ffmpeg): para camaras que en la pantalla se ven a los saltos
    let comp = null;
    if (c.tipo === 'ip') {
      comp = el('label', 'chk'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = Boolean(c.compat);
      cb.onchange = () => { edit(i, { compat: cb.checked }); }; comp.title = 'Si la imagen se ve a los saltos o congelada (algunas Foscam). Necesita ffmpeg.';
      comp.append(cb, document.createTextNode('compatible'));
    }
    const del = el('button', 'btn del mini', 'QUITAR'); del.onclick = () => { camDraft = (camDraft || structuredClone(list)).filter((_, j) => j !== i); dirty(); };
    row.append(name, tipo, src, ...(comp ? [comp] : []), del);
    // Estado de la camara (solo las ya guardadas)
    const e = !camDraft && c.id && st.camEstado?.[c.id];
    if (e && c.tipo === 'ip' && (actual === c.id || e.estado !== 'probando')) {
      const txt = { ok: '● Con señal', clave: '● Usuario o clave incorrectos: no se vuelve a intentar para que la cámara no se bloquee. Corregí la dirección y guardá.', red: '● ' + (e.error || 'No responde') + ' (se reintenta cada 20 s)', probando: '● Probando...' }[e.estado] || '';
      const stl = el('div', 'st ' + (e.estado === 'ok' ? 'ok' : e.estado === 'probando' ? '' : 'bad'), txt);
      if (e.estado === 'clave' || e.estado === 'red') { const re = el('button', 'btn mini', 'REINTENTAR'); re.style.marginLeft = '8px'; re.onclick = () => act('camaras/reintentar', { id: c.id }, 'Probando la cámara de nuevo'); stl.append(re); }
      row.append(stl);
    }
    box.append(row);
  });
}
function edit(i, patch) { camDraft ||= structuredClone(st.config.camaras); Object.assign(camDraft[i], patch); $('#saveCams').hidden = false; }
function dirty() { $('#saveCams').hidden = false; drawCams(camDraft, st.camaraActual); }
new ResizeObserver(() => fitPreview()).observe(document.querySelector('.prev'));
async function loadUsb() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach(t => t.stop());
    usbList = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput').map(d => d.label).filter(Boolean);
    if (camDraft) drawCams(camDraft, st.camaraActual);
  } catch { toast('Las cámaras USB se eligen desde la PC donde están conectadas'); }
}

async function poll() {
  if (!busy) { try { st = await api('estado'); render(); } catch { $('#conn').textContent = 'SIN PROGRAMA'; $('#conn').className = 'pill bad'; } }
  setTimeout(poll, 1500);
}
function fitPreview() { const p = $('.prev'); $('#preview').style.transform = `scale(${Math.min(p.clientWidth / 1920, p.clientHeight / 640)})`; }
addEventListener('resize', fitPreview);

$('#saveLink').onclick = () => act('link', { link: $('#link').value }, 'Link guardado, conectando...');
$('#link').onkeydown = e => { if (e.key === 'Enter') $('#saveLink').click(); };
$('#open').onclick = () => act('abrir-pantalla', {}, 'Abriendo la pantalla en el segundo monitor');
$('#area').onchange = () => act('config', { area: $('#area').value });
$('#applyCustom').onclick = () => act('config', { area: 'custom', custom: Object.fromEntries(['x', 'y', 'w', 'h'].map(k => [k, Number($('#c' + k).value)])) }, 'Área aplicada');
$('#seg').onchange = () => act('config', { segundos: Number($('#seg').value) });
$('#color').onchange = () => act('config', { color: $('#color').value });
$('#camSel').onchange = () => act('config', { camara: $('#camSel').value }, 'Cámara de la pantalla cambiada');
$('#rotSeg').onchange = () => act('config', { rotarSeg: Number($('#rotSeg').value) });
$('#addIp').onclick = () => { camDraft = [...(camDraft || structuredClone(st.config.camaras)), { nombre: 'Cámara ' + ((camDraft || st.config.camaras).length + 1), tipo: 'ip', url: '' }]; dirty(); };
$('#addUsb').onclick = () => { camDraft = [...(camDraft || structuredClone(st.config.camaras)), { nombre: 'USB ' + ((camDraft || st.config.camaras).length + 1), tipo: 'usb', usb: '' }]; dirty(); loadUsb(); };
$('#saveCams').onclick = async () => {
  const d = camDraft; camDraft = null; $('#saveCams').hidden = true; sigs.camSel = '';
  await act('camaras', { camaras: d }, 'Cámaras guardadas');
};
$('#file').onchange = async () => {
  for (const f of $('#file').files) {
    if (f.size > 8 * 1024 * 1024) { toast(`${f.name}: muy grande (máximo 8 MB)`); continue; }
    const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(f); });
    await act('logos/subir', { nombre: f.name.replace(/\.[^.]+$/, ''), data }, 'Imagen agregada');
  }
  $('#file').value = '';
};
$('#volver').onclick = () => act('aire', { id: '' }, 'Volviendo a los resultados');
$('#ajuste').onchange = () => act('config', { ajuste: $('#ajuste').value });
$('#sonido').onchange = () => act('config', { sonido: $('#sonido').checked });
$('#addYt').onclick = async () => { const n = st.config.medios.length; await act('medios/youtube', { url: $('#yt').value }, 'YouTube agregado'); if (st.config.medios.length > n) $('#yt').value = ''; };
$('#yt').onkeydown = e => { if (e.key === 'Enter') $('#addYt').click(); };
// El video se manda tal cual (puede pesar mucho), mostrando el avance
$('#vfile').onchange = () => {
  const f = $('#vfile').files[0]; $('#vfile').value = '';
  if (!f) return;
  const ext = (f.name.split('.').pop() || '').toLowerCase(), info = $('#subiendo');
  const x = new XMLHttpRequest();
  x.open('POST', `/api/medios/subir?ext=${encodeURIComponent(ext)}&nombre=${encodeURIComponent(f.name.replace(/\.[^.]+$/, ''))}`);
  x.upload.onprogress = e => { if (e.lengthComputable) info.textContent = `Subiendo ${f.name}: ${Math.round(e.loaded / e.total * 100)}%`; };
  x.onload = () => {
    info.hidden = true;
    let j = {}; try { j = JSON.parse(x.responseText); } catch {}
    if (x.status === 200) { st = j; render(); toast('Video agregado'); } else toast(j.error || 'No se pudo subir el video');
  };
  x.onerror = () => { info.hidden = true; toast('Se cortó la subida del video'); };
  info.textContent = `Subiendo ${f.name}...`; info.hidden = false;
  x.send(f);
};
$('#sim').onclick = () => act('simular', { bib: $('#bib').value.trim() }, 'Llegada simulada: dorsal ' + $('#bib').value.trim());
$('#bib').onkeydown = e => { if (e.key === 'Enter') $('#sim').click(); };
$('#scan').onclick = () => act('cargar', { max: 1000 }, 'Cargando todos los dorsales (tarda un minuto)');
$('#clear').onclick = () => { if (confirm('¿Borrar todas las llegadas guardadas? (para empezar un evento nuevo)')) act('borrar', {}, 'Llegadas borradas'); };

fitPreview(); poll();
