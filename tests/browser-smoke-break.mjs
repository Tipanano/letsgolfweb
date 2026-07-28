import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OUT = new URL('.', import.meta.url).pathname;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message.slice(0, 200)));

await page.goto('http://localhost:8788/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-practice', { timeout: 15000 });
await sleep(1500);
await page.click('#mode-btn-practice');
await page.click('#mode-btn-putting');
await sleep(4500);
await page.screenshot({ path: OUT + 'break1-contoured-green.png' });

// Deterministic roll: straight putt from (2,48) toward the flag line (+z) at 2.6 m/s.
// Path passes west of the right crown → should break LEFT (-x) and finish on the terrain.
const roll = await page.evaluate(async () => {
  const sim = await import('./src/gameLogic/simulation.js');
  const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js');
  const G = await import('./src/greenContours.js');
  const start = new THREE.Vector3(2, 0.1, 48);
  const res = sim.simulateGroundRoll(start, new THREE.Vector3(0, 0, 2.6), 'GREEN', 100, 0, 0, null);
  const f = res.finalPosition;
  return {
    final: { x: +f.x.toFixed(3), y: +f.y.toFixed(3), z: +f.z.toFixed(3) },
    breakX: +(f.x - 2).toFixed(3),
    rollDist: +Math.hypot(f.x - 2, f.z - 48).toFixed(2),
    terrainAtFinal: +G.heightAt(f.x, f.z).toFixed(3),
    holed: res.isHoledOut,
  };
});
console.log('ROLL:', JSON.stringify(roll));

// Ball/camera state on the contoured green
const state = await page.evaluate(async () => {
  const core = await import('./src/visuals/core.js');
  const v = await import('./src/visuals.js');
  const b = core.ball.position;
  return { ballY: +b.y.toFixed(3), terrainAtBall: +(v.queryTerrainHeight(b.x, b.z)).toFixed(3), visible: core.ball.visible };
});
console.log('BALL:', JSON.stringify(state));

// Play a real putt through the input system
for (let i = 0; i < 4; i++) { await page.keyboard.press('w'); await sleep(500); }
await sleep(480);
await page.keyboard.press('i');
await sleep(6000);
await page.screenshot({ path: OUT + 'break2-after-putt.png' });
const after = await page.evaluate(async () => {
  const s = await import('./src/gameLogic/state.js');
  const core = await import('./src/visuals/core.js');
  return { gameState: s.getGameState(), ballY: +core.ball.position.y.toFixed(3) };
});
console.log('AFTER PUTT:', JSON.stringify(after));
console.log('ERRORS (' + errors.length + '):');
errors.slice(0, 6).forEach(e => console.log('  ' + e));
await browser.close();
