// Browser smoke test: practice putting green + rhythm putt flow + UI introspection
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/usr/local/lib/node_modules/playwright');

const BASE = 'http://localhost:8788';
const OUT = new URL('.', import.meta.url).pathname;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
const missing = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });
page.on('response', r => { if (r.status() === 404) missing.push(r.url()); });

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-practice', { timeout: 15000 });
await sleep(1500);

// Practice → Putting Green
await page.click('#mode-btn-practice');
await page.waitForSelector('#mode-btn-putting', { state: 'visible' });
await page.click('#mode-btn-putting');
await sleep(4000);
await page.screenshot({ path: OUT + 'shot2-putting-green.png' });

// --- Introspection ---
const info = await page.evaluate(async () => {
  const core = await import('./src/visuals/core.js');
  const s = await import('./src/gameLogic/state.js');
  const b = core.ball;
  const panel = document.getElementById('practice-panel');
  const panelStyle = panel ? getComputedStyle(panel) : null;
  const cam = core.camera;
  const fsIds = ['fs-club-value', 'fs-shot-type-value', 'fs-power-value'];
  const fs = {};
  fsIds.forEach(id => { const el = document.getElementById(id); fs[id] = el ? el.textContent : '(no element)'; });
  // overlay elements containing 'N/A'
  const overlayEls = [...document.querySelectorAll('[id*="overlay"], [id*="fs-"]')]
    .filter(el => el.children.length === 0 && el.textContent.includes('N/A'))
    .slice(0, 10).map(el => el.id || el.className);
  return {
    ball: b ? { visible: b.visible, y: +b.position.y.toFixed(3), x: +b.position.x.toFixed(2), z: +b.position.z.toFixed(2) } : null,
    camera: cam ? { pos: cam.position.toArray().map(v => +v.toFixed(1)) } : null,
    state: { gameState: s.getGameState(), shotType: s.getCurrentShotType(), club: s.getSelectedClub()?.name },
    panel: panel ? { classes: panel.className, display: panelStyle.display, rect: panel.getBoundingClientRect().toJSON(), zIndex: panelStyle.zIndex, parent: panel.parentElement.tagName } : '(no panel element)',
    fs,
    naOverlayIds: overlayEls,
  };
});
console.log(JSON.stringify(info, null, 1));

// Rhythm taps + strike
for (let i = 0; i < 4; i++) { await page.keyboard.press('w'); await sleep(500); }
await page.screenshot({ path: OUT + 'shot3-tapping.png' });
await sleep(480);
await page.keyboard.press('i');
await sleep(4500);
await page.screenshot({ path: OUT + 'shot4-after-putt.png' });

const final = await page.evaluate(async () => {
  const core = await import('./src/visuals/core.js');
  const s = await import('./src/gameLogic/state.js');
  return { ballY: +core.ball.position.y.toFixed(3), gameState: s.getGameState(), status: document.getElementById('status-display')?.textContent || document.getElementById('status')?.textContent };
});
console.log('FINAL:', JSON.stringify(final));
console.log('404s:', JSON.stringify(missing));
console.log('ERRORS (' + errors.length + '):');
errors.slice(0, 10).forEach(e => console.log('  ' + e.slice(0, 180)));
await browser.close();
