// src/holeGenerator.js
import { SURFACES } from './surfaces.js'; // We might use colors later

// Simple hardcoded hole data structure
const basicHoleLayout = {
    par: 4,
    lengthYards: 350,
    background: { // Define the outer limits of the viewable/playable area
        // Using a polygon for consistency, even though it's rectangular
        vertices: [
            { x: -100, z: -30 }, // Bottom-left
            { x: 100, z: -30 },  // Bottom-right
            { x: 100, z: 400 },  // Top-right
            { x: -100, z: 400 }  // Top-left
        ],
        surface: SURFACES.OUT_OF_BOUNDS
    },
    tee: { // Simple rectangle shape defined by center, width, depth
        center: { x: 0, z: -5 }, // Position relative to the conceptual 'start' of the hole
        width: 10,
        depth: 10,
        surface: SURFACES.TEE // Use the new TEE surface type
    },
    fairway: { // Narrower S-shape, starts z=150
        vertices: [
             // Start at z=150
            { x: 10, z: 150 }, // Inner start point (left side of fairway)
            { x: 50, z: 150 }, // Outer start point (right side of fairway) - Adjusted to match rough curve start

            // --- Right Turn Section (Outer edge) ---
            { x: 50, z: 170 }, // Straighten briefly (matches rough point)
            { x: 25, z: 270 }, // Angle back left sharply (narrower than rough's x=40, z=280)

            // --- Left Turn Section (Outer edge) ---
            { x: -10, z: 290 }, // Curve sharply left (narrower than rough's x=10, z=310)
            { x: -10, z: 360 }, // Straight section left (ends before green)

            // --- Top Edge (Near Green) ---
            { x: -80, z: 360 }, // Narrower top edge

            // --- Left Turn Section (Inner edge) ---
            { x: -80, z: 290 }, // Straight section left (inner)
            { x: -15, z: 270 }, // Curve back right (narrower than rough's x=-50, z=280)

            // --- Right Turn Section (Inner edge) ---
            { x: 10, z: 170 }, // Angle back right sharply (inner) (matches rough's inner point x=-15, z=180 area)

            // Close path back to start { x: 10, z: 150 } is implicit
        ],
        surface: SURFACES.FAIRWAY
    },
    rough: { // Wider, Gentler S-shape
        vertices: [
            // Start behind tee (bottom edge) - Wider
            { x: -50, z: -15 },
            { x: 50, z: -15 },

            // --- Gentler Right Turn Section ---
            { x: 50, z: 120 }, // Straighter longer
            { x: 65, z: 150 }, // Gentler curve right
            { x: 65, z: 180 }, // Straighter longer right
            { x: 40, z: 280 }, // Gentler angle back left

            // --- Gentler Left Turn Section ---
            { x: 10, z: 310 }, // Gentler curve left
            { x: 10, z: 380 }, // Straight section left

            // --- Top Edge --- (Wide enough for green)
            { x: -80, z: 380 },

            // --- Left Turn Section (coming back down left side) ---
            { x: -80, z: 310 }, // Straight section left
            { x: -50, z: 280 }, // Gentler curve back right

            // --- Right Turn Section (coming back down left side) ---
            { x: -15, z: 180 }, // Gentler angle back right (inner)
            { x: -15, z: 150 }, // Straighter longer right (inner)
            { x: -30, z: 120 }, // Gentler curve back left (inner)

            // Close path back to start { x: -50, z: -15 } is implicit
        ],
        surface: SURFACES.MEDIUM_ROUGH
    },
    green: { // Positioned for final left turn
        center: { x: -55, z: 340 }, // Keep position from extreme S
        radius: 15,
        surface: SURFACES.GREEN
    },
    flagPosition: { x: -55, z: 340 }, // Match green center
    // We can add rough, bunkers etc. later
    bunkers: [ // Added bunkers array
        { // Bunker 1: ~250 yards out, right side
            type: 'circle', // Specify shape type
            center: { x: 30, z: 250 },
            radius: 8,
            surface: SURFACES.BUNKER
        },
        { // Bunker 2: Wide bunker in front of green
            type: 'polygon', // Specify shape type
            vertices: [
                { x: -70, z: 320 }, // Bottom-left
                { x: -40, z: 320 }, // Bottom-right
                { x: -45, z: 335 }, // Top-right (angled)
                { x: -65, z: 335 }  // Top-left (angled)
            ],
            surface: SURFACES.BUNKER
        }
    ],
    waterHazards: [ // Added water hazards array
        { // Water 1: Left of the green
            type: 'circle',
            center: { x: -80, z: 340 },
            radius: 10,
            surface: SURFACES.WATER
        }
    ]
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
