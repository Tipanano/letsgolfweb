import {
    getGameState, getCurrentShotType, getHipInitiationTime, getRotationInitiationTime,
    getArmsStartTime, getWristsStartTime, getRotationStartTime, getChipRotationStartTime,
    getChipWristsStartTime, getPuttHitTime, getBackswingDuration,
    setGameState, setBackswingStartTime, setBackswingEndTime, setRotationInitiationTime,
    setHipInitiationTime, setDownswingPhaseStartTime, setArmsStartTime, setWristsStartTime,
    setRotationStartTime, setChipRotationStartTime, setChipWristsStartTime, setPuttHitTime,
    resetSwingState, resetSwingVariablesOnly, setShotDirectionAngle // Import both reset functions and angle setter
} from './state.js';
import {
    startBackswingAnimation, stopBackswingAnimation, startFullDownswingAnimation,
    startChipDownswingAnimation, stopChipDownswingAnimation, startPuttDownswingAnimation,
    stopPuttDownswingAnimation, stopAllAnimations // Import animation controls
} from './animations.js';
import {
    updateStatus, resetUIForNewShot, updateDebugTimingInfo // Import UI functions (resetUIForNewShot is already imported)
} from '../ui.js';
// Import calculation functions directly
import { calculateFullSwingShot, calculateChipShot, calculatePuttShot } from './calculations.js';
// Import debug data getter directly
import { getDebugTimingData } from './utils.js';
import { getCurrentGameMode } from '../main.js'; // Import mode checker
import { getCurrentBallPosition as getPlayHoleBallPosition } from '../modes/playHole.js'; // Import position getter for playHole ball
import { getFlagPosition } from '../visuals/holeView.js'; // Import flag position getter
import { getActiveCameraMode, setCameraBehindBall, snapFollowCameraToBall, CameraMode, removeTrajectoryLine, applyAimAngleToCamera } from '../visuals/core.js'; // Import camera functions, line removal, and aim application

// --- Action Functions for Input Handler ---

export function startBackswing() {
    if (getGameState() !== 'ready') return;
    const shotType = getCurrentShotType();

    console.log(`Action: ${shotType}: Starting backswing`);
    setGameState('backswing');
    setBackswingStartTime(performance.now());
    updateStatus(`${shotType.charAt(0).toUpperCase() + shotType.slice(1)} Backswing...`);
    resetUIForNewShot(); // Reset UI elements (preserving ball position)

    // Start backswing bar animation
    startBackswingAnimation();
}

export function endBackswing() {
    const state = getGameState();
    if (state !== 'backswing') return;
    const shotType = getCurrentShotType();

    console.log(`Action: ${shotType}: Ending backswing`);
    setBackswingEndTime(performance.now()); // This also calculates backswingDuration in state.js
    const duration = getBackswingDuration(); // Get the calculated duration

    // Stop backswing bar animation
    stopBackswingAnimation();

    // --- Transition logic based on shot type ---
    if (shotType === 'full') {
        // Decide next state based on whether 'j' was pressed during backswing
        if (getHipInitiationTime()) {
            startDownswingPhase(); // Hips already initiated, go straight to downswing waiting
            console.log(`Action: Full Swing: Backswing ended. Hips initiated. Duration: ${duration?.toFixed(0)} ms. Waiting for a, d, i.`);
        } else {
            // Hips not initiated yet, pause at the top
            setGameState('backswingPausedAtTop');
            updateStatus("Paused at Top... Press 'j' to start downswing");
            console.log(`Action: Full Swing: Backswing ended. Hips NOT initiated. Duration: ${duration?.toFixed(0)} ms. Paused.`);
        }
        updateDebugTimingInfo(getDebugTimingData()); // Update debug display
    } else if (shotType === 'chip') {
        // Transition to waiting for chip inputs AND start the downswing phase
        setGameState('chipDownswingWaiting');
        setDownswingPhaseStartTime(performance.now()); // Start chip downswing phase NOW
        updateStatus('Chip: Press a (rotate), then i (hit)');
        console.log(`Action: Chip: Backswing ended. Duration: ${duration?.toFixed(0)} ms. Starting downswing phase. Waiting for a, i.`);
        // Start chip timing bar animation
        startChipDownswingAnimation();
        // updateDebugTimingInfo(getDebugTimingData()); // Need chip-specific debug info
    } else if (shotType === 'putt') {
        // Transition to waiting for putt hit input ('i') AND start the downswing phase
        setGameState('puttDownswingWaiting');
        setDownswingPhaseStartTime(performance.now()); // Start putt downswing phase NOW (W release)
        updateStatus('Putt: Press i (hit)');
        console.log(`Action: Putt: Backswing ended. Duration: ${duration?.toFixed(0)} ms. Starting downswing phase. Waiting for i.`);
        // Start putt downswing timing bar animation
        startPuttDownswingAnimation(); // Animation module handles duration check
    }
}

export function recordRotationInitiation() {
    const state = getGameState();
    if (state === 'backswing' && !getRotationInitiationTime()) {
        setRotationInitiationTime(performance.now());
        console.log("Action: Recorded early rotation ('a')");
    }
}

export function recordHipInitiation() {
    const state = getGameState();
    if ((state === 'backswing' || state === 'backswingPausedAtTop') && !getHipInitiationTime()) {
        const time = performance.now();
        setHipInitiationTime(time);
        console.log(`Action: Recorded 'j' (Hips) at ${time.toFixed(0)}ms. State: ${state}`);
        // UI updates (status, marker) are handled directly in inputHandler for now
    }
}

// Called when 'j' is pressed while paused, or automatically after 'w' release if 'j' was pressed during backswing
export function startDownswingPhase() {
    const shotType = getCurrentShotType();
    const state = getGameState();
    if (shotType === 'full' && (state === 'backswingPausedAtTop' || (state === 'backswing' && getHipInitiationTime()))) {
        setGameState('downswingWaiting');
        updateStatus('Downswing: Press a, d, i...');
        setDownswingPhaseStartTime(performance.now()); // Set common downswing start time
        startFullDownswingAnimation();
        console.log("Action: Started Full Swing Downswing Phase.");
    }
    // Add logic for chip/putt if needed, though their downswing starts on 'w' release
}


export function recordDownswingKey(keyType, timestamp) {
    const shotType = getCurrentShotType();
    const state = getGameState();
    if (shotType !== 'full' || state !== 'downswingWaiting' || !getHipInitiationTime()) return;

    switch (keyType) {
        case 'arms':
            if (!getArmsStartTime()) setArmsStartTime(timestamp);
            break;
        case 'wrists':
            if (!getWristsStartTime()) setWristsStartTime(timestamp);
            break;
        case 'rotation':
             // Only record if not initiated early ('a' during backswing)
            if (!getRotationStartTime() && !getRotationInitiationTime()) setRotationStartTime(timestamp);
            break;
    }
    // UI updates (marker, debug) handled in inputHandler
}

export function recordChipKey(keyType, timestamp) {
    const shotType = getCurrentShotType();
    const state = getGameState();
    if (shotType !== 'chip' || state !== 'chipDownswingWaiting') return;

    switch (keyType) {
        case 'rotation':
            if (!getChipRotationStartTime()) setChipRotationStartTime(timestamp);
            break;
        case 'hit':
            // Must be after rotation
            if (getChipRotationStartTime() && !getChipWristsStartTime()) setChipWristsStartTime(timestamp);
            break;
    }
     // UI updates (marker, status) handled in inputHandler
}

export function recordPuttKey(keyType, timestamp) {
    const shotType = getCurrentShotType();
    const state = getGameState();
    if (shotType !== 'putt' || state !== 'puttDownswingWaiting') return;

    if (keyType === 'hit' && !getPuttHitTime()) {
        setPuttHitTime(timestamp);
        // Stop the putt downswing animation loop immediately when hit is recorded
        stopPuttDownswingAnimation();
    }
    // UI updates handled in inputHandler
}

export function triggerFullSwingCalc() {
    const shotType = getCurrentShotType();
    const state = getGameState(); // Keep only one declaration
    if (shotType === 'full' && state === 'downswingWaiting') {
        // Check if all required keys are pressed
        if (getArmsStartTime() && getWristsStartTime() && (getHipInitiationTime() || getRotationStartTime())) {
            console.log("Action: Triggering full swing calculation from key presses.");
            calculateFullSwingShot(); // Call the calculation function directly
        } else {
            console.warn("Action: Attempted to trigger full swing calc prematurely (missing keys).");
            // Optionally trigger anyway if timeout occurred (handled in animation loop)
            // Or maybe force calculation with missing inputs here if needed?
            // For now, rely on animation timeout to trigger if keys missing.
        }
    }
}

export function triggerChipCalc() {
    const shotType = getCurrentShotType();
    const state = getGameState(); // Keep only one declaration
    if (shotType === 'chip' && state === 'chipDownswingWaiting') {
        // Check if hit key is pressed (rotation is checked implicitly by state)
        if (getChipWristsStartTime()) {
             // Stop the chip animation loop (if not already stopped by timeout)
            stopChipDownswingAnimation();
            console.log("Action: Triggering chip calculation from key presses.");
            setGameState('calculatingChip'); // Set state BEFORE calling calculation
            calculateChipShot(); // Call the calculation function directly
        } else {
             console.warn("Action: Attempted to trigger chip calc prematurely (missing hit key).");
             // Rely on animation timeout to trigger if 'i' missing.
        }
    }
}

export function triggerPuttCalc() {
    const shotType = getCurrentShotType();
    const state = getGameState(); // Keep only one declaration
     if (shotType === 'putt' && state === 'puttDownswingWaiting') {
        // Check if hit key is pressed
        if (getPuttHitTime()) {
             // Animation loop is stopped in recordPuttKey
            console.log("Action: Triggering putt calculation from key press.");
            setGameState('calculatingPutt'); // Set state BEFORE calling calculation
            calculatePuttShot(); // Call the calculation function directly
        } else {
            console.warn("Action: Attempted to trigger putt calc prematurely (missing hit key).");
            // Rely on animation timeout to trigger if 'i' missing.
        }
    }
}

// --- Reset Function ---
// This function performs a FULL reset, including visual ball position. Used for range mode, etc.
export function resetSwing() {
    console.log("Action: Initiating FULL swing reset (including visuals).");
    stopAllAnimations(); // Stop any running animations
    resetSwingState();   // Calls the full reset in state.js
    // UI/Visual reset is called within resetSwingState
}

// This function resets only the logic/timing for the next shot, keeping the ball visually where it is. Used for playHole mode.
// It also updates the camera position based on the new ball location and current camera mode.
export function prepareNextShot() {
    console.log("Action: Preparing next shot (resetting variables only).");
    stopAllAnimations(); // Stop any running animations

    // *** ADD THIS LINE ***
    removeTrajectoryLine(); // Remove the visual trajectory line

    resetSwingVariablesOnly(); // Calls the variable-only reset in state.js
    resetUIForNewShot(); // Reset timing bars and other relevant UI elements
    updateStatus("Ready for next shot..."); // Update status explicitly

    // --- Update Camera Position and Aim for PlayHole Mode ---
    const currentMode = getCurrentGameMode(); // Need to import this if not already available
    if (currentMode === 'play-hole') {
        const ballPos = getPlayHoleBallPosition(); // Get the new ball position (meters {x, y, z})
        const targetPos = getFlagPosition(); // Get the flag position (meters THREE.Vector3)
        const activeCamMode = getActiveCameraMode();
        const shotType = getCurrentShotType(); // Get current shot type ('full', 'chip', 'putt')

        // --- Set Default Aim Angle ---
        if (ballPos && targetPos) {
            const dx = targetPos.x - ballPos.x;
            const dz = targetPos.z - ballPos.z;
            // Calculate angle relative to positive Z-axis (0 degrees)
            // atan2 gives angle in radians from -PI to PI
            const angleRad = Math.atan2(dx, dz);
            // Convert to degrees (0-360 or -180 to 180, doesn't matter as long as consistent)
            const angleDeg = angleRad * (180 / Math.PI);
            setShotDirectionAngle(angleDeg);
            console.log(`Action: Setting default aim angle to hole: ${angleDeg.toFixed(1)} degrees`);
            // REMOVED: applyAimAngleToCamera(); - This was causing the reset. The angle is applied within setCameraBehindBall below.
        } else {
            setShotDirectionAngle(0); // Default to 0 if positions are missing
            console.warn("Action: Could not get ball/target position for default aim. Setting angle to 0.");
            // REMOVED: applyAimAngleToCamera(); - Angle applied below.
        }

        // The aim angle set above will be automatically used by setCameraBehindBall / snapFollowCameraToBall
        console.log(`Action: Updating camera for next shot. BallPos: (${ballPos?.x.toFixed(1)}, ${ballPos?.z.toFixed(1)}), CamMode: ${activeCamMode}, ShotType: ${shotType}`);

        if (activeCamMode === CameraMode.STATIC || activeCamMode === CameraMode.FOLLOW_BALL) {
            // If static or follow, update based on mode
            if (activeCamMode === CameraMode.STATIC) {
                // Determine view type based on shot type
                let viewType = 'range'; // Default for full swing
                if (shotType === 'chip') viewType = 'chip';
                else if (shotType === 'putt') viewType = 'putt';
                setCameraBehindBall(ballPos, viewType);
            } else { // Follow Ball
                snapFollowCameraToBall(ballPos); // Snap follow cam to new position
            }
        } else if (activeCamMode === CameraMode.REVERSE_ANGLE || activeCamMode === CameraMode.GREEN_FOCUS) {
            // If reverse or green view, switch to static behind ball
            console.log(`Action: Switching from ${activeCamMode} to static behind ball view.`);
            let viewType = 'range'; // Default for full swing
            if (shotType === 'chip') viewType = 'chip';
            else if (shotType === 'putt') viewType = 'putt';
            setCameraBehindBall(ballPos, viewType); // This function also sets mode to STATIC
        }
    }
    // Does NOT call visuals.resetVisuals()
}
