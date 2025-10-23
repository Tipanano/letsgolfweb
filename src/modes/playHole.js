// src/modes/playHole.js
import * as ui from '../ui.js';
import { savePlayHoleState } from '../gameLogic/persistentGameState.js';
import * as visuals from '../visuals.js'; // To trigger drawing
import { setShotType, getCurrentShotType, setSelectedClub } from '../gameLogic/state.js'; // Import setShotType, getCurrentShotType, and setSelectedClub
import { BALL_RADIUS } from '../visuals/core.js'; // For calculations
import { playerManager } from '../playerManager.js'; // Import playerManager

// --- State ---
let currentHoleLayout = null;
let shotsTaken = 0; // Strokes for the current hole
let score = 0; // Total strokes for the round
let currentBallPosition = null;
let currentLie = 'TEE'; // Default lie
let holeJustCompleted = false; // Renamed from isHoledOut: true if hole was just finished, awaiting 'n'
let currentModeActive = false;
let currentHoleIndex = 0; // For now, always 0, representing the first/current hole

const HOLE_RADIUS_METERS = 0.108 / 2; // Regulation hole diameter is 4.25 inches (0.108m)

// --- Functions ---

export async function initializeMode(holeName) { // Made async, added holeName parameter
    console.log(`Initializing Play Hole mode for hole: ${holeName || 'default'}...`);
    currentModeActive = true;
    holeJustCompleted = false; // Ensure this is reset when a hole is initialized

    // Check for preview mode (hole maker preview)
    const previewData = localStorage.getItem('previewHoleData');
    if (previewData && !holeName) {
        console.log('Preview mode detected, loading custom hole from hole maker...');
        try {
            // Import holeLoader to process the preview data
            const { processHoleLayout } = await import('../holeLoader.js');

            const previewLayout = JSON.parse(previewData);

            // Process the layout using holeLoader
            currentHoleLayout = processHoleLayout(previewLayout);

            if (!currentHoleLayout) {
                throw new Error('Failed to process hole layout');
            }

            // Set initial position
            // Preview holes from hole maker are already in meters, no conversion needed
            let initialX = 0, initialZ = 0;
            if (currentHoleLayout.tee?.center) {
                initialX = currentHoleLayout.tee.center.x;
                initialZ = currentHoleLayout.tee.center.z;
            }
            currentBallPosition = { x: initialX, y: BALL_RADIUS, z: initialZ };
            shotsTaken = 0;
            score = 0;
            currentLie = 'TEE';
            currentHoleIndex = 0;

            localStorage.removeItem('previewHoleData');

            // Set club based on par: Driver for par 4/5, 7-iron for par 3
            const par = currentHoleLayout.par || 4;
            const clubToSelect = (par >= 4) ? 'DR' : 'I7';
            setSelectedClub(clubToSelect);
            ui.setSelectedClubButton(clubToSelect);
            console.log(`Par ${par} hole detected, setting club to ${clubToSelect}`);

            // Use the exact same flow as normal hole loading (lines 292-334)
            visuals.drawHole(currentHoleLayout);
            visuals.resetVisuals(currentBallPosition, currentLie);

            if (currentLie === 'green') {
                setShotType('putt');
            } else if (currentLie .toUpperCase() !== 'TEE') {
                const currentStateType = getCurrentShotType();
                if (currentStateType === 'putt') {
                    setShotType('full');
                }
            }

            const initialDistToFlag = calculateDistanceToFlag(currentBallPosition, currentHoleLayout.flagPosition);

            // Update UI overlay with hole info
            ui.updateVisualOverlayInfo('play-hole', {
                holeNum: 1,
                par: currentHoleLayout.par || 4,
                distToFlag: initialDistToFlag,
                shotNum: shotsTaken + 1,
                lie: currentLie,
                wind: 'Calm',
                playerName: playerManager.getDisplayName(),
                totalScore: score,
                position: '1st'
            });

            // Activate camera
            visuals.activateHoleViewCamera();

            console.log('Preview hole loaded and ready to play!');
            return;
        } catch (error) {
            console.error('Error loading preview hole:', error);
            alert('Failed to load preview hole: ' + error.message);
            localStorage.removeItem('previewHoleData');
            currentModeActive = false;
            return;
        }
    }

    // No preview data found
    console.error('No preview hole data found. Play Hole mode requires preview data from hole maker.');
    alert('No hole data found. Please create or preview a hole from the Hole Maker first.');
    currentModeActive = false;
}

export function terminateMode() {
    console.log("Terminating Play Hole mode.");
    // Consider saving state here if abrupt termination is possible
    // savePlayHoleState({ currentHoleIndex, ballPosition: currentBallPosition, strokesThisHole: shotsTaken, totalStrokesRound: score, currentLie });
    currentModeActive = false;
    currentHoleLayout = null;
}

export function handleShotResult(shotData) {
    if (!currentModeActive || holeJustCompleted) { // Don't process if hole was just finished and awaiting 'n'
        // If holeJustCompleted is true, it means we already processed the hole-out,
        // and are waiting for the player to press 'n' to start the next shot from the tee.
        // The actual reset to tee happens in prepareForTeeShotAfterHoleOut, called by resetSwing.
        console.log("PlayHole: Shot result received, but hole was just completed. Awaiting 'n'.");
        return;
    }

    shotsTaken++;
    score++; // Increment total round score for each shot taken
    console.log(`PlayHole: Handling shot ${shotsTaken} (Total round: ${score}) result:`, shotData);

    if (shotData.finalPosition) {
        currentBallPosition = { ...shotData.finalPosition }; // Ensure clean copy
        // Don't clamp Y position - simulation already accounts for ballLieOffset
        console.log(`New ball position (meters): x=${currentBallPosition.x.toFixed(2)}, y=${currentBallPosition.y.toFixed(2)}, z=${currentBallPosition.z.toFixed(2)}`);
    } else {
        console.error("PlayHole Error: Shot data did not contain finalPosition!");
        return;
    }

    // Don't update lie immediately - wait for animation to complete to avoid spoilers!
    const finalLie = shotData.surfaceName || 'unknown';

    if (shotData.isHoledOut) {
        holeJustCompleted = true; // Set flag that hole is done, awaiting 'n'
        console.log(`HOLE OUT! Strokes this hole: ${shotsTaken}. Total round score: ${score}`);
        ui.updateStatus(`Hole ${currentHoleIndex + 1} complete! Score: ${shotsTaken}. Press (n) to play again.`);
        // Ball position remains at the hole for now. It will be reset to tee in prepareForTeeShotAfterHoleOut.
        // shotsTaken for this completed hole is now fixed.
    } else {
        console.log("Ball is not holed out. Ready for next shot.");
    }

    // Save the updated state (ball at its current location, or at hole if just holed out)
    savePlayHoleState({
        currentHoleIndex: currentHoleIndex,
        ballPosition: currentBallPosition, // This is where the ball physically is
        strokesThisHole: shotsTaken, // Strokes for the current attempt (or completed hole)
        totalStrokesRound: score,
        currentLie: currentLie,
        holeLayoutData: currentHoleLayout,
        holeJustCompletedState: holeJustCompleted // Save this new flag
    });

    // Hide distance/lie during animation to avoid spoilers
    ui.updateVisualOverlayInfo('play-hole', {
        holeNum: currentHoleIndex + 1,
        par: currentHoleLayout.par,
        distToFlag: '...', // Hide during animation
        shotNum: shotsTaken,
        lie: '...', // Hide during animation
        wind: 'Calm', // placeholder
        playerName: playerManager.getDisplayName(),
        totalScore: score,
        position: '1st' // placeholder
    });

    // Update lie and UI after animation completes
    // Note: Animation callbacks are handled in visuals.js
    // We'll use a timeout based on animation duration as a fallback
    const animationDuration = (shotData.timeOfFlight || 3) * 1000; // Convert seconds to ms
    setTimeout(() => {
        currentLie = finalLie; // Update lie after animation

        const displayBallPos = getCurrentBallPosition();
        const displayLie = getCurrentLie();
        const displayShotNum = getDisplayShotNumber();
        const distToFlag = calculateDistanceToFlag(displayBallPos, currentHoleLayout.flagPosition);

        ui.updateVisualOverlayInfo('play-hole', {
            holeNum: currentHoleIndex + 1,
            par: currentHoleLayout.par,
            distToFlag: distToFlag,
            shotNum: displayShotNum,
            lie: displayLie,
            wind: 'Calm',
            playerName: playerManager.getDisplayName(),
            totalScore: score,
            position: '1st'
        });
    }, animationDuration + 200); // Add 200ms buffer
}


export function prepareForTeeShotAfterHoleOut() {
    if (!currentModeActive) return;

    console.log("PlayHole: Preparing for tee shot after hole out.");
    shotsTaken = 0;
    currentLie = 'TEE';
    let initialX = 0;
    let initialZ = 0;
    if (currentHoleLayout?.tee?.center) {
        initialX = currentHoleLayout.tee.center.x;
        initialZ = currentHoleLayout.tee.center.z;
    }
    currentBallPosition = { x: initialX, y: BALL_RADIUS, z: initialZ };
    holeJustCompleted = false; // Reset the flag, we are now starting the new attempt

    savePlayHoleState({
        currentHoleIndex: currentHoleIndex,
        ballPosition: currentBallPosition,
        strokesThisHole: shotsTaken,
        totalStrokesRound: score, // Total score persists
        currentLie: currentLie,
        holeLayoutData: currentHoleLayout,
        holeJustCompletedState: holeJustCompleted
    });
    console.log("PlayHole: State reset to tee. Ball at:", currentBallPosition, "Shots:", shotsTaken);
    // Visuals and UI update for this new state will be handled by the resetSwing flow in main.js/ui.js
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

export function getHoleJustCompleted() { // Renamed getter
    return holeJustCompleted;
}

export function getCurrentBallPosition() {
    if (holeJustCompleted && currentHoleLayout?.tee?.center) {
        // If hole was just completed, the "next" shot is from the tee
        return {
            x: currentHoleLayout.tee.center.x,
            y: BALL_RADIUS,
            z: currentHoleLayout.tee.center.z
        };
    }
    // Otherwise, return the actual current ball position
    return { ...currentBallPosition };
}

export function getCurrentLie() {
    if (holeJustCompleted) {
        return 'TEE';
    }
    return currentLie;
}

export function getDisplayShotNumber() {
    if (holeJustCompleted) {
        return 1; // Next shot will be the 1st from the tee
    }
    return shotsTaken + 1;
}
