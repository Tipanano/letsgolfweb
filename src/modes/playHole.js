// src/modes/playHole.js
import * as ui from '../ui.js';
import * as holeGenerator from '../holeGenerator.js';
import * as visuals from '../visuals.js'; // To trigger drawing
import { YARDS_TO_METERS, BALL_RADIUS } from '../visuals/core.js'; // For calculations

// --- State ---
let currentHoleLayout = null;
let shotsTaken = 0;
let score = 0; // Could be relative to par later
let currentBallPosition = null; // Initialize later in initializeMode
let isHoledOut = false;
let currentModeActive = false;

const HOLE_RADIUS_METERS = 0.108 / 2; // Regulation hole diameter is 4.25 inches (0.108m)

// --- Functions ---

export function initializeMode() {
    console.log("Initializing Play Hole mode...");
    currentModeActive = true;
    shotsTaken = 0;
    score = 0;
    isHoledOut = false;
    // Set initial ball position here, where BALL_RADIUS is definitely available
    currentBallPosition = { x: 0, y: BALL_RADIUS, z: 0 };

    // 1. Generate the hole layout
    currentHoleLayout = holeGenerator.generateBasicHole();
    console.log("Generated Layout:", currentHoleLayout);

    // 2. Tell visuals system to draw the hole
    visuals.drawHole(currentHoleLayout); // We'll add this function to visuals.js

    // 3. Update UI
    ui.resetPlayHoleDisplay(); // Need to add this UI function
    ui.updatePlayHoleInfo(currentHoleLayout.par, currentHoleLayout.lengthYards, score); // Need to add this UI function

    // 4. Set initial camera view to behind the ball looking at the hole
    visuals.activateHoleViewCamera(); // Sets the 'hole' view

    // 5. Ensure ball is at the tee position visually
    visuals.resetVisuals(); // This should place the ball at the origin (0, BALL_RADIUS, 0)

    console.log("Play Hole mode initialized.");
}

export function terminateMode() {
    console.log("Terminating Play Hole mode.");
    currentModeActive = false;
    currentHoleLayout = null;
    // Visual cleanup (clearing hole layout) should be handled by visuals.js
    // when switching modes or initializing a new one.
}

export function handleShotResult(shotData) {
    if (!currentModeActive || isHoledOut) return;

    shotsTaken++;
    score = shotsTaken; // Simple score for now
    console.log(`PlayHole: Handling shot ${shotsTaken} result:`, shotData);

    // Update ball position based on the final position from calculations.js
    // This now includes the result of the ground roll simulation.
    if (shotData.finalPosition) {
        // Ensure we have a clean copy, calculations.js should provide {x, y, z}
        currentBallPosition = {
            x: shotData.finalPosition.x,
            y: shotData.finalPosition.y,
            z: shotData.finalPosition.z
        };
        // Ensure ball doesn't sink below ground visually if physics reports low y
        // (Ground roll sim should handle this, but double-check)
        if (currentBallPosition.y < BALL_RADIUS) {
            currentBallPosition.y = BALL_RADIUS;
        }
        console.log(`New ball position (meters): x=${currentBallPosition.x.toFixed(2)}, y=${currentBallPosition.y.toFixed(2)}, z=${currentBallPosition.z.toFixed(2)}`);
    } else {
        console.error("PlayHole Error: Shot data did not contain finalPosition!");
        // Cannot proceed without a final position
        return;
    }

    // Check if holed out using the status from calculations.js
    isHoledOut = shotData.isHoledOut || false; // Use the flag directly

    if (isHoledOut) {
        console.log(`HOLE OUT! Score: ${score}`);
        ui.showHoleOutMessage(score); // Need to add this UI function
        // Potentially disable further input here
    } else {
         // Ball is not holed out, prepare for next shot
         // The ball's visual position should be updated by the animation callback in core.js
         // using the trajectory points from shotData.
         console.log("Ball is not holed out. Ready for next shot.");
    }

    // Update UI with score
    ui.updatePlayHoleInfo(currentHoleLayout.par, currentHoleLayout.lengthYards, score);

}

// --- Getters (optional) ---
export function getCurrentHoleLayout() {
    return currentHoleLayout;
}

export function getCurrentScore() {
    return score;
}

export function getIsHoledOut() {
    return isHoledOut;
}

export function getCurrentBallPosition() {
    // Return a copy to prevent accidental modification
    return { ...currentBallPosition };
}
