import { build } from 'esbuild';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const ver = JSON.parse(fs.readFileSync('version.json', 'utf8'));
fs.mkdirSync('www', { recursive: true });
await build({ entryPoints: ['src/adapter.js'], bundle: true, minify: true, format: 'iife', outfile: 'www/adapter.js', target: 'es2020', logLevel: 'error' });
let html = fs.readFileSync('src/app.html', 'utf8');
const info = `<script>window.LEGACY_VERSION=${JSON.stringify(ver.version)};window.LEGACY_BUILD=${JSON.stringify(process.env.GITHUB_RUN_NUMBER || '')};window.LEGACY_NOTES=${JSON.stringify(ver.notes || [])};window.LEGACY_REPO="ArchSocrates/Legacy-Fitness-Tracker";</script>`;
const pwa = `<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" href="icons/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Legacy">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="format-detection" content="telephone=no">
<script>if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)&&location.hostname!=='localhost'&&!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform())){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})})}</script>`;
html = html.replace('<head>', '<head>\n' + info + '\n<script src="adapter.js"></script>\n' + pwa);
fs.writeFileSync('www/index.html', html);
fs.cpSync('src/fonts', 'www/fonts', { recursive: true });
console.log('built v' + ver.version, html.length, 'bytes');

// Web app (iPhone / any browser): manifest, icons and a small offline shell
fs.writeFileSync('www/manifest.webmanifest', JSON.stringify({
  name: 'Legacy', short_name: 'Legacy', description: 'Private workout tracker', start_url: './', scope: './',
  display: 'standalone', orientation: 'any', background_color: '#0a0a0a', theme_color: '#000000',
  icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }]
}));
fs.writeFileSync('www/sw.js', `// Legacy offline shell. The page is fetched fresh when online and falls back to the saved copy offline.
const C = 'legacy-${ver.version}';
const SHELL = ['./', 'index.html', 'adapter.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'fonts/pixelify.woff2', 'fonts/num.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return; // Firebase and other sites go straight to the network
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); } return res; }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'))));
});
`);
execFileSync('node', ['scripts/icons.mjs', 'web'], { stdio: 'inherit' });
