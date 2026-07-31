// Course-conditions unit tests: bounds by stars, per-day determinism,
// neutral defaults, and neutral physics scales. Run: node tests/unit-conditions.mjs
import assert from 'node:assert/strict';
import {
    rollConditions, setConditions, setNeutralConditions, getConditions,
    conditionsLabel, firmnessWord,
    greenFrictionScale, turfFrictionScale, turfSoftnessScale,
    STIMP_BOUNDS_BY_STARS, FIRMNESS_BOUNDS_BY_STARS,
} from '../src/courseConditions.js';

// Neutral: scales are exactly 1 so every characterization suite is untouched
setNeutralConditions();
assert.equal(getConditions().stimp, 10);
assert.equal(getConditions().firmness, 0.5);
assert.equal(greenFrictionScale(), 1);
assert.equal(turfFrictionScale(), 1);
assert.equal(turfSoftnessScale(), 1);

// Bounds: many rolls per star tier stay inside that tier's bands.
// Augusta-class (5★) never rolls slow greens; a 1★ course never rolls 13.
for (let stars = 1; stars <= 5; stars++) {
    const [s0, s1] = STIMP_BOUNDS_BY_STARS[stars];
    const [f0, f1] = FIRMNESS_BOUNDS_BY_STARS[stars];
    for (let day = 1; day <= 60; day++) {
        const c = rollConditions(`Course ${stars}`, stars, `2026-07-${String((day % 28) + 1).padStart(2, '0')}x${day}`);
        assert.ok(c.stimp >= s0 && c.stimp <= s1, `${stars}★ stimp ${c.stimp} outside [${s0}, ${s1}]`);
        assert.ok(c.firmness >= f0 && c.firmness <= f1, `${stars}★ firmness ${c.firmness} outside [${f0}, ${f1}]`);
    }
}
assert.ok(STIMP_BOUNDS_BY_STARS[5][0] > STIMP_BOUNDS_BY_STARS[1][1] - 2.1, 'tiers overlap sanely');

// Determinism: same course + same day = same conditions; different day differs eventually
const a = rollConditions('Augusta National', 5, '2026-07-31');
const b = rollConditions('Augusta National', 5, '2026-07-31');
assert.deepEqual(a, b, 'same course+day must roll identical conditions');
let differed = false;
for (let d = 1; d <= 10; d++) {
    const c = rollConditions('Augusta National', 5, `2026-08-${String(d).padStart(2, '0')}`);
    if (c.stimp !== a.stimp || c.firmness !== a.firmness) { differed = true; break; }
}
assert.ok(differed, 'conditions must vary across days');

// Physics scales point the right way
setConditions({ stimp: 13, firmness: 0.9 }); // tournament fast + firm
assert.ok(greenFrictionScale() < 0.8, 'fast greens = less friction');
assert.ok(turfFrictionScale() < 1, 'firm turf = more runout');
assert.ok(turfSoftnessScale() < 1, 'firm turf = livelier bounce');
setConditions({ stimp: 8, firmness: 0.25 }); // soaked muni
assert.ok(greenFrictionScale() > 1.2, 'slow greens = more friction');
assert.ok(turfSoftnessScale() > 1.1, 'soft turf = deader bounce');

// Labels
setConditions({ stimp: 11, firmness: 0.8 });
assert.equal(conditionsLabel(), 'Stimp 11 · Firm');
assert.equal(firmnessWord(0.3), 'Soft');
assert.equal(firmnessWord(0.5), 'Medium');

setNeutralConditions();
console.log('unit-conditions: all assertions passed');
