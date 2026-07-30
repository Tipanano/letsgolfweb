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
// Input model: two thumb zones, alternated like drumming.
//   Full swing: hold SWING = 'w' down (backswing), release = 'w' up (top).
//     After that every tap — either zone — fires the NEXT beat of the
//     kinematic chain: hips ('j') → rotation ('a') → arms ('d') → wrists
//     ('i'), matching the physics' ideal order (j at −150 ms, a +50,
//     d +100, i +250). Taps while still holding the backswing pre-load
//     early rotation/hips, exactly like pressing 'a'/'j' mid-backswing on
//     keyboard. WHICH zone you hit never matters — WHEN you hit is the
//     entire skill, same as the keyboard timing windows.
//   Chip/putt (rhythm): TAP = 'w' taps (tempo), STROKE = 'i' (strike; the
//     chip's optional shaping tap lands on the same zone).
//
// Shown only on touch-capable devices (?touch=1 forces on, ?touch=0 off).

import {
    getCurrentShotType, getGameState, getSelectedClub,
    getHipInitiationTime, getRotationInitiationTime,
    getRotationStartTime, getArmsStartTime, getWristsStartTime,
} from './gameLogic/state.js';
import { isSlopeOverlayVisible } from './visuals/slopeOverlay.js';
import { isFreeCameraActive, toggleFreeCamera, freeCamNudge, freeCamLook, camera } from './visuals/core.js';

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
        /* Two thumb zones — that's all of it */
        #tc-swing  { left: 10px; bottom: var(--tc-bottom); width: min(42vw, 240px); height: min(30vh, 170px); font-size: 1.15em; }
        #tc-stroke { right: 10px; bottom: var(--tc-bottom); width: min(42vw, 240px); height: min(30vh, 170px); font-size: 1.15em; }
        /* Utility minis (camera, slopes): address phase, top-left (the bar
           is stripped there). Setup's camera story is the two-finger
           fly-over + pinch. */
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
        .tc-mini.tc-on { background: rgba(125, 255, 160, 0.35); border-color: #7dffa0; }
        #tc-cam { left: 8px; }
        #tc-slope { left: 60px; }
        /* Aim: vertical pills at mid-edge — where thumbs rest, and tapping
           the left edge aims left. Available in BOTH phases (aiming is a
           setup decision too); hold to keep turning. */
        .tc-aim {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            width: 46px;
            height: 96px;
            border-radius: 14px;
            border: 1.5px solid rgba(255, 255, 255, 0.35);
            background: rgba(14, 30, 20, 0.5);
            color: #eaf6ec;
            font-weight: 700;
            font-size: 1.15em;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
            -webkit-tap-highlight-color: transparent;
        }
        .tc-aim.pressed { background: rgba(125, 255, 160, 0.4); border-color: #7dffa0; }
        #tc-aim-left { left: 6px; }
        #tc-aim-right { right: 6px; }
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
        /* Phase gating inside the overlay (aim pills stay in both) */
        #touch-controls.setup .tc-zone,
        #touch-controls.setup .tc-mini,
        #touch-controls.setup #tc-exit { display: none; }
        #touch-controls:not(.setup) #tc-address { display: none; }
        .tc-action.tc-disabled {
            background: rgba(180, 200, 185, 0.55);
            color: rgba(14, 30, 20, 0.55);
            border-color: rgba(255, 255, 255, 0.3);
        }

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
        body.touch-active #reset-game-data-button,
        body.touch-active #fs-reset-data-btn { display: none; }
        /* Instructions live behind a compact ? — not a permanent banner.
           The Controls modal is a keyboard reference: meaningless on touch. */
        body.touch-active #fs-controls-btn { display: none; }
        body.touch-active #fs-help-btn-text { display: none; }
        body.touch-active #fs-help-btn::before { content: '?'; font-weight: 800; }
        body.touch-active #fs-help-btn { min-width: 36px; }
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
            max-width: 62vw; /* clears the mini buttons flanking it */
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
        /* Practice placement panel: right column below the shot info,
           clear of the mid-edge aim pill */
        body.touch-active #practice-panel {
            top: 164px;
            left: auto;
            right: 58px;
            max-height: calc(100vh - 330px);
            overflow-y: auto;
        }
        /* Keyboard shortcut hints are dead weight on touch */
        body.touch-active #practice-panel .practice-keys { display: none; }
        /* The panel IS the setup guidance when it's open — the rhythm hint
           would just sit on top of it */
        body.tc-panel-open:not(.tc-address) #rhythm-putt-hud { display: none !important; }
        /* Player/score line: small strip above the chip row */
        body.touch-active .overlay-bottom {
            position: fixed;
            left: 8px;
            right: 8px;
            bottom: calc(132px + env(safe-area-inset-bottom, 0px));
        }
        body.touch-active .overlay-bottom .overlay-text-item { font-size: 11px; }
        /* Rhythm hint: compact. In setup it docks under the status line
           (a subtitle, not a floating box over the scene); at address it
           sits by the zones where the guidance is acted on. */
        body.touch-active #rhythm-putt-hud {
            max-width: min(380px, 94vw);
            padding: 6px 12px;
            gap: 10px;
            font-size: 12px;
            top: calc(164px + env(safe-area-inset-top, 0px));
            bottom: auto;
        }
        body.tc-address #rhythm-putt-hud {
            top: auto;
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

function makeZone(id, html, onDown, onUp) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'tc-zone';
    el.innerHTML = html;
    bindZone(el, onDown, onUp);
    overlayEl.appendChild(el);
    return el;
}

/**
 * The next unfired beat of the full-swing kinematic chain. The event order
 * is fixed (hips → rotation → arms → wrists, per the physics' ideal
 * offsets), so a tap never needs to say WHICH body part — only WHEN.
 * While the backswing is still held, taps pre-load early rotation/hips.
 */
function nextBeatKey() {
    const state = getGameState();
    if (state === 'backswing') {
        if (!getRotationInitiationTime()) return 'a';
        if (!getHipInitiationTime()) return 'j';
        return null;
    }
    if (state === 'backswingPausedAtTop') {
        return getHipInitiationTime() ? null : 'j';
    }
    if (state === 'downswingWaiting') {
        if (!getRotationStartTime() && !getRotationInitiationTime()) return 'a';
        if (!getArmsStartTime()) return 'd';
        if (!getWristsStartTime()) return 'i';
    }
    return null;
}

/** Left zone: backswing hold + tempo taps; doubles as a beat surface. */
function onLeftDown() {
    if (getCurrentShotType() !== 'full') {
        sendKey('keydown', 'w'); // rhythm tempo tap
        return;
    }
    if (getGameState() === 'ready') {
        sendKey('keydown', 'w'); // start backswing (held)
        return;
    }
    const key = nextBeatKey();
    if (key) sendKey('keydown', key);
}

function onLeftUp() {
    // Only meaningful at the top of a held backswing; a no-op everywhere
    // else (the keyup handlers guard on state).
    sendKey('keyup', 'w');
}

/** Right zone: rhythm strike; for the full swing, a beat surface. */
function onRightDown() {
    if (getCurrentShotType() !== 'full') {
        sendKey('keydown', 'i'); // strike / chip shape
        return;
    }
    const key = nextBeatKey();
    if (key) sendKey('keydown', key);
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

/** Edge aim pill: fires immediately, then repeats while held. */
function makeAim(id, label, key) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'tc-aim';
    el.textContent = label;
    let repeatTimer = null;
    bindZone(el,
        () => {
            sendKey('keydown', key);
            clearInterval(repeatTimer);
            repeatTimer = setInterval(() => sendKey('keydown', key), 70);
        },
        () => clearInterval(repeatTimer));
    overlayEl.appendChild(el);
    return el;
}

/** Setup shows the decision UI; address shows only the shot surfaces. */
function setAddressMode(on) {
    addressMode = on;
    // Addressing the ball ends any fly-over inspection: back to the shot view
    if (on && isFreeCameraActive()) toggleFreeCamera();
    document.body.classList.toggle('tc-address', on);
    overlayEl.classList.toggle('setup', !on);
}

/**
 * Camera touch gestures on the canvas.
 *   One finger drag — rotate the view: synthesized mouse-drag (the same
 *     path desktop uses: horizontal = aim/rotate, vertical = height), or
 *     free-look while the fly-over camera is active.
 *   Two fingers (setup only) — fly-over: drag pans across the hole,
 *     pinch changes altitude. Terrain-clamped; addressing the ball
 *     restores the shot view.
 * iOS ignores user-scalable=no, so Safari's own pinch-zoom must be kept
 * off the canvas: touch-action none + suppressed gesture events.
 */
function initCameraGestures() {
    const canvas = document.getElementById('golf-canvas');
    if (!canvas) return;
    canvas.style.touchAction = 'none';
    // iOS proprietary pinch/rotate events would hijack two-finger input
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
        document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    }

    const inGame = () => overlayEl.classList.contains('visible');
    const inSetup = () => inGame() && overlayEl.classList.contains('setup');
    const synthMouse = (type, x, y) => canvas.dispatchEvent(new MouseEvent(type, {
        clientX: x, clientY: y, button: 0, bubbles: true,
    }));

    let twoFinger = false;
    let lastCx = 0, lastCy = 0, lastDist = 0;
    let oneFinger = null; // { x, y, dragging } — drag begins past a small threshold
    const measure = (e) => ({
        cx: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        cy: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        dist: Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY),
    });
    const endOneFinger = () => {
        if (oneFinger?.dragging) synthMouse('mouseup', oneFinger.x, oneFinger.y);
        oneFinger = null;
    };

    canvas.addEventListener('touchstart', (e) => {
        if (!inGame()) return;
        if (e.touches.length === 1) {
            const t = e.touches[0];
            oneFinger = { x: t.clientX, y: t.clientY, dragging: false };
            return; // no preventDefault: plain taps stay clickable
        }
        if (e.touches.length === 2 && inSetup()) {
            e.preventDefault();
            endOneFinger();
            twoFinger = true;
            ({ cx: lastCx, cy: lastCy, dist: lastDist } = measure(e));
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (twoFinger && e.touches.length === 2) {
            e.preventDefault();
            if (!inSetup()) return;
            if (!isFreeCameraActive()) toggleFreeCamera();
            const { cx, cy, dist } = measure(e);
            // Pan speed grows with altitude so the map-drag feel stays constant
            const perPx = Math.min(0.6, Math.max(0.03, (camera?.position.y || 10) * 0.004));
            freeCamNudge(
                -(cx - lastCx) * perPx,          // content follows the fingers
                -(cy - lastCy) * perPx,          // drag up = fly toward the green
                -(dist - lastDist) * 0.06);      // pinch out = descend for a closer look
            lastCx = cx; lastCy = cy; lastDist = dist;
            return;
        }
        if (oneFinger && e.touches.length === 1 && inGame()) {
            const t = e.touches[0];
            const dx = t.clientX - oneFinger.x;
            const dy = t.clientY - oneFinger.y;
            if (!oneFinger.dragging && Math.hypot(dx, dy) > 8) {
                oneFinger.dragging = true;
                if (!isFreeCameraActive()) synthMouse('mousedown', oneFinger.x, oneFinger.y);
            }
            if (oneFinger.dragging) {
                e.preventDefault();
                if (isFreeCameraActive()) {
                    // Fly-over free-look: the view follows the finger
                    freeCamLook(-dx * 0.004, -dy * 0.004);
                    oneFinger.x = t.clientX; oneFinger.y = t.clientY;
                } else {
                    // Desktop mouse-drag path: rotate aim / adjust height
                    synthMouse('mousemove', t.clientX, t.clientY);
                }
            }
        }
    }, { passive: false });

    const end = (e) => {
        if (!e.touches || e.touches.length < 2) twoFinger = false;
        if (!e.touches || e.touches.length === 0) endOneFinger();
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
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

    // With the placement panel open, the setup-phase rhythm hint is hidden
    // (CSS keys off this class) so the panel has the column to itself.
    const panel = document.getElementById('practice-panel');
    const panelOpen = !!panel && (panel.checkVisibility
        ? panel.checkVisibility()
        : panel.getClientRects().length > 0);
    document.body.classList.toggle('tc-panel-open', panelOpen);

    const state = getGameState();

    // The shot is over — bring the info panels back for the next decision
    if (addressMode && state === 'result') setAddressMode(false);

    // Bottom pill follows context: address the ball (once a club is
    // chosen), or advance after a shot
    const clubMissing = state === 'ready' && !getSelectedClub();
    els.address.classList.toggle('tc-disabled', clubMissing);
    els.address.textContent = state === 'result' ? 'NEXT  ᐅ'
        : clubMissing ? '👆 PICK A CLUB' : '⛳ ADDRESS BALL';

    if (els.slope) els.slope.classList.toggle('tc-on', isSlopeOverlayVisible());

    const full = getCurrentShotType() === 'full';
    if (full !== els.lastFull) {
        els.lastFull = full;
        els.swing.innerHTML = full
            ? 'SWING<span class="tc-hint">hold · release at top</span>'
            : 'TAP<span class="tc-hint">tap a tempo</span>';
        els.stroke.innerHTML = full
            ? 'BEAT<span class="tc-hint">drum the beats</span>'
            : 'STROKE<span class="tc-hint">on the beat</span>';
    }
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
        swing: makeZone('tc-swing', 'SWING<span class="tc-hint">hold · release at top</span>', onLeftDown, onLeftUp),
        stroke: makeZone('tc-stroke', 'BEAT<span class="tc-hint">drum the beats</span>', onRightDown, null),
        lastFull: null,
    };

    makeAim('tc-aim-left', '◀', 'ArrowLeft');
    makeAim('tc-aim-right', '▶', 'ArrowRight');
    makeMini('tc-cam', '📷', () => {
        cameraIdx = (cameraIdx + 1) % 4;
        sendKey('keydown', String(cameraIdx + 1));
    });
    els.slope = makeMini('tc-slope', '⛰', () => sendKey('keydown', 'g'));

    // Context pill: ADDRESS BALL when ready, NEXT after a shot resolves
    const addressBtn = document.createElement('div');
    addressBtn.id = 'tc-address';
    addressBtn.className = 'tc-action';
    addressBtn.textContent = '⛳ ADDRESS BALL';
    bindZone(addressBtn, () => {
        if (getGameState() === 'result') {
            sendKey('keydown', 'n');
        } else if (getGameState() === 'ready' && !getSelectedClub()) {
            // No club yet: the pill opens the club picker instead
            document.getElementById('fs-club-btn')?.click();
        } else {
            setAddressMode(true);
        }
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

    initCameraGestures();

    updateZones();
    updateTimer = setInterval(updateZones, 350);
    console.log('Touch controls active');
    return true;
}

export function isTouchControlsActive() {
    return !!overlayEl;
}
