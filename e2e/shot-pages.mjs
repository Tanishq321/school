// Full-page screenshots of signed-in pages, for visual review.
// Usage: node shot-pages.mjs <baseUrl> <outDir> <email> <password> <light|dark> <desktop|phone> <path> [<path> ...]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [base, out, email, password, scheme = 'light', device = 'desktop', ...paths] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const browser = await puppeteer.launch({ executablePath: chrome, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/favicon|502/.test(m.text()) && errors.push(m.text()));
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
await page.setViewport(device === 'phone' ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1440, height: 900 });
await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
await page.waitForSelector('input[type="email"]');
await page.type('input[type="email"]', email);
await page.type('input[type="password"]', password);
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.keyboard.press('Enter')]);
const who = email.split('@')[0];
for (const p of paths) {
  await page.goto(`${base}${p}`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));
  // reveal scroll-driven sections before a full-page capture
  await page.evaluate(() => document.querySelectorAll('.reveal, .reveal-stagger > *').forEach((el) => el.style.setProperty('animation', 'none', 'important')));
  const name = `${who}-${device}-${scheme}-${p.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'today'}.png`;
  await page.screenshot({ path: path.join(out, name), fullPage: true });
  console.log('shot', name);
}
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
