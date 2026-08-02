// Test runner: everything, in parallel, with a timing table.
//
// The suites are standalone scripts and each one launches its own Chromium.
// Run serially that is a long wait dominated by browser startup, not by the
// assertions, and a wait that long stops being run after "minor" changes —
// which is exactly when a regression slips through. So: units first (they are
// seconds and catch most things), then the browser suites concurrently.
//
//   node tests/run.mjs              every suite            ~16 min
//   node tests/run.mjs --changed    suites the diff can break  ~1-3 min
//   node tests/run.mjs --quick      everything but the sweeps  ~6 min
//   node tests/run.mjs --units      units only             ~40 s
//   node tests/run.mjs aim chip     only suites whose name matches
//   node tests/run.mjs --jobs 2     override concurrency
//   node tests/run.mjs --changed --list   what WOULD run, without running it
//
// WHEN TO RUN WHAT
//
// The full run is 16 minutes and one suite — backdrop, which raycasts a 1600 m
// mesh across four holes — is a third of it. Waiting on all of that before
// every push means the change cannot be tried on a phone for a quarter of an
// hour, so the rule is graded by what the diff can actually reach:
//
//   ALWAYS, before any push:      --units. 40 seconds, and they own the
//                                 terrain field, the surface lookup, the
//                                 scoring and the course library.
//   Then --changed:               the suites mapped to the files you touched.
//   PUSH, then --changed full:    for CSS/HTML/copy/test-only diffs, push
//                                 first and let the long run verify behind
//                                 you. Nothing in a stylesheet can silently
//                                 corrupt a course file.
//   FULL RUN BEFORE PUSH:         physics, terrain, the importer, the swing
//                                 state machine, anything under courses/.
//                                 These regress silently and numerically —
//                                 a green screenshot proves nothing.
//
// The map below is deliberately generous: an unrecognised path runs
// everything, because the failure mode of guessing wrong is a regression
// shipped, and the failure mode of guessing wide is a few spare minutes.
//
// Exit code is non-zero if anything failed.
import { readdirSync } from 'fs';
import { spawn, execSync } from 'child_process';
import { cpus } from 'os';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const optIdx = argv.indexOf('--jobs');
const JOBS = optIdx !== -1 ? Math.max(1, parseInt(argv[optIdx + 1], 10)) : Math.max(1, Math.min(4, cpus().length - 1));
const patterns = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--jobs');

// These drive the swing by tapping in real time, so they need the wall clock
// to mean something. Run four browsers at once on a four-core box and the
// taps miss their windows: chip, putt and touch all fail under load and all
// three pass when run alone. They go last, one at a time, never in the pool.
const TIMING_SENSITIVE = new Set([
    'browser-smoke-chip', 'browser-smoke-putt', 'browser-smoke-touch',
]);

// Long sweeps, plus the timing-sensitive set — worth running, not worth
// running on every save. --quick leaves them out. Measured, not guessed:
// backdrop is 530s of a 990s wall clock on its own.
const SLOW = new Set([
    ...TIMING_SENSITIVE,         // only reliable run serially, so they go last
    'browser-smoke-backdrop',    // 530s: raycasts the scenery mesh, 4 holes
    'browser-smoke-shotstart',   // 218s
    'browser-smoke-aim',         // 147s
    'browser-smoke-greencard',   // 124s
]);

// Which suites a change to a given path can actually break. Prefixes, longest
// match wins. A path that matches nothing runs EVERYTHING — see the header.
const TOUCHES = [
    // Terrain field, course data and the importer: the numeric-silent stuff.
    ['courses/',                   ['unit-', 'browser-smoke-backdrop', 'browser-smoke-greens']],
    ['tools/osm-import',           ['unit-']],
    ['src/greenContours.js',       ['unit-', 'browser-smoke-backdrop', 'browser-smoke-greens', 'browser-smoke-hazardlie']],
    ['src/holeLoader.js',          ['unit-', 'browser-smoke-greens', 'browser-smoke-hazardlie']],
    // Surface classification.
    ['src/fringe.js',              ['unit-fringe', 'unit-roughbands', 'browser-smoke-hazardlie', 'browser-smoke-chip']],
    ['src/roughBands.js',          ['unit-roughbands', 'unit-fringe', 'browser-smoke-hazardlie']],
    ['src/polygonEdge.js',         ['unit-fringe', 'unit-roughbands']],
    ['src/surfaceLookup.js',       ['unit-', 'browser-smoke-hazardlie', 'browser-smoke-sandbounce']],
    ['src/pointInPolygon.js',      ['unit-', 'browser-smoke-hazardlie']],
    ['src/courseRough.js',         ['unit-roughbands', 'unit-conditions']],
    ['src/waterDrop.js',           ['unit-waterdrop', 'browser-smoke-waterdrop']],
    // Ball flight and strike.
    ['src/swingPhysics.js',        ['browser-smoke-shotphysics', 'browser-smoke-bagmatrix', 'browser-smoke-fullbag', 'browser-smoke-chip', 'browser-smoke-practiceswing']],
    ['src/chipPhysics.js',         ['browser-smoke-chip', 'unit-pitch', 'browser-smoke-practiceswing']],
    ['src/rhythmPutt.js',          ['browser-smoke-putt', 'browser-smoke-chip', 'unit-pinslope']],
    ['src/gameLogic/simulation.js',['browser-smoke-shotphysics', 'browser-smoke-bagmatrix', 'browser-smoke-sandbounce', 'browser-smoke-waterdrop', 'unit-']],
    ['src/gameLogic/calculations.js', ['browser-smoke-shotphysics', 'browser-smoke-chip', 'browser-smoke-putt', 'browser-smoke-practiceswing']],
    ['src/gameLogic/actions.js',   ['browser-smoke-tapguard', 'browser-smoke-practiceswing', 'browser-smoke-waterdrop', 'browser-smoke-chip', 'browser-smoke-putt']],
    ['src/gameLogic/state.js',     ['browser-smoke-']],
    ['src/surfaces.js',            ['unit-', 'browser-smoke-shotphysics', 'browser-smoke-sandbounce', 'browser-smoke-chip']],
    ['src/clubs.js',               ['browser-smoke-fullbag', 'browser-smoke-bagmatrix']],
    ['src/practiceSwing.js',       ['browser-smoke-practiceswing']],
    // Presentation. Cannot reach a course file or a physics number.
    ['src/ui/practiceSwingCard.js',['browser-smoke-practiceswing']],
    ['src/ui/rhythmPuttHud.js',    ['browser-smoke-practiceswing', 'browser-smoke-putt', 'browser-smoke-chip', 'browser-smoke-touch']],
    ['src/touchControls.js',       ['browser-smoke-touch', 'browser-smoke-practiceswing']],
    ['src/ui.js',                  ['browser-smoke-touch', 'browser-smoke-practiceswing', 'browser-smoke-greencard', 'browser-smoke-career']],
    ['src/visuals/',               ['browser-smoke-backdrop', 'browser-smoke-flagshadow', 'browser-smoke-greens', 'browser-smoke-aim']],
    ['style.css',                  ['browser-smoke-touch', 'browser-smoke-practiceswing']],
    ['index.html',                 ['browser-smoke-touch', 'browser-smoke-practiceswing', 'browser-smoke-career']],
    // Career.
    ['src/career/',                ['unit-greencard', 'unit-handicap', 'unit-careersync', 'browser-smoke-career', 'browser-smoke-greencard']],
    ['src/careerModal.js',         ['browser-smoke-career', 'browser-smoke-greencard']],
];

/** Files changed against HEAD, including staged and untracked. */
function changedFiles() {
    const out = execSync('git status --porcelain=v1 --untracked-files=all').toString();
    return out.split('\n').map(l => l.slice(3).trim()).filter(Boolean)
        .concat(execSync('git diff --name-only HEAD').toString().split('\n').map(l => l.trim()).filter(Boolean));
}

/**
 * Suite-name prefixes a set of changed files can break, or null for "all".
 * A changed test file always runs itself, whatever else it maps to.
 */
function suitesForChange(files) {
    const want = new Set();
    for (const f of files) {
        if (f.startsWith('tests/') && f.endsWith('.mjs')) {
            if (f !== 'tests/run.mjs') want.add(name(f.replace('tests/', '')));
            continue;
        }
        if (/\.(md|txt|png|jpe?g|json5)$/i.test(f) || f.startsWith('.')) continue;
        const hit = TOUCHES.filter(([prefix]) => f.startsWith(prefix))
            .sort((a, b) => b[0].length - a[0].length)[0];
        if (!hit) return null;             // unknown path: run everything
        hit[1].forEach(p => want.add(p));
    }
    return want;
}

const name = (f) => f.replace(/\.mjs$/, '');
const all = readdirSync('tests').filter(f => f.endsWith('.mjs') && f !== 'run.mjs');
const wanted = (f) => !patterns.length || patterns.some(p => f.includes(p));

let units = all.filter(f => f.startsWith('unit-')).filter(wanted).sort();
let browsers = all.filter(f => f.startsWith('browser-smoke-')).filter(wanted).sort();
if (flag('--units')) browsers = [];
if (flag('--quick')) browsers = browsers.filter(f => !SLOW.has(name(f)));
if (flag('--changed')) {
    const files = changedFiles();
    const want = suitesForChange(files);
    if (!want) {
        console.log(`--changed: ${files.length} file(s) changed, including a path with no mapping — running everything`);
    } else if (!want.size) {
        console.log(`--changed: ${files.length} file(s) changed, none of which any suite covers`);
        units = []; browsers = [];
    } else {
        const keep = (f) => [...want].some(p => name(f) === p || name(f).startsWith(p));
        units = units.filter(keep);
        browsers = browsers.filter(keep);
        console.log(`--changed: ${files.length} file(s) → ${units.length} unit + ${browsers.length} browser suite(s)`);
    }
}

if (flag('--list')) {
    console.log([...units, ...browsers].map(name).join('\n') || '(nothing)');
    process.exit(0);
}

// The browser suites all fetch from a local static server.
if (browsers.length) {
    try {
        execSync('curl -sS -o /dev/null --max-time 3 http://localhost:8788/index.html');
    } catch {
        console.log('starting static server on :8788');
        spawn('python3', ['-m', 'http.server', '8788'], { detached: true, stdio: 'ignore' }).unref();
        execSync('sleep 2');
    }
}

const results = [];
function runOne(file) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const child = spawn('node', ['tests/' + file], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { err += d; });
        child.on('close', (code) => {
            const ms = Date.now() - t0;
            const lines = (out.trim() || err.trim()).split('\n');
            results.push({ file, ms, ok: code === 0, last: lines[lines.length - 1] || '(no output)', err: code === 0 ? '' : (out + err) });
            process.stdout.write(`${code === 0 ? '  ok  ' : ' FAIL '} ${name(file).padEnd(30)} ${String(ms).padStart(6)} ms\n`);
            resolve();
        });
    });
}

async function runPool(files, jobs) {
    const queue = [...files];
    const workers = Array.from({ length: Math.min(jobs, queue.length) }, async () => {
        while (queue.length) await runOne(queue.shift());
    });
    await Promise.all(workers);
}

const started = Date.now();
if (units.length) {
    console.log(`\nunit suites (${units.length}), ${JOBS} at a time`);
    await runPool(units, JOBS);
}
const serial = browsers.filter(f => TIMING_SENSITIVE.has(name(f)));
const parallel = browsers.filter(f => !TIMING_SENSITIVE.has(name(f)));
if (parallel.length) {
    console.log(`\nbrowser suites (${parallel.length}), ${JOBS} at a time`);
    await runPool(parallel, JOBS);
}
if (serial.length) {
    console.log(`\ntiming-sensitive suites (${serial.length}), one at a time`);
    await runPool(serial, 1);
}

const failed = results.filter(r => !r.ok);
const wall = ((Date.now() - started) / 1000).toFixed(1);
const work = (results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1);
console.log(`\n${results.length - failed.length}/${results.length} passed in ${wall}s wall (${work}s of work)`);
if (failed.length) {
    for (const f of failed) {
        console.log(`\n--- ${name(f.file)} ---`);
        console.log(f.err.trim().split('\n').slice(-15).join('\n'));
    }
    process.exit(1);
}
