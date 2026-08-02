// Browser smoke test: the practice putting green + rhythm putt flow.
// Covers what the mode has to get right before any physics matters — the
// putting green arms a putt with the putter, the ball sits ON the green
// surface (not sunk into or floating over the layer stack), a tempo + strike
// rolls it, and the shot settles back to a playable state.
//
// Note on assertions: this sandbox throttles timers hard (a 420 ms interval
// lands at ~1000 ms), which used to mean a test could not dictate tempo and
// therefore could not dictate putt length. It can — by busy-waiting instead
// of sleeping, so the intervals the rhythm module measures are real. Roll
// distance is now bounded tightly. Green speed itself is still characterized
// in tests/browser-smoke-shotphysics.mjs (putt-roll row) and
// tests/unit-conditions.mjs.
// Run: node tests/browser-smoke-putt.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync, execFileSync } = require('child_process');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(require.resolve('playwright', { paths: [globalRoot, '/usr/local/lib/node_modules'] }));

const BASE = 'http://localhost:8788';
const OUT = new URL('.', import.meta.url).pathname;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

const browser = await chromium.launch({ channel: 'chrome', headless: true })
    .catch(() => chromium.launch({ headless: true }))
    .catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true }));
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

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
    } catch (e) { return route.abort(); }
});
const EXPECTED = /api\.gih\.golf|Failed to fetch|checking for active game|net::ERR_FAILED/;
const errors = [];
const missing = [];
page.on('pageerror', e => { if (!EXPECTED.test(e.message)) errors.push('PAGEERROR: ' + e.message); });
page.on('console', m => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push('CONSOLE: ' + m.text().slice(0, 150)); });
page.on('response', r => { if (r.status() === 404) missing.push(r.url()); });

const state = () => page.evaluate(async () =>
    (await import('./src/gameLogic/state.js')).getGameState());
const settle = async (want, timeoutMs = 25000) => {
    for (let i = 0; i < timeoutMs / 250; i++) {
        const s = await state();
        if (want.includes(s)) return s;
        await sleep(250);
    }
    return null;
};

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-practice', { timeout: 15000 });
await sleep(1200);
// Practice card expands a submenu, then pick the putting green
await page.click('#mode-btn-practice');
await page.waitForSelector('#mode-btn-putting', { state: 'visible', timeout: 5000 });
await page.click('#mode-btn-putting');
if (!await settle(['ready'], 20000)) fail('putting green never reached the ready state');
await sleep(1200);
await page.screenshot({ path: OUT + 'shot2-putting-green.png' });

const setup = await page.evaluate(async () => {
    const core = await import('./src/visuals/core.js');
    const s = await import('./src/gameLogic/state.js');
    const ph = await import('./src/modes/playHole.js');
    const { getSurfaceTypeAtPoint } = await import('./src/utils/gameUtils.js');
    const b = core.ball;
    const layout = ph.getCurrentHoleLayout();
    const flag = layout.flagPosition;
    return {
        shotType: s.getCurrentShotType(),
        club: s.getSelectedClub()?.name,
        ball: { x: +b.position.x.toFixed(2), y: +b.position.y.toFixed(3), z: +b.position.z.toFixed(2), visible: b.visible },
        surface: getSurfaceTypeAtPoint({ x: b.position.x, z: b.position.z }, layout),
        distToFlag: +Math.hypot(b.position.x - flag.x, b.position.z - flag.z).toFixed(2),
        // Resting height is contour-dependent, so compare against the
        // terrain under the ball, not an absolute number
        restOffset: +(b.position.y - (await import('./src/visuals.js')).queryTerrainHeight(b.position.x, b.position.z)).toFixed(3),
    };
});
console.log('setup:', JSON.stringify(setup));
if (setup.shotType !== 'putt') fail(`putting green should arm a putt, got '${setup.shotType}'`);
if (!/Putter/i.test(setup.club || '')) fail(`expected the putter, got '${setup.club}'`);
if (!setup.ball.visible) fail('ball not visible on the putting green');
if (setup.surface !== 'GREEN') fail(`ball placed on '${setup.surface}', not the green`);
// The ball must sit ON the putting surface: green layer offset 0.06 m plus
// the 0.021 m ball radius above the terrain under it. Anything far off that
// is a lie-offset regression (ball sunk into, or floating over, the green).
if (setup.restOffset < 0.04 || setup.restOffset > 0.14)
    fail(`ball rests ${setup.restOffset} m above the terrain — not sitting on the green`);
if (setup.distToFlag < 1 || setup.distToFlag > 40) fail(`default putt distance ${setup.distToFlag} m is not a putt`);

// Tempo + strike, driven IN-PAGE in one round trip: per-tap CDP latency is
// far larger than the beat and would grade every strike a mishit.
const before = await page.evaluate(async () => {
    const p = (await import('./src/visuals/core.js')).ball.position;
    return { x: p.x, z: p.z };
});
await page.evaluate(async () => {
    const key = (k) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
    };
    // Busy-wait, NOT setTimeout — see browser-smoke-chip.mjs. A throttled,
    // uneven sleep is graded as a wobbly tempo, which is what made this
    // suite's roll distance swing between 0.87 m and 2.69 m on identical code.
    const wait = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* hold */ } };
    for (let i = 0; i < 4; i++) { key('w'); wait(450); }
    key('i');
});
await page.screenshot({ path: OUT + 'shot3-tapping.png' });
const settled = await settle(['result', 'ready']);
if (!settled) fail('putt never settled');
await sleep(400);
await page.screenshot({ path: OUT + 'shot4-after-putt.png' });

const final = await page.evaluate(async ([bx, bz]) => {
    const core = await import('./src/visuals/core.js');
    const ph = await import('./src/modes/playHole.js');
    const { getSurfaceTypeAtPoint } = await import('./src/utils/gameUtils.js');
    const p = core.ball.position;
    const visuals = await import('./src/visuals.js');
    return {
        rolled: +Math.hypot(p.x - bx, p.z - bz).toFixed(2),
        restOffset: +(p.y - visuals.queryTerrainHeight(p.x, p.z)).toFixed(3),
        surface: getSurfaceTypeAtPoint({ x: p.x, z: p.z }, ph.getCurrentHoleLayout()),
    };
}, [before.x, before.z]);
console.log('putt: ', JSON.stringify(final), '| settled in', settled);
// With even taps this is deterministic: 18.2 m, run to run inside 6 cm. A
// 450 ms tempo ASKS for a long putt — that is the mechanism working, not a
// claim about green speed, which unit-conditions and shotphysics own. The old
// bounds were 0.3-45 m because throttled taps duffed the stroke to somewhere
// between 0.87 m and 2.69 m and nothing tighter could have held.
if (final.rolled < 10) fail(`putt was duffed (${final.rolled} m) — a 450 ms tempo asks for ~18 m`);
if (final.rolled > 30) fail(`putt rolled off the scale (${final.rolled} m)`);
if (final.restOffset < 0.04 || final.restOffset > 0.14)
    fail(`ball ended ${final.restOffset} m above the terrain — not resting on the surface`);

await browser.close();
if (missing.length) fail('404s:\n  ' + missing.slice(0, 5).join('\n  '));
if (errors.length) fail('page errors:\n  ' + errors.slice(0, 8).join('\n  '));
console.log(`browser-smoke-putt: PASS — ${setup.distToFlag} m putt rolled ${final.rolled} m, settled in ${settled}`);
