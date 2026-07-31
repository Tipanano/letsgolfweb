// src/holeLoader.js
// Processes hole layout data from the Hole Maker tool
// Converts control points to vertices and maps surface types

import { SURFACES } from './surfaces.js';

/**
 * Merges vertices that are very close together (within threshold)
 * and averages their heights. This helps when multiple polygons share edges.
 * @param {object} layout - The hole layout with processed vertices
 * @param {number} threshold - Distance threshold in meters (default 0.1m = 10cm)
 */
function mergeSharedVertices(layout, threshold = 0.1) {
    // Collect all vertices from all surfaces
    const allVertices = [];
    const surfaceRefs = []; // Track which surface and index each vertex belongs to

    const collectVertices = (surface, surfaceName, surfaceIndex = null) => {
        if (surface?.vertices && Array.isArray(surface.vertices)) {
            surface.vertices.forEach((vertex, vIdx) => {
                allVertices.push(vertex);
                surfaceRefs.push({
                    surface,
                    vertexIndex: vIdx,
                    surfaceName,
                    surfaceIndex
                });
            });
        }
    };

    // Collect from all surface types
    collectVertices(layout.background, 'background');
    collectVertices(layout.tee, 'tee');

    if (layout.greens && Array.isArray(layout.greens)) {
        layout.greens.forEach((green, idx) => collectVertices(green, 'green', idx));
    }

    if (layout.fairways && Array.isArray(layout.fairways)) {
        layout.fairways.forEach((fw, idx) => collectVertices(fw, 'fairway', idx));
    }

    const roughTypes = ['lightRough', 'mediumRough', 'thickRough'];
    roughTypes.forEach(type => {
        if (layout[type] && Array.isArray(layout[type])) {
            layout[type].forEach((r, idx) => collectVertices(r, type, idx));
        }
    });

    if (layout.bunkers && Array.isArray(layout.bunkers)) {
        layout.bunkers.forEach((b, idx) => collectVertices(b, 'bunker', idx));
    }

    if (layout.waterHazards && Array.isArray(layout.waterHazards)) {
        layout.waterHazards.forEach((w, idx) => collectVertices(w, 'water', idx));
    }

    if (layout.rough?.vertices) {
        collectVertices(layout.rough, 'rough (legacy)');
    }

    // Find and merge vertices at same XZ position
    const thresholdSq = threshold * threshold;
    let mergedCount = 0;

    for (let i = 0; i < allVertices.length; i++) {
        const v1 = allVertices[i];
        if (!v1) continue; // Already processed

        const matches = [{ vertex: v1, ref: surfaceRefs[i] }];

        // Find all vertices at same XZ position
        for (let j = i + 1; j < allVertices.length; j++) {
            const v2 = allVertices[j];
            if (!v2) continue;

            const dx = v1.x - v2.x;
            const dz = v1.z - v2.z;
            const distSq = dx * dx + dz * dz;

            if (distSq < thresholdSq) {
                matches.push({ vertex: v2, ref: surfaceRefs[j] });
                allVertices[j] = null; // Mark as processed
            }
        }

        // If multiple vertices at same position, merge them
        if (matches.length > 1) {
            // Calculate average position and height
            let avgX = 0, avgZ = 0, avgY = 0;
            let yCount = 0;

            matches.forEach(m => {
                avgX += m.vertex.x;
                avgZ += m.vertex.z;
                if (m.vertex.y !== undefined) {
                    avgY += m.vertex.y;
                    yCount++;
                }
            });

            avgX /= matches.length;
            avgZ /= matches.length;
            avgY = yCount > 0 ? avgY / yCount : 0;

            // Update all matching vertices to the averaged values
            matches.forEach(m => {
                const vertex = m.ref.surface.vertices[m.ref.vertexIndex];
                vertex.x = avgX;
                vertex.z = avgZ;
                vertex.y = avgY;
            });

            mergedCount++;
        }
    }

    if (mergedCount > 0) {
        console.log(`✅ Merged ${mergedCount} groups of shared vertices (threshold: ${threshold}m)`);
    }
}

/**
 * Processes a hole layout object and converts it to a playable format.
 * Converts control points to vertices, maps surface strings to SURFACES enum, etc.
 * @param {object} sourceLayout - The raw hole layout data (from localStorage or JSON file)
 * @returns {object|null} The processed hole layout ready for rendering, or null on error
 */
export function processHoleLayout(sourceLayout) {
    if (!sourceLayout) {
        console.error('No source layout provided to processHoleLayout');
        return null;
    }

    // Create a deep copy to avoid modifying the original
    const layout = JSON.parse(JSON.stringify(sourceLayout));

    // Map surface strings from JSON to actual SURFACES enum values
    try {
        if (layout.background) {
            layout.background.surface = SURFACES[layout.background.surface];
            layout.background.type = 'polygon';
        }

        // Process Tee Box: Calculate vertices from center/width/depth
        if (layout.tee && layout.tee.center && layout.tee.width && layout.tee.depth) {
            const c = layout.tee.center;
            const hw = layout.tee.width / 2;
            const hd = layout.tee.depth / 2;
            const teeHeight = c.y !== undefined ? c.y : 0; // Get height from center
            console.log('holeLoader: Processing tee box - center:', c, 'teeHeight:', teeHeight);
            layout.tee.vertices = [
                { x: c.x - hw, y: teeHeight, z: c.z - hd }, // Front-left
                { x: c.x + hw, y: teeHeight, z: c.z - hd }, // Front-right
                { x: c.x + hw, y: teeHeight, z: c.z + hd }, // Back-right
                { x: c.x - hw, y: teeHeight, z: c.z + hd }  // Back-left
            ];
            console.log('holeLoader: Tee box vertices:', layout.tee.vertices);
            layout.tee.surface = SURFACES[layout.tee.surface];
            layout.tee.type = 'polygon';
        }

        // Process Fairways: Support multiple fairways (or single legacy fairway)
        if (layout.fairways && Array.isArray(layout.fairways)) {
            layout.fairways.forEach(fairway => {
                if (fairway.controlPoints) {
                    fairway.vertices = fairway.controlPoints;
                    delete fairway.controlPoints;
                }
                fairway.surface = SURFACES[fairway.surface];
                fairway.type = 'polygon';
            });
        } else if (layout.fairway && layout.fairway.controlPoints) {
            // Legacy single fairway support - convert to array
            layout.fairway.vertices = layout.fairway.controlPoints;
            delete layout.fairway.controlPoints;
            layout.fairway.surface = SURFACES[layout.fairway.surface];
            layout.fairway.type = 'polygon';
            layout.fairways = [layout.fairway];
            delete layout.fairway;
        }

        // Process Greens: Support multiple greens (or single legacy green)
        if (layout.greens && Array.isArray(layout.greens)) {
            layout.greens.forEach(green => {
                if (green.controlPoints) {
                    green.vertices = green.controlPoints;
                    delete green.controlPoints;
                }
                green.surface = SURFACES[green.surface];
                green.type = 'polygon';
            });
        } else if (layout.green && layout.green.controlPoints) {
            // Legacy single green support - convert to array
            layout.green.vertices = layout.green.controlPoints;
            delete layout.green.controlPoints;
            layout.green.surface = SURFACES[layout.green.surface];
            layout.green.type = 'polygon';
            layout.greens = [layout.green];
            delete layout.green;
        }

        // Process Light Rough
        if (layout.lightRough && Array.isArray(layout.lightRough)) {
            layout.lightRough.forEach(rough => {
                if (rough.vertices) {
                    rough.surface = SURFACES[rough.surface];
                    rough.type = 'polygon';
                }
            });
        }

        // Process Medium Rough
        if (layout.mediumRough && Array.isArray(layout.mediumRough)) {
            layout.mediumRough.forEach(rough => {
                if (rough.vertices) {
                    rough.surface = SURFACES[rough.surface];
                    rough.type = 'polygon';
                }
            });
        }

        // Process Thick Rough
        if (layout.thickRough && Array.isArray(layout.thickRough)) {
            layout.thickRough.forEach(rough => {
                if (rough.vertices) {
                    rough.surface = SURFACES[rough.surface];
                    rough.type = 'polygon';
                }
            });
        }

        // Process Native Areas (wild grass)
        if (layout.nativeAreas && Array.isArray(layout.nativeAreas)) {
            layout.nativeAreas.forEach(area => {
                if (area.controlPoints) {
                    area.vertices = area.controlPoints;
                    delete area.controlPoints;
                }
                if (area.vertices) {
                    area.surface = SURFACES[area.surface];
                    area.type = 'polygon';
                }
            });
        }

        // Legacy rough support (single rough polygon)
        if (layout.rough && layout.rough.vertices) {
            layout.rough.surface = SURFACES[layout.rough.surface];
            layout.rough.type = 'polygon';
        }

        // Process Bunkers: Use vertices as-is
        if (layout.bunkers && Array.isArray(layout.bunkers)) {
            layout.bunkers.forEach(bunker => {
                if (bunker.controlPoints) {
                    bunker.vertices = bunker.controlPoints;
                    delete bunker.controlPoints;
                }
                bunker.surface = SURFACES[bunker.surface];
                bunker.type = 'polygon';
            });
        }

        // Process Water Hazards: Use vertices as-is
        if (layout.waterHazards && Array.isArray(layout.waterHazards)) {
            layout.waterHazards.forEach(water => {
                if (water.controlPoints) {
                    water.vertices = water.controlPoints;
                    delete water.controlPoints;
                }
                water.surface = SURFACES[water.surface];
                water.type = 'polygon';
            });
        }

        // Process Flag Positions
        if (layout.flagPositions && Array.isArray(layout.flagPositions)) {
            // For now, just use the first flag position as the main flag
            // Future: could support multiple flag positions for different pin placements
            if (layout.flagPositions.length > 0) {
                layout.flagPosition = {
                    x: layout.flagPositions[0].x,
                    y: layout.flagPositions[0].y !== undefined ? layout.flagPositions[0].y : 0,
                    z: layout.flagPositions[0].z
                };
            }
        }

        // Process Obstacles (trees/bushes)
        if (layout.obstacles && Array.isArray(layout.obstacles)) {
            // Obstacles are already in the correct format with x, z, type, size
            // The rendering code will need to handle these separately
        }

        // Drop stray greens: the OSM import corridor can sweep in a
        // NEIGHBORING hole's green (Augusta's 10th carried the 18th green
        // beside its tee). Keep greens that contain the flag or sit near it —
        // the containment test preserves huge shared/double greens.
        dropStrayGreens(layout);

        // Merge vertices that are at the same position (within 10cm)
        // This helps when designers create adjacent polygons with shared edges
        mergeSharedVertices(layout, 0.1);

        // Give un-authored greens a real break field (physics, rendering and
        // the slope-arrow overlay all read greenContour — without one, putts
        // roll dead straight and the slope button has nothing to show).
        synthesizeGreenContour(layout);

    } catch (e) {
        console.error("Error processing hole layout. Check JSON format and SURFACES definition.", e);
        return null;
    }

    return layout;
}

function pointInPolygon(pt, vs) {
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i].x, zi = vs[i].z, xj = vs[j].x, zj = vs[j].z;
        if ((zi > pt.z) !== (zj > pt.z) &&
            pt.x < (xj - xi) * (pt.z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
}

function dropStrayGreens(layout) {
    const flag = layout.flagPosition;
    if (!flag || !Array.isArray(layout.greens) || layout.greens.length < 2) return;
    const keep = [];
    let nearest = null, nearestD = Infinity;
    for (const g of layout.greens) {
        const vs = g.vertices || [];
        if (vs.length < 3) continue;
        let cx = 0, cz = 0;
        for (const v of vs) { cx += v.x; cz += v.z; }
        cx /= vs.length; cz /= vs.length;
        const d = Math.hypot(cx - flag.x, cz - flag.z);
        if (d < nearestD) { nearestD = d; nearest = g; }
        if (d < 60 || pointInPolygon(flag, vs)) keep.push(g);
    }
    if (keep.length === 0 && nearest) keep.push(nearest);
    if (keep.length && keep.length < layout.greens.length) {
        layout.greens = keep;
    }
}

// --- Auto green contour ---------------------------------------------------
// Putts only break where the analytic contour field (greenContours.js) says
// so — ball roll, the displaced green mesh, and the slope-arrow overlay all
// read it. Holes that don't author a `greenContour` get a deterministic,
// gentle one here so course greens putt like greens instead of pool tables.
// Seeded from the green's own geometry: the same hole always breaks the same
// way, across sessions and devices.

/** Tiny deterministic PRNG (mulberry32). */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function synthesizeGreenContour(layout) {
    if (layout.greenContour || !Array.isArray(layout.greens) || layout.greens.length === 0) return;

    // The green nearest the flag (course holes normally have exactly one)
    const flag = layout.flagPosition;
    let best = null, bestD = Infinity;
    for (const g of layout.greens) {
        const vs = g.vertices;
        if (!vs || vs.length < 3) continue;
        let cx = 0, cz = 0;
        for (const v of vs) { cx += v.x; cz += v.z; }
        cx /= vs.length; cz /= vs.length;
        let r = 0;
        for (const v of vs) r = Math.max(r, Math.hypot(v.x - cx, v.z - cz));
        const d = flag ? Math.hypot(cx - flag.x, cz - flag.z) : 0;
        if (d < bestD) { bestD = d; best = { cx, cz, r }; }
    }
    if (!best || best.r < 3) return; // no usable green polygon

    const { cx, cz, r } = best;
    const rand = mulberry32(
        (Math.round(cx * 8) * 73856093) ^ (Math.round(cz * 8) * 19349663) ^ Math.round(r * 83492791));

    // Calibrated against the practice green's authored contour (tilt 1.0%,
    // features 0.14–0.30 m): same family, slightly tamer on average.
    const tiltMag = 0.006 + rand() * 0.008; // 0.6–1.4% base tilt
    const tiltDir = rand() * Math.PI * 2;
    const featureScale = Math.min(1.6, r / 15); // bigger greens carry bigger tiers
    // A Gaussian bump's steepest face slope is 0.607·|h|/σ (σ = radius/2).
    // Cap it: tier faces shed balls toward the flats (that's real), but a
    // face beyond ~5.5% turns a small green into a funnel.
    const MAX_BUMP_FACE_SLOPE = 0.055;
    const bumps = [];
    const bumpCount = 2 + Math.floor(rand() * 3); // 2–4 crowns/tiers/swales
    for (let i = 0; i < bumpCount; i++) {
        const a = rand() * Math.PI * 2;
        const d = rand() * r * 0.7;
        const radius = r * (0.30 + rand() * 0.25);
        const sigma = Math.max(0.5, radius / 2);
        let height = (rand() < 0.4 ? -1 : 1) * (0.08 + rand() * 0.18) * featureScale;
        const maxH = MAX_BUMP_FACE_SLOPE * sigma / 0.607;
        if (Math.abs(height) > maxH) height = Math.sign(height) * maxH;
        bumps.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, height, radius });
    }

    const tilt = { dx: Math.cos(tiltDir) * tiltMag, dz: Math.sin(tiltDir) * tiltMag };

    // Overlapping bump faces can SUM well past any single face's slope
    // (9.8% measured on a real green). Cap the total contour gradient
    // everywhere on the green: sample a grid, and at the steepest point
    // solve the exact bump scale (gradients are linear in heights) —
    // repeat a few passes since scaling moves the maximum.
    const MAX_GREEN_FACE_SLOPE = 0.06;
    const gradParts = (x, z) => {
        let bgx = 0, bgz = 0;
        for (const b of bumps) {
            const sigma = Math.max(0.5, b.radius / 2);
            const dx = x - b.x, dz = z - b.z;
            const g = -b.height * Math.exp(-(dx * dx + dz * dz) / (2 * sigma * sigma)) / (sigma * sigma);
            bgx += g * dx; bgz += g * dz;
        }
        return { bgx, bgz };
    };
    for (let pass = 0; pass < 4; pass++) {
        let maxMag = 0, at = null;
        for (let gx = -r; gx <= r; gx += Math.max(1, r / 4)) {
            for (let gz = -r; gz <= r; gz += Math.max(1, r / 4)) {
                if (gx * gx + gz * gz > r * r) continue;
                const { bgx, bgz } = gradParts(cx + gx, cz + gz);
                const m = Math.hypot(tilt.dx + bgx, tilt.dz + bgz);
                if (m > maxMag) { maxMag = m; at = { bgx, bgz }; }
            }
        }
        if (maxMag <= MAX_GREEN_FACE_SLOPE || !at) break;
        const A = at.bgx * at.bgx + at.bgz * at.bgz;
        const Bq = 2 * (tilt.dx * at.bgx + tilt.dz * at.bgz);
        const Cq = tilt.dx * tilt.dx + tilt.dz * tilt.dz - MAX_GREEN_FACE_SLOPE * MAX_GREEN_FACE_SLOPE;
        if (A < 1e-12) break;
        const disc = Bq * Bq - 4 * A * Cq;
        const s = Math.max(0, Math.min(1, disc >= 0 ? (-Bq + Math.sqrt(disc)) / (2 * A) : 0));
        for (const b of bumps) b.height *= s;
    }

    // Clamp the total contour gradient at a specific point by scaling ALL
    // bump heights: bump gradients are LINEAR in height, so the total is
    // T + s·B (T = tilt, B = summed bump gradients) and the exact scale s
    // is a quadratic root — no iteration budget to run out of (a raw pin
    // can start at 7%+). Tilt alone is 0.6-1.4%, always under any cap.
    const clampContourAt = (px, pz, maxSlope) => {
        let bx = 0, bz = 0;
        for (const b of bumps) {
            const sigma = Math.max(0.5, b.radius / 2);
            const dx = px - b.x, dz = pz - b.z;
            const g = -b.height * Math.exp(-(dx * dx + dz * dz) / (2 * sigma * sigma)) / (sigma * sigma);
            bx += g * dx; bz += g * dz;
        }
        const tx = tilt.dx, tz = tilt.dz;
        if (Math.hypot(tx + bx, tz + bz) <= maxSlope) return;
        const A = bx * bx + bz * bz;
        const Bc = 2 * (tx * bx + tz * bz);
        const C = tx * tx + tz * tz - maxSlope * maxSlope;
        let s = 0;
        if (A > 1e-12) {
            const disc = Bc * Bc - 4 * A * C;
            s = disc >= 0 ? (-Bc + Math.sqrt(disc)) / (2 * A) : 0;
        }
        s = Math.max(0, Math.min(1, s));
        for (const b of bumps) b.height *= s;
    };

    // Pinnable pin (greenkeepers don't cut holes on slopes), and a restable
    // green center (the default landing target must hold a ball even on
    // tournament-fast greens, where friction holds only ~6% grades).
    if (flag) clampContourAt(flag.x, flag.z, 0.025);
    clampContourAt(cx, cz, 0.035);

    layout.greenContour = {
        center: { x: cx, z: cz },
        innerRadius: r + 2,          // full strength across green + fringe
        outerRadius: r + 7,          // feather melts into the surround
        tilt,
        bumps,
    };
}
