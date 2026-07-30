// Browser smoke test: point-to-aim ground truth (double-tap / double-click).
//
// Regression for the mirrored-aim bug: #golf-canvas is DISPLAYED with
// transform: scaleX(-1) (style.css), so a pointer's screen-x is the mirror
// of the render-space x the raycaster needs. aimAtScreenPoint must flip
// NDC x whenever that transform is active — without the flip, tapping
// right of the aim line sets the aim equally LEFT.
//
// Method: load a bundled course, compute the h-key reference bearing
// (ball → flag), offset the aim 25° so a mirror is distinguishable,
// project the flag through the live camera, mirror to its VISUAL screen
// position (where a finger would tap), call aimAtScreenPoint there, and
// require the reference angle back. Run in both the static camera and the
// fly-over free camera (the touch use case: fly to the green, tap a spot).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync, execFileSync } = require('child_process');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(require.resolve('playwright', { paths: [globalRoot, '/usr/local/lib/node_modules'] }));

const BASE = 'http://localhost:8788';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function launch() {
    const attempts = [
        { channel: 'chrome', headless: true },
        { headless: true },
        { executablePath: '/opt/pw-browsers/chromium', headless: true },
    ];
    let lastErr;
    for (const opts of attempts) {
        try { return await chromium.launch(opts); } catch (e) { lastErr = e; }
    }
    throw lastErr;
}
const browser = await launch();
const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
});
const page = await context.newPage();

// CDN cache harness (see browser-smoke-career.mjs)
const fs = require('fs');
const path = require('path');
const os = require('os');
const CDN_CACHE = path.join(os.tmpdir(), 'letsgolfweb-cdn-cache');
fs.mkdirSync(CDN_CACHE, { recursive: true });
await page.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://fonts.')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.includes('api.gih.golf')) return route.abort();
    const cacheFile = path.join(CDN_CACHE, url.replace(/^https:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_'));
    try {
        if (!fs.existsSync(cacheFile)) execFileSync('curl', ['-sSfL', '--max-time', '60', '-o', cacheFile, url]);
        return route.fulfill({
            contentType: /\.css(\?|$)/.test(url) ? 'text/css' : 'application/javascript',
            body: fs.readFileSync(cacheFile),
        });
    } catch (e) {
        console.error('CDN fetch failed:', url, e.message);
        return route.abort();
    }
});

const errors = [];
const EXPECTED = /api\.gih\.golf|Failed to fetch|checking for active game|net::ERR_FAILED/;
page.on('pageerror', e => { if (!EXPECTED.test(e.message)) errors.push('PAGEERROR: ' + e.message); });
page.on('console', msg => {
    if (msg.type() === 'error' && !EXPECTED.test(msg.text())) errors.push('CONSOLE: ' + msg.text());
});
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

await page.goto(BASE + '/index.html?touch=1', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-hole', { timeout: 15000 });
await sleep(1000);

// Start a bundled course round directly (the menu button opens a picker modal)
await page.evaluate(async () => {
    const main = await import('./src/main.js');
    const ui = await import('./src/ui.js');
    const lib = await import('./src/courseLibrary.js');
    const course = await lib.loadCourse(lib.BUNDLED_COURSES[0].file);
    ui.showGameView();
    await main.setGameMode(main.GAME_MODES.PLAY_HOLE, null, null, null, course);
});
await sleep(6000); // layout + terrain + placement

const run = (mode) => page.evaluate(async (camMode) => {
    const state = await import('./src/gameLogic/state.js');
    const playHole = await import('./src/modes/playHole.js');
    const core = await import('./src/visuals/core.js');
    const aim = await import('./src/aimAtPoint.js');
    const vis = await import('./src/visuals.js');
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js');

    const layout = playHole.getCurrentHoleLayout();
    const ballPos = playHole.getCurrentBallPosition();
    if (!layout || !ballPos) return { error: 'no layout/ball' };
    const flag = layout.flagPosition;
    const refAngle = Math.atan2(flag.x - ballPos.x, flag.z - ballPos.z) * 180 / Math.PI;
    const frames = (n) => new Promise(r => { let i = 0; const f = () => (++i > n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });

    // Aim 25° off the flag so a mirrored result cannot pass as correct
    state.setShotDirectionAngle(refAngle + 25);
    if (core.isFreeCameraActive()) core.toggleFreeCamera(); // back to static
    core.applyAimAngleToCamera();
    await frames(2);
    const cam = core.camera;
    const flagY = vis.queryTerrainHeight(flag.x, flag.z);

    if (camMode === 'flyover') {
        core.toggleFreeCamera();
        // Fly toward the green and climb, like a player scouting a landing spot
        for (let i = 0; i < 60; i++) core.freeCamNudge(0.5, 6, 0.8);
        // Steer to face the flag, kept slightly off-center (a mirror shows
        // only for off-center taps)
        for (let i = 0; i < 8; i++) {
            const dir = new THREE.Vector3();
            cam.getWorldDirection(dir);
            const wantYaw = Math.atan2(flag.x - cam.position.x, flag.z - cam.position.z);
            const flat = Math.hypot(flag.x - cam.position.x, flag.z - cam.position.z);
            const wantPitch = Math.atan2(flagY - cam.position.y, flat);
            core.freeCamLook(wantYaw - Math.atan2(dir.x, dir.z) + 0.12,
                wantPitch - Math.asin(Math.max(-1, Math.min(1, dir.y))));
            await frames(3);
        }
    }
    cam.updateMatrixWorld();

    // Where the flag RENDERS — then mirror to where it DISPLAYS (finger space)
    const p = new THREE.Vector3(flag.x, flagY, flag.z).project(cam);
    const canvas = document.getElementById('golf-canvas');
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + (p.x + 1) / 2 * rect.width;
    const sy = rect.top + (1 - p.y) / 2 * rect.height;
    if (p.z > 1 || sx < rect.left || sx > rect.right || sy < rect.top || sy > rect.bottom) {
        return { error: `flag off-screen (${camMode}): sx=${sx.toFixed(0)} sy=${sy.toFixed(0)}` };
    }
    const tf = getComputedStyle(canvas).transform;
    const mirrored = tf && tf !== 'none' && new DOMMatrix(tf).a < 0;
    const sxVisual = mirrored ? (rect.left + rect.right - sx) : sx;

    const before = state.getCurrentTargetLineAngle();
    aim.aimAtScreenPoint(sxVisual, sy);
    const after = state.getCurrentTargetLineAngle();
    if (core.isFreeCameraActive()) core.toggleFreeCamera();
    return { refAngle, before, after, mirrored, offCenterPx: Math.abs(sxVisual - (rect.left + rect.width / 2)) };
}, mode);

for (const mode of ['static', 'flyover']) {
    const r = await run(mode);
    if (r.error) fail(r.error);
    const diff = Math.abs(r.after - r.refAngle);
    const diffMirror = Math.abs(r.after - (2 * r.before - r.refAngle));
    console.log(`${mode}: canvas mirrored=${r.mirrored}, tap ${r.offCenterPx.toFixed(0)}px off-center, ` +
        `aim ${r.before.toFixed(1)}° → ${r.after.toFixed(1)}° (ref ${r.refAngle.toFixed(1)}°, Δ${diff.toFixed(2)}°)`);
    if (r.offCenterPx < 30) fail(`${mode}: tap too close to center to detect a mirror`);
    if (diffMirror < 3 && diff > 3) fail(`${mode}: aim is MIRRORED (got ${r.after.toFixed(1)}°, mirror of ref)`);
    if (diff > 3) fail(`${mode}: aim wrong: got ${r.after.toFixed(1)}°, expected ${r.refAngle.toFixed(1)}°`);
}

await browser.close();
if (errors.length) fail('page errors:\n' + errors.join('\n'));
console.log('browser-smoke-aim: PASS');
