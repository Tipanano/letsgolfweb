import * as ui from './ui.js';
// Import specific functions, including updateEnvironmentDisplay
// Added setAvailableHoleFiles and setOnHoleSelectedCallback
import { showMainMenu, showGameView, addBackToMenuClickListener, updateEnvironmentDisplay, setAvailableHoleFiles, setOnHoleSelectedCallback } from './ui.js';
import * as logic from './gameLogic.js'; // Game state and actions
import * as visuals from './visuals.js';
import * as inputHandler from './inputHandler.js'; // Import the new input handler
import { clearPlayHoleState } from './gameLogic/persistentGameState.js'; // Import for resetting state
import * as environment from './gameLogic/environment.js'; // Import environment simulation
import * as closestToFlag from './modes/closestToFlag.js'; // Import the CTF mode logic
import * as playHole from './modes/playHole.js'; // Import the Play Hole mode logic
import { getRandomInRange } from './utils/gameUtils.js'; // Import getRandomInRange
import { initMultiplayerUI } from './multiplayerTest.js'; // Import multiplayer test
import { playerManager } from './playerManager.js'; // Import player manager
import * as nanoAuth from './nanoAuth.js'; // Import Nano authentication
import * as multiplayerManager from './multiplayerManager.js'; // Import multiplayer manager

// --- Game Data ---
const AVAILABLE_HOLE_FILES = [ // This would ideally be fetched or dynamically discovered
    "mickelson_01.json",
    "norman_02.json",
    "woods_03.json"
    // Add more hole files here as they are created
];

// --- Game Modes ---
export const GAME_MODES = {
    RANGE: 'range',
    CLOSEST_TO_FLAG: 'closest-to-flag',
    PLAY_HOLE: 'play-hole',
};
let currentMode = GAME_MODES.RANGE; // Default mode


// Function to switch to a new hole in Play Hole mode
async function switchGameToHole(holeFileName) {
    if (currentMode !== GAME_MODES.PLAY_HOLE) {
        console.warn("Cannot switch hole when not in Play Hole mode. Setting mode to Play Hole first.");
        await setGameMode(GAME_MODES.PLAY_HOLE, holeFileName); // Pass holeFileName to setGameMode
    } else {
        console.log("Main: Switching to hole:", holeFileName);
        clearPlayHoleState(); // Clear previous hole's saved state
        // playHole.initializeMode is async, so await it.
        await playHole.initializeMode(holeFileName); // Initialize the new hole
    }
}


// Function to change the game mode
export async function setGameMode(newMode, initialHoleName = null, targetDistance = null) { // Made async, added initialHoleName and targetDistance
    if (!Object.values(GAME_MODES).includes(newMode)) {
        console.error(`Attempted to switch to invalid game mode: ${newMode}`);
        return;
    }

    console.log(`Switching game mode from ${currentMode} to: ${newMode}`);

    // Terminate previous mode if necessary
    if (currentMode === GAME_MODES.CLOSEST_TO_FLAG) {
        closestToFlag.terminateMode();
    } else if (currentMode === GAME_MODES.PLAY_HOLE) {
        playHole.terminateMode();
    }

    // Set new mode
    currentMode = newMode;
    ui.setGameModeClass(currentMode); // Update UI (body class, etc.)

    // Initialize visuals system if it hasn't been already
    if (!visualsSystemInitialized && canvas) {
        visualsSystemInitialized = visuals.initVisuals(canvas);
        if (visualsSystemInitialized) {
            environment.startWindSimulation(); // Start wind updates once visuals are ready
            console.log("Visuals system initialized.");
        } else {
            console.error("Visuals system failed to initialize. Game may not display correctly.");
            // Optionally, inform the user via an on-page message
            return; // Stop further mode setup if visuals failed
        }
    } else if (!canvas) {
        console.error("Canvas element not found, cannot initialize visuals for mode.");
        return; // Stop if canvas is missing
    }


    // Initialize new mode, switch visuals, and reset overlay
    if (currentMode === GAME_MODES.RANGE) {
        visuals.switchToRangeView();
        ui.updateVisualOverlayInfo('range', { lie: 'Tee' /* wind is live */ });
        logic.resetSwing(); // Reset swing state for Range mode
        visuals.showBallAtAddress(); // Ensure ball is shown
    } else if (currentMode === GAME_MODES.CLOSEST_TO_FLAG) {
        const actualTargetDistance = closestToFlag.initializeMode(targetDistance);
        console.log('CTF Mode: Target distance from initializeMode:', actualTargetDistance);
        visuals.switchToTargetView(actualTargetDistance);
        visuals.showBallAtAddress(); // Ensure ball is shown
    } else if (currentMode === GAME_MODES.PLAY_HOLE) {
        // If initialHoleName is provided (e.g. from switchGameToHole calling setGameMode), use it.
        // Otherwise, playHole.initializeMode will use its default or load saved state.
        await playHole.initializeMode(initialHoleName); 
        // visuals.switchToHoleView() is called by playHole.initializeMode via visuals.activateHoleViewCamera()
        // Ball position is handled by playHole.initializeMode.
    }
    
    console.log(`Game mode ${currentMode} initialized and visuals set up.`);
}

// Make switchGameToHole globally accessible for UI or set via callback
// window.switchGameToHole = switchGameToHole; // Option 1: Global
// Option 2: Pass as callback (preferred) - will do this below

// Function to get the current game mode (needed by inputHandler)
export function getCurrentGameMode() {
    return currentMode;
}

// --- Initial Setup ---

// Initialize player manager first (auto-creates guest if needed)
await playerManager.init();
console.log('Player initialized:', playerManager.getDisplayName());

// Update UI with player info
ui.updatePlayerDisplay(playerManager.getDisplayName(), playerManager.currentPlayer.playerType);

// Create the club buttons first
ui.createClubButtons();

// Pass hole files and selection callback to UI
ui.setAvailableHoleFiles(AVAILABLE_HOLE_FILES);
ui.setOnHoleSelectedCallback(switchGameToHole);


// Get initial values from UI (slider and now-updated club buttons) and set them in logic
const initialSwingSpeed = parseInt(document.getElementById('swing-speed-slider').value, 10);
logic.setSwingSpeed(initialSwingSpeed);

// The default club is set by createClubButtons, which also triggers the onClubChangeCallback
// if a callback is registered. We'll register the callback *after* this initial setup
// to avoid double-setting or issues if logic isn't fully ready.
// For now, we can assume a default club is selected in UI and logic will pick it up
// or we can explicitly get it if needed, but createClubButtons should handle the initial selection.

// const initialClubKey = ???; // This will be set by the default button click in createClubButtons
// logic.setSelectedClub(initialClubKey); // This will be handled by the club change listener

const initialShotType = ui.getShotType(); // Get initial shot type from UI
logic.setShotType(initialShotType); // Set initial shot type in logic

// Set other initial UI display values based on logic state
ui.setInitialSwingSpeedDisplay(initialSwingSpeed);
ui.setupBackswingBar(); // Setup backswing marker
ui.setupTimingBarWindows(initialSwingSpeed / 100); // Setup downswing windows based on initial speed

// Initialize game logic (which also calls ui.resetUI and sets initial wind/temp state)
logic.initializeGameLogic();
// Generate random base wind parameters
const initialBaseSpeed = getRandomInRange(0, 10); // Random base speed 0-10 m/s
const initialBaseDirection = getRandomInRange(0, 360); // Random base direction 0-360 degrees
// Set initial wind simulation parameters using the random base values
// Variances and interval remain the same for now, but could also be randomized or configured
environment.setWindParameters(initialBaseSpeed, initialBaseDirection, 3, 20, 2500); 
// Manually update the environment display once after setting parameters to ensure correct initial display
updateEnvironmentDisplay(); 
// Register the shot completion handler
logic.registerShotCompletionCallback(handleShotCompletion);

// Set initial UI state for the default mode (will be overridden by showMainMenu initially)
ui.setGameModeClass(currentMode); 

// Canvas and Visuals Initialization (deferred)
const canvas = document.getElementById('golf-canvas');
let visualsSystemInitialized = false; // Flag to ensure visuals are initialized only once

if (!canvas) {
    console.error("Golf canvas element not found! Game cannot start.");
    // Optionally display a more user-friendly error on the page
}

// --- Connect UI Event Listeners to Logic ---

ui.addSwingSpeedInputListener((percentage) => {
    logic.setSwingSpeed(percentage);
});

ui.addResetGameDataListener(); // Added listener for the new reset button

ui.addClubChangeListener((clubKey) => {
    logic.setSelectedClub(clubKey);

    // Update tee and ball position if on tee box
    if (currentMode === GAME_MODES.CLOSEST_TO_FLAG) {
        visuals.showBallAtAddress(); // Refresh ball/tee for new club
    }
});

ui.addShotTypeChangeListener((shotType) => {
    logic.setShotType(shotType);
});

ui.addNextShotClickListener(() => {
    logic.resetSwing(); // Logic reset now calls visuals.resetVisuals()
});

// --- Connect Mode Selection Buttons ---
document.getElementById('mode-btn-range')?.addEventListener('click', () => {
    ui.showGameView();
    setGameMode(GAME_MODES.RANGE);
});
document.getElementById('mode-btn-closest')?.addEventListener('click', () => {
    ui.showGameView();
    setGameMode(GAME_MODES.CLOSEST_TO_FLAG);
});
document.getElementById('mode-btn-hole')?.addEventListener('click', () => {
    ui.showGameView();
    setGameMode(GAME_MODES.PLAY_HOLE);
});

// --- Connect "Back to Menu" Button ---
function handleBackToMenu() {
    console.log("Returning to Main Menu...");
    // Terminate current mode-specific logic if active
    if (currentMode === GAME_MODES.CLOSEST_TO_FLAG) {
        closestToFlag.terminateMode();
    } else if (currentMode === GAME_MODES.PLAY_HOLE) {
        playHole.terminateMode();
    }
    // Reset core game logic and UI elements (like shot result, timing bars)
    logic.resetSwing(); // This also calls ui.resetUI() and visuals.resetVisuals()
    
    // visuals.resetVisuals(); // Covered by logic.resetSwing() -> ui.resetUI() -> visuals.resetVisuals()
    // ui.resetUI(); // Covered by logic.resetSwing()

    // currentMode = null; // Or set to a default if needed, though ui.showMainMenu handles view
    // The ui.showMainMenu() is called by the event listener in ui.js directly.
}
ui.addBackToMenuClickListener(handleBackToMenu);

// --- Initial View ---
// Show the main menu after all initializations are complete
ui.showMainMenu();

// Initialize multiplayer UI
initMultiplayerUI();

// Initialize Nano authentication
nanoAuth.init();

// Hook up "Sign in with Nano" button
const registerBtn = document.getElementById('register-btn-placeholder');
if (registerBtn) {
    registerBtn.addEventListener('click', () => {
        nanoAuth.showRegistrationModal();
    });
}


// Add global key listeners that call the input handler
document.addEventListener('keydown', (event) => {
    // console.log(`main.js keydown: ${event.key} (code: ${event.code})`); // Log listener firing (optional)
    inputHandler.handleKeyDown(event); // Call the input handler
});

document.addEventListener('keyup', (event) => {
    // console.log(`main.js keyup: ${event.key} (code: ${event.code})`); // Log listener firing (optional)
    inputHandler.handleKeyUp(event); // Call the input handler
});

// Add mouse down listener for measurement view clicks
canvas?.addEventListener('mousedown', (event) => {
    inputHandler.handleMouseDown(event); // Call the input handler
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
    // Get local player color for trajectory line
    const localPlayerId = playerManager.getPlayerId();
    const players = multiplayerManager.getPlayers();
    const localPlayer = players.find(p => p.id === localPlayerId);
    const playerColor = localPlayer?.color ? parseInt(localPlayer.color.replace('#', '0x')) : 0xffff00;

    visuals.animateBallFlightWithLanding(shotData, playerColor);

    // 3. Update Game Mode Logic (if applicable)
    let modeHandledStatusUpdate = false;
    if (currentMode === GAME_MODES.CLOSEST_TO_FLAG) {
        const distanceResult = closestToFlag.handleShotResult(shotData);
        if (distanceResult) {
            shotData.distanceFromHoleMeters = distanceResult.distanceFromHoleMeters;
            shotData.distanceFromHoleYards = distanceResult.distanceFromHoleYards;
        }
        // if (closestToFlag.isModeComplete()) modeHandledStatusUpdate = true; // Example if CTF sets a final status
    } else if (currentMode === GAME_MODES.PLAY_HOLE) {
        playHole.handleShotResult(shotData);
        // playHole.handleShotResult will call ui.updateStatus if the hole is completed.
        if (shotData.isHoledOut) {
            modeHandledStatusUpdate = true;
        }
    } else if (currentMode === GAME_MODES.RANGE) {
        // Update overlay specifically for range mode
        ui.updateVisualOverlayInfo('range', {
            lastShotDist: shotData.totalDistance,
            backSpin: shotData.backSpin,
            sideSpin: shotData.sideSpin,
            lie: 'Tee' // Assuming range is always off a tee for now
            // Removed wind placeholder - live wind is handled separately
        });
    }

    // 4. Update overall game status (e.g., ready for next shot)
    // Note: gameLogic sets its internal state to 'result' before calling back
    if (!modeHandledStatusUpdate) {
        ui.updateStatus('Result - Press (n) for next shot');
    }
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
