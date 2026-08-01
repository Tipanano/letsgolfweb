// A green pad must not build a wall around the green.
//
// A green sits on a graded pad: the raw DEM under a small green can run 10%+
// where a ball cannot rest, so the pad replaces it with a near-level
// platform. Every centimetre it removes has to be handed back somewhere, and
// that used to be crammed into the contour's own 5 m collar. Asker's 2nd
// absorbed 0.93 m over about 7 m and spiked to a 27% wall in a ring around
// the green, while the hillside either side ran at 4-7%.
//
// It surfaced as a cosmetic complaint — hillshade is exaggerated 5x to make
// contours readable, so the wall painted a dark ring on the grass — but it
// was never only cosmetic. A 27% band right around a green kicks anything
// pitching short of it.
//
// WHAT IS MEASURED: the slope the pad ADDS, sampled with and without the
// grading at the same points. Natural steepness is not the pad's doing, and
// plenty of greens sit on genuinely severe ground.
//
// WHY A DISTRIBUTION AND NOT A PER-GREEN CAP: on cliff-edge greens — Pebble's
// 7th, Hevingen's 12th — the ground under the sample already runs 240-550%,
// and "added slope" against a near-vertical face is not a meaningful number.
// Capping every green would mean either failing on those forever or setting
// the bar so high it stops catching anything. The percentiles move decisively
// when the collar regresses (median 7.9% -> 24.5%), which is what this is for.
//
// Run: node tests/unit-greencollar.mjs
import { readFileSync, readdirSync } from 'fs';
import { setTerrainFromLayout, gradientAt } from '../src/greenContours.js';
// greenContour is SYNTHESISED at load time, not stored in the course file —
// probing the raw JSON finds no greens at all and passes vacuously.
import { processHoleLayout } from '../src/holeLoader.js';

const MAX_MEDIAN = 0.12;   // measured 0.079 — was 0.245 with the old collar
const MAX_P90 = 0.35;      // measured 0.222 — was 0.861
const CLIFF = 0.25;        // ignore samples where the ground is already this steep
const SWEEP_M = 35;        // past the pad's 30 m collar cap
const ANGLES = 48;

const peaks = [];
let samples = 0;

for (const file of readdirSync('courses').filter(f => f.endsWith('.json')).sort()) {
    const course = JSON.parse(readFileSync('courses/' + file, 'utf8'));
    course.holes.forEach((raw, i) => {
        const hole = processHoleLayout(raw);
        const c = hole.greenContour;
        if (!c?.center || !(c.outerRadius > 0)) return;
        // Bunkers stripped from both fields: their rims are meant to be steep
        // and would otherwise dominate every maximum.
        const flat = { ...hole, bunkers: [] };

        const ring = [];
        for (let d = c.innerRadius; d <= c.innerRadius + SWEEP_M; d += 1)
            for (let k = 0; k < ANGLES; k++) {
                const a = (k / ANGLES) * Math.PI * 2;
                ring.push({ d, x: c.center.x + Math.cos(a) * d, z: c.center.z + Math.sin(a) * d });
            }
        const slopesOf = (opts) => {
            setTerrainFromLayout(flat, opts);
            return ring.map(p => { const g = gradientAt(p.x, p.z); return g ? Math.hypot(g.x, g.z) : 0; });
        };
        const withPad = slopesOf({});
        const without = slopesOf({ skipGreenPad: true });

        let peak = 0, at = 0;
        for (let n = 0; n < ring.length; n++) {
            samples++;
            if (without[n] > CLIFF) continue;
            const added = withPad[n] - without[n];
            if (added > peak) { peak = added; at = ring[n].d; }
        }
        peaks.push({ peak, at, where: `${file} hole ${i + 1}` });
    });
}
setTerrainFromLayout(null);

peaks.sort((a, b) => a.peak - b.peak);
const at = (p) => peaks[Math.floor(peaks.length * p)];
const median = at(0.5).peak, p90 = at(0.9).peak;
const pct = (v) => (v * 100).toFixed(1) + '%';

console.log(`unit-greencollar: ${peaks.length} greens, ${samples} paired samples — ` +
    `pad adds median ${pct(median)}, p90 ${pct(p90)}, worst ${pct(peaks[peaks.length - 1].peak)} ` +
    `(${peaks[peaks.length - 1].where})`);

const failures = [];
if (median > MAX_MEDIAN) failures.push(`median added slope ${pct(median)} exceeds ${pct(MAX_MEDIAN)}`);
if (p90 > MAX_P90) failures.push(`p90 added slope ${pct(p90)} exceeds ${pct(MAX_P90)}`);
if (failures.length) {
    failures.forEach(f => console.error('  ✗ ' + f));
    console.error('  steepest few:');
    peaks.slice(-5).reverse().forEach(v => console.error(`    ${v.where}: +${pct(v.peak)} at ${v.at.toFixed(0)} m`));
    process.exit(1);
}
console.log('unit-greencollar: all assertions passed');
