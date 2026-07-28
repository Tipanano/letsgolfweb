// Browser smoke test: rhythm chipping on the practice green
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/usr/local/lib/node_modules/playwright');

const BASE = 'http://localhost:8788';
const OUT = new URL('.', import.meta.url).pathname;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 150)); });

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-practice', { timeout: 15000 });
await sleep(1500);
await page.click('#mode-btn-practice');
await page.click('#mode-btn-chipping');
await sleep(4000);
await page.screenshot({ path: OUT + 'chip1-loaded.png' });

const setup = await page.evaluate(async () => {
  const s = await import('./src/gameLogic/state.js');
  const core = await import('./src/visuals/core.js');
  return { shotType: s.getCurrentShotType(), club: s.getSelectedClub()?.name,
           ball: { x: +core.ball.position.x.toFixed(1), y: +core.ball.position.y.toFixed(3), z: +core.ball.position.z.toFixed(1), visible: core.ball.visible } };
});
console.log('SETUP:', JSON.stringify(setup));

// Rhythm taps then strike + late shape tap (fade)
for (let i = 0; i < 4; i++) { await page.keyboard.press('w'); await sleep(420); }
await page.screenshot({ path: OUT + 'chip2-tapping.png' });
await sleep(400);
await page.keyboard.press('i');           // strike on the beat
await sleep(540);                          // shape beat ~420ms; +120 late = fade
await page.keyboard.press('i');
await sleep(6000);
await page.screenshot({ path: OUT + 'chip3-result.png' });

const result1 = await page.evaluate(async () => {
  const s = await import('./src/gameLogic/state.js');
  return { gameState: s.getGameState(), status: document.getElementById('status-display')?.textContent || document.getElementById('status')?.textContent };
});
console.log('SHAPED CHIP:', JSON.stringify(result1));

// Next shot: no shape tap → should fire via timeout with stock spin
await page.keyboard.press('n');
await sleep(800);
for (let i = 0; i < 4; i++) { await page.keyboard.press('w'); await sleep(420); }
await sleep(400);
await page.keyboard.press('i');
await sleep(6500); // shape window (~500ms) + flight + roll
const result2 = await page.evaluate(async () => {
  const s = await import('./src/gameLogic/state.js');
  return { gameState: s.getGameState(), status: document.getElementById('status-display')?.textContent || document.getElementById('status')?.textContent };
});
console.log('STOCK CHIP (timeout):', JSON.stringify(result2));
await page.screenshot({ path: OUT + 'chip4-stock.png' });

console.log('ERRORS (' + errors.length + '):');
errors.slice(0, 8).forEach(e => console.log('  ' + e));
await browser.close();
