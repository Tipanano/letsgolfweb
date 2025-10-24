import {
    getGameState, getCurrentShotType, getHipInitiationTime, getRotationInitiationTime,
    getArmsStartTime, getWristsStartTime, getRotationStartTime, getChipRotationStartTime,
    getChipWristsStartTime, getPuttHitTime, getBackswingDuration, getSelectedClub,
    setGameState, setBackswingStartTime, setBackswingEndTime, setRotationInitiationTime,
    setHipInitiationTime, setDownswingPhaseStartTime, setArmsStartTime, setWristsStartTime,
    setRotationStartTime, setChipRotationStartTime, setChipWristsStartTime, setPuttHitTime,
    resetSwingState, resetSwingVariablesOnly, setShotDirectionAngle, clearSelectedClub, setSelectedClub // Import both reset functions and angle setter
} from './state.js';
import {
    startBackswingAnimation, stopBackswingAnimation, startFullDownswingAnimation,
    startChipDownswingAnimation, stopChipDownswingAnimation, startPuttDownswingAnimation,
    stopPuttDownswingAnimation, stopAllAnimations // Import animation controls
} from './animations.js';
import {
    updateStatus, resetUIForNewShot, updateDebugTimingInfo, clearClubSelection, setSelectedClubButton // Import UI functions (resetUIForNewShot is already imported)
} from '../ui.js';
// Import calculation functions directly
import { calculateFullSwingShot, calculateChipShot, calculatePuttShot } from './calculations.js';
// Import debug data getter directly
import { getDebugTimingData } from '../utils/gameUtils.js';
import { getCurrentGameMode } from '../main.js'; // Import mode checker
// Import necessary functions from playHole.js
import { 
    getCurrentBallPosition as getPlayHoleBallPosition, 
    getCurrentHoleLayout,
    getHoleJustCompleted,
    prepareForTeeShotAfterHoleOut
} from '../modes/playHole.js';
import { getFlagPosition, setFlagstickVisibility } from '../visuals/holeView.js'; // Import flag position getter AND visibility setter
import { getActiveCameraMode, setCameraBehindBall, snapFollowCameraToBall, CameraMode, removeTrajectoryLine, applyAimAngleToCamera, setCameraBehindBallLookingAtTarget, setInitialFollowCameraLookingAtTarget, setBallScale, resetStaticCameraZoom } from '../visuals/core.js'; // Import camera functions, line removal, aim application, setBallScale, AND resetStaticCameraZoom
import { getSurfaceTypeAtPoint } from '../utils/gameUtils.js'; // Import surface checker
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js'; // Need THREE for Vector3
import * as multiplayerManager from '../multiplayerManager.js'; // Import multiplayer manager

// --- Sound Effects ---
const regularShotSound = new Audio('assets/sounds/regular_shot.mp3');
regularShotSound.preload = 'auto'; // Preload the sound

const chipShotSound = new Audio('assets/sounds/chip_shot.mp3');
chipShotSound.preload = 'auto'; // Preload the sound

const puttShotSound = new Audio('assets/sounds/putt_shot.mp3');
puttShotSound.preload = 'auto'; // Preload the sound

// --- Action Functions for Input Handler ---

export function startBackswing() {
    if (getGameState() !== 'ready') return;

    // Check if a club is selected
    const selectedClub = getSelectedClub();
    if (!selectedClub) {
        updateStatus('Select a club first!');
        return;
    }

    // Block second shot in multiplayer CTF mode
    if (multiplayerManager.hasLocalPlayerShot()) {
        updateStatus('You have already taken your shot!');
        return;
    }

    const shotType = getCurrentShotType();

    setGameState('backswing');
    setBackswingStartTime(performance.now());
    updateStatus(`${shotType.charAt(0).toUpperCase() + shotType.slice(1)} Backswing...`);
    resetUIForNewShot(); // Reset UI elements (preserving ball position)

    // Notify multiplayer manager that shot has started
    multiplayerManager.onShotStarted();

    // Start backswing bar animation
    startBackswingAnimation();
}

export function endBackswing() {
    const state = getGameState();
    if (state !== 'backswing') return;
    const shotType = getCurrentShotType();

    setBackswingEndTime(performance.now()); // This also calculates backswingDuration in state.js
    const duration = getBackswingDuration(); // Get the calculated duration

    // Stop backswing bar animation
    stopBackswingAnimation();

    // --- Transition logic based on shot type ---
    if (shotType === 'full') {
        // Decide next state based on whether 'j' was pressed during backswing
        if (getHipInitiationTime()) {
            startDownswingPhase(); // Hips already initiated, go straight to downswing waiting
        } else {
            // Hips not initiated yet, pause at the top
            setGameState('backswingPausedAtTop');
            updateStatus("Paused at Top... Press 'j' to start downswing");
        }
        updateDebugTimingInfo(getDebugTimingData()); // Update debug display
    } else if (shotType === 'chip') {
        // Transition to waiting for chip inputs AND start the downswing phase
        setGameState('chipDownswingWaiting');
        setDownswingPhaseStartTime(performance.now()); // Start chip downswing phase NOW
        updateStatus('Chip: Press a (rotate), then i (hit)');
        // Start chip timing bar animation
        startChipDownswingAnimation();
        // updateDebugTimingInfo(getDebugTimingData()); // Need chip-specific debug info
    } else if (shotType === 'putt') {
        // Transition to waiting for putt hit input ('i') AND start the downswing phase
        setGameState('puttDownswingWaiting');
        setDownswingPhaseStartTime(performance.now()); // Start putt downswing phase NOW (W release)
        updateStatus('Putt: Press i (hit)');
        // Start putt downswing timing bar animation
        startPuttDownswingAnimation(); // Animation module handles duration check
    }
}

export function recordRotationInitiation() {
    const state = getGameState();
    if (state === 'backswing' && !getRotationInitiationTime()) {
        setRotationInitiationTime(performance.now());
    }
}

export function recordHipInitiation() {
    const state = getGameState();
    if ((state === 'backswing' || state === 'backswingPausedAtTop') && !getHipInitiationTime()) {
        const time = performance.now();
        setHipInitiationTime(time);
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

// Play impact sound based on current shot type
export function playImpactSound() {
    const shotType = getCurrentShotType();
    if (shotType === 'full') {
        regularShotSound.play().catch(e => console.error("Error playing regular shot sound:", e));
    } else if (shotType === 'chip') {
        chipShotSound.play().catch(e => console.error("Error playing chip shot sound:", e));
    } else if (shotType === 'putt') {
        puttShotSound.play().catch(e => console.error("Error playing putt shot sound:", e));
    }
}

export function triggerFullSwingCalc() {
    const shotType = getCurrentShotType();
    const state = getGameState(); // Keep only one declaration
    if (shotType === 'full' && state === 'downswingWaiting') {
        // Check if all required keys are pressed
        if (getArmsStartTime() && getWristsStartTime() && (getHipInitiationTime() || getRotationStartTime())) {
            regularShotSound.play().catch(e => console.error("Error playing regular shot sound:", e));
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
            chipShotSound.play().catch(e => console.error("Error playing chip shot sound:", e));
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
            puttShotSound.play().catch(e => console.error("Error playing putt shot sound:", e));
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

    const currentMode = getCurrentGameMode();
    if (currentMode === 'play-hole' && getHoleJustCompleted()) {
        prepareForTeeShotAfterHoleOut();
        // After preparing, the rest of resetSwing will handle UI and visual updates based on the new tee state.
    }

    stopAllAnimations(); // Stop any running animations
    resetSwingState();   // Calls the full reset in state.js, which includes UI and visual reset.
    // UI/Visual reset is called within resetSwingState
}

// This function resets only the logic/timing for the next shot, keeping the ball visually where it is. Used for playHole mode.
// It also updates the camera position based on the new ball location and current camera mode.
export function prepareNextShot() {
    stopAllAnimations(); // Stop any running animations
    removeTrajectoryLine(); // Remove the visual trajectory line
    resetStaticCameraZoom(); // Reset the static camera zoom level

    resetSwingVariablesOnly(); // Calls the variable-only reset in state.js
    resetUIForNewShot(); // Reset timing bars and other relevant UI elements (includes setting status to 'Ready')

    // --- Update Camera Position, Aim, and Flag Visibility for PlayHole Mode ---
    const currentMode = getCurrentGameMode();
    if (currentMode === 'play-hole') {
        const ballPosData = getPlayHoleBallPosition(); // Get the new ball position (meters {x, y, z})
        const targetPos = getFlagPosition(); // Get the flag position (meters THREE.Vector3)
        const activeCamMode = getActiveCameraMode();
        const shotType = getCurrentShotType(); // Get current shot type ('full', 'chip', 'putt')

        // Ensure ballPos is a Vector3 for calculations
        const ballPos = ballPosData ? new THREE.Vector3(ballPosData.x, ballPosData.y, ballPosData.z) : null;

        // --- Toggle Flagstick Visibility AND Set Ball Scale ---
        const layout = getCurrentHoleLayout(); // Get layout
        let isOnGreen = false; // Default
        let isBunker = false;  // Default
        if (ballPos && layout) {
            // Pass only X and Z for surface check
            const surface = getSurfaceTypeAtPoint({ x: ballPos.x, z: ballPos.z }, layout);
            isBunker = (surface === 'BUNKER');
            isOnGreen = (surface === 'GREEN' && !isBunker); // Only on green if not also in a bunker for this logic

            setFlagstickVisibility(!isOnGreen); // Hide if on green (and not bunker), show otherwise
        } else {
            setFlagstickVisibility(true); // Default to visible if info missing
        }
        // Set ball scale based on whether it's on the green (and not a bunker for this specific scaling logic)
        setBallScale(!isOnGreen); // Use enlarged scale if NOT on green (or if in a bunker on the green)

        // --- Auto-select Putter on Green, Clear Club Otherwise ---
        if (isOnGreen) {
            // Auto-select putter when on the green
            setSelectedClub('PT');
            setSelectedClubButton('PT');
        } else {
            // Clear club selection - player must choose club for each shot
            clearSelectedClub(); // Clear from game state
            clearClubSelection(); // Clear from UI
        }

        // --- Set Default Aim Angle ---
        let angleDeg = 0; // Initialize angleDeg
        if (ballPos && targetPos) {
            const dx = targetPos.x - ballPos.x;
            const dz = targetPos.z - ballPos.z;
            // Calculate angle relative to positive Z-axis (0 degrees)
            // atan2 gives angle in radians from -PI to PI
            const angleRad = Math.atan2(dx, dz);
            // Convert to degrees (0-360 or -180 to 180, doesn't matter as long as consistent)
            angleDeg = angleRad * (180 / Math.PI); // Assign calculated angle
            setShotDirectionAngle(angleDeg);
        } else {
            setShotDirectionAngle(0); // Default to 0 if positions are missing
            console.warn("Action: Could not get ball/target position for default aim. Setting angle to 0.");
        }

        // The aim angle set above will be automatically used by the camera setting functions

        if (ballPos && targetPos) { // Ensure we have positions before setting camera
            const distance = ballPos.distanceTo(targetPos);
            if (activeCamMode === CameraMode.STATIC) {
                // *** FIX 1: Pass the calculated angleDeg ***
                setCameraBehindBallLookingAtTarget(ballPos, targetPos, distance, angleDeg);
            } else if (activeCamMode === CameraMode.FOLLOW_BALL) {
                 // *** FIX 2: Call with correct signature (no distance, no angle needed) ***
                setInitialFollowCameraLookingAtTarget(ballPos, targetPos);
            } else if (activeCamMode === CameraMode.REVERSE_ANGLE || activeCamMode === CameraMode.GREEN_FOCUS) {
                // If reverse or green view, switch back to the standard 'hole' static view
                 // *** FIX 3: Pass the calculated angleDeg ***
                setCameraBehindBallLookingAtTarget(ballPos, targetPos, distance, angleDeg);
            }
        } else {
             console.warn("Action: Cannot update camera position for next shot, missing ball or target position.");
             // Optionally reset to a default view if positions are missing
             // CoreVisuals.resetCameraPosition(); // Example fallback
        }
    }
    // Does NOT call visuals.resetVisuals()
}
