import {
    getGameState, getBackswingStartTime, getCurrentShotType, getSwingSpeed,
    getDownswingPhaseStartTime, getBackswingDuration,
    setGameState, setBackswingAnimationFrameId, setFullDownswingAnimationFrameId,
    setChipDownswingAnimationFrameId, setPuttDownswingAnimationFrameId,
    getBackswingAnimationFrameId, getFullDownswingAnimationFrameId,
    getChipDownswingAnimationFrameId, getPuttDownswingAnimationFrameId,
    BACKSWING_BAR_MAX_DURATION_MS // <-- Added missing constant import
} from './state.js';
import {
    updateBackswingBar, updateTimingBars, updateChipTimingBars, updatePuttTimingBar
} from '../ui.js';
// Import calculation functions directly
import { calculateFullSwingShot, calculateChipShot, calculatePuttShot } from './calculations.js';
// Import swing arc visualizer
import * as SwingArc from '../swingArcVisualizer.js';

// --- Animation Loop Functions ---

function updateBackswingBarAnimation(timestamp) {
    const state = getGameState();
    const startTime = getBackswingStartTime();
    if (state !== 'backswing' || !startTime) {
        setBackswingAnimationFrameId(null);
        return;
    }
    const elapsedTime = timestamp - startTime;
    const shotType = getCurrentShotType();
    const speed = getSwingSpeed();
    // Use current swingSpeed for full, assume 1.0 for chip/putt? Or pass explicitly?
    const speedForBar = (shotType === 'full') ? speed : 1.0;
    updateBackswingBar(elapsedTime, speedForBar); // Call UI update function

    // Update swing arc visualizer
    const maxDuration = BACKSWING_BAR_MAX_DURATION_MS / speedForBar;
    const progress = Math.min(1.0, elapsedTime / maxDuration);
    const idealDuration = 1000 / speedForBar; // Ideal backswing duration
    const isIdeal = elapsedTime <= idealDuration;
    const isLate = elapsedTime > idealDuration;
    SwingArc.updateBackswingArc(progress, isIdeal, isLate);

    setBackswingAnimationFrameId(requestAnimationFrame(updateBackswingBarAnimation));
}

function updateFullDownswingBarsAnimation(timestamp) {
    const state = getGameState();
    const shotType = getCurrentShotType();
    const startTime = getDownswingPhaseStartTime();
    // Only run if it's a full swing in the correct state
    if (shotType !== 'full' || state !== 'downswingWaiting' || !startTime) {
        setFullDownswingAnimationFrameId(null);
        return;
    }
    const elapsedTime = timestamp - startTime;
    const speed = getSwingSpeed();
    const progressPercent = updateTimingBars(elapsedTime, speed); // Call UI update for full swing bars

    // Update swing arc visualizer
    const progress = progressPercent / 100;
    SwingArc.updateDownswingArc(progress);

    if (progressPercent < 100) {
        setFullDownswingAnimationFrameId(requestAnimationFrame(updateFullDownswingBarsAnimation));
    } else {
        // Bars filled up - Timeout
        setFullDownswingAnimationFrameId(null);
        console.log("Animation: Full Swing downswing bars reached 100%");
        // Check if the shot hasn't already been triggered by key presses
        if (getGameState() === 'downswingWaiting') { // Re-check state in case it changed
            console.log("Animation: Full Swing downswing timed out. Triggering calculation.");
            // State is set within calculateFullSwingShot now
            calculateFullSwingShot();
        }
    }
}

function updateChipDownswingBarsAnimation(timestamp) {
    const state = getGameState();
    const shotType = getCurrentShotType();
    const startTime = getDownswingPhaseStartTime();
    // Only run if it's a chip swing in the correct state
    if (shotType !== 'chip' || state !== 'chipDownswingWaiting' || !startTime) {
        setChipDownswingAnimationFrameId(null);
        return;
    }
    const elapsedTime = timestamp - startTime;
    const backswingDuration = getBackswingDuration(); // Get the actual backswing duration
    // Call the new UI function for chip bars
    const progressPercent = updateChipTimingBars(elapsedTime, backswingDuration); // Pass elapsed time and backswing duration

    // Update swing arc visualizer for chip downswing
    const progress = progressPercent / 100;
    SwingArc.updateDownswingArc(progress);

    if (progressPercent < 100) {
        setChipDownswingAnimationFrameId(requestAnimationFrame(updateChipDownswingBarsAnimation));
    } else {
        // Bars filled up - Timeout
        setChipDownswingAnimationFrameId(null);
        console.log("Animation: Chip downswing bars reached 100%");
        // Check if the shot hasn't already been triggered by key presses
        if (getGameState() === 'chipDownswingWaiting') { // Re-check state
            console.log("Animation: Chip downswing timed out. Triggering calculation.");
            // State is set within calculateChipShot now
            // setGameState('calculatingChip'); // Set state before calling
            calculateChipShot();
        }
    }
}

function updatePuttDownswingBarAnimation(timestamp) {
    const state = getGameState();
    const shotType = getCurrentShotType();
    const startTime = getDownswingPhaseStartTime();
    // Only run if it's a putt in the correct state and downswing has started
    if (shotType !== 'putt' || state !== 'puttDownswingWaiting' || !startTime) {
        setPuttDownswingAnimationFrameId(null);
        return;
    }
    const elapsedTime = timestamp - startTime;
    // Call the UI update function which uses a fixed duration for visual speed
    const progressPercent = updatePuttTimingBar(elapsedTime); // Visually fills based on BACKSWING_BAR_MAX_DURATION_MS

    // Update swing arc visualizer for putt downswing
    const progress = progressPercent / 100;
    SwingArc.updateDownswingArc(progress);

    // Continue the animation as long as the VISUAL bar isn't full
    if (progressPercent < 100) {
        setPuttDownswingAnimationFrameId(requestAnimationFrame(updatePuttDownswingBarAnimation));
    } else {
        // Visual bar is full. Stop the animation.
        setPuttDownswingAnimationFrameId(null);
        console.log("Animation: Putt downswing visual bar reached 100%.");

        // Now, check if the shot hasn't already been triggered by the 'i' key press.
        // If still waiting, it means the player didn't press 'i' in time (or at all).
        if (getGameState() === 'puttDownswingWaiting') { // Re-check state
            console.log("Animation: Putt downswing timed out (visual bar full). Triggering calculation.");
            // puttHitTime remains null, which puttPhysics handles as a very late hit (pull)
            // State is set within calculatePuttShot now
            // setGameState('calculatingPutt'); // Set state before calling
            calculatePuttShot();
        }
    }
}

// --- Functions to Start/Stop Animations ---

export function startBackswingAnimation() {
    const currentId = getBackswingAnimationFrameId();
    if (currentId) cancelAnimationFrame(currentId);

    // Start swing arc visualizer
    const speed = getSwingSpeed();
    const shotType = getCurrentShotType();
    const speedForArc = (shotType === 'full') ? speed : 1.0;
    SwingArc.startBackswingArc(speedForArc, shotType);

    setBackswingAnimationFrameId(requestAnimationFrame(updateBackswingBarAnimation));
}

export function stopBackswingAnimation() {
    const currentId = getBackswingAnimationFrameId();
    if (currentId) cancelAnimationFrame(currentId);
    setBackswingAnimationFrameId(null);
}

export function startFullDownswingAnimation() {
    const currentId = getFullDownswingAnimationFrameId();
    if (currentId) cancelAnimationFrame(currentId);

    // End backswing arc and start downswing arc
    SwingArc.endBackswingArc();
    SwingArc.startDownswingArc();

    setFullDownswingAnimationFrameId(requestAnimationFrame(updateFullDownswingBarsAnimation));
}

export function stopFullDownswingAnimation() {
    const currentId = getFullDownswingAnimationFrameId();
    if (currentId) cancelAnimationFrame(currentId);
    setFullDownswingAnimationFrameId(null);
}

export function startChipDownswingAnimation() {
    const currentId = getChipDownswingAnimationFrameId();
    if (currentId) cancelAnimationFrame(currentId);

    // End backswing arc and start downswing arc
    SwingArc.endBackswingArc();
    SwingArc.startDownswingArc();

    setChipDownswingAnimationFrameId(requestAnimationFrame(updateChipDownswingBarsAnimation));
}

export function stopChipDownswingAnimation() {
    const currentId = getChipDownswingAnimationFrameId();
    if (currentId) cancelAnimationFrame(currentId);
    setChipDownswingAnimationFrameId(null);
}

export function startPuttDownswingAnimation() {
    const duration = getBackswingDuration();
    if (duration && duration > 0) {
        const currentId = getPuttDownswingAnimationFrameId();
        if (currentId) cancelAnimationFrame(currentId);

        // End backswing arc and start downswing arc
        SwingArc.endBackswingArc();
        SwingArc.startDownswingArc();

        setPuttDownswingAnimationFrameId(requestAnimationFrame(updatePuttDownswingBarAnimation));
    } else {
        console.warn("Animation: Invalid backswing duration, cannot start putt downswing animation.");
    }
}

export function stopPuttDownswingAnimation() {
    const currentId = getPuttDownswingAnimationFrameId();
    if (currentId) cancelAnimationFrame(currentId);
    setPuttDownswingAnimationFrameId(null);
}

// Function to stop all animations (used in reset)
export function stopAllAnimations() {
    stopBackswingAnimation();
    stopFullDownswingAnimation();
    stopChipDownswingAnimation();
    stopPuttDownswingAnimation();

    // Reset swing arc visualizer
    SwingArc.resetSwingArc();
}
