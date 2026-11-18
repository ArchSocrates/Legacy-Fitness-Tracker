import { build } from 'esbuild';
import fs from 'node:fs';
fs.mkdirSync('www', { recursive: true });
await build({ entryPoints: ['src/adapter.js'], bundle: true, minify: true, format: 'iife', outfile: 'www/adapter.js', target: 'es2020', logLevel: 'error' });
let html = fs.readFileSync('src/app.html', 'utf8');
html = html.replace('<head>', '<head>\n<script src="adapter.js"></script>');
fs.writeFileSync('www/index.html', html);
console.log('built www/', html.length, 'bytes');
