// Centralized unit handling for the golf game.
//
// EVERYTHING internal is metric: the importer, the terrain field, the physics,
// the course files. Yards (or meters) only exist at the moment a number is
// shown to the player, and that moment always goes through this module so the
// whole game flips together with one setting.
//
// The distance unit is a player preference (localStorage 'distanceUnit'),
// defaulting from the browser locale: only the three countries that still
// measure in yards get yards; everyone else gets meters.

export const METERS_TO_YARDS = 1.09361;
export const YARDS_TO_METERS = 1 / METERS_TO_YARDS;
export const METERS_TO_FEET = 3.28084;
export const FEET_TO_METERS = 1 / METERS_TO_FEET;

export function metersToYards(meters) { return meters * METERS_TO_YARDS; }
export function yardsToMeters(yards) { return yards * YARDS_TO_METERS; }
export function metersToFeet(meters) { return meters * METERS_TO_FEET; }
export function feetToMeters(feet) { return feet * FEET_TO_METERS; }

// --- Distance unit preference ---
const STORAGE_KEY = 'distanceUnit';
const YARD_LOCALES = /^(en-US|en-LR|my-MM)/i;
let unit = null; // 'm' | 'yd', resolved lazily
const listeners = new Set();

function safeStorage() {
    try { return globalThis.localStorage || null; } catch { return null; }
}

function defaultUnit() {
    const lang = globalThis.navigator?.language || '';
    return YARD_LOCALES.test(lang) ? 'yd' : 'm';
}

/** 'm' or 'yd' — the unit every displayed distance uses right now. */
export function getDistanceUnit() {
    if (unit) return unit;
    const stored = safeStorage()?.getItem(STORAGE_KEY);
    unit = (stored === 'm' || stored === 'yd') ? stored : defaultUnit();
    return unit;
}

export function setDistanceUnit(next) {
    if (next !== 'm' && next !== 'yd') return getDistanceUnit();
    if (next === unit) return unit;
    unit = next;
    try { safeStorage()?.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
    for (const fn of listeners) {
        try { fn(unit); } catch (e) { console.error('unit listener failed', e); }
    }
    return unit;
}

export function toggleDistanceUnit() {
    return setDistanceUnit(getDistanceUnit() === 'm' ? 'yd' : 'm');
}

/** Called with the new unit whenever it changes; returns an unsubscribe. */
export function onDistanceUnitChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Short label for the current unit: 'm' or 'yd'. */
export function unitLabel() { return getDistanceUnit(); }
/** Long label: 'meters' or 'yards'. */
export function unitLabelLong() { return getDistanceUnit() === 'm' ? 'meters' : 'yards'; }

/** A metric distance as a number in the current display unit. */
export function distanceValue(meters) {
    return getDistanceUnit() === 'm' ? meters : metersToYards(meters);
}

/** A number typed/shown in the current unit, back to meters. */
export function metersFromDisplay(value) {
    return getDistanceUnit() === 'm' ? value : yardsToMeters(value);
}

/** '149 m' / '163 yd' — the one formatter every HUD distance should use. */
export function formatDist(meters, decimals = 0) {
    if (typeof meters !== 'number' || !isFinite(meters)) return '–';
    return `${distanceValue(meters).toFixed(decimals)} ${unitLabel()}`;
}

/** Course-scale lengths: '6.4 km' or '7,003 yd'. */
export function formatCourseLength(meters) {
    if (getDistanceUnit() === 'm') return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(metersToYards(meters)).toLocaleString('en-US')} yd`;
}

// --- Legacy formatters (kept for callers that pin a unit explicitly) ---
export function formatDistanceYards(meters, decimals = 1) {
    return metersToYards(meters).toFixed(decimals) + ' yd';
}
export function formatDistanceMeters(meters, decimals = 1) {
    return meters.toFixed(decimals) + ' m';
}
export function formatDistance(meters, unitName = null, decimals = 1) {
    const u = unitName === 'meters' ? 'm' : unitName === 'yards' ? 'yd' : getDistanceUnit();
    return u === 'm' ? formatDistanceMeters(meters, decimals) : formatDistanceYards(meters, decimals);
}
