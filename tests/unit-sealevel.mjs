// The ocean must stay in its place.
//
// Coastal courses get a sea polygon built from OSM `natural=coastline` lines
// and floated at mean sea level, which the importer derives from the DEM as
// -teeElevation. Two things can go wrong, and both did:
//
//   1. The polygon is closed on the wrong side and the "sea" swallows the
//      hole. OSM's left-hand rule is not reliable enough to trust alone, so
//      the importer picks the closure that keeps known land dry — this test
//      is what proves it kept it dry.
//   2. The DEM is off by a metre near the shore. At St Andrews it put the
//      1st tee 0.2 m above the water and Pebble's 18th exactly level with
//      it, so the sea would lap over the teeing ground. The importer now
//      floats the surface at least MIN_FREEBOARD below the lowest ground in
//      the play corridor.
//
// Run: node tests/unit-sealevel.mjs
import { readFileSync, readdirSync } from 'fs';

const MIN_FREEBOARD = 1.0;   // m, must match tools/osm-import.mjs
const CORRIDOR_HALF = 30;    // m either side of the centreline

const failures = [];
let courses = 0, seaHoles = 0, probes = 0;

function inPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
}
const centroid = (pts) => ({
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
});

for (const file of readdirSync('courses').filter(f => f.endsWith('.json')).sort()) {
    const course = JSON.parse(readFileSync('courses/' + file, 'utf8'));
    courses++;
    course.holes.forEach((h, i) => {
        const seas = (h.waterHazards || []).filter(w => w.sea && w.controlPoints?.length >= 3);
        if (!seas.length) return;
        seaHoles++;
        const where = `${file} hole ${i + 1} "${h.name}"`;

        // --- 1. nothing playable may be under water ---------------------
        // Mapped ground only. A straight tee-to-flag line is NOT land: Pebble's
        // 8th plays across the bay and the 18th bends around it, so that line
        // crosses open water by design.
        const points = [['tee', h.tee.center]];
        (h.greens || []).forEach((g, n) => {
            points.push([`green ${n} centre`, centroid(g.controlPoints)]);
            g.controlPoints.forEach((p, k) => points.push([`green ${n} edge ${k}`, p]));
        });
        (h.flagPositions || []).forEach((f, n) => points.push([`flag ${n}`, f]));
        (h.fairways || []).forEach((f, n) => {
            points.push([`fairway ${n} centre`, centroid(f.controlPoints)]);
            f.controlPoints.forEach((p, k) => points.push([`fairway ${n} edge ${k}`, p]));
        });
        for (const [what, p] of points) {
            probes++;
            if (seas.some(s => inPoly(p.x, p.z, s.controlPoints)))
                failures.push(`${where}: ${what} sits inside the sea polygon`);
        }

        // --- 2. the surface must sit below the ground you play on -------
        const grid = (h.terrainFeatures || []).find(t => t.type === 'grid');
        if (typeof h.seaLevelY !== 'number' || !grid) return;
        let low = Infinity;
        for (let r = 0; r < grid.rows; r++)
            for (let c = 0; c < grid.cols; c++) {
                const x = grid.x0 + c * grid.cell, z = grid.z0 + r * grid.cell;
                if (Math.abs(x) > CORRIDOR_HALF) continue;
                if (seas.some(s => inPoly(x, z, s.controlPoints))) continue;   // dry ground only
                low = Math.min(low, grid.heights[r * grid.cols + c]);
            }
        if (!Number.isFinite(low)) return;
        const freeboard = low - h.seaLevelY;
        if (freeboard < MIN_FREEBOARD - 0.005)
            failures.push(`${where}: sea at ${h.seaLevelY} m is only ${freeboard.toFixed(2)} m ` +
                `below the lowest corridor ground (${low} m) — needs ${MIN_FREEBOARD} m`);
    });
}

if (failures.length) {
    console.error(`unit-sealevel: ${failures.length} problems`);
    failures.slice(0, 25).forEach(f => console.error('  ✗ ' + f));
    process.exit(1);
}
console.log(`unit-sealevel: ${seaHoles} ocean holes across ${courses} courses, ` +
    `${probes} land probes dry, every sea surface at least ${MIN_FREEBOARD} m below the corridor`);
console.log('unit-sealevel: all assertions passed');
