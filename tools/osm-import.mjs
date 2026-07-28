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
for (const el of elements) {
    if (el.type !== 'way') continue;
    const kind = el.tags?.golf;
    if (!(kind in byType)) continue;
    const pts = polygonOf(el);
    if (!pts) continue;
    if (distToPolyline(centroid(pts), linePts) <= CORRIDOR_HALF_WIDTH) {
        byType[kind].push(pts);
    }
}
console.log('Associated:', Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])));

// --- Tee: polygon nearest the line start ---
const start = linePts[0];
let teePoly = null, teeDist = Infinity;
for (const pts of byType.tee) {
    const c = centroid(pts);
    const d = Math.hypot(c.x - start.x, c.z - start.z);
    if (d < teeDist) { teeDist = d; teePoly = pts; }
}
let tee;
if (teePoly) {
    const c = centroid(teePoly);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of teePoly) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    tee = {
        center: { x: +c.x.toFixed(2), y: 0, z: +c.z.toFixed(2) },
        width: +Math.min(9, Math.max(3, maxX - minX)).toFixed(1),
        depth: +Math.min(9, Math.max(3, maxZ - minZ)).toFixed(1),
        surface: 'TEE',
    };
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

// --- Length + flag ---
let length = 0;
for (let i = 0; i < linePts.length - 1; i++) {
    length += Math.hypot(linePts[i + 1].x - linePts[i].x, linePts[i + 1].z - linePts[i].z);
}
const flag = linePts[linePts.length - 1];

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
};

console.log(`  "${layout.name}": par ${layout.par}, ${layout.lengthMeters}m, ` +
    `${layout.fairways.length} fw, ${layout.greens.length} gr, ` +
    `${layout.bunkers.length} bk, ${layout.waterHazards.length} wa`);
return layout;
}

function findHoleLine(pattern) {
    const re = new RegExp(pattern);
    return elements.find(e =>
        e.type === 'way' && e.tags?.golf === 'hole' &&
        re.test(e.tags.name || '') && (e.geometry?.length ?? 0) >= 2) || null;
}

if (courseMode) {
    const [, , patternTemplate, holeCountStr, courseName, outPath] = argv;
    const holeCount = parseInt(holeCountStr, 10);
    if (!patternTemplate || !holeCount || !courseName || !outPath) {
        console.error('Usage: node tools/osm-import.mjs <overpass.json> --course "<pattern with {n}>" <holes> "<name>" <out.json>');
        process.exit(1);
    }
    const holes = [];
    for (let n = 1; n <= holeCount; n++) {
        const line = findHoleLine(patternTemplate.replace('{n}', String(n)));
        if (!line) {
            console.error(`Hole ${n}: no golf=hole match — skipping`);
            continue;
        }
        holes.push(convertHole(line));
    }
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
    const line = findHoleLine(holePattern);
    if (!line) {
        console.error(`No golf=hole way matching /${holePattern}/`);
        process.exit(1);
    }
    const layout = convertHole(line);
    writeFileSync(outPath, JSON.stringify(layout, null, 1));
}
