// src/courseConditions.js
//
// Course conditions: green speed (stimpmeter) and turf firmness, rolled per
// course + date within bounds set by the course's difficulty stars — a
// championship course never has slow greens, a countryside 9-holer never
// runs tournament speed. Both knobs feed the ball physics through two choke
// points in simulation.js: rolling friction (stimp on greens, firmness on
// turf) and turf softness (firmness → bounce retention and crater dig).
//
// Neutral defaults equal the game's long-standing constants, so practice,
// drills and every characterization suite play exactly as before unless a
// round explicitly rolls conditions.

const NEUTRAL = { stimp: 10, firmness: 0.5 };
let current = { ...NEUTRAL };

// Bounds by difficulty stars (1-5). Stimp in feet; firmness 0 (soaked) to
// 1 (baked). Better courses trend faster and firmer — better drainage,
// tighter cut — but everyone gets weather variance within their band.
export const STIMP_BOUNDS_BY_STARS = {
    1: [8.0, 10.0],
    2: [8.5, 10.5],
    3: [9.0, 11.5],
    4: [10.0, 12.0],
    5: [10.5, 13.0],
};
export const FIRMNESS_BOUNDS_BY_STARS = {
    1: [0.25, 0.60],
    2: [0.30, 0.65],
    3: [0.30, 0.75],
    4: [0.40, 0.80],
    5: [0.45, 0.90],
};

function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h | 0;
}

/**
 * Rolls today's conditions for a course and makes them active. Seeded by
 * course name + date: the same course plays the same on the same day
 * (consistent across sessions and, later, between multiplayer players).
 */
export function rollConditions(courseName, stars = 3, dateStr = null) {
    const day = dateStr || new Date().toISOString().slice(0, 10);
    const s = Math.min(5, Math.max(1, Math.round(stars || 3)));
    const rand = mulberry32(hashString(`${courseName}|${day}`));
    const [s0, s1] = STIMP_BOUNDS_BY_STARS[s];
    const [f0, f1] = FIRMNESS_BOUNDS_BY_STARS[s];
    current = {
        stimp: Math.round((s0 + rand() * (s1 - s0)) * 2) / 2,   // 0.5 steps
        firmness: Math.round((f0 + rand() * (f1 - f0)) * 20) / 20, // 0.05 steps
    };
    return { ...current };
}

/** Direct setter — tests and future weather systems. */
export function setConditions({ stimp, firmness } = {}) {
    if (Number.isFinite(stimp)) current.stimp = Math.min(15, Math.max(6, stimp));
    if (Number.isFinite(firmness)) current.firmness = Math.min(1, Math.max(0, firmness));
    return { ...current };
}

/** Practice green, drills, single holes: the long-standing standard turf. */
export function setNeutralConditions() {
    current = { ...NEUTRAL };
    return { ...current };
}

export function getConditions() {
    return { ...current };
}

export function firmnessWord(f = current.firmness) {
    return f < 0.35 ? 'Soft' : f < 0.65 ? 'Medium' : 'Firm';
}

/** HUD label, e.g. "Stimp 11 · Firm". */
export function conditionsLabel() {
    return `Stimp ${current.stimp} · ${firmnessWord()}`;
}

// --- Physics scale factors (1.0 at neutral by construction) ---

/** Green rolling friction scale: stimp 13 → balls roll ~30% farther. */
export function greenFrictionScale() {
    return NEUTRAL.stimp / current.stimp;
}

/** Turf (non-green) rolling friction scale: firm ground runs out more. */
export function turfFrictionScale() {
    return 1.25 - 0.5 * current.firmness;
}

/** Turf softness scale for the bounce: soft ground swallows, firm skips. */
export function turfSoftnessScale() {
    return 1.5 - current.firmness;
}
