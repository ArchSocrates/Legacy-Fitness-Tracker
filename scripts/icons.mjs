// Draws the Legacy mountain mark in black and white only (two-tone dither).
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const color = '#000000';
const res = process.argv[2] || 'android/app/src/main/res';
const OUT = process.argv[3] === 'preview';
// Dithered pixel mountain, drawn on a small grid and scaled up with hard edges.
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const BAY = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map(r => r.map(v => (v + 0.5) / 16));
const bg = hex(color), cream = hex('#ffffff');
const PTS = [[2, 26], [11, 8], [16.5, 17], [21, 10], [30, 26]];
const inPoly = (x, y) => { let c = false; for (let i = 0, j = PTS.length - 1; i < PTS.length; j = i++) { const [xi, yi] = PTS[i], [xj, yj] = PTS[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
// returns raw RGBA of an N x N grid; sky=false leaves outside transparent
function grid(N, frac, sky, mt = true) {
  const buf = Buffer.alloc(N * N * 4), k = (frac * N) / 28, ox = N / 2 - 16 * k, oy = N / 2 - 17 * k;
  const dark = mixc(bg, [0, 0, 0], 0.45), mid = mixc(bg, cream, 0.35), light = mixc(bg, cream, 0.72);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4, u = (x + 0.5 - ox) / k, v = (y + 0.5 - oy) / k, th = BAY[y % 4][x % 4];
    let c = null;
    if (mt && inPoly(u, v)) {
      const top = Math.min(1, Math.max(0, (v - 8) / 18)), side = u < 16.5 ? 0.18 : -0.1; // left faces the light
      const t = 1 - top * 0.85 + side;               // brighter near the peaks
      c = Math.min(0.9999, Math.max(0, t)) > th ? cream : bg; // two tones only: white dots on black
      if (!inPoly(u, v - 1.4)) c = cream; // bright rim along the top edge
    } else if (sky) {
      c = bg;
      const sx = (N * 0.74), sy = (N * 0.24), d = Math.hypot(x - sx, y - sy); if (d < N * 0.07) c = cream; // sun
    }
    if (c) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255; }
  }
  return buf;
}
const px = (N, frac, sky, size, circle) => {
  let img = sharp(grid(N, frac, sky), { raw: { width: N, height: N, channels: 4 } }).resize(size, size, { kernel: 'nearest' });
  if (!circle && sky === 'round') return img;
  return img;
};
const mask = (S, round) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${round ? `<circle cx="${S / 2}" cy="${S / 2}" r="${S / 2}"/>` : `<rect width="${S}" height="${S}" rx="${Math.round(S * 0.22)}"/>`}</svg>`);
const masked = async (N, frac, S, round) => sharp(await px(N, frac, true, S).png().toBuffer()).composite([{ input: mask(S, round), blend: 'dest-in' }]).png();
const dens = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };
for (const [d, [L, F]] of Object.entries(dens)) {
  const dir = path.join(res, 'mipmap-' + d);
  fs.mkdirSync(dir, { recursive: true });
  await (await masked(48, 0.78, L, false)).toFile(path.join(dir, 'ic_launcher.png'));
  await (await masked(48, 0.74, L, true)).toFile(path.join(dir, 'ic_launcher_round.png'));
  await px(54, 0.5, false, F).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
  await sharp(grid(54, 0.5, true, false), { raw: { width: 54, height: 54, channels: 4 } }).resize(F, F, { kernel: 'nearest' }).png().toFile(path.join(dir, 'ic_launcher_background.png'));
}
for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) { const p = path.join(res, 'mipmap-anydpi-v26', f); if (fs.existsSync(p)) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('@color/ic_launcher_background', '@mipmap/ic_launcher_background')); }
fs.mkdirSync(path.join(res, 'values'), { recursive: true });
fs.writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">${color}</color>\n</resources>\n`);
if (OUT) await (await masked(48, 0.78, 512, false)).toFile('icon-preview.png');
console.log('icons drawn, background', color);
