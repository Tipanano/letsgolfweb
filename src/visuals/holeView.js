// src/visuals/holeView.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { TextureLoader } from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { scene, requestShadowUpdate } from './core.js';
import { renderObstacles, clearObstacles } from './obstacles.js';
import { createObstacle } from '../obstacleConfig.js';
import {
    renderBackground,
    renderRoughAreas,
    renderWaterHazards,
    renderBunkers,
    renderFairways,
    renderGreen,
    renderTeeBox,
    setMowPattern,
    setBunkerRims,
    setFringeGreens
} from './holeRenderer.js';
import { disposeSceneObject } from './textures.js';
import { queryTerrainHeight } from '../visuals.js'; // For getting terrain height at flag position
import { buildGrass } from './grass.js'; // Instanced grass for rough/native areas
import { buildOOBStakes } from './oobStakes.js'; // White boundary stakes
import { buildFlagstick, setFlagstickVisible, resetFlagstick } from './flagstick.js';

let currentHoleObjects = []; // To keep track of objects added for the hole
let currentFlagPosition = null; // Store the flag position in meters (Vector3)
let currentGreenCenter = null; // Store the green center position in meters (Vector3)
let currentGreenRadius = null; // Store the green radius in meters (Number)
let currentObstacles = []; // Store obstacles for physics calculations

/**
 * Clears any previously drawn hole objects from the scene.
 */
export function clearHoleLayout() {
    if (!scene) return;
    currentHoleObjects.forEach(obj => {
        scene.remove(obj);
        // disposeSceneObject frees geometry and any per-hole material/maps, but
        // deliberately leaves the shared surface registry alone. The old code
        // disposed materials without their maps, so every hole change leaked
        // the full texture set.
        disposeSceneObject(obj);
    });
    currentHoleObjects = [];
    resetFlagstick(); // Objects themselves were disposed above
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

    // Per-hole ground styling, set before anything bakes vertex colours:
    // a mow direction unique to this hole, and the bunker outlines whose
    // surrounding grass gets a darkened lip, and the greens whose collar gets
    // a lightened one.
    setMowPattern(holeLayout.number ?? holeLayout.par ?? 0);
    setBunkerRims(holeLayout.bunkers);
    setFringeGreens(holeLayout.greens);

    // Render all surfaces using the new height-aware renderer
    renderBackground(holeLayout, scene, textureLoader, currentHoleObjects);
    renderRoughAreas(holeLayout, scene, textureLoader, currentHoleObjects);
    renderWaterHazards(holeLayout, scene, textureLoader, currentHoleObjects);
    renderBunkers(holeLayout, scene, textureLoader, currentHoleObjects);
    renderFairways(holeLayout, scene, textureLoader, currentHoleObjects);

    // Instanced grass tufts over rough and native areas
    buildGrass(holeLayout, scene, currentHoleObjects);

    // White stakes along in-bounds edges that border out of bounds
    buildOOBStakes(holeLayout, scene, currentHoleObjects);

    // Render green and store center/radius for camera positioning
    const greenData = renderGreen(holeLayout, scene, textureLoader, currentHoleObjects);
    if (greenData) {
        currentGreenCenter = greenData.center;
        currentGreenRadius = greenData.radius;
    }

    renderTeeBox(holeLayout, scene, textureLoader, currentHoleObjects);

    // --- Draw Flagstick ---
    if (holeLayout.flagPosition) {
        // Terrain height at the flag: the terrain field is authoritative
        // (DEM holes go well below 0 — max() would leave the flag airborne);
        // an explicitly authored non-zero y overrides.
        const authoredY = holeLayout.flagPosition.y || 0;
        const terrainHeight = authoredY !== 0 ? authoredY :
            queryTerrainHeight(holeLayout.flagPosition.x, holeLayout.flagPosition.z);

        // Store the flag position (base of the stick)
        currentFlagPosition = new THREE.Vector3(
            holeLayout.flagPosition.x,
            terrainHeight,
            holeLayout.flagPosition.z
        );

        // Striped pole, camera-facing waving cloth, and a cup with real depth
        // — see visuals/flagstick.js for what each of those replaces.
        const { objects } = buildFlagstick(
            scene,
            currentFlagPosition.x,
            queryTerrainHeight(currentFlagPosition.x, currentFlagPosition.z),
            currentFlagPosition.z
        );
        currentHoleObjects.push(...objects);
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

    // Everything that casts a shadow is now in place; bake the map once
    // (shadowMap.autoUpdate is off — see initCoreVisuals).
    requestShadowUpdate();
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
    setFlagstickVisible(visible);
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
