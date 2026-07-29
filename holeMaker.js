// holeMaker.js — Hole Tuner: top-down SVG editor for bundled courses.
//
// Design notes:
//  - Works in TRUE METER coordinates (x right, z downrange; svg y = -z so the
//    hole runs up the screen). No canvas-size metadata, negative x is fine.
//  - Edits the course-format hole object IN PLACE — fields the editor doesn't
//    understand (terrainFeatures elevation grids, tees, attribution…) survive
//    a load/save round-trip untouched.
//  - Elevation underlay is sampled from the game's own terrain module, so
//    what you see is exactly what the game will build.

import { BUNDLED_COURSES, loadCourse } from './src/courseLibrary.js';
import { setTerrainFromLayout, heightAt, hasContour } from './src/greenContours.js';

const SURFACE_DEFS = [
    { key: 'lightRough',   pts: 'vertices',      color: '#2c5e2e', label: 'Rough',   surface: 'LIGHT_ROUGH' },
    { key: 'fairways',     pts: 'controlPoints', color: '#4c9a4f', label: 'Fairway', surface: 'FAIRWAY' },
    { key: 'greens',       pts: 'controlPoints', color: '#7ed07e', label: 'Green',   surface: 'GREEN' },
    { key: 'bunkers',      pts: 'controlPoints', color: '#e3d6a4', label: 'Bunker',  surface: 'BUNKER' },
    { key: 'waterHazards', pts: 'controlPoints', color: '#5d97c9', label: 'Water',   surface: 'WATER' },
];
const defFor = (key) => SURFACE_DEFS.find(d => d.key === key);
const ptsOf = (skey, shape) => shape[defFor(skey).pts] || shape.controlPoints || shape.vertices || [];

const svg = document.getElementById('editor');
const NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);

const S = {
    courseFile: null, course: null, holeIndex: -1,
    hole: null, original: null,
    sel: null, selVertex: -1,
    draw: null,
    view: { x: -100, y: -550, w: 220, h: 600 },
    undo: [], redo: [],
    elevOn: true,
    elevImage: null, // { href, x, y, w, h }
};

// ---------- helpers ----------
const setStatus = (t) => { $('status').textContent = t; };
const deep = (o) => JSON.parse(JSON.stringify(o));
const round2 = (v) => Math.round(v * 100) / 100;

function snapshot() {
    S.undo.push(JSON.stringify(S.hole));
    if (S.undo.length > 60) S.undo.shift();
    S.redo.length = 0;
}
function undo() {
    if (!S.undo.length) return;
    S.redo.push(JSON.stringify(S.hole));
    S.hole = JSON.parse(S.undo.pop());
    S.sel = null; S.selVertex = -1;
    syncInputs(); render();
}
function redo() {
    if (!S.redo.length) return;
    S.undo.push(JSON.stringify(S.hole));
    S.hole = JSON.parse(S.redo.pop());
    S.sel = null; S.selVertex = -1;
    syncInputs(); render();
}

function svgPointFromEvent(e) {
    const pt = new DOMPoint(e.clientX, e.clientY);
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, z: -p.y };
}
const pxScale = () => S.view.w / svg.clientWidth; // meters per screen px (approx)

function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
}

// ---------- hole geometry access ----------
function forEachPoly(fn) {
    for (const d of SURFACE_DEFS) {
        const arr = S.hole[d.key];
        if (!Array.isArray(arr)) continue;
        arr.forEach((shape, i) => fn(d, shape, i, ptsOf(d.key, shape)));
    }
}

function holeBounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const eat = (p) => {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    };
    forEachPoly((d, s, i, pts) => pts.forEach(eat));
    (S.hole.flagPositions || []).forEach(eat);
    (S.hole.obstacles || []).forEach(eat);
    if (S.hole.tee?.center) eat(S.hole.tee.center);
    if (!isFinite(minX)) { minX = -80; maxX = 80; minZ = 0; maxZ = 400; }
    return { minX, maxX, minZ, maxZ };
}

// ---------- elevation underlay ----------
function buildElevationImage() {
    S.elevImage = null;
    // Terrain field exactly as the game builds it (depressions need vertices)
    const adapted = {
        ...S.hole,
        waterHazards: (S.hole.waterHazards || []).map(w => ({ vertices: w.controlPoints || w.vertices })),
        bunkers: (S.hole.bunkers || []).map(b => ({ vertices: b.controlPoints || b.vertices })),
    };
    setTerrainFromLayout(adapted);
    if (!hasContour()) return;

    const b = holeBounds();
    const pad = 25;
    const x0 = Math.floor(b.minX - pad), z0 = Math.floor(b.minZ - pad);
    const w = Math.ceil(b.maxX + pad) - x0, h = Math.ceil(b.maxZ + pad) - z0;
    if (w <= 0 || h <= 0 || w * h > 1200 * 1200) return;

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const H = new Float32Array((w + 1) * (h + 1));
    for (let j = 0; j <= h; j++)
        for (let i = 0; i <= w; i++) H[j * (w + 1) + i] = heightAt(x0 + i, z0 + j);

    const CONTOUR = 2; // meters between contour lines
    for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
            const hv = H[j * (w + 1) + i];
            const dhx = H[j * (w + 1) + i + 1] - hv;
            const dhz = H[(j + 1) * (w + 1) + i] - hv;
            // Hillshade: light from the northwest
            const shade = Math.max(0, Math.min(1, 0.5 - dhx * 0.9 - dhz * 0.9));
            const band = Math.floor(hv / CONTOUR);
            const isLine = band !== Math.floor(H[j * (w + 1) + i + 1] / CONTOUR)
                        || band !== Math.floor(H[(j + 1) * (w + 1) + i] / CONTOUR);
            const o = (j * w + i) * 4;
            if (isLine) {
                img.data[o] = 20; img.data[o + 1] = 32; img.data[o + 2] = 22; img.data[o + 3] = 165;
            } else {
                img.data[o] = 40 + shade * 70;
                img.data[o + 1] = 74 + shade * 80;
                img.data[o + 2] = 46 + shade * 66;
                img.data[o + 3] = 255;
            }
        }
    }
    ctx.putImageData(img, 0, 0);
    // svg y = -z: image top edge is at the FAR end (maxZ)
    S.elevImage = { href: canvas.toDataURL(), x: x0, y: -(z0 + h), w, h };
}

// ---------- rendering ----------
function render() {
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `${S.view.x} ${S.view.y} ${S.view.w} ${S.view.h}`);

    const gElev = el('g', {}, svg);
    const gSurf = el('g', {}, svg);
    const gMark = el('g', {}, svg);
    const gHandles = el('g', {}, svg);
    const gDraw = el('g', {}, svg);

    if (S.elevOn && S.elevImage) {
        el('image', {
            href: S.elevImage.href, x: S.elevImage.x, y: S.elevImage.y,
            width: S.elevImage.w, height: S.elevImage.h,
            preserveAspectRatio: 'none', style: 'image-rendering: pixelated',
        }, gElev);
    }

    // Surfaces (rough under fairway under green under bunker/water)
    forEachPoly((d, shape, idx, pts) => {
        if (pts.length < 3) return;
        const sel = S.sel?.kind === 'poly' && S.sel.skey === d.key && S.sel.idx === idx;
        const path = el('polygon', {
            points: pts.map(p => `${p.x},${-p.z}`).join(' '),
            fill: d.color, 'fill-opacity': S.elevOn && S.elevImage ? 0.78 : 0.96,
            stroke: sel ? '#fff' : 'rgba(0,0,0,0.25)',
            'stroke-width': sel ? 2 : 1, 'vector-effect': 'non-scaling-stroke',
            style: 'cursor: move',
        }, gSurf);
        path.dataset.kind = 'poly'; path.dataset.skey = d.key; path.dataset.idx = idx;
    });

    // Extra tee markers (back/forward tees from OSM)
    (S.hole.tees || []).forEach(t => {
        if (t.x === undefined) return;
        el('circle', { cx: t.x, cy: -t.z, r: 2.2, fill: 'rgba(255,255,255,0.45)' }, gMark);
    });

    // Tee box
    if (S.hole.tee?.center) {
        const t = S.hole.tee, c = t.center;
        const w = t.width || 6, dpt = t.depth || 4;
        const sel = S.sel?.kind === 'tee';
        const r = el('rect', {
            x: c.x - w / 2, y: -c.z - dpt / 2, width: w, height: dpt,
            fill: '#8fd08f', stroke: sel ? '#fff' : '#26522a',
            'stroke-width': sel ? 2 : 1, 'vector-effect': 'non-scaling-stroke',
            style: 'cursor: move',
        }, gMark);
        r.dataset.kind = 'tee';
    }

    // Trees
    (S.hole.obstacles || []).forEach((o, i) => {
        const sel = S.sel?.kind === 'tree' && S.sel.idx === i;
        const c = el('circle', {
            cx: o.x, cy: -o.z, r: o.size === 'large' ? 3 : o.size === 'small' ? 1.6 : 2.3,
            fill: sel ? '#7dffa0' : '#123c14', stroke: 'rgba(0,0,0,0.4)',
            'stroke-width': 1, 'vector-effect': 'non-scaling-stroke',
            style: 'cursor: move',
        }, gMark);
        c.dataset.kind = 'tree'; c.dataset.idx = i;
    });

    // Flags
    (S.hole.flagPositions || []).forEach((f, i) => {
        const sel = S.sel?.kind === 'flag' && S.sel.idx === i;
        const g = el('g', { style: 'cursor: move' }, gMark);
        el('circle', { cx: f.x, cy: -f.z, r: 5, fill: 'none', stroke: sel ? '#fff' : '#ff3333', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, g);
        el('circle', { cx: f.x, cy: -f.z, r: 1.4, fill: '#ff3333' }, g);
        for (const n of g.children) { n.dataset.kind = 'flag'; n.dataset.idx = i; }
    });

    // Vertex handles for selected polygon
    if (S.sel?.kind === 'poly') {
        const shape = S.hole[S.sel.skey]?.[S.sel.idx];
        if (shape) {
            const r = Math.max(1.2, 4 * pxScale());
            ptsOf(S.sel.skey, shape).forEach((p, vi) => {
                const c = el('circle', {
                    cx: p.x, cy: -p.z, r,
                    fill: vi === S.selVertex ? '#7dffa0' : '#fff',
                    stroke: '#10241a', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke',
                    style: 'cursor: pointer',
                }, gHandles);
                c.dataset.kind = 'vertex'; c.dataset.vidx = vi;
            });
        }
    }

    // In-progress drawing
    if (S.draw && S.draw.points.length) {
        const d = defFor(S.draw.skey);
        el('polyline', {
            points: S.draw.points.map(p => `${p.x},${-p.z}`).join(' '),
            fill: 'none', stroke: d.color, 'stroke-width': 2,
            'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '5 4',
        }, gDraw);
        S.draw.points.forEach(p => el('circle', { cx: p.x, cy: -p.z, r: Math.max(1, 3 * pxScale()), fill: d.color }, gDraw));
    }

    updateSelInfo();
}

function updateSelInfo() {
    const s = S.sel;
    let t = '';
    if (s?.kind === 'poly') t = `${defFor(s.skey).label} #${s.idx + 1} — ${ptsOf(s.skey, S.hole[s.skey][s.idx]).length} points`;
    else if (s?.kind === 'tree') t = `Tree #${s.idx + 1} (${S.hole.obstacles[s.idx].size})`;
    else if (s?.kind === 'flag') t = `Flag #${s.idx + 1}`;
    else if (s?.kind === 'tee') t = 'Tee box';
    $('selInfo').textContent = t;
}

function fitView() {
    const b = holeBounds();
    const pad = 30;
    const w = (b.maxX - b.minX) + pad * 2, h = (b.maxZ - b.minZ) + pad * 2;
    const ar = svg.clientWidth / svg.clientHeight;
    let vw = w, vh = h;
    if (vw / vh < ar) vw = vh * ar; else vh = vw / ar;
    S.view = { x: (b.minX + b.maxX) / 2 - vw / 2, y: -(b.minZ + b.maxZ) / 2 - vh / 2, w: vw, h: vh };
    render();
}

// ---------- loading / saving ----------
async function populateCourses() {
    const sel = $('courseSelect');
    sel.innerHTML = '';
    for (const entry of BUNDLED_COURSES) {
        const opt = document.createElement('option');
        opt.value = entry.file;
        opt.textContent = entry.file.replace('courses/', '').replace('.json', '');
        sel.appendChild(opt);
    }
    // Nicer names, async
    for (const entry of BUNDLED_COURSES) {
        try {
            const c = await loadCourse(entry.file);
            const opt = [...sel.options].find(o => o.value === entry.file);
            if (opt) opt.textContent = c.name;
        } catch { /* keep filename */ }
    }
}

async function loadHole(file, index) {
    const course = await loadCourse(file);
    S.courseFile = file; S.course = course; S.holeIndex = index;
    S.hole = deep(course.holes[index]);
    S.original = deep(course.holes[index]);
    S.undo.length = 0; S.redo.length = 0;
    S.sel = null; S.selVertex = -1; S.draw = null;
    syncInputs();
    buildElevationImage();
    buildHoleGrid();
    fitView();
    setStatus(`${course.name} — hole ${index + 1} loaded. ${course.holes[index].terrainFeatures?.some(t => t.type === 'grid') ? 'Elevation grid present.' : 'No elevation data.'}`);
}

function syncInputs() {
    $('holeName').value = S.hole?.name || '';
    $('holePar').value = S.hole?.par || 4;
}

function buildHoleGrid() {
    const grid = $('holeGrid');
    grid.innerHTML = '';
    (S.course?.holes || []).forEach((h, i) => {
        const b = document.createElement('button');
        b.textContent = i + 1;
        if (i === S.holeIndex) b.classList.add('current');
        b.addEventListener('click', () => confirmLoseEdits() && loadHole(S.courseFile, i));
        grid.appendChild(b);
    });
}

const isDirty = () => S.undo.length > 0;
const confirmLoseEdits = () => !isDirty() || confirm('Discard unsaved edits to this hole?');

function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
}

function commitInputsToHole() {
    S.hole.name = $('holeName').value || S.hole.name;
    S.hole.par = parseInt($('holePar').value, 10) || S.hole.par;
}

function downloadCourse() {
    if (!S.course) return;
    commitInputsToHole();
    const course = deep(S.course);
    course.holes[S.holeIndex] = deep(S.hole);
    download(S.courseFile.replace('courses/', ''), JSON.stringify(course));
    setStatus(`Downloaded ${S.courseFile.replace('courses/', '')} — drop it into courses/ to apply.`);
}

function downloadHole() {
    commitInputsToHole();
    download((S.hole.name || 'hole').toLowerCase().replace(/\s+/g, '-') + '.json', JSON.stringify(S.hole, null, 2));
}

function previewInGame() {
    commitInputsToHole();
    const data = deep(S.hole);
    data.courseName = S.course?.name;
    localStorage.setItem('previewHoleData', JSON.stringify(data));
    window.open('index.html', '_blank');
    setStatus('Preview opened in a new tab.');
}

// ---------- interaction ----------
let drag = null; // { type, moved, start:{x,z}, orig..., }

svg.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const p = svgPointFromEvent(e);
    const t = e.target;

    if (S.draw) {
        S.draw.points.push({ x: round2(p.x), z: round2(p.z) });
        render();
        return;
    }

    const kind = t.dataset?.kind;
    if (kind === 'vertex') {
        S.selVertex = +t.dataset.vidx;
        snapshot();
        drag = { type: 'vertex', start: p, moved: false };
    } else if (kind === 'poly') {
        const same = S.sel?.kind === 'poly' && S.sel.skey === t.dataset.skey && S.sel.idx === +t.dataset.idx;
        S.sel = { kind: 'poly', skey: t.dataset.skey, idx: +t.dataset.idx };
        if (!same) S.selVertex = -1;
        snapshot();
        const pts = ptsOf(S.sel.skey, S.hole[S.sel.skey][S.sel.idx]);
        drag = { type: 'poly', start: p, orig: deep(pts), moved: false };
    } else if (kind === 'tree') {
        S.sel = { kind: 'tree', idx: +t.dataset.idx };
        snapshot();
        drag = { type: 'tree', start: p, orig: { ...S.hole.obstacles[+t.dataset.idx] }, moved: false };
    } else if (kind === 'flag') {
        S.sel = { kind: 'flag', idx: +t.dataset.idx };
        snapshot();
        drag = { type: 'flag', start: p, orig: { ...S.hole.flagPositions[+t.dataset.idx] }, moved: false };
    } else if (kind === 'tee') {
        S.sel = { kind: 'tee' };
        snapshot();
        drag = { type: 'tee', start: p, orig: deep(S.hole.tee.center), moved: false };
    } else {
        drag = { type: 'pan', startClient: { x: e.clientX, y: e.clientY }, origView: { ...S.view }, moved: false };
        svg.classList.add('panning');
    }
    render();
});

window.addEventListener('mousemove', (e) => {
    if (!drag) {
        const p = svgPointFromEvent(e);
        const elev = hasContour() ? ` · elev ${heightAt(p.x, p.z).toFixed(1)}m` : '';
        $('hud').textContent = `${p.x.toFixed(1)}, ${p.z.toFixed(1)}${elev}`;
        return;
    }
    if (drag.type === 'pan') {
        const mPerPx = S.view.w / svg.clientWidth;
        S.view.x = drag.origView.x - (e.clientX - drag.startClient.x) * mPerPx;
        S.view.y = drag.origView.y - (e.clientY - drag.startClient.y) * mPerPx;
        drag.moved = true;
        render();
        return;
    }
    const p = svgPointFromEvent(e);
    const dx = p.x - drag.start.x, dz = p.z - drag.start.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.05) drag.moved = true;

    if (drag.type === 'vertex' && S.sel?.kind === 'poly') {
        const pts = ptsOf(S.sel.skey, S.hole[S.sel.skey][S.sel.idx]);
        if (pts[S.selVertex]) { pts[S.selVertex].x = round2(p.x); pts[S.selVertex].z = round2(p.z); }
    } else if (drag.type === 'poly' && S.sel?.kind === 'poly') {
        const pts = ptsOf(S.sel.skey, S.hole[S.sel.skey][S.sel.idx]);
        pts.forEach((pt, i) => { pt.x = round2(drag.orig[i].x + dx); pt.z = round2(drag.orig[i].z + dz); });
    } else if (drag.type === 'tree') {
        const o = S.hole.obstacles[S.sel.idx];
        o.x = round2(drag.orig.x + dx); o.z = round2(drag.orig.z + dz);
    } else if (drag.type === 'flag') {
        const f = S.hole.flagPositions[S.sel.idx];
        f.x = round2(drag.orig.x + dx); f.z = round2(drag.orig.z + dz);
    } else if (drag.type === 'tee') {
        S.hole.tee.center.x = round2(drag.orig.x + dx);
        S.hole.tee.center.z = round2(drag.orig.z + dz);
    }
    render();
});

window.addEventListener('mouseup', () => {
    if (!drag) return;
    svg.classList.remove('panning');
    const wasClickOnEmpty = drag.type === 'pan' && !drag.moved;
    // A drag that never moved shouldn't burn an undo slot
    if (drag.type !== 'pan' && !drag.moved && S.undo.length) S.undo.pop();
    drag = null;
    if (wasClickOnEmpty) { S.sel = null; S.selVertex = -1; render(); }
});

svg.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (S.draw) { commitDraw(); return; }
    // Insert vertex on the selected polygon's nearest edge
    if (S.sel?.kind !== 'poly') return;
    const p = svgPointFromEvent(e);
    const pts = ptsOf(S.sel.skey, S.hole[S.sel.skey][S.sel.idx]);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const abx = b.x - a.x, abz = b.z - a.z;
        const L = abx * abx + abz * abz;
        const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / L)) : 0;
        const d = Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
        if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && bestD < 12 * pxScale() + 2) {
        snapshot();
        pts.splice(best + 1, 0, { x: round2(p.x), z: round2(p.z) });
        S.selVertex = best + 1;
        render();
    }
});

svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    const rect = svg.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height;
    const nw = Math.max(20, Math.min(3000, S.view.w * factor));
    const nh = S.view.h * (nw / S.view.w);
    S.view.x += (S.view.w - nw) * fx;
    S.view.y += (S.view.h - nh) * fy;
    S.view.w = nw; S.view.h = nh;
    render();
}, { passive: false });

function commitDraw() {
    if (!S.draw) return;
    if (S.draw.points.length >= 3) {
        const d = defFor(S.draw.skey);
        snapshot();
        if (!Array.isArray(S.hole[d.key])) S.hole[d.key] = [];
        const shape = { surface: d.surface };
        shape[d.pts] = S.draw.points;
        S.hole[d.key].push(shape);
        S.sel = { kind: 'poly', skey: d.key, idx: S.hole[d.key].length - 1 };
        setStatus(`${d.label} added (${S.draw.points.length} points).`);
    }
    S.draw = null;
    svg.classList.remove('drawing');
    document.querySelectorAll('#drawTools button').forEach(b => b.classList.remove('active'));
    render();
}

function deleteSelection() {
    const s = S.sel;
    if (!s) return;
    snapshot();
    if (s.kind === 'poly') {
        const pts = ptsOf(s.skey, S.hole[s.skey][s.idx]);
        if (S.selVertex >= 0 && pts.length > 3) {
            pts.splice(S.selVertex, 1);
            S.selVertex = -1;
        } else {
            S.hole[s.skey].splice(s.idx, 1);
            S.sel = null; S.selVertex = -1;
        }
    } else if (s.kind === 'tree') {
        S.hole.obstacles.splice(s.idx, 1);
        S.sel = null;
    } else if (s.kind === 'flag') {
        if ((S.hole.flagPositions || []).length > 1) {
            S.hole.flagPositions.splice(s.idx, 1);
            S.sel = null;
        } else {
            S.undo.pop();
            setStatus('A hole needs at least one flag.');
        }
    }
    render();
}

window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (e.key === 'Escape') {
        if (S.draw) { S.draw = null; svg.classList.remove('drawing'); document.querySelectorAll('#drawTools button').forEach(b => b.classList.remove('active')); }
        else { S.sel = null; S.selVertex = -1; }
        render();
    }
    if (e.key === 'Enter' && S.draw) commitDraw();
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
});

// ---------- UI wiring ----------
function buildDrawTools() {
    const wrap = $('drawTools');
    for (const d of SURFACE_DEFS) {
        const b = document.createElement('button');
        b.innerHTML = `<span class="swatch" style="background:${d.color}"></span>${d.label}`;
        b.addEventListener('click', () => {
            const active = S.draw?.skey === d.key;
            S.draw = active ? null : { skey: d.key, points: [] };
            document.querySelectorAll('#drawTools button').forEach(x => x.classList.remove('active'));
            svg.classList.toggle('drawing', !!S.draw);
            if (S.draw) { b.classList.add('active'); setStatus(`Drawing ${d.label}: click points, Enter closes, Esc cancels.`); }
            render();
        });
        wrap.appendChild(b);
    }
    const tree = document.createElement('button');
    tree.innerHTML = '<span class="swatch" style="background:#123c14"></span>Tree';
    tree.addEventListener('click', () => {
        setStatus('Click to place a tree (Esc to stop).');
        const place = (e) => {
            const p = svgPointFromEvent(e);
            snapshot();
            if (!Array.isArray(S.hole.obstacles)) S.hole.obstacles = [];
            S.hole.obstacles.push({ type: 'tree', size: 'medium', x: round2(p.x), z: round2(p.z) });
            render();
        };
        const stop = (e) => {
            if (e.key === 'Escape') { svg.removeEventListener('mousedown', place, true); window.removeEventListener('keydown', stop); setStatus(''); }
        };
        svg.addEventListener('mousedown', place, true);
        window.addEventListener('keydown', stop);
    });
    wrap.appendChild(tree);
}

$('courseSelect').addEventListener('change', (e) => {
    if (confirmLoseEdits()) loadHole(e.target.value, 0);
    else e.target.value = S.courseFile;
});
$('fitView').addEventListener('click', fitView);
$('toggleElev').addEventListener('click', () => {
    S.elevOn = !S.elevOn;
    $('toggleElev').textContent = `Elevation: ${S.elevOn ? 'on' : 'off'}`;
    render();
});
$('previewBtn').addEventListener('click', previewInGame);
$('downloadCourseBtn').addEventListener('click', downloadCourse);
$('downloadHoleBtn').addEventListener('click', downloadHole);
$('revertBtn').addEventListener('click', () => {
    if (!confirm('Revert all edits to this hole?')) return;
    S.hole = deep(S.original);
    S.undo.length = 0; S.redo.length = 0;
    S.sel = null; S.selVertex = -1;
    syncInputs(); buildElevationImage(); render();
});
$('holeName').addEventListener('change', () => { snapshot(); commitInputsToHole(); });
$('holePar').addEventListener('change', () => { snapshot(); commitInputsToHole(); });
window.addEventListener('resize', render);
window.addEventListener('beforeunload', (e) => { if (isDirty()) e.preventDefault(); });

// ---------- boot ----------
await populateCourses();
await loadHole(BUNDLED_COURSES[0].file, 0);
buildDrawTools();
