import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import * as CoreVisuals from './visuals/core.js'; // Includes CameraMode enum, camera functions, and ball object
import * as RangeVisuals from './visuals/range.js';
import * as TargetVisuals from './visuals/targetView.js'; // Includes green getters
import * as HoleVisuals from './visuals/holeView.js'; // Import the new hole view module (includes getFlagPosition)
import * as MeasurementView from './visuals/measurementView.js'; // Import the new measurement view module
import { getCurrentShotType } from './gameLogic.js'; // Import shot type getter
import { setShotDirectionAngle, getCurrentTargetLineAngle, getShotDirectionAngle } from './gameLogic/state.js'; // Import state setter for angle
import { getCurrentGameMode } from './main.js'; // Import game mode getter

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

    // Initialize MeasurementView
    // TODO: We need a way to get all relevant course objects for raycasting.
    // For now, passing an empty array. This will need to be updated.
    // Potentially, core.js could expose a getter for all meshes that constitute the "ground".
    // Or, individual modules like holeView, rangeView could register their ground meshes.
    const courseObjectsForRaycasting = CoreVisuals.getCourseObjects ? CoreVisuals.getCourseObjects() : [];
    MeasurementView.init(coreInitResult.renderer, coreScene, coreCanvas, courseObjectsForRaycasting);


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
    MeasurementView.deactivate(); // Always deactivate measurement view when switching

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
    if (currentVisualMode === VISUAL_MODES.RANGE && !initialScene && !MeasurementView.isViewActive()) return; // Already in range view (unless it's the initial call or measurement was active)

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
    if (currentVisualMode === VISUAL_MODES.TARGET && !initialScene && !MeasurementView.isViewActive()) {
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
    // Removed early return: if (currentVisualMode === VISUAL_MODES.HOLE && !initialScene && !MeasurementView.isViewActive()) return; 
    // We need to proceed even if currentVisualMode is HOLE, to clear the old hole and draw the new one.
    // The unloadCurrentView() will handle clearing the previous hole's visuals.

    unloadCurrentView();
    console.log("Switching to Hole View...");
    currentVisualMode = VISUAL_MODES.HOLE;
    RangeVisuals.removeRangeVisuals(sceneToUse); // Ensure range is gone
    TargetVisuals.hideTargetElements(); // Ensure target is gone
    HoleVisuals.drawHoleLayout(holeLayout); // Draw the actual hole
    setCameraView('tee'); // Set initial camera for the hole view
    // REMOVED: CoreVisuals.showBallAtAddress(); // Ball position is set later by resetVisuals in playHole.js
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
// Accepts an optional position to place the ball at and the current lie.
export function resetVisuals(position = null, lie = null) {
    console.log(`Resetting visuals for mode: ${currentVisualMode}. Position provided:`, position, "Lie:", lie);
    // CoreVisuals.resetCoreVisuals(); // Don't call this as it resets ball to default

    // Manually replicate parts of resetCoreVisuals needed:
    CoreVisuals.removeTrajectoryLine(); // Remove trajectory line
    // TODO: Add calls to stop animation state if needed (isBallAnimating = false etc.)

    // Reset ball position: Use provided position and lie if available, otherwise default.
    if (position) {
        console.log(">>> CONDITION PASSED: Resetting ball position using provided coordinates:", position, "and lie:", lie);
        CoreVisuals.showBallAtAddress(position, lie); // Pass the position and lie
    } else {
        console.log(">>> CONDITION FAILED: Resetting ball position to default (null). Position was:", position, "Lie:", lie);
        CoreVisuals.showBallAtAddress(null, lie || 'TEE'); // Pass null for position, default to TEE if lie is also null
    }


     // Reset the specific view elements (if any)
     // The ball position is already set by the showBallAtAddress call above.
    if (currentVisualMode === VISUAL_MODES.TARGET) {
        TargetVisuals.resetView(); // Reset target view elements (e.g., clear landing markers)
    }
    // No specific reset needed for RANGE or HOLE views beyond what showBallAtAddress does.

    // Check current camera mode before resetting
    const currentCameraMode = CoreVisuals.getActiveCameraMode();
    const isMeasurementActive = MeasurementView.isViewActive();

    if (isMeasurementActive) {
        MeasurementView.deactivate(); // Ensure measurement view is off
        // After deactivating measurement view, we likely want to go to a default static view.
        switchToStaticCamera();
    } else if (currentCameraMode === CoreVisuals.CameraMode.REVERSE_ANGLE || currentCameraMode === CoreVisuals.CameraMode.GREEN_FOCUS) {
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

// Show ball at address - Calls the core function, optionally passing position
export function showBallAtAddress(position = null) {
    // We need to determine the surface type here ideally, or assume TEE/Range default
    // For now, let core handle the default position if null is passed
    CoreVisuals.showBallAtAddress(position, position ? undefined : 'TEE'); // Pass undefined surface if position is given, let core determine? Or default TEE? Let's default TEE for now.
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
    CoreVisuals.startBallAnimation(points, duration, onAnimationComplete, shotData.isHoledOut, shotData.finalPosition);
}


// --- New Camera Control Functions ---

// Switch to the appropriate static camera view based on current mode AND shot type
export function switchToStaticCamera() {
    MeasurementView.deactivate(); // Ensure measurement view is off
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
            // For full swing, decide based on visual mode
            if (currentVisualMode === VISUAL_MODES.TARGET) {
                viewType = 'target';
            } else if (currentVisualMode === VISUAL_MODES.HOLE) {
                // If in HOLE mode and switching to full swing static view,
                // re-activate the distance-adjusted hole camera instead of applying a generic view.
                console.log("Switching to static camera for full swing in HOLE mode, re-activating hole view.");
                activateHoleViewCamera();
                return; // Exit early as activateHoleViewCamera handles setting the mode/view
            } else {
                viewType = 'range'; // Default full swing view is range
            }
            break;
    }

    // Only apply core static view if we didn't handle it specially above (like for HOLE mode)
    console.log(`Switching to static camera view: ${viewType} (ShotType: ${shotType}, VisualMode: ${currentVisualMode})`);
    CoreVisuals.applyStaticCameraView(viewType);
}

// Activate the static hole view camera (behind ball, looking at flag/target, distance adjusted)
export function activateHoleViewCamera() {
    MeasurementView.deactivate(); // Ensure measurement view is off
    console.log("Activating Hole View Camera (Static, Distance Adjusted)");
    const ballPosition = CoreVisuals.ball?.position; // Get current ball position
    const targetPosition = HoleVisuals.getFlagPosition(); // Get flag position as target

    if (ballPosition && targetPosition) {
        // Calculate distance for camera adjustment
        const distance = ballPosition.distanceTo(targetPosition);

        // --- Calculate the direct angle from ball to target ---
        const dx = targetPosition.x - ballPosition.x;
        const dz = targetPosition.z - ballPosition.z;
        let calculatedAngleRad = Math.atan2(dx, dz); // dx for X, dz for Z for angle from +Z axis
        let calculatedAngleDeg = THREE.MathUtils.radToDeg(calculatedAngleRad);

        // Update the game state's target line angle.
        // This sets currentTargetLineAngle to calculatedAngleDeg and shotDirectionAngle to 0.
        setShotDirectionAngle(calculatedAngleDeg); 
        console.log(`Visuals: Set currentTargetLineAngle to ${calculatedAngleDeg.toFixed(1)} (points at flag) and reset relative aim.`);

        // Call the core function, passing the newly set absolute angle (relative is 0 now)
        CoreVisuals.setCameraBehindBallLookingAtTarget(ballPosition, targetPosition, distance, calculatedAngleDeg);
    } else {
        console.warn("Could not activate hole view camera: Missing ball or target position.");
        // Fallback to default static view?
        switchToStaticCamera(); // Fallback remains the same
    }
}


// Activate the follow ball camera mode
export function activateFollowBallCamera() {
    MeasurementView.deactivate(); // Ensure measurement view is off
    console.log("Activating Follow Ball Camera");
    const currentMode = getCurrentGameMode();

    if (currentMode === 'play-hole') {
        console.log("Setting initial follow camera for play-hole mode.");
        const ballPosition = CoreVisuals.ball?.position;
        const targetPosition = HoleVisuals.getFlagPosition(); // Use flag as initial target

        if (ballPosition && targetPosition) {
            // Set the initial camera position and lookAt *before* activating follow mode
            CoreVisuals.setInitialFollowCameraLookingAtTarget(ballPosition, targetPosition);
        } else {
            console.warn("Could not set initial follow camera for hole: Missing ball or target position. Using default.");
        }
    }

    // Activate the follow mode (will use the position set above if in play-hole, or default otherwise)
    CoreVisuals.setActiveCameraMode(CoreVisuals.CameraMode.FOLLOW_BALL);
}

// Activate the reverse angle camera
export function activateReverseCamera() {
    MeasurementView.deactivate(); // Ensure measurement view is off
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

// Activate the green focus camera (works in Target and Hole modes)
export function activateGreenCamera() {
    MeasurementView.deactivate(); // Ensure measurement view is off
    console.log("Attempting to activate Green Focus Camera");

    let greenCenter = null;
    let greenRadius = null;

    if (currentVisualMode === VISUAL_MODES.TARGET) {
        console.log("Getting green data from TargetVisuals");
        greenCenter = TargetVisuals.getGreenCenter();
        greenRadius = TargetVisuals.getGreenRadius();
    } else if (currentVisualMode === VISUAL_MODES.HOLE) {
        console.log("Getting green data from HoleVisuals");
        greenCenter = HoleVisuals.getGreenCenter();
        greenRadius = HoleVisuals.getGreenRadius();
    } else {
        console.warn(`Green Focus camera not available in current visual mode: ${currentVisualMode}`);
        return;
    }

    if (greenCenter && greenRadius !== null) { // Check radius against null explicitly
        console.log(`Found green data: Center Z=${greenCenter.z.toFixed(1)}, Radius=${greenRadius.toFixed(1)}`);
        CoreVisuals.setCameraGreenFocus(greenCenter, greenRadius);
    } else {
        console.error(`Could not get green position or radius for mode: ${currentVisualMode}`);
    }
}

// --- New Measurement Camera Activation ---
export function activateMeasurementCamera() {
    if (!CoreVisuals.ball || !HoleVisuals.getFlagPosition) {
        console.error("Cannot activate measurement camera: Ball or flag position unavailable.");
        return;
    }
    const ballPosition = CoreVisuals.ball.position.clone();
    const flagPosition = HoleVisuals.getFlagPosition(); // Assuming this returns a THREE.Vector3

    if (!ballPosition || !flagPosition) {
        console.error("Measurement camera activation failed: Ball or flag position is null.");
        return;
    }

    // Deactivate other visual elements if necessary (e.g., target lines from target view)
    // unloadCurrentView(); // This might be too much, let's see.
    // TargetVisuals.hideTargetElements();
    // RangeVisuals.removeRangeVisuals(coreScene);


    console.log("Activating Measurement Camera...");
    MeasurementView.activate(ballPosition, flagPosition);
    // No need to set currentVisualMode here, as MeasurementView manages its own active state
    // and the main render loop will check MeasurementView.isViewActive()
}


// Set specific camera views, potentially used by modes like playHole
export function setCameraView(viewType) {
    MeasurementView.deactivate(); // Ensure measurement view is off
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
