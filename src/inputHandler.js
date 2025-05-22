// Handles keyboard input events and translates them into game logic actions or visual changes.

import * as GameLogic from './gameLogic.js'; // Import game logic functions/getters
// Import specific state functions needed for aiming
import { getGameState, getCurrentShotType, getShotDirectionAngle, setShotDirectionAngle, setRelativeShotDirectionAngle, getCurrentTargetLineAngle } from './gameLogic/state.js'; // Added new state functions
import * as Visuals from './visuals.js'; // Import high-level visuals functions
import * as MeasurementView from './visuals/measurementView.js'; // Import MeasurementView
// Import specific core camera functions
import { applyAimAngleToCamera, zoomCameraIn, zoomCameraOut, ball, getActiveCameraMode, adjustStaticCameraDistance, CameraMode } from './visuals/core.js'; // Added ball import and new camera functions
import { YARDS_TO_METERS } from './utils/unitConversions.js'; // Import conversion constant
// Import specific UI functions needed for input feedback (markers, status updates)
import {
    updateStatus,
    markHipInitiationOnBackswingBar,
    showKeyPressMarker,
} from './ui.js';
import { getCurrentGameMode } from './main.js'; // Import the function to get the current game mode
import { prepareNextShot } from './gameLogic/actions.js';
import { getCurrentBallPosition, getCurrentHoleLayout, getHoleJustCompleted } from './modes/playHole.js'; // Import playHole getters (Adjusted path)
import { getFlagPosition } from './visuals/holeView.js'; // Import flag position getter
// --- Constants for Aiming ---
const AIM_INCREMENT_FULL = 0.5; // Degrees per key press
const AIM_INCREMENT_CHIP = 0.2; // Degrees per key press
const AIM_INCREMENT_PUTT = 0.1; // Degrees per key press

// --- Event Handlers ---

export function handleKeyDown(event) {
    // Get current state from GameLogic state module
    const gameState = getGameState();
    const currentShotType = getCurrentShotType();
    // const swingSpeed = GameLogic.getSwingSpeed(); // Moved swingSpeed retrieval into handleFullSwingKeyDown

    console.log(`inputHandler keydown: Key='${event.key}', State='${gameState}', ShotType='${currentShotType}'`);

    // --- Camera Controls (Mode-dependent for '1') ---
    if (event.key === '1') {
        const currentMode = getCurrentGameMode();
        if (currentMode === 'play-hole') {
            Visuals.activateHoleViewCamera(); // Use the new hole-specific static camera
        } else {
            Visuals.switchToStaticCamera(); // Use the default static camera logic
        }
        return; // Consume event
    } else if (event.key === '2') {
        // activateFollowBallCamera in visuals.js now handles mode switching internally
        Visuals.activateFollowBallCamera();
        return; // Consume event
    } else if (event.key === '3') {
        Visuals.activateReverseCamera();
        return; // Consume event
    } else if (event.key === '4') {
        Visuals.activateGreenCamera();
        return; // Consume event
    } else if (event.key === '0') {
        // Activate Measurement Camera View
        Visuals.activateMeasurementCamera();
        return; // Consume event
    }

    // --- Camera Zoom Controls (Height for Static, FOV for others) ---
    if (event.key === '=' || event.key === '+') {
        adjustStaticCameraDistance(-0.1); // Decrease distance level (closer/zoom in)
        //zoomCameraIn(); // This now handles height for static view
        return;
    } else if (event.key === '-') {
        adjustStaticCameraDistance(0.1); // Increase distance level (further/zoom out)
        //zoomCameraOut(); // This now handles height for static view
        return;
    }

    // --- Ball Position Adjustment (Only when ready) --- // THIS SECTION WILL BE MODIFIED FOR ARROW KEYS
    if (gameState === 'ready') {
        const currentCameraMode = getActiveCameraMode(); // Get current camera mode

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (currentCameraMode === CameraMode.STATIC) {
                zoomCameraIn(); // This now handles height for static view
                //adjustStaticCameraDistance(-0.1); // Decrease distance level (closer/zoom in)
            }
            // Removed adjustBallPosition(1);
            return;
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (currentCameraMode === CameraMode.STATIC) {
                zoomCameraOut(); // This now handles height for static view
                //adjustStaticCameraDistance(0.1); // Increase distance level (further/zoom out)
            }
            // Removed adjustBallPosition(-1);
            return;
        }
        // --- Aiming Adjustment (Only when ready) ---
        else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            const currentAngle = getShotDirectionAngle();
            let increment = 0;
            if (currentShotType === 'full') increment = AIM_INCREMENT_FULL;
            else if (currentShotType === 'chip') increment = AIM_INCREMENT_CHIP;
            else if (currentShotType === 'putt') increment = AIM_INCREMENT_PUTT;
            // Adjust the RELATIVE angle
            setRelativeShotDirectionAngle(currentAngle - increment);
            applyAimAngleToCamera(); // Update camera view (using direct import)
            console.log(`Aim Left: New Relative Angle = ${getShotDirectionAngle().toFixed(1)}`);
            return;
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            const currentAngle = getShotDirectionAngle();
            let increment = 0;
            if (currentShotType === 'full') increment = AIM_INCREMENT_FULL;
            else if (currentShotType === 'chip') increment = AIM_INCREMENT_CHIP;
            else if (currentShotType === 'putt') increment = AIM_INCREMENT_PUTT;
            // Adjust the RELATIVE angle
            setRelativeShotDirectionAngle(currentAngle + increment);
            applyAimAngleToCamera(); // Update camera view (using direct import)
            console.log(`Aim Right: New Relative Angle = ${getShotDirectionAngle().toFixed(1)}`);
            return;
        }
        // --- Aim Reset to Hole (Only when ready and in play-hole mode) ---
        else if (event.key === 'h') {
            event.preventDefault();
            const currentMode = getCurrentGameMode();
            if (currentMode !== 'play-hole') return; // Only in play hole mode

            const ballPos = getCurrentBallPosition(); // {x, y, z} in meters
            const layout = getCurrentHoleLayout();
            if (!ballPos || !layout) {
                console.warn("Aim Reset (H): Could not get ball/layout info.");
                return; // Safety check
            }
            const flagPosLayout = layout.flagPosition; // {x, z} in yards

            // Convert flag position to meters
            const flagPosMeters = { x: flagPosLayout.x * YARDS_TO_METERS, z: flagPosLayout.z * YARDS_TO_METERS };

            // Calculate the direction vector (target - source) on the XZ plane
            const dx = flagPosMeters.x - ballPos.x;
            const dz = flagPosMeters.z - ballPos.z;

            // Calculate the angle using Math.atan2(dx, dz)
            // atan2 gives angle relative to +Z axis (North), where East (+X) is +90 deg
            const angleRadians = Math.atan2(dx, dz);

            // Convert to degrees
            const angleDegrees = angleRadians * (180 / Math.PI);

            // Update the state
            setShotDirectionAngle(angleDegrees);

            // Update the camera view
            applyAimAngleToCamera();

            console.log(`Aim Reset (H): Angle set to ${angleDegrees.toFixed(1)} degrees`);
            return; // Consume event
        }
    }

    // --- Common Reset Logic ('n' key) ---
    if (event.key === 'n' && gameState === 'result') {
        handleResetKey();
        return; // Consume event
    }

    // --- Shot Type Specific Logic ---
    if (currentShotType === 'full') {
        handleFullSwingKeyDown(event, gameState); // Removed swingSpeed argument
    } else if (currentShotType === 'chip') {
        handleChipKeyDown(event, gameState);
    } else if (currentShotType === 'putt') {
        handlePuttKeyDown(event, gameState);
    }
}

export function handleKeyUp(event) {
    // Get current state from GameLogic
    const gameState = GameLogic.getGameState();
    const currentShotType = GameLogic.getCurrentShotType();

    console.log(`inputHandler keyup: Key='${event.key}', State='${gameState}', ShotType='${currentShotType}'`);

    // --- Shot Type Specific Logic ---
    if (currentShotType === 'full') {
        handleFullSwingKeyUp(event, gameState);
    } else if (currentShotType === 'chip') {
        handleChipKeyUp(event, gameState);
    } else if (currentShotType === 'putt') {
        handlePuttKeyUp(event, gameState);
    }
}


// --- Helper Functions ---

function handleResetKey() {
    const currentMode = getCurrentGameMode();
    console.log(`InputHandler: 'n' pressed in result state. Mode: ${currentMode}`);
    if (currentMode === 'play-hole') {
        if (getHoleJustCompleted()) {
            console.log("InputHandler: Hole just completed, performing full reset to tee.");
            GameLogic.resetSwing(); // This will trigger prepareForTeeShotAfterHoleOut
        } else {
            console.log("InputHandler: Preparing next shot for playHole mode (not after hole-out).");
            prepareNextShot();
        }
    } else {
        GameLogic.resetSwing(); // Full reset for other modes (e.g., range)
        console.log("InputHandler: Performing full reset for non-play-hole mode.");
    }
}

// --- Helper Functions for KeyDown by Shot Type ---

function handleFullSwingKeyDown(event, gameState) {
    const swingSpeed = GameLogic.getSwingSpeed(); // Get swing speed here as it's only needed for full swing markers
    // Start Backswing with 'w'
    if (event.key === 'w' && gameState === 'ready') {
        GameLogic.startBackswing(); // Call action function in GameLogic
    }


    // Capture 'a' during backswing (early rotation)
    if (event.key === 'a' && gameState === 'backswing' && !GameLogic.getRotationInitiationTime()) {
         GameLogic.recordRotationInitiation(); // Call action function
         console.log("InputHandler: Recorded early rotation ('a')");
    }

    // Capture 'j' (Hip Initiation)
    if (event.key === 'j' && (gameState === 'backswing' || gameState === 'backswingPausedAtTop') && !GameLogic.getHipInitiationTime()) {
        const hipInitiationTimestamp = performance.now(); // Get the precise time of 'j' press
        GameLogic.recordHipInitiation(hipInitiationTimestamp); // Pass timestamp to action

        const backswingStartTime = GameLogic.getBackswingStartTime();
        if (backswingStartTime) {
            const hipPressTimeOffset = hipInitiationTimestamp - backswingStartTime;
            // swingSpeed is already defined at the top of handleFullSwingKeyDown
            markHipInitiationOnBackswingBar(hipPressTimeOffset, swingSpeed); 
        } else {
            console.warn("InputHandler: Could not mark hip initiation on bar, backswingStartTime not available.");
        }
        
        updateStatus("Hips Initiated..."); // Update UI directly

        // If paused at top, pressing 'j' starts the downswing phase immediately
        if (gameState === 'backswingPausedAtTop') {
             GameLogic.startDownswingPhase(); // New action function needed
             console.log("InputHandler: Transitioning from Paused to DownswingWaiting due to 'j' press.");
             // updateDebugTimingInfo(GameLogic.getDebugTimingData()); // Update debug UI
        }
    }

    // Capture downswing sequence keys *only if hips have been initiated*
    if (gameState === 'downswingWaiting' && GameLogic.getHipInitiationTime()) {
        const timeNow = performance.now();
        // Offset relative to backswing end (need backswing end time from GameLogic)
        const backswingEndTime = GameLogic.getBackswingEndTime();
        const offset = backswingEndTime ? timeNow - backswingEndTime : null;

        let keyRecorded = false;
        if (event.key === 'd' && !GameLogic.getArmsStartTime()) {
            GameLogic.recordDownswingKey('arms', timeNow); // New action function
            if (offset !== null) showKeyPressMarker('d', offset, swingSpeed); // Update UI
            keyRecorded = true;
            console.log(`InputHandler: Recorded 'd' (Arms) at offset: ${offset?.toFixed(0)} ms`);
        } else if (event.key === 'i' && !GameLogic.getWristsStartTime()) {
            GameLogic.recordDownswingKey('wrists', timeNow); // New action function
            if (offset !== null) showKeyPressMarker('i', offset, swingSpeed); // Update UI
            keyRecorded = true;
            console.log(`InputHandler: Recorded 'i' (Wrists) at offset: ${offset?.toFixed(0)} ms`);
        } else if (event.key === 'a' && !GameLogic.getRotationStartTime() && !GameLogic.getRotationInitiationTime()) {
            GameLogic.recordDownswingKey('rotation', timeNow); // New action function
            if (offset !== null) showKeyPressMarker('a', offset, swingSpeed); // Update UI
            keyRecorded = true;
            console.log(`InputHandler: Recorded 'a' (Rotation) post-backswing at offset: ${offset?.toFixed(0)} ms`);
        }

        if (keyRecorded) {
            // updateDebugTimingInfo(GameLogic.getDebugTimingData()); // Update debug UI
            // Check if all required keys are pressed to trigger calculation
            if (GameLogic.getArmsStartTime() && GameLogic.getWristsStartTime() && (GameLogic.getHipInitiationTime() || GameLogic.getRotationStartTime())) {
                GameLogic.triggerFullSwingCalc(); // New action function
            }
        }
    }
}

function handleChipKeyDown(event, gameState) {
    // Start Backswing with 'w'
    if (event.key === 'w' && gameState === 'ready') {
        GameLogic.startBackswing();
    }

    // Capture chip downswing keys ('a', then 'i')
    if (gameState === 'chipDownswingWaiting' && GameLogic.getDownswingPhaseStartTime()) {
        const timeNow = performance.now();
        const downswingStartTime = GameLogic.getDownswingPhaseStartTime();
        const offset = timeNow - downswingStartTime;

        // Chip uses 'a' for rotation start
        if (event.key === 'a' && !GameLogic.getChipRotationStartTime()) {
            GameLogic.recordChipKey('rotation', timeNow); // New action function
            showKeyPressMarker('a', offset, 1.0); // Update UI
            updateStatus('Chip: Rotation...'); // Update UI
            console.log(`InputHandler: Recorded Chip 'a' (Rotation) at offset ${offset.toFixed(0)} ms`);
            // updateDebugTimingInfo(...); // Chip debug needed
        }
        // Chip uses 'i' for hit/wrists, must be after 'a'
        else if (event.key === 'i' && GameLogic.getChipRotationStartTime() && !GameLogic.getChipWristsStartTime()) {
            GameLogic.recordChipKey('hit', timeNow); // New action function
            showKeyPressMarker('i', offset, 1.0); // Update UI
            console.log(`InputHandler: Recorded Chip 'i' (Hit) at offset ${offset.toFixed(0)} ms`);
            // updateDebugTimingInfo(...);
            GameLogic.triggerChipCalc(); // Trigger calculation
        }
    }
}

function handlePuttKeyDown(event, gameState) {
    // Start Backswing with 'w'
    if (event.key === 'w' && gameState === 'ready') {
        GameLogic.startBackswing();
    }

    // Capture putt hit key ('i')
    if (gameState === 'puttDownswingWaiting' && GameLogic.getDownswingPhaseStartTime()) {
        const timeNow = performance.now();
        const downswingStartTime = GameLogic.getDownswingPhaseStartTime();
        const offset = timeNow - downswingStartTime;

        if (event.key === 'i' && !GameLogic.getPuttHitTime()) {
            GameLogic.recordPuttKey('hit', timeNow); // New action function
            console.log(`InputHandler: Recorded Putt 'i' (Hit) at offset ${offset.toFixed(0)} ms`);
            GameLogic.triggerPuttCalc(); // Trigger calculation
        }
    }
}


// --- Helper Functions for KeyUp by Shot Type ---

function handleFullSwingKeyUp(event, gameState) {
    if (event.key === 'w' && gameState === 'backswing') {
        GameLogic.endBackswing(); // Call action function in GameLogic
        // updateDebugTimingInfo(GameLogic.getDebugTimingData()); // Update debug UI
    }
}

function handleChipKeyUp(event, gameState) {
    if (event.key === 'w' && gameState === 'backswing') {
        GameLogic.endBackswing(); // Re-use same action function
        // updateDebugTimingInfo(...); // Chip debug needed
    }
}

function handlePuttKeyUp(event, gameState) {
     if (event.key === 'w' && gameState === 'backswing') {
        GameLogic.endBackswing(); // Re-use same action function
    }
}

// --- Mouse Click Handler ---
export function handleMouseDown(event) {
    // Check if the measurement view is active
    if (MeasurementView.isViewActive()) {
        // Prevent default browser actions if needed (e.g., text selection)
        // event.preventDefault();

        // Get canvas and mouse coordinates
        const canvas = event.target; // Assuming the event target is the canvas
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // Get current ball and flag positions (needed for context in handleCourseClick)
        // Ensure these are THREE.Vector3 instances
        const currentBallPosition = ball ? ball.position.clone() : null;
        const currentFlagPosition = getFlagPosition ? getFlagPosition() : null; // Already a Vector3 or null

        if (!currentBallPosition || !currentFlagPosition) {
            console.warn("handleMouseDown: Could not get ball or flag position for measurement click.");
            return;
        }

        // Call the handler in MeasurementView
        MeasurementView.handleCourseClick(mouseX, mouseY, currentBallPosition, currentFlagPosition);
    }
    // If measurement view is not active, do nothing (or handle other potential mouse interactions)
}
