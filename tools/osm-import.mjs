// tools/osm-import.mjs
//
// Converts OpenStreetMap golf data (Overpass JSON with `out geom;`) into the
// game's hole layout format.
//
// Usage:
//   node tools/osm-import.mjs <overpass.json> <holeNamePattern> <out.json>
//   e.g. node tools/osm-import.mjs carnoustie.json "^1\\. " hole1.json
//
// Data model: the golf=hole way (tee→green polyline) anchors the hole. All
// golf polygons whose centroid lies within a corridor of that line are
// associated with the hole, projected into local meters (tee at origin,
// +z downrange), and emitted in hole-maker layout format.
//
// Course data © OpenStreetMap contributors, ODbL — attribution is embedded
// in the output.
//
// FETCHING: the input is one Overpass query centred on the course. This is
// everything the importer reads — fetch it all, or trees/woods/creeks
// silently vanish from the output:
//
//   [out:json][timeout:120];
//   (
//     way["golf"](around:2600,LAT,LON);
//     way["natural"="wood"](around:2600,LAT,LON);
//     way["landuse"="forest"](around:2600,LAT,LON);
//     node["natural"="tree"](around:2600,LAT,LON);
//     way["natural"="water"](around:2600,LAT,LON);
//     way["waterway"](around:2600,LAT,LON);
//     way["natural"="coastline"](around:2600,LAT,LON);
//   );
//   out geom;
//
// Each emitted hole stores its origin {lat, lon}, so a re-import never has to
// re-derive the course position. When neighbouring courses share the radius
// and --near cannot separate them (Augusta National overlaps its Par-3 and
// Augusta Country Club inside any one circle), filter the fetch instead —
// ANGC's holes are the ones carrying name tags:
//
//   d.elements = d.elements.filter(e => e.tags?.golf !== 'hole' || e.tags?.name)

import { readFileSync, writeFileSync } from 'fs';

const CORRIDOR_HALF_WIDTH = 60;  // m: polygon association distance from the hole line
const ROUGH_HALF_WIDTH = 52;     // m: generated base-rough corridor
const ROUGH_END_CAP = 30;        // m: corridor extension past tee/green
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQ = 111320;

// CLI:
//   Single hole:  node tools/osm-import.mjs <overpass.json> <holeNamePattern> <out.json>
//   Full course:  node tools/osm-import.mjs <overpass.json> --course "<pattern with {n}>" <holes> "<courseName>" <out.json>
//   e.g.          node tools/osm-import.mjs carnoustie.json --course "^{n}\\. " 18 "Carnoustie Championship" course.json
const argvAll = process.argv.slice(2);
const ELEV = { dataset: null };
const ei = argvAll.indexOf('--elevation');
if (ei !== -1) { ELEV.dataset = argvAll[ei + 1]; argvAll.splice(ei, 2); }
// --near lat,lon,radiusM restricts which golf=hole ways can be picked. An
// Overpass fetch wide enough to include the coastline also drags in the
// neighbouring courses — at Muirfield the bbox holds Gullane, Luffness and
// the Renaissance Club, all with ref=1..18 — and routing continuity alone
// will happily walk from one course onto another mid-round.
const NEAR = { lat: null, lon: null, r: 0 };
const ni = argvAll.indexOf('--near');
if (ni !== -1) {
    const [la, lo, r] = argvAll[ni + 1].split(',').map(Number);
    NEAR.lat = la; NEAR.lon = lo; NEAR.r = r;
    argvAll.splice(ni, 2);
}
const argv = argvAll;
const courseMode = argv[1] === '--course';

/**
 * Preferred DEM for a location. Datasets are regional: asking eudem25m for a
 * Californian course returns nulls for every point, which used to be mapped
 * straight to 0 m and silently produced a perfectly flat Pebble Beach with
 * the sea pinned at tee level. aster30m is the global backstop (SRTM is not:
 * it stops at 60 deg, which would exclude Lofoten at 68 deg N).
 */
function datasetFor(lat, lon) {
    if (lat >= 34 && lat <= 72 && lon >= -25 && lon <= 45) return 'eudem25m';   // Europe
    if (lat >= 18 && lat <= 72 && lon >= -170 && lon <= -66) return 'ned10m';   // USA
    return 'aster30m';                                                          // global
}

async function fetchElevationsFrom(locs, dataset) {
    const out = [];
    for (let i = 0; i < locs.length; i += 100) {
        const q = locs.slice(i, i + 100).map(p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6)).join('|');
        const res = await fetch(`https://api.opentopodata.org/v1/${dataset}?locations=${q}`);
        const j = await res.json();
        if (j.status !== 'OK') throw new Error(j.error || 'elevation API error');
        out.push(...j.results.map(r => r.elevation));
        await new Promise(r => setTimeout(r, 1100)); // Free-tier rate limit
    }
    return out;
}

/**
 * Elevations with coverage checking. 'auto' picks by location; any dataset
 * that comes back mostly empty falls through to the global one, and if that
 * is empty too we throw rather than write a flat course.
 */
async function fetchElevations(locs, dataset) {
    const chain = [];
    if (!dataset || dataset === 'auto') chain.push(datasetFor(locs[0].lat, locs[0].lon));
    else chain.push(dataset);
    if (!chain.includes('aster30m')) chain.push('aster30m');

    let lastEmpty = null;
    for (const ds of chain) {
        const out = await fetchElevationsFrom(locs, ds);
        const nulls = out.filter(e => e == null).length;
        if (nulls <= out.length * 0.5) {
            if (ds !== chain[0]) console.error(`  elevation: ${chain[0]} had no coverage here, used ${ds}`);
            ELEV.used = ds;
            return out;
        }
        lastEmpty = `${ds} returned ${nulls}/${out.length} empty points`;
        console.error(`  elevation: ${lastEmpty}, trying the next dataset`);
    }
    throw new Error(`no elevation coverage (${lastEmpty})`);
}

/**
 * Where to float the ocean, in tee-relative metres. Mean sea level is
 * -teeElevation, but a coastal DEM is only accurate to a metre or two and at
 * St Andrews it put the 1st tee 0.2 m above the water — close enough that the
 * sea would lap at the teeing ground. Never let the surface come within
 * MIN_FREEBOARD of the lowest ground in the play corridor; the DEM is not
 * precise enough to be trusted over the geometry of a golf hole.
 */
const MIN_FREEBOARD = 1.0;
function seaLevelFor(mslLocal, heights, cols, rows, x0, z0, cell, sea) {
    // Only DRY corridor ground counts. Pebble's 8th plays over the bay and
    // the 18th bends around it, so the lowest ground under the corridor
    // there IS the sea floor — measuring against that would push the ocean a
    // metre deeper for no reason.
    const wet = (x, z) => {
        let inside = false;
        for (let i = 0, j = sea.length - 1; i < sea.length; j = i++) {
            const a = sea[i], b = sea[j];
            if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
        }
        return inside;
    };
    let corridorLow = Infinity;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = x0 + c * cell, z = z0 + r * cell;
            if (Math.abs(x) > 30) continue;         // the played corridor only
            if (wet(x, z)) continue;
            corridorLow = Math.min(corridorLow, heights[r * cols + c]);
        }
    }
    if (!Number.isFinite(corridorLow)) return +mslLocal.toFixed(2);
    return +Math.min(mslLocal, corridorLow - MIN_FREEBOARD).toFixed(2);
}

const data = JSON.parse(readFileSync(argv[0], 'utf8'));
const elements = data.elements || [];

async function convertHole(holeLine) {
// --- Local projection: meters east/north of the hole line start ---
const lat0 = holeLine.geometry[0].lat;
const lon0 = holeLine.geometry[0].lon;
const mPerDegLon = M_PER_DEG_LON_EQ * Math.cos(lat0 * Math.PI / 180);
const toLocal = (p) => ({
    e: (p.lon - lon0) * mPerDegLon,
    n: (p.lat - lat0) * M_PER_DEG_LAT,
});

// Rotate so the tee→green direction is +z
const end = toLocal(holeLine.geometry[holeLine.geometry.length - 1]);
const theta = Math.atan2(end.e, end.n);
const cosT = Math.cos(theta), sinT = Math.sin(theta);
const project = (p) => {
    const { e, n } = toLocal(p);
    return {
        x: +(e * cosT - n * sinT).toFixed(2),
        z: +((e * sinT + n * cosT) + 5).toFixed(2), // Tee near z=5
    };
};

const linePts = holeLine.geometry.map(project);

// --- Geometry helpers ---
const centroid = (pts) => {
    let x = 0, z = 0;
    for (const p of pts) { x += p.x; z += p.z; }
    return { x: x / pts.length, z: z / pts.length };
};

function distToPolyline(p, line) {
    let best = Infinity;
    for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1];
        const ex = b.x - a.x, ez = b.z - a.z;
        const lenSq = ex * ex + ez * ez;
        let t = lenSq > 0 ? ((p.x - a.x) * ex + (p.z - a.z) * ez) / lenSq : 0;
        t = Math.max(0, Math.min(1, t));
        const dx = p.x - (a.x + ex * t), dz = p.z - (a.z + ez * t);
        best = Math.min(best, dx * dx + dz * dz);
    }
    return Math.sqrt(best);
}

/** Closed-way polygon → projected points (dropping the duplicated last node). */
function polygonOf(el) {
    const g = el.geometry;
    if (!g || g.length < 4) return null;
    const pts = g.slice(0, -1).map(project);
    return pts.length >= 3 ? pts : null;
}

// --- Associate polygons with this hole via the corridor ---
const byType = { green: [], tee: [], fairway: [], bunker: [], water_hazard: [], rough: [] };
// Wide/dogleg fairways can have centroids far off the hole line, so big
// ground surfaces associate if ANY vertex reaches the corridor; point
// features (greens/tees/bunkers) stay centroid-based to avoid grabbing
// every neighbor.
const LOOSE_TYPES = new Set(['fairway', 'rough', 'water_hazard']);
// Hole line resampled every ~25m: courses that merge many holes into one
// giant surface polygon (e.g. Augusta's 5 fairway ways) put every boundary
// vertex far from the line, so also test line-samples against the interior.
const lineSamples = [];
for (let i = 0; i < linePts.length - 1; i++) {
    const a = linePts[i], b = linePts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 25));
    for (let k = 0; k < n; k++) {
        lineSamples.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    }
}
lineSamples.push(linePts[linePts.length - 1]);
for (const el of elements) {
    if (el.type !== 'way') continue;
    const kind = el.tags?.golf;
    if (!(kind in byType)) continue;
    const pts = polygonOf(el);
    if (!pts) continue;
    let near;
    if (kind === 'fairway') {
        // Fairways need positive evidence the hole plays THROUGH them:
        // vertex proximity alone attaches the neighboring hole's fairway
        // whenever a corner pokes into the corridor (Augusta 1 vs 9).
        let inside = 0;
        for (const s of lineSamples) if (pointInPoly(s, pts)) inside++;
        near = inside >= Math.max(3, lineSamples.length * 0.15)
            || distToPolyline(centroid(pts), linePts) <= CORRIDOR_HALF_WIDTH;
    } else {
        near = distToPolyline(centroid(pts), linePts) <= CORRIDOR_HALF_WIDTH;
        if (!near && LOOSE_TYPES.has(kind)) {
            for (let i = 0; i < pts.length && !near; i += 2) {
                near = distToPolyline(pts[i], linePts) <= CORRIDOR_HALF_WIDTH;
            }
            for (let i = 0; i < lineSamples.length && !near; i++) {
                near = pointInPoly(lineSamples[i], pts);
            }
        }
    }
    if (near) byType[kind].push(pts);
}

// Merged multi-hole fairway blobs: even when this hole's line runs through
// them, most of their area can belong to OTHER holes (Augusta 18 shares a
// blob with 9). If under 45% of the polygon sits inside the corridor, drop
// it — the ribbon synthesizer replaces it with a sane per-hole fairway.
byType.fairway = byType.fairway.filter(pts => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const step = Math.max(8, Math.max(maxX - minX, maxZ - minZ) / 20);
    let inPoly = 0, inCorridor = 0;
    for (let x = minX; x <= maxX; x += step) {
        for (let z = minZ; z <= maxZ; z += step) {
            if (!pointInPoly({ x, z }, pts)) continue;
            inPoly++;
            if (distToPolyline({ x, z }, linePts) <= CORRIDOR_HALF_WIDTH + 10) inCorridor++;
        }
    }
    const keep = inPoly === 0 || inCorridor / inPoly >= 0.55;
    if (!keep) console.error('  (dropped mostly-off-corridor fairway blob)');
    return keep;
});
// Water beyond golf tagging: lakes/ponds (natural=water) and creeks/burns
// (waterway lines, buffered into thin hazard polygons)
for (const el of elements) {
    if (el.type !== 'way' || byType.water_hazard.length >= 12) continue;
    if (el.tags?.natural === 'water') {
        const pts = polygonOf(el);
        if (!pts) continue;
        let near = distToPolyline(centroid(pts), linePts) <= CORRIDOR_HALF_WIDTH;
        for (let i = 0; i < pts.length && !near; i += 2) {
            near = distToPolyline(pts[i], linePts) <= CORRIDOR_HALF_WIDTH;
        }
        for (let i = 0; i < lineSamples.length && !near; i++) {
            near = pointInPoly(lineSamples[i], pts);
        }
        if (near) byType.water_hazard.push(pts);
    } else if (['stream', 'river', 'canal', 'ditch', 'drain'].includes(el.tags?.waterway)) {
        const line = (el.geometry || []).map(project);
        const seg = line.filter(p => distToPolyline(p, linePts) <= CORRIDOR_HALF_WIDTH + 25);
        if (seg.length >= 2) {
            const half = el.tags.waterway === 'river' ? 6 : 2.5;
            byType.water_hazard.push(corridorPolygon(seg, half, 3));
        }
    }
}

// --- The sea -------------------------------------------------------------
// OSM does not map the ocean as an area: it maps `natural=coastline` LINES,
// with the convention that land lies to the LEFT of the way's direction.
// Renderers fill the seaward side themselves, and so must we — otherwise a
// links course imports with no water at all (Lofoten's 1st green is 19 m
// from the shore and came in bone dry).
//
// Method: clip the coastline into a generous box around the hole, take the
// longest run, then close it along the box edge on whichever side is sea.
// One crossing is the case that matters for a golf hole; islands and inlets
// beyond that are ignored rather than guessed at.
const SEA_BOX_MARGIN = 220;   // m of ocean to carry past the hole
function buildSeaPolygon() {
    const coast = elements.filter(el =>
        el.type === 'way' && el.tags?.natural === 'coastline' && (el.geometry?.length ?? 0) >= 2);
    if (!coast.length) return null;

    const xs = linePts.map(p => p.x), zs = linePts.map(p => p.z);
    const box = {
        minX: Math.min(...xs) - SEA_BOX_MARGIN, maxX: Math.max(...xs) + SEA_BOX_MARGIN,
        minZ: Math.min(...zs) - SEA_BOX_MARGIN, maxZ: Math.max(...zs) + SEA_BOX_MARGIN,
    };
    const inBox = (p) => p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ;

    // Clip each way into runs of consecutive in-box points, keeping one point
    // beyond each end so the run reaches the boundary when we snap it.
    const runs = [];
    for (const way of coast) {
        const pts = way.geometry.map(project);
        let cur = null;
        for (let i = 0; i < pts.length; i++) {
            if (inBox(pts[i])) {
                if (!cur) { cur = []; if (i > 0) cur.push(pts[i - 1]); }
                cur.push(pts[i]);
            } else if (cur) { cur.push(pts[i]); runs.push(cur); cur = null; }
        }
        if (cur) runs.push(cur);
    }
    if (!runs.length) return null;
    const len = (r) => r.reduce((s, p, i) => i ? s + Math.hypot(p.x - r[i - 1].x, p.z - r[i - 1].z) : 0, 0);
    const run = runs.sort((a, b) => len(b) - len(a))[0];
    if (run.length < 2 || len(run) < 40) return null;

    // Push the two ends out to the box edge along their own direction, then
    // clamp: both endpoints must sit ON the boundary to close against it.
    const extend = (from, to) => {
        const dx = to.x - from.x, dz = to.z - from.z;
        const m = Math.hypot(dx, dz) || 1;
        return { x: to.x + (dx / m) * 4 * SEA_BOX_MARGIN, z: to.z + (dz / m) * 4 * SEA_BOX_MARGIN };
    };
    const clampToBox = (p) => ({
        x: Math.max(box.minX, Math.min(box.maxX, p.x)),
        z: Math.max(box.minZ, Math.min(box.maxZ, p.z)),
    });
    const shore = run.map(p => ({ ...p }));
    shore[0] = clampToBox(extend(shore[1], shore[0]));
    shore[shore.length - 1] = clampToBox(extend(shore[shore.length - 2], shore[shore.length - 1]));

    // Perimeter parameter of a point on the box edge, clockwise from minX/minZ
    const W = box.maxX - box.minX, H = box.maxZ - box.minZ;
    const perim = (p) => {
        const dLeft = Math.abs(p.x - box.minX), dRight = Math.abs(p.x - box.maxX);
        const dBot = Math.abs(p.z - box.minZ), dTop = Math.abs(p.z - box.maxZ);
        const m = Math.min(dLeft, dRight, dBot, dTop);
        if (m === dBot) return (p.x - box.minX);                       // bottom, →
        if (m === dRight) return W + (p.z - box.minZ);                 // right, ↑
        if (m === dTop) return W + H + (box.maxX - p.x);               // top, ←
        return 2 * W + H + (box.maxZ - p.z);                           // left, ↓
    };
    const corners = [
        { t: 0, p: { x: box.minX, z: box.minZ } },
        { t: W, p: { x: box.maxX, z: box.minZ } },
        { t: W + H, p: { x: box.maxX, z: box.maxZ } },
        { t: 2 * W + H, p: { x: box.minX, z: box.maxZ } },
    ];
    const P = 2 * (W + H);
    const walk = (fromT, toT) => {
        const out = [];
        let t = fromT;
        for (let guard = 0; guard < 8; guard++) {
            const next = corners
                .map(c => ({ ...c, d: ((c.t - t) % P + P) % P }))
                .filter(c => c.d > 1e-6)
                .sort((a, b) => a.d - b.d)[0];
            const dEnd = ((toT - t) % P + P) % P;
            if (!next || next.d >= dEnd) break;
            out.push(next.p); t = next.t;
        }
        return out;
    };

    const walkBack = (fromT, toT) => {
        const out = [];
        let t = fromT;
        for (let guard = 0; guard < 8; guard++) {
            const prev = corners
                .map(c => ({ ...c, d: ((t - c.t) % P + P) % P }))
                .filter(c => c.d > 1e-6)
                .sort((a, b) => a.d - b.d)[0];
            const dEnd = ((t - toT) % P + P) % P;
            if (!prev || prev.d >= dEnd) break;
            out.push(prev.p); t = prev.t;
        }
        return out;
    };

    // Which side is sea? The OSM convention (land on the LEFT of the way
    // direction) is the intent, but a single hole often sees a spit, an
    // inlet or a reversed way and the convention alone flips the ocean onto
    // the fairway — Lofoten's 17th drowned its own green. So decide from
    // data we trust instead: the tee, the green and the hole line are LAND
    // by definition. Take whichever closure keeps them dry.
    const landProbes = [
        { x: tee.center.x, z: tee.center.z },
        ...lineSamples,
        ...byType.green.map(centroid),
    ];
    const wetCount = (poly) => landProbes.reduce((n, p) => n + (pointInPoly(p, poly) ? 1 : 0), 0);

    const tStart = perim(shore[0]), tEnd = perim(shore[shore.length - 1]);
    const forward = [...shore, ...walk(tEnd, tStart)];
    const backward = [...shore, ...walkBack(tEnd, tStart)];
    const wetF = wetCount(forward), wetB = wetCount(backward);
    const chosen = wetF <= wetB ? forward : backward;
    const wet = Math.min(wetF, wetB);
    // If neither closure keeps the hole dry the coastline here is not a
    // simple shore (island, lagoon, way ends mid-box). Emit nothing rather
    // than flood the hole.
    if (wet > landProbes.length * 0.05) {
        console.error(`  sea: skipped — no closure keeps the hole dry (${wet}/${landProbes.length} land probes wet)`);
        return null;
    }
    if (chosen.length < 3) return null;
    return chosen.map(p => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) }));
}
console.log('Associated:', Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])));

// --- Tees: all boxes near the hole's start; play from the back tee ---
// OSM maps every tee set (championship/medal/forward). Candidates are tee
// polygons near the start of the hole line; the active tee is the one
// FARTHEST from the flag (back tee). All candidates are kept in the layout
// for a future tee selector.
const start = linePts[0];
const flagPt = linePts[linePts.length - 1];
const teeCandidates = [];
for (const pts of byType.tee) {
    const c = centroid(pts);
    if (Math.hypot(c.x - start.x, c.z - start.z) > 55) continue; // Near this hole's start only
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    teeCandidates.push({
        center: { x: +c.x.toFixed(2), y: 0, z: +c.z.toFixed(2) },
        width: +Math.min(9, Math.max(3, maxX - minX)).toFixed(1),
        depth: +Math.min(9, Math.max(3, maxZ - minZ)).toFixed(1),
        distToFlag: +Math.hypot(c.x - flagPt.x, c.z - flagPt.z).toFixed(1),
    });
}
teeCandidates.sort((a, b) => b.distToFlag - a.distToFlag); // Back tee first

let tee;
if (teeCandidates.length > 0) {
    tee = { ...teeCandidates[0], surface: 'TEE' };
    delete tee.distToFlag;
} else {
    tee = { center: { x: start.x, y: 0, z: start.z }, width: 6, depth: 4, surface: 'TEE' };
}

// --- Generated base rough: corridor around the hole line ---
function corridorPolygon(line, halfWidth, cap) {
    // Extend the line by end caps
    const first = line[0], second = line[1];
    const last = line[line.length - 1], prev = line[line.length - 2];
    const extend = (from, to, dist) => {
        const dx = from.x - to.x, dz = from.z - to.z;
        const len = Math.hypot(dx, dz) || 1;
        return { x: from.x + (dx / len) * dist, z: from.z + (dz / len) * dist };
    };
    const pts = [extend(first, second, cap), ...line, extend(last, prev, cap)];

    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len, nz = dx / len;
        left.push({ x: +(pts[i].x + nx * halfWidth).toFixed(2), z: +(pts[i].z + nz * halfWidth).toFixed(2) });
        right.push({ x: +(pts[i].x - nx * halfWidth).toFixed(2), z: +(pts[i].z - nz * halfWidth).toFixed(2) });
    }
    return [...left, ...right.reverse()];
}
// The corridor must cover the walk from the BACK tee: hole lines usually
// start at the forward tee, leaving back tee boxes stranded in OOB scrub.
// The sea needs the resolved tee as a known-land probe, so build it here.
const seaPolygon = buildSeaPolygon();
if (seaPolygon) console.log(`  sea: coastline closed into a ${seaPolygon.length}-point polygon`);

const teeGap = Math.hypot(tee.center.x - linePts[0].x, tee.center.z - linePts[0].z);
const corridorLine = teeGap > 10
    ? [{ x: tee.center.x, z: tee.center.z }, ...linePts]
    : linePts;
const roughCorridor = corridorPolygon(corridorLine, ROUGH_HALF_WIDTH, ROUGH_END_CAP);

// --- Background (OOB) box around everything ---
let bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
for (const p of roughCorridor) {
    bMinX = Math.min(bMinX, p.x); bMaxX = Math.max(bMaxX, p.x);
    bMinZ = Math.min(bMinZ, p.z); bMaxZ = Math.max(bMaxZ, p.z);
}
const M = 30;
const background = {
    vertices: [
        { x: +(bMinX - M).toFixed(1), z: +(bMinZ - M).toFixed(1) },
        { x: +(bMaxX + M).toFixed(1), z: +(bMinZ - M).toFixed(1) },
        { x: +(bMaxX + M).toFixed(1), z: +(bMaxZ + M).toFixed(1) },
        { x: +(bMinX - M).toFixed(1), z: +(bMaxZ + M).toFixed(1) },
    ],
    surface: 'OUT_OF_BOUNDS',
};

// --- Trees: OSM woods + individual trees near the hole become obstacles ---
function pointInPoly(p, verts) {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        const vi = verts[i], vj = verts[j];
        if ((vi.z > p.z) !== (vj.z > p.z) &&
            p.x < ((vj.x - vi.x) * (p.z - vi.z)) / (vj.z - vi.z) + vi.x) inside = !inside;
    }
    return inside;
}
const playSurfaces = [...byType.fairway, ...byType.green, ...byType.bunker];
const onPlaySurface = (p) => playSurfaces.some(poly => pointInPoly(p, poly)) ||
    Math.hypot(p.x - tee.center.x, p.z - tee.center.z) < 8;
const TREE_CAP = 140;
const treeSize = () => { const r = Math.random(); return r < 0.3 ? 'small' : r < 0.8 ? 'medium' : 'large'; };
const obstacles = [];
const addTree = (p) => {
    if (obstacles.length >= TREE_CAP) return;
    if (distToPolyline(p, linePts) > CORRIDOR_HALF_WIDTH) return;
    if (onPlaySurface(p)) return;
    obstacles.push({ type: 'tree', size: treeSize(), x: +p.x.toFixed(1), z: +p.z.toFixed(1) });
};

for (const el of elements) {
    if (el.type === 'node' && el.tags?.natural === 'tree') {
        addTree(project(el));
    }
}
const woodPolys = [];
for (const el of elements) {
    if (el.type !== 'way') continue;
    const isWood = el.tags?.natural === 'wood' || el.tags?.landuse === 'forest';
    if (!isWood) continue;
    const wpts = polygonOf(el);
    if (wpts) woodPolys.push(wpts);
}
for (const el of elements) {
    if (obstacles.length >= TREE_CAP) break;
    if (el.type !== 'way') continue;
    const isWood = el.tags?.natural === 'wood' || el.tags?.landuse === 'forest';
    if (!isWood) continue;
    const pts = polygonOf(el);
    if (!pts) continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, area = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
        minX = Math.min(minX, pts[i].x); maxX = Math.max(maxX, pts[i].x);
        minZ = Math.min(minZ, pts[i].z); maxZ = Math.max(maxZ, pts[i].z);
    }
    area = Math.abs(area / 2);
    const target = Math.min(90, Math.floor(area / 140)); // ~1 tree per 140 m²
    let placed = 0;
    for (let i = 0; i < target * 6 && placed < target; i++) {
        const p = { x: minX + Math.random() * (maxX - minX), z: minZ + Math.random() * (maxZ - minZ) };
        if (!pointInPoly(p, pts)) continue;
        const before = obstacles.length;
        addTree(p);
        if (obstacles.length > before) placed++;
    }
}
if (obstacles.length) console.log(`  trees: ${obstacles.length}`);

// --- Length (card style: from the active tee along the play line) + flag ---
let length = Math.hypot(tee.center.x - start.x, tee.center.z - start.z);
for (let i = 0; i < linePts.length - 1; i++) {
    length += Math.hypot(linePts[i + 1].x - linePts[i].x, linePts[i + 1].z - linePts[i].z);
}
const flag = linePts[linePts.length - 1];

// Sparse OSM data fallback: no mapped green NEAR THE FLAG → synthesize a
// circle there (without a GREEN surface the hole cannot be holed out).
// Checking for "any green" is not enough: neighboring holes' greens near
// the tee end associate via the corridor and mask the missing one.
const greensNearFlag = byType.green.filter(g => {
    const c = centroid(g);
    return Math.hypot(c.x - flag.x, c.z - flag.z) <= 60;
});
if (greensNearFlag.length === 0) {
    const g = [];
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        g.push({ x: +(flag.x + Math.cos(a) * 10).toFixed(2), z: +(flag.z + Math.sin(a) * 10).toFixed(2) });
    }
    byType.green.push(g);
    console.error('  (synthesized green at flag — none mapped)');
}

// Flag must sit ON a green: OSM hole lines often end a few metres short,
// leaving the cup on the fringe. Snap to the nearest green's centroid.
if (!byType.green.some(g => pointInPoly(flag, g))) {
    let best = null, bestD = Infinity;
    for (const g of byType.green) {
        const c = centroid(g);
        const d = Math.hypot(c.x - flag.x, c.z - flag.z);
        if (d < bestD) { bestD = d; best = c; }
    }
    if (best && bestD < 80) {
        flag.x = best.x;
        flag.z = best.z;
        console.error('  (snapped flag onto nearest green)');
    }
}

// Par from OSM, or inferred from length when untagged
const inferredPar = length < 230 ? 3 : length < 430 ? 4 : 5;
const par = parseInt(holeLine.tags.par || String(inferredPar), 10);

// Sparse OSM data fallback: par 4/5 whose mapped fairway does not actually
// cover the hole (common on aerial-only mappings like Augusta) → synthesize a
// ribbon along the hole line, from past the tee shot's start to the front of
// the green.
//
// This used to trigger only when NOTHING was mapped, which let a single scrap
// suppress it: Augusta's 15th carried one 475 m2 fragment sitting 26 m off the
// line of a 517 m par 5, so the hole was built with a fairway in name only and
// played as rough from tee to green. Measure the coverage instead of counting
// the polygons — across the library 69% of par-4/5 holes over 230 m had less
// than half their driving line on mapped fairway.
if (par >= 4 && length > 230) {
    const ribbon = lineSamples.filter(p => {
        const fromTee = Math.hypot(p.x - linePts[0].x, p.z - linePts[0].z);
        const toFlag = Math.hypot(p.x - flag.x, p.z - flag.z);
        return fromTee > 40 && toFlag > 18;
    });
    const covered = ribbon.filter(p =>
        byType.fairway.some(v => pointInPoly(p, v))).length;
    const coverage = ribbon.length ? covered / ribbon.length : 0;
    if (ribbon.length >= 2 && coverage < 0.5) {
        // Never lay fairway over water. Lofoten's 14th and 16th play across
        // an inlet, and a ribbon drawn straight down the hole line paved it.
        // Test the ribbon's full WIDTH, not just its centreline: the corridor
        // is 20 m each side, so a dry centre still paves the water beside it.
        const wet = (p) => byType.water_hazard.some(v => pointInPoly(p, v)) ||
            (seaPolygon && pointInPoly(p, seaPolygon));
        const wetAcross = (idx) => {
            const p = ribbon[idx];
            const a = ribbon[Math.max(0, idx - 1)], b = ribbon[Math.min(ribbon.length - 1, idx + 1)];
            const dx = b.x - a.x, dz = b.z - a.z, L2 = Math.hypot(dx, dz) || 1;
            const nx = -dz / L2, nz = dx / L2;
            for (const s of [0, 20, -20, 12, -12])
                if (wet({ x: p.x + nx * s, z: p.z + nz * s })) return true;
            return false;
        };
        // Nor through the trees. The ribbon used to be a constant 20 m each
        // side whatever stood there, which drew a 40 m band straight through
        // the pines on every aerial-only course — Augusta's 17th had six trees
        // STANDING ON its fairway, because the fairway was invented after the
        // trees were real. Probe each station's clearance to the nearest wood
        // (and water) and let the ribbon pinch: that asymmetric narrowing is
        // what makes a tree-lined tee shot a tee shot.
        const blocked = (p) => wet(p) || woodPolys.some(w => pointInPoly(p, w));
        const normalAt = (arr, i) => {
            const a = arr[Math.max(0, i - 1)], b = arr[Math.min(arr.length - 1, i + 1)];
            const dx = b.x - a.x, dz = b.z - a.z, L2 = Math.hypot(dx, dz) || 1;
            return { nx: -dz / L2, nz: dx / L2 };
        };
        const HALF_MAX = 20, HALF_STEP = 2, HALF_MIN = 5;
        const clearance = (arr, i, sgn) => {
            const { nx, nz } = normalAt(arr, i);
            let ok = 0;
            for (let d = HALF_STEP; d <= HALF_MAX; d += HALF_STEP) {
                if (blocked({ x: arr[i].x + nx * d * sgn, z: arr[i].z + nz * d * sgn })) break;
                ok = d;
            }
            return ok;
        };
        const runs = [];
        let run = [];
        for (let n = 0; n < ribbon.length; n++) {
            // A station is unusable when water crosses it or the woods leave
            // less than a cart path of dry, open ground.
            const tooTight = clearance(ribbon, n, 1) + clearance(ribbon, n, -1) < 2 * HALF_MIN;
            if (wetAcross(n) || tooTight) { if (run.length >= 2) runs.push(run); run = []; }
            else run.push(ribbon[n]);
        }
        if (run.length >= 2) runs.push(run);
        // Variable-width corridor: same construction as corridorPolygon, but
        // each station carries its own measured half-widths, smoothed with its
        // neighbours so the edge undulates instead of sawtoothing. Smoothing
        // may only ever NARROW below the measured clearance, never widen back
        // into the trees it was measured against.
        const variableRibbon = (r, cap) => {
            const rawL = r.map((_, i) => clearance(r, i, 1));
            const rawR = r.map((_, i) => clearance(r, i, -1));
            const smoothed = (raw) => raw.map((v, i) => {
                const prev = raw[Math.max(0, i - 1)], next = raw[Math.min(raw.length - 1, i + 1)];
                return Math.max(HALF_MIN, Math.min(v, Math.round((prev + v + next) / 3)));
            });
            const hL = smoothed(rawL), hR = smoothed(rawR);
            const first = r[0], second = r[1], last = r[r.length - 1], prev = r[r.length - 2];
            const extend = (from, to, dist) => {
                const dx = from.x - to.x, dz = from.z - to.z;
                const len = Math.hypot(dx, dz) || 1;
                return { x: from.x + (dx / len) * dist, z: from.z + (dz / len) * dist };
            };
            const pts = [extend(first, second, cap), ...r, extend(last, prev, cap)];
            const wL = [hL[0], ...hL, hL[hL.length - 1]];
            const wR = [hR[0], ...hR, hR[hR.length - 1]];
            const left = [], right = [];
            for (let i = 0; i < pts.length; i++) {
                const { nx, nz } = normalAt(pts, i);
                left.push({ x: +(pts[i].x + nx * wL[i]).toFixed(1), z: +(pts[i].z + nz * wL[i]).toFixed(1) });
                right.push({ x: +(pts[i].x - nx * wR[i]).toFixed(1), z: +(pts[i].z - nz * wR[i]).toFixed(1) });
            }
            return [...left, ...right.reverse()];
        };
        // The end cap extends past the last dry sample, so a run that stops
        // right at a shoreline still pokes into it. Retry without the cap,
        // and drop the run if even that is wet.
        let added = 0;
        const synthesized = [];
        for (const r of runs) {
            for (const cap of [6, 0]) {
                const poly = variableRibbon(r, cap);
                if (poly.some(p => wet(p))) continue;
                byType.fairway.push(poly); synthesized.push(poly); added++;
                break;
            }
        }
        if (added)
            console.error(`  (synthesized fairway ribbon${added > 1 ? ` in ${added} parts` : ''} — mapped fairway covers ${(coverage * 100).toFixed(0)}% of the line)`);
        // The tree scatter ran before this fairway existed, so its
        // stay-off-the-fairway rule never saw it. Evict any tree the new
        // ribbon swallowed — clearance keeps the ribbon out of the WOODS, but
        // lone mapped trees and cap-starved wood fragments can still fall
        // inside it.
        if (synthesized.length) {
            for (let i = obstacles.length - 1; i >= 0; i--) {
                const o = obstacles[i];
                if (o.type === 'tree' && synthesized.some(poly => pointInPoly(o, poly)))
                    obstacles.splice(i, 1);
            }
        }
    }
}
const layout = {
    name: holeLine.tags.name || ('Hole ' + (holeLine.tags.ref || '')),
    par,
    lengthMeters: Math.round(length),
    attribution: 'Course data © OpenStreetMap contributors (ODbL)',
    background,
    tee,
    fairways: byType.fairway.map(pts => ({ controlPoints: pts, surface: 'FAIRWAY' })),
    greens: byType.green.map(pts => ({ controlPoints: pts, surface: 'GREEN' })),
    bunkers: byType.bunker.map(pts => ({ controlPoints: pts, surface: 'BUNKER' })),
    waterHazards: [
        ...byType.water_hazard.map(pts => ({ controlPoints: pts, surface: 'WATER' })),
        // The sea is flagged so the renderer keeps it level: its "banks" span
        // the whole hole, which would otherwise pick the draped-creek mode
        // and tilt the ocean down the hillside.
        ...(seaPolygon ? [{ controlPoints: seaPolygon, surface: 'WATER', sea: true }] : []),
    ],
    lightRough: [
        { vertices: roughCorridor, surface: 'LIGHT_ROUGH' },
        ...byType.rough.map(pts => ({ vertices: pts, surface: 'LIGHT_ROUGH' })),
    ],
    flagPositions: [{ number: 1, x: flag.x, y: 0, z: flag.z }],
    // All mapped tee boxes, back tee first (future tee selector)
    tees: teeCandidates,
    obstacles,
    // Where this hole came from. Local coordinates are metres from here,
    // so without it a re-import means re-deriving the course's position by
    // hand — the raw Overpass files are throwaway.
    origin: { lat: +lat0.toFixed(6), lon: +lon0.toFixed(6) },
};

// Real elevation: sample a DEM grid over the hole corridor and store it as a
// 'grid' terrain feature (heights relative to the tee)
if (ELEV.dataset) {
    const cell = 20, x0 = -80, z0 = -40, cols = 9;
    const rows = Math.min(42, Math.ceil((length + 130) / cell) + 1);
    const inv = (x, z) => {
        const zr = z - 5;
        const e = x * cosT + zr * sinT;
        const n = -x * sinT + zr * cosT;
        return { lat: lat0 + n / M_PER_DEG_LAT, lon: lon0 + e / mPerDegLon };
    };
    const locs = [inv(tee.center.x, tee.center.z)];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) locs.push(inv(x0 + c * cell, z0 + r * cell));
    }
    try {
        const elevs = await fetchElevations(locs, ELEV.dataset);
        const teeE = elevs[0] ?? 0;
        const heights = elevs.slice(1).map(e =>
            e == null ? 0 : Math.max(-45, Math.min(45, +(e - teeE).toFixed(1))));
        layout.terrainFeatures = [{ type: 'grid', x0, z0, cell, cols, rows, heights }];
        // Grid heights are relative to the tee, so mean sea level sits at
        // -teeElevation locally. The sea plane needs it; without elevation
        // data the renderer falls back to the polygon's own bank level.
        if (seaPolygon) layout.seaLevelY = seaLevelFor(-teeE, heights, cols, rows, x0, z0, cell, seaPolygon);
        layout.elevationSource = ELEV.used || ELEV.dataset;
        console.log(`  elevation ${cols}x${rows}: ${Math.min(...heights).toFixed(0)}..${Math.max(...heights).toFixed(0)}m vs tee`);
    } catch (e) {
        console.error('  elevation failed:', e.message);
    }
}

console.log(`  "${layout.name}": par ${layout.par}, ${layout.lengthMeters}m, ` +
    `${layout.fairways.length} fw, ${layout.greens.length} gr, ` +
    `${layout.bunkers.length} bk, ${layout.waterHazards.length} wa`);
return layout;
}

/**
 * Finds candidate golf=hole ways for hole n. pattern 'ref' matches the OSM
 * ref tag (the common convention); anything else is a name regex with {n}
 * already substituted. When several courses share the bbox, the candidate
 * whose start lies closest to the previous hole's green wins (routing
 * continuity) — but only among the ways --near admits, if it was given.
 */
function nearEnough(way) {
    if (NEAR.lat === null) return true;
    return way.geometry.some(p => Math.hypot(
        (p.lat - NEAR.lat) * M_PER_DEG_LAT,
        (p.lon - NEAR.lon) * M_PER_DEG_LON_EQ * Math.cos(NEAR.lat * Math.PI / 180)) <= NEAR.r);
}

const usedLines = new Set();

function findHoleLine(pattern, n, prevEnd) {
    const holeWays = elements.filter(e =>
        e.type === 'way' && e.tags?.golf === 'hole' && (e.geometry?.length ?? 0) >= 2 &&
        !usedLines.has(e.id) && nearEnough(e));
    let candidates;
    if (pattern === 'ref') {
        candidates = holeWays.filter(e => String(e.tags.ref) === String(n));
        // Stord's 4th is tagged ref=3, name=4 — a mistag that leaves hole 4
        // with no ref match at all. Fall back to a name that is just the
        // number before giving up on the hole.
        if (!candidates.length)
            candidates = holeWays.filter(e => String(e.tags.name).trim() === String(n));
    } else {
        const re = new RegExp(pattern);
        candidates = holeWays.filter(e => re.test(e.tags.name || ''));
    }
    if (candidates.length === 0) return null;
    if (candidates.length === 1 || !prevEnd) return candidates[0];

    let best = candidates[0], bestD = Infinity;
    for (const c of candidates) {
        const s0 = c.geometry[0];
        const d = Math.hypot((s0.lat - prevEnd.lat) * M_PER_DEG_LAT,
                             (s0.lon - prevEnd.lon) * M_PER_DEG_LON_EQ * Math.cos(prevEnd.lat * Math.PI / 180));
        if (d < bestD) { bestD = d; best = c; }
    }
    return best;
}

if (courseMode) {
    const [, , patternTemplate, holeCountStr, courseName, outPath] = argv;
    const holeCount = parseInt(holeCountStr, 10);
    if (!patternTemplate || !holeCount || !courseName || !outPath) {
        console.error('Usage: node tools/osm-import.mjs <overpass.json> --course "<pattern with {n}>" <holes> "<name>" <out.json>');
        process.exit(1);
    }
    const holes = [];
    let prevEnd = null;
    let warnings = 0;
    for (let n = 1; n <= holeCount; n++) {
        const pattern = patternTemplate === 'ref' ? 'ref' : patternTemplate.replace('{n}', String(n));
        const line = findHoleLine(pattern, n, prevEnd);
        if (!line) {
            console.error(`Hole ${n}: no golf=hole match — skipping`);
            warnings++;
            continue;
        }
        usedLines.add(line.id);
        prevEnd = line.geometry[line.geometry.length - 1];
        const hole = await convertHole(line);
        if (hole.greens.length === 0) { console.error(`Hole ${n}: NO GREEN`); warnings++; }
        if (hole.fairways.length === 0 && hole.par > 3) { console.error(`Hole ${n}: no fairway (par ${hole.par})`); warnings++; }
        holes.push(hole);
    }
    if (warnings) console.error(`⚠ ${warnings} warnings`);
    // Course-level origin: the mean of the hole origins, so a re-fetch can
    // be centred without opening the holes.
    const org = holes.map(h => h.origin).filter(Boolean);
    const course = {
        formatVersion: 1,
        name: courseName,
        attribution: 'Course data © OpenStreetMap contributors (ODbL)',
        par: holes.reduce((s, h) => s + (h.par || 4), 0),
        ...(org.length ? { origin: {
            lat: +(org.reduce((s, o) => s + o.lat, 0) / org.length).toFixed(6),
            lon: +(org.reduce((s, o) => s + o.lon, 0) / org.length).toFixed(6),
        } } : {}),
        holes,
    };
    writeFileSync(outPath, JSON.stringify(course));
    console.log(`Wrote ${outPath}: ${holes.length}/${holeCount} holes, course par ${course.par}`);
} else {
    const [, holePattern, outPath] = argv;
    const line = findHoleLine(holePattern, 1, null);
    if (!line) {
        console.error(`No golf=hole way matching /${holePattern}/`);
        process.exit(1);
    }
    const layout = await convertHole(line);
    writeFileSync(outPath, JSON.stringify(layout, null, 1));
}

function findHoleLineSingle(pattern) { return findHoleLine(pattern, 1, null); }
