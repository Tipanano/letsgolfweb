// The practice swing: a rehearsal, not a shot.
//
// Tempo is the hardest thing this game asks of a new player, and the only way
// to learn it was to spend real strokes. A practice swing runs the whole
// input sequence and the whole impact calculation — backswing length, hip and
// rotation and arm and wrist beats, strike quality, clubhead speed — and then
// stops. No flight, no roll, no stroke on the card, ball never moves.
//
// It is a module of its own, holding one boolean, because both the UI (which
// toggles it) and the shot calculation (which honours it) need to see it, and
// ui.js and gameLogic/state.js already import each other.
import { formatDist } from './utils/unitConversions.js';
//
// It stays armed until switched off, so a player can rehearse several swings
// in a row to find a tempo. Everything that reads it also says so in the
// status line, since an armed practice swing that the player has forgotten
// about would otherwise look like a shot that failed to launch.

let armed = false;
const listeners = new Set();

/** Is the next swing a rehearsal? */
export function isPracticeSwingArmed() {
    return armed;
}

export function setPracticeSwingArmed(value) {
    const next = !!value;
    if (next === armed) return armed;
    armed = next;
    for (const fn of listeners) {
        try { fn(armed); } catch (e) { console.error('practice swing listener failed', e); }
    }
    return armed;
}

export function togglePracticeSwing() {
    return setPracticeSwingArmed(!armed);
}

/** Notified whenever the toggle flips, so the button and HUD can follow. */
export function onPracticeSwingChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/**
 * The rehearsal's status line. Deliberately short: the card carries the
 * numbers, and the long version overflowed the status pill and was clipped
 * mid-sentence on a phone.
 */
export function practiceSwingSummary() {
    return 'Practice swing — no stroke played';
}

// How far off a beat may be before it stops counting as pure. The one-line
// swing report uses the same threshold to decide what is worth mentioning;
// here nothing is omitted, so it only decides the wording and the colour.
const PURE_MS = 25;

const GOOD = 'ps-good', OK = 'ps-ok', BAD = 'ps-bad';

function row(name, verdict, cls) {
    return `<tr><td class="ps-name">${name}</td><td class="ps-verdict ${cls}">${verdict}</td></tr>`;
}

function beatRow(name, dev) {
    if (typeof dev !== 'number' || !isFinite(dev) || Math.abs(dev) > 999)
        return row(name, 'missed', BAD);
    if (Math.abs(dev) < PURE_MS)
        return row(name, `pure (${dev >= 0 ? '+' : ''}${Math.round(dev)} ms)`, GOOD);
    return row(name, `${dev > 0 ? 'late' : 'early'} ${Math.round(Math.abs(dev))} ms`,
               Math.abs(dev) < 60 ? OK : BAD);
}

const stat = (label, value) =>
    `<div class="ps-stat"><span class="ps-stat-k">${label}</span><span class="ps-stat-v">${value}</span></div>`;

/**
 * A full swing's rehearsal: the five beats it is actually made of.
 *
 * Every beat is listed every time, including the ones that were fine. The
 * one-line report drops anything inside PURE_MS to stay short; here that
 * would leave a player unable to tell "my hips were good" from "my hips were
 * not measured", and knowing which beats are already solid is most of the
 * value of rehearsing at all.
 */
function fullSwingDetail(impact, backswingMs) {
    const eff = (impact.potentialCHS > 0 && impact.actualCHS > 0)
        ? Math.round((impact.actualCHS / impact.potentialCHS) * 100) : null;
    return `
    <div class="ps-stats">
        ${stat('Clubhead', impact.actualCHS > 0 ? Math.round(impact.actualCHS) + ' mph' : '—')}
        ${stat('Efficiency', eff !== null ? eff + '%' : '—')}
        ${backswingMs ? stat('Backswing', Math.round(backswingMs) + ' ms') : ''}
    </div>
    <table class="ps-rows">
        ${beatRow('Hips', impact.transitionDev)}
        ${beatRow('Rotation', impact.rotationDev)}
        ${beatRow('Arms', impact.armsDev)}
        ${beatRow('Wrists', impact.wristsDev)}
    </table>`;
}

/**
 * A chip's rehearsal, which measures something completely different.
 *
 * A rhythm chip has no hips, rotation, arms or wrists beat — it has a tapped
 * tempo that sets the carry and one strike tap against that beat. Feeding it
 * through the full-swing layout reported all four beats as "missed" on every
 * single practice chip, which is not a bad swing, it is the wrong question.
 */
function chipDetail(impact, backswingMs) {
    const r = impact.rhythm;
    if (!r) {
        // Legacy timing path: no rhythm data exists to explain.
        return `<div class="ps-stats">${stat('Backswing', backswingMs ? Math.round(backswingMs) + ' ms' : '—')}</div>
                <p class="ps-note">This chip used the older timing input, which records no rhythm to report.</p>`;
    }
    const devPct = Math.round((r.beatDeviationMs / r.tempoMs) * 100);
    const cvPct = r.cv * 100;
    const strike = Math.abs(devPct) <= 6
        ? row('Strike', 'on the beat', GOOD)
        : row('Strike', `${Math.abs(devPct)}% ${devPct > 0 ? 'late' : 'early'}`,
              Math.abs(devPct) <= 14 ? OK : BAD);
    const steady = cvPct < 5 ? row('Tap tempo', `steady (±${Math.max(1, Math.round(cvPct))}%)`, GOOD)
        : cvPct < 9 ? row('Tap tempo', `uneven (±${Math.round(cvPct)}%)`, OK)
        : row('Tap tempo', `wobbly (±${Math.round(cvPct)}%)`, BAD);
    // The optional second tap shapes the shot; it is only scored if played.
    const shape = typeof r.shapeDevFrac === 'number'
        ? row('Shape tap', Math.abs(r.shapeDevFrac) < 0.08 ? 'on the beat'
              : `${Math.round(Math.abs(r.shapeDevFrac) * 100)}% ${r.shapeDevFrac > 0 ? 'late' : 'early'}`,
              Math.abs(r.shapeDevFrac) < 0.08 ? GOOD : OK)
        : '';
    // Carry is what the tapped tempo was ASKING for — the useful number when
    // there is no ball to watch land.
    const carry = typeof r.targetDistance === 'number'
        ? stat('Asking for', formatDist(r.targetDistance, 0)) : '';
    return `
    <div class="ps-stats">
        ${stat('Tempo', Math.round(r.tempoMs) + ' ms')}
        ${carry}
    </div>
    <table class="ps-rows">
        ${steady}
        ${strike}
        ${shape}
    </table>`;
}

/**
 * The full rehearsal report, as card HTML.
 *
 * A practice swing produces no ball, so this IS its output — which is why the
 * shot type has to pick the right measurements rather than showing one layout
 * for everything.
 */
export function practiceSwingDetail(impact, club, { shotType = 'full', backswingMs = null, label = '' } = {}) {
    if (!impact) return '<p class="ps-note">No swing was recorded.</p>';
    const face = shotType === 'full' ? impact.faceAngleRelPath : impact.absoluteFaceAngle;
    const path = impact.clubPathAngle;
    let shape;
    if (shotType === 'full') {
        const curve = Math.abs(face) < 2 ? 'straight'
            : face > 6 ? 'slice' : face > 0 ? 'fade'
            : face < -6 ? 'hook' : 'draw';
        shape = curve + (Math.abs(path) < 2.5 ? '' : path > 0 ? ' push' : ' pull');
    } else {
        shape = Math.abs(face) < 1.5 ? 'straight' : face > 0 ? 'push right' : 'pull left';
    }
    const body = shotType === 'full' ? fullSwingDetail(impact, backswingMs) : chipDetail(impact, backswingMs);
    const what = label || (shotType === 'full' ? 'swing' : shotType);
    return `${body}
    <p class="ps-summary">${impact.strikeQuality} ${what.toLowerCase()} · ${shape}${club?.name ? ' · ' + club.name : ''}</p>
    <p class="ps-note">No stroke was played and the ball has not moved.</p>`;
}
