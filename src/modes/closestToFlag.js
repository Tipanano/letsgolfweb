// Logic for the "Closest to the Flag" game mode
import * as ui from '../ui.js'; // Import UI functions
import { metersToYards, yardsToMeters } from '../utils/unitConversions.js'; // Import conversion utilities
import { getSurfaceProperties } from '../surfaces.js'; // Import surface properties

// --- State ---
let targetDistanceMeters = 0; // Store internally in meters
let shotsTaken = 0;
let bestDistanceToHoleMeters = Infinity; // Store internally in meters
let currentModeActive = false;

// --- Functions ---

export function initializeMode(providedTargetDistanceMeters = null) {
    console.log("Initializing Closest to Flag mode...");
    currentModeActive = true;
    shotsTaken = 0;
    bestDistanceToHoleMeters = Infinity;

    // Use provided target distance, or generate random if not provided (110-183 meters = ~120-200 yards)
    targetDistanceMeters = providedTargetDistanceMeters ||
                           (Math.floor(Math.random() * (183 - 110 + 1)) + 110);

    if (providedTargetDistanceMeters) {
        console.log(`Target distance set to: ${targetDistanceMeters.toFixed(1)} meters (from server)`);
    } else {
        console.log(`Target distance randomly set to: ${targetDistanceMeters.toFixed(1)} meters (~${metersToYards(targetDistanceMeters).toFixed(0)} yards)`);
    }

    // Update UI (UI will convert meters to yards for display)
    ui.resetClosestToFlagDisplay(); // Reset display first
    ui.updateTargetDistanceDisplay(targetDistanceMeters); // Pass meters, UI converts to yards

    // Update visual overlay info with distance to flag and lie
    ui.updateVisualOverlayInfo('closest-to-flag', {
        distToFlag: targetDistanceMeters,
        lie: 'Tee'
    });

    // Visuals switch is handled by main.js
    // visuals.switchToTargetView(targetDistanceMeters);

    // TODO: Reset player state if needed (e.g., allow swing)
    // logic.resetSwing(); // Might be called by main.js already

    return targetDistanceMeters; // Return the target distance in meters for main.js to use
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

    // Check if the shot landed on a penalty surface
    const surfaceName = shotData.surfaceName;
    const surfaceProps = surfaceName ? getSurfaceProperties(surfaceName) : null;
    const isPenalty = surfaceProps?.isPenalty || false;

    // Convert to yards for display
    const distanceFromHoleYards = metersToYards(distanceFromHoleMeters);
    console.log(`Shot ${shotsTaken}: Landed ${distanceFromHoleYards.toFixed(1)} yards from the hole${isPenalty ? ' (PENALTY)' : ''}.`);

    if (distanceFromHoleMeters < bestDistanceToHoleMeters) {
        bestDistanceToHoleMeters = distanceFromHoleMeters;
    }

    // Update UI with result (convert meters to yards for display)
    const bestDistanceYards = metersToYards(bestDistanceToHoleMeters);
    ui.updateClosestToFlagResult(distanceFromHoleYards, bestDistanceYards, shotsTaken);

    // Return the distance for multiplayer to send to server
    return {
        distanceFromHoleMeters,
        distanceFromHoleYards,
        isPenalty // Flag for server to use when determining winner
    };

    // TODO: Decide if the game ends (e.g., after 1 shot, or multiple)
    // For now, let it continue until mode is switched.
}

export function getTargetDistance() {
    // Return in yards for compatibility with existing code
    return metersToYards(targetDistanceMeters);
}

// Add other necessary functions, e.g., getting current score/best distance
