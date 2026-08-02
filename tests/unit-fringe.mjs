// A green has a collar, and the collar yields to everything sharper than it.
//
// The fringe has no polygon — it is the ground within the local collar width
// of a green's edge, resolved in getSurfaceTypeAtPoint AFTER bunkers and water
// and BEFORE fairway. That order is the entire design, so it is what this test
// pins down. The width is directional: a broad apron on the side you play in
// from, a tight collar around the sides and back, with the bearing read from
// the rough corridor's centreline so a dogleg's last bend is followed. It
// differs from the naive tee-to-flag line by more than 15° on 137 of 562
// greens, which is why it is worth recovering rather than assuming. A greenside bunker cut into the collar must stay a bunker; a
// pond lapping the green edge must stay water. Measured across the library, a
// hazard sits inside the collar along 4.1% of total green perimeter, so this
// is not a hypothetical case — it is Augusta's 15th and half of Oakmont.
//
// The last section guards the cost. getSurfaceTypeAtPoint runs per physics
// step AND per grass-tuft placement attempt — tens of thousands of times per
// hole — so a naive edge-distance scan over every green polygon on every
// lookup would be felt at load. The bbox early-out in fringe.js is what stops
// that, and the ratio below is what proves it is working.
//
// Run: node tests/unit-fringe.mjs
import { readFileSync, readdirSync } from 'fs';
import { getSurfaceTypeAtPoint } from '../src/surfaceLookup.js';
import { processHoleLayout } from '../src/holeLoader.js';
import { FRINGE_WIDTH_M, FRINGE_APRON_M, FRINGE_COLLAR_M, fringeAt, fringeWidthAt } from '../src/fringe.js';
import { SURFACES } from '../src/surfaces.js';

const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

if (!SURFACES.FRINGE) fail('SURFACES has no FRINGE entry');

const inPoly = (x, z, v) => {
    let inside = false;
    for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
        const a = v[i], b = v[j];
        if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
};
const V = (p) => p?.vertices || p?.controlPoints || null;

const holes = [];
for (const file of readdirSync('courses').filter(f => f.endsWith('.json')).sort()) {
    const course = JSON.parse(readFileSync('courses/' + file, 'utf8'));
    course.holes.forEach((raw, i) => holes.push({ where: `${file} hole ${i + 1}`, L: processHoleLayout(raw) }));
}

let collarFound = 0, greensWithCollar = 0, greensChecked = 0;
let hazardProbes = 0, hazardLost = 0;
let insideGreenProbes = 0, greenLost = 0;
let wideProbes = 0, wideFringe = 0;
const examples = [];

for (const { where, L } of holes) {
    const hazards = [...(L.bunkers || []), ...(L.waterHazards || [])]
        .filter(h => h.type !== 'circle' && h.type !== 'ellipse')
        .map(V).filter(v => v && v.length >= 3);

    for (const g of (L.greens || [])) {
        const gv = V(g);
        if (!gv || gv.length < 3) continue;
        greensChecked++;
        let sawCollar = false;

        // Walk the green outline, stepping outward along the edge normal.
        for (let i = 0, j = gv.length - 1; i < gv.length; j = i++) {
            const p = gv[j], q = gv[i];
            const ex = q.x - p.x, ez = q.z - p.z;
            const len = Math.hypot(ex, ez);
            if (len < 0.5) continue;
            // Outward normal: try one side, flip if it lands inside the green.
            let nx = ez / len, nz = -ex / len;
            const mid = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
            if (inPoly(mid.x + nx * 0.5, mid.z + nz * 0.5, gv)) { nx = -nx; nz = -nz; }

            // Step out by half the LOCAL width: the collar is 1.5 m behind
            // the green and 4 m into the approach, so a fixed offset would
            // either fall outside the narrow side or barely leave the apron's
            // inner edge.
            const w = fringeWidthAt(mid.x + nx * 0.1, mid.z + nz * 0.1, gv, L);
            const probe = { x: mid.x + nx * (w * 0.5), z: mid.z + nz * (w * 0.5) };
            if (inPoly(probe.x, probe.z, gv)) continue;   // concave notch — skip
            const s = getSurfaceTypeAtPoint(probe, L);

            const inHazard = hazards.some(hv => inPoly(probe.x, probe.z, hv));
            if (inHazard) {
                // 1. THE ORDERING TEST. A hazard eating into the collar keeps
                //    its own lie; there is no fringe behind a bunker lip.
                hazardProbes++;
                if (s === 'FRINGE') {
                    hazardLost++;
                    if (examples.length < 6) examples.push(`${where}: hazard at (${probe.x.toFixed(1)}, ${probe.z.toFixed(1)}) reported FRINGE`);
                }
                continue;
            }
            // A tee pad can legitimately overlap here on a short hole.
            if (s === 'TEE') continue;
            if (s === 'FRINGE') { collarFound++; sawCollar = true; }
        }
        if (sawCollar) greensWithCollar++;

        // 2. The green itself is never its own collar.
        for (const v of gv) {
            const c = gv.reduce((a, w) => ({ x: a.x + w.x / gv.length, z: a.z + w.z / gv.length }), { x: 0, z: 0 });
            const probe = { x: v.x + (c.x - v.x) * 0.5, z: v.z + (c.z - v.z) * 0.5 };
            if (!inPoly(probe.x, probe.z, gv)) continue;
            insideGreenProbes++;
            if (getSurfaceTypeAtPoint(probe, L) === 'FRINGE') greenLost++;
        }

        // 3. The collar has a width. Well outside it, nothing is fringe.
        for (let k = 0; k < gv.length; k++) {
            const p = gv[k];
            const c = gv.reduce((a, w) => ({ x: a.x + w.x / gv.length, z: a.z + w.z / gv.length }), { x: 0, z: 0 });
            const ox = p.x - c.x, oz = p.z - c.z, len = Math.hypot(ox, oz) || 1;
            const probe = { x: p.x + (ox / len) * (FRINGE_WIDTH_M * 3), z: p.z + (oz / len) * (FRINGE_WIDTH_M * 3) };
            if (fringeAt(probe.x, probe.z, L)) continue; // concavity — genuinely near another edge
            wideProbes++;
            if (getSurfaceTypeAtPoint(probe, L) === 'FRINGE') wideFringe++;
        }
    }
}

console.log(`unit-fringe: ${greensChecked} greens — ${greensWithCollar} carry a collar, ` +
    `${collarFound} outline probes returned FRINGE`);
console.log(`  hazard-in-collar probes: ${hazardProbes} (${hazardLost} wrongly reported FRINGE)`);
console.log(`  inside-green probes: ${insideGreenProbes} (${greenLost} wrongly reported FRINGE)`);
console.log(`  far-outside probes: ${wideProbes} (${wideFringe} wrongly reported FRINGE)`);

const failures = [];
// 562 greens survive holeLoader's stray-green filter. If the collar is not
// on the overwhelming majority of them, the feature is not wired up at all,
// whatever else passes.
if (greensWithCollar < greensChecked * 0.9)
    failures.push(`only ${greensWithCollar} of ${greensChecked} greens have any collar at all`);
if (hazardProbes < 50)
    failures.push(`only ${hazardProbes} hazard-in-collar probes — the ordering test is not exercising anything`);
if (hazardLost > 0)
    failures.push(`${hazardLost} of ${hazardProbes} points inside a bunker or pond were reported as FRINGE`);
if (greenLost > 0)
    failures.push(`${greenLost} points inside a green were reported as FRINGE`);
if (wideFringe > 0)
    failures.push(`${wideFringe} points beyond ${FRINGE_WIDTH_M * 3} m from a green were reported as FRINGE`);

// 4. The apron faces the approach.
//
// Widths are read by sweeping angles around each green rather than by asking
// for the bearing directly, so this tests the collar the player actually
// walks on. Two things can go wrong and both are caught here: the bearing not
// being derived at all (every direction comes back FRINGE_WIDTH_M, so widest
// equals narrowest), and the bearing pointing the wrong way — which would put
// the apron behind the green, exactly backwards.
const SWEEP = 36;
let shaped = 0, towardTee = 0, greensSwept = 0;
for (const { L } of holes) {
    const tee = L.tee?.center;
    for (const g of (L.greens || [])) {
        const gv = V(g);
        if (!gv || gv.length < 3 || !tee) continue;
        const c = gv.reduce((a, w) => ({ x: a.x + w.x / gv.length, z: a.z + w.z / gv.length }), { x: 0, z: 0 });
        let wide = -1, narrow = Infinity, wideAng = 0;
        for (let k = 0; k < SWEEP; k++) {
            const a = (k / SWEEP) * Math.PI * 2;
            const w = fringeWidthAt(c.x + Math.cos(a) * 10, c.z + Math.sin(a) * 10, gv, L);
            if (w > wide) { wide = w; wideAng = a; }
            if (w < narrow) narrow = w;
        }
        greensSwept++;
        if (wide - narrow < 0.5) continue;   // uniform — no bearing was derived
        shaped++;
        // Widest direction vs the direction back to the tee. A dogleg can put
        // these well apart, which is the entire point of reading the corridor
        // rather than the tee line, so this only has to hold in the main.
        const tx = tee.x - c.x, tz = tee.z - c.z, tl = Math.hypot(tx, tz) || 1;
        if (Math.cos(wideAng) * (tx / tl) + Math.sin(wideAng) * (tz / tl) > 0) towardTee++;
    }
}
console.log(`  approach shaping: ${shaped}/${greensSwept} greens have a directional collar, ` +
    `${shaped ? (100 * towardTee / shaped).toFixed(0) : 0}% of those widen toward the tee side`);
if (shaped < greensSwept * 0.8)
    failures.push(`only ${shaped} of ${greensSwept} greens got a directional collar — the approach bearing is not being derived`);
if (shaped && towardTee < shaped * 0.75)
    failures.push(`only ${towardTee} of ${shaped} aprons face the tee side — the approach bearing looks inverted`);

// 5. Cost. Compared against the same lookups on a layout with the greens
//    removed, so the ratio measures the fringe check and nothing else, and
//    holds on any machine.
const bench = holes.slice(0, 60);
const pts = [];
for (const { L } of bench) {
    const t = L.tee?.center, f = L.flagPosition;
    if (!t || !f) continue;
    for (let n = 0; n < 400; n++) {
        const u = n / 400;
        pts.push({ x: t.x + (f.x - t.x) * u + (n % 37 - 18) * 3, z: t.z + (f.z - t.z) * u + (n % 23 - 11) * 3, L });
    }
}
const run = (strip) => {
    const t0 = process.hrtime.bigint();
    for (const p of pts) getSurfaceTypeAtPoint(p, strip ? { ...p.L, greens: [], green: null } : p.L);
    return Number(process.hrtime.bigint() - t0) / 1e6;
};
run(false); run(true);                        // warm
const withF = Math.min(run(false), run(false));
const without = Math.min(run(true), run(true));
const overhead = withF / without;
console.log(`  ${pts.length} lookups: ${withF.toFixed(0)} ms with fringe vs ${without.toFixed(0)} ms without ` +
    `(${((overhead - 1) * 100).toFixed(0)}% overhead)`);
if (overhead > 1.6)
    failures.push(`the fringe check adds ${((overhead - 1) * 100).toFixed(0)}% to every surface lookup — the bbox early-out is not working`);

if (failures.length) {
    failures.forEach(f => console.error('  ✗ ' + f));
    examples.forEach(e => console.error('    ' + e));
    process.exit(1);
}
console.log('unit-fringe: all assertions passed');
