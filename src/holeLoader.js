// src/holeLoader.js
// Simplified loader for holes created with the Hole Maker tool
// These holes have exact vertices already defined, no procedural generation needed

import { SURFACES } from './surfaces.js';

/**
 * Loads a hole layout from a JSON file created by the Hole Maker tool.
 * Unlike holeGenerator.js, this loader expects exact vertices for all shapes.
 * @param {string} [holeNameInput="custom_hole_01"] - The name of the hole file (can be with or without .json extension) to load from the 'holes' directory.
 * @returns {Promise<object|null>} A promise that resolves to an object describing the hole layout, or null on error.
 */
export async function loadHoleLayout(holeNameInput = "custom_hole_01") {
    // Ensure holeName does not have .json extension for internal use and fetching
    const holeName = holeNameInput.replace(/\.json$/, '');

    let sourceLayout;
    const filePath = `./holes/${holeName}.json`;

    try {
        const response = await fetch(filePath);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for ${filePath}`);
        }
        sourceLayout = await response.json();
    } catch (error) {
        console.error(`Error loading hole data for ${holeName} from ${filePath}:`, error);
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
            layout.tee.vertices = [
                { x: c.x - hw, z: c.z - hd }, // Front-left
                { x: c.x + hw, z: c.z - hd }, // Front-right
                { x: c.x + hw, z: c.z + hd }, // Back-right
                { x: c.x - hw, z: c.z + hd }  // Back-left
            ];
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

        // Process Green: Use vertices as-is (already exact from hole maker)
        if (layout.green && layout.green.controlPoints) {
            layout.green.vertices = layout.green.controlPoints;
            delete layout.green.controlPoints;
            layout.green.surface = SURFACES[layout.green.surface];
            layout.green.type = 'polygon';
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

    } catch (e) {
        console.error("Error processing hole layout. Check JSON format and SURFACES definition.", e);
        return null;
    }

    return layout;
}
