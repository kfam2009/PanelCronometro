import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = process.env.PC_ROOT;
register('data:text/javascript;base64,__HOOKS__', { data: { root, key: process.env.PC_KEY } });
process.env.PC_START = '1';
await import(pathToFileURL(path.join(root, 'server.mjs')).href);
