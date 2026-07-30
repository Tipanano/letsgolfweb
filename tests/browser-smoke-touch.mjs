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

// Double-tap on the scene (setup phase) sets the aim toward that spot.
// setShotDirectionAngle stores the ABSOLUTE target line (relative resets
// to 0), so assert on getCurrentTargetLineAngle.
const aimBefore = await page.evaluate(async () => {
    const s = await import('./src/gameLogic/state.js');
    return s.getCurrentTargetLineAngle();
});
// Two taps at human speed: playwright's per-tap roundtrip (~1 s here)
// blows the 400 ms double-tap window, so dispatch TouchEvents in-page.
await page.evaluate(() => {
    const c = document.getElementById('golf-canvas');
    const mk = (type, x, y) => {
        const touch = new Touch({ identifier: 1, target: c, clientX: x, clientY: y });
        c.dispatchEvent(new TouchEvent(type, {
            touches: type === 'touchend' ? [] : [touch],
            changedTouches: [touch], bubbles: true, cancelable: true,
        }));
    };
    const tap = () => { mk('touchstart', 700, 300); mk('touchend', 700, 300); };
    // Back-to-back: this sandbox throttles timers far past the 400 ms
    // double-tap window, so the two taps land in the same tick.
    tap(); tap(); // open ground, clear of panels/pills/chips
});
await sleep(500);
const aimAfter = await page.evaluate(async () => {
    const s = await import('./src/gameLogic/state.js');
    return s.getCurrentTargetLineAngle();
});
if (aimAfter === aimBefore) fail(`double-tap did not set aim (still ${aimAfter})`);
console.log(`double-tap aim: target line ${aimBefore.toFixed(1)}° → ${aimAfter.toFixed(1)}°`);

await tapZone('tc-address');
await sleep(200);
const addressPhase = await page.evaluate(() => ({
    stripped: document.body.classList.contains('tc-address'),
    fsHidden: getComputedStyle(document.getElementById('fullscreen-controls')).display === 'none',
    swingLabel: document.getElementById('tc-swing').textContent,
    strokeLabel: document.getElementById('tc-stroke').textContent,
}));
if (!addressPhase.stripped || !addressPhase.fsHidden) fail(`address strip failed: ${JSON.stringify(addressPhase)}`);
if (!/TAP/.test(addressPhase.swingLabel) || !/STROKE/.test(addressPhase.strokeLabel)) {
    fail(`putt zone labels wrong: ${JSON.stringify(addressPhase)}`);
}
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
// Wait for the overlay to relabel for the full swing (SWING + BEAT zones)
await page.waitForFunction(() =>
    document.getElementById('touch-controls')?.classList.contains('visible') &&
    /SWING/.test(document.getElementById('tc-swing').textContent) &&
    /BEAT/.test(document.getElementById('tc-stroke').textContent),
    { timeout: 10000 });
await tapZone('tc-address');
await sleep(200);
await page.screenshot({ path: OUT + 'shot-touch-full.png' });

// --- Instruction hints: hidden by default, top-bar button toggles them ---
const hudVisible = () => page.evaluate(() => {
    const el = document.getElementById('rhythm-putt-hud');
    return !!el && el.classList.contains('visible');
});
if (await hudVisible()) fail('instruction hint visible at address despite hidden-by-default');
await page.evaluate(() => document.getElementById('fs-hints-btn').click());
await sleep(200);
const hintOn = await page.evaluate(() =>
    document.getElementById('rhythm-putt-hint')?.textContent || '');
if (!/SWING|Hold/.test(hintOn)) fail(`hints toggle did not show instructions: "${hintOn}"`);
await page.evaluate(() => document.getElementById('fs-hints-btn').click());
await sleep(200);
if (await hudVisible()) fail('hints toggle did not hide instructions again');
console.log('hints: hidden by default, top-bar toggle shows/hides ✓');

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

// Downswing: drum the beats on alternating thumbs — each tap fires the
// next event of the chain (hips → rotation → arms → wrists)
await tapZone('tc-stroke'); await sleep(90);  // hips
await tapZone('tc-swing'); await sleep(90);   // rotation
await tapZone('tc-stroke'); await sleep(90);  // arms
await tapZone('tc-swing');                    // wrists
let flew = null;
for (let i = 0; i < 40; i++) {
    flew = await state();
    if (flew === 'result' || flew === 'ready') break;
    await sleep(300);
}
if (flew !== 'result' && flew !== 'ready') fail(`swing never resolved, state ${flew}`);

// Range full swings produce a post-shot swing report in the hint HUD
await sleep(700);
const report = await page.evaluate(() =>
    document.getElementById('rhythm-putt-hint')?.textContent || '');
if (!/strike/.test(report)) fail(`no swing report in hint: "${report}"`);
console.log(`swing report: "${report.split('\n')[0].trim()}..."`);

// --- Second swing: PC-style early transition (beat tap DURING the hold) ---
if (flew === 'result') { await tapZone('tc-address'); await sleep(400); } // NEXT
await tapZone('tc-address'); await sleep(300);                            // back to address
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
await sleep(250);
// Mid-backswing beat tap must fire HIPS (the flowing transition), not rotation
const midHold = await page.evaluate(async () => {
    const el = document.getElementById('tc-stroke');
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    const s = await import('./src/gameLogic/state.js');
    return { hips: s.getHipInitiationTime() !== null, state: s.getGameState() };
});
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(120);
const afterRelease = await state();
if (!midHold.hips || midHold.state !== 'backswing') {
    fail(`mid-hold tap did not fire hips during backswing: ${JSON.stringify(midHold)}`);
}
// The release must flow into the downswing — never pause at the top.
// (On a slow machine the downswing may already have auto-resolved.)
if (afterRelease === 'backswingPausedAtTop') fail('early transition paused at top');
// Feed the remaining beats if the swing is still live, then let it resolve
if (afterRelease === 'downswingWaiting') {
    await tapZone('tc-swing'); await sleep(90);
    await tapZone('tc-stroke'); await sleep(90);
    await tapZone('tc-swing');
}
let flew2 = null;
for (let i = 0; i < 40; i++) {
    flew2 = await state();
    if (flew2 === 'result' || flew2 === 'ready') break;
    await sleep(300);
}
if (flew2 !== 'result' && flew2 !== 'ready') fail(`early-transition swing never resolved, state ${flew2}`);
console.log(`early transition: hips mid-hold ✓, release → ${afterRelease}, resolved → ${flew2}`);
const shotInfo = await page.evaluate(() =>
    document.getElementById('status-text-display')?.textContent || '');
await page.screenshot({ path: OUT + 'shot-touch-result.png' });

// --- Rhythm chip: practice contexts get a chip report (strike/tempo/why) ---
await page.evaluate(() => document.getElementById('back-to-menu-button').click());
await page.waitForSelector('#mode-btn-practice', { timeout: 5000 });
if (!await page.locator('#mode-btn-chipping').isVisible()) await page.tap('#mode-btn-practice');
await page.waitForSelector('#mode-btn-chipping', { state: 'visible' });
await page.tap('#mode-btn-chipping');
await sleep(5000);
await page.waitForFunction(() =>
    document.getElementById('touch-controls')?.classList.contains('visible') &&
    /TAP/.test(document.getElementById('tc-swing').textContent),
    { timeout: 10000 });
await tapZone('tc-address');
await sleep(300);
const [cSwingX, cSwingY] = await (async () => {
    const b = await zoneRect('tc-swing');
    return [b.x + b.width / 2, b.y + b.height / 2];
})();
const [cStrokeX, cStrokeY] = await (async () => {
    const b = await zoneRect('tc-stroke');
    return [b.x + b.width / 2, b.y + b.height / 2];
})();
let chipStruck = null;
for (let round = 0; round < 3 && !chipStruck; round++) {
    for (let i = 0; i < 5; i++) {
        await page.touchscreen.tap(cSwingX, cSwingY);
        await sleep(330);
    }
    await page.touchscreen.tap(cStrokeX, cStrokeY);
    await sleep(400);
    const s = await state();
    if (s !== 'puttRhythm' && s !== 'ready') chipStruck = s;
}
if (!chipStruck) fail('chip stroke never fired after 3 tempo rounds');
let chipSettled = null;
for (let i = 0; i < 40; i++) {
    chipSettled = await state();
    if (chipSettled === 'result' || chipSettled === 'ready') break;
    await sleep(300);
}
if (chipSettled !== 'result' && chipSettled !== 'ready') fail(`chip never settled, state ${chipSettled}`);
await sleep(700);
const chipReport = await page.evaluate(() =>
    document.getElementById('rhythm-putt-hint')?.textContent || '');
if (!/chip|pitch/i.test(chipReport) || !/tempo/.test(chipReport)) {
    fail(`no chip report in hint: "${chipReport}"`);
}
console.log(`chip report: "${chipReport.split('\n')[0].trim()}..."`);

await browser.close();

if (errors.length) fail('page errors:\n' + errors.join('\n'));
console.log(`touch full swing: backswing → ${atTop} → sequence → ${flew} ("${shotInfo.trim()}")`);
console.log('browser-smoke-touch: PASS');
