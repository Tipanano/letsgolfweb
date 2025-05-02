// src/holeGenerator.js
import { SURFACES } from './surfaces.js'; // We might use colors later

// Simple hardcoded hole data structure
const basicHoleLayout = {
    par: 4,
    lengthYards: 350,
    tee: { // Simple rectangle shape defined by center, width, depth
        center: { x: 0, z: -5 }, // Position relative to the conceptual 'start' of the hole
        width: 10,
        depth: 10,
        surface: SURFACES.FAIRWAY // Use Fairway properties/color for tee for now
    },
    fairway: { // Polygon vertices (x, z) relative to the hole start
        vertices: [
            { x: -15, z: 0 },
            { x: 15, z: 0 },
            { x: 15, z: 330 }, // Ends slightly before the green center
            { x: -15, z: 330 }
        ],
        surface: SURFACES.FAIRWAY
    },
    rough: { // Polygon vertices for the entire playable area minus hazards
        vertices: [
            { x: -40, z: -15 }, // Start behind the tee
            { x: 40, z: -15 },
            { x: 40, z: 375 }, // Extend past the green
            { x: -40, z: 375 }
        ],
        surface: SURFACES.MEDIUM_ROUGH // Default rough type
    },
    green: { // Circle shape
        center: { x: 0, z: 350 }, // Position relative to the hole start
        radius: 15,
        surface: SURFACES.GREEN
    },
    flagPosition: { x: 0, z: 350 } // Same as green center for this basic hole
    // We can add rough, bunkers etc. later
};

/**
 * Generates a basic, hardcoded hole layout.
 * In the future, this will contain procedural generation logic.
 * @returns {object} An object describing the hole layout.
 */
export function generateBasicHole() {
    console.log("Generating basic hole layout.");
    // For now, just return a deep copy of the hardcoded layout
    // In a real scenario, this function would dynamically create the layout.
    return JSON.parse(JSON.stringify(basicHoleLayout));
}

// Future function for procedural generation
// export function generateProceduralHole(params) {
//   // ... complex logic using params ...
//   return generatedLayout;
// }
