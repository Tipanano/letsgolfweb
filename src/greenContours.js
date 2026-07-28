// src/greenContours.js
//
// Analytic terrain heightfield: green contours ("break") plus auto-derived
// depressions for bunkers (sunken bowls) and water (low-lying, banks sloping
// under a flat water sheet).
//
// Everything is smooth by construction: green contours are Gaussian bumps ×
// a smootherstep collar feather; depressions feather with smootherstep from
// the polygon edge inward, which has zero slope at both the rim and the
// floor (C1 across the boundary — no creases). Physics samples the analytic
// field directly, so render and ball behavior can never disagree.
//
// Module is a singleton holding the active terrain so the renderer, physics,
// and visuals all read the same field without import cycles. Feed it a whole
// hole layout with setTerrainFromLayout(); bunker/water features derive
// automatically from their polygons — zero authoring cost.
//
// Green contour config (stored on a hole layout as `greenContour`):
// {
//   center: { x, z },        // Feather center (usually the green center)
//   innerRadius: 15,         // Full contour strength inside this radius
//   outerRadius: 20,         // Field is exactly 0 beyond this radius
//   tilt: { dx: 0, dz: 0.01 },        // Plane slope (m per m), applied inside feather
//   bumps: [ { x, z, height, radius }, ... ]  // Gaussian features; height<0 = hollow
// }

// Water sits this far below grade; terrain under water dips further so the
// flat sheet meets sloping banks inside the polygon (a natural shoreline).
export const WATER_SURFACE_Y = -0.18;
const WATER_DEPTH = 0.8;
const WATER_RIM = 3.0;

let features = []; // { bbox: {minX,maxX,minZ,maxZ}, evalAt(x,z) }

/** Smootherstep: 0→1 with zero 1st and 2nd derivatives at both ends. */
function smootherstep(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function makeContourFeature(config) {
    const cx = config.center.x;
    const cz = config.center.z;
    const outer = config.outerRadius;
    const inner = Math.min(config.innerRadius ?? outer * 0.75, outer - 0.01);
    const tiltX = config.tilt?.dx ?? 0;
    const tiltZ = config.tilt?.dz ?? 0;
    const bumps = (config.bumps || []).map(b => ({
        x: b.x, z: b.z,
        height: b.height,
        // Gaussian sigma from the feature radius: ~1% of peak left at r
        sigma: Math.max(0.5, (b.radius ?? 5) / 2),
    }));

    return {
        bbox: { minX: cx - outer, maxX: cx + outer, minZ: cz - outer, maxZ: cz + outer },
        evalAt(x, z) {
            const dxc = x - cx;
            const dzc = z - cz;
            const distFromCenter = Math.sqrt(dxc * dxc + dzc * dzc);
            if (distFromCenter >= outer) return 0;

            const feather = smootherstep((outer - distFromCenter) / (outer - inner));
            if (feather === 0) return 0;

            let h = tiltX * dxc + tiltZ * dzc;
            for (const b of bumps) {
                const dx = x - b.x;
                const dz = z - b.z;
                h += b.height * Math.exp(-(dx * dx + dz * dz) / (2 * b.sigma * b.sigma));
            }
            return h * feather;
        },
    };
}

function pointInPolygon(x, z, verts) {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        const vi = verts[i], vj = verts[j];
        if ((vi.z > z) !== (vj.z > z) &&
            x < ((vj.x - vi.x) * (z - vi.z)) / (vj.z - vi.z) + vi.x) {
            inside = !inside;
        }
    }
    return inside;
}

function distanceToPolygonEdge(x, z, verts) {
    let best = Infinity;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        const ax = verts[j].x, az = verts[j].z;
        const bx = verts[i].x, bz = verts[i].z;
        const ex = bx - ax, ez = bz - az;
        const lenSq = ex * ex + ez * ez;
        let t = lenSq > 0 ? ((x - ax) * ex + (z - az) * ez) / lenSq : 0;
        t = Math.max(0, Math.min(1, t));
        const dx = x - (ax + ex * t);
        const dz = z - (az + ez * t);
        const d = dx * dx + dz * dz;
        if (d < best) best = d;
    }
    return Math.sqrt(best);
}

/**
 * Sunken bowl inside a polygon: 0 at the edge, -depth at rim-width inside,
 * feathered so slope is zero at both rim and floor.
 */
function makeDepressionFeature(verts, depth, rimWidth) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of verts) {
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    return {
        bbox: { minX, maxX, minZ, maxZ },
        evalAt(x, z) {
            if (!pointInPolygon(x, z, verts)) return 0;
            const d = distanceToPolygonEdge(x, z, verts);
            return -depth * smootherstep(Math.min(1, d / rimWidth));
        },
    };
}

function polygonArea(verts) {
    let a = 0;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        a += verts[j].x * verts[i].z - verts[i].x * verts[j].z;
    }
    return Math.abs(a / 2);
}

/**
 * Builds the terrain field for a hole layout: authored green contour plus
 * automatic bunker bowls and water depressions. Pass null to clear (flat).
 */
export function setTerrainFromLayout(layout) {
    features = [];
    if (!layout) return;

    if (layout.greenContour?.center && layout.greenContour.outerRadius > 0) {
        features.push(makeContourFeature(layout.greenContour));
    }

    // Bunkers: depth scales gently with size (small pots stay shallow)
    if (Array.isArray(layout.bunkers)) {
        for (const b of layout.bunkers) {
            const verts = b?.vertices;
            if (!verts || verts.length < 3) continue;
            const area = polygonArea(verts);
            // Gentle bowls: ~25% faces read as sunken sand, not black pits
            const depth = Math.min(0.5, 0.12 + 0.04 * Math.sqrt(area));
            const rim = Math.min(3.2, Math.max(1.4, 0.4 * Math.sqrt(area)));
            features.push(makeDepressionFeature(verts, depth, rim));
        }
    }

    // Water: terrain dips well below the flat sheet at WATER_SURFACE_Y, so
    // banks slope down and meet the water inside the polygon
    if (Array.isArray(layout.waterHazards)) {
        for (const w of layout.waterHazards) {
            const verts = w?.vertices;
            if (!verts || verts.length < 3) continue;
            features.push(makeDepressionFeature(verts, WATER_DEPTH, WATER_RIM));
        }
    }
}

/** Back-compat: activate just a green contour (no auto features). */
export function setActiveContour(config) {
    features = [];
    if (config?.center && config.outerRadius > 0) {
        features.push(makeContourFeature(config));
    }
}

export function hasContour() {
    return features.length > 0;
}

/** Height (m) of the terrain field at a world XZ position. 0 far from features. */
export function heightAt(x, z) {
    let h = 0;
    for (const f of features) {
        const b = f.bbox;
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        h += f.evalAt(x, z);
    }
    return h;
}

/** Slope gradient {x, z} (dh/dx, dh/dz) via central differences. */
export function gradientAt(x, z) {
    if (features.length === 0) return null;
    const EPS = 0.05;
    return {
        x: (heightAt(x + EPS, z) - heightAt(x - EPS, z)) / (2 * EPS),
        z: (heightAt(x, z + EPS) - heightAt(x, z - EPS)) / (2 * EPS),
    };
}

/**
 * True if a point (with an optional margin around it) is close enough to any
 * terrain feature to be influenced — used by the renderer to decide which
 * triangles need subdividing.
 */
export function isNearContour(x, z, margin = 0) {
    for (const f of features) {
        const b = f.bbox;
        if (x >= b.minX - margin && x <= b.maxX + margin &&
            z >= b.minZ - margin && z <= b.maxZ + margin) {
            return true;
        }
    }
    return false;
}
