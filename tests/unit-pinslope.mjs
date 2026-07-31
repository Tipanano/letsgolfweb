// Every hole across every bundled course must present a fair pin: the
// synthesized green contour's gradient AT the flag stays under a puttable
// grade (greenkeepers don't cut holes on slopes).
// Run: node tests/unit-pinslope.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { processHoleLayout } from '../src/holeLoader.js';

const MAX_PIN_SLOPE = 0.026; // clamp targets 2.5%; tiny numerical headroom

// Mirror of greenContours.js field math (tilt + Gaussian bumps; the collar
// feather is 1 at the flag, which always sits well inside innerRadius).
function gradientAtFlag(contour, flag) {
    let gx = contour.tilt?.dx ?? 0, gz = contour.tilt?.dz ?? 0;
    for (const b of (contour.bumps || [])) {
        const sigma = Math.max(0.5, (b.radius ?? 5) / 2);
        const dx = flag.x - b.x, dz = flag.z - b.z;
        const g = -b.height * Math.exp(-(dx * dx + dz * dz) / (2 * sigma * sigma)) / (sigma * sigma);
        gx += g * dx; gz += g * dz;
    }
    return Math.hypot(gx, gz);
}

const courseFiles = readdirSync(new URL('../courses/', import.meta.url))
    .filter(f => f.endsWith('.json'));
assert.ok(courseFiles.length >= 20, `expected the bundled course library, found ${courseFiles.length} files`);

let holes = 0, contoured = 0, maxSeen = 0, worst = '';
for (const file of courseFiles) {
    const course = JSON.parse(readFileSync(new URL(`../courses/${file}`, import.meta.url), 'utf8'));
    for (const raw of (course.holes || [])) {
        const layout = processHoleLayout(structuredClone(raw));
        if (!layout) continue;
        holes++;
        const c = layout.greenContour;
        const flag = layout.flagPosition;
        if (!c || !flag) continue;
        contoured++;
        const slope = gradientAtFlag(c, flag);
        if (slope > maxSeen) { maxSeen = slope; worst = `${file} hole ${raw.holeNumber || '?'}`; }
        assert.ok(slope <= MAX_PIN_SLOPE,
            `${file} hole ${raw.holeNumber || '?'}: pin slope ${(slope * 100).toFixed(1)}% > ${(MAX_PIN_SLOPE * 100).toFixed(1)}%`);
    }
}
assert.ok(contoured > 100, `expected contoured holes across the library, got ${contoured}`);
console.log(`unit-pinslope: ${contoured}/${holes} contoured holes checked, steepest pin ${(maxSeen * 100).toFixed(2)}% (${worst})`);
console.log('unit-pinslope: all assertions passed');
