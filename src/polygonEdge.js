// Distance from a point to a polygon's outline, on the XZ plane.
//
// Two features now decide a surface by how far a point is from the edge of
// some polygon rather than by which polygon contains it — the fringe around a
// green, and the graded bands of rough out from the mown ground. Both run
// inside getSurfaceTypeAtPoint, which is called per physics step and per
// grass-tuft placement attempt, so both live or die on the same thing: a
// bounding-box reject that answers "nowhere near" without walking any edges.
//
// Boxes are cached against the vertex array itself, so a layout that is
// re-rendered or re-probed reuses them and a discarded one is collected.

const boxes = new WeakMap();

/** Axis-aligned bounds of a vertex ring, computed once per array. */
export function boxOf(verts) {
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

/** True when a point is further than `margin` outside a ring's bounds. */
export function outsideBox(x, z, verts, margin) {
    const b = boxOf(verts);
    return x < b.minX - margin || x > b.maxX + margin ||
           z < b.minZ - margin || z > b.maxZ + margin;
}

/** Squared distance from a point to a segment. */
export function distSqToSegment(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((px - ax) * dx + (pz - az) * dz) / lenSq : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const cx = ax + dx * t - px, cz = az + dz * t - pz;
    return cx * cx + cz * cz;
}

/**
 * Distance from a point to a ring's outline. Distance to the OUTLINE, not to
 * the interior — a point deep inside the polygon is far from its edge.
 */
export function edgeDistance(x, z, verts) {
    let best = Infinity;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        const d = distSqToSegment(x, z, verts[j].x, verts[j].z, verts[i].x, verts[i].z);
        if (d < best) best = d;
    }
    return Math.sqrt(best);
}

/**
 * Distance to the nearest outline among many rings, or Infinity if every one
 * of them is further than `within`. The bbox reject is the whole point: most
 * probed points are nowhere near the polygons being asked about, and those
 * cost four comparisons each instead of a walk over every edge.
 */
export function nearestEdgeWithin(x, z, rings, within) {
    let best = Infinity;
    for (const verts of rings) {
        if (!verts || verts.length < 3) continue;
        if (outsideBox(x, z, verts, within)) continue;
        const d = edgeDistance(x, z, verts);
        if (d < best) best = d;
    }
    return best <= within ? best : Infinity;
}
