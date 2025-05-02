import { clubs } from './clubs.js'; // Import club data for populating dropdown

// --- DOM Element References ---
const statusText = document.getElementById('status-text');
const swingSpeedSlider = document.getElementById('swing-speed-slider');
const swingSpeedValueSpan = document.getElementById('swing-speed-value');
const clubSelect = document.getElementById('club-select');
const nextShotButton = document.getElementById('next-shot-button');
// Shot Type Selector Elements
const shotTypeRadios = document.querySelectorAll('input[name="shot-type"]'); // Get all radio buttons
const shotTypeFull = document.getElementById('shot-type-full');
const shotTypeChip = document.getElementById('shot-type-chip');
const shotTypePutt = document.getElementById('shot-type-putt');

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
// Containers for hiding/showing elements based on shot type
const rotationTimingContainer = progressA.closest('.timing-bar-container'); // Find parent container for Rotation bar
const armsTimingContainer = progressJ.closest('.timing-bar-container'); // Find parent container for Arms bar
const wristsTimingContainer = progressD.closest('.timing-bar-container'); // Find parent container for Wrists/Hit bar

const resultText = document.getElementById('result-text');
const chsText = document.getElementById('chs-text');
const ballSpeedText = document.getElementById('ball-speed-text');
const attackAngleText = document.getElementById('attack-angle-text');
const clubPathText = document.getElementById('club-path-text'); // Added
const faceAngleText = document.getElementById('face-angle-text'); // Added
const faceToPathText = document.getElementById('face-to-path-text'); // Added
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

// Closest to Flag UI Elements
const ctfTargetDistanceText = document.getElementById('ctf-target-distance');
const ctfShotsTakenText = document.getElementById('ctf-shots-taken');
const ctfLastDistanceText = document.getElementById('ctf-last-distance');
const ctfBestDistanceText = document.getElementById('ctf-best-distance');

// Play Hole UI Elements (Need corresponding HTML elements)
const phParText = document.getElementById('ph-par');
const phLengthText = document.getElementById('ph-length');
const phScoreText = document.getElementById('ph-score');
const phHoleOutMessage = document.getElementById('ph-hole-out-message'); // A div/span to show the message


// --- Constants from gameLogic (will be passed in or imported if needed) ---
// These might be better managed within gameLogic or passed during initialization
const DOWNSWING_TIMING_BAR_DURATION_MS = 500;
const BACKSWING_BAR_MAX_DURATION_MS = 1500;
const IDEAL_BACKSWING_DURATION_MS = 1000;
const CHIP_DOWNSWING_DURATION_MS = 1500; // Match full swing bar duration visually

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

// New function to update chip-specific timing bars (Rotation 'a' and Hit 'i')
export function updateChipTimingBars(elapsedTime) {
    const progressPercent = Math.min(100, (elapsedTime / CHIP_DOWNSWING_DURATION_MS) * 100);
    // Update Rotation ('a' -> progressA) and Hit ('i' -> progressD) bars
    progressA.style.width = `${progressPercent}%`;
    progressD.style.width = `${progressPercent}%`;
    return progressPercent; // Return progress for timeout check
}


export function showKeyPressMarker(key, offset, speedFactor) {
    const currentShotType = getShotType(); // Get the current shot type

    // Determine duration based on shot type. Putt doesn't use timing markers in the same way.
    // Chip uses a fixed duration. Full uses speedFactor.
    let effectiveDownswingDuration;
    if (currentShotType === 'chip') {
        effectiveDownswingDuration = CHIP_DOWNSWING_DURATION_MS;
    } else if (currentShotType === 'full') {
        effectiveDownswingDuration = DOWNSWING_TIMING_BAR_DURATION_MS / speedFactor;
    } else {
        // Putt doesn't use these key press markers in the downswing bar
        return;
    }

    const markerPercent = Math.min(100, Math.max(0, (offset / effectiveDownswingDuration) * 100)); // Clamp 0-100
    let markerElement;

    // Assign marker based on key assignments AND shot type validity
    switch (key) {
        case 'a': // Rotation ('a') -> marker-a
            // Only show Rotation marker for Full and Chip
            if (currentShotType === 'full' || currentShotType === 'chip') {
                markerElement = markerA;
            } else {
                return; // Don't show for Putt
            }
            break;
        case 'd': // Arms ('d') -> marker-j
            // Only show Arms marker for Full swing
            if (currentShotType === 'full') {
                markerElement = markerJ;
            } else {
                return; // Don't show for Chip or Putt
            }
            break;
        case 'i': // Wrists/Hit ('i') -> marker-d
            // Show Hit marker for Full, Chip (assuming 'i' is the key for hit)
            // Putt uses a different mechanism (power bar) - this marker shouldn't show for putt via this function.
            if (currentShotType === 'full' || currentShotType === 'chip') {
                 markerElement = markerD;
            } else {
                return; // Don't show for Putt
            }
            break;
        default: return; // Unknown key
    }

    // If we have a valid markerElement for the current shot type and key
    if (markerElement) {
        markerElement.style.left = `${markerPercent}%`;
        markerElement.style.display = 'block';
    }
}

export function updateResultDisplay(resultData) {
    resultText.textContent = resultData.message;
    // Helper to format numbers or return 'N/A'
    const formatNum = (num, digits = 1) => (num !== undefined && !isNaN(num)) ? num.toFixed(digits) : 'N/A';

    // Use clubHeadSpeed from shotData (which comes from impactResult.actualCHS)
    chsText.textContent = formatNum(resultData.clubHeadSpeed, 1);
    ballSpeedText.textContent = formatNum(resultData.ballSpeed, 1);
    attackAngleText.textContent = formatNum(resultData.attackAngle, 1);
    // Add Club Path, Face Angle (vs Target), and Face-to-Path display
    clubPathText.textContent = formatNum(resultData.clubPathAngle, 1);
    faceAngleText.textContent = formatNum(resultData.absoluteFaceAngle, 1); // This is vs Target
    faceToPathText.textContent = formatNum(resultData.faceAngleRelPath, 1); // Added Face-to-Path
    backSpinText.textContent = formatNum(resultData.backSpin, 0);
    sideSpinText.textContent = formatNum(resultData.sideSpin, 0);
    peakHeightText.textContent = formatNum(resultData.peakHeight, 1);
    carryDistanceText.textContent = formatNum(resultData.carryDistance, 1);
    // Added rollout and total distance display
    rolloutDistanceText.textContent = formatNum(resultData.rolloutDistance, 1);
    totalDistanceText.textContent = formatNum(resultData.totalDistance, 1);
    launchAngleText.textContent = formatNum(resultData.launchAngle, 1); // Added Launch Angle display
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
    clubPathText.textContent = 'N/A'; // Added reset
    faceAngleText.textContent = 'N/A'; // Added reset
    faceToPathText.textContent = 'N/A'; // Added reset
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
    clubPathText.textContent = 'N/A'; // Added reset
    faceAngleText.textContent = 'N/A'; // Added reset
    faceToPathText.textContent = 'N/A'; // Added reset
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

// --- Shot Type UI Functions ---

export function getShotType() {
    for (const radio of shotTypeRadios) {
        if (radio.checked) {
            return radio.value; // 'full', 'chip', or 'putt'
        }
    }
    return 'full'; // Default if none checked (shouldn't happen with default)
}

export function setSwingSpeedControlState(enabled) {
    swingSpeedSlider.disabled = !enabled;
    // Optionally add a class to visually grey out the slider/label when disabled
    const sliderContainer = swingSpeedSlider.parentElement; // Get the div containing the label/slider/value
    if (enabled) {
        sliderContainer.classList.remove('disabled');
    } else {
        sliderContainer.classList.add('disabled');
    }
    console.log(`UI: Swing speed control ${enabled ? 'enabled' : 'disabled'}`);
}

// Function to show/hide timing bars, windows, AND other controls based on shot type
export function updateTimingBarVisibility(shotType) { // Consider renaming later if scope expands further
    const isFullSwing = shotType === 'full';
    const isChip = shotType === 'chip';
    const isPutt = shotType === 'putt';

    // Rotation Bar ('a') Visibility: Show for Full & Chip, Hide for Putt
    if (rotationTimingContainer) {
        rotationTimingContainer.style.display = (isFullSwing || isChip) ? '' : 'none';
    }

    // Arms Bar ('j') Visibility: Show only for Full
    if (armsTimingContainer) {
        armsTimingContainer.style.display = isFullSwing ? '' : 'none';
    }

    // Wrists/Hit Bar ('i'/'d') Visibility: Show for Full, Chip, AND Putt
    if (wristsTimingContainer) {
        wristsTimingContainer.style.display = (isFullSwing || isChip || isPutt) ? '' : 'none';
    }

    // Timing Windows (a, j, d) Visibility: Show only for Full
    if (windowA) windowA.style.display = isFullSwing ? '' : 'none';
    if (windowJ) windowJ.style.display = isFullSwing ? '' : 'none';
    if (windowD) windowD.style.display = isFullSwing ? '' : 'none';

    // Ball Position Control Visibility: Show for Full & Chip, Hide for Putt
    if (ballPositionControl) {
        ballPositionControl.style.display = (isFullSwing || isChip) ? '' : 'none';
    }

    // Club Select Dropdown: Enable for Full & Chip, Disable for Putt
    if (clubSelect) {
        clubSelect.disabled = isPutt;
        // Add/remove a class for visual styling if desired
        if (isPutt) {
            clubSelect.classList.add('disabled');
        } else {
            clubSelect.classList.remove('disabled');
        }
    }

    // Ideal Backswing Marker Visibility: Show only for Full swing
    if (idealBackswingMarker) {
        idealBackswingMarker.style.display = isFullSwing ? '' : 'none';
    }

    console.log(`UI: Updated control visibility for shot type: ${shotType}`);
}

// New function specifically for updating the putt downswing timing bar (e.g., progressD)
// The visual fill rate is constant, based on BACKSWING_BAR_MAX_DURATION_MS.
export function updatePuttTimingBar(elapsedTime) {
    // Use the fixed max duration for consistent visual fill speed
    const progressPercent = Math.min(100, (elapsedTime / BACKSWING_BAR_MAX_DURATION_MS) * 100);
    // Update only the bar designated for putt downswing (progressD)
    progressD.style.width = `${progressPercent}%`;
    return progressPercent;
}

// Function to programmatically set the value of the club select dropdown
export function setClubSelectValue(clubKey) {
    if (clubSelect) {
        clubSelect.value = clubKey;
        console.log(`UI: Set club select dropdown to ${clubKey}`);
    } else {
        console.warn("UI: Club select element not found, couldn't set value.");
    }
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

export function addShotTypeChangeListener(callback) {
    shotTypeRadios.forEach(radio => {
        radio.addEventListener('change', (event) => {
            if (event.target.checked) {
                callback(event.target.value); // Pass the selected shot type ('full', 'chip', 'putt')
            }
        });
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


// --- Game Mode UI ---

// Function to update the body class based on the current game mode
export function setGameModeClass(mode) {
    const body = document.body;
    // Remove any existing mode classes
    body.classList.remove('mode-range', 'mode-closest-to-flag', 'mode-play-hole');
    // Add the new mode class
    body.classList.add(`mode-${mode}`);
    console.log(`UI: Set body class to mode-${mode}`);
}

// Function to update the target distance display in CTF mode
export function updateTargetDistanceDisplay(distanceYards) {
    if (ctfTargetDistanceText) {
        ctfTargetDistanceText.textContent = distanceYards.toFixed(0);
    }
}

// Function to update the results display in CTF mode
export function updateClosestToFlagResult(lastDistance, bestDistance, shotsTaken) {
    if (ctfLastDistanceText) {
        ctfLastDistanceText.textContent = lastDistance.toFixed(1);
    }
    if (ctfBestDistanceText) {
        ctfBestDistanceText.textContent = bestDistance < Infinity ? bestDistance.toFixed(1) : 'N/A';
    }
    if (ctfShotsTakenText) {
        ctfShotsTakenText.textContent = shotsTaken;
    }
}

// Function to reset the CTF display (e.g., when mode starts)
export function resetClosestToFlagDisplay() {
     if (ctfTargetDistanceText) ctfTargetDistanceText.textContent = 'N/A';
     if (ctfShotsTakenText) ctfShotsTakenText.textContent = '0';
     if (ctfLastDistanceText) ctfLastDistanceText.textContent = 'N/A';
     if (ctfBestDistanceText) ctfBestDistanceText.textContent = 'N/A';
}

// --- Play Hole UI Functions ---

// Function to update the hole info display
export function updatePlayHoleInfo(par, lengthYards, score) {
    if (phParText) phParText.textContent = par;
    if (phLengthText) phLengthText.textContent = lengthYards.toFixed(0);
    if (phScoreText) phScoreText.textContent = score;
    // Hide hole out message when updating score during play
    if (phHoleOutMessage) phHoleOutMessage.style.display = 'none';
}

// Function to reset the Play Hole display
export function resetPlayHoleDisplay() {
    if (phParText) phParText.textContent = 'N/A';
    if (phLengthText) phLengthText.textContent = 'N/A';
    if (phScoreText) phScoreText.textContent = '0';
    if (phHoleOutMessage) {
        phHoleOutMessage.textContent = '';
        phHoleOutMessage.style.display = 'none';
    }
}

// Function to show the hole out message
export function showHoleOutMessage(score) {
    if (phHoleOutMessage) {
        phHoleOutMessage.textContent = `Hole Out! Score: ${score}`;
        phHoleOutMessage.style.display = 'block';
    }
}


// Remove initial setup calls from here; they will be called explicitly from main.js
// populateClubSelect();
// setupBackswingBar();
