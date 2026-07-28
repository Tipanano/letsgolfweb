// tools/course-atlas.mjs
//
// Top-down QA atlas: renders every hole of one or more course JSONs as an
// SVG contact sheet so layout bugs (flag off the green, water in the wrong
// place, fairway on the neighboring hole) show up at a glance.
//
//   node tools/course-atlas.mjs courses/*.json > atlas.html
//
// Open atlas.html in a browser, or screenshot it headlessly.

import { readFileSync } from 'fs';

const COLORS = {
    lightRough: '#2c5e2e',
    rough: '#2c5e2e',
    fairway: '#4c9a4f',
    green: '#7ed07e',
    bunker: '#e3d6a4',
    water: '#5d97c9',
    tee: '#8fd08f',
};

function ptsOf(shape) {
    return shape?.controlPoints || shape?.vertices || [];
}

function poly(pts, fill, opacity = 1) {
    if (!pts || pts.length < 3) return '';
    const d = pts.map(p => `${p.x.toFixed(1)},${(-p.z).toFixed(1)}`).join(' ');
    return `<polygon points="${d}" fill="${fill}" fill-opacity="${opacity}"/>`;
}

function holeSVG(h, idx) {
    const shapes = [];
    const all = [];
    const collect = (arr) => (arr || []).forEach(s => { const p = ptsOf(s); if (p.length) all.push(...p); });
    collect(h.lightRough); collect(h.fairways); collect(h.greens);
    collect(h.bunkers); collect(h.waterHazards);
    if (h.tee?.vertices) all.push(...h.tee.vertices);
    const flag = h.flagPositions?.[0];
    if (flag) all.push(flag);
    if (!all.length) return '<div>empty</div>';

    const minX = Math.min(...all.map(p => p.x)) - 10, maxX = Math.max(...all.map(p => p.x)) + 10;
    const minZ = Math.min(...all.map(p => p.z)) - 10, maxZ = Math.max(...all.map(p => p.z)) + 10;

    (h.lightRough || []).forEach(s => shapes.push(poly(ptsOf(s), COLORS.lightRough)));
    (h.fairways || []).forEach(s => shapes.push(poly(ptsOf(s), COLORS.fairway)));
    (h.greens || []).forEach(s => shapes.push(poly(ptsOf(s), COLORS.green)));
    (h.bunkers || []).forEach(s => shapes.push(poly(ptsOf(s), COLORS.bunker)));
    (h.waterHazards || []).forEach(s => shapes.push(poly(ptsOf(s), COLORS.water, 0.9)));
    if (h.tee?.vertices) shapes.push(poly(h.tee.vertices, COLORS.tee));
    // Extra mapped tees as small markers
    (h.tees || []).forEach(t => {
        if (t.x !== undefined) shapes.push(`<circle cx="${t.x}" cy="${-t.z}" r="3" fill="#fff" fill-opacity="0.6"/>`);
    });
    // Trees as tiny dots so forest holes read as forests
    (h.obstacles || []).forEach(o => {
        shapes.push(`<circle cx="${o.x}" cy="${-o.z}" r="1.2" fill="#123c14"/>`);
    });
    if (flag) {
        shapes.push(`<circle cx="${flag.x}" cy="${-flag.z}" r="6" fill="none" stroke="#ff3333" stroke-width="2.5"/>`);
        shapes.push(`<circle cx="${flag.x}" cy="${-flag.z}" r="1.5" fill="#ff3333"/>`);
    }
    // Origin (hole-line start / forward tee) marker
    shapes.push(`<rect x="-4" y="-4" width="8" height="8" fill="#ffd76a"/>`);

    const w = maxX - minX, hgt = maxZ - minZ;
    const grid = h.terrainFeatures?.find(t => t.type === 'grid');
    const relief = grid ? `${Math.min(...grid.heights).toFixed(0)}..${Math.max(...grid.heights).toFixed(0)}m` : 'flat';
    return `<div class="hole">
      <div class="label">${idx + 1}. ${h.name || ''} — par ${h.par}, ${h.lengthMeters}m, ${relief}${h.waterHazards?.length ? ', ' + h.waterHazards.length + 'w' : ''}</div>
      <svg viewBox="${minX} ${-maxZ} ${w} ${hgt}" preserveAspectRatio="xMidYMid meet">${shapes.join('')}</svg>
    </div>`;
}

let html = `<meta charset="utf-8"><style>
  body { background: #0d1f10; color: #eee; font: 13px system-ui; margin: 16px; }
  h2 { margin: 24px 0 8px; }
  .course { display: flex; flex-wrap: wrap; gap: 10px; }
  .hole { width: 240px; background: #16301f; border-radius: 8px; padding: 6px; }
  .hole svg { width: 100%; height: 300px; background: #1d3a24; border-radius: 4px; }
  .label { font-size: 11px; margin-bottom: 4px; opacity: 0.85; }
</style>`;

for (const file of process.argv.slice(2)) {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    html += `<h2>${c.name} — par ${c.par}</h2><div class="course">`;
    c.holes.forEach((h, i) => { html += holeSVG(h, i); });
    html += '</div>';
}
process.stdout.write(html);
