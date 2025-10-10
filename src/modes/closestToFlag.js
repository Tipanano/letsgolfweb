// Logic for the "Closest to the Flag" game mode
import * as ui from '../ui.js'; // Import UI functions
import { metersToYards, yardsToMeters } from '../utils/unitConversions.js'; // Import conversion utilities

// --- State ---
let targetDistanceMeters = 0; // Store internally in meters
let shotsTaken = 0;
let bestDistanceToHoleMeters = Infinity; // Store internally in meters
let currentModeActive = false;

// --- Functions ---

export function initializeMode() {
    console.log("Initializing Closest to Flag mode...");
    currentModeActive = true;
    shotsTaken = 0;
    bestDistanceToHoleMeters = Infinity;
    // Generate random target distance in yards, then convert to meters
    const targetDistanceYards = Math.floor(Math.random() * (200 - 120 + 1)) + 120;
    targetDistanceMeters = yardsToMeters(targetDistanceYards);
    console.log(`Target distance set to: ${targetDistanceYards} yards (${targetDistanceMeters.toFixed(1)} meters)`);

    // Update UI
    ui.resetClosestToFlagDisplay(); // Reset display first
    ui.updateTargetDistanceDisplay(targetDistanceYards); // Show the target distance in yards

    // Visuals switch is handled by main.js
    // visuals.switchToTargetView(targetDistanceYards);

    // TODO: Reset player state if needed (e.g., allow swing)
    // logic.resetSwing(); // Might be called by main.js already

    return targetDistanceYards; // Return the target distance for main.js to use
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
    // shotData distances are now in meters
    const sideDistanceMeters = shotData.sideDistance || 0;
    const endDistanceMeters = shotData.totalDistance; // Use total distance in meters

    const distanceRemainingMeters = Math.abs(targetDistanceMeters - endDistanceMeters);
    const distanceFromHoleMeters = Math.sqrt(distanceRemainingMeters**2 + sideDistanceMeters**2);

    // Convert to yards for display
    const distanceFromHoleYards = metersToYards(distanceFromHoleMeters);
    console.log(`Shot ${shotsTaken}: Landed ${distanceFromHoleYards.toFixed(1)} yards from the hole.`);

    if (distanceFromHoleMeters < bestDistanceToHoleMeters) {
        bestDistanceToHoleMeters = distanceFromHoleMeters;
    }

    // Update UI with result (convert meters to yards for display)
    const bestDistanceYards = metersToYards(bestDistanceToHoleMeters);
    ui.updateClosestToFlagResult(distanceFromHoleYards, bestDistanceYards, shotsTaken);

    // TODO: Decide if the game ends (e.g., after 1 shot, or multiple)
    // For now, let it continue until mode is switched.
}

export function getTargetDistance() {
    // Return in yards for compatibility with existing code
    return metersToYards(targetDistanceMeters);
}

// Add other necessary functions, e.g., getting current score/best distance
