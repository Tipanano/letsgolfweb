// A ball in the water must not be played from the water.
//
// It used to be: the next shot was taken from wherever the ball sank, with no
// penalty stroke, because resetSwing carried a "TODO: Implement drop option"
// and fell through to playing it as it lies. This drives the real path — the
// real shot handler, the real resetSwing, the real modal, the real buttons —
// and checks both choices land somewhere legal with the stroke added.
//
// Run: node tests/browser-smoke-waterdrop.mjs
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
const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
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

// Load a hole with water across the line of play.
const setup = await page.evaluate(async () => {
    const main = await import('./src/main.js');
    const ui = await import('./src/ui.js');
    const lib = await import('./src/courseLibrary.js');
    const ph = await import('./src/modes/playHole.js');
    const { getSurfaceTypeAtPoint } = await import('./src/utils/gameUtils.js');
    const course = await lib.loadCourse('courses/tpc-sawgrass.json');
    ui.showGameView();
    await main.setGameMode(main.GAME_MODES.PLAY_HOLE, null, null, null, course);
    await new Promise(r => setTimeout(r, 2000));
    // Rendering a hole is expensive (Sawgrass' water polygons especially), so
    // check the hole setGameMode already built before loading any others.
    const wetCount = (L) => {
        const t = L.tee.center, f = L.flagPosition;
        let wet = 0;
        for (let s = 0.05; s < 1; s += 0.02)
            if (getSurfaceTypeAtPoint({ x: t.x + (f.x - t.x) * s, z: t.z + (f.z - t.z) * s }, L) === 'WATER') wet++;
        return wet;
    };
    let wet = wetCount(ph.getCurrentHoleLayout());
    if (wet > 3) return { hole: 1, wetSamples: wet };
    for (let i = 1; i < course.holes.length; i++) {
        await ph.initializeHoleFromRawLayout(course.holes[i], { holeNumber: i + 1 });
        await new Promise(r => setTimeout(r, 700));
        wet = wetCount(ph.getCurrentHoleLayout());
        if (wet > 3) return { hole: i + 1, wetSamples: wet };
    }
    return null;
});
if (!setup) fail('no hole with water on the line of play — cannot test the drop');

// Hit it in the water, via the real shot handler.
async function splashIt() {
    return page.evaluate(async () => {
        const ph = await import('./src/modes/playHole.js');
        const { getSurfaceTypeAtPoint } = await import('./src/utils/gameUtils.js');
        const L = ph.getCurrentHoleLayout();
        const t = L.tee.center, f = L.flagPosition;
        const start = ph.getCurrentBallPosition();
        let wetAt = null;
        for (let s = 0.05; s < 1; s += 0.01) {
            const p = { x: t.x + (f.x - t.x) * s, z: t.z + (f.z - t.z) * s };
            if (getSurfaceTypeAtPoint(p, L) === 'WATER') { wetAt = p; break; }
        }
        const dx = f.x - t.x, dz = f.z - t.z, dl = Math.hypot(dx, dz);
        const splash = { x: wetAt.x + dx / dl * 8, y: 0, z: wetAt.z + dz / dl * 8 };
        const traj = [];
        for (let i = 0; i <= 80; i++)
            traj.push({ x: start.x + (splash.x - start.x) * i / 80, y: 0, z: start.z + (splash.z - start.z) * i / 80 });
        ph.handleShotResult({ finalPosition: splash, isHoledOut: false, surfaceName: 'WATER', trajectory: traj, timeOfFlight: 0.1 });
        await new Promise(r => setTimeout(r, 400));
        const actions = await import('./src/gameLogic/actions.js');
        const state = await import('./src/gameLogic/state.js');
        state.setGameState('result');
        actions.resetSwing();
        await new Promise(r => setTimeout(r, 300));
        const modal = document.getElementById('water-drop-modal');
        return {
            strokesBeforeChoice: ph.getDisplayShotNumber(),
            lie: ph.getCurrentLie(),
            splash: { x: +splash.x.toFixed(1), z: +splash.z.toFixed(1) },
            modalShown: !!modal,
            choices: modal ? [...modal.querySelectorAll('[data-choice]')].map(b => b.dataset.choice) : [],
            drop: ph.getPendingWaterDrop(),
        };
    });
}

async function choose(which) {
    return page.evaluate(async (choice) => {
        const ph = await import('./src/modes/playHole.js');
        const { getSurfaceTypeAtPoint } = await import('./src/utils/gameUtils.js');
        document.querySelector(`#water-drop-modal [data-choice="${choice}"]`)?.click();
        await new Promise(r => setTimeout(r, 400));
        const L = ph.getCurrentHoleLayout();
        const p = ph.getCurrentBallPosition();
        return {
            strokes: ph.getDisplayShotNumber(),
            lie: ph.getCurrentLie(),
            surfaceAtBall: getSurfaceTypeAtPoint({ x: p.x, z: p.z }, L),
            pos: { x: +p.x.toFixed(2), z: +p.z.toFixed(2) },
            modalGone: !document.getElementById('water-drop-modal'),
        };
    }, which);
}

// --- 1. Drop at the crossing ---------------------------------------------
const wet1 = await splashIt();
console.log('splashed:', JSON.stringify({ ...wet1, drop: undefined }));
if (!wet1.modalShown) fail('ball finished in the water and no drop was offered — it would be played from the lake');
if (wet1.lie !== 'WATER') fail(`lie after the splash is ${wet1.lie}, expected WATER`);
if (!wet1.choices.includes('drop') || !wet1.choices.includes('replay'))
    fail(`modal offered ${JSON.stringify(wet1.choices)}, expected both drop and replay`);
if (!wet1.drop?.dropPoint) fail('no drop point computed from the trajectory');

const dropped = await choose('drop');
console.log('took the drop:', JSON.stringify(dropped));
if (!dropped.modalGone) fail('modal stayed up after choosing');
if (dropped.surfaceAtBall === 'WATER' || dropped.surfaceAtBall === 'OUT_OF_BOUNDS')
    fail(`dropped into ${dropped.surfaceAtBall} — the drop must land on playable ground`);
if (dropped.lie !== dropped.surfaceAtBall)
    fail(`lie says ${dropped.lie} but the ball is on ${dropped.surfaceAtBall}`);
if (dropped.strokes !== wet1.strokesBeforeChoice + 1)
    fail(`penalty stroke not applied: ${wet1.strokesBeforeChoice} → ${dropped.strokes}`);

// --- 2. Replay the shot --------------------------------------------------
const before = await page.evaluate(async () => {
    const ph = await import('./src/modes/playHole.js');
    const p = ph.getCurrentBallPosition();
    return { pos: { x: +p.x.toFixed(2), z: +p.z.toFixed(2) }, lie: ph.getCurrentLie() };
});
const wet2 = await splashIt();
if (!wet2.modalShown) fail('second splash offered no drop');
const replayed = await choose('replay');
console.log('replayed:', JSON.stringify(replayed), 'played from', JSON.stringify(before));
if (replayed.surfaceAtBall === 'WATER') fail('replay left the ball in the water');
if (Math.hypot(replayed.pos.x - before.pos.x, replayed.pos.z - before.pos.z) > 0.5)
    fail(`replay put the ball at ${JSON.stringify(replayed.pos)}, expected the previous spot ${JSON.stringify(before.pos)}`);
if (replayed.lie !== before.lie)
    fail(`replay restored lie ${replayed.lie}, expected the previous lie ${before.lie}`);
if (replayed.strokes !== wet2.strokesBeforeChoice + 1)
    fail(`replay did not add a penalty stroke: ${wet2.strokesBeforeChoice} → ${replayed.strokes}`);

await browser.close();
if (errors.length) fail('page errors:\n  ' + errors.slice(0, 5).join('\n  '));
console.log(`browser-smoke-waterdrop: PASS — hole ${setup.hole}: splash offers both options; ` +
    `drop lands on ${dropped.surfaceAtBall} with the penalty stroke, replay restores the previous spot and lie`);
