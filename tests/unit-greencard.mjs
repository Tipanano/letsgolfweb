// Unit tests for the Green Card drill engine. Run: node tests/unit-greencard.mjs
import assert from 'node:assert/strict';

// careerStore-style localStorage shim so the module runs under node
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
// Drill messages format distances in the player's unit; pin meters so the
// assertions don't depend on the runtime's locale (node reports en-US).
store.set('distanceUnit', 'm');

const {
    DRILLS, LAG_PUTT_TOLERANCE_M, DRIVING_MIN_DISTANCE_M,
    evaluateDrillShot, nextSpot, drillLaunchConfig, getProgress,
    startDrill, stopDrill, getActiveDrill, recordShot,
} = await import('../src/career/greenCard.js');
const { GREEN_CENTER, GREEN_RADIUS, PRACTICE_FLAG, PRACTICE_BUNKERS } =
    await import('../src/modes/practiceGreen.js');

const d2 = (x1, z1, x2, z2) => Math.hypot(x1 - x2, z1 - z2);

// --- evaluateDrillShot ---
assert.ok(evaluateDrillShot('driving', { lie: 'FAIRWAY', holed: false, distToFlag: 80, shotDistance: DRIVING_MIN_DISTANCE_M + 10 }));
assert.ok(!evaluateDrillShot('driving', { lie: 'FAIRWAY', holed: false, distToFlag: 130, shotDistance: DRIVING_MIN_DISTANCE_M - 40 })); // fairway but short
assert.ok(!evaluateDrillShot('driving', { lie: 'FAIRWAY', holed: false, distToFlag: 150 })); // no distance reported = short
assert.ok(!evaluateDrillShot('driving', { lie: 'LIGHT_ROUGH', holed: false, distToFlag: 80, shotDistance: 240 })); // long but crooked
assert.ok(evaluateDrillShot('approach', { lie: 'GREEN', holed: false, distToFlag: 8 }));
assert.ok(evaluateDrillShot('approach', { lie: 'HOLE', holed: true, distToFlag: 0 })); // ace counts
assert.ok(!evaluateDrillShot('chipping', { lie: 'BUNKER', holed: false, distToFlag: 4 }));
assert.ok(evaluateDrillShot('bunker', { lie: 'GREEN', holed: false, distToFlag: 6 }));
assert.ok(evaluateDrillShot('lagputt', { lie: 'GREEN', holed: false, distToFlag: LAG_PUTT_TOLERANCE_M }));
assert.ok(!evaluateDrillShot('lagputt', { lie: 'GREEN', holed: false, distToFlag: LAG_PUTT_TOLERANCE_M + 0.1 }));
assert.ok(!evaluateDrillShot('lagputt', { lie: 'LIGHT_ROUGH', holed: false, distToFlag: 1 })); // off-green lag fails
assert.ok(evaluateDrillShot('holing', { lie: 'HOLE', holed: true, distToFlag: 0 }));
assert.ok(!evaluateDrillShot('holing', { lie: 'GREEN', holed: false, distToFlag: 0.2 }));

// --- nextSpot placement invariants (randomized: sample repeatedly) ---
for (let i = 0; i < 200; i++) {
    const chip = nextSpot('chipping', i);
    const rGreen = d2(chip.x, chip.z, GREEN_CENTER.x, GREEN_CENTER.z);
    assert.ok(rGreen >= GREEN_RADIUS + 4.9 && rGreen <= GREEN_RADIUS + 10.1, `chip r ${rGreen}`);
    assert.ok(!PRACTICE_BUNKERS.some(b => d2(chip.x, chip.z, b.x, b.z) < b.r), 'chip in bunker');
    assert.equal(chip.shotType, 'chip');

    const bunker = nextSpot('bunker', i);
    assert.ok(PRACTICE_BUNKERS.some(b => d2(bunker.x, bunker.z, b.x, b.z) <= b.r), 'bunker spot outside bunkers');
    assert.equal(bunker.lie, 'BUNKER');
    assert.equal(bunker.club, 'SW58'); // sand shots get the sand wedge

    const pitch = nextSpot('pitching', i);
    const pitchDist = d2(pitch.x, pitch.z, PRACTICE_FLAG.x, PRACTICE_FLAG.z);
    assert.ok(pitchDist >= 24.9 && pitchDist <= 45.1, `pitch dist ${pitchDist}`);
    assert.ok(d2(pitch.x, pitch.z, GREEN_CENTER.x, GREEN_CENTER.z) > GREEN_RADIUS + 2.9, 'pitch spot on/near green');
    assert.ok(!PRACTICE_BUNKERS.some(b => d2(pitch.x, pitch.z, b.x, b.z) < b.r), 'pitch in bunker');
    assert.equal(pitch.shotType, 'pitch');
    assert.equal(pitch.club, 'AW50');

    const lag = nextSpot('lagputt', i);
    const lagDist = d2(lag.x, lag.z, PRACTICE_FLAG.x, PRACTICE_FLAG.z);
    assert.ok(lagDist >= 7.9 && lagDist <= 12.1, `lag dist ${lagDist}`);
    assert.ok(d2(lag.x, lag.z, GREEN_CENTER.x, GREEN_CENTER.z) <= GREEN_RADIUS - 1.4, 'lag off green');

    const short = nextSpot('holing', i);
    const shortDist = d2(short.x, short.z, PRACTICE_FLAG.x, PRACTICE_FLAG.z);
    assert.ok(shortDist >= 0.9 && shortDist <= 3.1, `short dist ${shortDist}`);
}
assert.equal(nextSpot('driving', 3).lie, 'TEE');

// --- drillLaunchConfig ---
assert.ok(drillLaunchConfig('driving').layout.fairways.length > 0);
assert.equal(drillLaunchConfig('approach').layout.par, 3);
assert.equal(drillLaunchConfig('chipping').layout, null); // practice green default
assert.ok(DRILLS.every(d => drillLaunchConfig(d.id).hidePanel));

// --- recordShot flow ---
store.clear();
assert.equal(recordShot({ lie: 'GREEN', holed: true, distToFlag: 0 }), null); // no active drill

startDrill('holing');
assert.equal(getActiveDrill(), 'holing');
let res = recordShot({ lie: 'GREEN', holed: false, distToFlag: 0.4 }); // miss
assert.ok(!res.drillDone && res.statusText.includes('0/5') && res.nextSpot);
for (let i = 1; i <= 4; i++) {
    res = recordShot({ lie: 'HOLE', holed: true, distToFlag: 0 });
    assert.ok(res.statusText.includes(`${i}/5`) || res.drillDone);
}
assert.ok(!res.drillDone);
res = recordShot({ lie: 'HOLE', holed: true, distToFlag: 0 }); // 5th make
assert.ok(res.drillDone && res.nextSpot === null);
assert.equal(getActiveDrill(), null); // drill auto-stops
assert.equal(getProgress().counts.holing, 5);
assert.ok(!getProgress().complete);

// Complete every other drill, leaving one attempt on 'bunker'
{
    const p = { counts: { driving: 5, approach: 5, pitching: 5, chipping: 5, lagputt: 5, holing: 5, bunker: 2 }, completedAt: null };
    localStorage.setItem('golfGreenCardV1', JSON.stringify(p));
    startDrill('bunker');
    const last = recordShot({ lie: 'GREEN', holed: false, distToFlag: 3 });
    assert.ok(last.drillDone);
    assert.ok(/GREEN CARD EARNED/.test(last.statusText), last.statusText);
    const done = getProgress();
    assert.ok(done.complete && done.completedAt);
}

// Failed attempts never advance progress
{
    store.clear();
    startDrill('driving');
    recordShot({ lie: 'LIGHT_ROUGH', holed: false, distToFlag: 120, shotDistance: 230 });
    recordShot({ lie: 'BUNKER', holed: false, distToFlag: 90, shotDistance: 210 });
    assert.equal(getProgress().counts.driving || 0, 0);
    stopDrill();
}

// A drive that finds the fairway but comes up short explains the miss
{
    store.clear();
    startDrill('driving');
    const short = recordShot({ lie: 'FAIRWAY', holed: false, distToFlag: 140, shotDistance: 148 });
    assert.ok(/Fairway, but 148 m/.test(short.statusText), short.statusText);
    assert.ok(new RegExp(`${DRIVING_MIN_DISTANCE_M} m\\+`).test(short.statusText), short.statusText);
    assert.equal(getProgress().counts.driving || 0, 0);
    stopDrill();
}

// Replaying an already-complete drill: it must STAY a drill. It used to
// auto-stop on the first shot, silently turning the session into
// play-the-hole golf ('next' then continued from wherever the ball lay).
{
    store.clear();
    localStorage.setItem('golfGreenCardV1', JSON.stringify({ counts: { approach: 5 }, completedAt: null }));
    startDrill('approach');
    const miss = recordShot({ lie: 'MEDIUM_ROUGH', holed: false, distToFlag: 30 });
    assert.ok(miss && !miss.drillDone, 'first replay shot must stay an attempt');
    assert.ok(miss.nextSpot, 'replay miss must set the next drill spot');
    assert.equal(getActiveDrill(), 'approach', 'drill must stay active on replay');
    const hit = recordShot({ lie: 'GREEN', holed: false, distToFlag: 5 });
    assert.ok(hit && !hit.drillDone && hit.nextSpot);
    assert.ok(/Still got it/.test(hit.statusText), hit.statusText);
    assert.equal(getProgress().counts.approach, 5, 'replay successes must not inflate the count');
    assert.equal(getActiveDrill(), 'approach');
    stopDrill();
}

console.log('unit-greencard: all assertions passed');
