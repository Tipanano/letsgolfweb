// The scenery backdrop must stay behind the scenery.
//
// A 1600 m plane extends the ground to the treeline so a hole never floats in
// a void. It is draped over the terrain field — but with 96 segments it
// samples that field every 16.7 m and draws straight chords between the
// samples, while the playable meshes follow the same field to well under a
// metre. Sitting a fixed 0.9 m below, any dip deeper than that between two
// samples put the backdrop ABOVE the real ground, and being a separate mesh
// with no depth bias it won the depth test.
//
// The result was a band of scenery-green cutting clean across water, sand and
// green alike: a wide slab seen from above, a razor-thin diagonal seen from
// the tee — one horizontal plane at two angles. On Augusta's 15th it stood
// over the pond at 145 of 966 samples, by up to 1.46 m.
//
// Sampling the LOW point of each vertex's own cell fixes it. This checks the
// holes where the terrain moves most, since a flat hole can never show it.
//
// Run: node tests/browser-smoke-backdrop.mjs
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
const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
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

// Holes chosen for relief, not for looks: Augusta's 15th (the reported one)
// and 12th sit on water in a valley, Pebble's 8th plays over a cliff.
const HOLES = [['courses/augusta-national.json', 14], ['courses/augusta-national.json', 11],
               ['courses/pebble-beach.json', 7], ['courses/bethpage.json', 0]];

const results = await page.evaluate(async (holes) => {
    const main = await import('./src/main.js');
    const ui = await import('./src/ui.js');
    const lib = await import('./src/courseLibrary.js');
    const ph = await import('./src/modes/playHole.js');
    const gc = await import('./src/greenContours.js');
    const core = await import('./src/visuals/core.js');
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js');
    ui.showGameView();
    const out = [];
    for (const [file, hi] of holes) {
        const course = await lib.loadCourse(file);
        await main.setGameMode(main.GAME_MODES.PLAY_HOLE, null, null, null, course);
        await new Promise(r => setTimeout(r, 1200));
        await ph.initializeHoleFromRawLayout(course.holes[hi], { holeNumber: hi + 1 });
        await new Promise(r => setTimeout(r, 2000));

        let earth = null;
        core.scene.traverse(o => { if (o.isMesh && o.geometry?.parameters?.width === 1600) earth = o; });
        if (!earth) { out.push({ file, hole: hi + 1, error: 'backdrop mesh not found' }); continue; }

        // The scenery treeline ring must ENCLOSE the hole. It was built once
        // at radius 480 around the tee, and Augusta's 15th runs 495 m with
        // the green and back pond beyond — the hole poked out through the
        // scenery and the ring's fog-softened wall stood across the fairway
        // 15 m in front of the green. Dead straight, full width, only on
        // long holes: the "razor sheet".
        let ring = null;
        core.scene.traverse(o => { if (o.name === 'SceneryTreeline') ring = o; });
        if (!ring) { out.push({ file, hole: hi + 1, error: 'treeline ring not found' }); continue; }
        const L0 = ph.getCurrentHoleLayout();
        const ringR = 480 * ring.scale.x;
        const ringC = { x: ring.position.x, z: ring.position.z };
        let worstIntrude = -Infinity, intrudeAt = null;
        const probePt = (p) => {
            if (!p || typeof p.x !== 'number') return;
            const d = Math.hypot(p.x - ringC.x, p.z - ringC.z);
            const intrude = d - ringR;   // >0: geometry OUTSIDE the scenery
            if (intrude > worstIntrude) { worstIntrude = intrude; intrudeAt = { x: +p.x.toFixed(0), z: +p.z.toFixed(0) }; }
        };
        probePt(L0.tee?.center); probePt(L0.flagPosition);
        for (const poly of [...(L0.fairways || []), ...(L0.greens || []), ...(L0.waterHazards || []), ...(L0.lightRough || [])])
            for (const v of (poly?.vertices || poly?.controlPoints || [])) probePt(v);

        const L = ph.getCurrentHoleLayout();
        const t = L.tee.center, f = L.flagPosition;
        const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
        const earthY = (x, z) => {
            ray.set(new THREE.Vector3(x, 500, z), down);
            const h = ray.intersectObject(earth, false)[0];
            return h ? h.point.y : null;
        };

        // 1. Over the ground the hole is played on.
        let overGround = 0, groundN = 0, worstGround = 0;
        for (let x = Math.min(t.x, f.x) - 200; x <= Math.max(t.x, f.x) + 200; x += 12)
            for (let z = Math.min(t.z, f.z) - 200; z <= Math.max(t.z, f.z) + 200; z += 12) {
                const e = earthY(x, z);
                if (e == null) continue;
                groundN++;
                const d = e - gc.heightAt(x, z);
                if (d > 0) { overGround++; worstGround = Math.max(worstGround, d); }
            }

        // 2. Over the water sheets, which is where it showed worst.
        const sheets = gc.getWaterSheets();
        let overWater = 0, waterN = 0, worstWater = 0;
        L.waterHazards.forEach((w, i) => {
            const v = w.vertices || w.controlPoints, s = sheets[i];
            if (!v || s?.mode !== 'flat') return;
            const xs = v.map(p => p.x), zs = v.map(p => p.z);
            const inPoly = (x, z) => { let ins = false;
                for (let a = 0, b = v.length - 1; a < v.length; b = a++) {
                    const p = v[a], q = v[b];
                    if ((p.z > z) !== (q.z > z) && x < (q.x - p.x) * (z - p.z) / (q.z - p.z) + p.x) ins = !ins;
                } return ins; };
            for (let x = Math.min(...xs); x <= Math.max(...xs); x += 3)
                for (let z = Math.min(...zs); z <= Math.max(...zs); z += 3) {
                    if (!inPoly(x, z)) continue;
                    const e = earthY(x, z);
                    if (e == null) continue;
                    // Only where the ground is genuinely under the sheet. A
                    // sea polygon clipped to a box can enclose a headland that
                    // stands above the water, and the backdrop is right to
                    // follow it up.
                    if (gc.heightAt(x, z) > s.y) continue;
                    waterN++;
                    const d = e - s.y;
                    if (d > 0) { overWater++; worstWater = Math.max(worstWater, d); }
                }
        });
        out.push({ file: file.replace('courses/', ''), hole: hi + 1,
            overGround, groundN, worstGround: +worstGround.toFixed(2),
            overWater, waterN, worstWater: +worstWater.toFixed(2),
            ringMargin: +(-worstIntrude).toFixed(0), intrudeAt });
    }
    return out;
}, HOLES);

await browser.close();
if (errors.length) fail('page errors:\n  ' + errors.slice(0, 5).join('\n  '));

// A little slop: the backdrop is draped by sampling, not by construction.
const TOLERANCE = 0.05;
for (const r of results) {
    if (r.error) fail(`${r.file} hole ${r.hole}: ${r.error}`);
    console.log(`  ${r.file} h${r.hole}: over ground ${r.overGround}/${r.groundN} (worst +${r.worstGround} m), ` +
        `over water ${r.overWater}/${r.waterN} (worst +${r.worstWater} m)`);
}
if (!results.some(r => r.groundN > 50)) fail('no backdrop samples taken — the probe is not reaching the mesh');
// The hole must sit INSIDE the scenery with clear margin — geometry closer
// than 40 m to the ring reads as a wall in the fog, and geometry beyond it
// is the razor sheet again.
for (const r of results) {
    if (r.ringMargin !== undefined && r.ringMargin < 40)
        fail(`${r.file} hole ${r.hole}: hole geometry reaches within ${r.ringMargin} m of the scenery treeline` +
            (r.intrudeAt ? ` (at ${r.intrudeAt.x}, ${r.intrudeAt.z})` : ''));
}
for (const r of results) {
    if (r.worstGround > TOLERANCE)
        fail(`${r.file} hole ${r.hole}: the backdrop stands ${r.worstGround} m above the ground at ${r.overGround} of ${r.groundN} samples`);
    if (r.worstWater > TOLERANCE)
        fail(`${r.file} hole ${r.hole}: the backdrop stands ${r.worstWater} m above the water at ${r.overWater} of ${r.waterN} samples`);
}
console.log('browser-smoke-backdrop: PASS — the backdrop stays under the course on every probed hole');
