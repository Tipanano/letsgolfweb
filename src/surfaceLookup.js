// Which surface is under a given point.
//
// Kept out of utils/gameUtils.js on purpose: that module imports gameLogic
// state, which reaches the UI, visuals and THREE, so nothing in Node could
// load it — and this is the one function in the codebase that decides what
// lie the player gets. It is now testable on its own.

import { isPointInPolygon } from './pointInPolygon.js';
import { isFringeAt } from './fringe.js';

/**
 * Determines the surface type at a given 2D point based on the hole layout.
 * Checks in priority order: Tee > Green > Bunker > Water > Fringe > Fairway > Native > Rough > Background.
 * @param {{x: number, z: number}} pointMeters - The point to check (in world meters).
 * @param {object} holeLayout - The hole layout data structure.
 * @returns {string} The name of the surface type (e.g., 'GREEN', 'FAIRWAY', 'LIGHT_ROUGH', 'BUNKER', 'WATER', 'FRINGE', 'OUT_OF_BOUNDS'). Defaults to 'OUT_OF_BOUNDS'.
 */
export function getSurfaceTypeAtPoint(pointMeters, holeLayout) {
    if (!pointMeters || !holeLayout) {
        // No hole layout means we're in range/practice mode - default to fairway
        return 'FAIRWAY';
    }

    // All hole layouts are now in meters, no conversion needed
    const point = pointMeters;


    // Check order: Tee > Green > Bunker > Water > Fringe > Fairway > Native > Rough > Background
    // Note: holeLayout vertices are now in METERS.

    // 1. Tee Box (Polygon) - Check first as it might overlap rough/background
    if (holeLayout.tee?.type === 'polygon' && holeLayout.tee.vertices) {
        if (isPointInPolygon(point, holeLayout.tee.vertices)) {
            return 'TEE';
        }
    }

    // 2. Greens (Array of Polygons or single Polygon - legacy)
    if (holeLayout.greens && Array.isArray(holeLayout.greens)) {
        for (let i = 0; i < holeLayout.greens.length; i++) {
            const green = holeLayout.greens[i];
            if (green.vertices && isPointInPolygon(point, green.vertices)) {
                return 'GREEN';
            }
        }
    } else if (holeLayout.green?.type === 'polygon' && holeLayout.green.vertices) {
        // Legacy single green support
        if (isPointInPolygon(point, holeLayout.green.vertices)) {
            return 'GREEN';
        }
    }
    // TODO: Add check for legacy circle green if needed

    // 3. Bunkers (Array of Polygons/Circles)
    //
    // Hazards must beat fairway, not lose to it. A fairway bunker is drawn
    // INSIDE the fairway polygon — that is what a fairway bunker is — and
    // with fairway checked first, 321 bunkers and 61 water hazards across
    // the library handed back a fairway lie while the player was visibly
    // sitting in sand or in the pond left of Augusta's 11th. The terrain
    // bowl was always real; only the lie lookup disagreed with it.
    //
    // Green still outranks both: five water polygons clip a green edge by a
    // metre or two of mapping slop, and a putting surface must never turn
    // into a penalty drop.
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

    // 4. Water Hazards (Array of Polygons/Circles/Ellipses)
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

    // 5. Fringe — the collar around a green.
    //
    // It has no polygon; it is the ground within the local collar width of a
    // green's edge — 4 m into the approach, 1.5 m around the sides and back.
    // Placing the test HERE is the entire design: bunkers and water have
    // already had their say, so a greenside bunker cut into the collar stays a
    // bunker and there is no fringe behind it. It beats fairway because an
    // approach fairway running to the green is interrupted by the collar, not
    // the other way round.
    if (isFringeAt(point.x, point.z, holeLayout)) {
        return 'FRINGE';
    }

    // 6. Fairways (Array of Polygons or single Polygon)
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

    // 7. Native Areas (wild grass patches — sit on top of rough layers)
    if (holeLayout.nativeAreas && Array.isArray(holeLayout.nativeAreas)) {
        for (let i = 0; i < holeLayout.nativeAreas.length; i++) {
            const area = holeLayout.nativeAreas[i];
            if (area.vertices && isPointInPolygon(point, area.vertices)) {
                return 'NATIVE_AREA';
            }
        }
    }

    // 8. Rough Types (Check in order: Thick → Medium → Light for proper layering)
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

    // 9. Background / Fallback (respects background surface property)
    // If it's not in any specific feature above, check if it's within the background bounds.
    if (holeLayout.background?.vertices) {
        if (isPointInPolygon(point, holeLayout.background.vertices)) {
            // It's within the background polygon but not any specific feature.
            // Use the background's actual surface property (e.g., OUT_OF_BOUNDS or THICK_ROUGH)
            // Convert surface name to key format (spaces to underscores, uppercase)
            const backgroundSurfaceName = holeLayout.background.surface?.name?.toUpperCase().replace(/\s+/g, '_') || 'OUT_OF_BOUNDS';
            return backgroundSurfaceName;
        }
    }
    // If not inside the background polygon either, it's definitely OOB.

    // Default: If not inside any defined polygon (including background)
    return 'OUT_OF_BOUNDS';
}
