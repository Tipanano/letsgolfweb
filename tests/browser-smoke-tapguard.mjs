// A backswing is a hold. A tap is not a swing.
//
// The swing zone starts the backswing on press and ends it on release, so
// brushing it with a thumb did both in one go: a ~60 ms backswing became a
// real stroke, with a real score. The guard lives in endBackswing rather than
// in the touch layer, so a stray keypress is covered too.
//
// Run: node tests/browser-smoke-tapguard.mjs
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
const page = await browser.newPage({ viewport: { width: 500, height: 900 }, hasTouch: true });
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

// Minimal hole — this is about the swing state machine, not the scenery.
await page.evaluate(async () => {
    const main = await import('./src/main.js');
    const ui = await import('./src/ui.js');
    const box = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
    const HOLE = {
        name: 'Tap Guard', par: 4, lengthMeters: 200,
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
        { name: 'Tap Guard Course', par: 4, holes: [HOLE] });
    await new Promise(r => setTimeout(r, 1500));
    const state = await import('./src/gameLogic/state.js');
    state.setSelectedClub('DR');
});

/**
 * Holds the swing for exactly `ms` and returns the resulting state.
 *
 * The hold length is set by rewinding the backswing start stamp rather than
 * by sleeping: this sandbox throttles timers hard (a 50 ms setTimeout lands
 * nearer a second), so a slept "tap" is not a tap at all and the test would
 * pass no matter what the guard did.
 */
async function press(ms) {
    return page.evaluate(async (holdMs) => {
        const actions = await import('./src/gameLogic/actions.js');
        const state = await import('./src/gameLogic/state.js');
        const ph = await import('./src/modes/playHole.js');
        const before = { shots: ph.getDisplayShotNumber(), state: state.getGameState() };
        actions.startBackswing();
        const mid = state.getGameState();
        state.setBackswingStartTime(performance.now() - holdMs);
        actions.endBackswing();
        await new Promise(r => setTimeout(r, 50));
        // The abort clears the timing variables, so a null duration here is
        // itself evidence the swing was unwound rather than completed.
        const d = state.getBackswingDuration();
        return { holdMs, before, mid, after: state.getGameState(),
                 measured: d == null ? null : Math.round(d),
                 shots: ph.getDisplayShotNumber() };
    }, ms);
}

// --- 1. A stray tap must leave no trace -----------------------------------
const tap = await press(50);
console.log('50 ms tap  :', JSON.stringify(tap));
if (tap.mid !== 'backswing') fail(`the press did not start a backswing (state ${tap.mid}) — the fixture is wrong`);
if (tap.after !== 'ready') fail(`a 50 ms tap left the game in "${tap.after}" — it must return to ready`);
if (tap.shots !== tap.before.shots) fail(`a 50 ms tap changed the shot count ${tap.before.shots} -> ${tap.shots}`);

// Right at the boundary, still a tap.
const near = await press(180);
console.log('180 ms tap :', JSON.stringify(near));
if (near.after !== 'ready') fail(`a 180 ms press left the game in "${near.after}"`);

// --- 2. A real hold must still swing --------------------------------------
// Past the top of a full backswing the state machine either pauses at the top
// or moves into the downswing, depending on whether hips were pre-loaded.
const held = await press(600);
console.log('600 ms hold:', JSON.stringify(held));
if (held.after === 'ready')
    fail(`a 600 ms hold was thrown away as a tap — the guard is eating real swings`);
if (!/backswingPausedAtTop|downswing/i.test(held.after))
    fail(`a 600 ms hold ended in "${held.after}", expected the top of the backswing`);

// --- 3. The player keeps everything they had ------------------------------
const kept = await page.evaluate(async () => {
    const state = await import('./src/gameLogic/state.js');
    const c = state.getSelectedClub();
    return { club: typeof c === 'string' ? c : (c?.name || c?.id || null) };
});
if (!kept.club) fail('the abort cleared the selected club — the player should keep their setup');

await browser.close();
if (errors.length) fail('page errors:\n  ' + errors.slice(0, 5).join('\n  '));
console.log(`browser-smoke-tapguard: PASS — 50 ms and 180 ms presses return to ready with no stroke; ` +
    `600 ms reaches ${held.after}; club "${kept.club}" survives the abort`);
