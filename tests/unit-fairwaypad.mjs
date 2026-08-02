// The fairway pad may flatten a fairway. It may not build a causeway.
//
// The pad exists to cap a fairway's CROSS slope: Pebble's 6th and 8th climb
// ground a ball cannot rest on, and grading them is the difference between a
// hole and a cliff. It does that by measuring how far the ground deviates from
// the hole's centreline and pulling the excess back.
//
// Which makes the centreline's own height profile the reference for the whole
// fairway, and that profile was being read from the recovered corridor
// centreline directly. corridorPolygon emits one vertex pair per corridor
// bend, so that line is a handful of points — a median of 158 m between them
// across the library, and 92 holes have exactly TWO, a single straight segment
// from tee to green. Interpolating height along it made the reference a
// straight RAMP, so every real undulation read as deviation and got corrected
// away: Augusta's 17th came out with its fairway 3.75 m above the ground
// either side, a raised causeway with a step down to the rough.
//
// WHAT IS MEASURED: the height the pad ADDS, sampled with and without it at
// the same points. The holes that matter most are the ones whose fairway was
// ALREADY inside the cap — the pad has no business moving those at all, and
// Augusta's 17th was one of them.
//
// Run: node tests/unit-fairwaypad.mjs
import { readFileSync, readdirSync } from 'fs';
import { setTerrainFromLayout, heightAt, gradientAt } from '../src/greenContours.js';
import { processHoleLayout } from '../src/holeLoader.js';
import { isPointInPolygon } from '../src/pointInPolygon.js';

// Mirrors MAX_FAIRWAY_CROSS_SLOPE in greenContours.js.
const CAP = 0.25;
const CALM_MAX = 2.5;     // measured 1.52 — Augusta 17 alone was 3.75
const CALM_P90 = 0.60;    // measured 0.29
const MEDIAN_MAX = 0.15;  // measured 0.00

const V = (p) => p?.vertices || p?.controlPoints;
const rows = [];

for (const file of readdirSync('courses').filter(f => f.endsWith('.json')).sort()) {
    const course = JSON.parse(readFileSync('courses/' + file, 'utf8'));
    course.holes.forEach((raw, i) => {
        const L = processHoleLayout(raw);
        L.courseName = course.name;
        const fws = (L.fairways || []).map(V).filter(v => v && v.length >= 3);
        if (!fws.length) return;

        const pts = [];
        for (const v of fws) {
            const xs = v.map(p => p.x), zs = v.map(p => p.z);
            for (let x = Math.min(...xs); x <= Math.max(...xs); x += 8)
                for (let z = Math.min(...zs); z <= Math.max(...zs); z += 8)
                    if (isPointInPolygon({ x, z }, v)) pts.push({ x, z });
        }
        if (pts.length < 5) return;

        setTerrainFromLayout(L);
        const withPad = pts.map(p => heightAt(p.x, p.z));
        setTerrainFromLayout(L, { skipFairwayPad: true });
        const without = pts.map(p => heightAt(p.x, p.z));
        // The natural steepness decides whether this hole NEEDED grading.
        const natural = pts.map(p => {
            const g = gradientAt(p.x, p.z);
            return g ? Math.hypot(g.x, g.z) : 0;
        }).sort((a, b) => a - b);

        rows.push({
            where: `${file} hole ${i + 1}`,
            lift: Math.max(...withPad.map((h, k) => Math.abs(h - without[k]))),
            natural: natural[Math.floor(natural.length * 0.95)],
        });
    });
}
setTerrainFromLayout(null);

const q = (arr, p) => {
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const lifts = rows.map(r => r.lift);
// Holes whose fairway is already inside the cap without any help.
const calm = rows.filter(r => r.natural < CAP);
const calmLifts = calm.map(r => r.lift);
const m = (v) => v.toFixed(2) + ' m';

console.log(`unit-fairwaypad: ${rows.length} holes with a fairway — pad lifts ` +
    `median ${m(q(lifts, 0.5))}, p90 ${m(q(lifts, 0.9))}, max ${m(q(lifts, 1))}`);
console.log(`  ${calm.length} already inside the ${(CAP * 100).toFixed(0)}% cap — ` +
    `their lift: median ${m(q(calmLifts, 0.5))}, p90 ${m(q(calmLifts, 0.9))}, max ${m(q(calmLifts, 1))}`);

const failures = [];
if (q(lifts, 0.5) > MEDIAN_MAX)
    failures.push(`median hole is lifted ${m(q(lifts, 0.5))} — the pad should do nothing on most holes`);
if (q(calmLifts, 0.9) > CALM_P90)
    failures.push(`p90 lift on already-playable fairways is ${m(q(calmLifts, 0.9))}, over ${m(CALM_P90)}`);
if (q(calmLifts, 1) > CALM_MAX)
    failures.push(`a fairway already inside the cap was lifted ${m(q(calmLifts, 1))} — that is a causeway`);
// The pad must still DO its job where the ground is genuinely severe, or the
// easiest way to pass everything above is to switch it off.
const steep = rows.filter(r => r.natural >= CAP);
if (steep.length && !steep.some(r => r.lift > 1))
    failures.push(`${steep.length} fairways are steeper than the cap and none was graded — the pad is inert`);

if (failures.length) {
    failures.forEach(f => console.error('  ✗ ' + f));
    console.error('  most lifted:');
    rows.slice().sort((a, b) => b.lift - a.lift).slice(0, 6).forEach(r =>
        console.error(`    ${r.where}: +${m(r.lift)} (natural p95 slope ${(r.natural * 100).toFixed(0)}%)`));
    process.exit(1);
}
console.log('unit-fairwaypad: all assertions passed');
