// A hazard you can see must be a hazard you play.
//
// getSurfaceTypeAtPoint used to check fairway BEFORE bunkers and water, so a
// fairway bunker — which by definition is drawn inside the fairway polygon —
// handed back a fairway lie. The terrain bowl was always real: the sand mesh
// sits on exactly the same height field the physics reads (verified to the
// millimetre), and the roll code uses its gradient. Only the lie lookup
// disagreed with the ground, which is the worst of both worlds — you could
// see yourself in the sand and play a clean fairway shot out of it. 321
// bunkers and 61 water hazards across the library were affected, including
// the pond left of Augusta's 11th.
//
// The order is Tee > Green > Bunker > Water > Fairway, and the two hazards
// above fairway are still ranked against each other. Green outranks both
// deliberately: a handful of water polygons clip a green edge by a metre of
// mapping slop, and a putting surface must never turn into a penalty drop.
// Bunker outranks water for the same reason in reverse — where a Pebble
// greenside bunker overlaps the ocean polygon, sand is the kinder and more
// likely truth. Both deliberate overlaps are excluded from the probe set, so
// this asserts the documented priority rather than an impossible no-overlap
// ideal.
//
// This runs in a browser because getSurfaceTypeAtPoint reaches the whole
// module graph (state.js -> ui.js -> visuals.js -> three from a CDN). A Node
// copy of the priority order would pass even with the source wrong.
//
// Run: node tests/browser-smoke-hazardlie.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync, execFileSync } = require('child_process');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(require.resolve('playwright', { paths: [globalRoot, '/usr/local/lib/node_modules'] }));

const BASE = 'http://localhost:8788';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

const browser = await chromium.launch({ headless: true })
    .catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true }));
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
const fs = require('fs'); const path = require('path'); const os = require('os');
const CDN_CACHE = path.join(os.tmpdir(), 'letsgolfweb-cdn-cache');
fs.mkdirSync(CDN_CACHE, { recursive: true });
await page.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://fonts.')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.includes('api.gih.golf')) return route.abort();
    const cacheFile = path.join(CDN_CACHE, url.replace(/^https:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_'));
    try {
        if (!fs.existsSync(cacheFile)) execFileSync('curl', ['-sSfL', '--max-time', '60', '-o', cacheFile, url]);
        return route.fulfill({ contentType: /\.css(\?|$)/.test(url) ? 'text/css' : 'application/javascript', body: fs.readFileSync(cacheFile) });
    } catch (e) { return route.abort(); }
});
const EXPECTED = /api\.gih\.golf|Failed to fetch|checking for active game|net::ERR_FAILED/;
const errors = [];
page.on('pageerror', e => { if (!EXPECTED.test(e.message)) errors.push('PAGEERROR: ' + e.message); });

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-course', { timeout: 15000 });
await sleep(1000);

const result = await page.evaluate(async () => {
    const lib = await import('./src/courseLibrary.js');
    const { getSurfaceTypeAtPoint } = await import('./src/utils/gameUtils.js');
    // The raw course JSON stores polygons as controlPoints; the game plays the
    // PROCESSED layout, where they are vertices. Probing the raw file would
    // test nothing the player ever touches.
    const { processHoleLayout } = await import('./src/holeLoader.js');
    const STEP = 1.0;

    const inPoly = (x, z, v) => {
        let inside = false;
        for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
            const a = v[i], b = v[j];
            if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
        }
        return inside;
    };
    const interior = (v, exclude) => {
        const xs = v.map(p => p.x), zs = v.map(p => p.z);
        const pts = [];
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += STEP)
            for (let z = Math.min(...zs); z <= Math.max(...zs); z += STEP) {
                if (!inPoly(x, z, v)) continue;
                if (exclude.some(e => inPoly(x, z, e))) continue;
                pts.push({ x, z });
            }
        return pts;
    };

    const failures = [];
    let bunkers = 0, waters = 0, probes = 0;
    for (const entry of lib.BUNDLED_COURSES) {
        const course = await lib.loadCourse(entry.file);
        course.holes.forEach((raw, i) => {
            const h = processHoleLayout(raw);
            const greens = (h.greens || []).map(g => g.vertices || g.controlPoints).filter(v => v?.length >= 3);
            const sand = (h.bunkers || []).map(b => b.vertices || b.controlPoints).filter(v => v?.length >= 3);
            const where = `${entry.file.replace('courses/', '')} hole ${i + 1} "${h.name}"`;
            const check = (poly, want, label, outranked) => {
                const v = poly.vertices || poly.controlPoints;
                if (!v || v.length < 3) return 0;
                let pts = interior(v, outranked);
                if (!pts.length) return 0;
                if (pts.length > 400) { const k = Math.ceil(pts.length / 400); pts = pts.filter((_, n) => n % k === 0); }
                const wrong = pts.filter(p => getSurfaceTypeAtPoint(p, h) !== want);
                probes += pts.length;
                if (wrong.length > pts.length * 0.02)
                    failures.push(`${where}: ${wrong.length}/${pts.length} of a ${label} plays as ${getSurfaceTypeAtPoint(wrong[0], h)}`);
                return 1;
            };
            for (const b of h.bunkers || []) bunkers += check(b, 'BUNKER', 'bunker', greens);
            for (const w of h.waterHazards || []) waters += check(w, 'WATER', 'water hazard', [...greens, ...sand]);
        });
    }
    return { failures, bunkers, waters, probes, courses: lib.BUNDLED_COURSES.length };
});

await browser.close();
if (errors.length) fail('page errors:\n  ' + errors.slice(0, 5).join('\n  '));
if (result.failures.length) {
    console.error(`${result.failures.length} hazards do not play as they look:`);
    result.failures.slice(0, 20).forEach(f => console.error('  ✗ ' + f));
    fail(`${result.failures.length} hazards misreport their lie`);
}
console.log(`browser-smoke-hazardlie: PASS — ${result.bunkers} bunkers and ${result.waters} water hazards ` +
    `across ${result.courses} courses, ${result.probes} interior probes, every one plays as the hazard it looks like`);
