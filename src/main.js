import * as ui from './ui.js';
import * as logic from './gameLogic.js';
import * as visuals from './visuals.js'; // Import visuals placeholder

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
