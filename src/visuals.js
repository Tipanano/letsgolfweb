import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import * as CoreVisuals from './visuals/core.js';
import * as RangeVisuals from './visuals/range.js';
import * as TargetVisuals from './visuals/targetView.js'; // Import new target view

// Store references from core visuals if needed
let coreScene;
let coreBall;
let coreCanvas;
// let coreCtx; // Remove 2D context tracking
let coreCanvasWidth;
let coreCanvasHeight;

// Track current visual mode
const VISUAL_MODES = {
    NONE: 'none',
    RANGE: 'range',
    TARGET: 'target',
    // Add HOLE later
};
let currentVisualMode = VISUAL_MODES.NONE;

export function initVisuals(canvasElement) {
    console.log("Initializing main visuals module (assuming 3D)...");
    coreCanvas = canvasElement;
    coreCanvasWidth = canvasElement.width;
    coreCanvasHeight = canvasElement.height;

    // Initialize the core 3D scene, camera, renderer, ball, lights etc.
    const coreInitResult = CoreVisuals.initCoreVisuals(canvasElement);

    // More robust check: ensure result exists and has a scene property
    if (!coreInitResult || !coreInitResult.scene) {
        console.error("Failed to initialize core 3D visuals or scene is missing from result.");
        // Handle failure appropriately - maybe show an error message on the page
        return false; // Indicate failure
    }
    coreScene = coreInitResult.scene; // Store scene reference only if valid
    coreBall = coreInitResult.ball;   // Store ball reference (might also need checking)

    // TargetVisuals will now need the scene, not a 2D context
    TargetVisuals.setScene(coreScene, coreCanvasWidth, coreCanvasHeight);
    // RangeVisuals already accepts the scene

    console.log("Main visuals module initialized.");

    // Set the initial view after successful initialization, passing the scene directly
    switchToRangeView(coreScene); // Pass the scene explicitly

    return true; // Indicate success
}

// --- View Switching ---

function unloadCurrentView() {
    console.log(`Unloading view: ${currentVisualMode}`);
    // Add logic here to remove elements specific to the current view if needed
    // e.g., RangeVisuals.removeRangeElements(coreScene);
    // e.g., TargetVisuals.clearTargetElements(); // If needed
    currentVisualMode = VISUAL_MODES.NONE;
}

// Accept scene as optional parameter for initial call
export function switchToRangeView(initialScene = null) {
    const sceneToUse = initialScene || coreScene; // Use passed scene if available, else module scope
    if (!sceneToUse) {
        console.error("switchToRangeView: Scene is not available!");
        return;
    }
    if (currentVisualMode === VISUAL_MODES.RANGE && !initialScene) return; // Already in range view (unless it's the initial call)

    unloadCurrentView(); // Unload previous view first
    console.log("Switching to Range View...");
    currentVisualMode = VISUAL_MODES.RANGE;
    TargetVisuals.hideTargetElements(); // Hide target elements
    console.log("[visuals.js] switchToRangeView: Using scene:", sceneToUse); // Log the scene being used
    RangeVisuals.initRangeVisuals(sceneToUse); // Ensure range elements are added/visible using the correct scene reference
    CoreVisuals.resetCameraPosition(); // Use the default camera position for Range
    CoreVisuals.showBallAtAddress(); // Ensure ball is visible
}

// Accept scene as optional parameter for initial call (though less likely needed here)
export function switchToTargetView(targetDistance, initialScene = null) {
    const sceneToUse = initialScene || coreScene; // Use passed scene if available, else module scope
     if (!sceneToUse) {
        console.error("switchToTargetView: Scene is not available!");
         return;
    }

    // Corrected Check: If already in target mode (and not the initial call), update and return.
    if (currentVisualMode === VISUAL_MODES.TARGET && !initialScene) {
         console.log("Already in Target View, updating distance...");
         TargetVisuals.setTargetDistance(targetDistance);
         TargetVisuals.drawTargetView(); // Redraw with new distance
         return;
    }

    // If not already in target mode, proceed with switching:
    unloadCurrentView(); // Unload previous view first
    console.log("Switching to Target View...");
    currentVisualMode = VISUAL_MODES.TARGET;
    RangeVisuals.removeRangeVisuals(sceneToUse); // Remove range specific elements using correct scene
    TargetVisuals.setTargetDistance(targetDistance);
    TargetVisuals.drawTargetView(); // Create/show target elements (uses its internally set scene)
    // Set the camera specifically for the target view
    const targetZ = targetDistance * (1 / 1.09361); // Convert target yards to meters
    CoreVisuals.setCameraForTargetView(targetZ); // Call the new camera function
    CoreVisuals.hideBall(); // Hide the ball at address in target view? Or reposition?
}


// --- Core Wrappers / Passthroughs ---

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

// Reset visuals - Resets core elements and the current view
export function resetVisuals() {
    console.log(`Resetting visuals for mode: ${currentVisualMode}`);
    CoreVisuals.resetCoreVisuals(); // Resets ball, trajectory line, camera

     // Reset the specific view elements
    if (currentVisualMode === VISUAL_MODES.RANGE) {
        showBallAtAddress(); // Ensure ball is back for 3D range
        // RangeVisuals might have specific resets later
    } else if (currentVisualMode === VISUAL_MODES.TARGET) {
        TargetVisuals.resetView(); // Reset target view elements (e.g., clear landing markers)
    }
}

// Show ball at address - Calls the core function (likely only relevant for 3D range)
export function showBallAtAddress() {
    CoreVisuals.showBallAtAddress();
}

// --- Landing Animation Handling ---
// Decide which view should handle the landing animation based on mode
function handleLandingAnimation(shotData) {
     if (currentVisualMode === VISUAL_MODES.RANGE) {
         // TODO: Implement landing animation/marker for Range view if needed
         // RangeVisuals.animateLanding(shotData); // TODO
         console.log("Range View: Landing animation placeholder.");
     } else if (currentVisualMode === VISUAL_MODES.TARGET) {
         TargetVisuals.animateShotLanding(shotData); // Now uses 3D
     }
}

// Modify animateBallFlight to call handleLandingAnimation after core animation completes
// Need to adjust CoreVisuals.startBallAnimation to accept a callback
export function animateBallFlightWithLanding(shotData) {
    if (!shotData || !shotData.trajectory || shotData.trajectory.length === 0) {
        console.warn("animateBallFlightWithLanding called with invalid shotData or trajectory.");
        resetVisuals(); // Reset if shot data is bad
        return;
    }

    const points = shotData.trajectory.map(p => new THREE.Vector3(p.x, p.y, p.z));
    const duration = (shotData.timeOfFlight && shotData.timeOfFlight > 0) ? shotData.timeOfFlight * 1000 : 1500;

    // Define the callback function for when the animation finishes
    const onAnimationComplete = () => {
        console.log("Ball flight animation complete. Handling landing.");
        handleLandingAnimation(shotData);
    };

    // Always use 3D animation now
    CoreVisuals.startBallAnimation(points, duration, onAnimationComplete);
}
