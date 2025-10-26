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
                    z: layout.flagPositions[0].z
                };
            }
        }

        // Process Obstacles (trees/bushes)
        if (layout.obstacles && Array.isArray(layout.obstacles)) {
            // Obstacles are already in the correct format with x, z, type, size
            // The rendering code will need to handle these separately
        }

        // Merge vertices that are at the same position (within 10cm)
        // This helps when designers create adjacent polygons with shared edges
        mergeSharedVertices(layout, 0.1);

    } catch (e) {
        console.error("Error processing hole layout. Check JSON format and SURFACES definition.", e);
        return null;
    }

    return layout;
}
