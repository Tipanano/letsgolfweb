// src/visuals/holeView.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { TextureLoader } from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { scene } from './core.js';
import { renderObstacles, clearObstacles } from './obstacles.js';
import { createObstacle } from '../obstacleConfig.js';
import {
    renderBackground,
    renderRoughAreas,
    renderWaterHazards,
    renderBunkers,
    renderFairways,
    renderGreen,
    renderTeeBox
} from './holeRenderer.js';
import { queryTerrainHeight } from '../visuals.js'; // For getting terrain height at flag position

let currentHoleObjects = []; // To keep track of objects added for the hole
let currentFlagPosition = null; // Store the flag position in meters (Vector3)
let currentGreenCenter = null; // Store the green center position in meters (Vector3)
let currentGreenRadius = null; // Store the green radius in meters (Number)
let flagstickPoleMesh = null; // Reference to the flagstick pole mesh
let flagClothMesh = null; // Reference to the flag cloth mesh
let currentObstacles = []; // Store obstacles for physics calculations

/**
 * Clears any previously drawn hole objects from the scene.
 */
export function clearHoleLayout() {
    if (!scene) return;
    currentHoleObjects.forEach(obj => {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
    });
    currentHoleObjects = [];
    // Reset flagstick references when clearing
    flagstickPoleMesh = null;
    flagClothMesh = null;
    // Reset stored positions/dimensions
    currentFlagPosition = null;
    currentGreenCenter = null;
    currentGreenRadius = null;
    // Clear obstacles from scene and physics array
    currentObstacles = [];
    clearObstacles(scene);
}

/**
 * Draws the hole layout based on the provided data structure.
 * @param {object} holeLayout - The hole data processed by holeLoader.js
 */
export function drawHoleLayout(holeLayout) {
    if (!scene || !holeLayout) {
        console.error("Scene not initialized or no hole layout provided for drawing.");
        return;
    }

    clearHoleLayout(); // Clear previous layout first
    currentFlagPosition = null;
    currentGreenCenter = null;
    currentGreenRadius = null;

    const textureLoader = new TextureLoader();

    // Render all surfaces using the new height-aware renderer
    renderBackground(holeLayout, scene, textureLoader, currentHoleObjects);
    renderRoughAreas(holeLayout, scene, textureLoader, currentHoleObjects);
    renderWaterHazards(holeLayout, scene, textureLoader, currentHoleObjects);
    renderBunkers(holeLayout, scene, textureLoader, currentHoleObjects);
    renderFairways(holeLayout, scene, textureLoader, currentHoleObjects);

    // Render green and store center/radius for camera positioning
    const greenData = renderGreen(holeLayout, scene, textureLoader, currentHoleObjects);
    if (greenData) {
        currentGreenCenter = greenData.center;
        currentGreenRadius = greenData.radius;
    }

    renderTeeBox(holeLayout, scene, textureLoader, currentHoleObjects);

    // --- Draw Flagstick ---
    if (holeLayout.flagPosition) {
        const flagHeight = 2.5; // Meters
        const flagRadius = 0.05; // Meters
        const flagGeometry = new THREE.CylinderGeometry(flagRadius, flagRadius, flagHeight, 8);
        const flagMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff }); // White pole
        flagstickPoleMesh = new THREE.Mesh(flagGeometry, flagMaterial);
        flagstickPoleMesh.name = "FlagstickPole";
        flagstickPoleMesh.position.set(
            holeLayout.flagPosition.x,
            flagHeight / 2,
            holeLayout.flagPosition.z
        );
        flagstickPoleMesh.castShadow = true;
        scene.add(flagstickPoleMesh);
        currentHoleObjects.push(flagstickPoleMesh);

        // Store the flag position (base of the stick)
        currentFlagPosition = new THREE.Vector3(
            holeLayout.flagPosition.x,
            0,
            holeLayout.flagPosition.z
        );


        // Optional: Add a little flag cloth
        const flagClothGeometry = new THREE.PlaneGeometry(0.5, 0.3);
        const flagClothMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide }); // Red flag
        flagClothMesh = new THREE.Mesh(flagClothGeometry, flagClothMaterial); // Assign to module variable
        flagClothMesh.name = "FlagCloth"; // Optional: Add name for debugging
        // Position relative to flagstick top
        flagClothMesh.position.set(
            flagstickPoleMesh.position.x + 0.25, // Offset slightly from pole
            flagstickPoleMesh.position.y + flagHeight / 2 - 0.15, // Near the top
            flagstickPoleMesh.position.z
        );
        scene.add(flagClothMesh);
        currentHoleObjects.push(flagClothMesh);

        // --- Draw the Hole Cup ---
        const HOLE_RADIUS_METERS = 0.108 / 2; // Regulation hole diameter is 4.25 inches (0.108m)
        const holeDepth = 0.1; // Depth for the visual cup (meters)
        const holeGeometry = new THREE.CylinderGeometry(HOLE_RADIUS_METERS, HOLE_RADIUS_METERS, holeDepth, 16);
        const holeMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 }); // Black
        const holeMesh = new THREE.Mesh(holeGeometry, holeMaterial);
        holeMesh.renderOrder = 1; // Draw hole *after* the green

        // Position the hole centered at the flag position, using actual terrain height at that XZ position
        const terrainHeightAtFlag = queryTerrainHeight(currentFlagPosition.x, currentFlagPosition.z);
        const holeTopEdgeY = terrainHeightAtFlag + 0.01; // Place top just at green surface
        const holeCenterY = holeTopEdgeY - (holeDepth / 2); // Calculate center Y

        holeMesh.position.set(
            currentFlagPosition.x,
            holeCenterY, // Position cylinder center
            currentFlagPosition.z
        );
        // No rotation needed as cylinder is upright

        scene.add(holeMesh);
        currentHoleObjects.push(holeMesh);
    }

    // --- Draw Obstacles (Trees/Bushes) ---
    currentObstacles = []; // Clear existing obstacles
    if (holeLayout.obstacles && Array.isArray(holeLayout.obstacles)) {

        // Convert obstacle data from JSON format to full obstacle objects with properties
        const obstaclesWithProps = holeLayout.obstacles.map(obs =>
            createObstacle(obs.type, obs.size, obs.x, obs.z)
        );

        // Store obstacles for physics calculations
        currentObstacles = obstaclesWithProps;

        console.log(`🌲 Loaded ${currentObstacles.length} obstacles for collision detection:`,
            currentObstacles.map(o => ({
                type: o.type,
                x: o.x.toFixed(1),
                z: o.z.toFixed(1),
                radius: o.radius.toFixed(1),
                height: o.height.toFixed(1),
                trunkHeight: o.trunkHeight?.toFixed(1)
            }))
        );

        // Render obstacles to the scene
        renderObstacles(scene, obstaclesWithProps);
    }

}

/**
 * Returns the stored position of the flagstick base in world coordinates (meters).
 * @returns {THREE.Vector3 | null} The flag position or null if not set.
 */
export function getFlagPosition() {
    return currentFlagPosition;
}

/**
 * Returns the stored center position of the green in world coordinates (meters).
 * @returns {THREE.Vector3 | null} The green center position or null if not set.
 */
export function getGreenCenter() {
    return currentGreenCenter;
}

/**
 * Returns the stored radius of the green in meters.
 * @returns {number | null} The green radius or null if not set.
 */
export function getGreenRadius() {
    return currentGreenRadius;
}

/**
 * Sets the visibility of the flagstick pole and cloth.
 * @param {boolean} visible - True to show, false to hide.
 */
export function setFlagstickVisibility(visible) {
    if (flagstickPoleMesh) {
        flagstickPoleMesh.visible = visible;
    }
    if (flagClothMesh) {
        flagClothMesh.visible = visible;
    }
}

/**
 * Returns the array of THREE.Object3D that make up the current hole.
 * These are the objects that should be used for raycasting against the course.
 * @returns {Array<THREE.Object3D>}
 */
export function getCurrentHoleObjects() {
    return currentHoleObjects;
}

/**
 * Returns the array of obstacles for physics calculations
 * @returns {Array}
 */
export function getObstacles() {
    return currentObstacles;
}
