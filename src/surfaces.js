// src/surfaces.js

export const SURFACES = {
  TEE: { // Added TEE surface
    name: 'Tee Box',
    color: '#6AC46A', // Slightly different green for tee
    bounce: 0.18, // Similar to fairway
    rollOut: 0.50, // Similar to fairway
    spinResponse: 1.2, // How much surface responds to backspin during roll (1.0 = baseline)
    flightModification: {
      spinReduction: 0.0,
      launchAngleChange: 0,
      velocityReduction: 0.00
    },
    // Strike quality factors (for chips/pitches) - 1.0 = baseline (fairway)
    strikeFactors: {
      fatForgiveness: 1.0, // Same as fairway
      thinForgiveness: 1.0  // Same as fairway
    },
    height: 0.03, // Visual height
    ballLieOffset: 0.16 // Same as fairway - ball sits slightly into grass (then tee height is added)
  },
  GREEN: {
    name: 'Green',
    color: '#3A9A3A', // A nice green color
    bounce: 0.30, // Firm surface, higher bounce than fairway (reduced slightly)
    rollOut: 0.90, // High roll out (less friction)
    friction: 0.08, // Low friction for smooth roll (green stimpmeter effect)
    spinResponse: 1.5, // Firm surface = more spin effect
    flightModification: { // Minimal impact on flight from green
      spinReduction: 0.05,
      launchAngleChange: 0,
      velocityReduction: 0.02
    },
    // Strike quality factors (for chips/pitches) - 1.0 = baseline (fairway)
    strikeFactors: {
      fatForgiveness: 0.6, // Very tight lie - less forgiving of fat
      thinForgiveness: 0.7  // Very tight lie - easier to thin
    },
    height: 0.02, // Visual height
    texturePath: 'assets/textures/green.png', // Added texture path
    ballLieOffset: 0.12 // On top
  },
  FAIRWAY: {
    name: 'Fairway',
    color: '#5DBB5D', // Slightly lighter green
    bounce: 0.18, // Moderate grass absorption
    rollOut: 0.50, // Significantly more friction than green
    friction: 0.12, // More friction than green
    spinResponse: 1.0, // Baseline
    flightModification: {
      spinReduction: 0.0,
      launchAngleChange: 0,
      velocityReduction: 0.05
    },
    // Strike quality factors (for chips/pitches) - 1.0 = baseline (fairway)
    strikeFactors: {
      fatForgiveness: 1.0, // Baseline
      thinForgiveness: 1.0  // Baseline
    },
    height: 0.01, // Visual height
    texturePath: 'assets/textures/fairway.png', // Added texture path
    ballLieOffset: 0.11 // Ball sits slightly into the grass
  },
  LIGHT_ROUGH: {
    name: 'Light Rough',
    color: '#228b22', // Paler green
    bounce: 0.14, // Softer grass absorbs more energy
    rollOut: 0.35, // Significant drag from grass
    spinResponse: 0.7, // Softer = less spin effect
    flightModification: {
      spinReduction: [0.05, 0.1], // Range for spin reduction
      launchAngleChange: 0.5, // Slight increase in launch angle possible
      velocityReduction: [0.05, 0.15] // Range for velocity loss
    },
    // Strike quality factors (for chips/pitches) - 1.0 = baseline (fairway)
    strikeFactors: {
      fatForgiveness: 1.1, // Slightly more forgiving both ways - light grass cushions
      thinForgiveness: 1.1  // Ball sits up a bit - easier to get under
    },
    height: 0.00, // Base rough height
    texturePath: 'assets/textures/rough.png', // Added texture path
    ballLieOffset: 0.08 // Slightly into
  },
  MEDIUM_ROUGH: {
    name: 'Medium Rough',
    color: '#228b22', // Even paler green
    bounce: 0.11, // Significantly softer
    rollOut: 0.25, // Heavy friction
    spinResponse: 0.5, // Much less spin effect
    flightModification: {
      spinReduction: [0.1, 0.25], // Range for spin reduction
      launchAngleChange: 1.0, // Can affect launch angle more
      velocityReduction: [0.10, 0.25] // Range for velocity loss
    },
    // Strike quality factors (for chips/pitches) - 1.0 = baseline (fairway)
    strikeFactors: {
      fatForgiveness: 0.8, // Less forgiving of fat - grass grabs the club
      thinForgiveness: 1.3  // Ball sits up more - easier to get under, harder to thin
    },
    height: 0.00, // Visual height (same as light rough for now)
    texturePath: 'assets/textures/rough.png', // Added texture path
    ballLieOffset: -0.05 // Half hidden
  },
  THICK_ROUGH: {
    name: 'Thick Rough',
    color: '#228b22', // Very pale green, almost greyish
    bounce: 0.08, // Very soft, minimal bounce
    rollOut: 0.15, // Ball barely rolls
    spinResponse: 0.3, // Very little spin effect
    flightModification: {
      spinReduction: [0.20, 0.40], // Range for spin reduction
      launchAngleChange: 2.0, // Potential for significant launch angle change
      velocityReduction: [0.10, 0.40] // Range for velocity loss
    },
    // Strike quality factors (for chips/pitches) - 1.0 = baseline (fairway)
    strikeFactors: {
      fatForgiveness: 0.6, // Much less forgiving of fat - thick grass grabs/stops club
      thinForgiveness: 1.5  // Ball sits well up - much easier to get under, harder to thin
    },
    height: 0.00, // Visual height (same as medium rough for now)
    texturePath: 'assets/textures/rough.png', // Added texture path
    ballLieOffset: -0.15 // Almost hidden
  },
  BUNKER: {
    name: 'Bunker',
    color: '#F4A460', // Sandy color
    bounce: 0.06, // Sand absorbs almost all energy
    rollOut: 0.10, // Sand kills roll very quickly
    spinResponse: 0.4, // Sand has some grip but inconsistent
    flightModification: {
      spinReduction: [0.50, 0.75], // Range for spin reduction
      launchAngleChange: 1.5, // Tends to increase launch angle
      velocityReduction: [0.25, 0.45] // Range for velocity loss
    },
    // Strike quality factors (for chips/pitches) - 1.0 = baseline (fairway)
    strikeFactors: {
      fatForgiveness: 2.5, // Very forgiving of fat - sand designed for club to slide through
      thinForgiveness: 0.8  // Less forgiving of thin - ball sits down, easier to blade
    },
    height: 0.04, // Visual height (highest)
    texturePath: 'assets/textures/bunker.png', // Added texture path
    ballLieOffset: 0.08 // Slightly into
  },
  WATER: {
    name: 'Water',
    color: '#4682B4', // Steel blue
    bounce: -1.0, // Special value: stops all physics immediately (no bounce, no roll)
    rollOut: -1.0, // Not used (ball stops on contact)
    flightModification: { // Extreme effects, ball likely lost
      spinReduction: 1.0,
      launchAngleChange: 0, // Not applicable if ball is submerged
      velocityReduction: 1.0 // Stops the ball
    },
    // Strike quality factors (for chips/pitches) - N/A for water
    strikeFactors: {
      fatForgiveness: 1.0,
      thinForgiveness: 1.0
    },
    isPenalty: true, // Flag for penalty stroke/rules
    height: 0.005, // Visual height (above rough, below fairway)
    ballLieOffset: -1 // Submerged (special value)
  },
  OUT_OF_BOUNDS: {
    name: 'Out of Bounds',
    color: '#808080', // Grey
    bounce: -1.0,      // Very low bounce
    rollOut: -1.0,     // Very high friction (low roll out)
    flightModification: { // Significant penalty, but maybe not instant stop like water
      spinReduction: 0.9,
      launchAngleChange: 0,
      velocityReduction: 0.9 // Drastic velocity loss
    },
    // Strike quality factors (for chips/pitches) - N/A for OOB
    strikeFactors: {
      fatForgiveness: 1.0,
      thinForgiveness: 1.0
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

// Get display name from surface key (e.g., 'OUT_OF_BOUNDS' -> 'Out of Bounds')
export function getSurfaceDisplayName(surfaceKey) {
  if (!surfaceKey) return 'Unknown';
  const surface = SURFACES[surfaceKey];
  return surface ? surface.name : surfaceKey; // Fallback to key if not found
}

// --- New Function to get properties including calculated friction ---
const FRICTION_SCALING_FACTOR = 2.0; // Tunable factor - converts rollOut to friction coefficient

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
