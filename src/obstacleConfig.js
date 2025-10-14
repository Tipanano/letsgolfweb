// Obstacle types and their default properties
export const OBSTACLE_TYPES = {
  TREE: 'tree',
  BUSH: 'bush'
};

export const OBSTACLE_SIZES = {
  SMALL: 'small',
  MEDIUM: 'medium',
  LARGE: 'large'
};

// Default properties for each obstacle type and size
export const OBSTACLE_DEFAULTS = {
  tree: {
    small: {
      radius: 0.4,
      height: 9,
      trunkRadius: 0.15,
      trunkHeight: 3,
      foliageRadius: 1.2,
      slowdownFactor: 0.5,
      deflectionChance: 0.7,
      maxDeflectionAngle: Math.PI / 3, // 60 degrees
      color: 0x2d5016
    },
    medium: {
      radius: 0.6,
      height: 14,
      trunkRadius: 0.3,
      trunkHeight: 5,
      foliageRadius: 1.8,
      slowdownFactor: 0.4,
      deflectionChance: 0.8,
      maxDeflectionAngle: Math.PI / 2.5, // ~72 degrees
      color: 0x2d5016
    },
    large: {
      radius: 1.0,
      height: 20,
      trunkRadius: 0.5,
      trunkHeight: 7,
      foliageRadius: 2.5,
      slowdownFactor: 0.3,
      deflectionChance: 0.9,
      maxDeflectionAngle: Math.PI / 2, // 90 degrees
      color: 0x2d5016
    }
  },
  bush: {
    small: {
      radius: 0.4,
      height: 1,
      slowdownFactor: 0.6,
      deflectionChance: 0.4,
      maxDeflectionAngle: Math.PI / 4, // 45 degrees
      color: 0x3a6b1f
    },
    medium: {
      radius: 0.7,
      height: 1.5,
      slowdownFactor: 0.5,
      deflectionChance: 0.5,
      maxDeflectionAngle: Math.PI / 3, // 60 degrees
      color: 0x3a6b1f
    },
    large: {
      radius: 1.0,
      height: 2,
      slowdownFactor: 0.4,
      deflectionChance: 0.6,
      maxDeflectionAngle: Math.PI / 2.5, // ~72 degrees
      color: 0x3a6b1f
    }
  }
};

// Helper to get obstacle properties
export function getObstacleProperties(type, size) {
  return OBSTACLE_DEFAULTS[type]?.[size] || OBSTACLE_DEFAULTS.bush.small;
}

// Helper to create obstacle data
export function createObstacle(type, size, x, z) {
  const props = getObstacleProperties(type, size);
  return {
    type,
    size,
    x,
    z,
    ...props
  };
}
