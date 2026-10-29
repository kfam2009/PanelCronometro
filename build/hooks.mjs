// Cargador de modulos del programa instalado: los .mjs salen de app.pack (cifrado), no del disco.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const mods = new Map();
export function initialize({ root, key }) {
  const buf = fs.readFileSync(path.join(root, 'app.pack'));
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(String(key)).digest(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  const pack = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  for (const [rel, b64] of Object.entries(pack)) if (rel.endsWith('.mjs')) mods.set(pathToFileURL(path.join(root, rel)).href, Buffer.from(b64, 'base64').toString('utf8'));
}
export async function resolve(spec, ctx, next) {
  if (mods.has(spec)) return { url: spec, format: 'module', shortCircuit: true };
  if (ctx.parentURL && mods.has(ctx.parentURL) && /^\.{1,2}\//.test(spec)) {
    const url = new URL(spec, ctx.parentURL).href;
    if (mods.has(url)) return { url, format: 'module', shortCircuit: true };
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (mods.has(url)) return { format: 'module', source: mods.get(url), shortCircuit: true };
  return next(url, ctx);
}
