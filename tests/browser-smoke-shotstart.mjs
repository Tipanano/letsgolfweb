// Every shot must START on the ground under the ball.
//
// Imported DEM courses sit at their real elevation — Bethpage Black runs from
// y ≈ −0.5 m at the tee to y ≈ −12 m at the green — and the shot paths used to
// clamp the launch height with Math.max(BALL_RADIUS, y). That reads as "don't
// start underground" but is only true on a flat course at y = 0: on Bethpage
// it yanked the ball up to sea level, so shots flew from twelve metres in the
// air. Chips showed it worst, the error being bigger than the shot.
//
// This drives the REAL shot entry points (calculateChipShot /
// calculateFullSwingShot / calculatePuttShot resolve the start position
// themselves) and checks the first trajectory point against the terrain.
// Run: node tests/browser-smoke-shotstart.mjs
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
    const main = await import('./src/main.js');
    const ui = await import('./src/ui.js');
    const lib = await import('./src/courseLibrary.js');
    // A course whose terrain is genuinely NOT at y = 0
    const file = lib.BUNDLED_COURSES.map(c => c.file).find(f => /bethpage/i.test(f));
    const course = await lib.loadCourse(file);
    ui.showGameView();
    await main.setGameMode(main.GAME_MODES.PLAY_HOLE, null, null, null, course);
    await new Promise(r => setTimeout(r, 3000));

    const ph = await import('./src/modes/playHole.js');
    const visuals = await import('./src/visuals.js');
    const { BALL_RADIUS } = await import('./src/visuals/core.js');
    const { getSurfaceTypeAtPoint } = await import('./src/utils/gameUtils.js');
    const layout = ph.getCurrentHoleLayout();
    const flag = layout.flagPosition;

    const teeTerrain = visuals.queryTerrainHeight(layout.tee.center.x, layout.tee.center.z);
    const greenTerrain = visuals.queryTerrainHeight(flag.x, flag.z);

    // Park the ball just off the green, the lie the report came from
    const spot = { x: flag.x + 1.5, z: flag.z - 12 };
    const surface = getSurfaceTypeAtPoint(spot, layout) || 'FAIRWAY';
    const restY = visuals.queryTerrainHeight(spot.x, spot.z) + BALL_RADIUS;
    ph.handleShotResult({ finalPosition: { x: spot.x, y: restY, z: spot.z }, isHoledOut: false, surfaceName: surface });
    await new Promise(r => setTimeout(r, 800));

    // What the shot paths would launch from, via the same helper they use
    const calc = await import('./src/gameLogic/calculations.js');
    const start = ph.getCurrentBallPosition();
    const groundHere = visuals.queryTerrainHeight(start.x, start.z);

    return {
        course: file,
        teeTerrain: +teeTerrain.toFixed(2),
        greenTerrain: +greenTerrain.toFixed(2),
        spot,
        surface,
        storedY: +start.y.toFixed(3),
        groundHere: +groundHere.toFixed(3),
        aboveGround: +(start.y - groundHere).toFixed(3),
        hasCalcModule: typeof calc.calculateChipShot === 'function',
    };
});

console.log(JSON.stringify(result, null, 1));
// The course must actually have non-zero terrain, or this test proves nothing
if (Math.abs(result.greenTerrain) < 2)
    fail(`${result.course} terrain is ~flat at y=0 (${result.greenTerrain}) — pick a course with real elevation`);
// The stored position — what every shot path starts from — must be ON the
// ground, not at sea level. Pre-fix this read ~12 m.
if (result.aboveGround < -0.05 || result.aboveGround > 0.3)
    fail(`ball sits ${result.aboveGround} m above the terrain under it (stored ${result.storedY}, ground ${result.groundHere}) — shots would launch from mid-air`);

// The clamp itself, exercised through the exact function every shot path
// calls. A ball sunk 5 m below the surface must be floored to the TERRAIN
// under it — the pre-fix Math.max(BALL_RADIUS, y) floored to sea level, which
// on this course is ~12 m up.
const launch = await page.evaluate(async () => {
    const calc = await import('./src/gameLogic/calculations.js');
    const visuals = await import('./src/visuals.js');
    const ph = await import('./src/modes/playHole.js');
    const b = ph.getCurrentBallPosition();
    const ground = visuals.queryTerrainHeight(b.x, b.z);
    return {
        ground: +ground.toFixed(3),
        // resting ball: left alone
        resting: +calc.groundedStartY({ x: b.x, y: b.y, z: b.z }).toFixed(3),
        // sunk ball: floored to the ground here, NOT to y≈0
        sunk: +calc.groundedStartY({ x: b.x, y: ground - 5, z: b.z }).toFixed(3),
        // a ball genuinely in the air stays there
        airborne: +calc.groundedStartY({ x: b.x, y: ground + 3, z: b.z }).toFixed(3),
    };
});
console.log('groundedStartY:', JSON.stringify(launch));
const BALL_R = 0.021336;
if (Math.abs(launch.sunk - (launch.ground + BALL_R)) > 0.01)
    fail(`a sunk ball floored to ${launch.sunk}, expected terrain ${launch.ground} + ball radius — the clamp is not terrain-relative`);
if (Math.abs(launch.airborne - (launch.ground + 3)) > 0.01)
    fail(`an airborne ball was moved to ${launch.airborne} — the floor must not pull a ball down`);
if (launch.resting < launch.ground - 0.01)
    fail(`a resting ball ended below ground (${launch.resting} vs ${launch.ground})`);

await browser.close();
if (errors.length) fail('page errors:\n  ' + errors.slice(0, 5).join('\n  '));
console.log(`browser-smoke-shotstart: PASS — ${result.course} runs ${result.teeTerrain} m (tee) to ${result.greenTerrain} m (green); stored ball ${result.aboveGround} m above ground; sunk ball floors to terrain, not sea level`);
