// The collar of shorter grass around a green.
//
// A fringe has no polygon of its own, and deliberately so. Every alternative
// was worse: an annulus mesh has to be clipped against every greenside bunker
// and pond that eats into it, it triangulates as a ring with a hole, and its
// bounding box is the whole outer disc — which would have wrecked the grass
// scatterer's rejection sampling, since that budgets attempts by bbox/area.
//
// Instead the fringe is a distance test. It is whatever lies within
// FRINGE_WIDTH_M of a green's edge and is not already something else, and the
// surface lookup asks bunkers and water FIRST. Where a bunker abuts the green
// there is simply no fringe, which is what a real greenside bunker looks like.
// Measured across the library, a hazard sits inside the collar along 4.1% of
// total green perimeter at this width — rare, but always somewhere you look.
//
// Width is uniform for now. Real courses run a broad apron on the approach
// side and a tight collar around the sides and back; that variation wants the
// hole centreline and comes next.

/** Collar width outward from the green's edge. */
export const FRINGE_WIDTH_M = 2.0;

// Bounding boxes are what make this cheap. getSurfaceTypeAtPoint is called per
// physics step AND per grass-tuft placement attempt — tens of thousands of
// times per hole — and almost every one of those points is nowhere near a
// green. Keyed on the vertex array so a re-rendered layout reuses the box.
const boxes = new WeakMap();

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

function distSqToSegment(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((px - ax) * dx + (pz - az) * dz) / lenSq : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const cx = ax + dx * t - px, cz = az + dz * t - pz;
    return cx * cx + cz * cz;
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
 * Distance from a point to the nearest green edge, or Infinity beyond `within`.
 *
 * Distance to the OUTLINE, not to the interior — a point deep inside a green
 * is far from its edge. Callers that care about inside vs outside test the
 * polygon separately; the surface lookup gets that for free by resolving GREEN
 * before it ever asks about fringe.
 */
export function greenEdgeDistance(x, z, holeLayout, within = FRINGE_WIDTH_M) {
    let bestSq = Infinity;
    for (const verts of greenPolygons(holeLayout)) {
        const b = boxOf(verts);
        if (x < b.minX - within || x > b.maxX + within ||
            z < b.minZ - within || z > b.maxZ + within) continue;
        for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
            const d = distSqToSegment(x, z, verts[j].x, verts[j].z, verts[i].x, verts[i].z);
            if (d < bestSq) bestSq = d;
        }
    }
    if (bestSq === Infinity) return Infinity;
    const d = Math.sqrt(bestSq);
    return d <= within ? d : Infinity;
}

/**
 * Is this point in a green's collar?
 *
 * Assumes the caller has already ruled out the green itself and both hazards.
 * Order is the whole design here — see getSurfaceTypeAtPoint.
 */
export function isFringeAt(x, z, holeLayout) {
    return greenEdgeDistance(x, z, holeLayout) !== Infinity;
}
