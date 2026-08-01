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
// A pond's shore may be steep, but not a wall. Rim width grows with the climb
// from bed to bank to hold roughly this gradient.
const POND_SHORE_SLOPE = 0.5;
// Water is never allowed this close under the playing surfaces beside it —
// raising a pond to its true rim height must not put it over a green.
const WATER_FREEBOARD = 0.25;

/**
 * Lowest ground under any playable surface near this water polygon. Greens,
 * fairways, tees and bunkers all count: a bunker below the waterline is as
 * wrong as a flooded green.
 */
function playableFloorNear(layout, verts, reach = 8) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of verts) {
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    let floor = Infinity;
    const consider = (poly) => {
        if (!poly || poly.length < 3) return;
        for (const p of poly) {
            if (p.x < minX - reach || p.x > maxX + reach ||
                p.z < minZ - reach || p.z > maxZ + reach) continue;
            // Points INSIDE the water polygon are mapping overlap, not dry
            // ground — a fairway drawn a few metres over a pond edge. The
            // hazard already outranks fairway there, so they must not drag
            // the waterline down with them.
            if (pointInPolygon(p.x, p.z, verts)) continue;
            if (distanceToPolygonEdge(p.x, p.z, verts) > reach) continue;
            floor = Math.min(floor, bankLevelAt(p.x, p.z));
        }
    };
    for (const g of layout.greens || []) consider(g.vertices || g.controlPoints);
    for (const f of layout.fairways || []) consider(f.vertices || f.controlPoints);
    for (const b of layout.bunkers || []) consider(b.vertices || b.controlPoints);
    consider(layout.tee?.vertices);
    return floor;
}

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
/**
 * Where a polygon feature actually needs sub-metre mesh detail: the RIM, a
 * band either side of the polygon edge. Everything deeper inside is a flat
 * floor and everything outside is untouched, and both tessellate perfectly
 * well at the coarse budget.
 *
 * The renderer used to answer this question with the feature's BOUNDING BOX.
 * That is the same thing for a 12 m bunker and catastrophically wrong for a
 * sea polygon: the ocean's bbox covers the entire hole, so every triangle of
 * rough on a coastal hole was built to a 0.65 m edge instead of 4 m. Lofoten's
 * 1st came out at 3.5 MILLION vertices, 3.2 M of them rough, and took 78
 * seconds to load.
 */
function makeRimProximity(verts, rimWidth, bbox) {
    return (x, z, margin = 0) => {
        // Cheap reject first — most triangles are nowhere near the polygon.
        const reach = rimWidth + margin;
        if (x < bbox.minX - reach || x > bbox.maxX + reach ||
            z < bbox.minZ - reach || z > bbox.maxZ + reach) return false;
        return distanceToPolygonEdge(x, z, verts) <= reach;
    };
}

function makeDepressionFeature(verts, depth, rimWidth) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of verts) {
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    const bbox = { minX, maxX, minZ, maxZ };
    return {
        bbox,
        fineNear: makeRimProximity(verts, rimWidth, bbox),
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
 * Green construction pad: real greens are GRADED into their hillsides (cut
 * and fill) — raw DEM elevation across a small green can run 10%+ grades
 * where a ball cannot even rest (Augusta 12 measured 10% at the green
 * center). Inside the green the base terrain is replaced by a near-level
 * plane through the green center (tilt direction preserved, magnitude
 * capped), feathered into the untouched surroundings over the contour's
 * collar — which reads as the terraced pad real construction leaves.
 * The putting break itself comes from the green contour on top.
 */
// How much of the hillside's own tilt the pad keeps. At 1.5% the pad was
// essentially DEAD LEVEL, and a level disc gets no hillshade while the
// sloping ground around it does — so even a perfect edge blend left the pad
// reading as a differently-toned circle. 3% keeps the green sitting on its
// hillside instead of stamped into it, and is still far short of what a ball
// cannot rest on (unit-greenrest guards that end).
const MAX_GREEN_PAD_TILT = 0.015;
// The pad replaces the natural hillside under a green with a near-level
// platform, and every centimetre it removes has to be handed back at the
// rim. Feathered over the contour's own collar that reconciliation was
// brutally steep — Asker's 2nd absorbed 0.93 m over about 7 m, which spiked
// to a 27% wall in a ring around the green while the hillside either side
// ran at 4-7%. Hillshade is exaggerated 5x to make contours readable, so
// that wall painted a dark ring on the grass; it also kicked anything
// pitching just short. The collar is now sized to the drop it has to
// absorb, for a target maximum steepness.
const MAX_PAD_COLLAR_SLOPE = 0.10;  // 10%: at the top of what the natural ground does
const MAX_PAD_COLLAR_M = 30;        // but never grade half the hole to achieve it
// Peak derivative of smootherstep(t) = 6t^5 - 15t^4 + 10t^3, at t = 0.5.
const SMOOTHERSTEP_PEAK_SLOPE = 1.875;

// Held at full grade this far outside the green's own edge, before the
// blend starts — the fringe and first step of apron.
const PAD_FRINGE_M = 2;

function makeGreenPadFeature(contour, baseFeatures, greenPolys) {
    const cx = contour.center.x, cz = contour.center.z;
    const inner = contour.innerRadius, outer = contour.outerRadius;
    // The pad follows the GREEN, not a radius. Keyed off distance from the
    // centre it drew a perfect circle whatever shape the green was, and on a
    // hillside that circle is a cut on one side and a fill on the other — so
    // it read as a drawn-on disc, far wider than the green and obviously not
    // the same shape. Distance to the green outline instead.
    const polys = (greenPolys || []).filter(v => Array.isArray(v) && v.length >= 3);
    const usePoly = polys.length > 0;
    // Signed: negative inside the green, positive outside.
    const edgeDist = (x, z) => {
        if (!usePoly) return Math.hypot(x - cx, z - cz) - inner;
        let best = Infinity;
        for (const v of polys) {
            const d = distanceToPolygonEdge(x, z, v);
            best = Math.min(best, pointInPolygon(x, z, v) ? -d : d);
        }
        return best;
    };
    const baseAt = (x, z) => {
        let h = 0;
        for (const f of baseFeatures) {
            const b = f.bbox;
            if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
            h += f.evalAt(x, z);
        }
        return h;
    };
    const h0 = baseAt(cx, cz);
    // Base gradient at the center (central differences over 2 m)
    let gx = (baseAt(cx + 2, cz) - baseAt(cx - 2, cz)) / 4;
    let gz = (baseAt(cx, cz + 2) - baseAt(cx, cz - 2)) / 4;
    const gMag = Math.hypot(gx, gz);
    if (gMag > MAX_GREEN_PAD_TILT) {
        gx *= MAX_GREEN_PAD_TILT / gMag;
        gz *= MAX_GREEN_PAD_TILT / gMag;
    }
    const planeAt = (x, z) => h0 + gx * (x - cx) + gz * (z - cz);

    // How much height the collar has to absorb. The correction grows with
    // radius — the level plane diverges further from a rising hillside the
    // further out you go — so a longer collar has more to absorb, and sizing
    // it from the value at `inner` alone lands well short. Iterate.
    // Probe points marching outward from the green outline, so the collar is
    // sized against the ground it will actually blend into.
    const outward = [];
    if (usePoly) {
        for (const v of polys)
            for (let i = 0; i < v.length; i++) {
                const a = v[i], b = v[(i + 1) % v.length];
                const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
                let nx = mx - cx, nz = mz - cz;
                const L = Math.hypot(nx, nz) || 1;
                outward.push({ x: mx, z: mz, nx: nx / L, nz: nz / L });
            }
    } else {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 16)
            outward.push({ x: cx + Math.cos(a) * inner, z: cz + Math.sin(a) * inner,
                           nx: Math.cos(a), nz: Math.sin(a) });
    }
    const worstCorrectionWithin = (span) => {
        let m = 0;
        for (let t = 0; t <= span + 1e-6; t += Math.max(1, span / 8))
            for (const p of outward) {
                const x = p.x + p.nx * t, z = p.z + p.nz * t;
                m = Math.max(m, Math.abs(planeAt(x, z) - baseAt(x, z)));
            }
        return m;
    };
    // The collar may not reach past the ground it is grading against. Outside
    // the base features' extent baseAt() returns 0, so the pad would be
    // levelling against nothing and drop a cliff wherever the real terrain
    // was not at zero — which is exactly what a longer collar started doing
    // at the DEM grid edge.
    let reach = Infinity;
    for (const f of baseFeatures) {
        const b = f.bbox;
        reach = Math.min(reach,
            cx - b.minX, b.maxX - cx, cz - b.minZ, b.maxZ - cz);
    }
    const maxCollar = Math.min(MAX_PAD_COLLAR_M, Math.max(0, reach - inner));
    const minCollar = Math.max(1, outer - inner);

    let collar = minCollar;
    for (let iter = 0; iter < 4; iter++) {
        const needed = SMOOTHERSTEP_PEAK_SLOPE * worstCorrectionWithin(PAD_FRINGE_M + collar) / MAX_PAD_COLLAR_SLOPE;
        const next = Math.min(Math.max(maxCollar, minCollar), Math.max(minCollar, needed));
        if (Math.abs(next - collar) < 0.5) { collar = next; break; }
        collar = next;
    }
    const reachOut = PAD_FRINGE_M + collar;

    // Bounding box of the green outline, grown by everything the pad touches.
    let bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
    if (usePoly) {
        for (const v of polys) for (const p of v) {
            bMinX = Math.min(bMinX, p.x); bMaxX = Math.max(bMaxX, p.x);
            bMinZ = Math.min(bMinZ, p.z); bMaxZ = Math.max(bMaxZ, p.z);
        }
    } else {
        bMinX = cx - inner; bMaxX = cx + inner; bMinZ = cz - inner; bMaxZ = cz + inner;
    }

    return {
        bbox: { minX: bMinX - reachOut, maxX: bMaxX + reachOut,
                minZ: bMinZ - reachOut, maxZ: bMaxZ + reachOut },
        evalAt(x, z) {
            const t = edgeDist(x, z);          // <0 on the green, >0 outside
            if (t >= reachOut) return 0;
            const correction = planeAt(x, z) - baseAt(x, z);
            if (t <= PAD_FRINGE_M) return correction;
            return correction * smootherstep(1 - (t - PAD_FRINGE_M) / collar);
        },
    };
}

/**
 * Builds the terrain field for a hole layout: authored green contour and
 * hole-wide terrain features, plus automatic bunker bowls and water
 * depressions. Pass null to clear (flat).
 */
export function setTerrainFromLayout(layout, { skipGreenPad = false } = {}) {
    features = [];
    waterSheets = [];
    if (!layout) return;

    if (layout.greenContour?.center && layout.greenContour.outerRadius > 0) {
        features.push(makeContourFeature(layout.greenContour));
    }

    // Authored hole-wide features (elevated tees/greens, mounds, valleys...)
    const baseFeatures = [];
    if (Array.isArray(layout.terrainFeatures)) {
        for (const f of layout.terrainFeatures) {
            if (!f) continue;
            if (f.type === 'grid' && Array.isArray(f.heights)) {
                const g = makeGridFeature(f);
                features.push(g);
                baseFeatures.push(g);
                continue;
            }
            if (typeof f.height !== 'number') continue;
            let made = null;
            if (f.type === 'bump') made = makeBumpFeature(f);
            else if (f.type === 'plateau') made = makePlateauFeature(f);
            else if (f.type === 'ridge' || f.type === 'valley') made = makeRidgeFeature(f);
            if (made) { features.push(made); baseFeatures.push(made); }
        }
    }

    // Grade the green into the base terrain (see makeGreenPadFeature).
    // skipGreenPad builds the same field WITHOUT that grading, so a test can
    // measure what the pad itself adds rather than what the hillside was
    // already doing.
    if (!skipGreenPad && baseFeatures.length && layout.greenContour?.center && layout.greenContour.outerRadius > 0) {
        const greenPolys = (layout.greens || [])
            .map(g => g.vertices || g.controlPoints)
            .filter(v => Array.isArray(v) && v.length >= 3);
        features.push(makeGreenPadFeature(layout.greenContour, baseFeatures, greenPolys));
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
            // The sea is always level, at mean sea level. It spans the whole
            // hole, so the bank-spread test below would call it a creek and
            // drape it down the hillside. Imported coastal holes carry the
            // local y of absolute 0 m; without it, fall back to the lowest
            // bank so the ocean still sits at the bottom of the land.
            if (w.sea) {
                let lowest = Infinity;
                for (const v of verts) lowest = Math.min(lowest, bankLevelAt(v.x, v.z));
                const level = Number.isFinite(layout.seaLevelY) ? layout.seaLevelY : lowest;
                features.push(makeLevelWaterFeature(verts, level - WATER_DEPTH, POND_RIM));
                waterSheets.push({ mode: 'flat', y: level + WATER_SURFACE_Y });
                continue;
            }
            const banks = verts.map(v => bankLevelAt(v.x, v.z)).sort((a, b) => a - b);
            const minBank = banks[0], maxBank = banks[banks.length - 1];
            if (maxBank - minBank <= 2.5) {
                // Where the waterline goes. The OSM polygon IS the waterline —
                // that is what the mapper drew — so the surface belongs at the
                // rim's own height. Taking the MINIMUM of that rim, as this
                // used to, takes the minimum of a noisy DEM signal and biases
                // low every single time: across the library water sat a median
                // 0.47 m below its own median bank, 1.25 m at p90 and 2.14 m at
                // worst. A pond two metres down in a bathtub also has to meet
                // the shore somewhere, and where it cuts a uniform slope the
                // intersection is a straight contour — the hard line across
                // Augusta's 15th. Use the median and let the carve take care of
                // any rim sample that reads lower.
                const median = banks[Math.floor(banks.length / 2)];
                const level = Math.min(median, playableFloorNear(layout, verts) - WATER_FREEBOARD);
                // A rim has to climb from the bed to the bank, and at a fixed
                // 1.2 m a two-metre climb is a wall. Widen it with the drop,
                // but never so far that a small pond is all shore.
                const drop = Math.max(0, maxBank - (level - WATER_DEPTH));
                const room = 0.35 * Math.sqrt(polygonArea(verts) / Math.PI);
                const rim = Math.min(Math.max(POND_RIM, room),
                                     Math.max(POND_RIM, 1.875 * drop / POND_SHORE_SLOPE));
                features.push(makeLevelWaterFeature(verts, level - WATER_DEPTH, rim));
                waterSheets.push({ mode: 'flat', y: level + WATER_SURFACE_Y });
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
    const bbox = { minX, maxX, minZ, maxZ };
    return {
        isWater: true,
        bbox,
        fineNear: makeRimProximity(verts, rimWidth, bbox),
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
        // A feature that knows where it actually needs detail says so. Only
        // the ones that cannot (green contours, mounds) fall back to the box.
        if (f.fineNear) { if (f.fineNear(x, z, margin)) return true; continue; }
        const b = f.bbox;
        if (x >= b.minX - margin && x <= b.maxX + margin &&
            z >= b.minZ - margin && z <= b.maxZ + margin) {
            return true;
        }
    }
    return false;
}
