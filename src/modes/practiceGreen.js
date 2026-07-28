// src/modes/practiceGreen.js
//
// Short-game practice area: one green ringed by bunkers and rough, shared by
// the chipping and putting practice modes. Provides the generated layout,
// the ball-placement presets, and the placement panel UI.
//
// The mode itself runs as a practice variant of play-hole mode (see
// playHole.initializePracticeMode), so all lie detection, camera, and shot
// flow logic is reused.

// --- Layout Geometry (meters) ---
// Green: circle r=14 centered at (0, 55). Flag at (2, 58).
// Bunkers guard left, right, and back. A fairway apron approaches from the front.

const GREEN_CENTER = { x: 0, z: 55 };
const GREEN_RADIUS = 14;
export const PRACTICE_FLAG = { x: 2, z: 58 };

function circleVertices(cx, cz, radius, segments = 24, wobble = 0) {
    const verts = [];
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        // Slight radius wobble gives organic, non-perfect-circle shapes
        const r = radius * (1 + wobble * Math.sin(angle * 3 + radius));
        verts.push({
            x: +(cx + Math.cos(angle) * r).toFixed(2),
            z: +(cz + Math.sin(angle) * r).toFixed(2),
        });
    }
    return verts;
}

/** Raw layout in the hole-maker export format, ready for processHoleLayout(). */
export function generatePracticeGreenLayout() {
    return {
        name: 'Practice Green',
        par: 3,
        lengthMeters: 40,
        hasElevation: false,
        // Tiny tee far off in a corner — practice placement overrides all tee
        // logic, but the layout schema wants one.
        tee: {
            center: { x: 26, y: 0, z: 16 },
            width: 1.5,
            depth: 1.5,
            surface: 'TEE',
        },
        greens: [{
            controlPoints: circleVertices(GREEN_CENTER.x, GREEN_CENTER.z, GREEN_RADIUS, 28, 0.04),
            surface: 'GREEN',
        }],
        fairways: [{
            // Apron widening toward the green front
            controlPoints: [
                { x: -6, z: 18 }, { x: 6, z: 18 },
                { x: 9, z: 41.5 }, { x: -9, z: 41.5 },
            ],
            surface: 'FAIRWAY',
        }],
        bunkers: [
            { controlPoints: circleVertices(-19, 58, 4.5, 18, 0.08), surface: 'BUNKER' },   // left
            { controlPoints: circleVertices(18, 49, 4.0, 18, 0.08), surface: 'BUNKER' },    // right
            { controlPoints: circleVertices(-5, 74.5, 3.8, 18, 0.08), surface: 'BUNKER' },  // back
        ],
        lightRough: [{
            // Generous surround so mishits stay in play
            vertices: [
                { x: -40, z: 5 }, { x: 40, z: 5 },
                { x: 40, z: 95 }, { x: -40, z: 95 },
            ],
            surface: 'LIGHT_ROUGH',
        }],
        flagPositions: [{ number: 1, x: PRACTICE_FLAG.x, y: 0, z: PRACTICE_FLAG.z }],
        // Smooth analytic contours (see greenContours.js): a gentle
        // back-to-front tilt, a crown on the right, a raised back tier, and a
        // front-left swale. Feather runs 15→20m so the collar melts into the
        // flat surround.
        greenContour: {
            center: { x: GREEN_CENTER.x, z: GREEN_CENTER.z },
            innerRadius: 15,
            outerRadius: 20,
            tilt: { dx: 0, dz: 0.010 }, // Rises toward the back → putts break toward the front
            bumps: [
                { x: 6, z: 52, height: 0.18, radius: 7 },   // Right crown
                { x: -4, z: 63, height: 0.30, radius: 8 },  // Back tier
                { x: -7, z: 47, height: -0.14, radius: 6 }, // Front-left swale
            ],
        },
    };
}

// --- Ball Placement Presets ---
// Distances are to the flag at (2, 58).

export const PRACTICE_PRESETS = {
    chip: [
        { id: 'apron', label: 'Apron · 20 m', x: 0, z: 38.3, lie: 'FAIRWAY', shotType: 'chip' },
        { id: 'rough', label: 'Rough · 19 m', x: -15.5, z: 50, lie: 'LIGHT_ROUGH', shotType: 'chip' },
        { id: 'bunker', label: 'Bunker · 17 m', x: 17, z: 50, lie: 'BUNKER', shotType: 'chip' },
        { id: 'behind', label: 'Behind green · 12 m', x: 2, z: 70.5, lie: 'LIGHT_ROUGH', shotType: 'chip' },
    ],
    putt: [
        { id: 'p2', label: 'Short · 2 m', x: 2, z: 56, lie: 'GREEN', shotType: 'putt' },
        { id: 'p5', label: 'Mid · 5 m', x: -3, z: 58, lie: 'GREEN', shotType: 'putt' },
        { id: 'p10', label: 'Long · 10 m', x: 2, z: 48, lie: 'GREEN', shotType: 'putt' },
        { id: 'p16', label: 'Lag · 16 m', x: -7, z: 45, lie: 'GREEN', shotType: 'putt' },
    ],
};

// Chip shot styles: each is just a club + stance recipe — picking one teaches
// what actually makes a bump-and-run vs a flop. Ball position: 10 levels,
// index 0 = back (factor +1), 9 = forward.
export const CHIP_STYLES = [
    { id: 'bumprun', label: 'Bump & run', club: 'I8', ballPositionIndex: 2 },
    { id: 'standard', label: 'Standard', club: 'PW', ballPositionIndex: 4 },
    { id: 'spinner', label: 'Spinner', club: 'SW58', ballPositionIndex: 3 },
    { id: 'flop', label: 'Flop', club: 'LW60', ballPositionIndex: 8 },
];

let activeStyleId = 'standard';

export function getActiveChipStyle() {
    return CHIP_STYLES.find(s => s.id === activeStyleId) || CHIP_STYLES[1];
}

/** Random on-green placement at least 2 m from the flag. */
export function randomPuttPreset() {
    for (let attempt = 0; attempt < 20; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * (GREEN_RADIUS - 1.5);
        const x = GREEN_CENTER.x + Math.cos(angle) * r;
        const z = GREEN_CENTER.z + Math.sin(angle) * r;
        const dist = Math.hypot(x - PRACTICE_FLAG.x, z - PRACTICE_FLAG.z);
        if (dist >= 2) {
            return {
                id: 'random', label: `Random · ${dist.toFixed(1)} m`,
                x: +x.toFixed(2), z: +z.toFixed(2), lie: 'GREEN', shotType: 'putt',
            };
        }
    }
    return PRACTICE_PRESETS.putt[1];
}

/** Random off-green chip spot in the surround (rough), 16–24 m out. */
export function randomChipPreset() {
    for (let attempt = 0; attempt < 30; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const r = GREEN_RADIUS + 2 + Math.random() * 8;
        const x = GREEN_CENTER.x + Math.cos(angle) * r;
        const z = GREEN_CENTER.z + Math.sin(angle) * r;
        if (Math.abs(x) > 38 || z < 7 || z > 93) continue;
        const dist = Math.hypot(x - PRACTICE_FLAG.x, z - PRACTICE_FLAG.z);
        return {
            id: 'random', label: `Random · ${dist.toFixed(1)} m`,
            x: +x.toFixed(2), z: +z.toFixed(2), lie: 'LIGHT_ROUGH', shotType: 'chip',
        };
    }
    return PRACTICE_PRESETS.chip[1];
}

// --- Placement Panel UI ---

let panelEl = null;
let activeType = 'putt';
let placeCallback = null;
let styleCallback = null;
let stylesInjected = false;

function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        #practice-panel {
            position: absolute;
            top: 140px; /* Below the top bar and the Hole/Par overlay text */
            left: 10px;
            width: 172px;
            padding: 10px 12px;
            background: rgba(20, 30, 24, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            color: #eaf6ec;
            font-family: 'Segoe UI', system-ui, sans-serif;
            font-size: 13px;
            z-index: 1001;
            display: none;
        }
        #practice-panel.visible { display: block; }
        #practice-panel h4 {
            margin: 0 0 8px 0;
            font-size: 13px;
            font-weight: 600;
            opacity: 0.9;
        }
        .practice-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
        .practice-tab {
            flex: 1;
            padding: 4px 0;
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 6px;
            background: transparent;
            color: inherit;
            cursor: pointer;
            font-size: 12px;
        }
        .practice-tab.active { background: #2f6b3f; border-color: #7dffa0; }
        .practice-preset {
            display: block;
            width: 100%;
            margin: 4px 0;
            padding: 6px 8px;
            text-align: left;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 6px;
            background: rgba(255,255,255,0.06);
            color: inherit;
            cursor: pointer;
            font-size: 12px;
        }
        .practice-preset:hover { background: rgba(125,255,160,0.18); }
        .practice-style-row {
            display: flex;
            flex-wrap: wrap;
            gap: 3px;
            margin: 2px 0 6px 0;
        }
        .practice-style {
            flex: 1 1 45%;
            padding: 4px 2px;
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 5px;
            background: rgba(255,255,255,0.04);
            color: inherit;
            cursor: pointer;
            font-size: 11px;
        }
        .practice-style.active { background: #2f6b3f; border-color: #7dffa0; }
        .practice-section-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            opacity: 0.6;
            margin: 6px 0 2px 0;
        }
    `;
    document.head.appendChild(style);
}

function renderPresets() {
    const list = panelEl.querySelector('#practice-preset-list');
    list.innerHTML = '';

    // Chip tab: shot style recipes (club + stance) above the placement spots
    if (activeType === 'chip') {
        const label = document.createElement('div');
        label.className = 'practice-section-label';
        label.textContent = 'Shot style (club + stance)';
        list.appendChild(label);

        const row = document.createElement('div');
        row.className = 'practice-style-row';
        CHIP_STYLES.forEach(style => {
            const btn = document.createElement('button');
            btn.className = 'practice-style' + (style.id === activeStyleId ? ' active' : '');
            btn.textContent = style.label;
            btn.addEventListener('click', () => {
                activeStyleId = style.id;
                renderPresets();
                if (styleCallback) styleCallback({ ...style });
            });
            row.appendChild(btn);
        });
        list.appendChild(row);

        const dropLabel = document.createElement('div');
        dropLabel.className = 'practice-section-label';
        dropLabel.textContent = 'Drop the ball';
        list.appendChild(dropLabel);
    }

    const presets = PRACTICE_PRESETS[activeType] || [];
    presets.forEach(preset => {
        const btn = document.createElement('button');
        btn.className = 'practice-preset';
        btn.textContent = preset.label;
        btn.addEventListener('click', () => placeCallback && placeCallback({ ...preset }));
        list.appendChild(btn);
    });

    const randomBtn = document.createElement('button');
    randomBtn.className = 'practice-preset';
    randomBtn.textContent = '🎲 Random spot';
    randomBtn.addEventListener('click', () => {
        const preset = activeType === 'putt' ? randomPuttPreset() : randomChipPreset();
        if (placeCallback) placeCallback(preset);
    });
    list.appendChild(randomBtn);
}

function ensureCreated() {
    if (panelEl) return;
    injectStyles();
    panelEl = document.createElement('div');
    panelEl.id = 'practice-panel';
    panelEl.innerHTML = `
        <h4>Practice — drop the ball:</h4>
        <div class="practice-tabs">
            <button class="practice-tab" data-type="chip">Chipping</button>
            <button class="practice-tab" data-type="putt">Putting</button>
        </div>
        <div id="practice-preset-list"></div>
    `;
    // Must live inside #game-view: in fullscreen mode it's a fixed overlay at
    // z-index 9999, so body-level siblings render behind the game.
    (document.getElementById('game-view') || document.body).appendChild(panelEl);

    panelEl.querySelectorAll('.practice-tab').forEach(tab => {
        tab.addEventListener('click', () => setActiveTab(tab.dataset.type));
    });
}

function updateTabStyles() {
    panelEl.querySelectorAll('.practice-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.type === activeType);
    });
}

export function setActiveTab(type) {
    ensureCreated();
    activeType = type === 'chip' ? 'chip' : 'putt';
    updateTabStyles();
    renderPresets();
}

/**
 * Shows the placement panel.
 * onPlace(preset) fires when a spot is chosen; onStyle(style) when a chip
 * shot style (club + stance recipe) is picked.
 */
export function showPracticePanel(type, onPlace, onStyle = null) {
    ensureCreated();
    placeCallback = onPlace;
    styleCallback = onStyle;
    setActiveTab(type);
    panelEl.classList.add('visible');
}

export function hidePracticePanel() {
    if (panelEl) panelEl.classList.remove('visible');
}

export function getDefaultPreset(type) {
    return type === 'chip'
        ? { ...PRACTICE_PRESETS.chip[0] }
        : { ...PRACTICE_PRESETS.putt[1] };
}
