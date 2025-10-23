// --- Facade for Game Logic Modules ---
// This file re-exports functions and variables from the new modules
// in the src/gameLogic/ directory to maintain the original API.

// --- State Exports ---
export {
    // State Variables (Getters)
    getGameState,
    getCurrentShotType,
    getSwingSpeed,
    getSelectedClub,
    getBackswingStartTime,
    getBackswingEndTime,
    getBackswingDuration,
    getRotationInitiationTime,
    getArmsStartTime,
    getWristsStartTime,
    getRotationStartTime,
    getHipInitiationTime,
    getChipRotationStartTime,
    getChipWristsStartTime,
    getPuttHitTime,
    getDownswingPhaseStartTime,
    // State Management Functions
    initializeGameLogic,
    registerShotCompletionCallback,
    setSwingSpeed,
    setSelectedClub,
    setShotType,
    // Constants (if needed externally, though maybe better elsewhere)
    // DOWNSWING_TIMING_BAR_DURATION_MS,
    // BACKSWING_BAR_MAX_DURATION_MS,
    // IDEAL_BACKSWING_DURATION_MS,
    // PUTT_DISTANCE_FACTOR
} from './gameLogic/state.js';

// --- Action Exports ---
export {
    startBackswing,
    endBackswing,
    recordRotationInitiation,
    recordHipInitiation,
    startDownswingPhase,
    recordDownswingKey,
    recordChipKey,
    recordPuttKey,
    triggerFullSwingCalc, // Keep export for animation timeout trigger
    triggerChipCalc,      // Keep export for animation timeout trigger
    triggerPuttCalc,      // Keep export for animation timeout trigger
    resetSwing            // Export the main reset function
} from './gameLogic/actions.js';

// --- Calculation Exports ---
// Export the main calculation functions in case they are needed directly (e.g., for testing)
// Note: These are also called internally by actions.js and animations.js
export {
    calculateFullSwingShot,
    calculateChipShot,
    calculatePuttShot
} from './gameLogic/calculations.js';

// --- Utility Exports ---
export {
    getDebugTimingData // Exported for UI/InputHandler
    // clamp function is internal to calculations/trajectory now
} from './utils/gameUtils.js';

// --- Animation Exports ---
// Generally, animation start/stop functions are called by actions.js,
// so they might not need to be exported from the main facade unless
// explicitly controlled elsewhere. Let's omit them for now.
// export {
//     startBackswingAnimation, stopBackswingAnimation,
//     startFullDownswingAnimation, stopFullDownswingAnimation,
//     startChipDownswingAnimation, stopChipDownswingAnimation,
//     startPuttDownswingAnimation, stopPuttDownswingAnimation,
//     stopAllAnimations
// } from './gameLogic/animations.js';

// --- Simulation & Trajectory Exports ---
// These are typically internal to the calculation functions.
// Exporting them might only be necessary for debugging or specific visual needs.
// export { simulateFlightStepByStep } from './gameLogic/simulation.js';
// export { calculateTrajectoryPoints, calculatePuttTrajectoryPoints } from './gameLogic/trajectory.js';

