// Where does a ball that finished in the water get played from?
//
// The Rules answer is "where it last crossed the edge of the penalty area",
// and that is a property of the ball's PATH, not of where it stopped — a ball
// can fly the length of a lake and trickle back in, and the reference point is
// the crossing, not the splash. So this works backwards along the trajectory
// the simulation already produced, finds the last dry-to-wet transition,
// bisects that segment for the margin, and then walks back onto dry ground.
//
// Deliberately simplified against the real rule: no distinction between
// yellow and red penalty areas, no back-on-the-line option, no two-club-length
// relief arc. The player gets the two choices that cover almost every real
// situation — play from beside where it went in, or replay the shot.
//
// Pure geometry: callers pass a surfaceAt(x, z) probe, so this needs no
// renderer and can be tested directly.

const PENALTY_SURFACES = new Set(['WATER', 'OUT_OF_BOUNDS']);

/** Steps back from the margin looking for somewhere legal to stand. */
const STEP_M = 0.5;
const MAX_WALK_BACK_M = 40;

/**
 * @param trajectory  [{x, y, z}, ...] flight + bounce + roll, in order
 * @param surfaceAt   (x, z) => surface name
 * @returns {{crossing, dropPoint, dropSurface, walkedBackM}} or null when no
 *          dry-to-wet transition exists (the whole path was over water, so
 *          there is no crossing to drop at and only a replay makes sense).
 */
export function findHazardCrossing(trajectory, surfaceAt) {
    if (!Array.isArray(trajectory) || trajectory.length < 2) return null;

    // Last point on the path that was NOT over a penalty area. Searching from
    // the end matters: a ball can cross the margin several times.
    let lastDry = -1;
    for (let i = trajectory.length - 1; i >= 0; i--) {
        if (!PENALTY_SURFACES.has(surfaceAt(trajectory[i].x, trajectory[i].z))) { lastDry = i; break; }
    }
    if (lastDry === -1 || lastDry === trajectory.length - 1) return null;

    // Retreat direction comes from the ORIGINAL segment, before bisection —
    // the bisected endpoints converge to the same point, and normalising that
    // gives a meaningless direction (it used to fall back to a fixed heading
    // and march straight down the middle of the lake).
    const dry = trajectory[lastDry], wet = trajectory[lastDry + 1];
    let dx = dry.x - wet.x, dz = dry.z - wet.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return null;   // no horizontal travel: nothing to back along
    dx /= len; dz /= len;

    // Bisect the crossing segment for the margin itself.
    let a = dry, b = wet;
    for (let n = 0; n < 24; n++) {
        const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        if (PENALTY_SURFACES.has(surfaceAt(m.x, m.z))) b = m; else a = m;
    }
    const crossing = { x: b.x, z: b.z };   // just inside the hazard

    // Back away from the water along the line the ball came in on, until the
    // ground is somewhere you could actually play from. Bunkers count: a drop
    // beside the water can legitimately land in sand.

    for (let d = STEP_M; d <= MAX_WALK_BACK_M; d += STEP_M) {
        const p = { x: crossing.x + dx * d, z: crossing.z + dz * d };
        const s = surfaceAt(p.x, p.z);
        if (!PENALTY_SURFACES.has(s))
            return { crossing, dropPoint: p, dropSurface: s, walkedBackM: +d.toFixed(1) };
    }
    return null;
}
