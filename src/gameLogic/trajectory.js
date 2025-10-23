// --- Trajectory Calculation (Simplified for Putt) ---
// Generates a straight line trajectory for putts based on the final horizontal angle and total distance, starting from initialPosition.
export function calculatePuttTrajectoryPoints(shotData, initialPosition = { x: 0, y: 0.1, z: 0 }) {
    const puttPoints = [];
    const puttSteps = 10; // Number of points to generate for the line

    // Get data from shotData
    const totalDistanceMeters = shotData.totalDistance || 0; // Already in meters
    const finalAngleDegrees = shotData.horizontalLaunchAngle || 0; // This is the final absolute angle

    // Convert angle to radians
    const finalAngleRadians = finalAngleDegrees * Math.PI / 180;

    // Calculate the displacement vector based on angle and distance
    const deltaX = totalDistanceMeters * Math.sin(finalAngleRadians);
    const deltaZ = totalDistanceMeters * Math.cos(finalAngleRadians);

    // Start point is the provided initialPosition
    const startX = initialPosition.x;
    const startY = initialPosition.y; // Use the y from initial position (ground level)
    const startZ = initialPosition.z;
    puttPoints.push({ x: startX, y: startY, z: startZ });

    // Calculate end point
    const endX = startX + deltaX;
    const endY = startY; // Putt stays on the ground
    const endZ = startZ + deltaZ;

    // Generate intermediate points by linear interpolation
    for (let i = 1; i <= puttSteps; i++) {
        const progress = i / puttSteps;
        puttPoints.push({
            x: startX + deltaX * progress,
            y: startY, // Stays at the initial ground level
            z: startZ + deltaZ * progress
        });
    }

    const finalPoint = puttPoints[puttPoints.length - 1] || initialPosition;
    return puttPoints;
}
