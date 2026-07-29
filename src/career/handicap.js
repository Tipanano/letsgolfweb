// src/career/handicap.js
//
// Pure handicap math (WHS-lite). No storage, no DOM — fully unit-testable
// (tests/unit-handicap.mjs). Deviations from the real World Handicap System
// are deliberate, game-friendly choices documented in doc/CAREER_MODE_DESIGN.md:
// an index is issued after a single round instead of 54 holes, and course
// rating/slope are geometry-derived heuristics (see courseRating.js).

export const MAX_INDEX = 54.0;

const round1 = (x) => Math.round(x * 10) / 10;

/** Playing handicap on a given course: index scaled by slope, corrected by rating − par. */
export function courseHandicap(index, rating, slope, par, holeCount = 18) {
    return Math.round(index * (holeCount / 18) * (slope / 113) + (rating - par));
}

/**
 * Distributes course-handicap strokes across holes. Longer holes get the
 * extra strokes first (length rank stands in for a real stroke index).
 * Plus-handicap (negative) netting is not modelled yet.
 * @param {number} courseHcp
 * @param {Array<{lengthMeters?: number}>} holes
 * @returns {number[]} strokes received per hole, same order as `holes`.
 */
export function strokesReceivedByHole(courseHcp, holes) {
    const n = holes.length;
    const ch = Math.max(0, courseHcp);
    const received = new Array(n).fill(Math.floor(ch / n));
    const byLength = holes.map((h, i) => ({ i, len: h.lengthMeters || 0 }))
        .sort((a, b) => b.len - a.len);
    for (let k = 0; k < ch % n; k++) {
        received[byLength[k].i] += 1;
    }
    return received;
}

/**
 * Net-double-bogey adjustment: caps each hole at par + 2 + strokes received.
 * With no established index yet, the WHS new-player cap of par + 5 applies.
 * @param {Array<{par: number, strokes: number}>} holes
 * @param {number[]} received - strokes received per hole
 * @param {boolean} hasIndex
 * @returns {number} adjusted gross score
 */
export function adjustedGrossScore(holes, received, hasIndex) {
    return holes.reduce((sum, h, i) => {
        const cap = hasIndex ? h.par + 2 + (received[i] || 0) : h.par + 5;
        return sum + Math.min(h.strokes, cap);
    }, 0);
}

/** WHS score differential, rounded to one decimal. */
export function scoreDifferential(adjustedGross, rating, slope) {
    return round1((adjustedGross - rating) * (113 / slope));
}

/**
 * Adjusts, then computes the differential for one completed round.
 * @param {{holes: Array<{par, strokes, lengthMeters?}>, rating, slope, par}} round
 * @param {number|null} prevIndex - the player's index when the round was played
 */
export function computeRoundDifferential(round, prevIndex) {
    const hasIndex = prevIndex !== null && prevIndex !== undefined;
    let received = new Array(round.holes.length).fill(0);
    if (hasIndex) {
        const ch = courseHandicap(prevIndex, round.rating, round.slope, round.par, round.holes.length);
        received = strokesReceivedByHole(ch, round.holes);
    }
    const adjusted = adjustedGrossScore(round.holes, received, hasIndex);
    return scoreDifferential(adjusted, round.rating, round.slope);
}

/**
 * Chronological rounds → chronological differentials. 18-hole rounds count
 * directly; 9-hole rounds pair up in order and combine into one differential.
 * A lone unpaired 9 is held back until its partner is played.
 * @param {Array<{differential: number, holeCount: number}>} rounds
 */
export function differentialsFromRounds(rounds) {
    const diffs = [];
    let pendingNine = null;
    for (const r of rounds) {
        if (r.holeCount === 9) {
            if (pendingNine === null) {
                pendingNine = r.differential;
            } else {
                diffs.push(round1(pendingNine + r.differential));
                pendingNine = null;
            }
        } else {
            diffs.push(r.differential);
        }
    }
    return diffs;
}

/**
 * Handicap index from chronological differentials. WHS best-8-of-20 table
 * over the most recent 20, extended downward so a single round yields a
 * provisional index. Returns null with no differentials.
 */
export function handicapIndex(differentials) {
    const recent = differentials.slice(-20);
    const n = recent.length;
    if (n === 0) return null;
    const sorted = [...recent].sort((a, b) => a - b);
    const avgBest = (k) => sorted.slice(0, k).reduce((s, d) => s + d, 0) / k;
    let index;
    if (n <= 3) index = sorted[0] - 2.0;
    else if (n === 4) index = sorted[0] - 1.0;
    else if (n === 5) index = sorted[0];
    else if (n === 6) index = avgBest(2) - 1.0;
    else if (n <= 8) index = avgBest(2);
    else if (n <= 11) index = avgBest(3);
    else if (n <= 14) index = avgBest(4);
    else if (n <= 16) index = avgBest(5);
    else if (n <= 18) index = avgBest(6);
    else if (n === 19) index = avgBest(7);
    else index = avgBest(8);
    return round1(Math.min(MAX_INDEX, index));
}
