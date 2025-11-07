// Generate CTF hole configuration (matches server-side logic in gameManager.js)
// Can be used for single-player or as fallback

export function generateCTFHoleConfig(targetDistanceMeters = null) {
    // Use provided target distance, or generate random distance between 110-183 meters (approx 120-200 yards)
    const distanceMeters = targetDistanceMeters || (Math.floor(Math.random() * (183 - 110 + 1)) + 110);

    // Generate hole placement within the green (percentage from center)
    // 0 = dead center, -1 to 1 for left/right positioning
    const holePositionX = (Math.random() * 2 - 1) * 0.8; // -0.8 to 0.8 (80% of green width)
    const holePositionY = (Math.random() * 2 - 1) * 0.6; // -0.6 to 0.6 (60% of green depth)

    // Green offset from center line (left/right) - varies based on distance
    // Shorter holes = smaller potential offset, longer holes = larger offset
    const maxOffset = Math.min(distanceMeters * 0.15, 30); // Max 15% of distance or 30m
    const greenOffsetMeters = (Math.random() * 2 - 1) * maxOffset;

    const config = {
        distanceMeters,              // Target distance in meters
        greenOffsetMeters,           // How far left/right the green is from center line (meters)
        holePositionX,               // Hole position within green (-1 to 1, left to right)
        holePositionY,               // Hole position within green (-1 to 1, front to back)
        greenWidthMeters: 18,        // Standard green width in meters (~20 yards)
        greenDepthMeters: 14         // Standard green depth in meters (~15 yards)
    };

    // 25% chance of water hazard
    if (Math.random() < 0.25) {
        config.waterHazard = generateWaterHazard(distanceMeters, greenOffsetMeters, config.greenWidthMeters, config.greenDepthMeters);
    }

    // Generate seed for organic shape variations (ensures consistent shapes in single-player regeneration)
    config.shapeSeed = Math.random();

    return config;
}

function generateWaterHazard(distanceMeters, greenOffsetMeters, greenWidthMeters, greenDepthMeters) {
    // Randomly choose position: front, left, right, or behind green
    const positions = ['front', 'left', 'right', 'behind'];
    const position = positions[Math.floor(Math.random() * positions.length)];

    // Water hazard base size (8-12 meters)
    const baseSize = 8 + Math.random() * 4;

    // Create elliptical water with varied dimensions
    // Front/behind: wider (perpendicular to line of play)
    // Left/right: longer (along line of play)
    let radiusX, radiusZ;

    if (position === 'front' || position === 'behind') {
        radiusX = baseSize * (1.2 + Math.random() * 0.4); // 1.2-1.6x wider
        radiusZ = baseSize * (0.6 + Math.random() * 0.3); // 0.6-0.9x depth
    } else { // left or right
        radiusX = baseSize * (0.6 + Math.random() * 0.3); // 0.6-0.9x width
        radiusZ = baseSize * (1.2 + Math.random() * 0.4); // 1.2-1.6x longer
    }

    // Calculate center position based on position relative to green
    const greenCenterZ = distanceMeters;
    let centerX, centerZ;

    switch (position) {
        case 'front':
            centerX = greenOffsetMeters;
            centerZ = greenCenterZ + greenDepthMeters / 2 + radiusZ - 1; // ~5m overlap with green
            break;
        case 'behind':
            centerX = greenOffsetMeters;
            centerZ = greenCenterZ - greenDepthMeters / 2 - radiusZ - 1; // ~5m overlap with green
            break;
        case 'left':
            centerX = greenOffsetMeters - greenWidthMeters / 2 - radiusX - 1; // ~5m overlap with green
            centerZ = greenCenterZ;
            break;
        case 'right':
            centerX = greenOffsetMeters + greenWidthMeters / 2 + radiusX - 1; // ~5m overlap with green
            centerZ = greenCenterZ;
            break;
    }

    // Calculate fairway adjustments based on water position
    let fairwayApproachDistance, fairwayExtension, leftWidthMultiplier, rightWidthMultiplier;

    if (position === 'front') {
        fairwayApproachDistance = 30;
        fairwayExtension = 0;
        leftWidthMultiplier = 1.0;
        rightWidthMultiplier = 1.0;
    } else if (position === 'behind') {
        fairwayApproachDistance = 40;
        fairwayExtension = 12;
        leftWidthMultiplier = 1.0;
        rightWidthMultiplier = 1.0;
    } else if (position === 'left') {
        fairwayApproachDistance = 40;
        fairwayExtension = 10;
        leftWidthMultiplier = 0.65;
        rightWidthMultiplier = 1.0;
    } else { // right
        fairwayApproachDistance = 40;
        fairwayExtension = 10;
        leftWidthMultiplier = 1.0;
        rightWidthMultiplier = 0.65;
    }

    return {
        type: 'ellipse',
        center: { x: centerX, z: centerZ },
        radiusX: radiusX, // Width (left-right)
        radiusZ: radiusZ, // Depth (front-back)
        position: position, // For debugging/logging
        surface: {
            name: 'Water',
            color: '#4682B4',
            height: 0.005
        },
        fairwayAdjustments: {
            approachDistance: fairwayApproachDistance,
            extension: fairwayExtension,
            leftWidthMultiplier: leftWidthMultiplier,
            rightWidthMultiplier: rightWidthMultiplier
        }
    };
}

// Convert meters to yards for display
export function metersToYards(meters) {
    return meters * 1.09361;
}

// Convert yards to meters
export function yardsToMeters(yards) {
    return yards / 1.09361;
}

/**
 * Converts CTF hole config to a minimal holeLayout for surface detection
 * This allows getSurfaceTypeAtPoint to work correctly in CTF mode
 */
export function ctfConfigToHoleLayout(holeConfig) {
    if (!holeConfig) return null;

    const layout = {};
    const distance = holeConfig.distanceMeters || 200;
    const greenOffset = holeConfig.greenOffsetMeters || 0;
    const greenWidth = holeConfig.greenWidthMeters || 18;
    const greenDepth = holeConfig.greenDepthMeters || 14;

    // Get fairway adjustments from water hazard (if present)
    const waterHazard = holeConfig.waterHazard;
    const fairwayAdjustments = waterHazard?.fairwayAdjustments;

    const fairwayWidth = 25; // Base width in meters (matches visual)
    const fairwayExtension = fairwayAdjustments?.extension ?? 10;
    const fairwayApproachDistance = fairwayAdjustments?.approachDistance ?? 40;
    const leftWidthMultiplier = fairwayAdjustments?.leftWidthMultiplier ?? 1.0;
    const rightWidthMultiplier = fairwayAdjustments?.rightWidthMultiplier ?? 1.0;

    // Add large light rough area (CTF default landing surface)
    // Make it very large to catch all possible shots in CTF mode
    // Visual fairway is shown for aesthetics, but all shots land in light rough for consistent gameplay
    const margin = 300; // 300m margin on each side (catches wide shots)
    const backMargin = 100; // Behind tee
    const frontMargin = 200; // Beyond target (catches long shots)
    layout.lightRough = [{
        vertices: [
            { x: -margin, z: -backMargin },
            { x: margin, z: -backMargin },
            { x: margin, z: distance + frontMargin },
            { x: -margin, z: distance + frontMargin }
        ]
    }];

    // CTF mode: Light rough for all shots (except green/water)
    // Fairway is visual only - doesn't affect lie detection

    // Add green (rectangular, positioned based on greenOffset)
    const greenCenterX = greenOffset;
    const greenCenterZ = distance;
    layout.green = {
        type: 'polygon',
        vertices: [
            { x: greenCenterX - greenWidth / 2, z: greenCenterZ - greenDepth / 2 },
            { x: greenCenterX + greenWidth / 2, z: greenCenterZ - greenDepth / 2 },
            { x: greenCenterX + greenWidth / 2, z: greenCenterZ + greenDepth / 2 },
            { x: greenCenterX - greenWidth / 2, z: greenCenterZ + greenDepth / 2 }
        ],
        surface: 'GREEN'
    };

    // Add water hazard if present
    if (waterHazard) {
        layout.waterHazards = [{
            type: waterHazard.type, // 'ellipse'
            center: {
                x: waterHazard.center.x, // Keep in meters
                z: waterHazard.center.z
            },
            radiusX: waterHazard.radiusX, // Keep in meters
            radiusZ: waterHazard.radiusZ, // Keep in meters
            surface: waterHazard.surface
        }];
    }

    return layout;
}
