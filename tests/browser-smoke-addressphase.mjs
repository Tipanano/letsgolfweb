// Desktop has the same Setup → Address flow as touch.
//
// Touch has had two phases for a while: Setup (club, aim, panels, fly-over)
// and Address (everything non-shot stripped, swing live), joined by an
// ADDRESS BALL pill. Desktop had all controls on screen at once and 'w'
// swung from anywhere. Now: Enter or a first 'w' addresses, Esc or the shot
// resolving returns to Setup, and address strips the same chrome touch
// strips.
//
// The first-'w' entry is the load-bearing parity: on touch you physically
// cannot swing from Setup. On desktop the same key that would have swung now
// addresses first — the second hold swings — so the phases cannot be skipped
// by muscle memory.
//
// Run: node tests/browser-smoke-addressphase.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync, execFileSync } = require('child_process');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(require.resolve('playwright', { paths: [globalRoot, '/usr/local/lib/node_modules'] }));

const BASE = 'http://localhost:8788';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

const browser = await chromium.launch({ headless: true })
    .catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true }));
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const fs = require('fs'); const path = require('path'); const os = require('os');
const CDN_CACHE = path.join(os.tmpdir(), 'letsgolfweb-cdn-cache');
fs.mkdirSync(CDN_CACHE, { recursive: true });
await page.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://fonts.')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.includes('api.gih.golf')) return route.abort();
    const cacheFile = path.join(CDN_CACHE, url.replace(/^https:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_'));
    try {
        if (!fs.existsSync(cacheFile)) execFileSync('curl', ['-sSfL', '--max-time', '60', '-o', cacheFile, url]);
        return route.fulfill({ contentType: /\.css(\?|$)/.test(url) ? 'text/css' : 'application/javascript', body: fs.readFileSync(cacheFile) });
    } catch (e) { return route.abort(); }
});
const EXPECTED = /api\.gih\.golf|Failed to fetch|checking for active game|net::ERR_FAILED/;
const errors = [];
page.on('pageerror', e => { if (!EXPECTED.test(e.message)) errors.push('PAGEERROR: ' + e.message); });

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-course', { timeout: 15000 });
await sleep(1000);

await page.evaluate(async () => {
    const main = await import('./src/main.js');
    const ui = await import('./src/ui.js');
    const box = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
    const HOLE = {
        name: 'Phases', par: 4, lengthMeters: 200,
        background: { surface: 'LIGHT_ROUGH', vertices: box(-100, -20, 100, 240) },
        tee: { type: 'polygon', center: { x: 0, z: 0 }, vertices: box(-4, -4, 4, 4) },
        fairways: [{ surface: 'FAIRWAY', vertices: box(-20, 5, 20, 190) }],
        greens: [{ surface: 'GREEN', vertices: box(-14, 190, 14, 215) }],
        bunkers: [], waterHazards: [], lightRough: [],
        flagPositions: [{ number: 1, x: 0, y: 0, z: 202 }],
        obstacles: [], terrainFeatures: [],
    };
    ui.showGameView();
    await main.setGameMode(main.GAME_MODES.PLAY_HOLE, null, null, null,
        { name: 'Phase Course', par: 4, holes: [HOLE] });
    await new Promise(r => setTimeout(r, 1500));
});

const snap = () => page.evaluate(async () => {
    const state = await import('./src/gameLogic/state.js');
    const phase = await import('./src/addressPhase.js');
    const vis = (id) => {
        const el = document.getElementById(id);
        return !!el && getComputedStyle(el).display !== 'none';
    };
    return {
        state: state.getGameState(),
        addressed: phase.isAddressed(),
        bodyClass: document.body.classList.contains('kb-address'),
        pill: vis('kb-address-pill'),
        pillText: document.getElementById('kb-address-pill')?.textContent || '',
        exitBtn: vis('kb-address-exit'),
        fsControls: vis('fullscreen-controls'),
    };
});
const key = (k) => page.evaluate((kk) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: kk, bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: kk, bubbles: true, cancelable: true }));
}, k);

// --- 1. Setup phase: the pill is there, and asks for a club first ----------
let s0 = await snap();
console.log('setup, no club :', JSON.stringify(s0));
if (!s0.pill) fail('the ADDRESS BALL pill is not shown in setup');
if (!/PICK A CLUB/i.test(s0.pillText)) fail(`with no club the pill must say so — it reads "${s0.pillText}"`);
if (s0.addressed) fail('the game must start in setup, not at address');

// --- 2. 'w' from setup with a club: addresses, does NOT swing --------------
await page.evaluate(async () => (await import('./src/gameLogic/state.js')).setSelectedClub('DR'));
await sleep(400);
s0 = await snap();
if (!/ADDRESS BALL/i.test(s0.pillText)) fail(`with a club the pill must offer address — it reads "${s0.pillText}"`);
await key('w');
await sleep(200);
let s1 = await snap();
console.log("after 'w'      :", JSON.stringify(s1));
if (!s1.addressed) fail("a first 'w' from setup must enter address");
if (s1.state !== 'ready') fail(`a first 'w' must not start a swing — state is "${s1.state}"`);
if (s1.fsControls) fail('address must hide the setup controls, and #fullscreen-controls is still visible');
if (!s1.exitBtn) fail('address must offer a way back to setup');
if (s1.pill) fail('the ADDRESS BALL pill must hide once addressed');

// --- 3. Esc returns to setup ------------------------------------------------
await key('Escape');
await sleep(200);
let s2 = await snap();
console.log('after Esc      :', JSON.stringify(s2));
if (s2.addressed) fail('Esc must return to setup');

// --- 4. Enter addresses; a real swing then runs and result exits -----------
await key('Enter');
await sleep(200);
s2 = await snap();
if (!s2.addressed) fail('Enter must enter address');
const shot = await page.evaluate(async () => {
    const actions = await import('./src/gameLogic/actions.js');
    const state = await import('./src/gameLogic/state.js');
    actions.startBackswing();
    state.setBackswingStartTime(performance.now() - 700);
    actions.endBackswing();
    await new Promise(r => setTimeout(r, 60));
    const t = performance.now();
    actions.recordHipInitiation();
    actions.startDownswingPhase();
    actions.recordDownswingKey('rotation', t + 5);
    actions.recordDownswingKey('arms', t + 90);
    actions.recordDownswingKey('wrists', t + 160);
    actions.triggerFullSwingCalc();
    for (let i = 0; i < 200 && state.getGameState() !== 'result'; i++)
        await new Promise(r => setTimeout(r, 100));
    return state.getGameState();
});
if (shot !== 'result') fail(`the swing from address never resolved (state "${shot}")`);
await sleep(700);   // the phase watcher exits address on result
const s3 = await snap();
console.log('after the shot :', JSON.stringify(s3));
if (s3.addressed) fail('the shot resolving must return to setup, as it does on touch');
if (!s3.pill || !/NEXT/i.test(s3.pillText)) fail(`after a shot the pill must offer NEXT — it reads "${s3.pillText}"`);

await browser.close();
if (errors.length) fail('page errors:\n  ' + errors.slice(0, 5).join('\n  '));
console.log('browser-smoke-addressphase: PASS — setup and address behave like the touch flow');
