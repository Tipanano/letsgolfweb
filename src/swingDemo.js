// src/swingDemo.js
//
// Full-swing rhythm demo for the Green Card driving/approach drills: a ghost
// finger plays the IDEAL swing on the real controls — hold, the early hips
// beat, release at the top, then rotate/arms/wrists — timed from the same
// physics constants the scoring uses, so what it shows is exactly what
// "timing pure" feels like. Optional soft audio ticks accompany each touch
// (a bonus: silently skipped when the context can't start).
//
// Touch: ghosts land on the live SWING/BEAT zones. Desktop: a key-pill row
// (W J A D I) stands in. Purely visual — no synthetic input is sent.

import {
    IDEAL_BACKSWING_DURATION_MS, IDEAL_TRANSITION_OFFSET_MS,
    IDEAL_ROTATION_OFFSET_MS, IDEAL_ARMS_OFFSET_MS, IDEAL_WRISTS_OFFSET_MS,
    getDownswingTimingStretch,
} from './swingPhysics.js';
import { getSwingSpeed, getGameState } from './gameLogic/state.js';

let overlayEl = null;
let playing = false;
let armed = false;
let stylesInjected = false;
let audioCtx = null;

function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        #swing-demo {
            position: fixed;
            inset: 0;
            z-index: 10006;
            pointer-events: none;
            font-family: 'Segoe UI', system-ui, sans-serif;
        }
        #swing-demo .sd-caption {
            position: absolute;
            top: calc(96px + env(safe-area-inset-top, 0px));
            left: 50%;
            transform: translateX(-50%);
            max-width: 86vw;
            padding: 10px 18px;
            border-radius: 12px;
            background: rgba(20, 30, 24, 0.9);
            border: 1px solid rgba(125, 255, 160, 0.4);
            color: #eaf6ec;
            font-size: 17px;
            font-weight: 600;
            text-align: center;
            white-space: nowrap;
            transition: opacity 0.15s ease;
        }
        #swing-demo .sd-caption .sd-sub {
            display: block;
            font-size: 12px;
            font-weight: 400;
            color: rgba(234, 246, 236, 0.65);
            white-space: normal;
        }
        #swing-demo .sd-ghost {
            position: absolute;
            width: 58px;
            height: 58px;
            margin: -29px 0 0 -29px;
            border-radius: 50%;
            border: 3px solid #7dffa0;
            background: rgba(125, 255, 160, 0.25);
            box-shadow: 0 0 22px rgba(125, 255, 160, 0.8);
            opacity: 0;
            transform: scale(1.25);
        }
        #swing-demo .sd-ghost.sd-down {
            opacity: 1;
            transform: scale(1);
            transition: opacity 0.1s ease, transform 0.1s ease;
        }
        #swing-demo .sd-ghost.sd-tap {
            animation: sdTap 0.32s ease-out;
        }
        @keyframes sdTap {
            0%   { opacity: 1; transform: scale(0.85); }
            55%  { opacity: 1; transform: scale(1.15); }
            100% { opacity: 0; transform: scale(1.4); }
        }
        #swing-demo .sd-label {
            position: absolute;
            transform: translate(-50%, -100%);
            margin-top: -38px;
            padding: 3px 10px;
            border-radius: 8px;
            background: rgba(20, 30, 24, 0.92);
            border: 1px solid rgba(125, 255, 160, 0.4);
            color: #a9f0bc;
            font-size: 13px;
            font-weight: 700;
            white-space: nowrap;
            opacity: 0;
        }
        #swing-demo .sd-label.sd-show { opacity: 1; transition: opacity 0.12s ease; }
        #swing-demo .sd-keys {
            position: absolute;
            bottom: 130px; /* clear of the rhythm hint pill */
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 14px;
        }
        #swing-demo .sd-key {
            min-width: 58px;
            padding: 14px 10px 10px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.25);
            background: rgba(20, 30, 24, 0.85);
            color: #eaf6ec;
            text-align: center;
            font-weight: 800;
            font-size: 20px;
        }
        #swing-demo .sd-key small {
            display: block;
            font-size: 10px;
            font-weight: 500;
            color: rgba(234, 246, 236, 0.6);
            margin-top: 3px;
        }
        #swing-demo .sd-end {
            position: absolute;
            bottom: calc(150px + env(safe-area-inset-bottom, 0px));
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 10px;
            pointer-events: auto;
        }
        #swing-demo .sd-end button {
            padding: 11px 20px;
            border-radius: 10px;
            border: 1px solid rgba(125, 255, 160, 0.5);
            background: rgba(125, 255, 160, 0.15);
            color: #eaf6ec;
            font-weight: 700;
            font-size: 15px;
            font-family: inherit;
            cursor: pointer;
        }
    `;
    document.head.appendChild(style);
}

// --- Soft synth ticks (bonus; every call is allowed to fail silently) ---
function tick(freq = 880, dur = 0.05, gain = 0.12) {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        if (audioCtx.state !== 'running') return;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.frequency.value = freq;
        g.gain.setValueAtTime(gain, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
        osc.connect(g).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + dur);
    } catch (e) { /* no sound is fine */ }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function el(cls, parent) {
    const d = document.createElement('div');
    d.className = cls;
    (parent || overlayEl).appendChild(d);
    return d;
}

function centerOf(id) {
    const n = document.getElementById(id);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function cleanup() {
    overlayEl?.remove();
    overlayEl = null;
    playing = false;
}

/**
 * Plays the ghost demo once. Touch mode lands on the live zones; anywhere
 * else a key-pill row stands in. Aborts quietly if the player starts their
 * own swing (state leaves 'ready').
 */
export async function playSwingDemo() {
    if (playing) return;
    playing = true;
    injectStyles();
    overlayEl?.remove();
    overlayEl = document.createElement('div');
    overlayEl.id = 'swing-demo';
    document.body.appendChild(overlayEl);

    const touch = document.body.classList.contains('touch-active');
    let targets; // { hold, beatA, beatB } screen points
    if (touch) {
        const swing = centerOf('tc-swing');
        const stroke = centerOf('tc-stroke');
        if (!swing || !stroke) { cleanup(); return; }
        targets = { hold: swing, hips: stroke, rotate: swing, arms: stroke, wrists: swing };
    } else {
        // Desktop: key pills in swing order
        const row = el('sd-keys');
        for (const [k, label] of [['W', 'hold'], ['J', 'hips'], ['A', 'rotate'], ['D', 'arms'], ['I', 'wrists']]) {
            const p = el('sd-key', row);
            p.id = 'sd-key-' + k;
            p.innerHTML = `${k}<small>${label}</small>`;
        }
        await sleep(30); // layout
        targets = {
            hold: centerOf('sd-key-W'), hips: centerOf('sd-key-J'),
            rotate: centerOf('sd-key-A'), arms: centerOf('sd-key-D'), wrists: centerOf('sd-key-I'),
        };
    }

    const caption = el('sd-caption');
    const setCaption = (main, sub = '') => {
        caption.innerHTML = main + (sub ? `<span class="sd-sub">${sub}</span>` : '');
    };

    const ghostAt = (pt, label, hold = false) => {
        const g = el('sd-ghost');
        g.style.left = pt.x + 'px';
        g.style.top = pt.y + 'px';
        let lab = null;
        if (label) {
            lab = el('sd-label');
            lab.style.left = pt.x + 'px';
            lab.style.top = pt.y + 'px';
            lab.textContent = label;
            lab.classList.add('sd-show');
        }
        if (hold) g.classList.add('sd-down');
        else { g.classList.add('sd-tap'); setTimeout(() => { g.remove(); lab?.remove(); }, 900); }
        return { g, lab };
    };

    // The exact rhythm the physics scores as pure, at the player's current
    // swing speed and input-device stretch
    const speed = getSwingSpeed() || 0.9;
    const stretch = getDownswingTimingStretch();
    const back = IDEAL_BACKSWING_DURATION_MS / speed;
    const hipsAt = back + (IDEAL_TRANSITION_OFFSET_MS * stretch) / speed; // before the top
    const rotAt = back + (IDEAL_ROTATION_OFFSET_MS * stretch) / speed;
    const armAt = back + (IDEAL_ARMS_OFFSET_MS * stretch) / speed;
    const wriAt = back + (IDEAL_WRISTS_OFFSET_MS * stretch) / speed;

    const aborted = () => !overlayEl || (getGameState() !== 'ready');

    setCaption('🎬 Watch the rhythm', 'the ghost plays a perfect swing');
    await sleep(1400);
    if (aborted()) { cleanup(); return; }

    const t0 = performance.now();
    const until = async (ms) => { const d = t0 + ms - performance.now(); if (d > 0) await sleep(d); };

    // Hold the backswing
    setCaption(touch ? 'Hold <b>SWING</b>…' : 'Hold <b>W</b>…', 'let the club swing back');
    const hold = ghostAt(targets.hold, touch ? 'hold…' : 'W — hold…', true);
    tick(220, 0.08, 0.16);

    // Hips fire just BEFORE the top — while still holding
    await until(hipsAt);
    if (aborted()) { cleanup(); return; }
    setCaption('1 · hips', 'tap while still holding!');
    ghostAt(targets.hips, 'hips');
    tick(660);

    // Release at the top
    await until(back);
    if (aborted()) { cleanup(); return; }
    setCaption('Release at the top');
    hold.g.classList.remove('sd-down');
    hold.g.classList.add('sd-tap');
    setTimeout(() => { hold.g.remove(); hold.lab?.remove(); }, 900);
    tick(330, 0.07, 0.14);

    // Drum the downswing
    await until(rotAt);
    if (aborted()) { cleanup(); return; }
    setCaption('2 · rotate');
    ghostAt(targets.rotate, 'rotate');
    tick(740);

    await until(armAt);
    if (aborted()) { cleanup(); return; }
    setCaption('3 · arms');
    ghostAt(targets.arms, 'arms');
    tick(830);

    await until(wriAt);
    if (aborted()) { cleanup(); return; }
    setCaption('4 · wrists — strike! 💥', 'quick: 2-3-4 come fast after the top');
    ghostAt(targets.wrists, 'wrists');
    tick(990, 0.09, 0.18);

    await sleep(1300);
    if (aborted()) { cleanup(); return; }

    // End card: replay or go
    setCaption('Your turn', 'feel the tempo — slow back, quick drum down');
    const end = el('sd-end');
    const replay = document.createElement('button');
    replay.id = 'sd-replay';
    replay.textContent = '▶ Watch again';
    const done = document.createElement('button');
    done.id = 'sd-done';
    done.textContent = 'Got it';
    end.appendChild(replay);
    end.appendChild(done);
    replay.addEventListener('click', () => { cleanup(); playSwingDemo(); });
    done.addEventListener('click', cleanup);
    // The end card retires by itself if left alone (never blocks play —
    // the overlay ignores pointer events everywhere except these buttons)
    const mine = overlayEl;
    setTimeout(() => { if (overlayEl === mine) cleanup(); }, 12000);
    playing = false;
}

/** Arms the demo to play at the next opportune moment (drill launch). */
export function armSwingDemo() {
    armed = true;
}

/** Plays the armed demo (called when the address phase is entered). */
export function maybePlayArmedDemo(delayMs = 700) {
    if (!armed) return;
    armed = false;
    setTimeout(() => { if (getGameState() === 'ready') playSwingDemo(); }, delayMs);
}
