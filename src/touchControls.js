// src/touchControls.js
//
// Touch controls + the mobile HUD layout. Zones dispatch synthetic
// KeyboardEvents on document, flowing through the exact same inputHandler
// paths as physical keys — same timing windows, same state guards, same
// shot variety.
//
// The mobile screen has two phases, toggled by the bottom pill:
//   SETUP — decisions: compact top bar, condensed info text, club/shot/
//     power/stance as a horizontal chip row, practice placement panel.
//     No swing surfaces.
//   ADDRESS — the shot: thumb zones, aim/camera, distance/wind/lie,
//     status, rhythm hint. Every other panel is stripped.
// The bottom pill is context-aware: ADDRESS BALL when ready, NEXT after a
// shot resolves (sends 'n'). A shot's result auto-returns to setup.
//
// Key mapping (mirrors the keyboard contract):
//   Full swing: hold SWING = 'w' down (backswing), release = 'w' up (top),
//     then HIPS/ARMS/WRISTS = 'j'/'d'/'i' taps; ROTATE = 'a'.
//   Chip/putt (rhythm): TAP = 'w' taps (tempo), STROKE = 'i' (strike; the
//     chip's optional shaping tap lands on the same zone).
//
// Shown only on touch-capable devices (?touch=1 forces on, ?touch=0 off).

import { getCurrentShotType, getGameState } from './gameLogic/state.js';

let overlayEl = null;
let updateTimer = null;
let cameraIdx = 0;
let addressMode = false;
let els = null;

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
        /* ============ Touch overlay: zones, pill, minis ============ */
        #touch-controls {
            --tc-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
            position: fixed;
            inset: 0;
            z-index: 10000; /* above every HUD stacking context; below modals (10001+) */
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
        .tc-zone .tc-hint { font-size: 0.6em; font-weight: 600; opacity: 0.65; white-space: nowrap; }
        .tc-zone.pressed { background: rgba(125, 255, 160, 0.4); border-color: #7dffa0; }
        .tc-zone.tc-hidden { display: none; }
        /* Left thumb */
        #tc-swing { left: 10px; bottom: var(--tc-bottom); width: min(36vw, 210px); height: min(28vh, 150px); font-size: 1.15em; }
        #tc-rotate { left: 10px; bottom: calc(var(--tc-bottom) + min(28vh, 150px) + 10px); width: min(36vw, 210px); height: 54px; }
        /* Right thumb: full-swing sequence */
        #tc-hips   { right: 10px; bottom: calc(var(--tc-bottom) + 2 * 64px); width: min(34vw, 180px); height: 54px; }
        #tc-arms   { right: 10px; bottom: calc(var(--tc-bottom) + 1 * 64px); width: min(34vw, 180px); height: 54px; }
        #tc-wrists { right: 10px; bottom: var(--tc-bottom); width: min(34vw, 180px); height: 54px; }
        /* Right thumb: rhythm stroke */
        #tc-stroke { right: 10px; bottom: var(--tc-bottom); width: min(34vw, 180px); height: min(28vh, 150px); font-size: 1.15em; }
        /* Utility minis: address phase only, top-left (the bar is stripped there) */
        .tc-mini {
            position: absolute;
            top: calc(8px + env(safe-area-inset-top, 0px));
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            width: 44px;
            height: 44px;
            border-radius: 12px;
            border: 1.5px solid rgba(255, 255, 255, 0.35);
            background: rgba(14, 30, 20, 0.55);
            color: #eaf6ec;
            font-weight: 700;
            font-size: 1.05em;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
            -webkit-tap-highlight-color: transparent;
        }
        .tc-mini.pressed { background: rgba(125, 255, 160, 0.4); }
        #tc-aim-left { left: 8px; }
        #tc-aim-right { left: 60px; }
        #tc-cam { left: 112px; }
        /* Bottom pill (context-aware) and the Setup return button */
        .tc-action {
            position: absolute;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            border-radius: 14px;
            font-weight: 800;
            letter-spacing: 0.04em;
            color: #0e1e14;
            background: rgba(125, 255, 160, 0.92);
            border: 2px solid rgba(255, 255, 255, 0.5);
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
            -webkit-tap-highlight-color: transparent;
        }
        .tc-action.pressed { background: #fff; }
        #tc-address {
            bottom: calc(var(--tc-bottom) + 4px);
            left: 50%;
            transform: translateX(-50%);
            width: min(70vw, 320px);
            height: 56px;
            font-size: 1.1em;
        }
        #tc-exit {
            top: calc(8px + env(safe-area-inset-top, 0px));
            right: 8px;
            height: 44px;
            padding: 0 16px;
            font-size: 0.8em;
            background: rgba(14, 30, 20, 0.6);
            color: #eaf6ec;
            border: 1.5px solid rgba(255, 255, 255, 0.35);
        }
        /* Phase gating inside the overlay */
        #touch-controls.setup .tc-zone,
        #touch-controls.setup .tc-mini,
        #touch-controls.setup #tc-exit { display: none; }
        #touch-controls:not(.setup) #tc-address { display: none; }

        /* ============ Mobile HUD compaction (both phases) ============ */
        /* Top bar: one compact scrollable row, never wraps */
        body.touch-active #fullscreen-top-bar {
            height: auto;
            padding: calc(4px + env(safe-area-inset-top, 0px)) 8px 4px;
            gap: 6px;
            overflow-x: auto;
            scrollbar-width: none;
        }
        body.touch-active #fullscreen-top-bar::-webkit-scrollbar { display: none; }
        body.touch-active .fullscreen-bar-btn {
            padding: 7px 10px;
            font-size: 12px;
            white-space: nowrap;
            flex: 0 0 auto;
        }
        body.touch-active #back-to-menu-button,
        body.touch-active #switch-hole-button,
        body.touch-active #fullscreen-toggle-btn { font-size: 12px; padding: 7px 10px; }
        body.touch-active #reset-game-data-button { display: none; }
        /* Info text: compact */
        body.touch-active .overlay-text-item {
            font-size: 12.5px;
            line-height: 1.35;
            margin-bottom: 1px;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
        }
        body.touch-active #visual-info-overlay { padding: 8px; }
        /* Vertical rhythm: bar/minis (0-52) → status line (58-78) → info (84+) */
        body.touch-active .overlay-top { margin-top: 84px !important; }
        body.touch-active #top-center-status {
            top: calc(58px + env(safe-area-inset-top, 0px)) !important;
            max-width: 80vw;
        }
        /* Club/shot/power/stance: horizontal chip row above the pill */
        body.touch-active #fullscreen-controls {
            top: auto;
            bottom: calc(84px + env(safe-area-inset-bottom, 0px));
            left: 8px;
            right: 8px;
            flex-direction: row;
            align-items: stretch;
            gap: 6px;
            overflow-x: auto;
            scrollbar-width: none;
            -webkit-overflow-scrolling: touch;
        }
        body.touch-active #fullscreen-controls::-webkit-scrollbar { display: none; }
        body.touch-active .fs-control-btn {
            min-width: auto;
            flex: 0 0 auto;
            padding: 6px 12px;
            font-size: 12px;
            text-align: center;
        }
        body.touch-active .fs-control-btn .label { font-size: 9px; margin-bottom: 1px; }
        body.touch-active .fs-control-btn .value { font-size: 12px; }
        /* Selection popups become bottom sheets */
        body.touch-active .fs-control-panel {
            left: 8px !important;
            right: 8px !important;
            top: auto !important;
            bottom: calc(136px + env(safe-area-inset-bottom, 0px)) !important;
            max-height: 45vh;
            overflow-y: auto;
        }
        /* Practice placement panel: right column below the shot info */
        body.touch-active #practice-panel {
            top: 124px;
            left: auto;
            right: 8px;
            max-height: calc(100vh - 320px);
            overflow-y: auto;
        }
        /* Player/score line: small strip above the chip row */
        body.touch-active .overlay-bottom {
            position: fixed;
            left: 8px;
            right: 8px;
            bottom: calc(132px + env(safe-area-inset-bottom, 0px));
        }
        body.touch-active .overlay-bottom .overlay-text-item { font-size: 11px; }
        /* Rhythm hint: compact, kept clear of chips/pill (setup) and zones (address) */
        body.touch-active #rhythm-putt-hud {
            max-width: min(380px, 94vw);
            padding: 8px 12px;
            gap: 10px;
            font-size: 12px;
            bottom: calc(184px + env(safe-area-inset-bottom, 0px));
        }
        body.tc-address #rhythm-putt-hud {
            bottom: calc(238px + env(safe-area-inset-bottom, 0px));
        }
        body.touch-active #rhythm-putt-hint {
            font-size: 11px;
            line-height: 1.35;
            min-width: 104px;
        }
        @media (orientation: landscape) {
            /* Landscape: the strip between the thumb zones is free */
            body.tc-address #rhythm-putt-hud {
                bottom: calc(14px + env(safe-area-inset-bottom, 0px));
            }
        }

        /* ============ Address phase: strip everything non-shot ============ */
        body.tc-address #fullscreen-controls,
        body.tc-address #practice-panel,
        body.tc-address #fullscreen-top-bar,
        body.tc-address #back-to-menu-button,
        body.tc-address #switch-hole-button,
        body.tc-address #reset-game-data-button,
        body.tc-address #fullscreen-toggle-btn,
        body.tc-address #multiplayer-scoreboard,
        body.tc-address .overlay-top-left,
        body.tc-address .overlay-bottom { display: none !important; }
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

/** Setup shows the decision UI; address shows only the shot surfaces. */
function setAddressMode(on) {
    addressMode = on;
    document.body.classList.toggle('tc-address', on);
    overlayEl.classList.toggle('setup', !on);
}

/** Keeps the overlay in sync with menu/game, shot type, and game state. */
function updateZones() {
    const menu = document.getElementById('main-menu');
    const menuVisible = menu && (menu.checkVisibility
        ? menu.checkVisibility()
        : menu.getClientRects().length > 0);
    const inGame = !menuVisible;
    const wasInGame = overlayEl.classList.contains('visible');
    overlayEl.classList.toggle('visible', inGame);
    if (!inGame) {
        if (addressMode) setAddressMode(false); // never leave HUD stripped behind the menu
        return;
    }
    if (!wasInGame) setAddressMode(false); // every mode entry starts in setup

    const state = getGameState();

    // The shot is over — bring the info panels back for the next decision
    if (addressMode && state === 'result') setAddressMode(false);

    // Bottom pill follows context: address the ball, or advance after a shot
    els.address.textContent = state === 'result' ? 'NEXT  ᐅ' : '⛳ ADDRESS BALL';

    const shotType = getCurrentShotType();
    const full = shotType === 'full';
    els.rotate.classList.toggle('tc-hidden', !full);
    els.hips.classList.toggle('tc-hidden', !full);
    els.arms.classList.toggle('tc-hidden', !full);
    els.wrists.classList.toggle('tc-hidden', !full);
    els.stroke.classList.toggle('tc-hidden', full);
    els.swing.innerHTML = full
        ? 'SWING<span class="tc-hint">hold · release at top</span>'
        : 'TAP<span class="tc-hint">tap a tempo</span>';
}

export function initTouchControls() {
    if (overlayEl || !wantTouchControls()) return false;

    injectStyles();
    document.body.classList.add('touch-active');
    overlayEl = document.createElement('div');
    overlayEl.id = 'touch-controls';
    overlayEl.classList.add('setup');
    document.body.appendChild(overlayEl);

    els = {
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

    // Context pill: ADDRESS BALL when ready, NEXT after a shot resolves
    const addressBtn = document.createElement('div');
    addressBtn.id = 'tc-address';
    addressBtn.className = 'tc-action';
    addressBtn.textContent = '⛳ ADDRESS BALL';
    bindZone(addressBtn, () => {
        if (getGameState() === 'result') sendKey('keydown', 'n');
        else setAddressMode(true);
    }, null);
    overlayEl.appendChild(addressBtn);
    els.address = addressBtn;

    const exitBtn = document.createElement('div');
    exitBtn.id = 'tc-exit';
    exitBtn.className = 'tc-action';
    exitBtn.textContent = '⚙ Setup';
    bindZone(exitBtn, () => setAddressMode(false), null);
    overlayEl.appendChild(exitBtn);

    // Keep the page pinned while thumbs mash zones near the edges
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';

    updateZones();
    updateTimer = setInterval(updateZones, 350);
    console.log('Touch controls active');
    return true;
}

export function isTouchControlsActive() {
    return !!overlayEl;
}
