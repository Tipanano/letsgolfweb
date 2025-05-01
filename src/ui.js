import { clubs } from './clubs.js'; // Import club data for populating dropdown

// --- DOM Element References ---
const statusText = document.getElementById('status-text');
const swingSpeedSlider = document.getElementById('swing-speed-slider');
const swingSpeedValueSpan = document.getElementById('swing-speed-value');
const clubSelect = document.getElementById('club-select');
const nextShotButton = document.getElementById('next-shot-button');

const backswingDurationText = document.getElementById('backswing-duration');
const rotationStartOffsetText = document.getElementById('rotation-start-offset');
const armsStartOffsetText = document.getElementById('arms-start-offset');
const wristsStartOffsetText = document.getElementById('wrists-start-offset');
const hipInitiationOffsetText = document.getElementById('hip-initiation-offset'); // Added

const progressBackswing = document.getElementById('progress-backswing');
const idealBackswingMarker = document.getElementById('ideal-backswing-marker');
// Remapped: a=Rotation, j=Arms, d=Wrists
const progressA = document.getElementById('progress-a'); // Rotation bar
const progressJ = document.getElementById('progress-j'); // Arms bar
const progressD = document.getElementById('progress-d'); // Wrists bar
const windowA = document.getElementById('window-a');     // Rotation window
const windowJ = document.getElementById('window-j');     // Arms window
const windowD = document.getElementById('window-d');     // Wrists window
const markerA = document.getElementById('marker-a');     // Rotation marker
const markerJ = document.getElementById('marker-j');     // Arms marker
const markerD = document.getElementById('marker-d');     // Wrists marker

const resultText = document.getElementById('result-text');
const chsText = document.getElementById('chs-text');
const ballSpeedText = document.getElementById('ball-speed-text');
const attackAngleText = document.getElementById('attack-angle-text');
const backSpinText = document.getElementById('back-spin-text');
const sideSpinText = document.getElementById('side-spin-text');
const peakHeightText = document.getElementById('peak-height-text');
const carryDistanceText = document.getElementById('carry-distance-text');
const rolloutDistanceText = document.getElementById('result-rollout'); // Added
const totalDistanceText = document.getElementById('result-total-distance'); // Added
const launchAngleText = document.getElementById('launch-angle-text'); // Added for Launch Angle

// Ball Position Elements
const ballPositionControl = document.getElementById('ball-position-control');
const ballMarker = document.getElementById('ball-marker');
const ballPositionText = document.getElementById('ball-position-text');

// --- Constants from gameLogic (will be passed in or imported if needed) ---
// These might be better managed within gameLogic or passed during initialization
const DOWNSWING_TIMING_BAR_DURATION_MS = 500;
const BACKSWING_BAR_MAX_DURATION_MS = 1500;
const IDEAL_BACKSWING_DURATION_MS = 1000;

// --- Ball Position State ---
const ballPositionLevels = 10; // Increased granularity
// Define labels for 10 positions (adjust as needed for clarity)
const ballPositionLabels = [
    "Far Back", "Back+", "Back", "Back-Center", "Center-Back",
    "Center-Fwd", "Center-Forward", "Forward", "Forward+", "Far Forward"
];
let currentBallPositionIndex = 5; // Start near Center (index 5 for 10 levels, 0-9)

// --- UI Update Functions ---

export function updateStatus(text) {
    statusText.textContent = text;
}

export function populateClubSelect() {
    for (const key in clubs) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = clubs[key].name;
        clubSelect.appendChild(option);
    }
    clubSelect.value = 'I7'; // Set default selection to the correct key
}

export function setupBackswingBar() {
    const idealPercent = (IDEAL_BACKSWING_DURATION_MS / BACKSWING_BAR_MAX_DURATION_MS) * 100;
    idealBackswingMarker.style.left = `${idealPercent}%`;
}

export function setupTimingBarWindows(swingSpeed) {
    // Ideal timings (match gameLogic.js)
    const idealWindowWidthMs = 50 / swingSpeed;
    const idealRotationStart = 50 / swingSpeed;  // Triggered by 'a'
    const idealArmsStart = 100 / swingSpeed;     // Triggered by 'j'
    const idealWristsStart = 200 / swingSpeed;   // Triggered by 'd'
    const effectiveDownswingDuration = DOWNSWING_TIMING_BAR_DURATION_MS / swingSpeed;

    const calculateWindow = (idealStart) => {
        const startMs = idealStart - idealWindowWidthMs / 2;
        const endMs = idealStart + idealWindowWidthMs / 2;
        const leftPercent = Math.max(0, (startMs / effectiveDownswingDuration) * 100);
        const rightPercent = Math.min(100, (endMs / effectiveDownswingDuration) * 100);
        const widthPercent = Math.max(0, rightPercent - leftPercent);
        return { left: leftPercent, width: widthPercent };
    };

    // Calculate window positions based on NEW key assignments (a=Rotation, d=Arms, u=Wrists)
    const winA = calculateWindow(idealRotationStart); // Rotation window ('a') -> window-a
    const winJ = calculateWindow(idealArmsStart);     // Arms window ('d') -> window-j
    const winD = calculateWindow(idealWristsStart);   // Wrists window ('u') -> window-d

    windowA.style.left = `${winA.left}%`; windowA.style.width = `${winA.width}%`; // Rotation ('a') -> window-a
    windowJ.style.left = `${winJ.left}%`; windowJ.style.width = `${winJ.width}%`; // Arms ('d') -> window-j
    windowD.style.left = `${winD.left}%`; windowD.style.width = `${winD.width}%`; // Wrists ('u') -> window-d
}

export function updateBackswingBar(elapsedTime, swingSpeed) {
    const effectiveBackswingDuration = BACKSWING_BAR_MAX_DURATION_MS / swingSpeed;
    const progressPercent = Math.min(100, (elapsedTime / effectiveBackswingDuration) * 100);
    progressBackswing.style.width = `${progressPercent}%`;

    const idealDurationAdjusted = IDEAL_BACKSWING_DURATION_MS / swingSpeed;
    const maxDurationAdjusted = BACKSWING_BAR_MAX_DURATION_MS / swingSpeed;

    if (elapsedTime > maxDurationAdjusted) {
        progressBackswing.style.backgroundColor = '#dc3545'; // Red
    } else if (elapsedTime > idealDurationAdjusted) {
        progressBackswing.style.backgroundColor = '#ffc107'; // Yellow
    } else {
        progressBackswing.style.backgroundColor = '#28a745'; // Green
    }
}

// Function to visually mark hip initiation on the backswing bar
export function markHipInitiationOnBackswingBar() {
    // Change color to indicate hips have started moving
    // Using a slightly darker green or a different distinct color
    progressBackswing.style.backgroundColor = '#1e7e34'; // Darker Green
    console.log("UI: Marked hip initiation on backswing bar.");
}

export function updateTimingBars(elapsedTime, swingSpeed) {
    const effectiveDownswingDuration = DOWNSWING_TIMING_BAR_DURATION_MS / swingSpeed;
    const progressPercent = Math.min(100, (elapsedTime / effectiveDownswingDuration) * 100);
    // Update progress bars (IDs remain the same: a=Rotation, j=Arms, d=Wrists)
    progressA.style.width = `${progressPercent}%`; // Rotation ('a') -> progress-a
    progressJ.style.width = `${progressPercent}%`; // Arms ('d') -> progress-j
    progressD.style.width = `${progressPercent}%`; // Wrists ('u') -> progress-d
    return progressPercent; // Return progress to check if animation should stop
}

export function showKeyPressMarker(key, offset, swingSpeed) {
    const effectiveDownswingDuration = DOWNSWING_TIMING_BAR_DURATION_MS / swingSpeed;
    const markerPercent = Math.min(100, (offset / effectiveDownswingDuration) * 100);
    let markerElement;
    // Assign marker based on NEW key assignments (a=Rotation, d=Arms, i=Wrists)
    switch (key) {
        case 'a': markerElement = markerA; break; // Rotation ('a') -> marker-a
        case 'd': markerElement = markerJ; break; // Arms ('d') -> marker-j
        case 'i': markerElement = markerD; break; // Wrists ('i') -> marker-d
        default: return;
    }
    markerElement.style.left = `${markerPercent}%`;
    markerElement.style.display = 'block';
}

export function updateResultDisplay(resultData) {
    resultText.textContent = resultData.message;
    chsText.textContent = resultData.chs.toFixed(1);
    ballSpeedText.textContent = resultData.ballSpeed.toFixed(1);
    attackAngleText.textContent = resultData.attackAngle.toFixed(1);
    backSpinText.textContent = resultData.backSpin.toFixed(0);
    sideSpinText.textContent = resultData.sideSpin.toFixed(0);
    peakHeightText.textContent = resultData.peakHeight.toFixed(1);
    carryDistanceText.textContent = resultData.carryDistance.toFixed(1);
    // Added rollout and total distance display
    rolloutDistanceText.textContent = resultData.rolloutDistance !== undefined ? resultData.rolloutDistance.toFixed(1) : 'N/A';
    totalDistanceText.textContent = resultData.totalDistance !== undefined ? resultData.totalDistance.toFixed(1) : 'N/A';
    launchAngleText.textContent = resultData.launchAngle !== undefined ? resultData.launchAngle.toFixed(1) : 'N/A'; // Added Launch Angle display
    nextShotButton.style.display = 'inline-block';
}

export function updateDebugTimingInfo(timingData) {
    backswingDurationText.textContent = timingData.backswingDuration !== null ? `${timingData.backswingDuration.toFixed(0)} ms` : 'N/A';
    rotationStartOffsetText.textContent = timingData.rotationStartOffset !== null ? `${timingData.rotationStartOffset.toFixed(0)} ms ${timingData.rotationInitiatedEarly ? '(early)' : ''}` : 'N/A';
    armsStartOffsetText.textContent = timingData.armsStartOffset !== null ? `${timingData.armsStartOffset.toFixed(0)} ms` : 'N/A';
    wristsStartOffsetText.textContent = timingData.wristsStartOffset !== null ? `${timingData.wristsStartOffset.toFixed(0)} ms` : 'N/A';
    // Added hip offset display
    hipInitiationOffsetText.textContent = timingData.hipInitiationOffset !== null ? `${timingData.hipInitiationOffset.toFixed(0)} ms` : 'N/A';
}


export function resetUI() {
    // Reset timing bars visually
    progressBackswing.style.width = '0%';
    progressBackswing.style.backgroundColor = '#28a745'; // Reset color back to default green
    // Reset progress bars (IDs remain the same: a=Rotation, j=Arms, d=Wrists)
    progressA.style.width = '0%'; // Rotation ('a') -> progress-a
    progressJ.style.width = '0%'; // Arms ('d') -> progress-j
    progressD.style.width = '0%'; // Wrists ('u') -> progress-d
    // Reset markers (IDs remain the same: a=Rotation, j=Arms, d=Wrists)
    markerA.style.display = 'none'; // Rotation ('a') -> marker-a
    markerJ.style.display = 'none'; // Arms ('d') -> marker-j
    markerD.style.display = 'none'; // Wrists ('u') -> marker-d
    nextShotButton.style.display = 'none'; // Hide button on reset

    // Reset result details
    resultText.textContent = 'Hit the ball!';
    chsText.textContent = 'N/A';
    ballSpeedText.textContent = 'N/A';
    attackAngleText.textContent = 'N/A';
    backSpinText.textContent = 'N/A';
    sideSpinText.textContent = 'N/A';
    peakHeightText.textContent = 'N/A';
    carryDistanceText.textContent = 'N/A';
    rolloutDistanceText.textContent = 'N/A'; // Added reset
    totalDistanceText.textContent = 'N/A'; // Added reset
    launchAngleText.textContent = 'N/A'; // Added reset

    // Reset debug timing
    updateDebugTimingInfo({
        backswingDuration: null,
        rotationStartOffset: null,
        rotationInitiatedEarly: false,
        armsStartOffset: null,
        wristsStartOffset: null,
        hipInitiationOffset: null, // Added reset
    });

    updateStatus('Ready');
    // Reset ball position on UI reset
    currentBallPositionIndex = 5; // Reset to Center-Fwd (index 5)
    updateBallPositionDisplay();
}

// New function to reset UI *without* resetting ball position
export function resetUIForNewShot() {
    // Reset timing bars visually
    progressBackswing.style.width = '0%';
    progressBackswing.style.backgroundColor = '#28a745'; // Reset color back to default green
    // Reset progress bars (IDs remain the same: a=Rotation, j=Arms, d=Wrists)
    progressA.style.width = '0%'; // Rotation ('a') -> progress-a
    progressJ.style.width = '0%'; // Arms ('d') -> progress-j
    progressD.style.width = '0%'; // Wrists ('u') -> progress-d
    // Reset markers (IDs remain the same: a=Rotation, j=Arms, d=Wrists)
    markerA.style.display = 'none'; // Rotation ('a') -> marker-a
    markerJ.style.display = 'none'; // Arms ('d') -> marker-j
    markerD.style.display = 'none'; // Wrists ('u') -> marker-d
    nextShotButton.style.display = 'none'; // Hide button on reset

    // Reset result details
    resultText.textContent = 'Hit the ball!';
    chsText.textContent = 'N/A';
    ballSpeedText.textContent = 'N/A';
    attackAngleText.textContent = 'N/A';
    backSpinText.textContent = 'N/A';
    sideSpinText.textContent = 'N/A';
    peakHeightText.textContent = 'N/A';
    carryDistanceText.textContent = 'N/A';
    rolloutDistanceText.textContent = 'N/A'; // Added reset
    totalDistanceText.textContent = 'N/A'; // Added reset
    launchAngleText.textContent = 'N/A'; // Added reset

    // Reset debug timing
    updateDebugTimingInfo({
        backswingDuration: null,
        rotationStartOffset: null,
        rotationInitiatedEarly: false,
        armsStartOffset: null,
        wristsStartOffset: null,
        hipInitiationOffset: null, // Added reset
    });

    updateStatus('Ready');
    // DO NOT reset ball position here
    // currentBallPositionIndex = 5;
    // updateBallPositionDisplay();
}


// --- Ball Position UI Functions ---

function updateBallPositionDisplay() {
    // Update text label
    ballPositionText.textContent = ballPositionLabels[currentBallPositionIndex];

    // Update visual marker position (vertically)
    // Calculate percentage based on index (0 to levels-1)
    // Map index 0 (Far Back) to ~90% top, index 9 (Far Forward) to ~10% top
    const totalSegments = ballPositionLevels - 1; // 9 segments for 10 positions
    // Higher index (forward) should result in lower 'top' percentage
    const positionPercent = 10 + ((totalSegments - currentBallPositionIndex) / totalSegments) * 80; // Map 0-9 to 90%-10%
    ballMarker.style.top = `${positionPercent}%`;
}

export function adjustBallPosition(delta) {
    const newIndex = currentBallPositionIndex + delta;
    // Clamp index within bounds [0, ballPositionLevels - 1]
    currentBallPositionIndex = Math.max(0, Math.min(ballPositionLevels - 1, newIndex));
    updateBallPositionDisplay();
    console.log(`Ball position adjusted to: ${ballPositionLabels[currentBallPositionIndex]} (Index: ${currentBallPositionIndex})`);
}

// Function to directly set the ball position index (e.g., from club default)
export function setBallPosition(index) {
    // Clamp index within bounds [0, ballPositionLevels - 1]
    currentBallPositionIndex = Math.max(0, Math.min(ballPositionLevels - 1, index));
    updateBallPositionDisplay();
    console.log(`Ball position set to: ${ballPositionLabels[currentBallPositionIndex]} (Index: ${currentBallPositionIndex})`);
}

// Function to get the current ball position index for game logic
export function getBallPositionIndex() {
    return currentBallPositionIndex;
}

// Function to get the total number of ball position levels
export function getBallPositionLevels() {
    return ballPositionLevels;
}


// --- Event Listener Setup ---
// We export functions to attach listeners from main.js
// This allows main.js to pass callbacks that interact with gameLogic

export function addSwingSpeedInputListener(callback) {
    swingSpeedSlider.addEventListener('input', (event) => {
        const value = parseInt(event.target.value, 10);
        swingSpeedValueSpan.textContent = value;
        callback(value); // Pass the percentage value to the callback
    });
}

export function addClubChangeListener(callback) {
    clubSelect.addEventListener('change', (event) => {
        callback(event.target.value); // Pass the selected club key
    });
}

export function addNextShotClickListener(callback) {
    nextShotButton.addEventListener('click', callback);
}

// Export function to set the initial display value for the slider text
export function setInitialSwingSpeedDisplay(percentage) {
    swingSpeedValueSpan.textContent = percentage;
}

// Initial setup call for ball position
updateBallPositionDisplay();

// Remove initial setup calls from here; they will be called explicitly from main.js
// populateClubSelect();
// setupBackswingBar();
