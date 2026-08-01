// Pulling the flagstick must not leave its SHADOW painted on the green.
// renderer.shadowMap.autoUpdate is off, so anything that hides or shows a
// shadow caster has to request a refresh — otherwise the stale map keeps
// drawing a dark blob beside the cup (reported in the wild, Aarhus 3).
//
// Method: on the practice green (placement pulls the flag), grab the hole
// area, force a shadow refresh, grab again. If a stale shadow were present
// the refresh would visibly BRIGHTEN the area; identical luminance means
// nothing was left over. Run: node tests/browser-smoke-flagshadow.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync, execFileSync } = require('child_process');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(require.resolve('playwright', { paths: [globalRoot, '/usr/local/lib/node_modules'] }));

const BASE = 'http://localhost:8788';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true }));
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
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

await page.goto(BASE + '/index.html?touch=1', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-practice', { timeout: 15000 });
await sleep(1000);
await page.evaluate(async () => {
    const main = await import('./src/main.js');
    const ui = await import('./src/ui.js');
    ui.showGameView();
    await main.setGameMode(main.GAME_MODES.PLAY_HOLE, null, null, 'putt');
});
await sleep(4000);

const info = await page.evaluate(async () => {
    const ph = await import('./src/modes/playHole.js');
    const core = await import('./src/visuals/core.js');
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js');
    let cloth = null, halo = null;
    core.scene.traverse(o => {
        if (o.name === 'FlagCloth') cloth = o;
        if (o.name === 'HoleCup') o.children.forEach(ch => {
            if (ch.geometry?.type === 'RingGeometry' && ch.material.transparent) halo = ch;
        });
    });
    const flag = ph.getCurrentHoleLayout().flagPosition;
    const v = new THREE.Vector3(flag.x, flag.y + 0.6, flag.z).project(core.camera);
    const rect = core.renderer.domElement.getBoundingClientRect();
    return {
        clothVisible: cloth?.visible ?? null,
        haloVisible: halo?.visible ?? null,
        // Canvas is CSS-mirrored (scaleX(-1)) — flip NDC x for screen space
        sx: rect.left + rect.width * (1 - (v.x + 1) / 2),
        sy: rect.top + rect.height * (1 - v.y) / 2,
    };
});
if (info.clothVisible !== false) fail('flag should be pulled with the ball on the green');
if (info.haloVisible !== true) fail('hole halo should mark the cup while the flag is out');

// The contract, asserted directly: toggling a shadow caster's visibility must
// mark the shadow map dirty. Checked synchronously — the render loop consumes
// needsUpdate on the next frame. (A pixel diff was tried first and does not
// discriminate: other steps in the placement flow happen to refresh the map
// too, so the blob only survives on some paths.)
const contract = await page.evaluate(async () => {
    const core = await import('./src/visuals/core.js');
    const hv = await import('./src/visuals/holeView.js');
    // Start from a clean slate: render a frame so needsUpdate is consumed
    core.requestShadowUpdate();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const settled = core.renderer.shadowMap.needsUpdate;
    hv.setFlagstickVisibility(true);   // flag back IN — pole/cloth cast again
    const afterShow = core.renderer.shadowMap.needsUpdate;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    hv.setFlagstickVisibility(false);  // flag pulled — its shadow must go
    const afterHide = core.renderer.shadowMap.needsUpdate;
    return { settled, afterShow, afterHide };
});
await browser.close();
console.log(`shadowMap.needsUpdate — settled: ${contract.settled}, after show: ${contract.afterShow}, after hide: ${contract.afterHide}`);
if (contract.settled !== false) fail('shadow map never settles — cannot judge the toggle');
if (contract.afterShow !== true) fail('showing the flagstick did not request a shadow refresh');
if (contract.afterHide !== true) fail('hiding the flagstick did not request a shadow refresh — its shadow stays painted on the green');
console.log('browser-smoke-flagshadow: PASS');
