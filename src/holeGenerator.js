// src/holeGenerator.js
import { SURFACES } from './surfaces.js';
// Import utility functions (removed createRoundedPolygonShape)
import { createSmoothClosedShape, calculatePolygonCenter, createRandomizedFairwayShape } from './shapeUtils.js';

// Removed hardcoded layout and control points, will be loaded from JSON

/**
 * Loads a hole layout from a JSON file and processes it into a playable format.
 * @param {string} [holeNameInput="mickelson_01"] - The name of the hole file (can be with or without .json extension) to load from the 'holes' directory.
 * @returns {Promise<object|null>} A promise that resolves to an object describing the hole layout with final vertices, or null on error.
 */
export async function generateHoleLayout(holeNameInput = "mickelson_01") {
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
        return null; // Return null if loading fails
    }

    // Create a deep copy to avoid modifying the original template (sourceLayout)
    // and to ensure our processing doesn't affect any cached version of sourceLayout.
    const layoutToReturn = JSON.parse(JSON.stringify(sourceLayout));

    // Map surface strings from JSON to actual SURFACES enum values
    // This is crucial for the game logic and rendering to work correctly.
    try {
        if (layoutToReturn.background) layoutToReturn.background.surface = SURFACES[layoutToReturn.background.surface];
        if (layoutToReturn.tee) layoutToReturn.tee.surface = SURFACES[layoutToReturn.tee.surface];
        if (layoutToReturn.fairway) layoutToReturn.fairway.surface = SURFACES[layoutToReturn.fairway.surface];
        if (layoutToReturn.rough) layoutToReturn.rough.surface = SURFACES[layoutToReturn.rough.surface];
        if (layoutToReturn.green) layoutToReturn.green.surface = SURFACES[layoutToReturn.green.surface];
        if (layoutToReturn.bunkers) {
            layoutToReturn.bunkers.forEach(b => b.surface = SURFACES[b.surface]);
        }
        if (layoutToReturn.waterHazards) {
            layoutToReturn.waterHazards.forEach(wh => wh.surface = SURFACES[wh.surface]);
        }
    } catch (e) {
        console.error("Error mapping surface strings to SURFACES enum. Check JSON surface values and SURFACES definition.", e);
        // Depending on strictness, you might want to return null here or proceed with potentially broken surfaces.
    }
    

    // Process Tee Box: Calculate vertices from center/width/depth
    if (layoutToReturn.tee && layoutToReturn.tee.center && layoutToReturn.tee.width && layoutToReturn.tee.depth) {
        const c = layoutToReturn.tee.center;
        const hw = layoutToReturn.tee.width / 2;
        const hd = layoutToReturn.tee.depth / 2;
        layoutToReturn.tee.vertices = [
            { x: c.x - hw, z: c.z - hd }, // Front-left
            { x: c.x + hw, z: c.z - hd }, // Front-right
            { x: c.x + hw, z: c.z + hd }, // Back-right
            { x: c.x - hw, z: c.z + hd }  // Back-left
        ];
        layoutToReturn.tee.type = 'polygon'; // Add type
    } else {
        console.warn("Tee definition missing center, width, or depth. Cannot calculate vertices.");
        layoutToReturn.tee = { ...(layoutToReturn.tee || {}), vertices: [] }; // Ensure vertices array exists
    }


    // Process Green: Convert control points to vertices and calculate center
    if (layoutToReturn.green && layoutToReturn.green.controlPoints) {
        const greenVertices = createSmoothClosedShape(layoutToReturn.green.controlPoints);
        layoutToReturn.green.vertices = greenVertices;
        delete layoutToReturn.green.controlPoints; // Remove control points, keep final vertices
        layoutToReturn.green.type = 'polygon'; // Add type for holeView compatibility

        // Calculate and set flag position to the green's center
        const greenCenter = calculatePolygonCenter(greenVertices);
        if (greenCenter) {
            layoutToReturn.flagPosition = greenCenter;
        } else {
            console.warn("Could not calculate green center for flag position. Using default.");
            // Fallback to a default position if center calculation fails
            layoutToReturn.flagPosition = { x: -55, z: 340 };
        }

    } else {
        console.warn("Green definition missing control points. Using default flag position.");
        layoutToReturn.green = { ...(layoutToReturn.green || {}), vertices: [] }; // Ensure vertices array exists
        layoutToReturn.flagPosition = { x: -55, z: 340 }; // Default flag position
    }

    // Process Bunkers: Convert control points to vertices
    if (layoutToReturn.bunkers && Array.isArray(layoutToReturn.bunkers)) {
        layoutToReturn.bunkers.forEach((bunker, index) => {
            if (bunker.controlPoints) {
                bunker.vertices = createSmoothClosedShape(bunker.controlPoints);
                delete bunker.controlPoints; // Remove control points, keep final vertices
                 // Add type:'polygon' for holeView compatibility
                bunker.type = 'polygon';
            } else if (!bunker.vertices && !bunker.center) { // Only warn if no geometry defined
                 console.warn(`Bunker ${index} has no controlPoints, vertices, or center defined.`);
                 bunker.vertices = []; // Ensure vertices array exists
            }
        });
    }

    // Process Water Hazards: Convert control points to vertices
    if (layoutToReturn.waterHazards && Array.isArray(layoutToReturn.waterHazards)) {
        layoutToReturn.waterHazards.forEach((wh, index) => {
            if (wh.controlPoints) {
                wh.vertices = createSmoothClosedShape(wh.controlPoints);
                delete wh.controlPoints; // Remove control points, keep final vertices
                wh.type = 'polygon'; // Add type for holeView compatibility
            } else if (wh.center && wh.radius) { // If it's defined as a circle
                console.warn(`Water Hazard ${index} is defined as a circle. This will not be rendered as a smooth polygon. Consider converting to controlPoints.`);
                // For now, we'll leave it as is, but holeView might not render it correctly if it expects polygons.
                // Or, you could generate approximate polygon vertices from the circle here if needed.
                wh.type = 'circle'; // Keep type as circle if no control points
            } else if (!wh.vertices) { // Only warn if no geometry defined
                 console.warn(`Water Hazard ${index} has no controlPoints, vertices, or center/radius defined.`);
                 wh.vertices = []; // Ensure vertices array exists
                 wh.type = 'polygon'; // Default to polygon type
            }
        });
    }

    // --- Corner Rounding Removed - Using original vertices ---

    // Process Fairway: Use its controlPoints for randomized shaping
    if (layoutToReturn.fairway && layoutToReturn.fairway.controlPoints && layoutToReturn.fairway.controlPoints.length > 0) {
        // Note: The JSON stores these as 'controlPoints' for the fairway.
        const fairwayVertices = createRandomizedFairwayShape(layoutToReturn.fairway.controlPoints);
        layoutToReturn.fairway.vertices = fairwayVertices;
        delete layoutToReturn.fairway.controlPoints; // Remove control points, keep final vertices
        layoutToReturn.fairway.type = 'polygon'; // Ensure type is set
    } else {
        console.warn("Fairway definition missing controlPoints. Cannot apply randomized shaping.");
        layoutToReturn.fairway = { ...(layoutToReturn.fairway || {}), vertices: [], type: 'polygon' }; // Ensure structure
    }

    // Note: Rough is assumed to have 'vertices' directly in the JSON if it's a simple polygon
    // and doesn't need special processing like smoothing here. If it did, similar logic to green/bunkers would apply.
    if (layoutToReturn.rough && layoutToReturn.rough.vertices) {
        layoutToReturn.rough.type = 'polygon';
    }


    return layoutToReturn;
}

// Future function for procedural generation
// export function generateProceduralHole(params) {
//   // ... complex logic using params ...
//   return generatedLayout;
// }
