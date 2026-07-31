// Every green across every bundled course must be able to HOLD a ball: the
// full terrain field (DEM grid + green construction pad + putting contour)
// must stay below the grade where rolling friction can no longer stop a
// ball (~7% at fast-green friction; we demand margin). Sweeps flag, green
// center, and a ring of interior points on all ~450 holes — the node-side
// complement to browser-smoke-greens (which also rolls a real ball, on the
// harshest DEM course). Run: node tests/unit-greenrest.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { processHoleLayout } from '../src/holeLoader.js';
import { setTerrainFromLayout, gradientAt } from '../src/greenContours.js';

// Standard ray-cast (shapeUtils.js is browser-only — it imports THREE from CDN)
function isPointInPolygon(p, verts) {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        const a = verts[i], b = verts[j];
        if ((a.z > p.z) !== (b.z > p.z) &&
            p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
}

const MAX_FLAG_SLOPE = 0.05;    // pin area must putt fair
const MAX_CENTER_SLOPE = 0.055; // must hold even on tournament-fast greens
// Tier faces legitimately shed balls toward the flats, but they must be
// bounded, and the FLATS must dominate the green.
const MAX_INTERIOR_SLOPE = 0.085;   // hard cap even on a tier face
const RESTABLE_SLOPE = 0.055;       // holds even on tournament-fast greens
const MIN_RESTABLE_FRACTION = 0.7;  // of sampled interior points

const origLog = console.log;
console.log = () => {}; // holeLoader is chatty

const courseFiles = readdirSync(new URL('../courses/', import.meta.url))
    .filter(f => f.endsWith('.json'));

let holes = 0, worst = { slope: 0, where: '' };
const slopeAt = (x, z) => { const g = gradientAt(x, z); return g ? Math.hypot(g.x, g.z) : 0; };

for (const file of courseFiles) {
    const course = JSON.parse(readFileSync(new URL(`../courses/${file}`, import.meta.url), 'utf8'));
    let n = 0;
    for (const raw of (course.holes || [])) {
        n++;
        const layout = processHoleLayout(structuredClone(raw));
        const c = layout?.greenContour, flag = layout?.flagPosition;
        if (!c || !flag) continue;
        holes++;
        setTerrainFromLayout(layout);
        const id = `${file} hole ${n}`;

        const fs = slopeAt(flag.x, flag.z);
        const cs = slopeAt(c.center.x, c.center.z);
        if (fs > worst.slope) worst = { slope: fs, where: id + ' (flag)' };
        if (cs > worst.slope) worst = { slope: cs, where: id + ' (center)' };
        assert.ok(fs <= MAX_FLAG_SLOPE, `${id}: flag on ${(fs * 100).toFixed(1)}% slope`);
        assert.ok(cs <= MAX_CENTER_SLOPE, `${id}: green center on ${(cs * 100).toFixed(1)}% slope`);

        // Interior rings at 40% and 60% of the green radius — judged only at
        // points actually ON the putting surface (an elongated green's ring
        // can clip a greenside bunker bowl, which legitimately plunges)
        let restable = 0, sampled = 0;
        for (const frac of [0.4, 0.6]) {
            const r = Math.max(3, (c.innerRadius - 2) * frac);
            for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
                const px = c.center.x + Math.cos(a) * r, pz = c.center.z + Math.sin(a) * r;
                const onGreen = (layout.greens || []).some(g =>
                    g.vertices?.length >= 3 && isPointInPolygon({ x: px, z: pz }, g.vertices));
                if (!onGreen) continue;
                const s = slopeAt(px, pz);
                sampled++;
                if (s <= RESTABLE_SLOPE) restable++;
                if (s > worst.slope) worst = { slope: s, where: id + ' (interior)' };
                assert.ok(s <= MAX_INTERIOR_SLOPE,
                    `${id}: on-green point on ${(s * 100).toFixed(1)}% slope`);
            }
        }
        if (sampled >= 4) {
            assert.ok(restable / sampled >= MIN_RESTABLE_FRACTION,
                `${id}: only ${restable}/${sampled} on-green points can hold a ball`);
        }
    }
}
setTerrainFromLayout(null);
console.log = origLog;
assert.ok(holes > 400, `expected the full library, swept only ${holes} holes`);
console.log(`unit-greenrest: ${holes} greens swept across ${courseFiles.length} courses, steepest ${(worst.slope * 100).toFixed(1)}% at ${worst.where}`);
console.log('unit-greenrest: all assertions passed');
