// PanelCronometro - archivos del programa (pagina, scripts). Instalado: vienen cifrados en app.pack (no hay codigo a la vista).
// En desarrollo (sin PC_KEY) se leen de la carpeta.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function descifrar(buf, clave) {
  const key = crypto.createHash('sha256').update(String(clave)).digest();
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
}
export function cifrar(obj, clave) {
  const key = crypto.createHash('sha256').update(String(clave)).digest(), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

const clave = process.env.PC_KEY;
delete process.env.PC_KEY; // que no la hereden go2rtc ni PowerShell
let pack = null;
if (clave) pack = descifrar(fs.readFileSync(path.join(process.env.PC_ROOT, 'app.pack')), clave);
export const empaquetado = Boolean(pack);

// rel: ruta con '/' relativa a la carpeta del programa (ej. 'public/index.html'). Devuelve Buffer o null.
export function leer(root, rel) {
  const r = path.posix.normalize(String(rel).replace(/\\/g, '/')).replace(/^\/+/, '');
  if (r.startsWith('..')) return null;
  if (pack) return r in pack ? Buffer.from(pack[r], 'base64') : null;
  try { return fs.readFileSync(path.join(root, r)); } catch { return null; }
}
