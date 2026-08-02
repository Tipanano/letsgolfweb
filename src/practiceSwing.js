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
 * The rehearsal's status line: what the swing would have delivered.
 *
 * Clubhead speed is the honest measure of "power" here — the swing report
 * already names efficiency and the per-beat timing, but with no ball flight to
 * watch there is nothing else showing how hard the swing actually was.
 */
export function practiceSwingSummary(impact, club) {
    if (!impact) return 'Practice swing';
    const bits = [];
    if (impact.actualCHS > 0) bits.push(`${Math.round(impact.actualCHS)} mph clubhead`);
    if (impact.potentialCHS > 0 && impact.actualCHS > 0)
        bits.push(`${Math.round((impact.actualCHS / impact.potentialCHS) * 100)}% of your potential`);
    const name = club?.name ? ` · ${club.name}` : '';
    return `Practice swing${name}${bits.length ? ' · ' + bits.join(' · ') : ''}`;
}

// How far off a beat may be before it stops counting as pure. The one-line
// swing report uses the same threshold to decide what is worth mentioning;
// here nothing is omitted, so it only decides the wording and the colour.
const PURE_MS = 25;

function beatRow(name, dev) {
    let verdict, colour;
    if (typeof dev !== 'number' || !isFinite(dev) || Math.abs(dev) > 999) {
        verdict = 'missed'; colour = '#c62828';
    } else if (Math.abs(dev) < PURE_MS) {
        verdict = `pure (${dev >= 0 ? '+' : ''}${Math.round(dev)} ms)`; colour = '#2e7d32';
    } else {
        verdict = `${dev > 0 ? 'late' : 'early'} ${Math.round(Math.abs(dev))} ms`;
        colour = Math.abs(dev) < 60 ? '#ef6c00' : '#c62828';
    }
    return `<tr>
        <td style="padding:4px 10px 4px 0;color:#37474f;">${name}</td>
        <td style="padding:4px 0;text-align:right;font-weight:700;color:${colour};
                   font-variant-numeric:tabular-nums;">${verdict}</td>
    </tr>`;
}

/**
 * The full rehearsal report, as modal HTML.
 *
 * A practice swing produces no ball, so this IS its output — which is why
 * every beat is listed every time, including the ones that were fine. The
 * one-line report drops anything inside PURE_MS to stay short; here that
 * would leave a player unable to tell "my hips were good" from "my hips were
 * not measured", and knowing which beats are already solid is most of the
 * value of rehearsing at all.
 */
export function practiceSwingDetail(impact, club, backswingMs) {
    if (!impact) return '<p>No swing was recorded.</p>';
    const eff = (impact.potentialCHS > 0 && impact.actualCHS > 0)
        ? Math.round((impact.actualCHS / impact.potentialCHS) * 100) : null;
    const face = impact.faceAngleRelPath, path = impact.clubPathAngle;
    const curve = Math.abs(face) < 2 ? 'straight'
        : face > 6 ? 'slice' : face > 0 ? 'fade'
        : face < -6 ? 'hook' : 'draw';
    const start = Math.abs(path) < 2.5 ? '' : path > 0 ? ' push' : ' pull';

    const stat = (label, value) => `<div style="flex:1 1 33%;min-width:96px;">
        <div style="font-size:11px;opacity:0.65;text-transform:uppercase;letter-spacing:0.04em;">${label}</div>
        <div style="font-size:17px;font-weight:700;color:#1b5e20;">${value}</div></div>`;

    return `
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
        ${stat('Clubhead', impact.actualCHS > 0 ? Math.round(impact.actualCHS) + ' mph' : '—')}
        ${stat('Efficiency', eff !== null ? eff + '%' : '—')}
        ${stat('Backswing', backswingMs ? Math.round(backswingMs) + ' ms' : '—')}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;
                  border-top:1px solid #e0e0e0;border-bottom:1px solid #e0e0e0;">
        ${beatRow('Hips', impact.transitionDev)}
        ${beatRow('Rotation', impact.rotationDev)}
        ${beatRow('Arms', impact.armsDev)}
        ${beatRow('Wrists', impact.wristsDev)}
    </table>
    <p style="margin:12px 0 0;font-size:13px;color:#37474f;">
        Strike <strong>${impact.strikeQuality}</strong> · shape <strong>${curve}${start}</strong>${club?.name ? ' · ' + club.name : ''}
    </p>
    <p style="margin:8px 0 0;font-size:12px;opacity:0.7;">
        No stroke was played and the ball has not moved.
    </p>`;
}
