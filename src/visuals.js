import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import * as CoreVisuals from './visuals/core.js';
import * as RangeVisuals from './visuals/range.js';

// Store references from core visuals if needed, though most interaction might happen via exported functions
let coreScene;
let coreBall;

export function initVisuals(canvasElement) {
    console.log("Initializing main visuals module...");

    // Initialize the core scene, camera, renderer, ball, lights etc.
    const { scene, ball } = CoreVisuals.initCoreVisuals(canvasElement);
    coreScene = scene; // Store scene reference if needed elsewhere
    coreBall = ball;   // Store ball reference if needed elsewhere

    // Initialize the specific environment (currently the range)
    // Pass the core scene to the range initializer
    RangeVisuals.initRangeVisuals(coreScene);

    console.log("Main visuals module initialized.");
}

// Re-export or wrap necessary functions from core/environment modules

// Ball animation - Takes shotData, calculates points, and calls core animation function
export function animateBallFlight(shotData) {
    if (!shotData || !shotData.trajectory || shotData.trajectory.length === 0) {
        console.warn("animateBallFlight called with invalid shotData or trajectory.");
        return;
    }

    // Convert trajectory points from {x, y, z} objects to THREE.Vector3 instances
    const points = shotData.trajectory.map(p => new THREE.Vector3(p.x, p.y, p.z));

    // Calculate animation duration (convert seconds to ms)
    // Ensure duration is positive, default to 1500 if timeOfFlight is zero or negative
    const duration = (shotData.timeOfFlight && shotData.timeOfFlight > 0) ? shotData.timeOfFlight * 1000 : 1500;

    // Call the core animation function
    CoreVisuals.startBallAnimation(points, duration);
}

// Reset visuals - Calls the core reset function
export function resetVisuals() {
    CoreVisuals.resetCoreVisuals();
    // If we had multiple environments, we might reset the specific one here too,
    // but core reset handles the trajectory line and ball position which is enough for now.
}

// Show ball at address - Calls the core function
export function showBallAtAddress() {
    CoreVisuals.showBallAtAddress();
}

// Potentially add functions later to switch environments:
// export function loadRangeEnvironment() {
//     unloadCurrentEnvironment(); // Implement this to remove hole elements
//     RangeVisuals.initRangeVisuals(coreScene);
// }
// export function loadHoleEnvironment(holeData) {
//     unloadCurrentEnvironment(); // Implement this to remove range/other hole elements
//     HoleVisuals.initHoleVisuals(coreScene, holeData); // Assuming HoleVisuals module exists
// }
// function unloadCurrentEnvironment() {
//     // Check which environment is loaded and call its removal function
//     RangeVisuals.removeRangeVisuals(coreScene);
//     // HoleVisuals.removeHoleVisuals(coreScene); // etc.
// }
