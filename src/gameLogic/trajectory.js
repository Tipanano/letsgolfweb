// --- Trajectory Calculation (Simplified for Putt) ---
// Generates a straight line trajectory for putts based on total distance and side distance, starting from initialPosition.
export function calculatePuttTrajectoryPoints(shotData, initialPosition = { x: 0, y: 0.1, z: 0 }) {
    const puttPoints = [];
    const puttSteps = 10;
    const totalDistance = shotData.totalDistance || 0; // Yards
    const sideDistance = shotData.sideDistance || 0; // Yards

    const totalDistanceMeters = totalDistance / 1.09361;
    const sideDistanceMeters = sideDistance / 1.09361;

    // Calculate end point based on total distance and side distance
    // Assume totalDistance is along the Z-axis if sideDistance is 0
    // Use Pythagorean theorem if sideDistance is non-zero: totalDist^2 = endZ^2 + endX^2
    // endX = sideDistanceMeters
    // endZ = sqrt(totalDistanceMeters^2 - sideDistanceMeters^2)
    let endZ = totalDistanceMeters;
    let endX = sideDistanceMeters;
    if (Math.abs(sideDistanceMeters) > 0.01 && totalDistanceMeters > Math.abs(sideDistanceMeters)) {
         endZ = Math.sqrt(totalDistanceMeters * totalDistanceMeters - sideDistanceMeters * sideDistanceMeters);
    } else if (totalDistanceMeters < Math.abs(sideDistanceMeters)) {
        // If side distance is somehow larger than total, just use side as X and Z=0
        endZ = 0;
        endX = sideDistanceMeters > 0 ? totalDistanceMeters : -totalDistanceMeters;
    }

    // Start point is the provided initialPosition
    const startX = initialPosition.x;
    const startY = initialPosition.y; // Use the y from initial position
    const startZ = initialPosition.z;
    puttPoints.push({ x: startX, y: startY, z: startZ });

    for (let i = 1; i <= puttSteps; i++) {
        const progress = i / puttSteps;
        puttPoints.push({
            x: startX + endX * progress, // Add delta to start position
            y: startY, // Stays at the initial ground level
            z: startZ + endZ * progress  // Add delta to start position
        });
    }
    const finalPoint = puttPoints[puttPoints.length - 1] || initialPosition;
    console.log(`Trajectory (Putt): Generated ${puttPoints.length} points. Start: (${startX.toFixed(1)}, ${startY.toFixed(1)}, ${startZ.toFixed(1)})m, End: (${finalPoint.x.toFixed(1)}, ${finalPoint.y.toFixed(1)}, ${finalPoint.z.toFixed(1)})m`);
    return puttPoints;
}
