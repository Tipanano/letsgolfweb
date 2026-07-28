// src/ui/rhythmPuttHud.js
//
// Compact HUD for the rhythm putting input: beat pulse, projected distance,
// tempo + steadiness readout, and stage hints. Owns its own DOM and styles.

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
            bottom: 96px;
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

    if (!snap.tempoMs) {
        distanceEl.textContent = '–';
        tempoEl.textContent = '';
        hintEl.textContent = `Tap w to a rhythm (${snap.tapCount}/${minTaps})`;
        return;
    }

    distanceEl.textContent = snap.distanceMeters != null ? `${snap.distanceMeters.toFixed(1)} m` : '–';

    const steadiness = steadinessInfo(snap.cv);
    tempoEl.innerHTML = `${Math.round(snap.tempoMs)} ms · <span class="${steadiness.cls}">${steadiness.label}</span>`;

    hintEl.textContent = snap.armed
        ? (hintOverride || 'Press i on the beat to putt')
        : `Keep tapping (${snap.tapCount}/${minTaps})`;
}
