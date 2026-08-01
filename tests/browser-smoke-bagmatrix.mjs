// Bag × swing-speed matrix: every club at every power setting through the
// REAL impact → flight → bounce → roll pipeline, reporting the launch
// numbers (clubhead/ball speed, smash, launch angle, BACKSPIN, spin per mph)
// alongside flight and ground results (apex, descent, carry, roll, total).
//
// This is the tuning bench for "how does clubhead speed move backspin" — the
// full-bag suite covers all clubs but only at 100%, and shot-physics covers
// rollout but at a fixed speed.
//
// Knobs (env vars):
//   BAGMATRIX_ALL=1                 sweep the whole bag (default: 7 clubs)
//   BAGMATRIX_CLUBS=DR,I7,PW        explicit club list
//   BAGMATRIX_SPEEDS=0.6,0.8,1.0    explicit speed list
// Run: node tests/browser-smoke-bagmatrix.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync, execFileSync } = require('child_process');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(require.resolve('playwright', { paths: [globalRoot, '/usr/local/lib/node_modules'] }));

const BASE = 'http://localhost:8788';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

const ALL_CLUBS = ['DR', 'MD', 'W3', 'W5', 'W7', 'H3', 'H4', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'PW', 'AW50', 'GW54', 'SW58', 'LW60'];
const CLUBS = process.env.BAGMATRIX_CLUBS ? process.env.BAGMATRIX_CLUBS.split(',')
    : process.env.BAGMATRIX_ALL ? ALL_CLUBS
    : ['DR', 'W3', 'I5', 'I7', 'I9', 'PW', 'SW58'];
const SPEEDS = process.env.BAGMATRIX_SPEEDS
    ? process.env.BAGMATRIX_SPEEDS.split(',').map(Number)
    : [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

// TrackMan PGA-Tour average backspin (rpm) at tour clubhead speed — the
// 100%-power reference. Values past PW are estimates (TrackMan publishes
// through the pitching wedge only).
const TOUR_SPIN = {
    DR: 2686, MD: 3100, W3: 3655, W5: 4350, W7: 4500, H3: 4440, H4: 4630,
    I3: 4630, I4: 4836, I5: 5361, I6: 6231, I7: 7097, I8: 7998, I9: 8647,
    PW: 9304, AW50: 9800, GW54: 10200, SW58: 10600, LW60: 10800,
};

const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true }));
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
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

const rows = await page.evaluate(async ([clubKeys, speeds]) => {
    const phys = await import('./src/swingPhysics.js');
    const sim = await import('./src/gameLogic/simulation.js');
    const { clubs } = await import('./src/clubs.js');
    const state = await import('./src/gameLogic/state.js');
    const cond = await import('./src/courseConditions.js');
    state.setWind(0, 0);            // determinism
    cond.setNeutralConditions();    // standard turf, so roll is comparable
    const BALL_R = 0.021336;
    const stretch = phys.getDownswingTimingStretch();

    // A clean, ideal-length swing at the given power setting
    function impactFor(clubKey, speed, surface) {
        const back = phys.IDEAL_BACKSWING_DURATION_MS / speed;
        const t0 = 10000, tEnd = t0 + back;
        return phys.calculateImpactPhysics({
            backswingDuration: back,
            hipInitiationTime: tEnd + phys.IDEAL_TRANSITION_OFFSET_MS / speed,
            rotationStartTime: null,
            rotationInitiationTime: tEnd + (phys.IDEAL_ROTATION_OFFSET_MS * stretch) / speed,
            armsStartTime: tEnd + (phys.IDEAL_ARMS_OFFSET_MS * stretch) / speed,
            wristsStartTime: tEnd + (phys.IDEAL_WRISTS_OFFSET_MS * stretch) / speed,
            downswingPhaseStartTime: tEnd,
            idealBackswingEndTime: tEnd,
        }, clubs[clubKey], speed, 0, surface);
    }

    function fly(impact, club) {
        const mps = impact.ballSpeed * 0.44704;
        const rad = impact.launchAngle * Math.PI / 180;
        const vel = { x: 0, y: mps * Math.sin(rad), z: mps * Math.cos(rad) };
        const flight = sim.simulateFlightStepByStep(
            { x: 0, y: BALL_R, z: 0 }, vel, { x: impact.backSpin, y: impact.sideSpin, z: 0 }, club, []);
        const bounce = sim.simulateBouncePhase(
            flight.landingPosition, flight.landingVelocity, flight.landingAngleRadians,
            flight.landingSpinRadPerSec, 'FAIRWAY', flight.timeOfFlight, null);
        const roll = sim.simulateGroundRoll(
            bounce.position, bounce.velocity, 'FAIRWAY',
            Math.abs(bounce.spin.x) * (60 / (2 * Math.PI)),
            bounce.spin.y * (60 / (2 * Math.PI)), bounce.endTime, null);
        const fp = roll.finalPosition;
        const total = Math.hypot(fp.x, fp.z);
        return {
            carry: flight.carryDistance,
            roll: total - flight.carryDistance,
            total,
            apex: flight.peakHeight,
            descent: flight.landingAngleRadians * 180 / Math.PI,
        };
    }

    const out = [];
    for (const key of clubKeys) {
        const club = clubs[key];
        const surface = (club.type === 'driver' || club.type === 'wood') ? 'TEE' : 'FAIRWAY';
        for (const speed of speeds) {
            const impact = impactFor(key, speed, surface);
            const f = fly(impact, club);
            out.push({
                key, name: club.name, loft: club.loft, speed,
                chs: +impact.actualCHS.toFixed(1),
                ball: +impact.ballSpeed.toFixed(1),
                smash: +(impact.ballSpeed / impact.actualCHS).toFixed(3),
                launch: +impact.launchAngle.toFixed(1),
                spin: Math.round(impact.backSpin),
                spinPerMph: +(impact.backSpin / impact.ballSpeed).toFixed(1),
                apex: +f.apex.toFixed(1),
                descent: +f.descent.toFixed(0),
                carry: +f.carry.toFixed(1),
                roll: +f.roll.toFixed(1),
                total: +f.total.toFixed(1),
                strike: impact.strikeQuality,
            });
        }
    }
    return out;
}, [CLUBS, SPEEDS]);
await browser.close();

// --- Report, grouped by club ---
const M2YD = 1.09361;
for (const key of CLUBS) {
    const club = rows.filter(r => r.key === key);
    if (!club.length) continue;
    const c0 = club[0];
    const tour = TOUR_SPIN[key];
    console.log(`\n${c0.name} (${c0.loft}° loft)   tour backspin ref: ${tour} rpm`);
    console.log('  power   CHS    ball  smash  launch    spin  rpm/mph |  apex  desc |  carry   roll  total   (yd)');
    for (const r of club) {
        console.log(
            `   ${String(Math.round(r.speed * 100)).padStart(3)}%  ${String(r.chs).padStart(5)}  ${String(r.ball).padStart(6)}  ${r.smash.toFixed(2)}  ${String(r.launch).padStart(5)}°  ${String(r.spin).padStart(6)}   ${String(r.spinPerMph).padStart(6)} | ${String(r.apex).padStart(5)} ${String(r.descent).padStart(4)}° | ${String(r.carry).padStart(6)} ${String(r.roll).padStart(6)} ${String(r.total).padStart(6)}  (${Math.round(r.total * M2YD)})`);
    }
}

// --- Invariants (characterization: change them deliberately) ---
for (const r of rows) {
    if (r.strike !== 'Center') fail(`${r.key} @${r.speed}: clean swing graded ${r.strike}`);
}
for (const key of CLUBS) {
    const club = rows.filter(r => r.key === key).sort((a, b) => a.speed - b.speed);
    for (let i = 1; i < club.length; i++) {
        if (!(club[i].carry > club[i - 1].carry))
            fail(`${key}: carry did not grow from ${club[i - 1].speed} to ${club[i].speed} (${club[i - 1].carry} → ${club[i].carry})`);
        if (!(club[i].spin > club[i - 1].spin))
            fail(`${key}: backspin did not grow with speed (${club[i - 1].spin} → ${club[i].spin} rpm)`);
    }
    // The model is spin = k(loft) · ballSpeed · sin(spinLoft): for one club at
    // a clean strike the spin-per-mph is CONSTANT, i.e. spin scales linearly
    // with speed. If this ever fails, the spin model gained a speed term —
    // update the test deliberately.
    const ratios = club.map(r => r.spinPerMph);
    const spread = (Math.max(...ratios) - Math.min(...ratios)) / Math.min(...ratios);
    if (spread > 0.02)
        fail(`${key}: spin/ball-speed ratio varies ${(spread * 100).toFixed(1)}% across the speed range — spin is no longer linear in speed`);
}
// Loft ordering at full power: more loft = more spin
const full = rows.filter(r => r.speed === Math.max(...SPEEDS)).sort((a, b) => a.loft - b.loft);
for (let i = 1; i < full.length; i++) {
    if (!(full[i].spin > full[i - 1].spin))
        fail(`spin/loft ordering broken at full power: ${full[i - 1].key} (${full[i - 1].spin}) ≥ ${full[i].key} (${full[i].spin})`);
}
console.log(`\nbrowser-smoke-bagmatrix: PASS — ${CLUBS.length} clubs × ${SPEEDS.length} speeds`);
