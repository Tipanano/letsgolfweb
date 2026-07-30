// src/ui/rhythmPuttHud.js
//
// Compact HUD for the rhythm putting input: beat pulse, projected distance,
// tempo + steadiness readout, and stage hints. Owns its own DOM and styles.

import { getActiveDrill } from '../career/greenCard.js';

let hudEl = null;
let pulseEl = null;
let distanceEl = null;
let tempoEl = null;
let hintEl = null;
let stylesInjected = false;

function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        #rhythm-putt-hud {
            position: absolute;
            bottom: 26px;
            left: 50%;
            transform: translateX(-50%);
            display: none;
            align-items: center;
            gap: 14px;
            padding: 10px 18px;
            background: rgba(20, 30, 24, 0.82);
            border: 1px solid rgba(125, 255, 160, 0.25);
            border-radius: 12px;
            color: #eaf6ec;
            font-family: 'Segoe UI', system-ui, sans-serif;
            z-index: 1002;
            pointer-events: none;
            backdrop-filter: blur(3px);
        }
        #rhythm-putt-hud.visible { display: flex; }
        #rhythm-putt-pulse {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: #4a5c4f;
            flex: 0 0 auto;
            transition: background-color 0.25s ease;
        }
        #rhythm-putt-pulse.beat {
            animation: rhythmPuttBeat 0.3s ease-out;
            background: #7dffa0;
        }
        @keyframes rhythmPuttBeat {
            0%   { transform: scale(1.7); box-shadow: 0 0 12px rgba(125,255,160,0.9); }
            100% { transform: scale(1.0); box-shadow: 0 0 0 rgba(125,255,160,0); }
        }
        #rhythm-putt-distance {
            font-size: 24px;
            font-weight: 700;
            min-width: 88px;
            text-align: center;
            font-variant-numeric: tabular-nums;
        }
        #rhythm-putt-tempo {
            font-size: 12px;
            opacity: 0.85;
            min-width: 120px;
            font-variant-numeric: tabular-nums;
        }
        #rhythm-putt-hint {
            font-size: 13px;
            opacity: 0.95;
            max-width: 220px;
        }
        .rhythm-steady-good { color: #7dffa0; }
        .rhythm-steady-ok   { color: #ffd76a; }
        .rhythm-steady-bad  { color: #ff8a7a; }
        #rhythm-putt-hud.hint-mode #rhythm-putt-distance,
        #rhythm-putt-hud.hint-mode #rhythm-putt-tempo { display: none; }
        #rhythm-putt-hud .swing-report {
            display: block;
            font-size: 12px;
            line-height: 1.45;
            white-space: pre-line;
            margin-bottom: 6px;
            opacity: 0.92;
        }
        #rhythm-putt-hud.hint-mode #rhythm-putt-hint { font-size: 15px; }
        #rhythm-putt-hud kbd {
            display: inline-block;
            padding: 1px 8px;
            margin: 0 2px;
            border: 1px solid rgba(125, 255, 160, 0.45);
            border-radius: 5px;
            background: rgba(125, 255, 160, 0.12);
            color: #a9f0bc;
            font-family: inherit;
            font-weight: 700;
            font-size: 0.9em;
        }
        .rhythm-subkeys {
            display: block;
            margin-top: 3px;
            font-size: 11px;
            opacity: 0.55;
        }
        .rhythm-subkeys kbd {
            padding: 0 5px;
            border-color: rgba(255,255,255,0.25) !important;
            background: rgba(255,255,255,0.06) !important;
            color: inherit !important;
        }
    `;
    document.head.appendChild(style);
}

function ensureCreated() {
    if (hudEl) return;
    injectStyles();
    hudEl = document.createElement('div');
    hudEl.id = 'rhythm-putt-hud';
    hudEl.innerHTML = `
        <div id="rhythm-putt-pulse"></div>
        <div id="rhythm-putt-distance">–</div>
        <div id="rhythm-putt-tempo"></div>
        <div id="rhythm-putt-hint"></div>
    `;
    // Must live inside #game-view: in fullscreen mode it's a fixed overlay at
    // z-index 9999, so body-level siblings render behind the game.
    (document.getElementById('game-view') || document.body).appendChild(hudEl);
    pulseEl = hudEl.querySelector('#rhythm-putt-pulse');
    distanceEl = hudEl.querySelector('#rhythm-putt-distance');
    tempoEl = hudEl.querySelector('#rhythm-putt-tempo');
    hintEl = hudEl.querySelector('#rhythm-putt-hint');
}

function steadinessInfo(cv) {
    if (cv < 0.045) return { label: 'steady', cls: 'rhythm-steady-good' };
    if (cv < 0.10) return { label: 'okay', cls: 'rhythm-steady-ok' };
    return { label: 'shaky', cls: 'rhythm-steady-bad' };
}

/** Shows the HUD in its idle state (before/while tapping). */
export function showRhythmHud() {
    ensureCreated();
    hudEl.classList.add('visible');
}

/**
 * At-address prompt: tells the player the first move for the current shot
 * type ('full' | 'chip' | 'putt'), or 'next' after a shot, or to pick a club.
 * The pill switches back to the live tempo display once tapping starts.
 */
/** True when the on-screen touch zones are the input device. */
const isTouchInput = () => document.body.classList.contains('touch-active');

// Post-shot swing feedback (set by calculations for practice contexts);
// rendered with the next-shot hint, cleared implicitly by the next report.
let swingReport = null;
export function setSwingReport(text) {
    swingReport = text || null;
}

// --- Instruction hints: hidden by default, toggled from the top bar ---
// Green Card drills are the tutorial, so an active drill always shows them.
// Live readouts (beat dot, tempo, distance) and the post-shot swing report
// are information, not instructions — they stay regardless.
const HINTS_KEY = 'gih-swing-hints-shown';
let hintsShown = localStorage.getItem(HINTS_KEY) === '1';
let lastHint = null; // last showAddressHint call, replayed on toggle

export function swingHintsShown() {
    return hintsShown;
}

/** Flips the preference and re-renders the current hint. Returns new state. */
export function toggleSwingHints() {
    hintsShown = !hintsShown;
    try { localStorage.setItem(HINTS_KEY, hintsShown ? '1' : '0'); } catch (e) { /* private mode */ }
    if (lastHint) showAddressHint(lastHint.type, lastHint.opts);
    return hintsShown;
}

function hintsMuted() {
    let drillActive = false;
    try { drillActive = !!getActiveDrill(); } catch (e) { /* career stack unavailable */ }
    return !hintsShown && !drillActive;
}

/** Name of the strike input as the player sees it: a key, or a zone. */
export function strikeName() {
    return isTouchInput() ? 'STROKE' : 'i';
}

export function showAddressHint(type, { hasClub = true } = {}) {
    lastHint = { type, opts: { hasClub } };

    // Instructions are muted by default: skip the how-to text, but never
    // swallow the swing report ('next' after a practice shot) or the
    // pick-a-club prompt (state, not instructions).
    if (hintsMuted() && hasClub) {
        if (type !== 'next') { hideRhythmHud(); return; }
        if (!swingReport) { hideRhythmHud(); return; }
        ensureCreated();
        showRhythmHud();
        hudEl.classList.add('hint-mode');
        pulseEl.classList.remove('beat');
        distanceEl.textContent = '';
        tempoEl.textContent = '';
        hintEl.innerHTML = `<span class="swing-report">${swingReport}</span>`;
        return;
    }

    ensureCreated();
    showRhythmHud();
    hudEl.classList.add('hint-mode');
    pulseEl.classList.remove('beat');
    distanceEl.textContent = '';
    tempoEl.textContent = '';

    const touch = isTouchInput();
    let html;
    if (type === 'next') {
        html = touch ? '<kbd>NEXT</kbd> for your next shot' : '<kbd>N</kbd> next shot';
        if (swingReport) {
            html = `<span class="swing-report">${swingReport}</span>` + html;
        }
    } else if (!hasClub) {
        html = 'Pick a club to play your shot';
    } else if (type === 'putt') {
        html = touch
            ? 'Tap a rhythm on <kbd>TAP</kbd> — tempo sets distance'
            : 'Tap <kbd>W</kbd> to a rhythm — tempo sets distance';
    } else if (type === 'chip') {
        html = touch
            ? 'Tap a rhythm on <kbd>TAP</kbd> — tempo sets carry'
            : 'Tap <kbd>W</kbd> to a rhythm — tempo sets carry';
    } else {
        html = touch
            ? 'Hold <kbd>SWING</kbd> — release at top, then drum: hips → rotate → arms → wrists'
            : 'Hold <kbd>W</kbd> for backswing — release at the top';
    }

    if (type !== 'next' && hasClub) {
        if (touch) {
            html += '<span class="rhythm-subkeys"><kbd>◀</kbd><kbd>▶</kbd> aim</span>';
        } else {
            const extras = (type === 'putt' || type === 'chip') ? ' · <kbd>G</kbd> slopes' : '';
            html += `<span class="rhythm-subkeys"><kbd>←</kbd><kbd>→</kbd> aim · <kbd>H</kbd> aim at flag${extras}</span>`;
        }
    }
    hintEl.innerHTML = html;
}

export function hideRhythmHud() {
    if (hudEl) hudEl.classList.remove('visible');
}

/** Flashes the beat dot (call on every accepted tap). */
export function flashBeat() {
    ensureCreated();
    pulseEl.classList.remove('beat');
    // Force reflow so the animation restarts even on rapid taps
    void pulseEl.offsetWidth;
    pulseEl.classList.add('beat');
}

/**
 * Updates the HUD readouts from a rhythm snapshot
 * ({ tapCount, armed, tempoMs, cv, distanceMeters }).
 * hintOverride replaces the default armed hint (used by chipping phases).
 */
export function updateRhythmHud(snap, minTaps = 3, hintOverride = null) {
    ensureCreated();
    showRhythmHud();
    hudEl.classList.remove('hint-mode');

    if (!snap.tempoMs) {
        distanceEl.textContent = '–';
        tempoEl.textContent = '';
        hintEl.textContent = isTouchInput()
            ? `Tap a rhythm (${snap.tapCount}/${minTaps})`
            : `Tap w to a rhythm (${snap.tapCount}/${minTaps})`;
        return;
    }

    distanceEl.textContent = snap.distanceMeters != null ? `${snap.distanceMeters.toFixed(1)} m` : '–';

    const steadiness = steadinessInfo(snap.cv);
    tempoEl.innerHTML = `${Math.round(snap.tempoMs)} ms · <span class="${steadiness.cls}">${steadiness.label}</span>`;

    hintEl.textContent = snap.armed
        ? (hintOverride || `${strikeName()} on the beat to putt`)
        : `Keep tapping (${snap.tapCount}/${minTaps})`;
}
