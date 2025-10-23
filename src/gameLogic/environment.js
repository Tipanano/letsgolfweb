import { setWind, getGameState, getWind } from './state.js'; // Added getWind import
import { getRandomInRange } from '../utils/gameUtils.js'; // Assuming a utility function for random numbers exists

// --- Wind Simulation Parameters ---
let baseWindSpeed = 5; // m/s (Example base value)
let baseWindDirection = 90; // degrees (Example base value - East)
let speedVariance = 2; // m/s (How much speed can fluctuate)
let directionVariance = 15; // degrees (How much direction can fluctuate)
let changeInterval = 2000; // ms (How often the wind target changes)
let transitionSpeed = 0.001; // How quickly the wind shifts towards the target (adjust for smoothness)

// --- Internal State ---
let currentTargetWind = { speed: baseWindSpeed, direction: baseWindDirection };
let lastChangeTime = 0;
let windUpdateIntervalId = null; // To store the interval ID

// --- Core Simulation Function ---

/**
 * Updates the target wind speed and direction periodically.
 */
function updateWindTarget() {
    const speedTarget = getRandomInRange(baseWindSpeed - speedVariance, baseWindSpeed + speedVariance);
    // Ensure speed doesn't go below 0
    currentTargetWind.speed = Math.max(0, speedTarget);

    // Handle direction wrapping around 360 degrees
    const directionTarget = getRandomInRange(baseWindDirection - directionVariance, baseWindDirection + directionVariance);
    currentTargetWind.direction = (directionTarget + 360) % 360; // Normalize to 0-359.99...

}

/**
 * Smoothly transitions the current wind towards the target wind state.
 * Called frequently (e.g., via setInterval or requestAnimationFrame).
 */
function simulateWindTick() {
    const currentState = getGameState();
    if (currentState !== 'ready') {
        // Only simulate dynamic wind when the player is preparing the shot
        // When not 'ready', the wind used for the shot calculation is fixed.
        return;
    }

    const now = performance.now();
    const timeSinceLastChange = now - lastChangeTime;

    // Update target periodically
    if (timeSinceLastChange > changeInterval) {
        updateWindTarget();
        lastChangeTime = now;
    }

    // Smoothly interpolate current wind towards the target
    let { speed: currentSpeed, direction: currentDirection } = getWind(); // Get current wind from state

    // Interpolate speed
    const speedDiff = currentTargetWind.speed - currentSpeed;
    currentSpeed += speedDiff * transitionSpeed * 16; // Multiply by ~16ms for frame-based feel

    // Interpolate direction (handle wrapping)
    let directionDiff = currentTargetWind.direction - currentDirection;
    // Adjust difference for shortest path around the circle
    if (directionDiff > 180) directionDiff -= 360;
    if (directionDiff < -180) directionDiff += 360;
    currentDirection += directionDiff * transitionSpeed * 16; // Multiply by ~16ms for frame-based feel
    currentDirection = (currentDirection + 360) % 360; // Normalize

    // Update the global wind state
    setWind(currentSpeed, currentDirection);

    // Note: UI updates should read from getWind() in their own loop
}


// --- Control Functions ---

/**
 * Starts the dynamic wind simulation loop.
 */
export function startWindSimulation() {
    if (windUpdateIntervalId !== null) {
        console.warn("Wind simulation already running.");
        return;
    }
    // Set initial target and time
    updateWindTarget();
    lastChangeTime = performance.now();
    // Start the simulation tick interval (e.g., every ~16ms for ~60fps update)
    windUpdateIntervalId = setInterval(simulateWindTick, 16);
}

/**
 * Stops the dynamic wind simulation loop.
 */
export function stopWindSimulation() {
    if (windUpdateIntervalId !== null) {
        clearInterval(windUpdateIntervalId);
        windUpdateIntervalId = null;
    }
}

/**
 * Sets the base parameters for wind simulation (e.g., when loading a new hole).
 * @param {number} speed - Base wind speed (m/s)
 * @param {number} direction - Base wind direction (degrees)
 * @param {number} [sVariance] - Speed variance (m/s)
 * @param {number} [dVariance] - Direction variance (degrees)
 * @param {number} [interval] - Change interval (ms)
 */
export function setWindParameters(speed, direction, sVariance, dVariance, interval) {
    baseWindSpeed = speed;
    baseWindDirection = (direction + 360) % 360; // Normalize
    if (sVariance !== undefined) speedVariance = Math.max(0, sVariance); // Ensure non-negative
    if (dVariance !== undefined) directionVariance = Math.max(0, dVariance); // Ensure non-negative
    if (interval !== undefined) changeInterval = Math.max(100, interval); // Ensure reasonable interval


    // Immediately update target to reflect new base values if simulation is running
    if (windUpdateIntervalId !== null) {
        updateWindTarget();
        lastChangeTime = performance.now();
    } else {
        // If not running, set the initial wind state directly
        setWind(baseWindSpeed, baseWindDirection);
    }
}

// Example: Initialize with default parameters (can be called from gameLogic.js or main.js)
// setWindParameters(5, 90, 2, 15, 2000);
