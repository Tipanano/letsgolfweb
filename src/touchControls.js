// src/touchControls.js
//
// Touch controls: on-screen zones that dispatch synthetic KeyboardEvents on
// document, flowing through the exact same inputHandler paths as physical
// keys — same timing windows, same state guards, same shot variety.
//
// Mapping (mirrors the keyboard contract):
//   Full swing: hold SWING = 'w' down (backswing), release = 'w' up (top),
//     then HIPS/ARMS/WRISTS = 'j'/'d'/'i' taps; ROTATE = 'a' (during
//     backswing for early rotation, or in the downswing sequence).
//   Chip/putt (rhythm): TAP zone = 'w' taps (tempo), STROKE = 'i'
//     (strike; chips take the optional second shaping tap on the same zone).
//   Utility row: aim ◀ ▶ (arrows), camera cycle (1-4), (n) next.
//
// Shown only on touch-capable devices (or with ?touch=1 for testing;
// ?touch=0 forces off). Zones relabel automatically per shot type.

import { getCurrentShotType, getGameState } from './gameLogic/state.js';

let overlayEl = null;
let updateTimer = null;
let cameraIdx = 0;

function wantTouchControls() {
    const param = new URLSearchParams(location.search).get('touch');
    if (param === '1') return true;
    if (param === '0') return false;
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

function sendKey(type, key) {
    document.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
}

function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        #touch-controls {
            position: fixed;
            inset: 0;
            z-index: 10000; /* above every HUD panel/stacking context; below modals (10001+) */
            display: none;
            pointer-events: none;
            font-family: 'Open Sans', system-ui, sans-serif;
        }
        #touch-controls.visible { display: block; }
        .tc-zone {
            position: absolute;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
            pointer-events: auto;
            border-radius: 16px;
            border: 1.5px solid rgba(125, 255, 160, 0.45);
            background: rgba(14, 30, 20, 0.5);
            color: #eaf6ec;
            font-weight: 700;
            font-size: 0.95em;
            letter-spacing: 0.03em;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
            -webkit-tap-highlight-color: transparent;
        }
        .tc-zone .tc-hint { font-size: 0.62em; font-weight: 600; opacity: 0.65; }
        .tc-zone.pressed { background: rgba(125, 255, 160, 0.4); border-color: #7dffa0; }
        .tc-zone.tc-hidden { display: none; }
        /* Left thumb */
        #tc-swing { left: 10px; bottom: 10px; width: min(32vw, 210px); height: min(30vh, 150px); font-size: 1.15em; }
        #tc-rotate { left: 10px; bottom: calc(min(30vh, 150px) + 20px); width: min(32vw, 210px); height: 56px; }
        /* Right thumb: full-swing sequence */
        #tc-hips   { right: 10px; bottom: calc(2 * 66px + 10px); width: min(30vw, 180px); height: 56px; }
        #tc-arms   { right: 10px; bottom: calc(1 * 66px + 10px); width: min(30vw, 180px); height: 56px; }
        #tc-wrists { right: 10px; bottom: 10px; width: min(30vw, 180px); height: 56px; }
        /* Right thumb: rhythm stroke */
        #tc-stroke { right: 10px; bottom: 10px; width: min(30vw, 180px); height: min(30vh, 150px); font-size: 1.15em; }
        /* Utility row (top-left, under the menu bar; the right edge belongs
           to #fullscreen-controls) */
        .tc-mini {
            position: absolute;
            top: 58px;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            width: 46px;
            height: 46px;
            border-radius: 12px;
            border: 1.5px solid rgba(255, 255, 255, 0.35);
            background: rgba(14, 30, 20, 0.5);
            color: #eaf6ec;
            font-weight: 700;
            font-size: 1.05em;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
            -webkit-tap-highlight-color: transparent;
        }
        .tc-mini.pressed { background: rgba(125, 255, 160, 0.4); }
        #tc-aim-left { left: 10px; }
        #tc-aim-right { left: 64px; }
        #tc-cam { left: 118px; }
        #tc-next { left: 172px; }
        /* Touch mode squeezes HUD panels out of the thumb zones */
        body.touch-active #practice-panel {
            top: 58px;
            left: auto;
            right: 160px;
            max-height: 45vh;
            overflow-y: auto;
        }
        body.touch-active #fullscreen-controls {
            top: 58px;
            right: 200px;
        }
    `;
    document.head.appendChild(style);
}

/**
 * Binds press/release handlers. Pointer capture keeps the release on the
 * zone even if the thumb slides off — vital for the held SWING zone.
 */
function bindZone(el, onDown, onUp) {
    el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no active pointer */ }
        el.classList.add('pressed');
        onDown();
    });
    const release = (e) => {
        if (!el.classList.contains('pressed')) return;
        el.classList.remove('pressed');
        if (onUp) onUp();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function makeZone(id, html, key) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'tc-zone';
    el.innerHTML = html;
    if (key) bindZone(el, () => sendKey('keydown', key), () => sendKey('keyup', key));
    overlayEl.appendChild(el);
    return el;
}

function makeMini(id, label, onDown) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'tc-mini';
    el.textContent = label;
    bindZone(el, onDown, null);
    overlayEl.appendChild(el);
    return el;
}

/** Relabels/reshapes zones for the active shot type; hides over the menu. */
function updateZones(zones) {
    const menu = document.getElementById('main-menu');
    const menuVisible = menu && (menu.checkVisibility
        ? menu.checkVisibility()
        : menu.getClientRects().length > 0);
    const inGame = !menuVisible;
    overlayEl.classList.toggle('visible', inGame);
    if (!inGame) return;

    const shotType = getCurrentShotType();
    const full = shotType === 'full';
    zones.rotate.classList.toggle('tc-hidden', !full);
    zones.hips.classList.toggle('tc-hidden', !full);
    zones.arms.classList.toggle('tc-hidden', !full);
    zones.wrists.classList.toggle('tc-hidden', !full);
    zones.stroke.classList.toggle('tc-hidden', full);
    zones.swing.innerHTML = full
        ? 'SWING<span class="tc-hint">hold · release at top</span>'
        : 'TAP<span class="tc-hint">tap a tempo</span>';
}

export function initTouchControls() {
    if (overlayEl || !wantTouchControls()) return false;

    injectStyles();
    document.body.classList.add('touch-active');
    overlayEl = document.createElement('div');
    overlayEl.id = 'touch-controls';
    document.body.appendChild(overlayEl);

    const zones = {
        swing: makeZone('tc-swing', 'SWING<span class="tc-hint">hold · release at top</span>', 'w'),
        rotate: makeZone('tc-rotate', 'ROTATE<span class="tc-hint">turn through</span>', 'a'),
        hips: makeZone('tc-hips', 'HIPS<span class="tc-hint">start down</span>', 'j'),
        arms: makeZone('tc-arms', 'ARMS<span class="tc-hint">swing down</span>', 'd'),
        wrists: makeZone('tc-wrists', 'WRISTS<span class="tc-hint">release</span>', 'i'),
        stroke: makeZone('tc-stroke', 'STROKE<span class="tc-hint">on the beat</span>', 'i'),
    };

    makeMini('tc-aim-left', '◀', () => sendKey('keydown', 'ArrowLeft'));
    makeMini('tc-aim-right', '▶', () => sendKey('keydown', 'ArrowRight'));
    makeMini('tc-cam', '📷', () => {
        cameraIdx = (cameraIdx + 1) % 4;
        sendKey('keydown', String(cameraIdx + 1));
    });
    makeMini('tc-next', 'ᴺ', () => sendKey('keydown', 'n'));

    // Keep the page pinned while thumbs mash zones near the edges
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';

    updateZones(zones);
    updateTimer = setInterval(() => updateZones(zones), 350);
    console.log('Touch controls active');
    return true;
}

export function isTouchControlsActive() {
    return !!overlayEl;
}
