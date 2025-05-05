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

    // 1. Generate the hole layout *first* to get tee position
    currentHoleLayout = holeGenerator.generateBasicHole();
    console.log("Generated Layout:", currentHoleLayout);

    // 2. Set initial ball position to the center of the generated tee box
    let initialX = 0;
    let initialZ = 0;
    if (currentHoleLayout?.tee?.center) {
        // Convert tee center (yards) to meters
        initialX = currentHoleLayout.tee.center.x * YARDS_TO_METERS;
        initialZ = currentHoleLayout.tee.center.z * YARDS_TO_METERS;
        console.log(`Setting initial ball position to tee center: (${initialX.toFixed(2)}, ${initialZ.toFixed(2)}) meters`);
    } else {
        console.warn("Tee center not found in layout, defaulting initial position to (0, 0) meters.");
    }
    currentBallPosition = { x: initialX, y: BALL_RADIUS, z: initialZ };

    // 3. Tell visuals system to draw the hole geometry
    visuals.drawHole(currentHoleLayout); // This draws the hole but doesn't necessarily position the ball yet

    // 4. Reset visuals and place the ball at the correct starting position *before* setting the camera view
    visuals.resetVisuals(currentBallPosition);

    // 5. Update UI (Only overlay now)
    // ui.resetPlayHoleDisplay(); // REMOVED
    // ui.updatePlayHoleInfo(currentHoleLayout.par, currentHoleLayout.lengthYards, score); // REMOVED

    // Update visual overlay
    const initialDistToFlag = calculateDistanceToFlag(currentBallPosition, currentHoleLayout.flagPosition);
    // Calculate METERS_TO_YARDS locally
    const METERS_TO_YARDS = 1 / YARDS_TO_METERS;
    ui.updateVisualOverlayInfo('play-hole', {
        holeNum: 1, // Assuming hole 1 for now
        par: currentHoleLayout.par,
        distToFlag: initialDistToFlag/* * METERS_TO_YARDS*/, // Use calculated value
        shotNum: shotsTaken + 1, // Show upcoming shot number (1st shot)
        // score: currentHoleLayout.par, // Pass par for "for score" calculation - score arg is hole score vs par
        lie: 'Tee', // placeholder
        wind: 'Calm', // placeholder
        playerName: 'Player 1', // placeholder
        totalScore: 0, // placeholder, relative to par for round
        position: '1st' // placeholder
    });

    // 6. Set initial camera view *after* the ball has been positioned
    visuals.activateHoleViewCamera(); // Sets the 'hole' view based on the now correct ball position

    // 7. Ball position is already set by resetVisuals above. No need to call again.
    // visuals.resetVisuals(currentBallPosition); // REMOVED redundant call

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
        // ui.showHoleOutMessage(score); // REMOVED (Overlay already shows final score)
        // Potentially disable further input here
    } else {
         // Ball is not holed out, prepare for next shot
         // The ball's visual position should be updated by the animation callback in core.js
         // using the trajectory points from shotData.
         console.log("Ball is not holed out. Ready for next shot.");
    }

    // Update UI with score (Only overlay now)
    // ui.updatePlayHoleInfo(currentHoleLayout.par, currentHoleLayout.lengthYards, score); // REMOVED

    const distToFlag = calculateDistanceToFlag(currentBallPosition, currentHoleLayout.flagPosition);
    
    console.log(`Distance to flag before ui?: ${distToFlag.toFixed(2)} meters`);
    // Calculate METERS_TO_YARDS locally
    const METERS_TO_YARDS = 1 / YARDS_TO_METERS;
    ui.updateVisualOverlayInfo('play-hole', {
        holeNum: 1, // Assuming hole 1 for now
        par: currentHoleLayout.par,
        distToFlag: distToFlag/* * METERS_TO_YARDS*/, // Use calculated value
        shotNum: isHoledOut ? shotsTaken : shotsTaken + 1, // Show total shots if holed, else next shot#
        // score: currentHoleLayout.par, // Pass par for "for score" calculation - score arg is hole score vs par
        lie: 'Fairway', // placeholder - assume fairway after shot
        wind: 'Calm', // placeholder
        playerName: 'Player 1', // placeholder
        totalScore: isHoledOut ? (score - currentHoleLayout.par) : 'N/A', // Only show when holed out
        position: '1st' // placeholder
    });
}

// Helper function to calculate distance to flag
function calculateDistanceToFlag(ballPos, flagPos) {
    if (!ballPos || !flagPos) return 0;
    // Calculate horizontal distance (x, z plane)
    const dx = flagPos.x - ballPos.x;
    const dz = flagPos.z - ballPos.z;
    return Math.sqrt(dx * dx + dz * dz);
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
