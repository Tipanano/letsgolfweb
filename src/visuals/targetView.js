// Visuals for the "Closest to the Flag" game mode (Target View - 3D)

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import * as CoreVisuals from './core.js'; // May need core functions
import { renderObstacles, clearObstacles } from './obstacles.js'; // Import obstacle rendering
import { createObstacle, OBSTACLE_TYPES, OBSTACLE_SIZES } from '../obstacleConfig.js'; // Import obstacle creation
import { generateCTFHoleConfig, metersToYards } from '../holeConfigGenerator.js'; // Import hole config generator

let scene = null;
let canvasWidth = 0;
let canvasHeight = 0;
let targetDistanceMeters = 0; // In meters
let currentHoleConfig = null; // Store current hole configuration
let greenRadiusMeters = null; // Store green radius for camera

// --- 3D Objects ---
let greenMesh = null;
let flagstickMesh = null;
let flagMesh = null;
let groundMesh = null; // Add ground
let fairwayMesh = null; // Add fairway
let teeBoxMesh = null; // Add tee box
let waterMesh = null; // Add water hazard
let targetGroup = null; // Group to hold all target elements
const landingMarkers = []; // Array to hold landing spot markers
let currentObstacles = []; // Array to store obstacle data

// --- Constants ---
const ROUGH_COLOR = 0x228B22; // Forest green
const FAIRWAY_COLOR = 0x3CB371; // Medium sea green
const GREEN_COLOR = 0x3A913F; // Darker green
const TEE_COLOR = 0x6AC46A; // Tee box green (lighter than fairway)
const FLAG_COLOR = 0xFF0000; // Red
const FLAGSTICK_COLOR = 0xcccccc; // White/Gray

import { YARDS_TO_METERS } from '../utils/unitConversions.js';

const Y_OFFSET_GROUND = 0;
const Y_OFFSET_FAIRWAY = 0.005;
const Y_OFFSET_WATER = 0.01; // Water above fairway for visual clarity
const Y_OFFSET_TEE = 0.03; // Tee box slightly above fairway
const Y_OFFSET_GREEN = 0.02; // Green above fairway and water
const Y_OFFSET_FLAGSTICK = 0.02; // Base of flagstick on green level

// Seeded random number generator for consistent organic shapes in multiplayer
function seededRandom(seed, index) {
    const x = Math.sin(seed * 12345.6789 + index * 789.123) * 10000;
    return x - Math.floor(x);
}

export function setScene(coreScene, width, height) {
    scene = coreScene;
    canvasWidth = width;
    canvasHeight = height;
}

export function setTargetDistance(distanceMeters) {
    targetDistanceMeters = distanceMeters;
}

// Set hole configuration (from server in multiplayer, or generated locally)
export function setHoleConfig(holeConfig) {
    currentHoleConfig = holeConfig;
}

// Creates the 3D objects for the target view
function createTargetElements() {
    if (targetGroup) {
        // Already created, maybe just update position/visibility
        console.warn("targetGroup already exists, returning early without recreating!");
        targetGroup.visible = true;
        return;
    }

    targetGroup = new THREE.Group();
    const targetZ = targetDistanceMeters; // Target distance in meters

    // --- Ground (Rough) ---
    // Make it wide and long enough to cover the view, extending behind the tee box
    const groundWidth = 100; // Meters
    const groundBehindTee = 30; // Extend 30m behind the tee box
    const groundLength = targetZ + 50 + groundBehindTee; // Total length
    const groundGeometry = new THREE.PlaneGeometry(groundWidth, groundLength);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: ROUGH_COLOR, side: THREE.DoubleSide });
    groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = Y_OFFSET_GROUND;
    groundMesh.position.z = (groundLength / 2) - groundBehindTee; // Shift to extend behind start
    targetGroup.add(groundMesh);

    // --- Tee Box ---
    const teeWidth = 8; // Meters (width)
    const teeDepth = 6; // Meters (depth)
    const teeGeometry = new THREE.PlaneGeometry(teeWidth, teeDepth);
    const teeMaterial = new THREE.MeshLambertMaterial({ color: TEE_COLOR, side: THREE.DoubleSide });
    teeBoxMesh = new THREE.Mesh(teeGeometry, teeMaterial);
    teeBoxMesh.rotation.x = -Math.PI / 2;
    teeBoxMesh.position.y = Y_OFFSET_FAIRWAY + 0.001; // Just above fairway level
    teeBoxMesh.position.z = 0; // Center the tee box at Z=0 (where ball starts)
    targetGroup.add(teeBoxMesh);

    // --- Green (calculate position first to angle fairway towards it) ---
    // Use holeConfig for green dimensions if available
    const greenWidthMeters = currentHoleConfig?.greenWidthMeters || 18;
    const greenDepthMeters = currentHoleConfig?.greenDepthMeters || 14;
    const greenOffsetMeters = currentHoleConfig?.greenOffsetMeters || 0;

    // Create organic green shape with slight irregularities
    const greenShape = new THREE.Shape();
    const greenSegments = 16; // Points around the perimeter
    const baseRadiusX = greenWidthMeters / 2;
    const baseRadiusZ = greenDepthMeters / 2;
    const shapeSeed = currentHoleConfig?.shapeSeed || Math.random();

    for (let i = 0; i <= greenSegments; i++) {
        const angle = (i / greenSegments) * Math.PI * 2;
        // Add slight random variation to radius (±5% of base radius)
        // Use seeded random for consistent shapes in multiplayer
        const radiusVariationX = baseRadiusX * (1 + (seededRandom(shapeSeed, i * 2) - 0.5) * 0.1);
        const radiusVariationZ = baseRadiusZ * (1 + (seededRandom(shapeSeed, i * 2 + 1) - 0.5) * 0.1);
        const x = Math.cos(angle) * radiusVariationX;
        const z = Math.sin(angle) * radiusVariationZ;

        if (i === 0) {
            greenShape.moveTo(x, z);
        } else {
            greenShape.lineTo(x, z);
        }
    }
    greenShape.closePath();

    const greenGeometry = new THREE.ShapeGeometry(greenShape);
    const greenMaterial = new THREE.MeshLambertMaterial({ color: GREEN_COLOR, side: THREE.DoubleSide });
    greenMesh = new THREE.Mesh(greenGeometry, greenMaterial);
    greenMesh.rotation.x = Math.PI / 2; // Rotate to lay flat
    greenMesh.position.y = Y_OFFSET_GREEN; // Slightly above fairway
    greenMesh.position.x = greenOffsetMeters; // Offset left/right from centerline
    greenMesh.position.z = targetZ; // Position it AT the target distance
    targetGroup.add(greenMesh);

    // Store approximate green radius for camera (average of width and depth radii)
    greenRadiusMeters = (greenWidthMeters + greenDepthMeters) / 4; // Average radius

    // --- Flag position within green ---
    const holePositionX = currentHoleConfig?.holePositionX || 0;
    const holePositionY = currentHoleConfig?.holePositionY || 0;
    const flagX = greenOffsetMeters + (holePositionX * greenWidthMeters / 2);
    const flagZ = targetZ + (holePositionY * greenDepthMeters / 2);

    // --- Flagstick ---
    const flagstickHeight = 2.5; // Meters
    const flagstickRadius = 0.03; // Meters
    const flagstickGeometry = new THREE.CylinderGeometry(flagstickRadius, flagstickRadius, flagstickHeight, 8);
    const flagstickMaterial = new THREE.MeshBasicMaterial({ color: FLAGSTICK_COLOR });
    flagstickMesh = new THREE.Mesh(flagstickGeometry, flagstickMaterial);
    // Position base on the green surface at hole position
    flagstickMesh.position.set(flagX, flagstickHeight / 2 + Y_OFFSET_FLAGSTICK, flagZ);
    targetGroup.add(flagstickMesh);

    // --- Flag ---
    const flagGeometry = new THREE.PlaneGeometry(0.5, 0.3); // Width, height in meters
    const flagMaterial = new THREE.MeshBasicMaterial({ color: FLAG_COLOR, side: THREE.DoubleSide });
    flagMesh = new THREE.Mesh(flagGeometry, flagMaterial);
    // Position relative to the top of the flagstick
    flagMesh.position.set(flagX + 0.25, flagstickMesh.position.y + flagstickHeight / 2 - 0.15, flagZ);
    targetGroup.add(flagMesh);

    // --- Fairway (visual only - all shots land in light rough for gameplay) ---
    // Get fairway adjustments from server config (if water hazard exists)
    const waterHazard = currentHoleConfig?.waterHazard;
    const fairwayAdjustments = waterHazard?.fairwayAdjustments;

    let fairwayWidth = 25; // Base width (meters)
    let fairwayExtension = fairwayAdjustments?.extension ?? 10;
    let fairwayApproachDistance = fairwayAdjustments?.approachDistance ?? 40;
    const leftWidthMultiplier = fairwayAdjustments?.leftWidthMultiplier ?? 1.0;
    const rightWidthMultiplier = fairwayAdjustments?.rightWidthMultiplier ?? 1.0;
    const behindWater = fairwayAdjustments?.behindWater ?? false;

    // Calculate fairway position based on whether it's behind water or approaching green
    let fairwayStartZ, fairwayLength;
    if (behindWater) {
        // Water is in front - fairway ends before the water
        fairwayLength = fairwayApproachDistance;
        fairwayStartZ = 0; // Start from tee
    } else {
        // Normal case - fairway approaches green
        fairwayStartZ = targetZ - fairwayApproachDistance;
        fairwayLength = fairwayApproachDistance + fairwayExtension;
    }

    const angleToGreen = Math.atan2(greenOffsetMeters, targetZ);

    // Create organic fairway shape
    const fairwayShape = new THREE.Shape();
    const lengthSegments = 3;
    const endSegments = 5;
    const backBow = (seededRandom(shapeSeed, 100) - 0.5) * 6;
    const frontBow = (seededRandom(shapeSeed, 101) - 0.5) * 6;

    fairwayShape.moveTo(-fairwayWidth / 2 * leftWidthMultiplier, -fairwayLength / 2);

    for (let i = 1; i < endSegments; i++) {
        const t = i / endSegments;
        const xLeft = -fairwayWidth / 2 * leftWidthMultiplier;
        const xRight = fairwayWidth / 2 * rightWidthMultiplier;
        const x = xLeft + (xRight - xLeft) * t;
        const bowOffset = -backBow * 4 * t * (1 - t);
        fairwayShape.lineTo(x, -fairwayLength / 2 + bowOffset);
    }

    for (let i = 0; i <= lengthSegments; i++) {
        const t = i / lengthSegments;
        const y = -fairwayLength / 2 + fairwayLength * t;
        const widthVariation = (seededRandom(shapeSeed, 102 + i) - 0.5) * 4;
        fairwayShape.lineTo(fairwayWidth / 2 * rightWidthMultiplier + widthVariation, y);
    }

    for (let i = 1; i < endSegments; i++) {
        const t = i / endSegments;
        const xRight = fairwayWidth / 2 * rightWidthMultiplier;
        const xLeft = -fairwayWidth / 2 * leftWidthMultiplier;
        const x = xRight + (xLeft - xRight) * t;
        const bowOffset = frontBow * 4 * t * (1 - t);
        fairwayShape.lineTo(x, fairwayLength / 2 + bowOffset);
    }

    for (let i = lengthSegments; i > 0; i--) {
        const t = i / lengthSegments;
        const y = -fairwayLength / 2 + fairwayLength * t;
        const widthVariation = (seededRandom(shapeSeed, 106 + i) - 0.5) * 4;
        fairwayShape.lineTo(-fairwayWidth / 2 * leftWidthMultiplier + widthVariation, y);
    }

    fairwayShape.closePath();

    const fairwayGeometry = new THREE.ShapeGeometry(fairwayShape);
    const fairwayMaterial = new THREE.MeshLambertMaterial({ color: FAIRWAY_COLOR, side: THREE.DoubleSide });
    fairwayMesh = new THREE.Mesh(fairwayGeometry, fairwayMaterial);
    fairwayMesh.rotation.x = Math.PI / 2;
    fairwayMesh.rotation.z = angleToGreen;

    const fairwayCenterZ = fairwayStartZ + (fairwayLength / 2);
    const fairwayCenterX = greenOffsetMeters * (fairwayCenterZ / targetZ);
    fairwayMesh.position.set(fairwayCenterX, Y_OFFSET_FAIRWAY, fairwayCenterZ);
    targetGroup.add(fairwayMesh);

    // --- Water Hazard (if present in hole config) ---
    // Water is rendered below fairway (matches playHole mode - fairway wins visually and in lie detection)
    if (currentHoleConfig?.waterHazard) {
        const water = currentHoleConfig.waterHazard;

        let waterGeometry;

        if (water.type === 'ellipse' && water.center && water.radiusX && water.radiusZ) {
            // Create organic elliptical water shape with irregular edges
            const waterShape = new THREE.Shape();
            const segments = 24; // Points around perimeter for smooth but varied shape

            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI * 2;
                // Add slight random variation to each radius (±8% variation)
                // Use seeded random for consistent shapes in multiplayer (indices 200-247 to avoid collision)
                const radiusXVar = water.radiusX * (1 + (seededRandom(shapeSeed, 200 + i * 2) - 0.5) * 0.16);
                const radiusZVar = water.radiusZ * (1 + (seededRandom(shapeSeed, 200 + i * 2 + 1) - 0.5) * 0.16);
                const x = Math.cos(angle) * radiusXVar;
                const z = Math.sin(angle) * radiusZVar;

                if (i === 0) {
                    waterShape.moveTo(x, z);
                } else {
                    waterShape.lineTo(x, z);
                }
            }
            waterShape.closePath();
            waterGeometry = new THREE.ShapeGeometry(waterShape);

        } else if (water.type === 'circle' && water.center && water.radius) {
            // Legacy support for circular water
            waterGeometry = new THREE.CircleGeometry(water.radius, 32);
        } else {
            console.warn('Unknown water hazard type:', water);
            return;
        }

        const waterMaterial = new THREE.MeshStandardMaterial({
            color: water.surface?.color || '#4682B4',
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85
        });
        const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
        waterMesh.rotation.x = Math.PI / 2; // Lay flat (ShapeGeometry orientation)
        waterMesh.position.set(
            water.center.x,
            Y_OFFSET_WATER, // Use constant for consistent layering
            water.center.z
        );
        waterMesh.receiveShadow = true;
        targetGroup.add(waterMesh);
    }

    // Add the whole group to the main scene
    scene.add(targetGroup);

    // Generate and render obstacles
    generateObstacles(targetZ, fairwayWidth);
}

// Generate obstacles - uses server data in multiplayer, or generates locally in single player
function generateObstacles(targetZ, fairwayWidth) {
    currentObstacles = []; // Clear existing obstacles

    // Check if obstacles are provided by server (multiplayer)
    if (currentHoleConfig?.obstacles) {
        // Use server-provided obstacles
        currentHoleConfig.obstacles.forEach(obstacleData => {
            const obstacle = createObstacle(obstacleData.type, obstacleData.size, obstacleData.x, obstacleData.z);
            currentObstacles.push(obstacle);
        });
    } else {
        // Generate obstacles locally (single player)

        const greenWidthMeters = currentHoleConfig?.greenWidthMeters || 18;
        const greenDepthMeters = currentHoleConfig?.greenDepthMeters || 14;
        const greenOffsetMeters = currentHoleConfig?.greenOffsetMeters || 0;
        const greenRadiusMeters = Math.max(greenWidthMeters, greenDepthMeters) / 2;

        const obstacleCount = Math.floor(Math.random() * 18) + 12; // 12-29 obstacles
        const types = [OBSTACLE_TYPES.TREE, OBSTACLE_TYPES.BUSH];
        const sizes = [OBSTACLE_SIZES.SMALL, OBSTACLE_SIZES.MEDIUM, OBSTACLE_SIZES.LARGE];

        for (let i = 0; i < obstacleCount; i++) {
            const type = types[Math.floor(Math.random() * types.length)];
            const size = sizes[Math.floor(Math.random() * sizes.length)];

            // Random position along the course
            const z = Math.random() * targetZ * 0.8 + targetZ * 0.1; // 10%-90% of distance

            // Place in the rough, positioned relative to green offset
            const offsetMultiplier = type === OBSTACLE_TYPES.TREE ? 0.8 : 1.0;
            const referenceX = greenOffsetMeters * offsetMultiplier;
            const side = Math.random() < 0.5 ? -1 : 1;
            const x = referenceX + side * (fairwayWidth / 2 + Math.random() * 20);

            // Check if obstacle would be on the green
            const greenCenterX = greenOffsetMeters;
            const greenCenterZ = targetZ;
            const dx = x - greenCenterX;
            const dz = z - greenCenterZ;
            const distanceToGreenCenter = Math.sqrt(dx * dx + dz * dz);

            if (distanceToGreenCenter < greenRadiusMeters + 5) {
                i--;
                continue;
            }

            const obstacle = createObstacle(type, size, x, z);
            currentObstacles.push(obstacle);
        }
    }

    // Render obstacles
    renderObstacles(scene, currentObstacles);
}

// Export obstacles for physics calculations
export function getObstacles() {
    return currentObstacles;
}

// Shows the target elements (creates if needed)
export function drawTargetView() {
    if (!scene) return;

    // Generate hole config if not already set (single-player mode)
    if (!currentHoleConfig) {
        const distanceMeters = targetDistanceMeters; // Already in meters
        currentHoleConfig = generateCTFHoleConfig(distanceMeters);
    }

    if (!targetGroup) {
        createTargetElements();
    } else {
        // Target elements already exist for this hole - just ensure visible
        // Positions were set correctly when created based on currentHoleConfig, don't reposition
        targetGroup.visible = true;
    }
    // TODO: Adjust camera for target view?
    // CoreVisuals.setCameraForTargetView(targetDistanceMeters);
}

// Hides the target elements
export function hideTargetElements() {
    if (targetGroup) {
        targetGroup.visible = false;
    }
    // Hide landing markers too
    landingMarkers.forEach(marker => marker.visible = false);
    // Clear obstacles
    clearObstacles(scene);
    currentObstacles = [];
}

// Removes the target elements from the scene entirely
export function removeTargetElements() {
     if (targetGroup) {
        // Remove individual elements first
        if(groundMesh) targetGroup.remove(groundMesh);
        if(fairwayMesh) targetGroup.remove(fairwayMesh);
        if(teeBoxMesh) targetGroup.remove(teeBoxMesh);
        if(greenMesh) targetGroup.remove(greenMesh);
        if(flagstickMesh) targetGroup.remove(flagstickMesh);
        if(flagMesh) targetGroup.remove(flagMesh);
        // Then remove the group itself
        scene.remove(targetGroup);

        // Dispose geometries and materials if needed
        groundMesh?.geometry.dispose(); groundMesh?.material.dispose();
        fairwayMesh?.geometry.dispose(); fairwayMesh?.material.dispose();
        teeBoxMesh?.geometry.dispose(); teeBoxMesh?.material.dispose();
        greenMesh?.geometry.dispose(); greenMesh?.material.dispose();
        flagstickMesh?.geometry.dispose(); flagstickMesh?.material.dispose();
        flagMesh?.geometry.dispose(); flagMesh?.material.dispose();

        targetGroup = null;
        groundMesh = null;
        fairwayMesh = null;
        teeBoxMesh = null;
        greenMesh = null;
        flagstickMesh = null;
        flagMesh = null;
     }
     // Remove landing markers
     landingMarkers.forEach(marker => {
         scene.remove(marker);
         marker.geometry.dispose();
         marker.material.dispose();
     });
     landingMarkers.length = 0; // Clear the array

     // Clear obstacles
     clearObstacles(scene);
     currentObstacles = [];
}


export function animateShotLanding(shotData) {
    if (!scene) return;

    // Use the trajectory end point for landing position
    if (!shotData.trajectory || shotData.trajectory.length === 0) {
        console.warn("TargetView: No trajectory data for landing marker.");
        return;
    }
    const landingPos = shotData.trajectory[shotData.trajectory.length - 1]; // Last point {x, y, z} in meters

    // Create a simple sphere marker
    const markerGeometry = new THREE.SphereGeometry(0.3, 16, 8); // Radius 0.3m
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff }); // White
    const landingMarker = new THREE.Mesh(markerGeometry, markerMaterial);

    // Position the marker at the landing spot
    // Ensure y is slightly above ground to avoid z-fighting
    landingMarker.position.set(landingPos.x, Math.max(0.15, landingPos.y), landingPos.z);
    landingMarker.visible = true; // Ensure it's visible

    //Drop displaying landing marker for now
    //scene.add(landingMarker);
    //landingMarkers.push(landingMarker); // Keep track to remove later


    // TODO: Add actual animation later if desired (e.g., marker fades in/out)
}

export function resetView() {
    // Remove previous landing markers
    landingMarkers.forEach(marker => {
        marker.visible = false; // Hide first
        scene.remove(marker);
        // Optionally dispose geometry/material here if creating many markers
        // marker.geometry.dispose();
        // marker.material.dispose();
    });
    landingMarkers.length = 0; // Clear the array

    // Ensure target elements are visible if the mode is active
    // DO NOT regenerate the hole - it should stay the same across shots in CTF mode
    if (targetGroup) {
        targetGroup.visible = true;
    }

}

// Clear the current hole config to force regeneration of a new hole
export function clearHoleConfig() {
    currentHoleConfig = null;

    // Also clear all visual elements so they get recreated with new dimensions
    if (targetGroup && scene) {
        // Remove all children from the group
        while (targetGroup.children.length > 0) {
            const child = targetGroup.children[0];
            targetGroup.remove(child);
            // Dispose geometries and materials
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => mat.dispose());
                } else {
                    child.material.dispose();
                }
            }
        }
        // Remove the group from the scene
        scene.remove(targetGroup);
        targetGroup = null;
    }

    // Clear mesh references
    groundMesh = null;
    teeBoxMesh = null;
    fairwayMesh = null;
    greenMesh = null;
    flagstickMesh = null;
    flagMesh = null;
    waterMesh = null;

    // Clear obstacles from scene (only if scene exists)
    if (scene) {
        clearObstacles(scene);
    }
    currentObstacles = [];

}

// Duplicate setScene removed. The correct one is defined near the top.

// --- Getters for External Use (e.g., Camera Control) ---

// Returns the current CTF hole configuration
export function getHoleConfig() {
    return currentHoleConfig;
}

// Returns the center position of the green mesh
export function getGreenCenter() {
    return greenMesh ? greenMesh.position.clone() : null; // Return a clone to prevent external modification
}

// Returns the radius of the green in meters (approximate average radius)
export function getGreenRadius() {
    return greenRadiusMeters;
}

// Returns the flag position (for measurement camera)
export function getFlagPosition() {
    return flagstickMesh ? flagstickMesh.position.clone() : null;
}

// Returns target view objects for raycasting (measurement camera)
export function getTargetObjects() {
    if (!targetGroup) return [];
    // Return all children that can be raycasted (meshes)
    return targetGroup.children.filter(child => child.isMesh);
}
