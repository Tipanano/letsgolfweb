// src/holeGenerator.js
import { SURFACES } from './surfaces.js';
// Import utility functions (removed createRoundedPolygonShape)
import { createSmoothClosedShape, calculatePolygonCenter } from './shapeUtils.js';

// Define control points for shapes that will be smoothed
const greenControlPoints = [
    { x: -55, z: 325 }, // Bottom
    { x: -70, z: 335 }, // Bottom-left
    { x: -75, z: 345 }, // Left
    { x: -65, z: 355 }, // Top-left
    { x: -50, z: 358 }, // Top
    { x: -40, z: 350 }, // Top-right
    { x: -40, z: 335 }  // Bottom-right
];

const bunker1ControlPoints = [
    { x: 30, z: 242 }, // Bottom
    { x: 38, z: 246 }, // Bottom-right
    { x: 36, z: 256 }, // Top-right
    { x: 28, z: 258 }, // Top
    { x: 22, z: 254 }, // Top-left
    { x: 24, z: 245 }  // Bottom-left
];

const bunker2ControlPoints = [
    { x: -70, z: 320 },
    { x: -40, z: 320 },
    { x: -45, z: 335 },
    { x: -65, z: 335 }
];

// Simple hardcoded hole data structure using control points where needed
const basicHoleLayout = {
    par: 4,
    lengthYards: 350,
    background: { // Define the outer limits of the viewable/playable area
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
    fairway: { // Narrower S-shape, starts z=150 (Keep vertices for now)
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
    rough: { // Wider, Gentler S-shape (Keep vertices for now)
        vertices: [
            // Start behind tee (bottom edge) - Wider
            { x: -50, z: -15 }, { x: 50, z: -15 },
            // --- Gentler Right Turn Section ---
            { x: 50, z: 120 }, { x: 65, z: 150 }, { x: 65, z: 180 }, { x: 40, z: 280 },
            // --- Gentler Left Turn Section ---
            { x: 10, z: 310 }, { x: 10, z: 380 },
            // --- Top Edge --- (Wide enough for green)
            { x: -80, z: 380 },
            // --- Left Turn Section (coming back down left side) ---
            { x: -80, z: 310 }, { x: -50, z: 280 },
            // --- Right Turn Section (coming back down left side) ---
            { x: -15, z: 180 }, { x: -15, z: 150 }, { x: -30, z: 120 },
            // Close path back to start { x: -50, z: -15 } is implicit
        ],
        surface: SURFACES.THICK_ROUGH
    },
    green: { // Define using control points
        controlPoints: greenControlPoints,
        surface: SURFACES.GREEN
        // Removed center and radius
    },
    // flagPosition will be calculated dynamically now
    // flagPosition: { x: -55, z: 340 },
    bunkers: [
        { // Bunker 1: Use control points
            controlPoints: bunker1ControlPoints,
            surface: SURFACES.BUNKER
            // Removed type, center, radius
        },
        { // Bunker 2: Use control points
            controlPoints: bunker2ControlPoints,
            surface: SURFACES.BUNKER
            // Removed type, vertices
        }
    ],
    waterHazards: [ // Keep water as circle for now
        {
            type: 'circle',
            center: { x: -80, z: 340 },
            radius: 10,
            surface: SURFACES.WATER
        }
    ]
};

/**
 * Generates a basic, hardcoded hole layout, processing control points into vertices.
 * @returns {object} An object describing the hole layout with final vertices.
 */
export function generateBasicHole() {
    console.log("Generating basic hole layout and processing shapes...");

    // Create a deep copy to avoid modifying the original template
    const layoutToReturn = JSON.parse(JSON.stringify(basicHoleLayout));

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
            console.log(`Calculated flag position (green center): x=${greenCenter.x.toFixed(1)}, z=${greenCenter.z.toFixed(1)}`);
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

    // Water hazards are still circles, no processing needed here yet.

    // --- Corner Rounding Removed - Using original vertices ---


    console.log("Finished processing shapes for hole layout.");
    return layoutToReturn;
}

// Future function for procedural generation
// export function generateProceduralHole(params) {
//   // ... complex logic using params ...
//   return generatedLayout;
// }
