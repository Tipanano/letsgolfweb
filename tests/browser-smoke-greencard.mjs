// Browser smoke test: Green Card modal, drill launch, and attempt scoring.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Resolve playwright from the global install, wherever this machine keeps it.
const { execSync, execFileSync } = require('child_process');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(require.resolve('playwright', { paths: [globalRoot, '/usr/local/lib/node_modules'] }));

const BASE = 'http://localhost:8788';
const OUT = new URL('.', import.meta.url).pathname;
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// Serve CDN dependencies from a curl-populated disk cache (see
// browser-smoke-career.mjs for rationale).
const fs = require('fs');
const path = require('path');
const os = require('os');
const CDN_CACHE = path.join(os.tmpdir(), 'letsgolfweb-cdn-cache');
fs.mkdirSync(CDN_CACHE, { recursive: true });
await page.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://fonts.')) {
        return route.fulfill({ contentType: 'text/css', body: '' });
    }
    if (url.includes('api.gih.golf')) {
        return route.abort(); // game server: offline is a supported state
    }
    const cacheFile = path.join(CDN_CACHE,
        url.replace(/^https:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_'));
    try {
        if (!fs.existsSync(cacheFile)) {
            execFileSync('curl', ['-sSfL', '--max-time', '60', '-o', cacheFile, url]);
        }
        const contentType = /\.css(\?|$)/.test(url) ? 'text/css' : 'application/javascript';
        return route.fulfill({ contentType, body: fs.readFileSync(cacheFile) });
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

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-greencard', { timeout: 15000 });
await sleep(1000);

// Open the Green Card modal
await page.click('#mode-btn-greencard');
await page.waitForSelector('#greencard-modal.visible', { timeout: 5000 });
const modalInfo = await page.evaluate(() => ({
    drills: document.querySelectorAll('.gc-drill').length,
    titles: [...document.querySelectorAll('.gc-title')].map(el => el.textContent.trim()),
}));
await page.screenshot({ path: OUT + 'shot-greencard-modal.png' });

// Launch the holing-out drill (putting green — cheapest layout)
await page.click('.gc-drill:last-child');
await sleep(5000); // layout draw + placement

const drillInfo = await page.evaluate(async () => {
    const gc = await import('./src/career/greenCard.js');
    // Drills are the tutorial: instruction hints must show during a drill
    // even though they are hidden by default everywhere else.
    const hud = document.getElementById('rhythm-putt-hud');
    return {
        active: gc.getActiveDrill(),
        hintShown: !!hud && hud.classList.contains('visible'),
    };
});

// Simulate a holed attempt straight through the real shot-result path
const afterShot = await page.evaluate(async () => {
    const ph = await import('./src/modes/playHole.js');
    ph.handleShotResult({ finalPosition: { x: 2, y: 0, z: 58 }, isHoledOut: true, surfaceName: 'HOLE' });
    const gc = await import('./src/career/greenCard.js');
    return {
        holingCount: gc.getProgress().counts.holing || 0,
        status: document.getElementById('status-text-display')?.textContent || '',
    };
});
await page.screenshot({ path: OUT + 'shot-greencard-drill.png' });

// The full-swing drill layouts must survive the real hole-processing pipeline
const layoutCheck = await page.evaluate(async () => {
    const { processHoleLayout } = await import('./src/holeLoader.js');
    const { drivingDrillLayout, approachDrillLayout } = await import('./src/career/drillHoles.js');
    const drive = processHoleLayout(drivingDrillLayout());
    const par3 = processHoleLayout(approachDrillLayout());
    return { drive: !!(drive && drive.flagPosition), par3: !!(par3 && par3.flagPosition) };
});
await browser.close();

const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };
if (errors.length) fail('page errors:\n' + errors.join('\n'));
if (modalInfo.drills !== 6) fail(`expected 6 drills, got ${modalInfo.drills}`);
if (!modalInfo.titles.some(t => t.startsWith('Driving'))) fail(`missing Driving drill: ${modalInfo.titles}`);
if (drillInfo.active !== 'holing') fail(`expected active drill 'holing', got ${drillInfo.active}`);
if (!drillInfo.hintShown) fail('instruction hint hidden during a Green Card drill (drills are the tutorial)');
if (afterShot.holingCount !== 1) fail(`expected holing count 1, got ${afterShot.holingCount}`);
if (!/1\/5/.test(afterShot.status)) fail(`status missing 1/5: "${afterShot.status}"`);
if (!layoutCheck.drive || !layoutCheck.par3) fail(`drill layouts failed processing: ${JSON.stringify(layoutCheck)}`);

console.log('browser-smoke-greencard: PASS — 6 drills, holing drill active, attempt scored 1/5');
