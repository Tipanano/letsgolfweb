// Logic for the "Closest to the Flag" game mode
import * as ui from '../ui.js'; // Import UI functions

// --- State ---
let targetDistanceYards = 0;
let shotsTaken = 0;
let bestDistanceToHoleYards = Infinity;
let currentModeActive = false;

// --- Functions ---

export function initializeMode() {
    console.log("Initializing Closest to Flag mode...");
    currentModeActive = true;
    shotsTaken = 0;
    bestDistanceToHoleYards = Infinity;
    // Generate random target distance
    targetDistanceYards = Math.floor(Math.random() * (200 - 120 + 1)) + 120;
    console.log(`Target distance set to: ${targetDistanceYards} yards`);

    // Update UI
    ui.resetClosestToFlagDisplay(); // Reset display first
    ui.updateTargetDistanceDisplay(targetDistanceYards); // Show the target distance

    // Visuals switch is handled by main.js
    // visuals.switchToTargetView(targetDistanceYards);

    // TODO: Reset player state if needed (e.g., allow swing)
    // logic.resetSwing(); // Might be called by main.js already
}

export function terminateMode() {
    console.log("Terminating Closest to Flag mode.");
    currentModeActive = false;
    // TODO: Clean up UI elements specific to this mode?
}

export function handleShotResult(shotData) {
    if (!currentModeActive) return;

    shotsTaken++;
    console.log("ClosestToFlag: Handling shot result:", shotData);

    // Calculate distance from hole (simple 2D for now)
    // Assume shotData.carryDistance is straight distance
    // Assume shotData.sideDistance is deviation left/right (needs to be calculated in gameLogic)
    const sideDistanceYards = shotData.sideDistance || 0; // Placeholder - needs calculation
    const endDistanceYards = shotData.carryDistance + shotData.rolloutDistance; // Use total distance

    const distanceRemainingYards = Math.abs(targetDistanceYards - endDistanceYards);
    const distanceFromHoleYards = Math.sqrt(distanceRemainingYards**2 + sideDistanceYards**2);

    console.log(`Shot ${shotsTaken}: Landed ${distanceFromHoleYards.toFixed(1)} yards from the hole.`);

    if (distanceFromHoleYards < bestDistanceToHoleYards) {
        bestDistanceToHoleYards = distanceFromHoleYards;
    }

    // Update UI with result
    ui.updateClosestToFlagResult(distanceFromHoleYards, bestDistanceToHoleYards, shotsTaken);

    // TODO: Decide if the game ends (e.g., after 1 shot, or multiple)
    // For now, let it continue until mode is switched.
}

export function getTargetDistance() {
    return targetDistanceYards;
}

// Add other necessary functions, e.g., getting current score/best distance
