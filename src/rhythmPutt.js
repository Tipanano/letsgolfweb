// src/rhythmPutt.js
//
// Rhythm-based putting input.
//
// The player taps 'w' repeatedly to establish a tempo. The tempo (median
// interval of the last few taps) maps to putt distance. The stroke fires on
// 'i', which is scored against the player's own predicted next beat
// (last tap + tempo): on the beat = pure strike, early = push, late = pull.
// The steadiness of the tapping (coefficient of variation of the intervals)
// feeds a small distance dispersion, so a steady drummer rolls truer putts.
//
// This module is pure (no DOM/THREE imports) so the math can be unit-tested
// in Node directly.

// --- Tunable Parameters ---
export const MIN_TAPS_TO_ARM = 3;      // Taps needed before a stroke is allowed (2 intervals)
export const MAX_INTERVALS_USED = 4;   // Tempo/wobble computed over the last N intervals
const TAP_DEBOUNCE_MS = 80;            // Ignore accidental double-taps faster than this
const EXPIRY_TEMPO_MULT = 2.5;         // Rhythm expires if the gap since the last tap exceeds this × tempo
const EXPIRY_MIN_MS = 1500;            // ...but never sooner than this

// Tempo → distance mapping.
// Tempo is mapped logarithmically (equal *relative* tempo changes feel equal,
// per Weber's law), then shaped with a power curve so short putts get a wide,
// comfortable tempo band.
// Full power at ~3 taps/second: 200 ms demanded a frantic 5/s drumroll for
// long chips and lag putts, and since the strike window scales WITH tempo
// (6% of it), max power also meant a brutal 12 ms window. 340 ms keeps the
// fast end quick but humane, with a ~20 ms window at full power.
const FAST_TEMPO_MS = 340;             // Tapping this fast (or faster) = full power
const SLOW_TEMPO_MS = 1400;            // Tapping this slow (or slower) = minimum power
const MIN_DISTANCE_M = 0.3;            // Distance at minimum power
const MAX_DISTANCE_M = 32;             // Distance at full power
const DISTANCE_CURVE = 1.4;            // >1 widens the tempo band for short putts

// Green pace used to convert a target distance to ball speed.
// Must match the green's rolling friction in simulation.js (μ = 0.08).
export const GREEN_ROLL_DECEL = 0.08 * 9.81; // m/s²

// --- Mapping direction (fast taps = far, or inverted) ---
let fastIsFar = true;
try {
    if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('rhythmPuttFastIsFar');
        if (stored !== null) fastIsFar = stored === 'true';
    }
} catch (e) { /* storage unavailable (private mode, node) - keep default */ }

export function getFastIsFar() {
    return fastIsFar;
}

export function toggleMapping() {
    fastIsFar = !fastIsFar;
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('rhythmPuttFastIsFar', String(fastIsFar));
        }
    } catch (e) { /* ignore */ }
    return fastIsFar;
}

// --- Chip shape phase ---
// Chips take an optional SECOND 'i' tap, scored against the beat after the
// strike: early = draw, on the beat = extra backspin, late = fade, absent =
// stock spin. The shape window closes this many beats after the strike.
export const SHAPE_WINDOW_BEATS = 1.2;

// --- Internal State ---
let taps = [];          // Timestamps (ms) of the last few 'w' taps
let lastStrike = null;  // Result of the last scored 'i' press, consumed by the shot calculation
let strikeTimeMs = null; // When the strike 'i' landed (anchors the chip shape beat)

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function intervalsFromTaps() {
    const intervals = [];
    for (let i = 1; i < taps.length; i++) {
        intervals.push(taps[i] - taps[i - 1]);
    }
    return intervals;
}

function median(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Coefficient of variation (stddev/mean) of the tap intervals. */
function coefficientOfVariation(values) {
    if (values.length < 2) return 0.08; // Assume typical human wobble until measured
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean <= 0) return 0.08;
    const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
    return Math.sqrt(variance) / mean;
}

function currentExpiryMs(tempoMs) {
    return tempoMs ? Math.max(EXPIRY_TEMPO_MULT * tempoMs, EXPIRY_MIN_MS) : EXPIRY_MIN_MS + 500;
}

// --- Tempo → Distance Mapping ---

/** Normalized power (0..1) for a tap interval, honoring the mapping direction. */
export function tempoToPower(tempoMs) {
    const t = clamp(tempoMs, FAST_TEMPO_MS, SLOW_TEMPO_MS);
    const p = Math.log(SLOW_TEMPO_MS / t) / Math.log(SLOW_TEMPO_MS / FAST_TEMPO_MS); // 0 slow → 1 fast
    return fastIsFar ? p : 1 - p;
}

/** Intended putt distance (meters, on a flat green) for a tap tempo. */
export function tempoToDistance(tempoMs) {
    const power = tempoToPower(tempoMs);
    return MIN_DISTANCE_M + (MAX_DISTANCE_M - MIN_DISTANCE_M) * Math.pow(power, DISTANCE_CURVE);
}

/** Ball speed (m/s) needed to roll a given distance on the green. */
export function distanceToSpeedMps(distanceMeters) {
    return Math.sqrt(2 * GREEN_ROLL_DECEL * Math.max(0.05, distanceMeters));
}

// --- Tap Tracking ---

/**
 * Records a 'w' tap. Returns a snapshot of the rhythm state.
 * Restarts the rhythm automatically if the player paused long enough for it to expire.
 */
export function recordTap(now) {
    let restarted = false;
    if (taps.length > 0) {
        const gap = now - taps[taps.length - 1];
        if (gap < TAP_DEBOUNCE_MS) {
            return { accepted: false, restarted: false, ...getSnapshot() };
        }
        const tempo = median(intervalsFromTaps());
        if (gap > currentExpiryMs(tempo)) {
            taps = [];
            restarted = true;
        }
    }
    taps.push(now);
    if (taps.length > MAX_INTERVALS_USED + 1) taps.shift();
    return { accepted: true, restarted, ...getSnapshot() };
}

/** Current rhythm state: tap count, tempo, wobble, projected distance, armed flag. */
export function getSnapshot() {
    const intervals = intervalsFromTaps();
    const tempoMs = median(intervals);
    const cv = coefficientOfVariation(intervals);
    return {
        tapCount: taps.length,
        armed: taps.length >= MIN_TAPS_TO_ARM,
        tempoMs,
        cv,
        distanceMeters: tempoMs ? tempoToDistance(tempoMs) : null,
    };
}

/**
 * Scores an 'i' press against the predicted next beat (last tap + tempo).
 * Returns the strike data, or null if the rhythm isn't armed or has expired
 * (in which case the rhythm is reset and the player must tap again).
 */
export function scoreStrike(now) {
    const snap = getSnapshot();
    if (!snap.armed || !snap.tempoMs) return null;

    const lastTap = taps[taps.length - 1];
    if (now - lastTap > currentExpiryMs(snap.tempoMs)) {
        reset();
        return null;
    }

    const beatDeviationMs = now - (lastTap + snap.tempoMs);
    lastStrike = {
        tempoMs: snap.tempoMs,
        cv: snap.cv,
        beatDeviationMs,
        fastIsFar,
        targetDistance: snap.distanceMeters,
        shapeDevFrac: null, // Set by scoreShape if the player taps the shape beat
    };
    strikeTimeMs = now;
    return lastStrike;
}

/**
 * Scores the optional chip shape tap against the beat AFTER the strike
 * (strike time + tempo). Returns the deviation as a fraction of tempo,
 * or null if there is no strike to shape.
 */
export function scoreShape(now) {
    if (!lastStrike || strikeTimeMs === null) return null;
    const devFrac = clamp((now - (strikeTimeMs + lastStrike.tempoMs)) / lastStrike.tempoMs, -1, 1);
    lastStrike.shapeDevFrac = devFrac;
    return devFrac;
}

/** Milliseconds the shape window stays open after the strike. */
export function shapeWindowMs() {
    return lastStrike ? lastStrike.tempoMs * SHAPE_WINDOW_BEATS : 600;
}

/** Hands the last strike to the shot calculation exactly once. */
export function consumeStrike() {
    const strike = lastStrike;
    lastStrike = null;
    strikeTimeMs = null;
    return strike;
}

export function reset() {
    taps = [];
}
