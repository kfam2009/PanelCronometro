// Arma app.pack (todo el programa cifrado) y el argumento de arranque para node.
// Uso: node build/empaquetar.mjs <carpeta-salida> <clave>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cifrar } from '../lib/recursos.mjs';
const src = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [out, clave] = process.argv.slice(2);
const files = {};
const add = rel => { files[rel] = fs.readFileSync(path.join(src, rel)).toString('base64'); };
add('server.mjs');
for (const f of fs.readdirSync(path.join(src, 'lib'))) if (f.endsWith('.mjs')) add('lib/' + f);
for (const f of ['AbrirPantalla.ps1', 'Monitores.ps1']) add('scripts/' + f);
const walk = d => { for (const e of fs.readdirSync(path.join(src, d), { withFileTypes: true })) e.isDirectory() ? walk(d + '/' + e.name) : add(d + '/' + e.name); };
walk('public');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'app.pack'), cifrar(files, clave));
const hooks = fs.readFileSync(path.join(src, 'build/hooks.mjs')).toString('base64');
const arranque = fs.readFileSync(path.join(src, 'build/arranque.mjs'), 'utf8').replace('__HOOKS__', hooks);
fs.writeFileSync(path.join(out, 'arranque.txt'), 'data:text/javascript;base64,' + Buffer.from(arranque).toString('base64'));
console.log(Object.keys(files).length, 'archivos;', fs.statSync(path.join(out, 'app.pack')).size, 'bytes; arranque', fs.statSync(path.join(out, 'arranque.txt')).size);
