// Screenshots of the landing story at each chapter, for visual review of the instrument.
// Usage: node shot-armillary.mjs <baseUrl> <outDir> [light|dark] [desktop|phone]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [base = 'http://localhost:4300', out = 'artifacts/armillary', scheme = 'dark', device = 'desktop'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome) ? chrome : undefined,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
await page.setViewport(device === 'phone' ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1440, height: 900 });
await page.goto(base, { waitUntil: 'networkidle0' });
await page.waitForSelector('canvas[data-testid="armillary"]', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
const story = await page.$eval('[data-testid="story"]', (el) => ({ top: el.offsetTop, h: el.offsetHeight }));
const vh = await page.evaluate(() => window.innerHeight);
for (const [name, p] of [
  ['hero', 0],
  ['ch1', 0.23],
  ['ch2', 0.45],
  ['ch3', 0.67],
  ['ch4', 0.89],
]) {
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(story.top + p * (story.h - vh)));
  await new Promise((r) => setTimeout(r, 2200));
  await page.screenshot({ path: path.join(out, `${device}-${scheme}-${name}.png`) });
}
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
