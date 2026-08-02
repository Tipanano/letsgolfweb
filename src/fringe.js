// The collar of shorter grass around a green.
//
// A fringe has no polygon of its own, and deliberately so. Every alternative
// was worse: an annulus mesh has to be clipped against every greenside bunker
// and pond that eats into it, it triangulates as a ring with a hole, and its
// bounding box is the whole outer disc — which would have wrecked the grass
// scatterer's rejection sampling, since that budgets attempts by bbox/area.
//
// Instead the fringe is a distance test. It is whatever lies within the local
// collar width of a green's edge and is not already something else, and the
// surface lookup asks bunkers and water FIRST. Where a bunker abuts the green
// there is simply no fringe, which is what a real greenside bunker looks like.
//
// The width is not uniform. A real course runs a broad apron on the side you
// play in from — so a running approach has somewhere to land — and a tight
// collar around the sides and back, where anything long or wide should be in
// the rough. That asymmetry is the half of this feature that changes how a
// hole plays rather than how it looks.

/** Collar width on the approach side — the apron you can run a ball into. */
export const FRINGE_APRON_M = 4.0;
/** Collar width around the sides and back. */
export const FRINGE_COLLAR_M = 1.5;
/** The widest the collar ever gets — bounding-box margins key off this. */
export const FRINGE_WIDTH_M = FRINGE_APRON_M;

// How sharply the apron narrows away from the approach line. The blend is
// (1 + cos θ)/2 raised to this power, so at 90° from the approach the collar
// is already down to 2.1 m and by the back of the green it is 1.5 m.
const APRON_FALLOFF = 2;

// How far back down the hole to look when reading the approach bearing. Short
// enough to follow a dogleg's last bend, long enough that DEM-scale wobble in
// the corridor outline does not swing it.
const APPROACH_LOOKBACK_M = 40;

// Bounding boxes are what make this cheap. getSurfaceTypeAtPoint is called per
// physics step AND per grass-tuft placement attempt — tens of thousands of
// times per hole — and almost every one of those points is nowhere near a
// green. Keyed on the vertex array so a re-rendered layout reuses the box.
const boxes = new WeakMap();
// Centre, and the direction the approach comes from. Same cache discipline:
// recovering a dogleg centreline per lookup would be absurd.
const approaches = new WeakMap();

function boxOf(verts) {
    let box = boxes.get(verts);
    if (box) return box;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of verts) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
    }
    box = { minX, maxX, minZ, maxZ };
    boxes.set(verts, box);
    return box;
}

function centroidOf(verts) {
    let x = 0, z = 0;
    for (const v of verts) { x += v.x; z += v.z; }
    return { x: x / verts.length, z: z / verts.length };
}

function distSqToSegment(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((px - ax) * dx + (pz - az) * dz) / lenSq : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const cx = ax + dx * t - px, cz = az + dz * t - pz;
    return cx * cx + cz * cz;
}

/**
 * The hole's centreline, recovered from its rough corridor.
 *
 * corridorPolygon() emits [...left, ...right.reversed()], so vertex i and
 * 2N-1-i bracket the same centreline point. That makes the corridor outline a
 * complete record of the centreline including every dogleg — which the
 * straight tee-to-flag line is not, and which is why this bothers.
 */
function centrelineOf(holeLayout) {
    const corridor = holeLayout?.lightRough?.[0];
    const v = corridor?.vertices || corridor?.controlPoints;
    if (!v || v.length < 6 || v.length % 2 !== 0) return null;
    const n = v.length / 2;
    const line = [];
    for (let i = 0; i < n; i++) {
        const a = v[i], b = v[v.length - 1 - i];
        line.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    }
    return line;
}

/**
 * Which way the approach comes from, as a unit vector pointing from the green
 * back down the hole. Falls through: the corridor centreline, then the largest
 * fairway's centroid, then the tee. Null when the layout offers none of them,
 * in which case the collar stays uniform rather than guessing.
 */
function approachOf(verts, holeLayout) {
    let cached = approaches.get(verts);
    if (cached !== undefined) return cached;
    const centre = centroidOf(verts);
    let dir = null;

    const line = centrelineOf(holeLayout);
    if (line) {
        // Nearest centreline point to the green, then walk back along the line
        // until APPROACH_LOOKBACK_M of arc — in whichever direction leads AWAY
        // from the green, since the corridor may run either way.
        let near = 0, bestSq = Infinity;
        for (let i = 0; i < line.length; i++) {
            const dx = line[i].x - centre.x, dz = line[i].z - centre.z;
            const d = dx * dx + dz * dz;
            if (d < bestSq) { bestSq = d; near = i; }
        }
        const walk = (step) => {
            let acc = 0, i = near;
            while (acc < APPROACH_LOOKBACK_M) {
                const j = i + step;
                if (j < 0 || j >= line.length) break;
                acc += Math.hypot(line[j].x - line[i].x, line[j].z - line[i].z);
                i = j;
            }
            return i === near ? null : line[i];
        };
        const back = walk(-1), fwd = walk(1);
        const far = (p) => p ? Math.hypot(p.x - centre.x, p.z - centre.z) : -1;
        const pick = far(back) > far(fwd) ? back : fwd;
        if (pick) dir = { x: pick.x - centre.x, z: pick.z - centre.z };
    }

    if (!dir) {
        let best = null, bestN = 0;
        for (const f of (holeLayout?.fairways || [])) {
            const fv = f?.vertices || f?.controlPoints;
            if (fv?.length > bestN) { best = fv; bestN = fv.length; }
        }
        const from = best ? centroidOf(best) : holeLayout?.tee?.center;
        if (from) dir = { x: from.x - centre.x, z: from.z - centre.z };
    }

    const len = dir ? Math.hypot(dir.x, dir.z) : 0;
    cached = len > 1 ? { centre, x: dir.x / len, z: dir.z / len } : { centre, x: 0, z: 0 };
    approaches.set(verts, cached);
    return cached;
}

/** Every green polygon in a layout, new-format and legacy alike. */
export function greenPolygons(holeLayout) {
    const out = [];
    if (Array.isArray(holeLayout?.greens)) {
        for (const g of holeLayout.greens) if (g?.vertices?.length >= 3) out.push(g.vertices);
    }
    const legacy = holeLayout?.green;
    if (!out.length && legacy?.vertices?.length >= 3) out.push(legacy.vertices);
    return out;
}

/**
 * Collar width for one green in the direction of a point. Uniform
 * FRINGE_WIDTH_M when the approach bearing could not be established.
 */
export function fringeWidthAt(x, z, verts, holeLayout) {
    const a = approachOf(verts, holeLayout);
    if (a.x === 0 && a.z === 0) return FRINGE_WIDTH_M;
    const ox = x - a.centre.x, oz = z - a.centre.z;
    const len = Math.hypot(ox, oz);
    if (len < 1e-6) return FRINGE_APRON_M;
    // cos θ between "outward from the green centre" and "back down the hole":
    // +1 straight into the approach, -1 directly behind the green.
    const cos = (ox / len) * a.x + (oz / len) * a.z;
    const t = Math.pow((1 + cos) / 2, APRON_FALLOFF);
    return FRINGE_COLLAR_M + (FRINGE_APRON_M - FRINGE_COLLAR_M) * t;
}

/**
 * How deep into the collar a point sits, as {dist, width}, or null if it is
 * outside every green's collar.
 *
 * Distance is to the OUTLINE, not the interior — a point deep inside a green
 * is far from its edge. Callers that care about inside vs outside test the
 * polygon separately; the surface lookup gets that for free by resolving GREEN
 * before it ever asks about fringe.
 */
export function fringeAt(x, z, holeLayout) {
    let best = null;
    for (const verts of greenPolygons(holeLayout)) {
        const b = boxOf(verts);
        if (x < b.minX - FRINGE_WIDTH_M || x > b.maxX + FRINGE_WIDTH_M ||
            z < b.minZ - FRINGE_WIDTH_M || z > b.maxZ + FRINGE_WIDTH_M) continue;
        let distSq = Infinity;
        for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
            const d = distSqToSegment(x, z, verts[j].x, verts[j].z, verts[i].x, verts[i].z);
            if (d < distSq) distSq = d;
        }
        const dist = Math.sqrt(distSq);
        const width = fringeWidthAt(x, z, verts, holeLayout);
        // Ranked by how deep into the collar the point is, so two greens whose
        // collars overlap hand back the one it more properly belongs to.
        if (dist <= width && (!best || dist / width < best.dist / best.width))
            best = { dist, width };
    }
    return best;
}

/**
 * Is this point in a green's collar?
 *
 * Assumes the caller has already ruled out the green itself and both hazards.
 * Order is the whole design here — see getSurfaceTypeAtPoint.
 */
export function isFringeAt(x, z, holeLayout) {
    return fringeAt(x, z, holeLayout) !== null;
}
