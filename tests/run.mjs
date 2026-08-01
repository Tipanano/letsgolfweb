// Test runner: everything, in parallel, with a timing table.
//
// The suites are standalone scripts and each one launches its own Chromium.
// Run serially that is a long wait dominated by browser startup, not by the
// assertions, and a wait that long stops being run after "minor" changes —
// which is exactly when a regression slips through. So: units first (they are
// seconds and catch most things), then the browser suites concurrently.
//
//   node tests/run.mjs              every suite
//   node tests/run.mjs --quick      units + the fast browser suites
//   node tests/run.mjs --units      units only
//   node tests/run.mjs aim chip     only suites whose name matches
//   node tests/run.mjs --jobs 2     override concurrency
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

// Long sweeps over the whole course library, plus the timing-sensitive set —
// worth running, not worth running on every save. --quick leaves them out.
const SLOW = new Set([
    'browser-smoke-greens',      // renders all 18 Augusta holes: ~390 s
    ...TIMING_SENSITIVE,         // ~330 s and only reliable serially
]);

const name = (f) => f.replace(/\.mjs$/, '');
const all = readdirSync('tests').filter(f => f.endsWith('.mjs') && f !== 'run.mjs');
const wanted = (f) => !patterns.length || patterns.some(p => f.includes(p));

let units = all.filter(f => f.startsWith('unit-')).filter(wanted).sort();
let browsers = all.filter(f => f.startsWith('browser-smoke-')).filter(wanted).sort();
if (flag('--units')) browsers = [];
if (flag('--quick')) browsers = browsers.filter(f => !SLOW.has(name(f)));

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
