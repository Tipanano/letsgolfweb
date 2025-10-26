// src/terrainHeight.js
// Handles terrain height lookups for ball physics

import earcut from 'https://cdn.skypack.dev/earcut@2.2.4';

/**
 * Checks if a point is inside a triangle using barycentric coordinates
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {Object} v1 - Triangle vertex 1 {x, z}
 * @param {Object} v2 - Triangle vertex 2 {x, z}
 * @param {Object} v3 - Triangle vertex 3 {x, z}
 * @returns {Object|null} Barycentric weights {w1, w2, w3} if inside, null if outside
 */
function getBarycentric(px, pz, v1, v2, v3) {
    const denom = ((v2.z - v3.z) * (v1.x - v3.x) + (v3.x - v2.x) * (v1.z - v3.z));

    if (Math.abs(denom) < 0.000001) {
        return null; // Degenerate triangle
    }

    const w1 = ((v2.z - v3.z) * (px - v3.x) + (v3.x - v2.x) * (pz - v3.z)) / denom;
    const w2 = ((v3.z - v1.z) * (px - v3.x) + (v1.x - v3.x) * (pz - v3.z)) / denom;
    const w3 = 1 - w1 - w2;

    // Check if point is inside triangle (all weights between 0 and 1)
    if (w1 >= -0.0001 && w1 <= 1.0001 &&
        w2 >= -0.0001 && w2 <= 1.0001 &&
        w3 >= -0.0001 && w3 <= 1.0001) {
        return { w1, w2, w3 };
    }

    return null;
}

/**
 * Gets the height at a specific XZ position by checking all triangulated surfaces
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {Array} triangulatedSurfaces - Array of {name, triangles: [{v1, v2, v3}, ...]}
 * @returns {number} Height (Y) at this position, or 0 if not found
 */
export function getTerrainHeight(x, z, triangulatedSurfaces) {
    if (!triangulatedSurfaces || triangulatedSurfaces.length === 0) {
        return 0; // Default ground level
    }

    // Check each surface's triangles
    for (const surface of triangulatedSurfaces) {
        if (!surface.triangles) continue;

        for (const tri of surface.triangles) {
            const bary = getBarycentric(x, z, tri.v1, tri.v2, tri.v3);

            if (bary) {
                // Point is inside this triangle - interpolate height
                const y1 = tri.v1.y !== undefined ? tri.v1.y : 0;
                const y2 = tri.v2.y !== undefined ? tri.v2.y : 0;
                const y3 = tri.v3.y !== undefined ? tri.v3.y : 0;

                const height = bary.w1 * y1 + bary.w2 * y2 + bary.w3 * y3;
                return height;
            }
        }
    }

    // Not on any surface - return 0 or could return null to indicate "out of bounds"
    return 0;
}

/**
 * Builds a triangulated terrain mesh from hole layout for fast height lookups
 * @param {Object} holeLayout - Processed hole layout with vertices
 * @returns {Array} Array of triangulated surfaces
 */
export function buildTerrainMesh(holeLayout) {
    const surfaces = [];

    const addSurface = (polygonData, name) => {
        if (!polygonData?.vertices || polygonData.vertices.length < 3) {
            return;
        }

        // Simple ear clipping triangulation
        const triangles = triangulatePolygon(polygonData.vertices);

        if (triangles.length > 0) {
            surfaces.push({
                name,
                triangles,
                surface: polygonData.surface
            });
        }
    };

    // Add all surfaces
    if (holeLayout.greens && Array.isArray(holeLayout.greens)) {
        holeLayout.greens.forEach((green, idx) => addSurface(green, `green_${idx}`));
    }
    if (holeLayout.tee) addSurface(holeLayout.tee, 'tee');

    if (holeLayout.fairways && Array.isArray(holeLayout.fairways)) {
        holeLayout.fairways.forEach((fw, idx) => addSurface(fw, `fairway_${idx}`));
    }

    const roughTypes = ['lightRough', 'mediumRough', 'thickRough'];
    roughTypes.forEach(type => {
        if (holeLayout[type] && Array.isArray(holeLayout[type])) {
            holeLayout[type].forEach((r, idx) => addSurface(r, `${type}_${idx}`));
        }
    });

    if (holeLayout.bunkers && Array.isArray(holeLayout.bunkers)) {
        holeLayout.bunkers.forEach((b, idx) => addSurface(b, `bunker_${idx}`));
    }

    if (holeLayout.waterHazards && Array.isArray(holeLayout.waterHazards)) {
        holeLayout.waterHazards.forEach((w, idx) => addSurface(w, `water_${idx}`));
    }

    if (holeLayout.background) addSurface(holeLayout.background, 'background');

    console.log(`⛰️ Built terrain mesh with ${surfaces.length} surfaces`);

    return surfaces;
}

/**
 * Proper triangulation using earcut library (handles any polygon shape)
 * @param {Array} vertices - Array of {x, y?, z} vertices
 * @returns {Array} Array of triangles [{v1, v2, v3}, ...]
 */
function triangulatePolygon(vertices) {
    if (vertices.length < 3) return [];

    // Flatten vertices to [x, z, x, z, ...] for earcut (2D triangulation on XZ plane)
    const coords = [];
    for (const v of vertices) {
        coords.push(v.x, v.z);
    }

    // Triangulate using earcut (returns flat array of vertex indices: [i1, i2, i3, i1, i2, i3, ...])
    const indices = earcut(coords);

    // Convert indices to triangle objects with full vertex data including heights
    const triangles = [];
    for (let i = 0; i < indices.length; i += 3) {
        const idx1 = indices[i];
        const idx2 = indices[i + 1];
        const idx3 = indices[i + 2];

        const v1 = vertices[idx1];
        const v2 = vertices[idx2];
        const v3 = vertices[idx3];

        triangles.push({
            v1: { x: v1.x, y: v1.y !== undefined ? v1.y : 0, z: v1.z },
            v2: { x: v2.x, y: v2.y !== undefined ? v2.y : 0, z: v2.z },
            v3: { x: v3.x, y: v3.y !== undefined ? v3.y : 0, z: v3.z }
        });
    }

    return triangles;
}

/**
 * Gets terrain info at a position (height + surface type)
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {Array} triangulatedSurfaces - Array of triangulated surfaces
 * @returns {Object} {height: number, surface: Object|null, surfaceName: string|null}
 */
export function getTerrainInfo(x, z, triangulatedSurfaces) {
    if (!triangulatedSurfaces || triangulatedSurfaces.length === 0) {
        return { height: 0, surface: null, surfaceName: null };
    }

    for (const surface of triangulatedSurfaces) {
        if (!surface.triangles) continue;

        for (const tri of surface.triangles) {
            const bary = getBarycentric(x, z, tri.v1, tri.v2, tri.v3);

            if (bary) {
                const y1 = tri.v1.y !== undefined ? tri.v1.y : 0;
                const y2 = tri.v2.y !== undefined ? tri.v2.y : 0;
                const y3 = tri.v3.y !== undefined ? tri.v3.y : 0;

                const height = bary.w1 * y1 + bary.w2 * y2 + bary.w3 * y3;

                return {
                    height,
                    surface: surface.surface,
                    surfaceName: surface.name
                };
            }
        }
    }

    return { height: 0, surface: null, surfaceName: null };
}
