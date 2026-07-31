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
// Ponds: the OSM polygon edge is the traced shoreline, so banks must dive
// below the waterline almost immediately — a wide feather leaves a dry
// carved ring between the water and the rim
const POND_RIM = 1.2;

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

// --- Authored hole-wide terrain features (layout.terrainFeatures) ---
// { type: 'bump',    x, z, radius, height }           (height<0 = hollow)
// { type: 'plateau', x, z, radius, height, rim }      (flat top, feathered edge)
// { type: 'ridge'|'valley', x, z, angle, length, width, height }

function makeBumpFeature(f) {
    const sigma = Math.max(0.5, (f.radius ?? 8) / 2);
    const reach = sigma * 3.2;
    return {
        bbox: { minX: f.x - reach, maxX: f.x + reach, minZ: f.z - reach, maxZ: f.z + reach },
        evalAt(x, z) {
            const dx = x - f.x, dz = z - f.z;
            return f.height * Math.exp(-(dx * dx + dz * dz) / (2 * sigma * sigma));
        },
    };
}

function makePlateauFeature(f) {
    const radius = f.radius ?? 8;
    const rim = Math.max(0.5, f.rim ?? radius * 0.5);
    return {
        bbox: { minX: f.x - radius, maxX: f.x + radius, minZ: f.z - radius, maxZ: f.z + radius },
        evalAt(x, z) {
            const d = Math.sqrt((x - f.x) ** 2 + (z - f.z) ** 2);
            if (d >= radius) return 0;
            return f.height * smootherstep(Math.min(1, (radius - d) / rim));
        },
    };
}

function makeRidgeFeature(f) {
    const halfLen = (f.length ?? 30) / 2;
    const width = Math.max(1, f.width ?? 10);
    const sigma = width / 2;
    const cosA = Math.cos(f.angle ?? 0);
    const sinA = Math.sin(f.angle ?? 0);
    const reach = halfLen + width * 2;
    return {
        bbox: { minX: f.x - reach, maxX: f.x + reach, minZ: f.z - reach, maxZ: f.z + reach },
        evalAt(x, z) {
            const rx = x - f.x, rz = z - f.z;
            const u = rx * cosA + rz * sinA;   // Along the ridge
            const v = -rx * sinA + rz * cosA;  // Across it
            const along = smootherstep(Math.min(1, Math.max(0, (halfLen - Math.abs(u)) / width)));
            if (along === 0) return 0;
            return f.height * along * Math.exp(-(v * v) / (2 * sigma * sigma));
        },
    };
}

/**
 * DEM elevation grid ({type:'grid', x0, z0, cell, cols, rows, heights[]}):
 * bicubic Catmull-Rom over a coarse grid of real-world heights (relative to
 * the tee), feathered to zero over the outer cells so the hole meets the
 * flat world seamlessly. C1-smooth; row-major flat heights array.
 */
// The DEM grid covers only the hole corridor; the world beyond it must not
// snap back to elevation 0 at the boundary. A hole cut 40 m into the DEM
// (Augusta's 10th) otherwise plays inside a walled canyon. Instead of
// feathering INSIDE the grid (which shaved real elevation off the corridor
// edges), carry the clamped edge height OUTWARD and melt it into the flat
// world over this distance.
const GRID_EDGE_FEATHER_M = 130;

function makeGridFeature(f) {
    const { x0, z0, cell, cols, rows } = f;
    const heights = f.heights;
    const H = (c, r) => heights[
        Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
    const cr = (p0, p1, p2, p3, t) =>
        p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const fm = GRID_EDGE_FEATHER_M;
    return {
        isGrid: true,
        bbox: {
            minX: x0 - fm, maxX: x0 + (cols - 1) * cell + fm,
            minZ: z0 - fm, maxZ: z0 + (rows - 1) * cell + fm,
        },
        evalAt(x, z) {
            let u = (x - x0) / cell;
            let v = (z - z0) / cell;
            // Distance outside the grid (meters); clamp the sample point to
            // the boundary so the edge height carries outward
            const du = Math.max(0, -u, u - (cols - 1));
            const dv = Math.max(0, -v, v - (rows - 1));
            const dOut = Math.hypot(du, dv) * cell;
            if (dOut >= fm) return 0;
            u = Math.min(cols - 1, Math.max(0, u));
            v = Math.min(rows - 1, Math.max(0, v));
            const ci = Math.floor(u), ri = Math.floor(v);
            const fu = u - ci, fv = v - ri;
            const r0 = cr(H(ci - 1, ri - 1), H(ci, ri - 1), H(ci + 1, ri - 1), H(ci + 2, ri - 1), fu);
            const r1 = cr(H(ci - 1, ri), H(ci, ri), H(ci + 1, ri), H(ci + 2, ri), fu);
            const r2 = cr(H(ci - 1, ri + 1), H(ci, ri + 1), H(ci + 1, ri + 1), H(ci + 2, ri + 1), fu);
            const r3 = cr(H(ci - 1, ri + 2), H(ci, ri + 2), H(ci + 1, ri + 2), H(ci + 2, ri + 2), fu);
            const val = cr(r0, r1, r2, r3, fv);
            return dOut > 0 ? val * smootherstep(1 - dOut / fm) : val;
        },
    };
}

/**
 * Builds the terrain field for a hole layout: authored green contour and
 * hole-wide terrain features, plus automatic bunker bowls and water
 * depressions. Pass null to clear (flat).
 */
export function setTerrainFromLayout(layout) {
    features = [];
    waterSheets = [];
    if (!layout) return;

    if (layout.greenContour?.center && layout.greenContour.outerRadius > 0) {
        features.push(makeContourFeature(layout.greenContour));
    }

    // Authored hole-wide features (elevated tees/greens, mounds, valleys...)
    if (Array.isArray(layout.terrainFeatures)) {
        for (const f of layout.terrainFeatures) {
            if (!f) continue;
            if (f.type === 'grid' && Array.isArray(f.heights)) {
                features.push(makeGridFeature(f));
                continue;
            }
            if (typeof f.height !== 'number') continue;
            if (f.type === 'bump') features.push(makeBumpFeature(f));
            else if (f.type === 'plateau') features.push(makePlateauFeature(f));
            else if (f.type === 'ridge' || f.type === 'valley') features.push(makeRidgeFeature(f));
        }
    }

    // Bunkers: depth scales gently with size (small pots stay shallow)
    if (Array.isArray(layout.bunkers)) {
        for (const b of layout.bunkers) {
            const verts = b?.vertices;
            if (!verts || verts.length < 3) continue;
            const area = polygonArea(verts);
            // Gentle bowls: ~30% faces read as sunken sand, not black pits
            const depth = Math.min(0.6, 0.15 + 0.05 * Math.sqrt(area));
            const rim = Math.min(3.5, Math.max(1.6, 0.42 * Math.sqrt(area)));
            features.push(makeDepressionFeature(verts, depth, rim));
        }
    }

    // Water: terrain dips below the water surface, so banks slope down and
    // meet the water inside the polygon. Two modes, decided by how much the
    // bank line varies across the polygon:
    //  - pond (≤2.5m spread): LEVEL floor carved to the lowest bank − depth
    //    (cutting deeper into the uphill side) + level sheet, like real water
    //  - creek (steeper): depression relative to local terrain + draped sheet
    //    so the run descends with the landscape
    waterSheets = [];
    if (Array.isArray(layout.waterHazards)) {
        for (const w of layout.waterHazards) {
            const verts = w?.vertices;
            if (!verts || verts.length < 3) { waterSheets.push(null); continue; }
            let minBank = Infinity, maxBank = -Infinity;
            for (const v of verts) {
                const b = bankLevelAt(v.x, v.z);
                if (b < minBank) minBank = b;
                if (b > maxBank) maxBank = b;
            }
            if (maxBank - minBank <= 2.5) {
                features.push(makeLevelWaterFeature(verts, minBank - WATER_DEPTH, POND_RIM));
                waterSheets.push({ mode: 'flat', y: minBank + WATER_SURFACE_Y });
            } else {
                const f = makeDepressionFeature(verts, WATER_DEPTH, WATER_RIM);
                f.isWater = true;
                features.push(f);
                waterSheets.push({ mode: 'drape' });
            }
        }
    }
}

let waterSheets = []; // aligned with layout.waterHazards indexes

/** Per-hazard sheet placement decided by setTerrainFromLayout. */
export function getWaterSheets() { return waterSheets; }

/**
 * Pond with a LEVEL floor: carves down to `level` wherever the bank sits
 * above it, feathered at the polygon edge (C1 at the rim like the relative
 * depressions). evalAt subtracts from the bank via bankLevelAt, so the
 * floor comes out flat regardless of the slope it cuts into.
 */
function makeLevelWaterFeature(verts, level, rimWidth) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of verts) {
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    return {
        isWater: true,
        bbox: { minX, maxX, minZ, maxZ },
        evalAt(x, z) {
            if (!pointInPolygon(x, z, verts)) return 0;
            const bank = bankLevelAt(x, z);
            const target = Math.min(bank, level);
            const d = distanceToPolygonEdge(x, z, verts);
            return (target - bank) * smootherstep(Math.min(1, d / rimWidth));
        },
    };
}

/**
 * Terrain height EXCLUDING water depressions: the bank line the water
 * surface should follow. On sloping DEM holes creeks descend with the
 * landscape — a single flat sheet would sit underground at the upper end.
 */
export function bankLevelAt(x, z) {
    let h = 0;
    for (const f of features) {
        if (f.isWater) continue;
        const b = f.bbox;
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        h += f.evalAt(x, z);
    }
    return h;
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

/**
 * True only near FINE features (contours, bunker/water bowls) that need
 * sub-meter mesh detail. Broad DEM grids (20m cells) render smoothly at a
 * much coarser tessellation — the renderer picks its edge budget with this.
 */
export function isNearFineFeature(x, z, margin = 0) {
    for (const f of features) {
        if (f.isGrid) continue;
        const b = f.bbox;
        if (x >= b.minX - margin && x <= b.maxX + margin &&
            z >= b.minZ - margin && z <= b.maxZ + margin) {
            return true;
        }
    }
    return false;
}
