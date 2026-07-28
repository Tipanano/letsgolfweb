import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OUT = new URL('.', import.meta.url).pathname;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message.slice(0, 200)));
await page.goto('http://localhost:8788/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mode-btn-practice', { timeout: 15000 });
await sleep(1500);
await page.click('#mode-btn-practice');
await page.click('#mode-btn-chipping');
await sleep(5500);

// Close look at the practice green's right bunker (center ~18,49, r4) from the fairway side
await page.evaluate(async () => {
  const core = await import('./src/visuals/core.js');
  core.camera.position.set(10, 2.2, 42);
  core.camera.lookAt(18, -0.4, 50);
});
await sleep(400);
await page.screenshot({ path: OUT + 'terr1-bunker.png' });

// Synthetic hole with water to check the sheet + banks
const HOLE = {
  name: 'Water Test', par: 4,
  background: { vertices: [{x:-70,z:-20},{x:70,z:-20},{x:70,z:230},{x:-70,z:230}], surface: 'OUT_OF_BOUNDS' },
  tee: { center: { x: 0, y: 0, z: 5 }, width: 6, depth: 4, surface: 'TEE' },
  fairways: [{ controlPoints: [{x:-12,z:12},{x:12,z:12},{x:14,z:150},{x:-14,z:150}], surface: 'FAIRWAY' }],
  greens: [{ controlPoints: Array.from({length:18},(_,i)=>{const a=i/18*Math.PI*2;return {x:+(Math.cos(a)*12).toFixed(2),z:+(175+Math.sin(a)*12).toFixed(2)};}), surface: 'GREEN' }],
  lightRough: [{ vertices: [{x:-40,z:0},{x:40,z:0},{x:40,z:205},{x:-40,z:205}], surface: 'LIGHT_ROUGH' }],
  waterHazards: [{ controlPoints: Array.from({length:16},(_,i)=>{const a=i/16*Math.PI*2;return {x:+(24+Math.cos(a)*11).toFixed(2),z:+(90+Math.sin(a)*14).toFixed(2)};}), surface: 'WATER' }],
  bunkers: [{ controlPoints: Array.from({length:14},(_,i)=>{const a=i/14*Math.PI*2;return {x:+(-16+Math.cos(a)*5).toFixed(2),z:+(165+Math.sin(a)*4).toFixed(2)};}), surface: 'BUNKER' }],
  flagPositions: [{ number: 1, x: 0, y: 0, z: 175 }],
};
const drew = await page.evaluate(async (hole) => {
  try {
    const { processHoleLayout } = await import('./src/holeLoader.js');
    const layout = processHoleLayout(hole);
    const visuals = await import('./src/visuals.js');
    visuals.drawHole(layout);
    return 'ok';
  } catch (e) { return 'ERR: ' + (e.message || e); }
}, HOLE);
console.log('DRAW:', drew);
await sleep(1500);
// Look across the pond from short range
await page.evaluate(async () => {
  const core = await import('./src/visuals/core.js');
  core.camera.position.set(8, 2.5, 70);
  core.camera.lookAt(26, -0.5, 92);
});
await sleep(400);
await page.screenshot({ path: OUT + 'terr2-water.png' });
console.log('ERRORS:', errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
