// The rough gets deeper the further you miss.
//
// courseRough.js gave every course an ordered profile of grades, but only the
// LAST one was ever used — as the wide-miss background — because a corridor is
// a single LIGHT_ROUGH polygon and nested polygons would all have reported
// thick (getSurfaceTypeAtPoint checks thick before medium before light). So
// three of the game's four rough grades were dead across all 486 holes, and
// the profiles were mostly decoration.
//
// Grading by DISTANCE from the mown ground fixes that with no new geometry and
// no nesting order to get wrong. This test holds the two things that have to
// be true: the grades actually appear, and they appear in the right ORDER —
// gentler near the fairway, deeper further out.
//
// Order has to be judged PER COURSE, against that course's own profile. A
// penal course runs medium then thick, so its medium is the near band; a
// stepped course runs light, medium, thick, so its medium is the middle one.
// Pooling them across the library mixes those roles and produces a number that
// means nothing — the first version of this test did exactly that and reported
// medium sitting further out than thick.
//
// Run: node tests/unit-roughbands.mjs
import { readFileSync, readdirSync } from 'fs';
import { getSurfaceTypeAtPoint } from '../src/surfaceLookup.js';
import { processHoleLayout } from '../src/holeLoader.js';
import { isPointInPolygon } from '../src/pointInPolygon.js';
import { roughProfileFor } from '../src/courseRough.js';
import { boundariesFor } from '../src/roughBands.js';
import { edgeDistance, outsideBox } from '../src/polygonEdge.js';

const GRADES = ['LIGHT_ROUGH', 'MEDIUM_ROUGH', 'THICK_ROUGH', 'NATIVE_AREA'];
const V = (p) => p?.vertices || p?.controlPoints || null;

const seen = new Map();              // grade -> sample count, library-wide
const byCourse = new Map();          // course -> Map(grade -> {n, sum})
let holesGraded = 0, holes = 0, total = 0;

for (const file of readdirSync('courses').filter(f => f.endsWith('.json')).sort()) {
    const course = JSON.parse(readFileSync('courses/' + file, 'utf8'));
    const depths = new Map();
    byCourse.set(course.name, depths);

    for (const raw of course.holes) {
        const L = processHoleLayout(raw);
        // courseLibrary stamps this at load; the raw JSON carries no course
        // name, and without it every hole falls back to one neutral grade —
        // which would make this whole test pass while proving nothing.
        L.courseName = course.name;
        holes++;

        const mown = [...(L.fairways || []), ...(L.greens || []), L.tee].map(V).filter(v => v?.length >= 3);
        const nearestMown = (x, z) => {
            let best = Infinity;
            for (const v of mown) {
                if (best !== Infinity && outsideBox(x, z, v, best)) continue;
                const d = edgeDistance(x, z, v);
                if (d < best) best = d;
            }
            return best;
        };

        const gradesHere = new Set();
        for (const r of (L.lightRough || [])) {
            const v = V(r);
            if (!v || v.length < 3) continue;
            const xs = v.map(p => p.x), zs = v.map(p => p.z);
            for (let x = Math.min(...xs); x <= Math.max(...xs); x += 10)
                for (let z = Math.min(...zs); z <= Math.max(...zs); z += 10) {
                    if (!isPointInPolygon({ x, z }, v)) continue;
                    const s = getSurfaceTypeAtPoint({ x, z }, L);
                    if (!GRADES.includes(s)) continue;   // green/bunker/water layered over
                    const d = nearestMown(x, z);
                    if (!Number.isFinite(d)) continue;
                    seen.set(s, (seen.get(s) || 0) + 1);
                    total++;
                    gradesHere.add(s);
                    const acc = depths.get(s) || { n: 0, sum: 0 };
                    acc.n++; acc.sum += d;
                    depths.set(s, acc);
                }
        }
        if (gradesHere.size > 1) holesGraded++;
    }
}

// Per course: mean depth must rise with position in that course's profile.
let checked = 0, inverted = 0;
const examples = [];
for (const [name, depths] of byCourse) {
    const profile = roughProfileFor(name).filter(g => depths.has(g) && depths.get(g).n >= 20);
    for (let i = 1; i < profile.length; i++) {
        const a = depths.get(profile[i - 1]), b = depths.get(profile[i]);
        const ma = a.sum / a.n, mb = b.sum / b.n;
        checked++;
        if (ma >= mb) {
            inverted++;
            if (examples.length < 5)
                examples.push(`${name}: ${profile[i - 1]} averages ${ma.toFixed(1)} m out but ` +
                    `${profile[i]} only ${mb.toFixed(1)} m`);
        }
    }
}

console.log(`unit-roughbands: ${holes} holes, ${total} corridor samples`);
for (const g of GRADES) {
    const n = seen.get(g) || 0;
    if (n) console.log(`  ${g.padEnd(13)} ${String(n).padStart(7)} samples (${(100 * n / total).toFixed(1)}%)`);
}
console.log(`  ${holesGraded}/${holes} holes carry more than one grade; boundaries ` +
    `2-grade [${boundariesFor(2)}] m, 3-grade [${boundariesFor(3)}] m`);
console.log(`  per-course ordering: ${checked - inverted}/${checked} adjacent profile pairs run outward`);

const failures = [];
// Three of these four were dead before this change. If fewer than three carry
// real weight now, the grading is not reaching the corridor.
const live = GRADES.filter(g => (seen.get(g) || 0) > total * 0.01);
if (live.length < 3) failures.push(`only ${live.length} rough grades appear at all: ${live.join(', ')}`);
if (holesGraded < holes * 0.7)
    failures.push(`only ${holesGraded} of ${holes} holes have more than one grade of rough`);
if (checked < 20)
    failures.push(`only ${checked} profile pairs could be checked — the ordering test is not exercising anything`);
if (inverted > 0)
    failures.push(`${inverted} of ${checked} adjacent profile pairs run INWARD — the bands are reversed`);

if (failures.length) {
    failures.forEach(f => console.error('  ✗ ' + f));
    examples.forEach(e => console.error('    ' + e));
    process.exit(1);
}
console.log('unit-roughbands: all assertions passed');
