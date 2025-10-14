import {
    getCurrentShotType, getBackswingDuration, getRotationInitiationTime,
    getRotationStartTime, getArmsStartTime, getWristsStartTime,
    getHipInitiationTime, getBackswingEndTime
    // Removed incorrect import of getCurrentHoleLayout
} from '../gameLogic/state.js';
import { isPointInPolygon } from '../shapeUtils.js'; // Import the point-in-polygon checker
import { YARDS_TO_METERS } from './unitConversions.js'; // Import conversion factor

/**
 * Clamps a value between a minimum and maximum.
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Generates a random floating-point number between min (inclusive) and max (exclusive).
 */
export function getRandomInRange(min, max) {
    return Math.random() * (max - min) + min;
}

/**
 * Helper to get current timing data for debug display.
 */
export function getDebugTimingData() {
    const shotType = getCurrentShotType();
    const backswingDuration = getBackswingDuration(); // Get from state

    if (shotType !== 'full') {
        // Return default/empty values for non-full swings
        return {
            backswingDuration: backswingDuration, // Still relevant maybe?
            rotationStartOffset: null,
            rotationInitiatedEarly: false,
            armsStartOffset: null,
            wristsStartOffset: null,
            hipInitiationOffset: null,
        };
    }

    const rotationInitiationTime = getRotationInitiationTime();
    const rotationStartTime = getRotationStartTime();
    const armsStartTime = getArmsStartTime();
    const wristsStartTime = getWristsStartTime();
    const hipInitiationTime = getHipInitiationTime();
    const backswingEndTime = getBackswingEndTime(); // Get from state

    let rotationOffset = null;
    let rotationInitiatedEarly = false;
    if (rotationInitiationTime && backswingEndTime) {
        rotationOffset = rotationInitiationTime - backswingEndTime;
        rotationInitiatedEarly = true;
    } else if (rotationStartTime && backswingEndTime) {
        rotationOffset = rotationStartTime - backswingEndTime;
    }

    return {
        backswingDuration: backswingDuration,
        rotationStartOffset: rotationOffset,
        rotationInitiatedEarly: rotationInitiatedEarly,
        armsStartOffset: (armsStartTime && backswingEndTime) ? armsStartTime - backswingEndTime : null,
        wristsStartOffset: (wristsStartTime && backswingEndTime) ? wristsStartTime - backswingEndTime : null,
        hipInitiationOffset: (hipInitiationTime && backswingEndTime) ? hipInitiationTime - backswingEndTime : null,
    };
}

/**
 * Determines the surface type at a given 2D point based on the hole layout.
 * Checks surfaces in order of priority (Green > Fairway > Bunkers > Water > Rough > Background).
 * @param {{x: number, z: number}} pointMeters - The point to check (in world meters).
 * @param {object} holeLayout - The hole layout data structure.
 * @returns {string} The name of the surface type (e.g., 'GREEN', 'FAIRWAY', 'LIGHT_ROUGH', 'BUNKER', 'WATER', 'OUT_OF_BOUNDS'). Defaults to 'OUT_OF_BOUNDS'.
 */
export function getSurfaceTypeAtPoint(pointMeters, holeLayout) {
    if (!pointMeters || !holeLayout) {
        console.warn("getSurfaceTypeAtPoint: Missing point or holeLayout.");
        return 'OUT_OF_BOUNDS'; // Default if layout is missing
    }

    const scale = YARDS_TO_METERS; // For converting polygon vertices if needed (though they should be in yards)
    const pointYards = { x: pointMeters.x / scale, z: pointMeters.z / scale }; // Convert check point to yards

    // Check order: Tee > Green > Fairway > Bunkers > Water > Rough > Background
    // Note: Assumes holeLayout vertices are in YARDS.

    // 1. Tee Box (Polygon) - Check first as it might overlap rough/background
    if (holeLayout.tee?.type === 'polygon' && holeLayout.tee.vertices) {
        if (isPointInPolygon(pointYards, holeLayout.tee.vertices)) {
            return 'TEE';
        }
    }

    // 2. Green (Polygon)
    if (holeLayout.green?.type === 'polygon' && holeLayout.green.vertices) {
        if (isPointInPolygon(pointYards, holeLayout.green.vertices)) {
            return 'GREEN';
        }
    }
    // TODO: Add check for legacy circle green if needed

    // 3. Fairway (Polygon)
    if (holeLayout.fairway?.vertices) {
        if (isPointInPolygon(pointYards, holeLayout.fairway.vertices)) {
            return 'FAIRWAY';
        }
    }

    // 4. Bunkers (Array of Polygons/Circles)
    if (holeLayout.bunkers && Array.isArray(holeLayout.bunkers)) {
        for (const bunker of holeLayout.bunkers) {
            if (bunker.type === 'polygon' && bunker.vertices) {
                if (isPointInPolygon(pointYards, bunker.vertices)) {
                    return 'BUNKER';
                }
            } else if (bunker.type === 'circle' && bunker.center && bunker.radius) {
                const dx = pointYards.x - bunker.center.x;
                const dz = pointYards.z - bunker.center.z;
                if (dx * dx + dz * dz <= bunker.radius * bunker.radius) {
                    return 'BUNKER';
                }
            }
        }
    }

    // 5. Water Hazards (Array of Polygons/Circles/Ellipses)
    if (holeLayout.waterHazards && Array.isArray(holeLayout.waterHazards)) {
        for (const water of holeLayout.waterHazards) {
            if (water.type === 'polygon' && water.vertices) {
                if (isPointInPolygon(pointYards, water.vertices)) {
                    return 'WATER';
                }
            } else if (water.type === 'circle' && water.center && water.radius) {
                const dx = pointYards.x - water.center.x;
                const dz = pointYards.z - water.center.z;
                if (dx * dx + dz * dz <= water.radius * water.radius) {
                    return 'WATER';
                }
            } else if (water.type === 'ellipse' && water.center && water.radiusX && water.radiusZ) {
                // Check if point is inside ellipse using the ellipse equation: (x/a)^2 + (z/b)^2 <= 1
                const dx = pointYards.x - water.center.x;
                const dz = pointYards.z - water.center.z;
                const normalized = (dx * dx) / (water.radiusX * water.radiusX) +
                                  (dz * dz) / (water.radiusZ * water.radiusZ);
                if (normalized <= 1) {
                    return 'WATER';
                }
            }
        }
    }

    // 5. Rough (Polygon - assumes it covers area outside fairway/green but inside background)
    // 6. Rough (Polygon - assumes it covers area outside fairway/green but inside background)
    // Since this specific hole only defines one rough type (THICK_ROUGH in the generator),
    // we check for that polygon. If other rough types were defined (e.g., lightRough),
    // they would need to be checked here in the correct order (e.g., medium before light).
    if (holeLayout.rough?.vertices) {
         if (isPointInPolygon(pointYards, holeLayout.rough.vertices)) {
             // Return the surface type defined in the hole layout for this rough polygon
             // (Currently THICK_ROUGH based on holeGenerator.js)
             const roughSurfaceName = holeLayout.rough.surface?.name?.toUpperCase() || 'THICK_ROUGH';
             return roughSurfaceName;
         }
    }
    // Add checks for other rough types (e.g., holeLayout.lightRough) here if they exist in the layout data.

    // 7. Background / Fallback Rough / Out of Bounds
    // If it's not in any specific feature above, check if it's within the background bounds.
    if (holeLayout.background?.vertices) {
        if (isPointInPolygon(pointYards, holeLayout.background.vertices)) {
            // It's within the background polygon but not any specific feature.
            // Treat this as the thickest rough by default if not caught by a specific rough polygon.
            // Or potentially a different 'Waste Area' surface if defined.
            // For now, let's assume it's THICK_ROUGH if inside the background but outside everything else.
            // console.log(`Point (${pointYards.x.toFixed(1)}, ${pointYards.z.toFixed(1)}) is inside background but not other features. Treating as THICK_ROUGH.`);
            return 'THICK_ROUGH'; // Fallback to thickest rough within bounds
        }
    }
    // If not inside the background polygon either, it's definitely OOB.

    // Default: If not inside any defined polygon (including background)
    return 'OUT_OF_BOUNDS';
}
