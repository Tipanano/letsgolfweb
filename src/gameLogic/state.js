import { clubs } from '../clubs.js';
import { setupTimingBarWindows, setBallPosition, getBallPositionLevels, setSwingSpeedControlState, updateTimingBarVisibility, setClubSelectValue } from '../ui.js';
import { resetCameraPosition, setCameraForChipView, setCameraForPuttView } from '../visuals/core.js';
import * as visuals from '../visuals.js'; // Import visuals main module
import { resetUIForNewShot } from '../ui.js'; // Needed for resetSwingState

// --- Constants ---
// These might be better placed elsewhere if used by physics too, but keep here for now
export const DOWNSWING_TIMING_BAR_DURATION_MS = 500; // For full swing
export const BACKSWING_BAR_MAX_DURATION_MS = 1500; // Max visual duration for bar
export const IDEAL_BACKSWING_DURATION_MS = 1000; // Ideal for full swing power reference
export const PUTT_DISTANCE_FACTOR = 1.5; // Yards per mph of ball speed (Needs tuning!)

// --- Game State ---
export let gameState = 'ready'; // ready, backswing, backswingPausedAtTop, downswingWaiting, calculating, result, chipDownswingWaiting, calculatingChip, puttDownswingWaiting, calculatingPutt
export let currentShotType = 'full'; // 'full', 'chip', 'putt'
export let swingSpeed = 1.0; // Base speed factor (0.3 to 1.0) - Only for 'full' swing
export let selectedClub = clubs['7I']; // Default club

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

// --- Initialization ---
export function initializeGameLogic() {
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

    // Update camera position and potentially select club
    switch (type) {
        case 'chip':
            setCameraForChipView();
            // Optionally force a wedge? Or leave club selection open? For now, leave open.
            break;
        case 'putt':
            setCameraForPuttView();
            // Automatically select the Putter internally
            setSelectedClub('PT'); // Assuming 'PT' is the key for the Putter
            // Update the UI dropdown to reflect this change
            setClubSelectValue('PT');
            break;
        case 'full':
        default:
            // If switching *back* from putt, maybe re-select a default iron? Or leave as is?
            resetCameraPosition(); // Use default range view camera
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

    resetUIForNewShot(); // Use the new reset function that preserves ball position
    visuals.resetVisuals(); // Reset visuals (e.g., ball position)
    console.log("Logic State: Full swing state reset (including visuals).");
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
