// Water sits at its own waterline, and never over anything you play from.
//
// A flat water sheet used to be placed at the MINIMUM bank height found
// anywhere around the polygon rim. The OSM polygon IS the waterline — that is
// what the mapper drew — so the rim's variation is DEM noise, and taking the
// minimum of a noisy signal biases low every single time. Across the library
// water sat a median 0.47 m below its own median bank, 1.25 m at p90, 2.14 m
// at worst.
//
// That is also what drew the hard line across Augusta's 15th. A sheet two
// metres down in a bathtub still has to meet the shore somewhere, and where a
// flat plane cuts a uniformly sloping bank the intersection is a straight
// contour — a ruler-straight line across the middle of the creek.
//
// The level now comes from the MEDIAN rim height. That raises water across the
// course, which is exactly the change that could put a pond over a green, so
// the second half of this test is the guard: no playable surface may sit under
// any water sheet.
//
// Run: node tests/unit-waterline.mjs
import { readFileSync, readdirSync } from 'fs';
import { setTerrainFromLayout, bankLevelAt, getWaterSheets } from '../src/greenContours.js';
import { processHoleLayout } from '../src/holeLoader.js';

const MAX_MEDIAN_BELOW_BANK = 0.35;   // measured 0.18 — was 0.47
const MAX_P90_BELOW_BANK = 1.20;      // measured 0.91 — was 1.25
const FLOOD_TOLERANCE = 0.02;         // m of slop before a surface counts as flooded
// A sheet only exists inside its own polygon, so ground far away is never
// under it however low it sits. What matters is the shoreline neighbourhood:
// water standing visibly higher than the green beside it. Matches the reach
// of the guard in greenContours.
const SHORE_REACH_M = 8;

const inPoly = (x, z, v) => {
    let inside = false;
    for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
        const a = v[i], b = v[j];
        if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
};

const depths = [];
const flooded = [];
let bodies = 0, probes = 0;

for (const file of readdirSync('courses').filter(f => f.endsWith('.json')).sort()) {
    const course = JSON.parse(readFileSync('courses/' + file, 'utf8'));
    course.holes.forEach((raw, hi) => {
        const hole = processHoleLayout(raw);
        if (!(hole.waterHazards || []).length) return;
        setTerrainFromLayout(hole);
        const sheets = getWaterSheets();

        hole.waterHazards.forEach((w, i) => {
            const v = w.vertices || w.controlPoints;
            const sheet = sheets[i];
            if (!v || v.length < 3 || sheet?.mode !== 'flat') return;
            bodies++;

            // 1. The waterline belongs at the rim the mapper drew. The sea is
            //    excluded: its level is mean sea level, not a rim statistic.
            if (!w.sea) {
                const banks = v.map(p => bankLevelAt(p.x, p.z)).sort((a, b) => a - b);
                depths.push(banks[Math.floor(banks.length / 2)] - sheet.y);
            }

            // 2. Nothing you play from may be under it. Points inside the
            //    water polygon are mapping overlap — the hazard already
            //    outranks fairway there — so they are not "flooded".
            const edgeDist = (x, z) => {
                let best = Infinity;
                for (let a = 0, b = v.length - 1; a < v.length; b = a++) {
                    const p = v[a], q = v[b];
                    const ex = q.x - p.x, ez = q.z - p.z, L = ex * ex + ez * ez;
                    const t = L ? Math.max(0, Math.min(1, ((x - p.x) * ex + (z - p.z) * ez) / L)) : 0;
                    best = Math.min(best, Math.hypot(x - (p.x + ex * t), z - (p.z + ez * t)));
                }
                return best;
            };
            const check = (poly, what) => {
                if (!poly || poly.length < 3) return;
                for (const p of poly) {
                    if (inPoly(p.x, p.z, v)) continue;
                    if (edgeDist(p.x, p.z) > SHORE_REACH_M) continue;
                    probes++;
                    const ground = bankLevelAt(p.x, p.z);
                    if (ground < sheet.y - FLOOD_TOLERANCE)
                        flooded.push(`${file} hole ${hi + 1}: ${what} sits ${(sheet.y - ground).toFixed(2)} m ` +
                            `under a water sheet at ${sheet.y.toFixed(2)}`);
                }
            };
            (hole.greens || []).forEach((g, n) => check(g.vertices || g.controlPoints, `green ${n}`));
            (hole.fairways || []).forEach((f, n) => check(f.vertices || f.controlPoints, `fairway ${n}`));
            (hole.bunkers || []).forEach((b, n) => check(b.vertices || b.controlPoints, `bunker ${n}`));
            check(hole.tee?.vertices, 'the tee');
        });
    });
}
setTerrainFromLayout(null);

depths.sort((a, b) => a - b);
const at = (p) => depths[Math.floor(depths.length * p)];
const median = at(0.5), p90 = at(0.9);
const m = (v) => v.toFixed(2) + ' m';

console.log(`unit-waterline: ${bodies} flat water bodies, ${probes} playable-surface probes — ` +
    `water sits below its median bank by ${m(median)} (p90 ${m(p90)}, worst ${m(depths[depths.length - 1])})`);

const failures = [];
if (median > MAX_MEDIAN_BELOW_BANK) failures.push(`median ${m(median)} below the rim exceeds ${m(MAX_MEDIAN_BELOW_BANK)}`);
if (p90 > MAX_P90_BELOW_BANK) failures.push(`p90 ${m(p90)} below the rim exceeds ${m(MAX_P90_BELOW_BANK)}`);
if (flooded.length) failures.push(`${flooded.length} playable points are under water`);
if (failures.length) {
    failures.forEach(f => console.error('  ✗ ' + f));
    flooded.slice(0, 10).forEach(f => console.error('    ' + f));
    process.exit(1);
}
console.log('unit-waterline: all assertions passed');
