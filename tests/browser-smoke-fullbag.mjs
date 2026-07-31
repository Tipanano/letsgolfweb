// Full-bag distance characterization: every club through the REAL impact →
// flight → bounce → roll pipeline with a clean, ideal-length backswing at
// 100% power (the calibration reference), wind zero, fairway landing.
// Prints game numbers next to PGA-Tour carry references so recalibration is
// a diff, not a guess. Also characterizes the backswing-length power stack
// (ideal → bar max → full overswing) for driver and 7-iron.
//
// Envelope assertions: club ordering must be monotonic, gapping sane, and
// headline clubs inside their target bands. Tighten the bands when tuning.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync, execFileSync } = require('child_process');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(require.resolve('playwright', { paths: [globalRoot, '/usr/local/lib/node_modules'] }));

const BASE = 'http://localhost:8788';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true }));
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });

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

await page.goto(BASE + '/index.html?touch=1', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-practice', { timeout: 15000 });
await sleep(1000);
await page.evaluate(async () => {
    const main = await import('./src/main.js');
    const ui = await import('./src/ui.js');
    ui.showGameView();
    await main.setGameMode(main.GAME_MODES.PLAY_HOLE, null, null, 'chipping');
});
await sleep(4000);

const data = await page.evaluate(async () => {
    const phys = await import('./src/swingPhysics.js');
    const sim = await import('./src/gameLogic/simulation.js');
    const { clubs } = await import('./src/clubs.js');
    const state = await import('./src/gameLogic/state.js');
    state.setWind(0, 0);
    const BALL_R = 0.021336;

    function fly(impact, club) {
        const ballSpeedMPS = impact.ballSpeed * 0.44704;
        const launchRad = impact.launchAngle * Math.PI / 180;
        const vel = { x: 0, y: ballSpeedMPS * Math.sin(launchRad), z: ballSpeedMPS * Math.cos(launchRad) };
        const spinVec = { x: impact.backSpin, y: impact.sideSpin, z: 0 };
        const flight = sim.simulateFlightStepByStep({ x: 0, y: BALL_R, z: 0 }, vel, spinVec, club, []);
        const land = flight.landingPosition;
        const bounce = sim.simulateBouncePhase(land, flight.landingVelocity, flight.landingAngleRadians,
            flight.landingSpinRadPerSec, 'FAIRWAY', flight.timeOfFlight, null);
        const roll = sim.simulateGroundRoll(bounce.position, bounce.velocity, 'FAIRWAY',
            Math.abs(bounce.spin.x) * (60 / (2 * Math.PI)), bounce.spin.y * (60 / (2 * Math.PI)), bounce.endTime, null);
        const fp = roll.finalPosition;
        return {
            carry: flight.carryDistance,
            total: Math.hypot(fp.x, fp.z),
            descent: flight.landingAngleRadians * 180 / Math.PI,
            apex: flight.peakHeight,
        };
    }

    // Clean swing: ideal offsets scale with tempo (1/speed) for the taps
    // (× downswing stretch, which the physics' ideal windows use) and the
    // transition scales with tempo and backswing length only.
    const stretch = phys.getDownswingTimingStretch();
    function impactFor(clubKey, speed, backMult = 1.0, surface = 'FAIRWAY') {
        const back = (phys.IDEAL_BACKSWING_DURATION_MS / speed) * backMult;
        const t0 = 10000, tEnd = t0 + back;
        return phys.calculateImpactPhysics({
            backswingDuration: back,
            hipInitiationTime: tEnd + (phys.IDEAL_TRANSITION_OFFSET_MS / speed) * backMult,
            rotationStartTime: null,
            rotationInitiationTime: tEnd + ((phys.IDEAL_ROTATION_OFFSET_MS * stretch) / speed) * backMult,
            armsStartTime: tEnd + ((phys.IDEAL_ARMS_OFFSET_MS * stretch) / speed) * backMult,
            wristsStartTime: tEnd + ((phys.IDEAL_WRISTS_OFFSET_MS * stretch) / speed) * backMult,
            downswingPhaseStartTime: tEnd,
            idealBackswingEndTime: tEnd,
        }, clubs[clubKey], speed, 0, surface);
    }

    const BAG = ['DR', 'MD', 'W3', 'W5', 'W7', 'H3', 'H4', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'PW', 'AW50', 'GW54', 'SW58', 'LW60'];
    const bag = [];
    for (const key of BAG) {
        const surface = (clubs[key].type === 'driver' || clubs[key].type === 'wood') ? 'TEE' : 'FAIRWAY';
        const impact = impactFor(key, 1.0, 1.0, surface);
        const f = fly(impact, clubs[key]);
        bag.push({
            key, name: clubs[key].name,
            chs: +impact.actualCHS.toFixed(1), ball: +impact.ballSpeed.toFixed(1),
            launch: +impact.launchAngle.toFixed(1), spin: Math.round(impact.backSpin),
            carry: +f.carry.toFixed(1), total: +f.total.toFixed(1), descent: +f.descent.toFixed(0),
            apex: +f.apex.toFixed(1),
            strike: impact.strikeQuality,
        });
    }

    // Backswing power stack (driver + 7I): ideal, bar max, full overswing
    const stack = [];
    for (const [key, surface] of [['DR', 'TEE'], ['I7', 'FAIRWAY']]) {
        for (const [label, mult] of [['ideal', 1.0], ['barmax', 1500 / 1150], ['overswing', 2000 / 1150]]) {
            const impact = impactFor(key, 1.0, mult, surface);
            const f = fly(impact, clubs[key]);
            stack.push({ key, label, chs: +impact.actualCHS.toFixed(1), ball: +impact.ballSpeed.toFixed(1),
                         carry: +f.carry.toFixed(1), total: +f.total.toFixed(1) });
        }
    }
    return { bag, stack };
});

// PGA Tour average CARRY (yards) — TrackMan published averages. H3/H4 are
// interpolated by loft (TrackMan's hybrid row is a 15-18° club; ours are
// 20°/22°, sitting between the 7-wood and the long irons). MD interpolated.
// Sub-PW wedges deliberately sit under tour (game targets ~90-95% there).
const TOUR_CARRY_YD = {
    DR: 275, MD: 260, W3: 243, W5: 230, W7: 225, H3: 218, H4: 210,
    I3: 212, I4: 203, I5: 194, I6: 183, I7: 172, I8: 160, I9: 148,
    PW: 136, AW50: 125, GW54: 112, SW58: 100, LW60: 90,
};
const M2YD = 1.09361;

// TrackMan tour-average APEX ("max height", meters). Tour flights every club
// to a similar window (~25-30 m); short irons peak as high as the driver.
const TOUR_APEX_M = {
    DR: 29, MD: 28, W3: 27, W5: 28, W7: 28, H3: 27, H4: 27,
    I3: 25, I4: 26, I5: 28, I6: 28, I7: 29, I8: 28, I9: 28,
    PW: 27, AW50: 26, GW54: 24, SW58: 22, LW60: 21,
};

console.log('club            CHS   ball  launch  spin  | carry(m) total(m) desc apex(m)/tour | carry(yd) tour  Δ%');
for (const r of data.bag) {
    const cyd = r.carry * M2YD;
    const tour = TOUR_CARRY_YD[r.key];
    const delta = ((cyd / tour) - 1) * 100;
    console.log(`${r.name.padEnd(15)} ${String(r.chs).padStart(5)} ${String(r.ball).padStart(6)} ${String(r.launch).padStart(6)}° ${String(r.spin).padStart(5)} | ${String(r.carry).padStart(8)} ${String(r.total).padStart(8)} ${String(r.descent).padStart(4)}° ${String(r.apex).padStart(5)}/${String(TOUR_APEX_M[r.key]).padEnd(4)} | ${cyd.toFixed(0).padStart(8)} ${String(tour).padStart(5)} ${(delta >= 0 ? '+' : '') + delta.toFixed(0)}%`);
}
console.log('\nbackswing power stack (100% power):');
for (const r of data.stack) {
    console.log(`  ${r.key.padEnd(4)} ${r.label.padEnd(10)} CHS ${String(r.chs).padStart(6)}  ball ${String(r.ball).padStart(6)}  carry ${String(r.carry).padStart(6)}m  total ${String(r.total).padStart(6)}m (${(r.total * M2YD).toFixed(0)} yd)`);
}

// --- Envelope assertions ---
const byKey = Object.fromEntries(data.bag.map(r => [r.key, r]));
for (const r of data.bag) if (r.strike !== 'Center') fail(`${r.key}: clean swing graded ${r.strike}`);

// Ordering: each club must carry farther than the next shorter one
const ORDER = ['DR', 'W3', 'W5', 'H3', 'H4', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'PW', 'AW50', 'GW54', 'SW58', 'LW60'];
for (let i = 0; i + 1 < ORDER.length; i++) {
    if (!(byKey[ORDER[i]].carry > byKey[ORDER[i + 1]].carry))
        fail(`carry ordering broken: ${ORDER[i]} (${byKey[ORDER[i]].carry}) <= ${ORDER[i + 1]} (${byKey[ORDER[i + 1]].carry})`);
}
// Gapping: consecutive irons 5-18 m apart
for (const [a, b] of [['I5', 'I6'], ['I6', 'I7'], ['I7', 'I8'], ['I8', 'I9'], ['I9', 'PW']]) {
    const gap = byKey[a].carry - byKey[b].carry;
    if (gap < 5 || gap > 18) fail(`${a}→${b} gap ${gap.toFixed(1)} m out of range [5, 18]`);
}
// Headline bands (meters, carry, 100% clean ideal): tour-average target
const BANDS = { DR: [235, 260], I7: [145, 165], PW: [115, 130], LW60: [65, 80] };
for (const [key, [lo, hi]] of Object.entries(BANDS)) {
    const c = byKey[key].carry;
    if (c < lo || c > hi) fail(`${key} carry ${c} m outside target band [${lo}, ${hi}]`);
}
// Apex sanity: tour flights every club into a ~21-29 m window. Wide envelope
// so tuning can move within reason but a flat-liner or moonball fails.
// KNOWN GAP: the driver peaks ~24 m vs tour 29 — its launch (8.3°) is low vs
// tour (10.9°) with carry compensated by the flight model. Fixing that means
// re-working driver launch/spin generation, tracked separately.
for (const r of data.bag) {
    if (r.apex < 18 || r.apex > 34) fail(`${r.key} apex ${r.apex} m outside sanity envelope [18, 34]`);
}

// The full backswing stack must top out below long-drive territory
const drOver = data.stack.find(r => r.key === 'DR' && r.label === 'overswing');
if (drOver.total > 300) fail(`driver full-overswing total ${drOver.total} m (${(drOver.total * M2YD).toFixed(0)} yd) — above 300 m cap`);

await browser.close();
console.log('browser-smoke-fullbag: PASS');
