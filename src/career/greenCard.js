// src/career/greenCard.js
//
// The Green Card: a drill-based certification that doubles as the game's
// tutorial and the career on-ramp (doc/CAREER_MODE_DESIGN.md). Named after
// the Norwegian "grønt kort" — the real one was mostly initial instruction;
// the drill set here is invented for the game, one drill per mechanic.
//
// Drills run inside play-hole practice mode: every shot is one attempt,
// scored by where the ball finishes (playHole.handleShotResult calls
// recordShot). Progress persists in localStorage.

import { GREEN_CENTER, GREEN_RADIUS, PRACTICE_FLAG, PRACTICE_BUNKERS } from '../modes/practiceGreen.js';
import { drivingDrillLayout, approachDrillLayout } from './drillHoles.js';

export const DRILLS = [
    { id: 'driving',  icon: '🏌️', title: 'Driving',     desc: 'Find the fairway from the tee',                target: 5 },
    { id: 'approach', icon: '🎯', title: 'Approach',    desc: 'Hit the green on a short par 3',               target: 5 },
    { id: 'chipping', icon: '🌱', title: 'Chipping',    desc: 'Chip from 5–10 m off the green and stay on it', target: 5 },
    { id: 'bunker',   icon: '🏖️', title: 'Bunker',      desc: 'Escape a greenside bunker onto the green',     target: 3 },
    { id: 'lagputt',  icon: '📏', title: 'Lag putting', desc: 'Roll long putts to inside 2.5 m',              target: 5 },
    { id: 'holing',   icon: '🕳️', title: 'Holing out',  desc: 'Hole putts from 1–3 m',                        target: 5 },
];

export const LAG_PUTT_TOLERANCE_M = 2.5;

// --- Attempt evaluation (pure) ---

/**
 * Scores one drill attempt from end-of-shot facts.
 * @param {string} drillId
 * @param {{lie: string, holed: boolean, distToFlag: number}} result
 */
export function evaluateDrillShot(drillId, result) {
    switch (drillId) {
        case 'driving':  return result.lie === 'FAIRWAY';
        case 'approach': return result.holed || result.lie === 'GREEN';
        case 'chipping': return result.holed || result.lie === 'GREEN';
        case 'bunker':   return result.holed || result.lie === 'GREEN';
        case 'lagputt':  return result.holed ||
            (result.lie === 'GREEN' && result.distToFlag <= LAG_PUTT_TOLERANCE_M);
        case 'holing':   return result.holed;
        default:         return false;
    }
}

// --- Progress persistence ---

const STORAGE_KEY = 'golfGreenCardV1';

function loadProgress() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const p = raw ? JSON.parse(raw) : null;
        if (p && typeof p.counts === 'object') return p;
    } catch (e) {
        console.error('GreenCard: unreadable progress, starting fresh.', e);
    }
    return { counts: {}, completedAt: null };
}

function saveProgress(progress) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (e) {
        console.error('GreenCard: failed to save progress.', e);
    }
}

export function getProgress() {
    const p = loadProgress();
    return {
        counts: { ...p.counts },
        completedAt: p.completedAt,
        complete: DRILLS.every(d => (p.counts[d.id] || 0) >= d.target),
    };
}

export function isCardEarned() {
    return getProgress().complete;
}

// --- Drill spot generation ---
// Random-but-valid placements on the practice green (chip/bunker/putt
// drills) or the dedicated drill holes (driving/approach).

const dist2 = (x1, z1, x2, z2) => Math.hypot(x1 - x2, z1 - z2);

/** Next ball placement for a drill attempt, as a practice-placement preset. */
export function nextSpot(drillId, attemptNo = 1) {
    const label = (base) => `${base} · ball ${attemptNo}`;
    switch (drillId) {
        case 'driving':
            return { id: 'drill', label: label('Driving drill'), x: 0, z: 0.5, lie: 'TEE', club: 'DR', shotType: 'full' };
        case 'approach':
            return { id: 'drill', label: label('Approach drill'), x: 0, z: 0.5, lie: 'TEE', club: 'I7', shotType: 'full' };
        case 'chipping': {
            // 5–10 m outside the green edge, clear of the bunkers
            for (let i = 0; i < 40; i++) {
                const angle = Math.random() * Math.PI * 2;
                const r = GREEN_RADIUS + 5 + Math.random() * 5;
                const x = GREEN_CENTER.x + Math.cos(angle) * r;
                const z = GREEN_CENTER.z + Math.sin(angle) * r;
                if (Math.abs(x) > 38 || z < 7 || z > 93) continue;
                if (PRACTICE_BUNKERS.some(b => dist2(x, z, b.x, b.z) < b.r + 1.5)) continue;
                const onApron = Math.abs(x) <= 9 && z >= 18 && z <= 41.5;
                return {
                    id: 'drill', label: label(`Chipping drill · ${dist2(x, z, PRACTICE_FLAG.x, PRACTICE_FLAG.z).toFixed(0)} m`),
                    x: +x.toFixed(2), z: +z.toFixed(2),
                    lie: onApron ? 'FAIRWAY' : 'LIGHT_ROUGH', shotType: 'chip',
                };
            }
            return { id: 'drill', label: label('Chipping drill'), x: 0, z: 34, lie: 'FAIRWAY', shotType: 'chip' };
        }
        case 'bunker': {
            const b = PRACTICE_BUNKERS[Math.floor(Math.random() * PRACTICE_BUNKERS.length)];
            const angle = Math.random() * Math.PI * 2;
            const r = Math.random() * (b.r - 1.5);
            return {
                id: 'drill', label: label('Bunker drill'),
                x: +(b.x + Math.cos(angle) * r).toFixed(2),
                z: +(b.z + Math.sin(angle) * r).toFixed(2),
                lie: 'BUNKER', shotType: 'chip',
            };
        }
        case 'lagputt': {
            // 8–12 m from the flag, on the green
            for (let i = 0; i < 40; i++) {
                const angle = Math.random() * Math.PI * 2;
                const r = 8 + Math.random() * 4;
                const x = PRACTICE_FLAG.x + Math.cos(angle) * r;
                const z = PRACTICE_FLAG.z + Math.sin(angle) * r;
                if (dist2(x, z, GREEN_CENTER.x, GREEN_CENTER.z) > GREEN_RADIUS - 1.5) continue;
                return {
                    id: 'drill', label: label(`Lag drill · ${r.toFixed(1)} m`),
                    x: +x.toFixed(2), z: +z.toFixed(2), lie: 'GREEN', shotType: 'putt',
                };
            }
            return { id: 'drill', label: label('Lag drill'), x: 2, z: 48, lie: 'GREEN', shotType: 'putt' };
        }
        case 'holing': {
            const angle = Math.random() * Math.PI * 2;
            const r = 1 + Math.random() * 2;
            return {
                id: 'drill', label: label(`Holing drill · ${r.toFixed(1)} m`),
                x: +(PRACTICE_FLAG.x + Math.cos(angle) * r).toFixed(2),
                z: +(PRACTICE_FLAG.z + Math.sin(angle) * r).toFixed(2),
                lie: 'GREEN', shotType: 'putt',
            };
        }
        default:
            return null;
    }
}

/** Everything main.js needs to launch a drill via play-hole practice mode. */
export function drillLaunchConfig(drillId) {
    const placement = nextSpot(drillId, 1);
    switch (drillId) {
        case 'driving':
            return { type: 'chip', layout: drivingDrillLayout(), placement, hidePanel: true };
        case 'approach':
            return { type: 'chip', layout: approachDrillLayout(), placement, hidePanel: true };
        case 'chipping':
        case 'bunker':
            return { type: 'chip', layout: null, placement, hidePanel: true };
        default:
            return { type: 'putt', layout: null, placement, hidePanel: true };
    }
}

// --- Active drill state & attempt recording ---

let activeDrillId = null;
let attemptNo = 1;

export function startDrill(drillId) {
    activeDrillId = DRILLS.some(d => d.id === drillId) ? drillId : null;
    attemptNo = 1;
    return activeDrillId;
}

export function stopDrill() {
    activeDrillId = null;
    attemptNo = 1;
}

export function getActiveDrill() {
    return activeDrillId;
}

/**
 * Records one drill attempt. Called from playHole.handleShotResult with
 * end-of-shot facts. Returns status text plus the next placement (or null
 * when the drill just finished), or null when no drill is active.
 */
export function recordShot(result) {
    if (!activeDrillId) return null;
    const drill = DRILLS.find(d => d.id === activeDrillId);
    const success = evaluateDrillShot(activeDrillId, result);

    const progress = loadProgress();
    let count = progress.counts[activeDrillId] || 0;
    if (success) {
        count++;
        progress.counts[activeDrillId] = count;
    }

    const drillDone = count >= drill.target;
    if (drillDone && !progress.completedAt &&
        DRILLS.every(d => (progress.counts[d.id] || 0) >= d.target)) {
        progress.completedAt = new Date().toISOString();
    }
    if (success) saveProgress(progress);

    if (drillDone) {
        const cardEarned = !!progress.completedAt;
        stopDrill();
        return {
            statusText: cardEarned
                ? `🎓 ${drill.title} drill complete — GREEN CARD EARNED! 🎉 Head to Play Course to start your career.`
                : `✅ ${drill.title} drill complete (${count}/${drill.target})! Back to menu for the next drill.`,
            nextSpot: null,
            drillDone: true,
        };
    }

    attemptNo++;
    return {
        statusText: success
            ? `✅ ${count}/${drill.target} — press (n) for the next ball`
            : `❌ Not this time (${count}/${drill.target}) — press (n) to try again`,
        nextSpot: nextSpot(activeDrillId, attemptNo),
        drillDone: false,
    };
}
