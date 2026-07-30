// src/greenCardModal.js
//
// Green Card modal: the drill checklist that doubles as the game's tutorial
// and the career on-ramp. Shows per-drill progress and launches drills;
// progress and definitions live in career/greenCard.js.

import { DRILLS, getProgress } from './career/greenCard.js';

let modalEl = null;
let stylesInjected = false;
let onStartDrill = null;

function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        #greencard-modal {
            position: fixed;
            inset: 0;
            z-index: 10001;
            display: none;
            justify-content: center;
            align-items: center;
            background: rgba(8, 16, 11, 0.75);
        }
        #greencard-modal.visible { display: flex; }
        .gc-modal-box {
            width: min(620px, 92vw);
            max-height: 82vh;
            overflow-y: auto;
            padding: 26px 28px;
            border-radius: 16px;
            background: linear-gradient(to bottom, #16301f, #12281a);
            border: 1px solid rgba(125, 255, 160, 0.25);
            color: #eaf6ec;
            font-family: 'Open Sans', system-ui, sans-serif;
        }
        .gc-modal-box h2 { margin: 0 0 4px; border: none; color: #fff; font-size: 1.5em; }
        .gc-sub { margin: 0 0 18px; color: rgba(234, 246, 236, 0.6); font-size: 0.9em; }
        .gc-earned {
            padding: 14px 16px;
            margin-bottom: 16px;
            border-radius: 12px;
            border: 1px solid rgba(255, 215, 106, 0.5);
            background: rgba(255, 215, 106, 0.1);
            color: #ffd76a;
            font-weight: 700;
            text-align: center;
        }
        .gc-drill {
            display: flex;
            align-items: center;
            gap: 14px;
            width: 100%;
            text-align: left;
            padding: 13px 16px;
            margin-bottom: 9px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.14);
            background: rgba(255, 255, 255, 0.05);
            color: #eaf6ec;
            cursor: pointer;
            font-family: inherit;
            font-size: 1em;
            transition: background 0.15s ease, border-color 0.15s ease;
        }
        .gc-drill:hover { background: rgba(125, 255, 160, 0.12); border-color: rgba(125, 255, 160, 0.5); }
        .gc-drill.done { border-color: rgba(125, 255, 160, 0.45); }
        .gc-icon { font-size: 1.5em; }
        .gc-body { flex: 1; min-width: 0; }
        .gc-title { font-weight: 700; }
        .gc-title .gc-check { color: #7dffa0; }
        .gc-desc { font-size: 0.82em; color: rgba(234, 246, 236, 0.6); }
        .gc-progress {
            margin-top: 6px;
            height: 6px;
            border-radius: 3px;
            background: rgba(255, 255, 255, 0.12);
            overflow: hidden;
        }
        .gc-progress > div { height: 100%; background: #7dffa0; border-radius: 3px; }
        .gc-count { font-size: 0.85em; color: rgba(234, 246, 236, 0.7); white-space: nowrap; }
        .gc-modal-close {
            width: 100%;
            margin-top: 8px;
            padding: 11px;
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 8px;
            background: rgba(255,255,255,0.07);
            color: #eaf6ec;
            font-weight: 600;
            cursor: pointer;
        }
    `;
    document.head.appendChild(style);
}

function ensureCreated() {
    if (modalEl) return;
    injectStyles();
    modalEl = document.createElement('div');
    modalEl.id = 'greencard-modal';
    modalEl.innerHTML = `
        <div class="gc-modal-box">
            <h2>🎓 Green Card</h2>
            <p class="gc-sub" id="gc-sub-text"></p>
            <div id="gc-list"></div>
            <button class="gc-modal-close">Close</button>
        </div>
    `;
    document.body.appendChild(modalEl);
    modalEl.querySelector('.gc-modal-close').addEventListener('click', hideGreenCard);
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) hideGreenCard(); });
}

function render() {
    const touch = document.body.classList.contains('touch-active');
    modalEl.querySelector('#gc-sub-text').textContent =
        'Prove every part of your game, drill by drill — your ticket onto the course. ' +
        `Pick a drill; each shot is one attempt, ${touch ? 'tap NEXT' : 'press (n)'} between balls.`;
    const list = modalEl.querySelector('#gc-list');
    const progress = getProgress();
    list.innerHTML = progress.complete
        ? '<div class="gc-earned">🎉 Green Card earned — the course is yours. Drills stay open for a tune-up.</div>'
        : '';

    for (const drill of DRILLS) {
        const count = Math.min(progress.counts[drill.id] || 0, drill.target);
        const done = count >= drill.target;
        const row = document.createElement('button');
        row.className = 'gc-drill' + (done ? ' done' : '');
        row.innerHTML = `
            <span class="gc-icon">${drill.icon}</span>
            <span class="gc-body">
                <div class="gc-title">${drill.title} ${done ? '<span class="gc-check">✓</span>' : ''}</div>
                <div class="gc-desc">${drill.desc}</div>
                <div class="gc-progress"><div style="width:${(count / drill.target) * 100}%"></div></div>
            </span>
            <span class="gc-count">${count}/${drill.target}</span>
        `;
        row.addEventListener('click', () => {
            hideGreenCard();
            if (onStartDrill) onStartDrill(drill.id);
        });
        list.appendChild(row);
    }
}

export function showGreenCard(startDrillCallback) {
    ensureCreated();
    onStartDrill = startDrillCallback;
    render();
    modalEl.classList.add('visible');
}

export function hideGreenCard() {
    if (modalEl) modalEl.classList.remove('visible');
}
