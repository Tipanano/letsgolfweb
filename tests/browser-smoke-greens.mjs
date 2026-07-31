// Green playability sweep on the harshest DEM course (Augusta National,
// hillside 25m-DEM terrain): on every hole, a slowly-moving ball must be
// able to COME TO REST at the green center and at the flag, and the total
// terrain gradient at the flag must stay puttable. Guards the green
// construction pad (greenContours.makeGreenPadFeature) — raw DEM ran 10%
// grades across Augusta 12's green, where a ball cannot even sit still.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync, execFileSync } = require('child_process');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(require.resolve('playwright', { paths: [globalRoot, '/usr/local/lib/node_modules'] }));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true }));
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
await page.goto('http://localhost:8788/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-course', { timeout: 15000 });
await sleep(1000);

const rows = await page.evaluate(async () => {
    const main = await import('./src/main.js');
    const ui = await import('./src/ui.js');
    const lib = await import('./src/courseLibrary.js');
    const course = await lib.loadCourse('courses/augusta-national.json');
    ui.showGameView();
    await main.setGameMode(main.GAME_MODES.PLAY_HOLE, null, null, null, course);
    const ph = await import('./src/modes/playHole.js');
    const gc = await import('./src/greenContours.js');
    const sim = await import('./src/gameLogic/simulation.js');
    const state = await import('./src/gameLogic/state.js');
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js');
    state.setWind(0, 0);
    const out = [];
    for (let h = 0; h < course.holes.length; h++) {
        if (h > 0) await ph.advanceToNextHole();
        await new Promise(r => setTimeout(r, 800));
        const layout = ph.getCurrentHoleLayout();
        const c = layout.greenContour, flag = layout.flagPosition;
        if (!c || !flag) { out.push({ hole: h + 1, skip: true }); continue; }
        const gAt = (x, z) => { const g = gc.gradientAt(x, z); return g ? Math.hypot(g.x, g.z) : 0; };
        const rest = (px, pz) => {
            const roll = sim.simulateGroundRoll(
                new THREE.Vector3(px, 0.02, pz), new THREE.Vector3(0.3, 0, 0.3), 'GREEN', 0, 0, 0, layout);
            const fp = roll.finalPosition;
            return Math.hypot(fp.x - px, fp.z - pz);
        };
        out.push({
            hole: h + 1,
            flagSlopePct: +(gAt(flag.x, flag.z) * 100).toFixed(1),
            centerSlopePct: +(gAt(c.center.x, c.center.z) * 100).toFixed(1),
            centerDriftM: +rest(c.center.x, c.center.z).toFixed(2),
            flagDriftM: +rest(flag.x, flag.z).toFixed(2),
        });
    }
    return out;
});

for (const r of rows) {
    if (r.skip) { console.log(`hole ${r.hole}: no contour/flag — skipped`); continue; }
    console.log(`hole ${String(r.hole).padStart(2)}: flag ${r.flagSlopePct}% / center ${r.centerSlopePct}% · drift flag ${r.flagDriftM}m center ${r.centerDriftM}m`);
}
await browser.close();
for (const r of rows) {
    if (r.skip) continue;
    if (r.flagSlopePct > 5) fail(`hole ${r.hole}: flag on ${r.flagSlopePct}% slope`);
    if (r.centerDriftM > 1.5) fail(`hole ${r.hole}: ball cannot rest at green center (drifted ${r.centerDriftM} m)`);
    if (r.flagDriftM > 1.0) fail(`hole ${r.hole}: ball cannot rest at the flag (drifted ${r.flagDriftM} m)`);
}
console.log('browser-smoke-greens: PASS');
