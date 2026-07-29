// Unit tests for the WHS-lite handicap engine and course rating heuristic.
// Run: node tests/unit-handicap.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    MAX_INDEX,
    courseHandicap,
    strokesReceivedByHole,
    adjustedGrossScore,
    scoreDifferential,
    computeRoundDifferential,
    differentialsFromRounds,
    handicapIndex,
    indexSeriesFromRounds,
} from '../src/career/handicap.js';
import { courseRating } from '../src/career/courseRating.js';

const mkHoles = (n, par, strokes, len = 350) =>
    Array.from({ length: n }, (_, i) => ({ hole: i + 1, par, strokes, lengthMeters: len }));

// --- scoreDifferential ---
assert.equal(scoreDifferential(85, 72.0, 113), 13.0);
assert.equal(scoreDifferential(85, 72.0, 130), 11.3); // higher slope shrinks the differential
assert.equal(scoreDifferential(70, 72.0, 113), -2.0); // sub-rating rounds go negative

// --- courseHandicap ---
assert.equal(courseHandicap(13, 72.0, 113, 72), 13);            // neutral course: index carries over
assert.equal(courseHandicap(13, 74.0, 130, 72), 17);            // hard course grants more strokes
assert.equal(courseHandicap(18, 36.0, 113, 36, 9), 9);          // 9-hole scales by half

// --- strokesReceivedByHole ---
{
    const holes = mkHoles(18, 4, 5).map((h, i) => ({ ...h, lengthMeters: 300 + i * 10 }));
    const recv = strokesReceivedByHole(20, holes);
    assert.equal(recv.reduce((a, b) => a + b, 0), 20);
    assert.equal(recv[17], 2); // longest hole gets an extra stroke
    assert.equal(recv[0], 1);  // shortest does not
    assert.deepEqual(strokesReceivedByHole(-3, holes), new Array(18).fill(0)); // plus-hcp clamps to 0
}

// --- adjustedGrossScore: net double bogey / new-player cap ---
{
    const holes = [{ par: 4, strokes: 12 }, { par: 3, strokes: 3 }];
    assert.equal(adjustedGrossScore(holes, [1, 0], true), 7 + 3);  // cap = par+2+received
    assert.equal(adjustedGrossScore(holes, [0, 0], false), 9 + 3); // no index: cap = par+5
}

// --- computeRoundDifferential ---
{
    // New player, blow-up 8s on every hole of a neutral par-72: capped at par+5.
    const round = { holes: mkHoles(18, 4, 12), rating: 72.0, slope: 113, par: 72 };
    assert.equal(computeRoundDifferential(round, null), 18 * 9 - 72); // 90.0
    // Established 10-index shooting even par everywhere: differential ≈ 0.
    const even = { holes: mkHoles(18, 4, 4), rating: 72.0, slope: 113, par: 72 };
    assert.equal(computeRoundDifferential(even, 10), 0);
}

// --- differentialsFromRounds: 9-hole pairing ---
{
    const rounds = [
        { differential: 15.0, holeCount: 18 },
        { differential: 7.1, holeCount: 9 },   // held...
        { differential: 14.0, holeCount: 18 },
        { differential: 6.2, holeCount: 9 },   // ...pairs with the earlier 9
        { differential: 8.0, holeCount: 9 },   // lone 9: held back
    ];
    assert.deepEqual(differentialsFromRounds(rounds), [15.0, 14.0, 13.3]);
}

// --- handicapIndex table ---
assert.equal(handicapIndex([]), null);
assert.equal(handicapIndex([20.0]), 18.0);                       // provisional: lowest − 2
assert.equal(handicapIndex([20.0, 16.0, 25.0]), 14.0);           // n=3: lowest − 2
assert.equal(handicapIndex([20.0, 16.0, 25.0, 18.0]), 15.0);     // n=4: lowest − 1
assert.equal(handicapIndex(new Array(20).fill(10.0)), 10.0);     // n=20: avg best 8
{
    const diffs = [...new Array(12).fill(20.0), ...new Array(8).fill(8.0)];
    assert.equal(handicapIndex(diffs), 8.0); // best 8 of 20 picks the good rounds
    assert.equal(handicapIndex([...new Array(30).fill(2.0), ...new Array(20).fill(12.0)]), 12.0); // only latest 20 count
}
assert.equal(handicapIndex([70.0]), MAX_INDEX); // clamped at 54.0

// --- indexSeriesFromRounds ---
{
    const rounds = [
        { differential: 8.0, holeCount: 9 },   // lone 9: no index yet
        { differential: 7.0, holeCount: 9 },   // pairs -> 15.0 -> provisional 13.0
        { differential: 20.0, holeCount: 18 }, // n=2: lowest - 2 = 13.0
    ];
    assert.deepEqual(indexSeriesFromRounds(rounds), [null, 13.0, 13.0]);
}

// --- courseRating heuristic on real course data ---
{
    const load = (f) => JSON.parse(readFileSync(new URL(`../courses/${f}`, import.meta.url)));
    const standrews = courseRating(load('st-andrews.json'));
    assert.ok(standrews.rating > 65 && standrews.rating < 80, `rating ${standrews.rating}`);
    assert.ok(standrews.slope >= 55 && standrews.slope <= 155, `slope ${standrews.slope}`);
    assert.equal(standrews.holeCount, 18);
    // A stretched, hazard-heavy course must rate above a short, clean one.
    const short = courseRating({ par: 70, holes: mkHoles(18, 4, 0, 280) });
    const long = courseRating({
        par: 72,
        holes: mkHoles(18, 4, 0, 380).map(h => ({ ...h, bunkers: [1, 2, 3], waterHazards: [1] })),
    });
    assert.ok(long.rating > short.rating);
    assert.ok(long.slope > short.slope);
}

console.log('unit-handicap: all assertions passed');
