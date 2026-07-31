// Ball-position difficulty model: forward stance = net-riskier contact that
// leans thin, back stance = net-safer contact that leans fat, clean strikes
// unaffected. Covers the rhythm chip/pitch model and the full-swing strike
// window (forward off turf tightens it; tee shots exempt).
// Run: node tests/unit-ballpos.mjs

import { calculateRhythmChipImpact, CHIP_PROFILES } from '../src/chipPhysics.js';
import { calculateImpactPhysics } from '../src/swingPhysics.js';
import { clubs } from '../src/clubs.js';

const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

// Deterministic randomness so the Monte-Carlo rates are stable run to run
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const realRandom = Math.random;
Math.random = mulberry32(1337);

// --- Rhythm pitch: mishit rates by stance for a slightly wobbly player ---
const N = 4000;
const rates = {};
for (const [label, factor] of [['forward', -1], ['center', 0], ['back', 1]]) {
    let mishits = 0, thins = 0, fats = 0;
    for (let i = 0; i < N; i++) {
        const r = calculateRhythmChipImpact(
            { tempoMs: 600, cv: 0.06, beatDeviationMs: (Math.random() - 0.5) * 120, shapeDevFrac: null },
            clubs.LW60, factor, 'FAIRWAY', CHIP_PROFILES.pitch);
        if (r.strikeQuality !== 'Center') mishits++;
        if (r.strikeQuality === 'Thin') thins++;
        if (r.strikeQuality === 'Fat' || r.strikeQuality === 'Duff') fats++;
    }
    rates[label] = { mishit: mishits / N, thin: thins / N, fatOrDuff: fats / N };
}
for (const [k, v] of Object.entries(rates))
    console.log(`  ${k.padEnd(8)} mishit ${(v.mishit * 100).toFixed(1)}%  (thin ${(v.thin * 100).toFixed(1)}%, fat/duff ${(v.fatOrDuff * 100).toFixed(1)}%)`);

if (!(rates.forward.mishit > rates.center.mishit + 0.05)) fail('forward stance not clearly riskier than center');
if (!(rates.back.mishit < rates.center.mishit + 0.03)) fail('back stance riskier than center');
if (!(rates.forward.thin > rates.center.thin)) fail('forward misses do not lean thin');
if (!(rates.back.fatOrDuff > rates.back.thin)) fail('back misses do not lean fat');

// Clean strikes: Center for every stance
for (const factor of [-1, 0, 1]) {
    const r = calculateRhythmChipImpact(
        { tempoMs: 600, cv: 0.0, beatDeviationMs: 0, shapeDevFrac: null },
        clubs.LW60, factor, 'FAIRWAY', CHIP_PROFILES.pitch);
    if (r.strikeQuality !== 'Center') fail(`clean rhythm strike not Center at factor ${factor}`);
}

// --- Full swing: forward off turf tightens the fat/thin wrist window ---
// swingSpeed 1 + ideal 1150ms backswing → no scaling; wrists 92ms early sits
// between the forward threshold (85ms) and the center threshold (100ms).
const T0 = 10000;
const timings = (wristsDevMs) => ({
    downswingPhaseStartTime: T0,
    backswingDuration: 1150,
    idealBackswingEndTime: T0,
    hipInitiationTime: T0 - 150,
    rotationStartTime: T0 + 50,
    armsStartTime: T0 + 100,
    wristsStartTime: T0 + 250 + wristsDevMs,
});
const quality = (dev, factor, surface) =>
    calculateImpactPhysics(timings(dev), clubs.I7, 1.0, factor, surface).strikeQuality;

if (quality(-92, 0, 'FAIRWAY') === 'Fat') fail('-92ms wrist miss should be inside the center-stance window');
if (quality(-92, -1, 'FAIRWAY') !== 'Fat') fail('-92ms wrist miss should be Fat with ball forward off turf');
if (quality(-92, -1, 'TEE') === 'Fat') fail('tee shots must be exempt from the forward tilt');
for (const f of [-1, 0, 1]) {
    if (quality(0, f, 'FAIRWAY') !== 'Center') fail(`clean full swing not Center at factor ${f}`);
}

Math.random = realRandom;
console.log('unit-ballpos: all assertions passed');
