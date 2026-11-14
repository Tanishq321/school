// Draws the app icons and splash screens from the house monogram, in the house face.
//   cd e2e && node make-icons.mjs
// Writes: Android launcher icons (legacy, round, adaptive foreground and background), the iOS app
// icon (1024, opaque), Android and iOS splash screens, and web touch icons. Rendered with headless
// Chrome so the Bodoni Moda letterform is exact; re-run after changing the mark.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const FONT = path.join(ROOT, 'node_modules/@fontsource-variable/bodoni-moda/files/bodoni-moda-latin-opsz-normal.woff2');
const RES = path.join(ROOT, 'android/app/src/main/res');
const IOS = path.join(ROOT, 'ios/App/App/Assets.xcassets');

/** Guilloché: phase-shifted strands of a lobed circle, as on the plinth and the member card. */
function rosette(cx, cy, r, amp, lobes, strands, color, width) {
  let d = '';
  for (let s = 0; s < strands; s += 1) {
    const ph = (2 * Math.PI * s) / strands;
    for (let i = 0; i <= 360; i += 1) {
      const t = (i / 360) * Math.PI * 2;
      const rad = r + amp * Math.sin(lobes * t + ph);
      d += `${i ? 'L' : 'M'}${(cx + rad * Math.cos(t)).toFixed(1)} ${(cy + rad * Math.sin(t)).toFixed(1)}`;
    }
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
}

const DEFS = `<defs>
  <radialGradient id="lacquer" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#1d2847"/><stop offset=".6" stop-color="#121a30"/><stop offset="1" stop-color="#0a0f1e"/></radialGradient>
  <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1dcaa"/><stop offset=".45" stop-color="#c49c5e"/><stop offset=".75" stop-color="#9a7642"/><stop offset="1" stop-color="#6f5228"/></linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>`;

/** The ground: lacquer with a faint gilt rosette. */
const ground = (w, h) => `<rect width="${w}" height="${h}" fill="url(#lacquer)"/>
  ${rosette(w / 2, h / 2, Math.min(w, h) * 0.36, Math.min(w, h) * 0.05, 30, 22, 'rgba(216,190,140,.10)', Math.max(1, Math.min(w, h) / 700))}
  <rect width="${w}" height="${h}" fill="url(#sheen)"/>`;

/** The mark: double brass ring and the letter, centred at (cx, cy) with outer radius r. */
const mark = (cx, cy, r) => `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#brass)" stroke-width="${r * 0.045}"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 0.86}" fill="none" stroke="url(#brass)" stroke-width="${r * 0.016}" opacity=".75"/>
  <text x="${cx}" y="${cy + r * 0.37}" text-anchor="middle" font-family="Bodoni" font-size="${r * 1.12}" font-weight="500" fill="url(#brass)">S</text>`;

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${DEFS}${body}</svg>`;

const ART = {
  // full-bleed square icon (iOS masks the corners itself)
  square: (s) => svg(s, s, ground(s, s) + mark(s / 2, s / 2, s * 0.34)),
  // legacy Android icon: a rounded square on transparency
  legacy: (s) => svg(s, s, `<clipPath id="c"><rect x="${s * 0.04}" y="${s * 0.04}" width="${s * 0.92}" height="${s * 0.92}" rx="${s * 0.2}"/></clipPath><g clip-path="url(#c)">${ground(s, s)}${mark(s / 2, s / 2, s * 0.31)}</g>`),
  round: (s) => svg(s, s, `<clipPath id="c"><circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.46}"/></clipPath><g clip-path="url(#c)">${ground(s, s)}${mark(s / 2, s / 2, s * 0.31)}</g>`),
  // adaptive icon: 108dp canvas, the launcher shows the middle 72dp and may mask to 66dp
  foreground: (s) => svg(s, s, mark(s / 2, s / 2, s * 0.25)),
  background: (s) => svg(s, s, ground(s, s)),
  splash: (w, h) => {
    const m = Math.min(w, h);
    return svg(
      w,
      h,
      `${ground(w, h)}${mark(w / 2, h / 2 - m * 0.06, m * 0.14)}
      <text x="${w / 2}" y="${h / 2 + m * 0.2}" text-anchor="middle" font-family="Bodoni" font-size="${m * 0.07}" fill="#ece6da" letter-spacing="${m * 0.002}">Scholé</text>`,
    );
  },
};

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
const fontUrl = `data:font/woff2;base64,${fs.readFileSync(FONT).toString('base64')}`;

async function render(file, w, h, art, { transparent = false } = {}) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setContent(
    `<html><head><style>@font-face{font-family:Bodoni;src:url(${fontUrl}) format('woff2');font-weight:400 900}html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${art}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(path.relative(ROOT, file), `${w}×${h}`);
}

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(densities)) {
  const dir = path.join(RES, `mipmap-${d}`);
  await render(path.join(dir, 'ic_launcher.png'), 48 * k, 48 * k, ART.legacy(48 * k), { transparent: true });
  await render(path.join(dir, 'ic_launcher_round.png'), 48 * k, 48 * k, ART.round(48 * k), { transparent: true });
  await render(path.join(dir, 'ic_launcher_foreground.png'), 108 * k, 108 * k, ART.foreground(108 * k), { transparent: true });
  await render(path.join(dir, 'ic_launcher_background.png'), 108 * k, 108 * k, ART.background(108 * k));
}
await render(path.join(IOS, 'AppIcon.appiconset/AppIcon-512@2x.png'), 1024, 1024, ART.square(1024)); // opaque, as the App Store requires

for (const f of fs.readdirSync(RES)) {
  const file = path.join(RES, f, 'splash.png');
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    await render(file, w, h, ART.splash(w, h));
  }
}
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await render(path.join(IOS, 'Splash.imageset', name), 2732, 2732, ART.splash(2732, 2732));
}

await render(path.join(ROOT, 'public/apple-touch-icon.png'), 180, 180, ART.square(180));
await render(path.join(ROOT, 'public/icon-512.png'), 512, 512, ART.square(512));
await browser.close();
