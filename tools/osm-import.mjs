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
const argv = argvAll;
const courseMode = argv[1] === '--course';

async function fetchElevations(locs, dataset) {
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

// Sparse OSM data fallback: par 4/5 with no mapped fairway (common on
// aerial-only mappings like Augusta) → synthesize a ribbon along the hole
// line, from past the tee shot's start to the front of the green.
if (byType.fairway.length === 0 && par >= 4 && length > 230) {
    const ribbon = lineSamples.filter(p => {
        const fromTee = Math.hypot(p.x - linePts[0].x, p.z - linePts[0].z);
        const toFlag = Math.hypot(p.x - flag.x, p.z - flag.z);
        return fromTee > 40 && toFlag > 18;
    });
    if (ribbon.length >= 2) {
        byType.fairway.push(corridorPolygon(ribbon, 20, 6).map(p => ({ x: +p.x.toFixed(1), z: +p.z.toFixed(1) })));
        console.error('  (synthesized fairway ribbon — none mapped)');
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
    waterHazards: byType.water_hazard.map(pts => ({ controlPoints: pts, surface: 'WATER' })),
    lightRough: [
        { vertices: roughCorridor, surface: 'LIGHT_ROUGH' },
        ...byType.rough.map(pts => ({ vertices: pts, surface: 'LIGHT_ROUGH' })),
    ],
    flagPositions: [{ number: 1, x: flag.x, y: 0, z: flag.z }],
    // All mapped tee boxes, back tee first (future tee selector)
    tees: teeCandidates,
    obstacles,
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
 * continuity).
 */
function findHoleLine(pattern, n, prevEnd) {
    let candidates;
    if (pattern === 'ref') {
        candidates = elements.filter(e =>
            e.type === 'way' && e.tags?.golf === 'hole' &&
            String(e.tags.ref) === String(n) && (e.geometry?.length ?? 0) >= 2);
    } else {
        const re = new RegExp(pattern);
        candidates = elements.filter(e =>
            e.type === 'way' && e.tags?.golf === 'hole' &&
            re.test(e.tags.name || '') && (e.geometry?.length ?? 0) >= 2);
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
        prevEnd = line.geometry[line.geometry.length - 1];
        const hole = await convertHole(line);
        if (hole.greens.length === 0) { console.error(`Hole ${n}: NO GREEN`); warnings++; }
        if (hole.fairways.length === 0 && hole.par > 3) { console.error(`Hole ${n}: no fairway (par ${hole.par})`); warnings++; }
        holes.push(hole);
    }
    if (warnings) console.error(`⚠ ${warnings} warnings`);
    const course = {
        formatVersion: 1,
        name: courseName,
        attribution: 'Course data © OpenStreetMap contributors (ODbL)',
        par: holes.reduce((s, h) => s + (h.par || 4), 0),
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
