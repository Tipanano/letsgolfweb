// src/modes/playHole.js
import * as ui from '../ui.js';
import * as holeGenerator from '../holeGenerator.js';
import { loadPlayHoleState, savePlayHoleState, clearPlayHoleState } from '../gameLogic/persistentGameState.js'; // Added
import * as visuals from '../visuals.js'; // To trigger drawing
import { YARDS_TO_METERS, BALL_RADIUS } from '../visuals/core.js'; // For calculations

// --- State ---
let currentHoleLayout = null;
let shotsTaken = 0; // Strokes for the current hole
let score = 0; // Total strokes for the round
let currentBallPosition = null;
let currentLie = 'tee'; // Default lie
let isHoledOut = false;
let currentModeActive = false;
let currentHoleIndex = 0; // For now, always 0, representing the first/current hole

const HOLE_RADIUS_METERS = 0.108 / 2; // Regulation hole diameter is 4.25 inches (0.108m)

// --- Functions ---

export function initializeMode() {
    console.log("Initializing Play Hole mode...");
    currentModeActive = true;
    isHoledOut = false;

    const loadedState = loadPlayHoleState();

    if (loadedState && loadedState.ballPosition) {
        console.log("Loading saved PlayHole state:", loadedState);
        currentHoleIndex = loadedState.currentHoleIndex || 0;
        shotsTaken = loadedState.strokesThisHole || 0;
        score = loadedState.totalStrokesRound || 0;
        currentBallPosition = loadedState.ballPosition;
        currentLie = loadedState.currentLie || 'unknown';
        // Note: currentHoleLayout will be regenerated. If hole generation is not deterministic
        // based on currentHoleIndex, the loaded ball position might be on a different layout.
        // This is a known limitation for now.
        currentHoleLayout = holeGenerator.generateBasicHole(); // Or generateSpecificHole(currentHoleIndex)
        console.log("Generated Layout (after loading state):", currentHoleLayout);

    } else {
        console.log("No saved state found or state invalid, starting fresh.");
        currentHoleIndex = 0;
        shotsTaken = 0;
        score = 0;
        currentLie = 'tee';

        // 1. Generate the hole layout
        currentHoleLayout = holeGenerator.generateBasicHole();
        console.log("Generated Layout (fresh start):", currentHoleLayout);

        // 2. Set initial ball position to the center of the generated tee box
        let initialX = 0;
        let initialZ = 0;
        if (currentHoleLayout?.tee?.center) {
            initialX = currentHoleLayout.tee.center.x * YARDS_TO_METERS;
            initialZ = currentHoleLayout.tee.center.z * YARDS_TO_METERS;
        }
        currentBallPosition = { x: initialX, y: BALL_RADIUS, z: initialZ };

        // Save this initial fresh state
        savePlayHoleState({
            currentHoleIndex: currentHoleIndex,
            ballPosition: currentBallPosition,
            strokesThisHole: shotsTaken,
            totalStrokesRound: score,
            currentLie: currentLie
        });
    }

    // 3. Tell visuals system to draw the hole geometry
    visuals.drawHole(currentHoleLayout);

    // 4. Reset visuals and place the ball at the correct starting/loaded position, using the currentLie
    visuals.resetVisuals(currentBallPosition, currentLie);

    // 5. Update visual overlay
    const initialDistToFlag = calculateDistanceToFlag(currentBallPosition, currentHoleLayout.flagPosition);
    ui.updateVisualOverlayInfo('play-hole', {
        holeNum: currentHoleIndex + 1,
        par: currentHoleLayout.par,
        distToFlag: initialDistToFlag,
        shotNum: shotsTaken + 1,
        lie: currentLie,
        wind: 'Calm', // placeholder
        playerName: 'Player 1', // placeholder
        totalScore: score, // Display total strokes for the round
        position: '1st' // placeholder
    });

    // 6. Set initial camera view
    visuals.activateHoleViewCamera();

    console.log("Play Hole mode initialized. Ball at:", currentBallPosition, "Lie:", currentLie, "Shots:", shotsTaken, "Score:", score);
}

export function terminateMode() {
    console.log("Terminating Play Hole mode.");
    // Consider saving state here if abrupt termination is possible
    // savePlayHoleState({ currentHoleIndex, ballPosition: currentBallPosition, strokesThisHole: shotsTaken, totalStrokesRound: score, currentLie });
    currentModeActive = false;
    currentHoleLayout = null;
}

export function handleShotResult(shotData) {
    if (!currentModeActive || isHoledOut) return;

    shotsTaken++;
    score++; // Increment total round score for each shot taken
    console.log(`PlayHole: Handling shot ${shotsTaken} (Total round: ${score}) result:`, shotData);

    if (shotData.finalPosition) {
        currentBallPosition = { ...shotData.finalPosition }; // Ensure clean copy
        if (currentBallPosition.y < BALL_RADIUS) {
            currentBallPosition.y = BALL_RADIUS;
        }
        console.log(`New ball position (meters): x=${currentBallPosition.x.toFixed(2)}, y=${currentBallPosition.y.toFixed(2)}, z=${currentBallPosition.z.toFixed(2)}`);
    } else {
        console.error("PlayHole Error: Shot data did not contain finalPosition!");
        return;
    }

    currentLie = shotData.surfaceName || 'unknown'; // Update lie based on shot result
    isHoledOut = shotData.isHoledOut || false;

    if (isHoledOut) {
        console.log(`HOLE OUT! Strokes this hole: ${shotsTaken}. Total round score: ${score}`);
        // UI will reflect this. Consider if further action needed (e.g., advance to next hole).
    } else {
        console.log("Ball is not holed out. Ready for next shot.");
    }

    // Save the updated state
    savePlayHoleState({
        currentHoleIndex: currentHoleIndex,
        ballPosition: currentBallPosition,
        strokesThisHole: shotsTaken,
        totalStrokesRound: score,
        currentLie: currentLie
    });

    const distToFlag = calculateDistanceToFlag(currentBallPosition, currentHoleLayout.flagPosition);
    ui.updateVisualOverlayInfo('play-hole', {
        holeNum: currentHoleIndex + 1,
        par: currentHoleLayout.par,
        distToFlag: distToFlag,
        shotNum: isHoledOut ? shotsTaken : shotsTaken + 1,
        lie: currentLie,
        wind: 'Calm', // placeholder
        playerName: 'Player 1', // placeholder
        totalScore: score, // Display total strokes for the round
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
