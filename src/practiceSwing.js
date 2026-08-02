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
 * The rehearsal's feedback line: what the swing would have delivered.
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
