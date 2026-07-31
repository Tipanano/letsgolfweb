// src/courseLibrary.js
//
// The bundled course library: manifest of static course files (imported from
// OpenStreetMap via tools/osm-import.mjs) plus a cached loader and the
// difficulty heuristic shared by every course UI.

export const BUNDLED_COURSES = [
    { file: 'courses/asker.json' },
    { file: 'courses/augusta-national.json' },
    { file: 'courses/bethpage.json' },
    { file: 'courses/byneset.json' },
    { file: 'courses/carnoustie-championship.json' },
    { file: 'courses/drobak.json' },
    { file: 'courses/hevingen.json' },
    { file: 'courses/muirfield.json' },
    { file: 'courses/oakmont.json' },
    { file: 'courses/pebble-beach.json' },
    { file: 'courses/sauda.json' },
    { file: 'courses/st-andrews.json' },
    { file: 'courses/stjordal.json' },
    { file: 'courses/stord.json' },
    { file: 'courses/tonsberg.json' },
    { file: 'courses/tpc-sawgrass.json' },
    { file: 'courses/valderrama.json' },
    { file: 'courses/winged-foot.json' },
];

const cache = new Map();

export async function loadCourse(file) {
    let course = cache.get(file);
    if (!course) {
        const res = await fetch(file);
        if (!res.ok) throw new Error(`Failed to fetch ${file}: ${res.status}`);
        course = await res.json();
        cache.set(file, course);
    }
    return course;
}

/** Difficulty stars (1-5): mostly length, salted with bunker density. */
export function difficultyStars(course) {
    const totalLen = course.holes.reduce((s, h) => s + (h.lengthMeters || 0), 0);
    const bunkers = course.holes.reduce((s, h) => s + (h.bunkers?.length || 0), 0);
    const score = totalLen + bunkers * 8;
    if (score < 4800) return 1;
    if (score < 5600) return 2;
    if (score < 6400) return 3;
    if (score < 7200) return 4;
    return 5;
}

export function courseStats(course) {
    return {
        totalLen: course.holes.reduce((s, h) => s + (h.lengthMeters || 0), 0),
        bunkers: course.holes.reduce((s, h) => s + (h.bunkers?.length || 0), 0),
        water: course.holes.reduce((s, h) => s + (h.waterHazards?.length || 0), 0),
        stars: difficultyStars(course),
    };
}
