// Shot-physics characterization suite: runs the REAL impact → flight →
// bounce → roll pipeline for a matrix of shots (chips, pitches, full swings,
// a putt-speed roll) on the practice green layout with wind zeroed, and
// prints carry/roll/total for each. Envelope assertions guard against
// regressions in ANY shot class when tuning one of them.
//
// Method note: each case replicates the exact sequence calculateChipShot /
// calculateFullSwingShot use (same functions, same argument shapes) so the
// numbers match in-game results without needing input injection.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync, execFileSync } = require('child_process');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(require.resolve('playwright', { paths: [globalRoot, '/usr/local/lib/node_modules'] }));

const BASE = 'http://localhost:8788';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

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
// Load the practice green (real layout + green contour + terrain)
await page.evaluate(async () => {
    const main = await import('./src/main.js');
    const ui = await import('./src/ui.js');
    ui.showGameView();
    await main.setGameMode(main.GAME_MODES.PLAY_HOLE, null, null, 'chipping');
});
await sleep(4000);

const rows = await page.evaluate(async () => {
    const chip = await import('./src/chipPhysics.js');
    const phys = await import('./src/swingPhysics.js');
    const sim = await import('./src/gameLogic/simulation.js');
    const { clubs } = await import('./src/clubs.js');
    const state = await import('./src/gameLogic/state.js');
    const ph = await import('./src/modes/playHole.js');
    const { getSurfaceTypeAtPoint } = await import('./src/utils/gameUtils.js');

    state.setWind(0, 0); // determinism
    const layout = ph.getCurrentHoleLayout();
    const { GREEN_CENTER, GREEN_RADIUS } = await import('./src/modes/practiceGreen.js');
    const BALL_R = 0.021336;

    // Run flight+bounce+roll from given launch numbers — the same sequence
    // calculateChipShot/calculateFullSwingShot use.
    function fly(startPos, impact, club, layoutOverride = layout, forcedSurface = null) {
        const ballSpeedMPS = impact.ballSpeed * 0.44704;
        const launchRad = impact.launchAngle * Math.PI / 180;
        const vel = {
            x: 0,
            y: ballSpeedMPS * Math.sin(launchRad),
            z: ballSpeedMPS * Math.cos(launchRad),
        };
        const spinVec = { x: impact.backSpin, y: impact.sideSpin, z: 0 };
        const flight = sim.simulateFlightStepByStep(startPos, vel, spinVec, club, []);
        const land = flight.landingPosition;
        const landSurface = forcedSurface ||
            getSurfaceTypeAtPoint({ x: land.x, z: land.z }, layoutOverride) || 'FAIRWAY';
        const bounce = sim.simulateBouncePhase(
            land, flight.landingVelocity, flight.landingAngleRadians,
            flight.landingSpinRadPerSec, landSurface, flight.timeOfFlight, layoutOverride);
        const rollBs = Math.abs(bounce.spin.x) * (60 / (2 * Math.PI));
        const rollSs = bounce.spin.y * (60 / (2 * Math.PI));
        const roll = sim.simulateGroundRoll(
            bounce.position, bounce.velocity, landSurface, rollBs, rollSs, bounce.endTime, layoutOverride);
        const fp = roll.finalPosition;
        const carry = flight.carryDistance;
        const total = Math.hypot(fp.x - startPos.x, fp.z - startPos.z);
        const rollEntrySpeed = Math.hypot(bounce.velocity.x, bounce.velocity.z);
        return {
            carry: +carry.toFixed(1),
            roll: +(total - carry).toFixed(1),
            total: +total.toFixed(1),
            landSurface,
            ballMph: +impact.ballSpeed.toFixed(1),
            launch: +impact.launchAngle.toFixed(1),
            spin: Math.round(impact.backSpin),
            bounces: bounce.bounceCount,
            rollEntry: +rollEntrySpeed.toFixed(2),
            descent: +(flight.landingAngleRadians * 180 / Math.PI).toFixed(0),
        };
    }

    const out = [];

    // --- Rhythm chips/pitches: pure strike, steady tempo. Two-pass: measure
    // carry from a probe run, then place the start so the ball lands 2 m
    // INSIDE the green's front edge — the case the rollout question is about.
    const greenFrontZ = GREEN_CENTER.z - GREEN_RADIUS;
    const strike = (tempoMs) => ({ tempoMs, cv: 0.02, beatDeviationMs: 0, shapeDevFrac: null });
    for (const [label, clubKey, tempo, profile] of [
        ['LW60 chip short', 'LW60', 950, 'chip'],
        ['LW60 chip mid', 'LW60', 600, 'chip'],
        ['SW58 chip mid', 'SW58', 600, 'chip'],
        ['PW chip mid', 'PW', 600, 'chip'],
        ['LW60 pitch', 'LW60', 500, 'pitch'],
        ['PW pitch', 'PW', 550, 'pitch'],
    ]) {
        const impact = chip.calculateRhythmChipImpact(
            strike(tempo), clubs[clubKey], 0, 'FAIRWAY', chip.CHIP_PROFILES[profile]);
        const probe = fly({ x: 0, y: BALL_R, z: 8 }, impact, clubs[clubKey]);
        const start = { x: GREEN_CENTER.x, y: BALL_R, z: greenFrontZ + 2 - probe.carry };
        out.push({ label, ...fly(start, impact, clubs[clubKey]) });
    }

    // --- Full swings: ideal timings at 90% speed, landing far off the tiny
    // practice layout (surface detection falls back to FAIRWAY) ---
    const speed = 0.9;
    const stretch = phys.getDownswingTimingStretch();
    function fullImpact(clubKey) {
        const back = phys.IDEAL_BACKSWING_DURATION_MS / speed;
        const t0 = 10000;
        const tEnd = t0 + back;
        return phys.calculateImpactPhysics({
            backswingDuration: back,
            hipInitiationTime: tEnd + (phys.IDEAL_TRANSITION_OFFSET_MS * stretch) / speed,
            rotationStartTime: null,
            rotationInitiationTime: tEnd + (phys.IDEAL_ROTATION_OFFSET_MS * stretch) / speed,
            armsStartTime: tEnd + (phys.IDEAL_ARMS_OFFSET_MS * stretch) / speed,
            wristsStartTime: tEnd + (phys.IDEAL_WRISTS_OFFSET_MS * stretch) / speed,
            downswingPhaseStartTime: tEnd,
            idealBackswingEndTime: tEnd,
        }, clubs[clubKey], speed, 0, 'TEE');
    }
    for (const [label, clubKey, surf] of [
        ['7I full', 'I7', 'FAIRWAY'],
        ['7I full onto green', 'I7', 'GREEN'],
        ['Driver full', 'DR', 'FAIRWAY'],
        ['PW full onto green', 'PW', 'GREEN'],
    ]) {
        const impact = fullImpact(clubKey);
        out.push({ label, ...fly({ x: 0, y: BALL_R, z: 0 }, impact, clubs[clubKey], null, surf) });
    }

    // --- Wind sensitivity: same shots into an 8 m/s head/tail wind.
    // Short-game shots fly low, but a stiff wind must still matter. ---
    for (const [label, base, windDir] of [
        ['LW60 pitch HEAD', 'LW60 pitch', 0],
        ['LW60 pitch TAIL', 'LW60 pitch', 180],
        ['LW60 chip HEAD', 'LW60 chip mid', 0],
        ['7I full HEAD', '7I full', 0],
        ['Driver HEAD', 'Driver full', 0],
    ]) {
        state.setWind(8, windDir);
        if (base.includes('chip') || base.includes('pitch')) {
            const [, clubKey, tempo, profile] = {
                'LW60 pitch': [0, 'LW60', 500, 'pitch'],
                'LW60 chip mid': [0, 'LW60', 600, 'chip'],
            }[base];
            const impact = chip.calculateRhythmChipImpact(
                strike(tempo), clubs[clubKey], 0, 'FAIRWAY', chip.CHIP_PROFILES[profile]);
            const probe = fly({ x: 0, y: BALL_R, z: 8 }, impact, clubs[clubKey]);
            const start = { x: GREEN_CENTER.x, y: BALL_R, z: greenFrontZ + 2 - probe.carry };
            out.push({ label, ...fly(start, impact, clubs[clubKey]) });
        } else {
            const clubKey = base.startsWith('7I') ? 'I7' : 'DR';
            const impact = fullImpact(clubKey);
            out.push({ label, ...fly({ x: 0, y: BALL_R, z: 0 }, impact, clubs[clubKey], null, 'FAIRWAY') });
        }
        state.setWind(0, 0);
    }

    // --- Putt-speed ground roll from the green center (real green surface) ---
    {
        const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js');
        const start = new THREE.Vector3(GREEN_CENTER.x, BALL_R, GREEN_CENTER.z - 5);
        const v = new THREE.Vector3(0, 0, 2.0); // 2 m/s putt
        const roll = sim.simulateGroundRoll(start, v, 'GREEN', 100, 0, 0, layout);
        const d = Math.hypot(roll.finalPosition.x - start.x, roll.finalPosition.z - start.z);
        out.push({ label: 'Putt roll @2m/s', carry: 0, roll: +d.toFixed(1), total: +d.toFixed(1),
            landSurface: 'GREEN', ballMph: 4.5, launch: 0, spin: 0, bounces: 0, rollEntry: 2 });
    }

    return out;
});

console.log('label                | ball    launch  spin  | land surf     | carry  roll  total | desc  bounces rollEntry');
for (const r of rows) {
    console.log(
        `${r.label.padEnd(20)} | ${String(r.ballMph).padStart(5)}mph ${String(r.launch).padStart(5)}° ${String(r.spin).padStart(5)} | ${String(r.landSurface).padEnd(13)} | ${String(r.carry).padStart(5)} ${String(r.roll).padStart(5)} ${String(r.total).padStart(6)} | ${String(r.descent ?? '-').padStart(3)}°  ${r.bounces}      ${r.rollEntry} m/s`);
}

// --- Envelope assertions: each shot class stays in a sane band ---
const get = (label) => rows.find(r => r.label === label);
const errs = [];
const check = (label, fn, msg) => { const r = get(label); if (!r) errs.push(label + ' missing'); else if (!fn(r)) errs.push(`${label}: ${msg} (carry ${r.carry}, roll ${r.roll})`); };

// Chips landing on the green with a lofted wedge must CHECK UP: roll well
// under carry, never 2× carry.
check('LW60 chip short', r => r.landSurface === 'GREEN' && r.roll <= Math.max(4, r.carry * 0.8), 'lofted chip must not out-roll its carry');
check('LW60 chip mid', r => r.roll >= 0.7 && r.roll <= Math.max(5, r.carry * 0.9), 'lofted chip release out of band (dead-stop is flop-only)');
check('SW58 chip mid', r => r.roll <= Math.max(5, r.carry * 1.0), 'SW chip rollout too long');
// A PW runs out more than a LW — that ordering is the club choice
check('PW chip mid', r => r.roll >= 3 && r.roll > get('LW60 chip mid').roll, 'a PW bump-and-run must genuinely run');
check('LW60 pitch', r => r.roll <= Math.max(6, r.carry * 0.8), 'lofted pitch rollout too long');
// Full swings: sane carries and rollouts
check('7I full', r => r.carry > 100 && r.carry < 175 && r.roll >= 0 && r.roll < 40, '7I envelope');
check('7I full onto green', r => r.roll < 15, 'a spinning 7I into a green must bite');
check('Driver full', r => r.carry > 180 && r.carry < 280 && r.roll >= 8 && r.roll < 80, 'Driver envelope (a drive must also RUN — dig must not eat shallow landings)');
check('PW full onto green', r => r.roll < 10, 'a full wedge into a green must bite');
// Green speed: a 2 m/s putt rolls a few meters, not across the county
check('Putt roll @2m/s', r => r.roll > 1.5 && r.roll < 8, 'green speed off');
// Wind must matter in the short game too (8 m/s head/tail vs calm)
check('LW60 pitch HEAD', r => r.carry <= get('LW60 pitch').carry * 0.92, 'headwind must cost a pitch ≥8% carry');
check('LW60 pitch TAIL', r => r.carry >= get('LW60 pitch').carry + 0.5, 'tailwind must push a pitch');
check('LW60 chip HEAD', r => r.carry <= get('LW60 chip mid').carry - 0.3, 'headwind must shorten even a chip');
check('7I full HEAD', r => r.carry <= get('7I full').carry * 0.92, 'headwind must cost a 7I ≥8%');
check('Driver HEAD', r => r.carry <= get('Driver full').carry * 0.95, 'headwind must cost the driver');

await browser.close();
if (errs.length) fail('\n  ' + errs.join('\n  '));
console.log('browser-smoke-shotphysics: PASS');
