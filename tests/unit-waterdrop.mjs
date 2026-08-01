// Where a ball that finished in the water gets played from.
//
// Before this existed, a ball in a penalty area was simply played from where
// it sank — you took your next swing standing in the lake, with no penalty
// stroke. The reference point the Rules use is where the ball last CROSSED
// the margin, which is a property of the path and not of the splash: a ball
// can carry the length of a lake and trickle back in, and the crossing is
// nowhere near where it stopped.
//
// Run: node tests/unit-waterdrop.mjs
import { findHazardCrossing } from '../src/waterDrop.js';

let failures = 0;
const check = (label, cond, detail = '') => {
    if (cond) return;
    failures++;
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
};

// A lake spanning z from 40 to 80. Everything else is fairway.
const lake = (x, z) => (z >= 40 && z <= 80) ? 'WATER' : 'FAIRWAY';
const path = (from, to, n = 60) => Array.from({ length: n + 1 }, (_, i) => ({
    x: from.x + (to.x - from.x) * i / n,
    y: 0,
    z: from.z + (to.z - from.z) * i / n,
}));

// --- 1. Straight in: the crossing is the near edge, not the splash --------
{
    const r = findHazardCrossing(path({ x: 0, z: 0 }, { x: 0, z: 65 }), lake);
    check('flew into the lake: a crossing is found', !!r);
    check('crossing is at the near margin', Math.abs(r.crossing.z - 40) < 0.2,
        `got z=${r.crossing.z.toFixed(2)}, expected 40`);
    check('drop point is dry', lake(r.dropPoint.x, r.dropPoint.z) !== 'WATER',
        `drop at z=${r.dropPoint.z.toFixed(2)}`);
    check('drop point is short of the water, not beyond it', r.dropPoint.z < 40,
        `got z=${r.dropPoint.z.toFixed(2)}`);
}

// --- 2. Carried the lake, then rolled back in ----------------------------
// The whole point of walking BACKWARDS: the ball crossed the margin three
// times, and only the last one counts. Naively taking the first crossing
// would drop the player 45 m short of where they are entitled to.
{
    const over = path({ x: 0, z: 0 }, { x: 0, z: 95 }, 95)     // flies over, lands dry at 95
        .concat(path({ x: 0, z: 95 }, { x: 0, z: 60 }, 35));   // rolls back into the water
    const r = findHazardCrossing(over, lake);
    check('rolled back in: a crossing is found', !!r);
    check('crossing is the FAR margin it rolled back over', Math.abs(r.crossing.z - 80) < 0.3,
        `got z=${r.crossing.z.toFixed(2)}, expected 80 (taking the first crossing would give 40)`);
    check('drop is on the far side, past the lake', r.dropPoint.z > 80,
        `got z=${r.dropPoint.z.toFixed(2)}`);
}

// --- 3. Diagonal entry: the drop backs out along the line of flight -------
{
    const r = findHazardCrossing(path({ x: -30, z: 10 }, { x: 30, z: 70 }), lake);
    check('diagonal entry: a crossing is found', !!r);
    check('diagonal drop is dry', r && lake(r.dropPoint.x, r.dropPoint.z) !== 'WATER');
    check('diagonal drop backs out along the flight line, not straight back',
        r && Math.abs(r.dropPoint.x - r.crossing.x) > 0.1,
        r && `dx=${(r.dropPoint.x - r.crossing.x).toFixed(2)}`);
}

// --- 4. Never over dry ground: no drop point, replay only -----------------
{
    const allWet = path({ x: 0, z: 45 }, { x: 0, z: 70 });
    check('a path entirely inside the hazard offers no crossing',
        findHazardCrossing(allWet, lake) === null);
}

// --- 5. Never entered the water at all -----------------------------------
{
    check('a dry path offers no crossing',
        findHazardCrossing(path({ x: 0, z: 0 }, { x: 0, z: 35 }), lake) === null);
}

// --- 6. Out of bounds counts as a penalty area for the walk-back ----------
// The drop must not step out of the water and onto an OOB shelf.
{
    const oobShore = (x, z) => (z >= 40 && z <= 80) ? 'WATER' : (z > 30 && z < 40) ? 'OUT_OF_BOUNDS' : 'FAIRWAY';
    const r = findHazardCrossing(path({ x: 0, z: 0 }, { x: 0, z: 65 }), oobShore);
    check('OOB shore: a crossing is found', !!r);
    check('drop skips the OOB strip', r && r.dropPoint.z <= 30,
        r && `got z=${r.dropPoint.z.toFixed(2)}, OOB runs 30..40`);
}

// --- 7. Degenerate inputs -------------------------------------------------
check('empty trajectory is handled', findHazardCrossing([], lake) === null);
check('single point is handled', findHazardCrossing([{ x: 0, y: 0, z: 50 }], lake) === null);
check('missing trajectory is handled', findHazardCrossing(undefined, lake) === null);

if (failures) {
    console.error(`unit-waterdrop: ${failures} assertions failed`);
    process.exit(1);
}
console.log('unit-waterdrop: crossing found from the correct side in all cases, ' +
    'drops land on dry, in-bounds ground');
console.log('unit-waterdrop: all assertions passed');
