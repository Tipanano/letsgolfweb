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
        // No hole layout means we're in range/practice mode - default to fairway
        return 'FAIRWAY';
    }

    // All hole layouts are now in meters, no conversion needed
    const point = pointMeters;


    // Check order: Tee > Green > Fairway > Bunkers > Water > Rough > Background
    // Note: holeLayout vertices are now in METERS.

    // 1. Tee Box (Polygon) - Check first as it might overlap rough/background
    if (holeLayout.tee?.type === 'polygon' && holeLayout.tee.vertices) {
        if (isPointInPolygon(point, holeLayout.tee.vertices)) {
            return 'TEE';
        }
    }

    // 2. Green (Polygon)
    if (holeLayout.green?.type === 'polygon' && holeLayout.green.vertices) {
        if (isPointInPolygon(point, holeLayout.green.vertices)) {
            return 'GREEN';
        }
    }
    // TODO: Add check for legacy circle green if needed

    // 3. Fairways (Array of Polygons or single Polygon)
    // Check for new format (array) first, then fall back to legacy single fairway
    if (holeLayout.fairways && Array.isArray(holeLayout.fairways)) {
        for (let i = 0; i < holeLayout.fairways.length; i++) {
            const fairway = holeLayout.fairways[i];
            if (fairway.vertices && isPointInPolygon(point, fairway.vertices)) {
                return 'FAIRWAY';
            }
        }
    } else if (holeLayout.fairway?.vertices) {
        // Legacy single fairway support
        if (isPointInPolygon(point, holeLayout.fairway.vertices)) {
            return 'FAIRWAY';
        }
    }

    // 4. Bunkers (Array of Polygons/Circles)
    if (holeLayout.bunkers && Array.isArray(holeLayout.bunkers)) {
        for (let i = 0; i < holeLayout.bunkers.length; i++) {
            const bunker = holeLayout.bunkers[i];
            if (bunker.type === 'polygon' && bunker.vertices) {
                if (isPointInPolygon(point, bunker.vertices)) {
                    return 'BUNKER';
                }
            } else if (bunker.type === 'circle' && bunker.center && bunker.radius) {
                const dx = point.x - bunker.center.x;
                const dz = point.z - bunker.center.z;
                if (dx * dx + dz * dz <= bunker.radius * bunker.radius) {
                    return 'BUNKER';
                }
            }
        }
    }

    // 5. Water Hazards (Array of Polygons/Circles/Ellipses)
    if (holeLayout.waterHazards && Array.isArray(holeLayout.waterHazards)) {
        for (let i = 0; i < holeLayout.waterHazards.length; i++) {
            const water = holeLayout.waterHazards[i];
            if (water.type === 'polygon' && water.vertices) {
                if (isPointInPolygon(point, water.vertices)) {
                    return 'WATER';
                }
            } else if (water.type === 'circle' && water.center && water.radius) {
                const dx = point.x - water.center.x;
                const dz = point.z - water.center.z;
                if (dx * dx + dz * dz <= water.radius * water.radius) {
                    return 'WATER';
                }
            } else if (water.type === 'ellipse' && water.center && water.radiusX && water.radiusZ) {
                // Check if point is inside ellipse using the ellipse equation: (x/a)^2 + (z/b)^2 <= 1
                const dx = point.x - water.center.x;
                const dz = point.z - water.center.z;
                const normalized = (dx * dx) / (water.radiusX * water.radiusX) +
                                  (dz * dz) / (water.radiusZ * water.radiusZ);
                if (normalized <= 1) {
                    return 'WATER';
                }
            }
        }
    }

    // 6. Rough Types (Check in order: Thick → Medium → Light for proper layering)
    // Check thick rough first (most penalizing)
    if (holeLayout.thickRough && Array.isArray(holeLayout.thickRough)) {
        for (let i = 0; i < holeLayout.thickRough.length; i++) {
            const rough = holeLayout.thickRough[i];
            if (rough.vertices && isPointInPolygon(point, rough.vertices)) {
                return 'THICK_ROUGH';
            }
        }
    }

    // Check medium rough
    if (holeLayout.mediumRough && Array.isArray(holeLayout.mediumRough)) {
        for (let i = 0; i < holeLayout.mediumRough.length; i++) {
            const rough = holeLayout.mediumRough[i];
            if (rough.vertices && isPointInPolygon(point, rough.vertices)) {
                return 'MEDIUM_ROUGH';
            }
        }
    }

    // Check light rough
    if (holeLayout.lightRough && Array.isArray(holeLayout.lightRough)) {
        for (let i = 0; i < holeLayout.lightRough.length; i++) {
            const rough = holeLayout.lightRough[i];
            if (rough.vertices && isPointInPolygon(point, rough.vertices)) {
                return 'LIGHT_ROUGH';
            }
        }
    }

    // Legacy single rough support (for old procedurally generated holes)
    if (holeLayout.rough?.vertices) {
         if (isPointInPolygon(point, holeLayout.rough.vertices)) {
             const roughSurfaceName = holeLayout.rough.surface?.name?.toUpperCase() || 'THICK_ROUGH';
             return roughSurfaceName;
         }
    }

    // 7. Background / Fallback (respects background surface property)
    // If it's not in any specific feature above, check if it's within the background bounds.
    if (holeLayout.background?.vertices) {
        if (isPointInPolygon(point, holeLayout.background.vertices)) {
            // It's within the background polygon but not any specific feature.
            // Use the background's actual surface property (e.g., OUT_OF_BOUNDS or THICK_ROUGH)
            const backgroundSurfaceName = holeLayout.background.surface?.name?.toUpperCase() || 'OUT_OF_BOUNDS';
            return backgroundSurfaceName;
        }
    }
    // If not inside the background polygon either, it's definitely OOB.

    // Default: If not inside any defined polygon (including background)
    return 'OUT_OF_BOUNDS';
}
