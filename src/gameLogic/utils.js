import {
    getCurrentShotType, getBackswingDuration, getRotationInitiationTime,
    getRotationStartTime, getArmsStartTime, getWristsStartTime,
    getHipInitiationTime, getBackswingEndTime
    // Removed incorrect import of getCurrentHoleLayout
} from './state.js';
import { isPointInPolygon } from '../shapeUtils.js'; // Import the point-in-polygon checker
import { YARDS_TO_METERS } from '../visuals/core.js'; // Import conversion factor

/**
 * Clamps a value between a minimum and maximum.
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

    // Check order: Green > Fairway > Bunkers > Water > Rough > Background
    // Note: Assumes holeLayout vertices are in YARDS.

    // 1. Green (Polygon)
    if (holeLayout.green?.type === 'polygon' && holeLayout.green.vertices) {
        if (isPointInPolygon(pointYards, holeLayout.green.vertices)) {
            return 'GREEN';
        }
    }
    // TODO: Add check for legacy circle green if needed

    // 2. Fairway (Polygon)
    if (holeLayout.fairway?.vertices) {
        if (isPointInPolygon(pointYards, holeLayout.fairway.vertices)) {
            return 'FAIRWAY';
        }
    }

    // 3. Bunkers (Array of Polygons/Circles)
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

    // 4. Water Hazards (Array of Polygons/Circles)
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
            }
        }
    }

    // 5. Rough (Polygon - assumes it covers area outside fairway/green but inside background)
    // We might need different rough types later (Light, Medium, Thick)
    // For now, if it's not Green/Fairway/Bunker/Water, assume it's in the rough polygon if defined
    if (holeLayout.rough?.vertices) {
         if (isPointInPolygon(pointYards, holeLayout.rough.vertices)) {
             // TODO: Differentiate rough types later if needed
             return 'THICK_ROUGH'; // Default to heavy Rough for now
         }
    }

    // 6. Background / Out of Bounds (Polygon)
    // If it's not in any of the above, check if it's within the background bounds.
    // If even the background check fails, it's definitely OOB.
    if (holeLayout.background?.vertices) {
        if (isPointInPolygon(pointYards, holeLayout.background.vertices)) {
            // It's within the background polygon but not any specific feature above.
            // This *could* still be considered rough, or a specific 'background' surface type if defined.
            // Let's default to OUT_OF_BOUNDS if not caught by rough explicitly.
             console.warn(`Point (${pointYards.x.toFixed(1)}, ${pointYards.z.toFixed(1)}) is inside background but not other features. Treating as OOB.`);
             return 'OUT_OF_BOUNDS';
        }
    }

    // Default: If not inside any defined polygon (including background)
    return 'OUT_OF_BOUNDS';
}
