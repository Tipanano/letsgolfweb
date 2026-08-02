// A rehearsal is not a stroke.
//
// Tempo is the hardest thing this game asks of a new player, and the only way
// to practise it used to be to spend real shots. A practice swing runs the
// whole input sequence and the whole impact calculation — that is the point,
// it is what produces the tempo and clubhead-speed feedback — and then stops
// before the flight simulation.
//
// So the assertions are about what must NOT happen: the ball does not move,
// the shot count does not rise, and the feedback still appears. Any one of
// those failing turns a practice aid into a way to lose strokes. The last
// section is the one that matters most for trusting the toggle: turning it off
// again has to give back a real shot.
//
// The toggle lives AT ADDRESS, not in the setup panel, and the detail modal
// opens after every rehearsal. Both are checked here because both are easy to
// break silently: a toggle that never appears is unreachable, and a rehearsal
// whose numbers never render looks like a swing that did nothing.
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
        // The choice is made once the club moves; the chip must not sit over
        // the swing.
        trace.toggleDuringSwing =
            !!document.getElementById('practice-swing-toggle')?.classList.contains('visible');
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

// --- 0. The toggle is at address, and only at address ----------------------
const toggleAt = async (label) => page.evaluate(() => {
    const el = document.getElementById('practice-swing-toggle');
    return { exists: !!el, visible: !!el?.classList.contains('visible'),
             armed: !!el?.classList.contains('armed'), text: el?.textContent || '' };
});
await page.evaluate(async () => {
    const hud = await import('./src/ui/rhythmPuttHud.js');
    hud.showAddressHint('full', { hasClub: true });
});
const atAddress = await toggleAt();
console.log('at address:', JSON.stringify(atAddress));
if (!atAddress.exists) fail('there is no practice-swing toggle in the DOM');
if (!atAddress.visible) fail('the practice-swing toggle is not shown at address');

// Reviewing a result is not address, and a putt has no swing report to give.
for (const [type, why] of [['next', 'while reviewing a result'], ['putt', 'for a putt']]) {
    await page.evaluate(async (t) => {
        const hud = await import('./src/ui/rhythmPuttHud.js');
        hud.showAddressHint(t, { hasClub: true });
    }, type);
    const t = await toggleAt();
    if (t.visible) fail(`the practice-swing toggle is still shown ${why}`);
}
// And it must survive the player muting the instruction hints, since the pill
// it sits beside disappears entirely in that mode.
const muted = await page.evaluate(async () => {
    const hud = await import('./src/ui/rhythmPuttHud.js');
    if (hud.swingHintsShown()) hud.toggleSwingHints();
    hud.showAddressHint('full', { hasClub: true });
    const el = document.getElementById('practice-swing-toggle');
    const pill = document.getElementById('rhythm-putt-hud');
    const out = { toggle: !!el?.classList.contains('visible'),
                  pill: !!pill?.classList.contains('visible') };
    if (!hud.swingHintsShown()) hud.toggleSwingHints();   // put it back
    return out;
});
console.log('hints muted:', JSON.stringify(muted));
if (!muted.toggle) fail('muting the hints also hid the practice-swing toggle');

// Clicking it arms it — the control has to work, not just exist.
await page.evaluate(async () => {
    const hud = await import('./src/ui/rhythmPuttHud.js');
    hud.showAddressHint('full', { hasClub: true });
    document.getElementById('practice-swing-toggle').click();
});
const clicked = await toggleAt();
console.log('after click:', JSON.stringify(clicked));
if (!clicked.armed) fail('clicking the toggle did not arm it');
if (!/no ball/i.test(clicked.text)) fail(`an armed toggle must say so — it reads "${clicked.text}"`);
await page.evaluate(() => document.getElementById('practice-swing-toggle').click());

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
if (rehearsal.trace.toggleDuringSwing)
    fail('the practice toggle stayed on screen once the backswing had started');

// --- 2. The feedback is the whole output, so it has to be there ------------
const status = await page.evaluate(() => document.getElementById('status-text-display')?.textContent || '');
console.log('status    :', JSON.stringify(status.slice(0, 90)));
if (!/practice swing/i.test(status))
    fail(`the status line does not mention the practice swing: "${status.slice(0, 90)}"`);
// The status stays SHORT on purpose — the long version overflowed the status
// pill on a phone and was clipped mid-sentence. The numbers live on the card.
if (status.length > 60)
    fail(`the status line is ${status.length} chars and will be clipped: "${status}"`);

// Every beat, every time — including the ones that were fine. A player who
// cannot tell "hips good" from "hips not measured" learns nothing.
const cardText = () => page.evaluate(() => {
    const el = document.getElementById('practice-swing-card');
    return el && el.classList.contains('visible') ? el.textContent.replace(/\s+/g, ' ') : null;
});
const detail = await cardText();
console.log('card      :', detail ? JSON.stringify(detail.slice(0, 150)) : 'MISSING');
if (!detail) fail('no practice-swing card appeared');
for (const beat of ['Hips', 'Rotation', 'Arms', 'Wrists'])
    if (!detail.includes(beat)) fail(`the card never mentions ${beat}: "${detail.slice(0, 200)}"`);
if (!/Clubhead/i.test(detail)) fail('the card shows no clubhead speed');
if (!/Backswing/i.test(detail)) fail('the card shows no backswing length');
// Dismiss it before the next swing.
await page.evaluate(() => document.querySelector('#practice-swing-card .ps-dismiss')?.click());
await sleep(300);
if (await cardText()) fail('the card would not dismiss');

// --- 3. A chip is not a swing, and must not be reported as one -------------
//
// A rhythm chip has no hips, rotation, arms or wrists beat. It has a tapped
// tempo that sets the carry and one strike tap against that beat. Running it
// through the full-swing layout reported all four beats as "missed" on every
// practice chip — not a bad swing, the wrong question.
await page.evaluate(async () => (await import('./src/gameLogic/actions.js')).resetSwing());
await sleep(400);
await setArmed(true);
const chip = await page.evaluate(async () => {
    const actions = await import('./src/gameLogic/actions.js');
    const state = await import('./src/gameLogic/state.js');
    const ph = await import('./src/modes/playHole.js');
    const core = await import('./src/visuals/core.js');
    state.setSelectedClub('PW');
    state.setShotType('chip');
    const before = { shots: ph.getDisplayShotNumber(),
                     ball: { x: +core.ball.position.x.toFixed(2), z: +core.ball.position.z.toFixed(2) } };
    // Four taps establish the tempo, then the strike lands on the next beat.
    //
    // Busy-wait, not setTimeout: this sandbox throttles timers so hard that a
    // 60 ms sleep lands nearer a second, which stretched the taps past the
    // rhythm's expiry window and left the chip stuck in chipRhythm with
    // nothing armed. A spin loop gives the module the real intervals it is
    // measuring.
    const spin = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* wait */ } };
    for (let i = 0; i < 4; i++) { actions.recordChipRhythmTap(); spin(300); }
    actions.strikeRhythmChip();
    for (let i = 0; i < 30 && state.getGameState() !== 'result'; i++)
        await new Promise(r => setTimeout(r, 100));
    return { before,
             after: { shots: ph.getDisplayShotNumber(),
                      ball: { x: +core.ball.position.x.toFixed(2), z: +core.ball.position.z.toFixed(2) } },
             state: state.getGameState() };
});
const chipCard = await cardText();
console.log('chip      :', JSON.stringify(chip));
console.log('chip card :', chipCard ? JSON.stringify(chipCard.slice(0, 150)) : 'MISSING');
if (!chipCard) fail('a practice chip produced no card');
for (const beat of ['Hips', 'Rotation', 'Arms', 'Wrists'])
    if (chipCard.includes(beat))
        fail(`a practice CHIP was reported with the full-swing beat "${beat}": "${chipCard.slice(0, 200)}"`);
if (!/Tempo/i.test(chipCard)) fail(`a practice chip reported no tempo: "${chipCard.slice(0, 200)}"`);
if (!/Strike/i.test(chipCard)) fail(`a practice chip reported no strike timing: "${chipCard.slice(0, 200)}"`);
const chipMoved = Math.hypot(chip.after.ball.x - chip.before.ball.x, chip.after.ball.z - chip.before.ball.z);
if (chipMoved > 0.05) fail(`a practice chip moved the ball ${chipMoved.toFixed(2)} m`);
if (chip.after.shots !== chip.before.shots) fail('a practice chip counted a stroke');
await page.evaluate(() => document.querySelector('#practice-swing-card .ps-dismiss')?.click());
await page.evaluate(async () => {
    const state = await import('./src/gameLogic/state.js');
    state.setShotType('full');
});

// --- 4. Disarmed: a real shot must come back ------------------------------
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
