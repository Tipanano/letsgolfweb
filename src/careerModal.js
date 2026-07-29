// src/careerModal.js
//
// Career overview modal: handicap index with trend sparkline, scoring stats,
// course bests, and round history with expandable scorecards. Reads the
// local-first career record (career/careerStore.js) so it works for guests
// and registered users alike.

import { getCareer } from './career/careerStore.js';
import { differentialsFromRounds, handicapIndex, indexSeriesFromRounds } from './career/handicap.js';

let modalEl = null;
let stylesInjected = false;

function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        #career-modal {
            position: fixed;
            inset: 0;
            z-index: 10001;
            display: none;
            justify-content: center;
            align-items: center;
            background: rgba(8, 16, 11, 0.75);
        }
        #career-modal.visible { display: flex; }
        .career-modal-box {
            width: min(680px, 92vw);
            max-height: 82vh;
            overflow-y: auto;
            padding: 26px 28px;
            border-radius: 16px;
            background: linear-gradient(to bottom, #16301f, #12281a);
            border: 1px solid rgba(125, 255, 160, 0.25);
            color: #eaf6ec;
            font-family: 'Open Sans', system-ui, sans-serif;
        }
        .career-modal-box h2 { margin: 0 0 4px; border: none; color: #fff; font-size: 1.5em; }
        .career-sub { margin: 0 0 18px; color: rgba(234, 246, 236, 0.6); font-size: 0.9em; }
        .career-hero {
            display: flex;
            align-items: center;
            gap: 22px;
            padding: 16px 18px;
            margin-bottom: 14px;
            border-radius: 12px;
            border: 1px solid rgba(125, 255, 160, 0.3);
            background: rgba(125, 255, 160, 0.07);
        }
        .career-hcp-num { font-size: 2.6em; font-weight: 800; color: #7dffa0; line-height: 1; }
        .career-hcp-label { font-size: 0.78em; color: rgba(234, 246, 236, 0.65); margin-top: 4px; }
        .career-spark { flex: 1; min-width: 0; }
        .career-spark svg { width: 100%; height: 52px; display: block; }
        .career-spark-caption { font-size: 0.7em; color: rgba(234, 246, 236, 0.5); text-align: right; }
        .career-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
            gap: 10px;
            margin-bottom: 14px;
        }
        .career-stat {
            padding: 10px 12px;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            background: rgba(255, 255, 255, 0.04);
        }
        .career-stat .cs-num { font-size: 1.3em; font-weight: 700; }
        .career-stat .cs-label { font-size: 0.72em; color: rgba(234, 246, 236, 0.6); }
        .career-section-title {
            margin: 16px 0 8px;
            font-size: 0.85em;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: rgba(234, 246, 236, 0.55);
        }
        .career-best-row, .career-round-row {
            display: flex;
            justify-content: space-between;
            gap: 10px;
            padding: 9px 12px;
            border-radius: 9px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.04);
            margin-bottom: 7px;
            font-size: 0.92em;
        }
        .career-round-row { cursor: pointer; width: 100%; text-align: left; color: inherit; font-family: inherit; transition: background 0.15s ease; }
        .career-round-row:hover { background: rgba(125, 255, 160, 0.1); }
        .career-round-meta { color: rgba(234, 246, 236, 0.55); font-size: 0.85em; }
        .career-under { color: #ffd76a; font-weight: 700; }
        .career-over { color: #ff9d8a; }
        .career-scorecard {
            display: none;
            margin: -2px 0 8px;
            padding: 10px 12px;
            border-radius: 9px;
            background: rgba(0, 0, 0, 0.25);
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .career-scorecard.open { display: block; }
        .career-scorecard pre {
            margin: 0;
            font-family: 'Courier New', monospace;
            font-size: 0.82em;
            line-height: 1.5;
            overflow-x: auto;
        }
        .career-scorecard .sc-meta { margin-top: 6px; font-size: 0.75em; color: rgba(234, 246, 236, 0.55); }
        .career-empty { padding: 26px 10px; text-align: center; color: rgba(234, 246, 236, 0.65); }
        .career-modal-close {
            width: 100%;
            margin-top: 10px;
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
    modalEl.id = 'career-modal';
    modalEl.innerHTML = `
        <div class="career-modal-box">
            <h2>Career</h2>
            <p class="career-sub">Every completed round posts here and moves your handicap</p>
            <div id="career-content"></div>
            <button class="career-modal-close">Close</button>
        </div>
    `;
    document.body.appendChild(modalEl);
    modalEl.querySelector('.career-modal-close').addEventListener('click', hideCareer);
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) hideCareer(); });
}

const fmtRel = (rel) => rel === 0 ? 'E' : rel > 0 ? `+${rel}` : `${rel}`;
const relClass = (rel) => rel < 0 ? 'career-under' : rel > 0 ? 'career-over' : '';
const fmtDate = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Downward-sloping line = improving handicap. */
function sparklineSVG(series) {
    const pts = series.filter(v => v !== null);
    if (pts.length < 2) return '';
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = Math.max(0.5, max - min);
    const W = 260, H = 52, P = 6;
    const x = (i) => P + i * (W - 2 * P) / (pts.length - 1);
    const y = (v) => H - P - (v - min) / span * (H - 2 * P);
    const path = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    return `
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Handicap trend">
            <path d="${path}" fill="none" stroke="#7dffa0" stroke-width="2" stroke-linejoin="round"/>
            <circle cx="${x(pts.length - 1)}" cy="${y(last)}" r="3" fill="#7dffa0"/>
        </svg>
        <div class="career-spark-caption">${pts[0].toFixed(1)} → ${last.toFixed(1)} over ${pts.length} rounds</div>
    `;
}

/** Monospace scorecard block for one recorded round. */
function scorecardHTML(round) {
    const pad = (v) => String(v).padStart(3, ' ');
    const nineLines = (holes, label) => {
        if (!holes.length) return '';
        const nums = holes.map(h => pad(h.hole)).join('');
        const pars = holes.map(h => pad(h.par)).join('');
        const strokes = holes.map(h => {
            const cls = relClass(h.strokes - h.par);
            const s = pad(h.strokes);
            return cls ? `<span class="${cls}">${s}</span>` : s;
        }).join('');
        const parSum = holes.reduce((s, h) => s + h.par, 0);
        const strokeSum = holes.reduce((s, h) => s + h.strokes, 0);
        return `Hole ${nums} | ${label}\nPar  ${pars} | ${pad(parSum)}\nScore${strokes} | ${pad(strokeSum)}\n`;
    };
    const front = nineLines(round.holes.slice(0, 9), 'Out');
    const back = round.holes.length > 9 ? '\n' + nineLines(round.holes.slice(9), 'In') : '';
    return `
        <pre>${front}${back}</pre>
        <div class="sc-meta">Rating ${round.rating} / Slope ${round.slope} · Differential ${round.differential.toFixed(1)}</div>
    `;
}

function render() {
    const content = modalEl.querySelector('#career-content');
    const rounds = getCareer().rounds;

    if (!rounds.length) {
        content.innerHTML = `
            <div class="career-empty">
                No rounds posted yet.<br><br>
                Finish a full round in <strong>Play Course</strong> and it lands here —
                your first round earns a provisional handicap.
            </div>
        `;
        return;
    }

    const diffs = differentialsFromRounds(rounds);
    const index = handicapIndex(diffs);
    const provisional = diffs.length < 5;

    // Scoring stats across every recorded hole
    const dist = { eagle: 0, birdie: 0, par: 0, bogey: 0, worse: 0 };
    for (const r of rounds) {
        for (const h of r.holes) {
            const d = h.strokes - h.par;
            if (d <= -2) dist.eagle++;
            else if (d === -1) dist.birdie++;
            else if (d === 0) dist.par++;
            else if (d === 1) dist.bogey++;
            else dist.worse++;
        }
    }
    const bestRel = Math.min(...rounds.map(r => r.total - r.par));
    const full = rounds.filter(r => r.holeCount === 18);
    const avg = full.length ? (full.reduce((s, r) => s + r.total, 0) / full.length).toFixed(1) : '—';

    // Best score per course
    const bests = new Map();
    for (const r of rounds) {
        const rel = r.total - r.par;
        const prev = bests.get(r.courseName);
        if (!prev || rel < prev.rel) bests.set(r.courseName, { rel, total: r.total, holeCount: r.holeCount });
    }

    content.innerHTML = `
        <div class="career-hero">
            <div>
                <div class="career-hcp-num">${index === null ? '—' : index.toFixed(1)}</div>
                <div class="career-hcp-label">Handicap index${provisional ? ' · provisional' : ''}</div>
            </div>
            <div class="career-spark">${sparklineSVG(indexSeriesFromRounds(rounds))}</div>
        </div>
        <div class="career-stats">
            <div class="career-stat"><div class="cs-num">${rounds.length}</div><div class="cs-label">Rounds</div></div>
            <div class="career-stat"><div class="cs-num ${relClass(bestRel)}">${fmtRel(bestRel)}</div><div class="cs-label">Best round</div></div>
            <div class="career-stat"><div class="cs-num">${avg}</div><div class="cs-label">Avg score (18)</div></div>
            <div class="career-stat"><div class="cs-num">${dist.eagle + dist.birdie}</div><div class="cs-label">Birdies or better</div></div>
            <div class="career-stat"><div class="cs-num">${dist.par}</div><div class="cs-label">Pars</div></div>
            <div class="career-stat"><div class="cs-num">${dist.bogey + dist.worse}</div><div class="cs-label">Bogeys or worse</div></div>
        </div>
        <div class="career-section-title">Course bests</div>
        ${[...bests.entries()].map(([name, b]) => `
            <div class="career-best-row">
                <span>${name}</span>
                <span class="${relClass(b.rel)}">${b.total} (${fmtRel(b.rel)})${b.holeCount !== 18 ? ` · ${b.holeCount} holes` : ''}</span>
            </div>
        `).join('')}
        <div class="career-section-title">Round history</div>
        <div id="career-history"></div>
    `;

    const history = content.querySelector('#career-history');
    [...rounds].reverse().forEach((r) => {
        const rel = r.total - r.par;
        const row = document.createElement('button');
        row.className = 'career-round-row';
        row.innerHTML = `
            <span>${r.courseName} <span class="career-round-meta">${fmtDate(r.date)}</span></span>
            <span><span class="${relClass(rel)}">${r.total} (${fmtRel(rel)})</span>
                <span class="career-round-meta"> · diff ${r.differential.toFixed(1)}</span></span>
        `;
        const card = document.createElement('div');
        card.className = 'career-scorecard';
        card.innerHTML = scorecardHTML(r);
        row.addEventListener('click', () => card.classList.toggle('open'));
        history.appendChild(row);
        history.appendChild(card);
    });
}

export function showCareer() {
    ensureCreated();
    render();
    modalEl.classList.add('visible');
}

export function hideCareer() {
    if (modalEl) modalEl.classList.remove('visible');
}
