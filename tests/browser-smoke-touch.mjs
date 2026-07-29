// Browser smoke test: touch controls on a phone-sized viewport.
// Verifies the rhythm putt (tap tempo + stroke) and the full-swing
// hold-and-tap sequence entirely through emulated touch input.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync, execFileSync } = require('child_process');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(require.resolve('playwright', { paths: [globalRoot, '/usr/local/lib/node_modules'] }));

const BASE = 'http://localhost:8788';
const OUT = new URL('.', import.meta.url).pathname;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function launch() {
    const attempts = [
        { channel: 'chrome', headless: true },
        { headless: true },
        { executablePath: '/opt/pw-browsers/chromium', headless: true },
    ];
    let lastErr;
    for (const opts of attempts) {
        try { return await chromium.launch(opts); } catch (e) { lastErr = e; }
    }
    throw lastErr;
}
const browser = await launch();
// Landscape phone with touch
const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
});
const page = await context.newPage();

// CDN cache harness (see browser-smoke-career.mjs)
const fs = require('fs');
const path = require('path');
const os = require('os');
const CDN_CACHE = path.join(os.tmpdir(), 'letsgolfweb-cdn-cache');
fs.mkdirSync(CDN_CACHE, { recursive: true });
await page.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://fonts.')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.includes('api.gih.golf')) return route.abort();
    const cacheFile = path.join(CDN_CACHE, url.replace(/^https:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_'));
    try {
        if (!fs.existsSync(cacheFile)) execFileSync('curl', ['-sSfL', '--max-time', '60', '-o', cacheFile, url]);
        return route.fulfill({
            contentType: /\.css(\?|$)/.test(url) ? 'text/css' : 'application/javascript',
            body: fs.readFileSync(cacheFile),
        });
    } catch (e) {
        console.error('CDN fetch failed:', url, e.message);
        return route.abort();
    }
});

const errors = [];
const EXPECTED = /api\.gih\.golf|Failed to fetch|checking for active game|net::ERR_FAILED/;
page.on('pageerror', e => { if (!EXPECTED.test(e.message)) errors.push('PAGEERROR: ' + e.message); });
page.on('console', msg => {
    if (msg.type() === 'error' && !EXPECTED.test(msg.text())) errors.push('CONSOLE: ' + msg.text());
});

const state = () => page.evaluate(async () => {
    const s = await import('./src/gameLogic/state.js');
    return s.getGameState();
});
// getBoundingClientRect via evaluate: playwright's boundingBox() visibility
// heuristic misreads elements inside the pointer-events:none overlay.
const zoneRect = (id) => page.evaluate((zid) => {
    const r = document.getElementById(zid).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
}, id);
const tapZone = async (id) => {
    const box = await zoneRect(id);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
};
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

await page.goto(BASE + '/index.html?touch=1', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-practice', { timeout: 15000 });
await sleep(1000);

// Overlay exists but stays hidden over the menu
if (await page.locator('#touch-controls.visible').count() !== 0) fail('overlay visible over menu');

// --- Rhythm putt drill via touch ---
await page.tap('#mode-btn-practice');
await page.waitForSelector('#mode-btn-putting', { state: 'visible' });
await page.tap('#mode-btn-putting');
await sleep(5000); // layout + placement

await page.waitForSelector('#touch-controls.visible', { timeout: 5000 });
// Starts in setup: zones hidden, ADDRESS BALL offered, info panels visible
const setupPhase = await page.evaluate(() => ({
    setup: document.getElementById('touch-controls').classList.contains('setup'),
    zoneHidden: getComputedStyle(document.getElementById('tc-swing')).display === 'none',
}));
if (!setupPhase.setup || !setupPhase.zoneHidden) fail(`setup phase wrong: ${JSON.stringify(setupPhase)}`);
await page.screenshot({ path: OUT + 'shot-touch-setup.png' });

await tapZone('tc-address');
await sleep(200);
const addressPhase = await page.evaluate(() => ({
    stripped: document.body.classList.contains('tc-address'),
    fsHidden: getComputedStyle(document.getElementById('fullscreen-controls')).display === 'none',
    stroke: !document.getElementById('tc-stroke').classList.contains('tc-hidden'),
    hips: document.getElementById('tc-hips').classList.contains('tc-hidden'),
}));
if (!addressPhase.stripped || !addressPhase.fsHidden) fail(`address strip failed: ${JSON.stringify(addressPhase)}`);
if (!addressPhase.stroke || !addressPhase.hips) fail(`putt zones wrong: ${JSON.stringify(addressPhase)}`);
await page.screenshot({ path: OUT + 'shot-touch-putt.png' });

// Tap a tempo, then strike immediately. Every playwright roundtrip between
// taps risks blowing the 1.5 s rhythm-expiry window on a slow machine, so
// coordinates are pre-resolved and the whole sequence retries like a human
// re-settling their tempo.
const center = async (id) => {
    const b = await zoneRect(id);
    return [b.x + b.width / 2, b.y + b.height / 2];
};
const [swingX, swingY] = await center('tc-swing');
const [strokeX, strokeY] = await center('tc-stroke');
let struck = null;
for (let round = 0; round < 3 && !struck; round++) {
    for (let i = 0; i < 5; i++) {
        await page.touchscreen.tap(swingX, swingY);
        await sleep(330);
    }
    await page.touchscreen.tap(strokeX, strokeY);
    await sleep(400);
    const s = await state();
    if (s !== 'puttRhythm' && s !== 'ready') struck = s;
}
if (!struck) fail('stroke never fired after 3 tempo rounds');
// Let the ball roll out
let settled = null;
for (let i = 0; i < 40; i++) {
    settled = await state();
    if (settled === 'result' || settled === 'ready') break;
    await sleep(300);
}
if (settled !== 'result' && settled !== 'ready') fail(`putt never settled, state ${settled}`);
// Result auto-returns to setup so the info panels come back
await sleep(700);
const backToSetup = await page.evaluate(() =>
    document.getElementById('touch-controls').classList.contains('setup'));
if (settled === 'result' && !backToSetup) fail('did not auto-return to setup after result');
console.log(`touch putt: tempo armed, stroke fired (${struck}), settled in ${settled}, auto-setup ${backToSetup}`);

// --- Full swing via touch (driving range) ---
// The menu button is styled out of tap reach on this small viewport — menu
// navigation isn't under test here, so click it programmatically.
await page.evaluate(() => document.getElementById('back-to-menu-button').click());
await page.waitForSelector('#mode-btn-practice', { timeout: 5000 });
// The practice submenu is a toggle and may still be open from the first visit
if (!await page.locator('#mode-btn-range').isVisible()) await page.tap('#mode-btn-practice');
await page.waitForSelector('#mode-btn-range', { state: 'visible' });
await page.tap('#mode-btn-range');
await sleep(3000);
// Wait for the overlay to reshape into full-swing zones (hips shown, stroke hidden)
await page.waitForFunction(() =>
    document.getElementById('touch-controls')?.classList.contains('visible') &&
    !document.getElementById('tc-hips').classList.contains('tc-hidden') &&
    document.getElementById('tc-stroke').classList.contains('tc-hidden'),
    { timeout: 10000 });
await tapZone('tc-address');
await sleep(200);
await page.screenshot({ path: OUT + 'shot-touch-full.png' });

// Hold SWING via CDP touch events (touchscreen.tap can't hold)
const cdp = await context.newCDPSession(page);
const swingBox = await zoneRect('tc-swing');
const sx = swingBox.x + swingBox.width / 2, sy = swingBox.y + swingBox.height / 2;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
await sleep(300);
const backswing = await state();
await sleep(500);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(150);
const atTop = await state();
if (backswing !== 'backswing') fail(`hold did not start backswing (${backswing})`);
if (atTop !== 'backswingPausedAtTop' && atTop !== 'downswingWaiting') fail(`release state ${atTop}`);

// Downswing sequence: hips → arms → wrists
await tapZone('tc-hips'); await sleep(120);
await tapZone('tc-arms'); await sleep(110);
await tapZone('tc-wrists');
let flew = null;
for (let i = 0; i < 40; i++) {
    flew = await state();
    if (flew === 'result' || flew === 'ready') break;
    await sleep(300);
}
if (flew !== 'result' && flew !== 'ready') fail(`swing never resolved, state ${flew}`);
const shotInfo = await page.evaluate(() =>
    document.getElementById('status-text-display')?.textContent || '');
await page.screenshot({ path: OUT + 'shot-touch-result.png' });
await browser.close();

if (errors.length) fail('page errors:\n' + errors.join('\n'));
console.log(`touch full swing: backswing → ${atTop} → sequence → ${flew} ("${shotInfo.trim()}")`);
console.log('browser-smoke-touch: PASS');
