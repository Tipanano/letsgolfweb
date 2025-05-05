// src/surfaces.js

export const SURFACES = {
  TEE: { // Added TEE surface
    name: 'Tee Box',
    color: '#6AC46A', // Slightly different green for tee
    bounce: 0.4,
    rollOut: 0.90,
    flightModification: {
      spinReduction: 0.1,
      launchAngleChange: 0,
      velocityReduction: 0.05
    },
    height: 0.03, // Visual height
    ballLieOffset: 0.8 // On top
  },
  GREEN: {
    name: 'Green',
    color: '#3A9A3A', // A nice green color
    bounce: 0.3, // Low bounce
    rollOut: 0.95, // High roll out (less friction)
    flightModification: { // Minimal impact on flight from green
      spinReduction: 0.05,
      launchAngleChange: 0,
      velocityReduction: 0.02
    },
    height: 0.02, // Visual height
    texturePath: 'assets/textures/green.png', // Added texture path
    ballLieOffset: 0 // On top
  },
  FAIRWAY: {
    name: 'Fairway',
    color: '#5DBB5D', // Slightly lighter green
    bounce: 0.4, // Slightly more bounce than green
    rollOut: 0.90, // Slightly less roll out than green
    flightModification: {
      spinReduction: 0.1,
      launchAngleChange: 0,
      velocityReduction: 0.05
    },
    height: 0.01, // Visual height
    texturePath: 'assets/textures/fairway.png', // Added texture path
    ballLieOffset: +0.16 // Slightly into
  },
  LIGHT_ROUGH: {
    name: 'Light Rough',
    color: '#228b22', // Paler green
    bounce: 0.5, // More bounce
    rollOut: 0.80, // More friction
    flightModification: {
      spinReduction: 0.25, // Noticeable spin reduction
      launchAngleChange: 0.5, // Slight increase in launch angle possible
      velocityReduction: 0.15 // More velocity lost
    },
    height: 0.00, // Base rough height
    texturePath: 'assets/textures/rough.png', // Added texture path
    ballLieOffset: 0.08 // Slightly into
  },
  MEDIUM_ROUGH: {
    name: 'Medium Rough',
    color: '#228b22', // Even paler green
    bounce: 0.55, // Similar bounce to light rough
    rollOut: 0.70, // Significant friction
    flightModification: {
      spinReduction: 0.45, // Significant spin reduction
      launchAngleChange: 1.0, // Can affect launch angle more
      velocityReduction: 0.25 // Significant velocity loss
    },
    height: 0.00, // Visual height (same as light rough for now)
    texturePath: 'assets/textures/rough.png', // Added texture path
    ballLieOffset: -0.05 // Half hidden
  },
  THICK_ROUGH: {
    name: 'Thick Rough',
    color: '#228b22', // Very pale green, almost greyish
    bounce: 0.6, // High bounce, unpredictable
    rollOut: 0.50, // Very high friction
    flightModification: {
      spinReduction: 0.70, // Massive spin reduction
      launchAngleChange: 2.0, // Potential for significant launch angle change
      velocityReduction: 0.40 // Huge velocity loss
    },
    height: 0.00, // Visual height (same as medium rough for now)
    texturePath: 'assets/textures/rough.png', // Added texture path
    ballLieOffset: -0.15 // Almost hidden
  },
  BUNKER: {
    name: 'Bunker',
    color: '#F4A460', // Sandy color
    bounce: 0.2, // Very low bounce (absorbs energy)
    rollOut: 0.60, // High friction, but different from rough
    flightModification: {
      spinReduction: 0.60, // Hard to generate spin
      launchAngleChange: 1.5, // Tends to increase launch angle
      velocityReduction: 0.35 // Significant velocity loss
    },
    height: 0.04, // Visual height (highest)
    texturePath: 'assets/textures/bunker.png', // Added texture path
    ballLieOffset: 0.08 // Slightly into
  },
  WATER: {
    name: 'Water',
    color: '#4682B4', // Steel blue
    bounce: 0.1, // Minimal bounce
    rollOut: 0.1, // Ball stops almost immediately (or sinks)
    flightModification: { // Extreme effects, ball likely lost
      spinReduction: 1.0,
      launchAngleChange: 0, // Not applicable if ball is submerged
      velocityReduction: 1.0 // Stops the ball
    },
    isPenalty: true, // Flag for penalty stroke/rules
    height: 0.005, // Visual height (above rough, below fairway)
    ballLieOffset: -1 // Submerged (special value)
  },
  OUT_OF_BOUNDS: {
    name: 'Out of Bounds',
    color: '#808080', // Grey
    bounce: 0.1,      // Very low bounce
    rollOut: 0.1,     // Very high friction (low roll out)
    flightModification: { // Significant penalty, but maybe not instant stop like water
      spinReduction: 0.9,
      launchAngleChange: 0,
      velocityReduction: 0.9 // Drastic velocity loss
    },
    isPenalty: true, // Flag for penalty stroke/rules
    height: -0.01, // Visual height (lowest)
    ballLieOffset: 0 // On top
  }
};

// Function to get surface by name (optional helper)
export function getSurfaceByName(name) {
  for (const key in SURFACES) {
    if (SURFACES[key].name === name) {
      return SURFACES[key];
    }
  }
  return null; // Or return a default surface like FAIRWAY
}

// --- New Function to get properties including calculated friction ---
const FRICTION_SCALING_FACTOR = 10.0; // Tunable factor (Increased from 1.0)

/**
 * Gets surface properties including a calculated friction coefficient.
 * @param {string} surfaceTypeName - The name key (e.g., 'GREEN', 'FAIRWAY'). Case-insensitive.
 * @returns {object | null} An object with surface properties including 'friction', or null if not found.
 */
export function getSurfaceProperties(surfaceTypeName) {
    if (!surfaceTypeName) return null;

    const upperCaseName = surfaceTypeName.toUpperCase().replace(' ', '_'); // Handle names like 'Light Rough'
    const surface = SURFACES[upperCaseName];

    if (!surface) {
        console.warn(`Surface type "${surfaceTypeName}" (mapped to "${upperCaseName}") not found. Using default friction.`);
        // Return a default object or null? Let's return null for now.
        return null;
        // Or return a default:
        // return { name: 'Default', friction: 0.1, bounce: 0.4, color: '#888888' };
    }

    // Calculate friction coefficient based on rollOut
    // Higher rollOut means lower friction. Simple inverse scaling.
    const friction = Math.max(0.01, FRICTION_SCALING_FACTOR * (1 - (surface.rollOut || 0)));

    // Return a copy of the surface properties plus the calculated friction
    return {
        ...surface,
        friction: friction
    };
}
