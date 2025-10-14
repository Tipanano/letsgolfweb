// Check if ball collides with an obstacle
export function checkObstacleCollision(ballX, ballZ, ballRadius, obstacles) {
  for (const obstacle of obstacles) {
    const dx = ballX - obstacle.x;
    const dz = ballZ - obstacle.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const combinedRadius = ballRadius + obstacle.radius;

    if (distance < combinedRadius) {
      return {
        collided: true,
        obstacle,
        distance,
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
export function handleObstacleCollision(ballX, ballZ, ballRadius, velocityX, velocityZ, obstacles) {
  const collision = checkObstacleCollision(ballX, ballZ, ballRadius, obstacles);

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
