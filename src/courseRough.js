// What the rough is like at a given course.
//
// The game defines four grades of rough — light, medium, thick and native
// fescue — each with its own bounce, roll-out, spin response and forgiveness
// for a fat or thin strike. Until now every imported hole used LIGHT_ROUGH and
// nothing else: 948 rough polygons across 29 courses, all one grade. Three
// quarters of the short-game model was sitting unused.
//
// Two ideas decide a course's rough. The famous ones are famous FOR it and get
// named: Augusta's second cut is 1.375 inches and that is the whole story,
// while Bethpage and Oakmont are US Open rough and Carnoustie will take your
// wrists off. Everywhere else picks a profile from its own name, so a club
// course has a character that is its own and never changes under a player —
// unlike the weather in courseConditions.js, which is seeded by name AND date
// precisely because it should.

/** Deterministic hash of a course name. Same course, same rough, forever. */
function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
}

// Ordered outward from the fairway. The last entry is what the wide miss
// finds, and what the hole's background becomes.
const PROFILES = {
    // Augusta has no rough to speak of — one cut, everywhere.
    manicured:  ['LIGHT_ROUGH'],
    classic:    ['LIGHT_ROUGH', 'MEDIUM_ROUGH'],
    penal:      ['MEDIUM_ROUGH', 'THICK_ROUGH'],
    stepped:    ['LIGHT_ROUGH', 'MEDIUM_ROUGH', 'THICK_ROUGH'],
    // A links course goes from fairway to fescue with very little in between.
    links:      ['LIGHT_ROUGH', 'NATIVE_AREA'],
    wild:       ['MEDIUM_ROUGH', 'NATIVE_AREA'],
    severe:     ['LIGHT_ROUGH', 'THICK_ROUGH'],
};

// Matched against the course name, case-insensitively, first hit wins.
const NAMED = [
    [/augusta/i,                 'manicured'],
    [/bethpage|oakmont|winged/i, 'penal'],
    [/carnoustie/i,              'penal'],
    [/valderrama/i,              'severe'],
    [/pebble|sawgrass/i,         'classic'],
    [/st andrews|muirfield/i,    'links'],
    [/lofoten|sauda|stord|stiklestad|hvide|byneset|stj/i, 'links'],
];

// What an unnamed course can roll. Weighted by repetition: most club courses
// are a gentle two-step, a few are genuinely nasty.
const ROLLABLE = ['classic', 'classic', 'stepped', 'severe', 'penal', 'links', 'wild'];

/**
 * The rough grades for a course, ordered outward from the fairway.
 * @param courseName e.g. "Augusta National"
 */
export function roughProfileFor(courseName) {
    const name = courseName || '';
    for (const [re, key] of NAMED) if (re.test(name)) return PROFILES[key].slice();
    return PROFILES[ROLLABLE[Math.floor(hash(name) * ROLLABLE.length)]].slice();
}

/**
 * What a wide miss finds — the outermost grade in the profile.
 *
 * Every imported hole used to declare its background OUT_OF_BOUNDS, so missing
 * by 55 m on ANY hole in the game was a penalty stroke, on ground the DEM
 * still describes. Real courses put trees, fescue and heavy rough out there
 * and reserve the white stakes for the property line.
 */
export function outerRoughFor(courseName) {
    const p = roughProfileFor(courseName);
    return p[p.length - 1];
}

/** For tests and tooling: the profile name a course resolves to. */
export function roughProfileName(courseName) {
    const name = courseName || '';
    for (const [re, key] of NAMED) if (re.test(name)) return key;
    return ROLLABLE[Math.floor(hash(name) * ROLLABLE.length)];
}
