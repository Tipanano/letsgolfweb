// The practice-swing result card.
//
// This used the generic modal.alert first, which was the wrong borrow: that
// component is built for warnings and confirmations, so a rehearsal arrived as
// a full-width white sheet under a bright blue header with an ℹ icon the size
// of a thumb. Next to a HUD made of dark translucent pills it read as an error
// dialog, and it covered the readouts it was meant to sit beside.
//
// This is the same material as the rest of the HUD, sized to its content, and
// it does not block the game: no scrim, no modal trap. It clears itself when
// the next swing starts, so it can never be in the way of the shot.

let cardEl = null;
let stylesInjected = false;

function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        #practice-swing-card {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0.96);
            width: min(300px, 82vw);
            box-sizing: border-box;
            padding: 12px 14px 10px;
            background: rgba(18, 27, 21, 0.93);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(125, 255, 160, 0.28);
            border-radius: 14px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
            color: #eaf6ec;
            font-family: 'Segoe UI', system-ui, sans-serif;
            z-index: 1600;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.14s ease, transform 0.14s ease;
        }
        #practice-swing-card.visible {
            opacity: 1;
            pointer-events: auto;
            transform: translate(-50%, -50%) scale(1);
        }
        #practice-swing-card .ps-title {
            font-size: 0.68rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            opacity: 0.6;
            font-weight: 700;
            margin-bottom: 8px;
        }
        #practice-swing-card .ps-stats {
            display: flex;
            gap: 14px;
            margin-bottom: 10px;
        }
        /* Even columns, so a two-stat chip card and a three-stat swing card
           both read as a row rather than as text that ran out. */
        #practice-swing-card .ps-stat { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; }
        #practice-swing-card .ps-stat-k {
            font-size: 0.62rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            opacity: 0.58;
            font-weight: 600;
        }
        #practice-swing-card .ps-stat-v {
            font-size: 1.05rem;
            font-weight: 800;
            font-variant-numeric: tabular-nums;
        }
        #practice-swing-card .ps-rows {
            width: 100%;
            border-collapse: collapse;
            border-top: 1px solid rgba(255, 255, 255, 0.12);
        }
        #practice-swing-card .ps-rows td {
            padding: 4px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.07);
            font-size: 0.86rem;
        }
        #practice-swing-card .ps-name { opacity: 0.72; }
        #practice-swing-card .ps-verdict {
            text-align: right;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
        }
        /* Readable on the dark card — the modal's reds and greens were mixed
           for white paper and went muddy here. */
        #practice-swing-card .ps-good { color: #7dffa0; }
        #practice-swing-card .ps-ok   { color: #ffd76a; }
        #practice-swing-card .ps-bad  { color: #ff8a7a; }
        #practice-swing-card .ps-summary {
            margin: 9px 0 0;
            font-size: 0.82rem;
            opacity: 0.9;
        }
        #practice-swing-card .ps-note {
            margin: 5px 0 0;
            font-size: 0.72rem;
            opacity: 0.55;
        }
        #practice-swing-card .ps-dismiss {
            display: block;
            width: 100%;
            margin-top: 10px;
            padding: 7px 0;
            border: 1px solid rgba(125, 255, 160, 0.35);
            border-radius: 9px;
            background: rgba(125, 255, 160, 0.14);
            color: #cdf7d8;
            font: inherit;
            font-size: 0.8rem;
            font-weight: 700;
            letter-spacing: 0.04em;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
        }
    `;
    document.head.appendChild(style);
}

function ensureCard() {
    if (cardEl) return cardEl;
    injectStyles();
    cardEl = document.createElement('div');
    cardEl.id = 'practice-swing-card';
    (document.getElementById('game-view') || document.body).appendChild(cardEl);
    return cardEl;
}

/** Shows the rehearsal card. `html` comes from practiceSwingDetail. */
export function showPracticeSwingCard(html, title = 'Practice swing') {
    const el = ensureCard();
    el.innerHTML = `<div class="ps-title">${title}</div>${html}` +
        '<button type="button" class="ps-dismiss">Got it</button>';
    el.querySelector('.ps-dismiss').addEventListener('click', hidePracticeSwingCard);
    el.classList.add('visible');
}

export function hidePracticeSwingCard() {
    if (cardEl) cardEl.classList.remove('visible');
}
