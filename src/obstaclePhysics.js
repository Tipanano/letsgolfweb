// Check if ball collides with an obstacle
// Now includes height (Y) checking for realistic 3D collision detection
export function checkObstacleCollision(ballX, ballY, ballZ, ballRadius, obstacles) {
  for (const obstacle of obstacles) {
    // 1. Check 2D distance (X, Z)
    const dx = ballX - obstacle.x;
    const dz = ballZ - obstacle.z;
    const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
    const combinedRadius = ballRadius + obstacle.radius;

    // If ball is outside horizontal radius, no collision
    if (horizontalDistance >= combinedRadius) {
      continue;
    }

    // 2. Check vertical position (Y/height)
    // For trees: collision happens in the foliage area (above trunk)
    // For bushes: collision happens from ground to top of bush
    let minHeight = 0;
    let maxHeight = obstacle.height;

    if (obstacle.type === 'tree' && obstacle.trunkHeight) {
      // Trees: only foliage area matters, trunk can pass through
      minHeight = obstacle.trunkHeight;
    }

    // Check if ball's vertical position is within obstacle's height range
    if (ballY >= minHeight && ballY <= maxHeight) {
      return {
        collided: true,
        obstacle,
        distance: horizontalDistance,
        dx,
        dz
      };
    }
  }

  return { collided: false };
}

// Apply obstacle effects to ball velocity
export function applyObstacleEffect(velocity, collision) {
  if (!collision.collided) return velocity;

  const { obstacle, dx, dz } = collision;

  // Apply slowdown
  const newSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z) * obstacle.slowdownFactor;

  // Determine if ball deflects or passes through
  const shouldDeflect = Math.random() < obstacle.deflectionChance;

  if (shouldDeflect) {
    // Calculate deflection angle
    const obstacleAngle = Math.atan2(dz, dx);
    const deflectionAmount = (Math.random() - 0.5) * 2 * obstacle.maxDeflectionAngle;
    const newAngle = obstacleAngle + deflectionAmount;

    return {
      x: Math.cos(newAngle) * newSpeed,
      z: Math.sin(newAngle) * newSpeed
    };
  } else {
    // Pass through but slow down, maintain direction
    const currentAngle = Math.atan2(velocity.z, velocity.x);

    return {
      x: Math.cos(currentAngle) * newSpeed,
      z: Math.sin(currentAngle) * newSpeed
    };
  }
}

// Complete obstacle collision handling
export function handleObstacleCollision(ballX, ballY, ballZ, ballRadius, velocityX, velocityZ, obstacles) {
  const collision = checkObstacleCollision(ballX, ballY, ballZ, ballRadius, obstacles);

  if (collision.collided) {
    const velocity = { x: velocityX, z: velocityZ };
    const newVelocity = applyObstacleEffect(velocity, collision);
    return {
      collided: true,
      velocityX: newVelocity.x,
      velocityZ: newVelocity.z,
      obstacle: collision.obstacle
    };
  }

  return {
    collided: false,
    velocityX,
    velocityZ
  };
}
