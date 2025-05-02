// src/modes/playHole.js
import * as ui from '../ui.js';
import * as holeGenerator from '../holeGenerator.js';
import * as visuals from '../visuals.js'; // To trigger drawing
import { YARDS_TO_METERS, BALL_RADIUS } from '../visuals/core.js'; // For calculations

// --- State ---
let currentHoleLayout = null;
let shotsTaken = 0;
let score = 0; // Could be relative to par later
let currentBallPosition = { x: 0, y: BALL_RADIUS, z: 0 }; // Start at origin (tee) in meters
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
    currentBallPosition = { x: 0, y: BALL_RADIUS, z: 0 }; // Reset ball to tee

    // 1. Generate the hole layout
    currentHoleLayout = holeGenerator.generateBasicHole();
    console.log("Generated Layout:", currentHoleLayout);

    // 2. Tell visuals system to draw the hole
    visuals.drawHole(currentHoleLayout); // We'll add this function to visuals.js

    // 3. Update UI
    ui.resetPlayHoleDisplay(); // Need to add this UI function
    ui.updatePlayHoleInfo(currentHoleLayout.par, currentHoleLayout.lengthYards, score); // Need to add this UI function

    // 4. Set initial camera view (e.g., tee view)
    visuals.setCameraView('tee'); // Need to add a 'tee' view or use 'range'

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

    // Update ball position based on physics result (assuming shotData.finalPosition is {x, y, z} in meters)
    if (shotData.finalPosition) {
        currentBallPosition = { ...shotData.finalPosition };
         // Ensure ball doesn't sink below ground visually if physics reports y=0
         if (currentBallPosition.y < BALL_RADIUS) {
            currentBallPosition.y = BALL_RADIUS;
        }
        console.log(`New ball position (meters): x=${currentBallPosition.x.toFixed(2)}, y=${currentBallPosition.y.toFixed(2)}, z=${currentBallPosition.z.toFixed(2)}`);
    } else {
        console.warn("Shot data did not contain finalPosition.");
        // Estimate based on carry/roll if needed, but ideally physics provides it
        const endDistanceMeters = (shotData.carryDistance + shotData.rolloutDistance) * YARDS_TO_METERS;
        const sideDistanceMeters = (shotData.sideDistance || 0) * YARDS_TO_METERS;
        // This assumes starting from 0,0 - needs refinement if not first shot
        currentBallPosition = { x: sideDistanceMeters, y: BALL_RADIUS, z: endDistanceMeters };
    }


    // Check if holed out
    const flagPosMeters = {
        x: currentHoleLayout.flagPosition.x * YARDS_TO_METERS,
        z: currentHoleLayout.flagPosition.z * YARDS_TO_METERS
    };

    const dx = currentBallPosition.x - flagPosMeters.x;
    const dz = currentBallPosition.z - flagPosMeters.z;
    const distanceToHoleMeters = Math.sqrt(dx*dx + dz*dz);

    console.log(`Distance to hole: ${distanceToHoleMeters.toFixed(2)} meters`);

    // Check if ball is close enough and low enough (on the green)
    if (distanceToHoleMeters <= HOLE_RADIUS_METERS * 1.5 && currentBallPosition.y <= BALL_RADIUS * 1.5) { // Allow slight tolerance
        isHoledOut = true;
        console.log(`HOLE OUT! Score: ${score}`);
        ui.showHoleOutMessage(score); // Need to add this UI function
        // Potentially disable further input here
    } else {
         // Ball is not holed out, prepare for next shot
         // The ball's visual position should already be updated by the animation callback in core.js
         // We might need to adjust the *next* shot's origin in gameLogic/physics
         // based on currentBallPosition.
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
