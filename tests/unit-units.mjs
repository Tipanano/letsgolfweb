// Unit tests for the distance-unit preference: default by locale, persistence,
// change notification, and the formatters every HUD distance goes through.
// Run: node tests/unit-units.mjs
import assert from 'node:assert/strict';

// A fake browser: Norwegian locale, working localStorage.
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
Object.defineProperty(globalThis, 'navigator', { value: { language: 'nb-NO' }, configurable: true });

const U = await import('../src/utils/unitConversions.js');

// --- default from locale ---
assert.equal(U.getDistanceUnit(), 'm', 'nb-NO defaults to meters');
assert.equal(U.formatDist(149.3), '149 m');
assert.equal(U.formatDist(2.46, 1), '2.5 m');
assert.equal(U.formatCourseLength(6420), '6.4 km');
assert.equal(U.distanceValue(100), 100);
assert.equal(U.metersFromDisplay(100), 100);

// --- toggle + notification + persistence ---
let seen = null;
const off = U.onDistanceUnitChange(u => { seen = u; });
assert.equal(U.toggleDistanceUnit(), 'yd');
assert.equal(seen, 'yd', 'listener fired with the new unit');
assert.equal(store.get('distanceUnit'), 'yd', 'choice persisted');
assert.equal(U.formatDist(100), '109 yd');
assert.equal(U.formatDist(100, 1), '109.4 yd');
assert.equal(U.formatCourseLength(6420), '7,021 yd');
assert.ok(Math.abs(U.metersFromDisplay(109.361) - 100) < 1e-6, 'round-trips through yards');
off();
U.setDistanceUnit('m');
assert.equal(seen, 'yd', 'unsubscribed listener stays quiet');

// --- invalid input is ignored, non-numbers format as a dash ---
assert.equal(U.setDistanceUnit('furlongs'), 'm');
assert.equal(U.formatDist('N/A'), '–');
assert.equal(U.formatDist(NaN), '–');

// --- explicit legacy formatters keep their pinned unit ---
assert.equal(U.formatDistance(100, 'yards', 0), '109 yd');
assert.equal(U.formatDistance(100, 'meters', 0), '100 m');

console.log('unit-units: all assertions passed');
