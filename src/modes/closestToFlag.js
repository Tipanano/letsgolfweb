// Logic for the "Closest to the Flag" game mode
import * as ui from '../ui.js'; // Import UI functions
import { metersToYards, yardsToMeters } from '../utils/unitConversions.js'; // Import conversion utilities
import { getSurfaceProperties } from '../surfaces.js'; // Import surface properties
import { getFlagPosition } from '../visuals/targetView.js'; // Import flag position

// --- State ---
let targetDistanceMeters = 0; // Store internally in meters
let shotsTaken = 0;
let bestDistanceToHoleMeters = Infinity; // Store internally in meters
let currentModeActive = false;

// --- Functions ---

export function initializeMode(providedTargetDistanceMeters = null) {
    currentModeActive = true;
    shotsTaken = 0;
    bestDistanceToHoleMeters = Infinity;

    // Use provided target distance, or generate random if not provided (110-183 meters = ~120-200 yards)
    targetDistanceMeters = providedTargetDistanceMeters ||
                           (Math.floor(Math.random() * (183 - 110 + 1)) + 110);

    if (providedTargetDistanceMeters) {
    } else {
    }

    // Update UI (convert meters to yards for display)
    ui.resetClosestToFlagDisplay(); // Reset display first
    ui.updateTargetDistanceDisplay(metersToYards(targetDistanceMeters)); // Convert to yards for display

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
    currentModeActive = false;
    // TODO: Clean up UI elements specific to this mode?
}

export function prepareForNextShot() {

    // Reset UI overlay with initial values (distance to target and tee lie)
    ui.updateVisualOverlayInfo('closest-to-flag', {
        distToFlag: targetDistanceMeters,
        lie: 'Tee'
    });

}

export function handleShotResult(shotData) {
    if (!currentModeActive) return;

    shotsTaken++;

    // Calculate actual distance from hole using real flag position
    const flagPosition = getFlagPosition();
    const ballPosition = shotData.finalPosition;

    let distanceFromHoleMeters;
    if (flagPosition && ballPosition) {
        // Use actual 3D positions (accounting for green offset and hole position within green)
        const dx = ballPosition.x - flagPosition.x;
        const dz = ballPosition.z - flagPosition.z;
        distanceFromHoleMeters = Math.sqrt(dx*dx + dz*dz);
    } else {
        // Fallback to old simplified calculation if positions not available
        console.warn('Flag or ball position not available, using simplified distance calculation');
        const sideDistanceMeters = shotData.sideDistance || 0;
        const endDistanceMeters = shotData.totalDistance;
        const distanceRemainingMeters = Math.abs(targetDistanceMeters - endDistanceMeters);
        distanceFromHoleMeters = Math.sqrt(distanceRemainingMeters**2 + sideDistanceMeters**2);
    }

    // Check if the shot landed on a penalty surface
    const surfaceName = shotData.surfaceName;
    const surfaceProps = surfaceName ? getSurfaceProperties(surfaceName) : null;
    const isPenalty = surfaceProps?.isPenalty || false;

    // Convert to yards for display
    const distanceFromHoleYards = metersToYards(distanceFromHoleMeters);

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

export function getTargetDistanceMeters() {
    return targetDistanceMeters;
}

// Add other necessary functions, e.g., getting current score/best distance
