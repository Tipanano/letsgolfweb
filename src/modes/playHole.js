// src/modes/playHole.js
import * as ui from '../ui.js';
import * as holeGenerator from '../holeGenerator.js';
import { loadPlayHoleState, savePlayHoleState, clearPlayHoleState } from '../gameLogic/persistentGameState.js';
import * as visuals from '../visuals.js'; // To trigger drawing
import { setShotType, getCurrentShotType } from '../gameLogic/state.js'; // Import setShotType and getCurrentShotType
import { BALL_RADIUS } from '../visuals/core.js'; // For calculations
import { YARDS_TO_METERS } from '../utils/unitConversions.js'; // Import conversion constant

// --- State ---
let currentHoleLayout = null;
let shotsTaken = 0; // Strokes for the current hole
let score = 0; // Total strokes for the round
let currentBallPosition = null;
let currentLie = 'tee'; // Default lie
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
            const { loadHoleLayout } = await import('../holeLoader.js');
            const { SURFACES } = await import('../surfaces.js');

            const previewLayout = JSON.parse(previewData);

            // Process the layout (same logic as holeLoader but inline since we have the JSON already)
            currentHoleLayout = JSON.parse(JSON.stringify(previewLayout)); // Deep copy

            // Map surfaces and process shapes (simplified from holeLoader.js)
            if (currentHoleLayout.background) {
                currentHoleLayout.background.surface = SURFACES[currentHoleLayout.background.surface];
                currentHoleLayout.background.type = 'polygon';
            }

            if (currentHoleLayout.tee?.center) {
                const c = currentHoleLayout.tee.center;
                const hw = currentHoleLayout.tee.width / 2;
                const hd = currentHoleLayout.tee.depth / 2;
                currentHoleLayout.tee.vertices = [
                    { x: c.x - hw, z: c.z - hd }, { x: c.x + hw, z: c.z - hd },
                    { x: c.x + hw, z: c.z + hd }, { x: c.x - hw, z: c.z + hd }
                ];
                currentHoleLayout.tee.surface = SURFACES[currentHoleLayout.tee.surface];
                currentHoleLayout.tee.type = 'polygon';
            }

            // Process fairways (support multiple)
            if (currentHoleLayout.fairways && Array.isArray(currentHoleLayout.fairways)) {
                currentHoleLayout.fairways.forEach(fairway => {
                    if (fairway.controlPoints) {
                        fairway.vertices = fairway.controlPoints;
                        delete fairway.controlPoints;
                    }
                    fairway.surface = SURFACES[fairway.surface];
                    fairway.type = 'polygon';
                });
            } else if (currentHoleLayout.fairway?.controlPoints) {
                // Legacy single fairway - convert to array
                currentHoleLayout.fairway.vertices = currentHoleLayout.fairway.controlPoints;
                delete currentHoleLayout.fairway.controlPoints;
                currentHoleLayout.fairway.surface = SURFACES[currentHoleLayout.fairway.surface];
                currentHoleLayout.fairway.type = 'polygon';
                currentHoleLayout.fairways = [currentHoleLayout.fairway];
                delete currentHoleLayout.fairway;
            }

            if (currentHoleLayout.green?.controlPoints) {
                currentHoleLayout.green.vertices = currentHoleLayout.green.controlPoints;
                delete currentHoleLayout.green.controlPoints;
                currentHoleLayout.green.surface = SURFACES[currentHoleLayout.green.surface];
                currentHoleLayout.green.type = 'polygon';
            }

            ['lightRough', 'mediumRough', 'thickRough'].forEach(roughType => {
                if (currentHoleLayout[roughType]) {
                    currentHoleLayout[roughType].forEach(rough => {
                        rough.surface = SURFACES[rough.surface];
                        rough.type = 'polygon';
                    });
                }
            });

            if (currentHoleLayout.bunkers) {
                currentHoleLayout.bunkers.forEach(bunker => {
                    if (bunker.controlPoints) {
                        bunker.vertices = bunker.controlPoints;
                        delete bunker.controlPoints;
                    }
                    bunker.surface = SURFACES[bunker.surface];
                    bunker.type = 'polygon';
                });
            }

            if (currentHoleLayout.waterHazards) {
                currentHoleLayout.waterHazards.forEach(water => {
                    if (water.controlPoints) {
                        water.vertices = water.controlPoints;
                        delete water.controlPoints;
                    }
                    water.surface = SURFACES[water.surface];
                    water.type = 'polygon';
                });
            }

            if (currentHoleLayout.flagPositions?.length > 0) {
                currentHoleLayout.flagPosition = {
                    x: currentHoleLayout.flagPositions[0].x,
                    z: currentHoleLayout.flagPositions[0].z
                };
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
            currentLie = 'tee';
            currentHoleIndex = 0;

            localStorage.removeItem('previewHoleData');

            // Use the exact same flow as normal hole loading (lines 292-334)
            visuals.drawHole(currentHoleLayout);
            visuals.resetVisuals(currentBallPosition, currentLie);

            if (currentLie === 'green') {
                setShotType('putt');
            } else if (currentLie !== 'tee') {
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
                playerName: 'Player 1',
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
        }
    }

    const loadedState = loadPlayHoleState();
    const holeToLoad = holeName || "mickelson_01"; // Use provided holeName or default

    // When switching holes, we always want a fresh start for that hole, so we ignore loadedState's ballPos, strokes etc.
    // We only care about totalStrokesRound if we were to implement a multi-hole round persistence.
    // For now, switching hole means starting that hole fresh.
    // If a holeName is provided, it implies a deliberate switch, so we don't use saved ballPosition or strokesThisHole.
    // We might still want to preserve totalStrokesRound if this were part of a continuous round.
    // However, the request is to "resetGameData" which implies clearing everything for the new hole.

    if (holeName && loadedState) {
        // If switching to a new hole, we want to clear the specific per-hole progress,
        // but potentially keep round-total score if that was a feature.
        // For this task, clearPlayHoleState() will be called *before* this,
        // so loadedState should be null here if switching.
        // If loadedState is NOT null, it means we are loading the game, not actively switching.
        console.log("Loading saved PlayHole state (potentially for a specific hole):", loadedState);
        // If holeName is provided AND matches the saved hole, then we might load positions.
        // But the current plan is to call clearPlayHoleState() before this, so this block might be less relevant for switching.
        // This logic is more for initial game load.
        if (loadedState.holeLayoutData && loadedState.holeLayoutData.name && loadedState.holeLayoutData.name.startsWith(holeToLoad.split('_')[0])) {
             currentHoleLayout = loadedState.holeLayoutData;
             currentBallPosition = loadedState.ballPosition;
             shotsTaken = loadedState.strokesThisHole || 0;
             score = loadedState.totalStrokesRound || 0; // Keep total score if loading
             currentLie = loadedState.currentLie || 'unknown';
             currentHoleIndex = loadedState.currentHoleIndex; // Keep track of which hole index this was
             console.log("Using saved layout and position for the hole.");
        } else {
            // Saved state is for a different hole or no layout data, start this hole fresh
            console.warn(`Saved state is for a different hole or missing layout. Starting ${holeToLoad} fresh.`);
            currentHoleLayout = await holeGenerator.generateHoleLayout(holeToLoad);
            if (!currentHoleLayout) {
                console.error(`Failed to generate layout for ${holeToLoad}. Cannot initialize mode.`);
                // ui.showError("Failed to load hole data. Please try again."); // ui might not be directly accessible here
                currentModeActive = false;
                return;
            }
            shotsTaken = 0;
            // score = score; // Keep existing total score if this was a mid-round load of a *new* hole
            currentLie = 'tee';
            // Update currentHoleIndex based on holeName if we have a mapping
            // For now, if holeName is given, we assume it's the "current" one for display purposes.
            // This part needs more robust logic if we have a fixed course sequence.
            // For now, we'll just use a placeholder or derive from holeName if possible.
            const parts = holeToLoad.split('_');
            currentHoleIndex = parts.length > 1 && !isNaN(parseInt(parts[1])) ? parseInt(parts[1]) -1 : 0;


            let initialX = 0;
            let initialZ = 0;
            if (currentHoleLayout?.tee?.center) {
                // Hole layouts are now in meters, no conversion needed
                initialX = currentHoleLayout.tee.center.x;
                initialZ = currentHoleLayout.tee.center.z;
            }
            currentBallPosition = { x: initialX, y: BALL_RADIUS, z: initialZ };
            savePlayHoleState({
                currentHoleIndex: currentHoleIndex,
                ballPosition: currentBallPosition,
                strokesThisHole: shotsTaken,
                totalStrokesRound: score, // Persist total score
                currentLie: currentLie,
                holeLayoutData: currentHoleLayout
            });
        }
    } else if (loadedState && !holeName && loadedState.ballPosition && loadedState.currentHoleIndex !== undefined) { // Normal load, no specific hole switch
        console.log("Loading saved PlayHole state (normal load):", loadedState);
        currentHoleIndex = loadedState.currentHoleIndex;
        shotsTaken = loadedState.strokesThisHole || 0;
        score = loadedState.totalStrokesRound || 0;
        currentBallPosition = loadedState.ballPosition;
        currentLie = loadedState.currentLie || 'unknown';
        // Determine which hole to load from saved state if not switching
        const holeToLoadFromSave = loadedState.holeLayoutData?.name || "mickelson_01"; // Fallback if name is missing

        if (loadedState.holeLayoutData && loadedState.holeLayoutData.name) {
            console.log("Using saved holeLayoutData for:", loadedState.holeLayoutData.name);
            currentHoleLayout = loadedState.holeLayoutData;
        } else {
            console.warn(`No holeLayoutData in saved state. Regenerating for ${holeToLoadFromSave} and attempting to update save.`);
            currentHoleLayout = await holeGenerator.generateHoleLayout(holeToLoadFromSave);
            if (!currentHoleLayout) {
                console.error(`Failed to generate layout for ${holeToLoadFromSave}. Cannot initialize mode.`);
                // ui.showError("Failed to load hole data. Please try again.");
                currentModeActive = false;
                return;
            }
            savePlayHoleState({ ...loadedState, holeLayoutData: currentHoleLayout });
        }
        console.log("Layout (after normal loading state):", currentHoleLayout);

    } else { // Starting a hole fresh (either first time, or after clearPlayHoleState due to switch)
        console.log(`Starting hole ${holeToLoad} fresh.`);
        // currentHoleIndex should be determined based on holeToLoad if we have a mapping
        // For now, if holeToLoad is "mickelson_01.json", index is 0. "norman_02.json" is 1, etc.
        const parts = holeToLoad.replace(".json", "").split('_');
        currentHoleIndex = parts.length > 1 && !isNaN(parseInt(parts[1])) ? parseInt(parts[1]) -1 : 0;

        shotsTaken = 0;
        // score = score; // Preserve total round score if switching mid-round.
                       // If clearPlayHoleState also clears total score, then this should be 0.
                       // For now, assume clearPlayHoleState only clears the specific hole's progress.
                       // The request implies resetting game data for the *new* hole, not necessarily the entire round score.
                       // Let's assume `score` (totalStrokesRound) is reset by clearPlayHoleState or should be reset here.
                       // For simplicity of this change, if holeName is passed (meaning a switch), reset total score too.
        if (holeName) {
            score = 0; // Reset total score if explicitly switching holes via UI
        } else if (loadedState) {
            score = loadedState.totalStrokesRound || 0; // Keep from save if not explicit switch
        } else {
            score = 0; // Absolute fresh start
        }


        currentLie = 'tee';

        currentHoleLayout = await holeGenerator.generateHoleLayout(holeToLoad);
        if (!currentHoleLayout) {
            console.error(`Failed to generate layout for ${holeToLoad}. Cannot initialize mode.`);
            // ui.showError("Failed to load hole data. Please try again.");
            currentModeActive = false;
            return;
        }
        console.log("Generated Layout (fresh start for hole):", currentHoleLayout);

        let initialX = 0;
        let initialZ = 0;
        if (currentHoleLayout?.tee?.center) {
            // Hole layouts are now in meters, no conversion needed
            initialX = currentHoleLayout.tee.center.x;
            initialZ = currentHoleLayout.tee.center.z;
        }
        currentBallPosition = { x: initialX, y: BALL_RADIUS, z: initialZ };

        savePlayHoleState({
            currentHoleIndex: currentHoleIndex,
            ballPosition: currentBallPosition,
            strokesThisHole: shotsTaken,
            totalStrokesRound: score,
            currentLie: currentLie,
            holeLayoutData: currentHoleLayout
        });
    }

    if (!currentHoleLayout) {
        console.error("Critical error: currentHoleLayout is null after setup. Aborting initialization.");
        currentModeActive = false;
        return;
    }

    visuals.drawHole(currentHoleLayout);
    visuals.resetVisuals(currentBallPosition, currentLie);

    if (currentLie === 'green') {
        setShotType('putt');
        console.log("PlayHole: On green, setting shot type to putt.");
    } else if (currentLie !== 'tee') {
        const currentStateType = getCurrentShotType();
        if (currentStateType === 'putt') {
            setShotType('full');
            console.log("PlayHole: On non-green/non-tee surface, ensuring shot type is not putt.");
        }
    }

    const initialDistToFlag = calculateDistanceToFlag(currentBallPosition, currentHoleLayout.flagPosition);
    // Attempt to get a display hole number. e.g. "mickelson_01" -> 1
    let displayHoleNum = currentHoleIndex + 1;
    if (currentHoleLayout.name) {
        const nameParts = currentHoleLayout.name.replace(".json", "").split('_');
        if (nameParts.length > 1 && !isNaN(parseInt(nameParts[nameParts.length -1 ]))) {
            displayHoleNum = parseInt(nameParts[nameParts.length-1]);
        }
    }

    ui.updateVisualOverlayInfo('play-hole', {
        holeNum: displayHoleNum,
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
        if (currentBallPosition.y < BALL_RADIUS) {
            currentBallPosition.y = BALL_RADIUS;
        }
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
        playerName: 'Player 1', // placeholder
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
            playerName: 'Player 1',
            totalScore: score,
            position: '1st'
        });
    }, animationDuration + 200); // Add 200ms buffer
}


export function prepareForTeeShotAfterHoleOut() {
    if (!currentModeActive) return;

    console.log("PlayHole: Preparing for tee shot after hole out.");
    shotsTaken = 0;
    currentLie = 'tee';
    let initialX = 0;
    let initialZ = 0;
    if (currentHoleLayout?.tee?.center) {
        initialX = currentHoleLayout.tee.center.x * YARDS_TO_METERS;
        initialZ = currentHoleLayout.tee.center.z * YARDS_TO_METERS;
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
            x: currentHoleLayout.tee.center.x * YARDS_TO_METERS,
            y: BALL_RADIUS,
            z: currentHoleLayout.tee.center.z * YARDS_TO_METERS
        };
    }
    // Otherwise, return the actual current ball position
    return { ...currentBallPosition };
}

export function getCurrentLie() {
    if (holeJustCompleted) {
        return 'tee';
    }
    return currentLie;
}

export function getDisplayShotNumber() {
    if (holeJustCompleted) {
        return 1; // Next shot will be the 1st from the tee
    }
    return shotsTaken + 1;
}
