// --- Trajectory Calculation (Common for Full/Chip) ---
// NOTE: This function relies on shotData containing the results from physics and simulation
// (e.g., carryDistance, peakHeight, sideSpin, absoluteFaceAngle, rolloutDistance)
// Returns an array of {x, y, z} points representing the visual trajectory.
export function calculateTrajectoryPoints(shotData) {
    const airPoints = []; // Points during flight
    const rollPoints = []; // Points during roll
    const airSteps = 50; // Number of points in the air line
    const rollSteps = 10; // Number of points for the roll segment

    const carryYards = shotData.carryDistance;
    const peakYards = shotData.peakHeight;
    // Use sideSpin directly from shotData. Positive = Slice (right), Negative = Hook (left)
    // Simple linear deviation model (needs tuning)
    const sideDeviationYards = shotData.sideSpin / 150;

    // Convert yards to scene units (meters)
    const carryMeters = carryYards / 1.09361;
    const peakMeters = peakYards / 1.09361;
    // Positive side deviation (slice) should result in positive X (right visually)
    const sideDeviationMeters = sideDeviationYards / 1.09361;

    // Initial horizontal launch angle based on face angle
    const initialLaunchAngleRad = shotData.absoluteFaceAngle * Math.PI / 180;
    const tanInitialLaunch = Math.tan(initialLaunchAngleRad);

    // Simple parabolic trajectory calculation (y vs z)
    const h = carryMeters / 2; // z-coordinate of vertex
    const k = peakMeters;      // y-coordinate of vertex
    const a = (k > 0.2) ? (0.2 - k) / (h * h) : 0; // Avoid issues if peak is below start

    // Calculate air points
    for (let i = 0; i <= airSteps; i++) {
        const progress = i / airSteps; // 0 to 1
        const z = progress * carryMeters;

        // Calculate vertical position (parabola)
        let y = (a !== 0) ? a * (z - h) * (z - h) + k : 0.2;
        y = Math.max(0.2, y); // Ensure y doesn't go below ground

        // Calculate horizontal position (quadratic curve for side deviation vs z)
        // x = initial direction + spin curve
        // initial direction = z * tan(initial angle)
        // spin curve = c_side * z^2 (where c_side makes curve end at sideDeviationMeters)
        let x = z * tanInitialLaunch; // Start with linear initial direction
        if (carryMeters > 0.1) { // Avoid division by zero for spin curve
             // const c_side = sideDeviationMeters / (carryMeters * carryMeters); // Original calculation
             // Add the quadratic curve for spin deviation
             // We need to adjust the target deviation for the curve calculation
             // Target deviation for curve = final deviation - deviation from initial angle at carry
             const curveTargetDeviation = sideDeviationMeters - (carryMeters * tanInitialLaunch);
             const c_side_adjusted = curveTargetDeviation / (carryMeters * carryMeters);
             x += c_side_adjusted * z * z;
         }
        airPoints.push({ x: x, y: y, z: z });
    }

    // Calculate roll points (straight line from landing point)
    const landingPoint = airPoints[airSteps] || { x: 0, y: 0.2, z: 0 }; // Last point or default
    const rolloutMeters = (shotData.rolloutDistance || 0) / 1.09361;
    // const totalDistanceMeters = carryMeters + rolloutMeters; // Not needed here

    if (Math.abs(rolloutMeters) > 0.1 && rollSteps > 0) { // Add roll if significant (positive or negative)
        const rollStartX = landingPoint.x;
        const rollStartZ = landingPoint.z;
        // Roll direction based on the vector from origin (0,0) to landing point
        let directionX = landingPoint.x; // Vector component X from origin
        let directionZ = landingPoint.z; // Vector component Z from origin
        const length = Math.sqrt(directionX * directionX + directionZ * directionZ);

        if (length > 0.001) {
            directionX /= length;
            directionZ /= length;
        } else { // If landing point is same as previous, assume roll goes straight forward
            directionX = 0;
            directionZ = 1;
        }

        for (let i = 1; i <= rollSteps; i++) {
            const rollProgress = i / rollSteps;
            const currentRollDistance = rollProgress * rolloutMeters; // Handles negative roll

            const x = rollStartX + directionX * currentRollDistance;
            const z = rollStartZ + directionZ * currentRollDistance;
             const y = 0.2; // Ball sits on the ground
             // Use the calculated X directly for roll points as well.
             rollPoints.push({ x: x, y: y, z: z });
         }
    }

    const allPoints = [...airPoints, ...rollPoints];

    if (allPoints.length > 0) {
        console.log(`Trajectory: Calculated ${airPoints.length} air + ${rollPoints.length} roll points. End: (${allPoints[allPoints.length - 1].x.toFixed(1)}, ${allPoints[allPoints.length - 1].y.toFixed(1)}, ${allPoints[allPoints.length - 1].z.toFixed(1)})`);
    } else {
        console.warn("Trajectory: No points generated.");
        allPoints.push({ x: 0, y: 0.2, z: 0 }); // Add starting point if empty
    }
    return allPoints;
}

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
