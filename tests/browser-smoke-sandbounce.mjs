// Sand must be the deadest surface on the course, at every landing angle.
//
// Impact behaviour used to be derived from spinResponse, which describes how
// a ROLLING ball's spin bites the surface. That is a fair proxy for grass and
// completely wrong for sand: it made a bunker the slipperiest (mu 0.43 vs a
// green's 0.65) and least-yielding (softness 0.07 vs 0.125) thing out there,
// so a ball pitching into a bunker at 30 degrees squirted out at 20.1 m/s —
// FASTER than the identical shot into a fairway. Sand grabs and sand gives;
// surfaces.js now says so explicitly and the turf formula stays the default.
//
// Also asserted: the crater measurement the future plugged-lie rule will be
// written against. Nothing consumes `impact.dig` yet, so this is the only
// thing keeping it honest.
//
// Run: node tests/browser-smoke-sandbounce.mjs
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
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
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
await sleep(800);

const rows = await page.evaluate(async () => {
    const sim = await import('./src/gameLogic/simulation.js');
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js');
    const out = [];
    for (const surface of ['FAIRWAY', 'GREEN', 'BUNKER']) {
        for (const deg of [25, 30, 45, 55, 65]) {
            const a = deg * Math.PI / 180, speed = 30;
            const vel = new THREE.Vector3(speed * Math.cos(a), -speed * Math.sin(a), 0);
            const r = sim.simulateBouncePhase(new THREE.Vector3(0, 0.0213, 0), vel, a,
                { x: -600, y: 0, z: 0 }, surface, 0, null);
            out.push({ surface, deg,
                exit: +r.velocity.length().toFixed(2),
                dig: r.impact?.dig ?? null,
                digSurface: r.impact?.surface ?? null,
                endSurface: r.endSurface ?? null });
        }
    }
    return out;
});

await browser.close();
if (errors.length) fail('page errors:\n  ' + errors.slice(0, 5).join('\n  '));

const at = (s, d) => rows.find(r => r.surface === s && r.deg === d);
for (const r of rows) console.log(`  ${r.surface.padEnd(8)} ${String(r.deg).padStart(2)}°  exit ${String(r.exit).padStart(6)} m/s  dig ${r.dig}`);

// 1. Sand is the deadest surface at every angle — this is the inversion that
//    shipped: at 30° the bunker used to release the ball fastest of the three.
for (const deg of [25, 30, 45, 55, 65]) {
    const sand = at('BUNKER', deg), fw = at('FAIRWAY', deg), gr = at('GREEN', deg);
    if (!(sand.exit < fw.exit && sand.exit < gr.exit))
        fail(`at ${deg}° sand releases the ball at ${sand.exit} m/s, not slower than fairway ${fw.exit} and green ${gr.exit}`);
}

// 2. Sand ploughs from a much shallower descent than turf. At 25-30° grass
//    still skips the ball forward and sand already buries it.
if (at('FAIRWAY', 30).dig !== 0 || at('GREEN', 30).dig !== 0)
    fail(`turf should not crater at a 30° descent (fairway ${at('FAIRWAY', 30).dig}, green ${at('GREEN', 30).dig})`);
if (at('BUNKER', 30).dig < 0.5)
    fail(`sand barely craters at 30° (dig ${at('BUNKER', 30).dig}) — it should already be ploughing`);

// 3. The crater measurement rises with descent angle and is attributed to the
//    surface that dug it. A plugged-lie rule needs both to be true.
const sandDigs = [25, 30, 45, 55, 65].map(d => at('BUNKER', d).dig);
for (let i = 1; i < sandDigs.length; i++)
    if (sandDigs[i] < sandDigs[i - 1])
        fail(`sand dig is not monotonic in descent angle: ${sandDigs.join(' → ')}`);
if (at('BUNKER', 65).dig < 0.9)
    fail(`a 65° landing in sand only dug ${at('BUNKER', 65).dig} — a shot that steep should stop in its own mark`);
if (at('BUNKER', 55).digSurface !== 'BUNKER')
    fail(`the crater was attributed to ${at('BUNKER', 55).digSurface}, not BUNKER`);
if (at('FAIRWAY', 45).endSurface !== 'FAIRWAY')
    fail(`endSurface not reported (${at('FAIRWAY', 45).endSurface}) — the roll phase needs it to start on the right surface`);

console.log(`browser-smoke-sandbounce: PASS — sand is the deadest surface at all five descent angles ` +
    `(65°: ${at('BUNKER', 65).exit} m/s vs fairway ${at('FAIRWAY', 65).exit}), ploughs from 25°, dig rises ${sandDigs[0]} → ${sandDigs[4]}`);
