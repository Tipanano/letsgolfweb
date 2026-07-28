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
const argv = process.argv.slice(2);
const courseMode = argv[1] === '--course';

const data = JSON.parse(readFileSync(argv[0], 'utf8'));
const elements = data.elements || [];

function convertHole(holeLine) {
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
for (const el of elements) {
    if (el.type !== 'way') continue;
    const kind = el.tags?.golf;
    if (!(kind in byType)) continue;
    const pts = polygonOf(el);
    if (!pts) continue;
    let near = distToPolyline(centroid(pts), linePts) <= CORRIDOR_HALF_WIDTH;
    if (!near && LOOSE_TYPES.has(kind)) {
        for (let i = 0; i < pts.length && !near; i += 2) {
            near = distToPolyline(pts[i], linePts) <= CORRIDOR_HALF_WIDTH;
        }
    }
    if (near) byType[kind].push(pts);
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
const roughCorridor = corridorPolygon(linePts, ROUGH_HALF_WIDTH, ROUGH_END_CAP);

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

// Sparse OSM data fallback: no mapped green → synthesize a circle at the flag
// (without a GREEN surface the hole cannot be holed out)
if (byType.green.length === 0) {
    const g = [];
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        g.push({ x: +(flag.x + Math.cos(a) * 10).toFixed(2), z: +(flag.z + Math.sin(a) * 10).toFixed(2) });
    }
    byType.green.push(g);
    console.error('  (synthesized green at flag — none mapped)');
}

const layout = {
    name: holeLine.tags.name || 'Imported Hole',
    par: parseInt(holeLine.tags.par || '4', 10),
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
        const hole = convertHole(line);
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
    const layout = convertHole(line);
    writeFileSync(outPath, JSON.stringify(layout, null, 1));
}

function findHoleLineSingle(pattern) { return findHoleLine(pattern, 1, null); }
