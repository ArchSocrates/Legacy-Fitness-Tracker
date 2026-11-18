// Draws the Legacy mountain mark on a background colour that changes with each version (version.json).
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const { color } = JSON.parse(fs.readFileSync('version.json', 'utf8'));
const res = process.argv[2] || 'android/app/src/main/res';
const OUT = process.argv[3] === 'preview';
const PATH = 'M2 26 11 8l5.5 9L21 10l9 16z';
const mark = (S, frac) => {
  const k = (frac * S) / 28; // path is 28 wide in a 32 unit box
  return `<g transform="translate(${S / 2 - 16 * k} ${S / 2 - 17 * k}) scale(${k})" fill="none" stroke="#f7f1e3" stroke-width="${1.9}" stroke-linejoin="round" stroke-linecap="round"><path d="${PATH}"/></g>`;
};
const svg = (S, inner) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${inner}</svg>`);
const dens = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };
for (const [d, [L, F]] of Object.entries(dens)) {
  const dir = path.join(res, 'mipmap-' + d);
  fs.mkdirSync(dir, { recursive: true });
  const r = Math.round(L * 0.22);
  await sharp(svg(L, `<rect width="${L}" height="${L}" rx="${r}" fill="${color}"/>${mark(L, 0.6)}`)).png().toFile(path.join(dir, 'ic_launcher.png'));
  await sharp(svg(L, `<circle cx="${L / 2}" cy="${L / 2}" r="${L / 2}" fill="${color}"/>${mark(L, 0.54)}`)).png().toFile(path.join(dir, 'ic_launcher_round.png'));
  await sharp(svg(F, mark(F, 0.5))).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
}
fs.mkdirSync(path.join(res, 'values'), { recursive: true });
fs.writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">${color}</color>\n</resources>\n`);
if (OUT) await sharp(svg(512, `<rect width="512" height="512" rx="112" fill="${color}"/>${mark(512, 0.6)}`)).png().toFile('icon-preview.png');
console.log('icons drawn, background', color);
