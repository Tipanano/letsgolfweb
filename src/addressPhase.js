// The desktop Setup → Address flow, mirroring touch.
//
// Touch has had two phases for a while: Setup (pick a club, aim, fly the
// camera, read the panels) and Address (everything non-shot stripped away,
// the swing zones live, the practice toggle at hand), joined by an ADDRESS
// BALL pill. Desktop had neither the pill nor the phases — every control was
// on screen all the time, and 'w' started a backswing from anywhere. This
// module gives the keyboard build the same shape:
//
//   Enter, clicking the pill, or a first press of 'w'  →  address
//   Esc, or the shot resolving                          →  back to setup
//
// The first-'w' entry matters for parity: on touch you physically cannot
// swing from Setup, because the SWING zone only exists at address. On desktop
// the same key that would have swung now addresses first, so the flow is the
// same without stealing anyone's muscle memory — the second hold swings.
//
// Dormant whenever the touch controls own the screen: touch has its own
// address state and its own pill, and two owners of one concept is how modes
// drift apart in the first place.

import { getGameState } from './gameLogic/state.js';
import { getSelectedClub } from './gameLogic/state.js';
import { isFreeCameraActive, toggleFreeCamera } from './visuals/core.js';

let addressed = false;
let pillEl = null;
let exitEl = null;
let tickTimer = null;
let stylesInjected = false;

const touchOwnsScreen = () => document.body.classList.contains('touch-active');
const inPlayHole = () => document.body.classList.contains('mode-play-hole');

function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        #kb-address-pill {
            position: absolute;
            bottom: 22px;
            left: 50%;
            transform: translateX(-50%);
            display: none;
            padding: 12px 30px;
            border-radius: 14px;
            background: rgba(125, 255, 160, 0.92);
            border: 2px solid rgba(255, 255, 255, 0.5);
            color: #0e1e14;
            font-family: 'Segoe UI', system-ui, sans-serif;
            font-size: 1.0rem;
            font-weight: 800;
            letter-spacing: 0.04em;
            cursor: pointer;
            z-index: 1002;
            user-select: none;
            -webkit-user-select: none;
        }
        #kb-address-pill.visible { display: block; }
        #kb-address-pill.kb-disabled {
            background: rgba(180, 200, 185, 0.55);
            color: rgba(14, 30, 20, 0.55);
            border-color: rgba(255, 255, 255, 0.3);
            cursor: default;
        }
        #kb-address-pill kbd {
            font: inherit;
            font-size: 0.78em;
            opacity: 0.65;
            margin-left: 8px;
        }
        #kb-address-exit {
            position: absolute;
            /* Top-LEFT: address hides the hole/score panel that lives there,
               so the slot is free. Top-right is the distance/wind/lie panel,
               which stays up at address and was being covered. */
            top: 74px;
            left: 10px;
            display: none;
            padding: 8px 16px;
            border-radius: 10px;
            background: rgba(14, 30, 20, 0.6);
            border: 1.5px solid rgba(255, 255, 255, 0.35);
            color: #eaf6ec;
            font-family: 'Segoe UI', system-ui, sans-serif;
            font-size: 0.8rem;
            font-weight: 700;
            cursor: pointer;
            z-index: 1002;
            user-select: none;
        }
        body.kb-address #kb-address-exit { display: block; }

        /* While the ADDRESS/NEXT pill is up at the bottom, the swing-report
           HUD pill must sit above it — both used to anchor ~24px from the
           bottom and the report covered NEXT after every shot. */
        body.kb-pill #rhythm-putt-hud { bottom: 96px; }

        /* Address strips the setup chrome, exactly the set touch strips.
           The distance/wind/lie panel stays — you read it over the shot. */
        body.kb-address #fullscreen-controls,
        body.kb-address #fullscreen-top-bar,
        body.kb-address #practice-panel,
        body.kb-address #back-to-menu-button,
        body.kb-address #switch-hole-button,
        body.kb-address #reset-game-data-button,
        body.kb-address #fullscreen-toggle-btn,
        body.kb-address #multiplayer-scoreboard,
        body.kb-address .overlay-top-left,
        body.kb-address .overlay-bottom { display: none !important; }

        /* The practice toggle belongs to the address moment on desktop too —
           in Setup it would float over the controls it is unrelated to. Range
           and the other modes keep it always, since they have no phases. */
        body.mode-play-hole:not(.kb-address):not(.touch-active) #practice-swing-toggle {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
}

function ensureDom() {
    if (pillEl) return;
    injectStyles();
    const host = document.getElementById('game-view') || document.body;
    pillEl = document.createElement('div');
    pillEl.id = 'kb-address-pill';
    pillEl.addEventListener('click', () => {
        const s = getGameState();
        if (s === 'result') {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
        } else if (s === 'ready' && getSelectedClub()) {
            enterAddress();
        }
    });
    host.appendChild(pillEl);

    exitEl = document.createElement('div');
    exitEl.id = 'kb-address-exit';
    exitEl.textContent = '⚙ Setup (Esc)';
    exitEl.addEventListener('click', exitAddress);
    host.appendChild(exitEl);
}

export function isAddressed() {
    return addressed;
}

export function enterAddress() {
    if (addressed || touchOwnsScreen() || !inPlayHole()) return;
    addressed = true;
    // Addressing the ball ends any fly-over inspection — same as touch.
    if (isFreeCameraActive()) toggleFreeCamera();
    document.body.classList.add('kb-address');
    refresh();
}

export function exitAddress() {
    if (!addressed) return;
    addressed = false;
    document.body.classList.remove('kb-address');
    refresh();
}

/**
 * Keyboard entry points, called from the input handler BEFORE the swing
 * dispatch. Returns true when the key was consumed by the phase logic.
 */
export function handlePhaseKey(event) {
    if (touchOwnsScreen() || !inPlayHole()) return false;
    const s = getGameState();
    if (event.key === 'Enter' && !addressed && s === 'ready' && getSelectedClub()) {
        enterAddress();
        return true;
    }
    if (event.key === 'Escape' && addressed && s === 'ready') {
        exitAddress();
        return true;
    }
    // A first 'w' addresses instead of swinging — on touch you cannot swing
    // from Setup at all, and this is the keyboard's version of that. The
    // second hold swings; the keyup that follows this press lands in a
    // non-backswing state and no-ops.
    if ((event.key === 'w' || event.key === 'W') && !event.repeat &&
        !addressed && s === 'ready' && getSelectedClub()) {
        enterAddress();
        return true;
    }
    return false;
}

function refresh() {
    if (!pillEl) return;
    const s = getGameState();
    // The shot is over — bring the setup chrome back for the next decision,
    // mirroring touch's result handling.
    if (addressed && s === 'result') exitAddress();

    const show = !touchOwnsScreen() && inPlayHole() && !addressed &&
        (s === 'ready' || s === 'result');
    pillEl.classList.toggle('visible', show);
    document.body.classList.toggle('kb-pill', show);
    if (!show) return;
    const clubMissing = s === 'ready' && !getSelectedClub();
    pillEl.classList.toggle('kb-disabled', clubMissing);
    pillEl.innerHTML = s === 'result' ? 'NEXT  ᐅ<kbd>N</kbd>'
        : clubMissing ? '👆 PICK A CLUB'
        : '⛳ ADDRESS BALL<kbd>Enter</kbd>';
}

/** Starts the phase watcher. Safe to call once at boot; dormant under touch. */
export function initAddressPhase() {
    ensureDom();
    if (tickTimer) return;
    tickTimer = setInterval(refresh, 300);
}
