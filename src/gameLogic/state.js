import { clubs } from '../clubs.js';
import { setupTimingBarWindows, setBallPosition, getBallPositionLevels, setSwingSpeedControlState, updateTimingBarVisibility, setClubSelectValue } from '../ui.js';
// Import resetStaticCameraZoom along with other camera functions if needed, or just visuals module
import { resetStaticCameraZoom } from '../visuals/core.js'; // Import the new zoom reset function
import * as visuals from '../visuals.js'; // Import visuals main module
import { resetUIForNewShot } from '../ui.js'; // Needed for resetSwingState

// --- Constants ---
// These might be better placed elsewhere if used by physics too, but keep here for now
export const DOWNSWING_TIMING_BAR_DURATION_MS = 500; // For full swing
export const BACKSWING_BAR_MAX_DURATION_MS = 1500; // Max visual duration for bar
export const PUTT_DISTANCE_FACTOR = 1.5; // Yards per mph of ball speed (Needs tuning!)

// --- Game State ---
export let gameState = 'ready'; // ready, backswing, backswingPausedAtTop, downswingWaiting, calculating, result, chipDownswingWaiting, calculatingChip, puttDownswingWaiting, calculatingPutt
export let currentShotType = 'full'; // 'full', 'chip', 'putt'
export let swingSpeed = 1.0; // Base speed factor (0.3 to 1.0) - Only for 'full' swing
export let selectedClub = clubs['7I']; // Default club
export let currentTargetLineAngle = 0; // Absolute angle (degrees) of the intended target line relative to Z-axis
export let shotDirectionAngle = 0; // Angle in degrees RELATIVE to currentTargetLineAngle (player's fine-tuning adjustment)

// --- Environmental State ---
export let temperature = 20; // Degrees Celsius (Can be updated per hole/round)
export let wind = { speed: 0, direction: 0 }; // Current instantaneous wind { speed: m/s, direction: degrees }

// --- Timing Variables ---
export let backswingStartTime = null;
export let backswingEndTime = null;
export let backswingDuration = null;
export let rotationInitiationTime = null;
export let armsStartTime = null;
export let wristsStartTime = null;
export let rotationStartTime = null; // Full swing rotation start
export let hipInitiationTime = null; // Added

// Chip Timing Variables
export let chipRotationStartTime = null;
export let chipWristsStartTime = null; // Represents 'hit' time for chip

// Putt Timing Variables
export let puttHitTime = null; // Represents 'i' press time for putt

// --- Animation Frame IDs ---
export let backswingAnimationFrameId = null;
export let fullDownswingAnimationFrameId = null; // Renamed for clarity
export let chipDownswingAnimationFrameId = null; // Added for chip
export let puttDownswingAnimationFrameId = null; // Added for putt
export let downswingPhaseStartTime = null; // Common start time for downswing phase (W release for chip/putt)

// Callback for when shot calculation is complete
export let onShotCompleteCallback = null;

// --- Setters for State ---
// (Using functions to modify exported 'let' variables)

export function setGameState(newState) {
    gameState = newState;
}

export function setShotDirectionAngle(angle) {
    console.log('set direction angle:', angle);
    // Clamp the angle if needed, or let it wrap? For now, let it be any value.
    // This function now sets the ABSOLUTE target line angle.
    // The relative adjustment (shotDirectionAngle) is handled separately or defaults to 0.
    currentTargetLineAngle = angle;
    shotDirectionAngle = 0; // Reset relative adjustment when target changes
    console.log(`Logic State: Target Line Angle set to: ${angle.toFixed(1)} degrees. Relative angle reset to 0.`);
}

// Function to set the RELATIVE adjustment angle
export function setRelativeShotDirectionAngle(relativeAngle) {
    // Clamp or normalize as needed
    shotDirectionAngle = relativeAngle;
    console.log(`Logic State: Relative Shot Direction Angle set to: ${relativeAngle.toFixed(1)} degrees`);
}


export function setBackswingStartTime(time) {
    backswingStartTime = time;
}

export function setBackswingEndTime(time) {
    backswingEndTime = time;
    if (backswingStartTime) {
        backswingDuration = backswingEndTime - backswingStartTime;
    } else {
        backswingDuration = null;
    }
}

export function setRotationInitiationTime(time) {
    rotationInitiationTime = time;
}

export function setArmsStartTime(time) {
    armsStartTime = time;
}

export function setWristsStartTime(time) {
    wristsStartTime = time;
}

export function setRotationStartTime(time) {
    rotationStartTime = time;
}

export function setHipInitiationTime(time) {
    hipInitiationTime = time;
}

export function setChipRotationStartTime(time) {
    chipRotationStartTime = time;
}

export function setChipWristsStartTime(time) {
    chipWristsStartTime = time;
}

export function setPuttHitTime(time) {
    puttHitTime = time;
}

export function setBackswingAnimationFrameId(id) {
    backswingAnimationFrameId = id;
}

export function setFullDownswingAnimationFrameId(id) {
    fullDownswingAnimationFrameId = id;
}

export function setChipDownswingAnimationFrameId(id) {
    chipDownswingAnimationFrameId = id;
}

export function setPuttDownswingAnimationFrameId(id) {
    puttDownswingAnimationFrameId = id;
}

export function setDownswingPhaseStartTime(time) {
    downswingPhaseStartTime = time;
}

export function setTemperature(temp) {
    temperature = temp;
    // Optionally, update UI if temp is displayed live
    // console.log(`Logic State: Temperature set to: ${temp}°C`); // Reduce logging noise
}

// Sets the *current* wind conditions. Called frequently by the dynamic wind simulation.
export function setWind(speed, direction) {
    // Add validation/clamping if needed
    // const changed = wind.speed !== speed || wind.direction !== direction; // Check if needed for events
    wind = { speed, direction };
    // Avoid logging here as it will be called very often
    // if (changed) { /* trigger UI update event? */ } // Consider event system later if polling is inefficient
}


// --- Initialization ---
export function initializeGameLogic() {
    // Set initial environmental conditions (can be overridden later, e.g., by hole data or weather system)
    setTemperature(20); // Default temperature
    setWind(0, 0); // Default no wind

    // Initial swing speed setup is handled by UI calling setSwingSpeed
    resetSwingState(); // Call the local reset function
    console.log("Game Logic State Initialized.");
}

// Function for main.js to register its handler
export function registerShotCompletionCallback(callback) {
    if (typeof callback === 'function') {
        onShotCompleteCallback = callback;
        console.log("Shot completion callback registered.");
    } else {
        console.error("Attempted to register invalid shot completion callback.");
    }
}

// --- State Management Functions ---
export function setSwingSpeed(percentage) {
    swingSpeed = percentage / 100;
    setupTimingBarWindows(swingSpeed); // Update UI windows when speed changes
    console.log(`Logic State: Swing Speed set to: ${percentage}% (Multiplier: ${swingSpeed.toFixed(2)})`);
}

export function setSelectedClub(clubKey) {
    selectedClub = clubs[clubKey];
    console.log(`Logic State: Club set to: ${selectedClub.name}`);

    // Set the default ball position for the selected club
    if (selectedClub && selectedClub.defaultBallPositionIndex !== undefined) {
        setBallPosition(selectedClub.defaultBallPositionIndex);
    } else {
        // Fallback if property is missing (optional, could default to center)
        console.warn(`Club ${clubKey} missing defaultBallPositionIndex. Setting to center.`);
        setBallPosition(Math.floor(getBallPositionLevels() / 2)); // Default to center index
    }
}

// New function to set the shot type
export function setShotType(type) {
    if (currentShotType === type) return; // No change

    console.log(`Logic State: Shot Type set to: ${type}`);
    currentShotType = type;

    // Enable/disable swing speed slider based on type
    const isFullSwing = (type === 'full');
    setSwingSpeedControlState(isFullSwing);

    // Update visibility of timing bars based on shot type
    updateTimingBarVisibility(type);

    // Update club selection for putt
    switch (type) {
        case 'chip':
            // Camera is no longer changed here
            // Optionally force a wedge? Or leave club selection open? For now, leave open.
            break;
        case 'putt':
            // Camera is no longer changed here
            // Automatically select the Putter internally
            setSelectedClub('PT'); // Assuming 'PT' is the key for the Putter
            // Update the UI dropdown to reflect this change
            setClubSelectValue('PT');
            break;
        case 'full':
        default:
            // Camera is no longer changed here
            // If switching *back* from putt, maybe re-select a default iron? Or leave as is?
            break;
    }

    // Reset swing state when changing type
    //resetSwingState(); // Call the full reset function
}

// This function performs the full reset including UI/Visuals
export function resetSwingState() { // Added 'export' keyword here
    gameState = 'ready';
    backswingStartTime = null;
    backswingEndTime = null;
    backswingDuration = null;
    rotationInitiationTime = null;
    armsStartTime = null; // Full swing
    wristsStartTime = null; // Full swing
    rotationStartTime = null; // Full swing
    hipInitiationTime = null; // Full swing reset
    chipRotationStartTime = null; // Chip reset
    chipWristsStartTime = null; // Chip reset
    puttHitTime = null; // Putt reset

    // Stop animations if still running (Need to handle cancellation logic elsewhere now)
    // This function should only reset the state variables.
    // Animation cancellation will be handled in the actions/animations modules.
    backswingAnimationFrameId = null;
    fullDownswingAnimationFrameId = null;
    chipDownswingAnimationFrameId = null;
    puttDownswingAnimationFrameId = null;
    downswingPhaseStartTime = null;
    shotDirectionAngle = 0; // Reset relative adjustment
    currentTargetLineAngle = 0; // Reset target line angle

    resetUIForNewShot(); // Use the new reset function that preserves ball position
    visuals.resetVisuals(); // Reset visuals (e.g., ball position, tee)
    resetStaticCameraZoom(); // Reset the static camera zoom level
    console.log("Logic State: Full swing state reset (including visuals and zoom).");
}

// Resets only the core swing timing/state variables and animation IDs
export function resetSwingVariablesOnly() { // Added 'export' keyword here
    gameState = 'ready';
    backswingStartTime = null;
    backswingEndTime = null;
    backswingDuration = null;
    rotationInitiationTime = null;
    armsStartTime = null; // Full swing
    wristsStartTime = null; // Full swing
    rotationStartTime = null; // Full swing
    hipInitiationTime = null; // Full swing reset
    chipRotationStartTime = null; // Chip reset
    chipWristsStartTime = null; // Chip reset
    puttHitTime = null; // Putt reset

    // Stop animations if still running (Need to handle cancellation logic elsewhere now)
    // This function should only reset the state variables.
    // Animation cancellation will be handled in the actions/animations modules.
    backswingAnimationFrameId = null;
    fullDownswingAnimationFrameId = null;
    chipDownswingAnimationFrameId = null;
    puttDownswingAnimationFrameId = null;
    downswingPhaseStartTime = null;
    // Don't reset angles here to allow aiming adjustments between attempts
    // shotDirectionAngle = 0;
    // currentTargetLineAngle = 0;

    // NOTE: This version does NOT reset UI or Visuals
    console.log("Logic State: Swing variables reset.");
}


// --- Getters for State Variables (Exported for other modules) ---
// No need to export individual getters if modules import the 'let' variables directly.
// However, exporting getters can be safer if we want to prevent direct modification
// from outside this module (except via the setters). Let's export getters for now.

// resetSwingState and resetSwingVariablesOnly are now exported directly above

export const getGameState = () => gameState;
export const getCurrentShotType = () => currentShotType;
export const getSwingSpeed = () => swingSpeed;
export const getSelectedClub = () => selectedClub;
export const getBackswingStartTime = () => backswingStartTime;
export const getBackswingEndTime = () => backswingEndTime;
export const getBackswingDuration = () => backswingDuration;
export const getRotationInitiationTime = () => rotationInitiationTime;
export const getArmsStartTime = () => armsStartTime;
export const getWristsStartTime = () => wristsStartTime;
export const getRotationStartTime = () => rotationStartTime;
export const getHipInitiationTime = () => hipInitiationTime;
export const getChipRotationStartTime = () => chipRotationStartTime;
export const getChipWristsStartTime = () => chipWristsStartTime;
export const getPuttHitTime = () => puttHitTime;
export const getBackswingAnimationFrameId = () => backswingAnimationFrameId;
export const getFullDownswingAnimationFrameId = () => fullDownswingAnimationFrameId;
export const getChipDownswingAnimationFrameId = () => chipDownswingAnimationFrameId;
export const getPuttDownswingAnimationFrameId = () => puttDownswingAnimationFrameId;
export const getDownswingPhaseStartTime = () => downswingPhaseStartTime;
export const getOnShotCompleteCallback = () => onShotCompleteCallback; // Getter for the callback
export const getShotDirectionAngle = () => shotDirectionAngle; // Gets the RELATIVE adjustment angle
export const getCurrentTargetLineAngle = () => currentTargetLineAngle; // Gets the ABSOLUTE target line angle
export const getTemperature = () => temperature;
export const getWind = () => wind; // Gets the current wind object { speed, direction }
