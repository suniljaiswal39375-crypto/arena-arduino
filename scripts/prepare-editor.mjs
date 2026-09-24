import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const dest = fileURLToPath(new URL('public/vendor/monaco/vs', root));
mkdirSync(dest, { recursive: true });
cpSync(fileURLToPath(new URL('node_modules/monaco-editor/min/vs', root)), dest, { recursive: true });
console.log('Prepared same-origin Monaco assets.');
