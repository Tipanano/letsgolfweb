// Browser smoke test: career modal renders from a seeded local career record.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Resolve playwright from the global install, wherever this machine keeps it.
const { execSync } = require('child_process');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(require.resolve('playwright', { paths: [globalRoot, '/usr/local/lib/node_modules'] }));

const BASE = 'http://localhost:8788';
const OUT = new URL('.', import.meta.url).pathname;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Prefer the system Chrome the other smoke tests use; fall back to any
// chromium this environment provides (e.g. PLAYWRIGHT_BROWSERS_PATH).
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

// Serve CDN dependencies (three.js, socket.io, ...) from a curl-populated
// disk cache so the test also runs in sandboxes where the browser has no
// direct egress (curl knows the proxy/CA; chromium doesn't).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const CDN_CACHE = path.join(os.tmpdir(), 'letsgolfweb-cdn-cache');
fs.mkdirSync(CDN_CACHE, { recursive: true });
await page.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://fonts.')) {
        return route.fulfill({ contentType: 'text/css', body: '' }); // cosmetic only
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
// Expected offline noise: the multiplayer server being unreachable is a
// supported state and handled by the app.
const EXPECTED = /api\.gih\.golf|Failed to fetch|checking for active game|net::ERR_FAILED/;
page.on('pageerror', e => { if (!EXPECTED.test(e.message)) errors.push('PAGEERROR: ' + e.message); });
page.on('console', msg => {
    if (msg.type() === 'error' && !EXPECTED.test(msg.text())) errors.push('CONSOLE: ' + msg.text());
});

// Seed a three-round career before the app loads.
await page.addInitScript(() => {
    const mkHoles = (strokesList) => strokesList.map((s, i) => ({
        hole: i + 1, par: [4,4,3,5,4,4,3,5,4, 4,4,3,5,4,4,3,5,4][i], strokes: s, lengthMeters: 320 + i * 5,
    }));
    const rounds = [
        { date: '2026-07-01T10:00:00Z', courseName: 'Stjørdal GK', par: 69, rating: 70.0, slope: 137,
          holeCount: 18, total: 95, differential: 20.6, holes: mkHoles([6,5,4,7,5,6,4,7,5, 6,5,4,6,5,6,4,6,4]) },
        { date: '2026-07-12T10:00:00Z', courseName: 'Stjørdal GK', par: 69, rating: 70.0, slope: 137,
          holeCount: 18, total: 90, differential: 16.5, holes: mkHoles([5,5,4,6,5,5,4,6,5, 5,5,4,6,5,5,4,6,5]) },
        { date: '2026-07-25T10:00:00Z', courseName: 'St Andrews (Old Course)', par: 72, rating: 76.1, slope: 155,
          holeCount: 18, total: 88, differential: 8.7, holes: mkHoles([5,5,4,6,5,5,4,6,5, 5,5,3,6,5,5,4,6,4]) },
    ];
    localStorage.setItem('golfCareerV1', JSON.stringify({ rounds }));
});

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-career', { timeout: 15000 });
await sleep(1000);

await page.click('#mode-btn-career');
await page.waitForSelector('#career-modal.visible', { timeout: 5000 });
await sleep(300);

const info = await page.evaluate(() => {
    const text = document.querySelector('.career-modal-box').innerText;
    return {
        hasIndex: /Handicap index/.test(text),
        indexShown: text.match(/^(\d+\.\d)/m)?.[1] || null,
        hasSpark: !!document.querySelector('.career-spark svg'),
        statCount: document.querySelectorAll('.career-stat').length,
        bestRows: document.querySelectorAll('.career-best-row').length,
        roundRows: document.querySelectorAll('.career-round-row').length,
        text,
    };
});

// Expand the newest round's scorecard
await page.click('.career-round-row');
const scorecardOpen = await page.evaluate(() =>
    document.querySelector('.career-scorecard').classList.contains('open') &&
    /Out/.test(document.querySelector('.career-scorecard pre').textContent));

// --- Profile header: default name, inline edit, persistence, avatar cycle ---
const profileBefore = await page.evaluate(() => ({
    name: document.getElementById('career-name')?.textContent,
    avatar: document.getElementById('career-avatar')?.textContent,
    meta: document.querySelector('.career-profile-meta')?.textContent || '',
}));
if (profileBefore.name !== 'Player') fail(`default profile name wrong: ${JSON.stringify(profileBefore)}`);
if (!/Playing since/.test(profileBefore.meta) || !/Green Card 0\/6/.test(profileBefore.meta)) {
    fail(`profile meta wrong: "${profileBefore.meta}"`);
}
await page.click('#career-name');
await page.fill('#career-name-edit', 'Anders');
await page.keyboard.press('Enter');
await sleep(200);
await page.click('#career-avatar'); // cycle 🏌️ → 🏌️‍♀️
await sleep(150);
// Close, reopen: both edits must persist (they live in the career record)
await page.click('.career-modal-close');
await sleep(200);
await page.click('#mode-btn-career');
await page.waitForSelector('#career-modal.visible', { timeout: 5000 });
await sleep(200);
const profileAfter = await page.evaluate(() => ({
    name: document.getElementById('career-name')?.textContent,
    avatar: document.getElementById('career-avatar')?.textContent,
    stored: JSON.parse(localStorage.getItem('golfCareerV1')).profile,
}));
if (profileAfter.name !== 'Anders') fail(`edited name did not persist: ${JSON.stringify(profileAfter)}`);
if (profileAfter.avatar === '🏌️') fail('avatar did not cycle');
if (profileAfter.stored?.name !== 'Anders') fail(`profile not in stored career: ${JSON.stringify(profileAfter.stored)}`);

await page.screenshot({ path: OUT + 'shot-career-modal.png' });
await browser.close();

const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };
if (errors.length) fail('page errors:\n' + errors.join('\n'));
if (!info.hasIndex) fail('no handicap index label');
// Diffs 20.6, 16.5, 8.7 -> n=3 table: lowest - 2 = 6.7
if (info.indexShown !== '6.7') fail(`expected index 6.7, got ${info.indexShown}\n${info.text}`);
if (!info.hasSpark) fail('no trend sparkline');
if (info.statCount !== 6) fail(`expected 6 stat tiles, got ${info.statCount}`);
if (info.bestRows !== 2) fail(`expected 2 course-best rows, got ${info.bestRows}`);
if (info.roundRows !== 3) fail(`expected 3 history rows, got ${info.roundRows}`);
if (!scorecardOpen) fail('scorecard did not expand');

console.log('browser-smoke-career: PASS — index 6.7, sparkline, 3 rounds, scorecard expands, profile edits persist');
