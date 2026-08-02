// A rehearsal is not a stroke.
//
// Tempo is the hardest thing this game asks of a new player, and the only way
// to practise it used to be to spend real shots. A practice swing runs the
// whole input sequence and the whole impact calculation — that is the point,
// it is what produces the tempo and clubhead-speed feedback — and then stops
// before the flight simulation.
//
// So the assertions are about what must NOT happen: the ball does not move,
// the shot count does not rise, and the swing report still appears. Any one of
// those failing turns a practice aid into a way to lose strokes. The last
// section is the one that matters most for trusting the toggle: turning it off
// again has to give back a real shot.
//
// Run: node tests/browser-smoke-practiceswing.mjs
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
const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
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

// Minimal hole — this is about the swing pipeline, not the scenery.
await page.evaluate(async () => {
    const main = await import('./src/main.js');
    const ui = await import('./src/ui.js');
    const box = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
    const HOLE = {
        name: 'Rehearsal', par: 4, lengthMeters: 200,
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
        { name: 'Rehearsal Course', par: 4, holes: [HOLE] });
    await new Promise(r => setTimeout(r, 1500));
    const state = await import('./src/gameLogic/state.js');
    state.setSelectedClub('DR');
});

/**
 * Plays one complete full swing and reports what it changed.
 *
 * Timings are set by rewinding timestamps rather than by sleeping: this
 * sandbox throttles timers hard (a 50 ms setTimeout lands nearer a second), so
 * a slept sequence produces a duffed swing at best and would tell us nothing
 * about whether the ball was supposed to move.
 */
async function swing(settleMs = 400) {
    const out = await page.evaluate(async (settle) => {
        const actions = await import('./src/gameLogic/actions.js');
        const state = await import('./src/gameLogic/state.js');
        const ph = await import('./src/modes/playHole.js');
        const core = await import('./src/visuals/core.js');

        const pos = () => ({ x: +core.ball.position.x.toFixed(2), z: +core.ball.position.z.toFixed(2) });
        const before = { shots: ph.getDisplayShotNumber(), ball: pos() };

        // resetSwing clears the club and this synthetic hole has no caddie
        // distances to auto-pick from, so re-arm it before every swing.
        if (!state.getSelectedClub()) state.setSelectedClub('DR');
        const trace = { start: state.getGameState() };
        actions.startBackswing();
        trace.afterStart = state.getGameState();
        state.setBackswingStartTime(performance.now() - 700);
        actions.endBackswing();
        await new Promise(r => setTimeout(r, 60));
        trace.afterEnd = state.getGameState();

        // Drive the downswing beats directly — the key handlers only forward
        // to these, and a real keypress sequence cannot be timed here.
        const t = performance.now();
        actions.recordHipInitiation();
        actions.startDownswingPhase();
        actions.recordDownswingKey('rotation', t + 5);
        actions.recordDownswingKey('arms', t + 90);
        actions.recordDownswingKey('wrists', t + 160);
        trace.beforeCalc = state.getGameState();
        actions.triggerFullSwingCalc();
        // A real shot animates for seconds; a rehearsal settles at once. Poll
        // rather than sleep a fixed time, so neither case is guessed at.
        const deadline = Date.now() + settle;
        while (Date.now() < deadline && state.getGameState() !== 'result')
            await new Promise(r => setTimeout(r, 100));

        return {
            before, trace,
            after: { shots: ph.getDisplayShotNumber(), ball: pos() },
            state: state.getGameState(),
        };
    }, settleMs);
    return out;
}

const setArmed = (on) => page.evaluate(async (v) => {
    const ps = await import('./src/practiceSwing.js');
    ps.setPracticeSwingArmed(v);
    return ps.isPracticeSwingArmed();
}, on);

// --- 1. Armed: the swing happens, the ball does not ------------------------
if (await setArmed(true) !== true) fail('the practice swing toggle would not arm');
const rehearsal = await swing();
console.log('rehearsal :', JSON.stringify(rehearsal));
const moved = Math.hypot(rehearsal.after.ball.x - rehearsal.before.ball.x,
                         rehearsal.after.ball.z - rehearsal.before.ball.z);
if (moved > 0.05) fail(`a practice swing moved the ball ${moved.toFixed(2)} m — it must stay put`);
if (rehearsal.after.shots !== rehearsal.before.shots)
    fail(`a practice swing counted a stroke (${rehearsal.before.shots} -> ${rehearsal.after.shots})`);
if (rehearsal.state !== 'result')
    fail(`a practice swing left the game in "${rehearsal.state}" — it must settle so (n) works`);

// --- 2. The feedback is the whole output, so it has to be there ------------
const status = await page.evaluate(() => document.getElementById('status-text-display')?.textContent || '');
console.log('status    :', JSON.stringify(status.slice(0, 90)));
if (!/practice swing/i.test(status))
    fail(`the status line does not mention the practice swing: "${status.slice(0, 90)}"`);
if (!/mph clubhead/i.test(status))
    fail(`the practice swing reported no clubhead speed: "${status.slice(0, 90)}"`);

// --- 3. Disarmed: a real shot must come back ------------------------------
await page.evaluate(async () => (await import('./src/gameLogic/actions.js')).resetSwing());
await sleep(400);
if (await setArmed(false) !== false) fail('the practice swing toggle would not disarm');
const real = await swing(20000);
console.log('real shot :', JSON.stringify(real));
const realMoved = Math.hypot(real.after.ball.x - real.before.ball.x,
                             real.after.ball.z - real.before.ball.z);
if (realMoved < 5)
    fail(`with the toggle off the ball only moved ${realMoved.toFixed(2)} m — the rehearsal is eating real shots`);

await browser.close();
if (errors.length) fail('page errors:\n  ' + errors.slice(0, 5).join('\n  '));
console.log(`browser-smoke-practiceswing: PASS — rehearsal moved the ball ${moved.toFixed(2)} m, ` +
    `a real shot moved it ${realMoved.toFixed(1)} m`);
