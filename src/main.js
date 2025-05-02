import * as ui from './ui.js';
import * as logic from './gameLogic.js'; // Game state and actions
import * as visuals from './visuals.js';
import * as inputHandler from './inputHandler.js'; // Import the new input handler
import * as closestToFlag from './modes/closestToFlag.js'; // Import the new mode logic

// --- Game Modes ---
const GAME_MODES = {
    RANGE: 'range',
    CLOSEST_TO_FLAG: 'closest-to-flag',
    PLAY_HOLE: 'play-hole',
};
let currentMode = GAME_MODES.RANGE; // Default mode

// Function to change the game mode
function setGameMode(newMode) {
    if (!Object.values(GAME_MODES).includes(newMode)) {
        console.error(`Attempted to switch to invalid game mode: ${newMode}`);
        return;
    }

    console.log(`Switching game mode from ${currentMode} to: ${newMode}`);

    // Terminate previous mode if necessary
    if (currentMode === GAME_MODES.CLOSEST_TO_FLAG) {
        closestToFlag.terminateMode();
    }
    // Add termination for other modes here later

    // Set new mode
    currentMode = newMode;
    ui.setGameModeClass(currentMode); // Update UI (body class, etc.)

    // Initialize new mode and switch visuals
    if (currentMode === GAME_MODES.RANGE) {
        visuals.switchToRangeView();
    } else if (currentMode === GAME_MODES.CLOSEST_TO_FLAG) {
        closestToFlag.initializeMode();
        visuals.switchToTargetView(closestToFlag.getTargetDistance()); // Pass target distance
    } else if (currentMode === GAME_MODES.PLAY_HOLE) {
        // TODO: Initialize Play Hole mode
        // visuals.switchToHoleView(holeData);
        console.warn("Play Hole mode initialization not implemented yet.");
    }

    // Reset basic swing state for the new mode
    logic.resetSwing();

    // Ensure visuals are reset/redrawn for the new mode
    // visuals.resetVisuals(); // Might be redundant if mode init handles it
}

// --- Initial Setup ---

// Get initial values from UI (slider) and set them in logic
// Populate the club select dropdown first
ui.populateClubSelect();

// Get initial values from UI (slider and now-populated select) and set them in logic
const initialSwingSpeed = parseInt(document.getElementById('swing-speed-slider').value, 10);
logic.setSwingSpeed(initialSwingSpeed);

const initialClubKey = document.getElementById('club-select').value; // Read value *after* populating
logic.setSelectedClub(initialClubKey);
const initialShotType = ui.getShotType(); // Get initial shot type from UI
logic.setShotType(initialShotType); // Set initial shot type in logic

// Set other initial UI display values based on logic state
ui.setInitialSwingSpeedDisplay(initialSwingSpeed);
ui.setupBackswingBar(); // Setup backswing marker
ui.setupTimingBarWindows(initialSwingSpeed / 100); // Setup downswing windows based on initial speed

// Initialize game logic (which also calls ui.resetUI)
logic.initializeGameLogic();
// Register the shot completion handler
logic.registerShotCompletionCallback(handleShotCompletion);

// Set initial UI state for the default mode
ui.setGameModeClass(currentMode);
// DO NOT initialize the view here; it's handled within visuals.initVisuals now.

// Initialize visuals (canvas context etc.)
const canvas = document.getElementById('golf-canvas');
let visualsInitialized = false; // Flag to track success
if (canvas) {
    visualsInitialized = visuals.initVisuals(canvas); // Store the return value
    if (visualsInitialized) {
        // Initial view (Range) is now set within initVisuals on success
        visuals.showBallAtAddress(); // Show initial ball position
    } else {
         console.error("Visuals failed to initialize. Further visual operations skipped.");
         // Optionally display an error message to the user on the page
    }
} else {
    console.error("Golf canvas element not found!");
}

// --- Connect UI Event Listeners to Logic ---

ui.addSwingSpeedInputListener((percentage) => {
    logic.setSwingSpeed(percentage);
});

ui.addClubChangeListener((clubKey) => {
    logic.setSelectedClub(clubKey);
});

ui.addShotTypeChangeListener((shotType) => {
    logic.setShotType(shotType);
});

ui.addNextShotClickListener(() => {
    logic.resetSwing(); // Logic reset now calls visuals.resetVisuals()
});

// --- Connect Mode Selection Buttons ---
document.getElementById('mode-btn-range')?.addEventListener('click', () => setGameMode(GAME_MODES.RANGE));
document.getElementById('mode-btn-closest')?.addEventListener('click', () => setGameMode(GAME_MODES.CLOSEST_TO_FLAG));
document.getElementById('mode-btn-hole')?.addEventListener('click', () => setGameMode(GAME_MODES.PLAY_HOLE));


// Add global key listeners that call the input handler
document.addEventListener('keydown', (event) => {
    // console.log(`main.js keydown: ${event.key} (code: ${event.code})`); // Log listener firing (optional)
    inputHandler.handleKeyDown(event); // Call the input handler
});

document.addEventListener('keyup', (event) => {
    // console.log(`main.js keyup: ${event.key} (code: ${event.code})`); // Log listener firing (optional)
    inputHandler.handleKeyUp(event); // Call the input handler
});

console.log("Main script loaded, event listeners attached.");


// --- Shot Completion Handler ---
function handleShotCompletion(shotData) {
    console.log("main.js: Handling shot completion:", shotData);

    // 1. Update Standard UI Result Display
    // Pass all relevant properties from shotData to the UI function
    ui.updateResultDisplay({
        message: shotData.message,
        clubHeadSpeed: shotData.clubHeadSpeed, // Renamed from chs for consistency
        ballSpeed: shotData.ballSpeed,
        launchAngle: shotData.launchAngle,
        attackAngle: shotData.attackAngle,
        attackAngle: shotData.attackAngle,
        clubPathAngle: shotData.clubPathAngle, // Added
        absoluteFaceAngle: shotData.absoluteFaceAngle, // Added
        faceAngleRelPath: shotData.faceAngleRelPath, // Added
        backSpin: shotData.backSpin,
        sideSpin: shotData.sideSpin,
        peakHeight: shotData.peakHeight,
        carryDistance: shotData.carryDistance,
        rolloutDistance: shotData.rolloutDistance,
        totalDistance: shotData.totalDistance,
        // Pass other potentially useful data if needed by UI later
        strikeQuality: shotData.strikeQuality
    });
    // Update debug timing (assuming getDebugTimingData exists and is accessible or passed)
    // ui.updateDebugTimingInfo(logic.getDebugTimingData()); // Need to expose getDebugTimingData or pass data

    // 2. Trigger Visual Animation (using the version with landing callback)
    visuals.animateBallFlightWithLanding(shotData);

    // 3. Update Game Mode Logic (if applicable)
    if (currentMode === GAME_MODES.CLOSEST_TO_FLAG) {
        closestToFlag.handleShotResult(shotData);
    } else if (currentMode === GAME_MODES.PLAY_HOLE) {
        // playHole.handleShotResult(shotData); // TODO
    }
    // Range mode doesn't need specific handling here

    // 4. Update overall game status (e.g., ready for next shot)
    // Note: gameLogic sets its internal state to 'result' before calling back
    ui.updateStatus('Result - Press (n) for next shot');
}


// --- Connect Logic Calculation to Visuals (Example) --- - This section might be obsolete now
// We need a way for gameLogic to trigger the visual animation.
// This could be done via a callback or an event system.
// For now, let's imagine gameLogic could directly call visuals:

// Example (needs modification in gameLogic.js):
// Inside calculateShot() in gameLogic.js, after calculating results:
/*
const shotDataForVisuals = {
    carryDistance: carryDistance,
    peakHeight: peakHeight,
    sideSpin: sideSpin, // To calculate curve
    // Potentially add timeOfFlight, launchAngle etc. if needed by animation
};
visuals.animateBallFlight(shotDataForVisuals);
*/
