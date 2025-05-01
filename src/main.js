import * as ui from './ui.js';
import * as logic from './gameLogic.js';
import * as visuals from './visuals.js';

// --- Game Modes ---
const GAME_MODES = {
    RANGE: 'range',
    CLOSEST_TO_FLAG: 'closest-to-flag',
    PLAY_HOLE: 'play-hole',
};
let currentMode = GAME_MODES.RANGE; // Default mode

// Function to change the game mode
function setGameMode(newMode) {
    if (Object.values(GAME_MODES).includes(newMode)) {
        console.log(`Switching game mode to: ${newMode}`);
        currentMode = newMode;
        ui.setGameModeClass(currentMode); // Update UI (body class, etc.)
        // TODO: Add logic to reset/initialize the specific mode (visuals, objectives, etc.)
        // For now, just reset the basic swing state
        logic.resetSwing();
    } else {
        console.error(`Attempted to switch to invalid game mode: ${newMode}`);
    }
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

// Set other initial UI display values based on logic state
ui.setInitialSwingSpeedDisplay(initialSwingSpeed);
ui.setupBackswingBar(); // Setup backswing marker
ui.setupTimingBarWindows(initialSwingSpeed / 100); // Setup downswing windows based on initial speed

// Initialize game logic (which also calls ui.resetUI)
logic.initializeGameLogic();

// Set initial UI state for the default mode
ui.setGameModeClass(currentMode);

// Initialize visuals
const canvas = document.getElementById('golf-canvas');
if (canvas) {
    visuals.initVisuals(canvas);
    visuals.showBallAtAddress(); // Show initial ball position
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

ui.addNextShotClickListener(() => {
    logic.resetSwing(); // Logic reset now calls visuals.resetVisuals()
});

// --- Connect Mode Selection Buttons ---
document.getElementById('mode-btn-range')?.addEventListener('click', () => setGameMode(GAME_MODES.RANGE));
document.getElementById('mode-btn-closest')?.addEventListener('click', () => setGameMode(GAME_MODES.CLOSEST_TO_FLAG));
document.getElementById('mode-btn-hole')?.addEventListener('click', () => setGameMode(GAME_MODES.PLAY_HOLE));


// Add global key listeners that call logic handlers
document.addEventListener('keydown', (event) => {
    console.log(`main.js keydown: ${event.key} (code: ${event.code})`); // Log listener firing
    logic.handleKeyDown(event);
});

document.addEventListener('keyup', (event) => {
    console.log(`main.js keyup: ${event.key} (code: ${event.code})`); // Log listener firing
    logic.handleKeyUp(event);
});

console.log("Main script loaded, event listeners attached.");

// --- Connect Logic Calculation to Visuals (Example) ---
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
