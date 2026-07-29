// src/career/courseRating.js
//
// Heuristic course rating and slope for imported courses. Real ratings come
// from on-site assessment; we only have geometry, so this maps length and
// hazard counts onto plausible numbers. Deliberately simple and tunable —
// calibrate against how the physics actually scores (doc/CAREER_MODE_DESIGN.md).

const M_TO_YD = 1.0936;

/**
 * @param {{par?: number, holes: Array<{par?, lengthMeters?, bunkers?, waterHazards?}>}} course
 * @returns {{rating: number, slope: number, par: number, holeCount: number}}
 */
export function courseRating(course) {
    const holes = course.holes || [];
    const n = holes.length || 18;
    const par = course.par || holes.reduce((s, h) => s + (h.par || 4), 0);
    const meters = holes.reduce((s, h) => s + (h.lengthMeters || 0), 0);
    const bunkers = holes.reduce((s, h) => s + (h.bunkers?.length || 0), 0);
    const water = holes.reduce((s, h) => s + (h.waterHazards?.length || 0), 0);

    // Scratch play costs roughly a stroke per 220 yards plus a per-round
    // floor; hazards nudge the number, capped so bunker-saturated links
    // (St Andrews has 100+) stay sane. The 40.9 floor scales for 9-hole loops.
    const rating = Math.round((meters * M_TO_YD / 220 + 40.9 * (n / 18)
        + Math.min(bunkers, 80) * 0.02 + Math.min(water, 25) * 0.06) * 10) / 10;

    // Slope: how much harder the course plays for a bogey golfer than for
    // scratch. 113 is neutral; length beyond a modest members'-course
    // baseline and hazard density raise it. Clamped to the WHS 55-155 range.
    const baseline = 5600 * (n / 18);
    const slope = Math.max(55, Math.min(155, Math.round(
        113 + (meters - baseline) / 55
        + Math.min(bunkers, 60) * 0.18 + Math.min(water, 25) * 0.8)));

    return { rating, slope, par, holeCount: n };
}
