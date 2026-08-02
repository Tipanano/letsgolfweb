// How deep the rough is, as a function of how far you missed.
//
// courseRough.js has given every course an ordered profile of rough grades
// since the rough-variety work — Oakmont medium-then-thick, St Andrews
// light-then-fescue, Augusta one cut and no more. Only the LAST grade in each
// profile was ever used, as the wide-miss background, because the corridors
// themselves are a single LIGHT_ROUGH polygon and there was no obvious way to
// subdivide them: nested corridor polygons would all have reported thick,
// since getSurfaceTypeAtPoint checks thick before medium before light.
//
// The fringe answered that. It grades ground by DISTANCE from an edge instead
// of by which polygon contains it, which needs no new geometry and cannot
// produce a nesting order to get wrong. The same trick applies here, measured
// outward from the mown ground — fairway, green and tee — because that is
// what a first cut actually hugs.
//
// The bands are wide by real-course standards. A tour first cut is two or
// three metres; these corridors run a median 31 m from the nearest mown edge
// and 259 m at p90, because an OSM rough corridor is the whole playing
// corridor rather than a mown rough band. Sized to a real first cut, 97% of
// every corridor would be the deepest grade and the gradation would be
// invisible. These thresholds put roughly a fifth of the corridor in the
// gentlest grade instead.

import { roughProfileFor } from './courseRough.js';
import { nearestEdgeWithin } from './polygonEdge.js';

// Band boundaries in metres out from the nearest mown edge, by how many
// grades the course's profile carries. A 2-grade course gets one boundary, a
// 3-grade course two, and so on.
const BOUNDARIES = {
    2: [12],
    3: [8, 22],
    4: [6, 16, 34],
};

/** The furthest any boundary reaches — the bbox margin, and the early-out. */
const MAX_BOUNDARY = 34;

const profiles = new WeakMap();

function profileFor(holeLayout) {
    let p = profiles.get(holeLayout);
    if (p) return p;
    // No course name means the range or a practice green, which must stay
    // neutral — the tutorial has to teach one consistent ball behaviour, the
    // same reason practice forces neutral weather.
    p = holeLayout.courseName ? roughProfileFor(holeLayout.courseName) : ['LIGHT_ROUGH'];
    profiles.set(holeLayout, p);
    return p;
}

const mownCache = new WeakMap();

/** Fairway, green and tee outlines — the mown ground a first cut hugs. */
function mownRings(holeLayout) {
    let rings = mownCache.get(holeLayout);
    if (rings) return rings;
    rings = [];
    const add = (p) => {
        const v = p?.vertices || p?.controlPoints;
        if (v && v.length >= 3) rings.push(v);
    };
    (holeLayout.fairways || []).forEach(add);
    (holeLayout.greens || []).forEach(add);
    add(holeLayout.green);
    add(holeLayout.tee);
    mownCache.set(holeLayout, rings);
    return rings;
}

/**
 * Which grade of rough a point in the corridor plays as.
 *
 * Only called once a point is already known to be in a rough polygon, so it
 * answers "how deep", never "is it rough at all".
 */
export function roughGradeAt(x, z, holeLayout) {
    const profile = profileFor(holeLayout);
    if (profile.length < 2) return profile[0];

    const bounds = BOUNDARIES[Math.min(profile.length, 4)] || BOUNDARIES[3];
    // Beyond the last boundary it is the deepest grade whatever the exact
    // distance, so the bbox reject inside nearestEdgeWithin settles the
    // majority of points without walking a single edge — and the majority is
    // genuinely out there: the median corridor point is 31 m from mown ground.
    const d = nearestEdgeWithin(x, z, mownRings(holeLayout), MAX_BOUNDARY);
    if (d === Infinity) return profile[profile.length - 1];

    for (let i = 0; i < bounds.length; i++) if (d < bounds[i]) return profile[i];
    return profile[profile.length - 1];
}

/** For tests and tooling: the band boundaries a profile length resolves to. */
export function boundariesFor(grades) {
    return (BOUNDARIES[Math.min(grades, 4)] || BOUNDARIES[3]).slice();
}
