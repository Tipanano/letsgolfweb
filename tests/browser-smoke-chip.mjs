// Browser smoke test: rhythm chipping on the practice green (desktop keys).
// Covers the flow end to end — the chipping green arms a chip with a wedge,
// a tempo + strike actually launches the ball, and BOTH shape paths resolve:
// with a shape tap, and without one (the shape window has to time out and
// fire the shot anyway — the original reason this test existed).
//
// Note on assertions: this sandbox throttles timers hard (a 420 ms interval
// lands at ~1000 ms), so the tempo a test can produce — and therefore the
// shot's power and distance — is not controllable. Distances are bounded
// loosely, just enough to prove the ball was struck and that it is a chip
// rather than a full swing; the exact numbers are characterized in
// tests/browser-smoke-shotphysics.mjs, which drives the physics directly.
// Run: node tests/browser-smoke-chip.mjs
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
page.on('pageerror', e => { if (!EXPECTED.test(e.message)) errors.push('PAGEERROR: ' + e.message); });
page.on('console', m => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push('CONSOLE: ' + m.text().slice(0, 150)); });

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
// The Practice card expands a submenu, then pick the chipping green
await page.click('#mode-btn-practice');
await page.waitForSelector('#mode-btn-chipping', { state: 'visible', timeout: 5000 });
await page.click('#mode-btn-chipping');
if (!await settle(['ready'], 20000)) fail('chipping green never reached the ready state');
await sleep(1200); // placement + camera settle
await page.screenshot({ path: OUT + 'chip1-loaded.png' });

const setup = await page.evaluate(async () => {
    const s = await import('./src/gameLogic/state.js');
    const core = await import('./src/visuals/core.js');
    return {
        shotType: s.getCurrentShotType(),
        club: s.getSelectedClub()?.name,
        ball: { x: +core.ball.position.x.toFixed(2), z: +core.ball.position.z.toFixed(2), visible: core.ball.visible },
    };
});
console.log('setup:', JSON.stringify(setup));
if (setup.shotType !== 'chip') fail(`chipping green should arm a chip, got '${setup.shotType}'`);
if (!setup.club || /Putter/i.test(setup.club)) fail(`expected a wedge on the chipping green, got '${setup.club}'`);
if (!setup.ball.visible) fail('ball not visible on the chipping green');

/**
 * Taps a tempo and strikes, optionally adding the shape tap. The whole
 * rhythm runs IN-PAGE in one round trip — per-tap CDP latency is far larger
 * than the beat, which would grade every strike a duff.
 */
async function playChip({ withShapeTap }) {
    const before = await page.evaluate(async () => {
        const p = (await import('./src/visuals/core.js')).ball.position;
        return { x: p.x, z: p.z };
    });
    await page.evaluate(async (shape) => {
        const key = (k) => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
        };
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 4; i++) { key('w'); await wait(420); }
        key('i');                                   // strike on the beat
        if (shape) { await wait(180); key('i'); }   // shape tap
    }, withShapeTap);
    const settled = await settle(['result', 'ready']);
    if (!settled) fail(`chip never settled (${withShapeTap ? 'shaped' : 'stock'})`);
    await sleep(300);
    return page.evaluate(async ([bx, bz]) => {
        const p = (await import('./src/visuals/core.js')).ball.position;
        return {
            travelled: +Math.hypot(p.x - bx, p.z - bz).toFixed(2),
            status: document.getElementById('status-text-display')?.textContent?.trim() || '',
        };
    }, [before.x, before.z]);
}

// 1) Stock chip: no shape tap — the shape window must time out and still fire
const stock = await playChip({ withShapeTap: false });
console.log('stock chip: ', JSON.stringify(stock));
await page.screenshot({ path: OUT + 'chip3-result.png' });
if (stock.travelled < 0.5) fail(`stock chip never left the ground (${stock.travelled} m)`);
if (stock.travelled > 60) fail(`stock chip flew like a full swing (${stock.travelled} m)`);

// 2) Shaped chip: a second 'i' after the strike adds curve
await page.keyboard.press('n');
if (!await settle(['ready'], 15000)) fail("'n' did not return to ready for the next chip");
await sleep(500);
const shaped = await playChip({ withShapeTap: true });
console.log('shaped chip:', JSON.stringify(shaped));
await page.screenshot({ path: OUT + 'chip4-stock.png' });
if (shaped.travelled < 0.5) fail(`shaped chip never left the ground (${shaped.travelled} m)`);
if (shaped.travelled > 60) fail(`shaped chip flew like a full swing (${shaped.travelled} m)`);

await browser.close();
if (errors.length) fail('page errors:\n  ' + errors.slice(0, 8).join('\n  '));
console.log(`browser-smoke-chip: PASS — stock ${stock.travelled} m, shaped ${shaped.travelled} m`);
