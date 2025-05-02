import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import * as CoreVisuals from './visuals/core.js'; // Includes CameraMode enum and camera functions
import * as RangeVisuals from './visuals/range.js';
import * as TargetVisuals from './visuals/targetView.js'; // Includes green getters
import * as HoleVisuals from './visuals/holeView.js'; // Import the new hole view module
import { getCurrentShotType } from './gameLogic.js'; // Import shot type getter

// Store references from core visuals if needed
let coreScene;
let coreBall;
let coreCanvas;
// let coreCtx; // Remove 2D context tracking
let coreCanvasWidth;
let coreCanvasHeight;
let currentTargetDistanceYards = 0; // Store target distance for reverse camera

// Track current visual mode
const VISUAL_MODES = {
    NONE: 'none',
    RANGE: 'range',
    TARGET: 'target',
    HOLE: 'hole' // Add HOLE mode
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

    // Explicitly initialize Range visuals and set camera for initial load
    RangeVisuals.initRangeVisuals(coreScene); // Create range-specific elements
    CoreVisuals.applyStaticCameraView('range'); // Ensure camera is set to static range view
    currentVisualMode = VISUAL_MODES.RANGE; // Set initial mode tracker

    return true; // Indicate success
}

// --- View Switching ---

function unloadCurrentView() {
    console.log(`Unloading view: ${currentVisualMode}`);
    if (currentVisualMode === VISUAL_MODES.RANGE) {
        RangeVisuals.removeRangeVisuals(coreScene);
    } else if (currentVisualMode === VISUAL_MODES.TARGET) {
        TargetVisuals.hideTargetElements(); // Or clearTargetElements if it exists
    } else if (currentVisualMode === VISUAL_MODES.HOLE) {
        HoleVisuals.clearHoleLayout(); // Clear the hole geometry
    }
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

    unloadCurrentView(); // Unload previous view first (removes target elements etc.)
    console.log("Switching to Range View...");
    currentVisualMode = VISUAL_MODES.RANGE;
    TargetVisuals.hideTargetElements(); // Ensure target elements are hidden
    console.log("[visuals.js] switchToRangeView: Using scene:", sceneToUse);
    RangeVisuals.initRangeVisuals(sceneToUse); // Add/show range elements
    CoreVisuals.applyStaticCameraView('range'); // Set camera to static range view
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
    unloadCurrentView(); // Unload previous view first (removes range elements etc.)
    console.log("Switching to Target View...");
    currentVisualMode = VISUAL_MODES.TARGET;
    currentTargetDistanceYards = targetDistance; // Store for reverse camera
    RangeVisuals.removeRangeVisuals(sceneToUse); // Remove range specific elements
    TargetVisuals.setTargetDistance(targetDistance);
    TargetVisuals.drawTargetView(); // Create/show target elements
    // Set the camera specifically for the target view
    const targetZ = targetDistance * CoreVisuals.YARDS_TO_METERS; // Use constant from core
    CoreVisuals.setCameraForTargetView(targetZ); // Set the static target view
    CoreVisuals.applyStaticCameraView('target'); // Ensure mode is static and view is applied
    //CoreVisuals.hideBall(); // Hide the ball at address in target view? Or reposition?
}

// Switch to Hole View
export function switchToHoleView(holeLayout, initialScene = null) {
    const sceneToUse = initialScene || coreScene;
    if (!sceneToUse) {
        console.error("switchToHoleView: Scene is not available!");
        return;
    }
    if (currentVisualMode === VISUAL_MODES.HOLE && !initialScene) return; // Already in hole view

    unloadCurrentView();
    console.log("Switching to Hole View...");
    currentVisualMode = VISUAL_MODES.HOLE;
    RangeVisuals.removeRangeVisuals(sceneToUse); // Ensure range is gone
    TargetVisuals.hideTargetElements(); // Ensure target is gone
    HoleVisuals.drawHoleLayout(holeLayout); // Draw the actual hole
    setCameraView('tee'); // Set initial camera for the hole view
    CoreVisuals.showBallAtAddress(); // Ensure ball is visible at the tee
}

// Wrapper function called by playHole.js
export function drawHole(holeLayout) {
    switchToHoleView(holeLayout);
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

    //console.log('the points for drawing the ball flight:', points);

    // Calculate animation duration (convert seconds to ms)
    // Ensure duration is positive, default to 1500 if timeOfFlight is zero or negative
    const duration = (shotData.timeOfFlight && shotData.timeOfFlight > 0) ? shotData.timeOfFlight * 1000 : 1500;

    // Call the core animation function
    CoreVisuals.startBallAnimation(points, duration);
}

// Reset visuals - Resets core elements and the current view
export function resetVisuals() {
    console.log(`Resetting visuals for mode: ${currentVisualMode}`);
    CoreVisuals.resetCoreVisuals(); // Resets ball, trajectory line

     // Reset the specific view elements
    if (currentVisualMode === VISUAL_MODES.RANGE) {
        // RangeVisuals might have specific resets later
        CoreVisuals.showBallAtAddress(); // Ensure ball is back for 3D range
    } else if (currentVisualMode === VISUAL_MODES.TARGET) {
        TargetVisuals.resetView(); // Reset target view elements (e.g., clear landing markers)
        //CoreVisuals.hideBall(); // Keep ball hidden if in target view?
    } else if (currentVisualMode === VISUAL_MODES.HOLE) {
        // Hole view doesn't have specific reset actions beyond core reset yet
        CoreVisuals.showBallAtAddress(); // Ensure ball is back at tee
    }

    // Check current camera mode before resetting
    const currentCameraMode = CoreVisuals.getActiveCameraMode();
    if (currentCameraMode === CoreVisuals.CameraMode.REVERSE_ANGLE || currentCameraMode === CoreVisuals.CameraMode.GREEN_FOCUS) {
        console.log(`Camera was ${currentCameraMode}, resetting to static view.`);
        switchToStaticCamera(); // Reset only if it was reverse or green focus
    } else {
        console.log(`Camera is ${currentCameraMode}, preserving camera mode.`);
        // Re-apply the current camera mode to reset its position if necessary
        if (currentCameraMode === CoreVisuals.CameraMode.STATIC) {
            switchToStaticCamera(); // Re-apply the correct static view
        } else if (currentCameraMode === CoreVisuals.CameraMode.FOLLOW_BALL) {
            // Re-calling setActiveCameraMode will snap the camera to the initial follow position
            // relative to the ball's new address position.
            CoreVisuals.setActiveCameraMode(CoreVisuals.CameraMode.FOLLOW_BALL);
        }
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
     } else if (currentVisualMode === VISUAL_MODES.HOLE) {
         // TODO: Implement landing marker/animation for Hole view if desired
         console.log("Hole View: Landing animation placeholder.");
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
    //console.log('the points for drawing the ball flight:', points);
    const duration = (shotData.timeOfFlight && shotData.timeOfFlight > 0) ? shotData.timeOfFlight * 1000 : 1500;

    // Define the callback function for when the animation finishes
    const onAnimationComplete = () => {
        console.log("Ball flight animation complete. Handling landing.");
        handleLandingAnimation(shotData);
    };

    // Always use 3D animation now
    CoreVisuals.startBallAnimation(points, duration, onAnimationComplete);
}


// --- New Camera Control Functions ---

// Switch to the appropriate static camera view based on current mode AND shot type
export function switchToStaticCamera() {
    const shotType = getCurrentShotType(); // Get current shot type from gameLogic
    let viewType = 'range'; // Default view

    // Determine the correct static view based on shot type first
    switch (shotType) {
        case 'chip':
            viewType = 'chip';
            break;
        case 'putt':
            viewType = 'putt';
            break;
        case 'full':
        default:
            // For full swing, decide between range and target based on visual mode
            if (currentVisualMode === VISUAL_MODES.TARGET) {
                viewType = 'target';
            } else {
                viewType = 'range'; // Default full swing view is range
            }
            break;
    }

    console.log(`Switching to static camera view: ${viewType} (ShotType: ${shotType}, VisualMode: ${currentVisualMode})`);
    CoreVisuals.applyStaticCameraView(viewType);
}

// Activate the follow ball camera mode
export function activateFollowBallCamera() {
    console.log("Activating Follow Ball Camera");
    CoreVisuals.setActiveCameraMode(CoreVisuals.CameraMode.FOLLOW_BALL);
}

// Activate the reverse angle camera
export function activateReverseCamera() {
    console.log("Activating Reverse Angle Camera");
    let positionZ = 300 * CoreVisuals.YARDS_TO_METERS; // Default 300 yards for Range

    if (currentVisualMode === VISUAL_MODES.TARGET && currentTargetDistanceYards > 0) {
        positionZ = currentTargetDistanceYards * CoreVisuals.YARDS_TO_METERS;
        console.log(`Using target distance for reverse camera: ${currentTargetDistanceYards} yards`);
    } else {
        console.log("Using default 300 yards for reverse camera.");
    }

    CoreVisuals.setCameraReverseAngle(positionZ);
}

// Activate the green focus camera (only works in Target mode)
export function activateGreenCamera() {
    console.log("Attempting to activate Green Focus Camera");
    if (currentVisualMode !== VISUAL_MODES.TARGET) {
        console.warn("Green Focus camera only available in Target mode.");
        return;
    }

    const greenCenter = TargetVisuals.getGreenCenter();
    const greenRadius = TargetVisuals.getGreenRadius();

    if (greenCenter && greenRadius) {
        console.log(`Found green data: Center Z=${greenCenter.z.toFixed(1)}, Radius=${greenRadius.toFixed(1)}`);
        CoreVisuals.setCameraGreenFocus(greenCenter, greenRadius);
    } else {
        console.error("Could not get green position or radius from TargetVisuals.");
    }
}

// Set specific camera views, potentially used by modes like playHole
export function setCameraView(viewType) {
    console.log(`Setting camera view specifically to: ${viewType}`);
    switch (viewType) {
        case 'tee':
            // Use the 'range' camera settings for the tee shot for now
            CoreVisuals.applyStaticCameraView('range');
            break;
        case 'approach':
            // Maybe use 'target' view logic if we know the distance?
            // For now, fallback to range
            CoreVisuals.applyStaticCameraView('range');
            break;
        case 'chip':
            CoreVisuals.applyStaticCameraView('chip');
            break;
        case 'putt':
            CoreVisuals.applyStaticCameraView('putt');
            break;
        default:
            console.warn(`Unknown camera view type requested: ${viewType}. Defaulting to range.`);
            CoreVisuals.applyStaticCameraView('range');
            break;
    }
}
