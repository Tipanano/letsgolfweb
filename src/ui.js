import { clubs } from './clubs.js'; // Import club data for populating dropdown
import { YARDS_TO_METERS } from './visuals/core.js'; // Import conversion constant (Corrected Path)
import { getWind, getTemperature } from './gameLogic/state.js'; // Import environment state getters (Corrected Path)

// --- DOM Element References ---
// --- DOM Element References ---
// Views
const mainMenuDiv = document.getElementById('main-menu');
const gameViewDiv = document.getElementById('game-view');

// Buttons
const backToMenuButton = document.getElementById('back-to-menu-button');

// Other UI Elements
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
const hipInitiationMarker = document.getElementById('hip-initiation-marker'); // Added for hip initiation timing
const postShotIdealJWindowOnBackswing = document.getElementById('post-shot-ideal-j-window-on-backswing'); // Added for J press feedback
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
const shotResultDiv = document.getElementById('shot-result'); // Reference for the pop-up
// Shot Summary Widget Elements
const shotSummaryWidget = document.getElementById('shot-summary-widget');
const summaryCarrySpan = document.getElementById('summary-carry');
const summaryRollSpan = document.getElementById('summary-roll');
const showDetailsButton = document.getElementById('show-details-button');


// Ball Position Elements
const ballPositionControl = document.getElementById('ball-position-control');
const ballMarker = document.getElementById('ball-marker');
const ballPositionText = document.getElementById('ball-position-text');

// Closest to Flag UI Elements
const ctfTargetDistanceText = document.getElementById('ctf-target-distance');
const ctfShotsTakenText = document.getElementById('ctf-shots-taken');
const ctfLastDistanceText = document.getElementById('ctf-last-distance');
const ctfBestDistanceText = document.getElementById('ctf-best-distance');

// Play Hole UI Elements (REMOVED - Now handled by overlay)
// const phParText = document.getElementById('ph-par');
// const phLengthText = document.getElementById('ph-length');
// const phScoreText = document.getElementById('ph-score');
// const phHoleOutMessage = document.getElementById('ph-hole-out-message');

// NEW Visual Overlay Elements
const overlayHoleNumSpan = document.getElementById('overlay-hole-num');
const overlayParSpan = document.getElementById('overlay-par');
const overlayShotNumSpan = document.getElementById('overlay-shot-num');
const overlayForScoreTextSpan = document.getElementById('overlay-for-score-text'); // Added
const overlayDistFlagSpan = document.getElementById('overlay-dist-flag');
const overlayWindSpan = document.getElementById('overlay-wind'); // Added
const overlayLieSpan = document.getElementById('overlay-lie'); // Added
const overlayPlayerNameSpan = document.getElementById('overlay-player-name'); // Added
const overlayTotalScoreSpan = document.getElementById('overlay-total-score'); // Added
const overlayPositionSpan = document.getElementById('overlay-position'); // Added
// Range specific elements
const overlayLastShotDistSpan = document.getElementById('overlay-last-shot-dist'); // Added
const overlayBackSpinSpan = document.getElementById('overlay-back-spin'); // Added
const overlaySideSpinSpan = document.getElementById('overlay-side-spin'); // Added
const overlayTempSpan = document.getElementById('overlay-temp'); // Added for temperature


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
    // Ideal timings (match gameLogic.js) - These are base offsets
    // const idealWindowWidthMs = 50 / swingSpeed; // This width is now calculated in swingPhysics and passed for feedback
    // const idealRotationStart = 50 / swingSpeed;  // Triggered by 'a'
    // const idealArmsStart = 100 / swingSpeed;     // Triggered by 'j'
    // const idealWristsStart = 200 / swingSpeed;   // Triggered by 'd'
    // const effectiveDownswingDuration = DOWNSWING_TIMING_BAR_DURATION_MS / swingSpeed;

    // The ideal windows (window-a, window-j, window-d) will now be hidden by default
    // and only shown post-shot with dynamically calculated positions.
    if (windowA) windowA.style.display = 'none';
    if (windowJ) windowJ.style.display = 'none';
    if (windowD) windowD.style.display = 'none';

    // console.log("UI: setupTimingBarWindows called - downswing ideal windows are now hidden by default, shown post-shot.");
}

export function updateBackswingBar(elapsedTime, swingSpeed) {
    const effectiveBackswingDuration = BACKSWING_BAR_MAX_DURATION_MS / swingSpeed;
    const progressPercent = Math.min(100, (elapsedTime / effectiveBackswingDuration) * 100);
    progressBackswing.style.width = `${progressPercent}%`;

    const idealDurationAdjusted = IDEAL_BACKSWING_DURATION_MS / swingSpeed;
    const maxDurationAdjusted = BACKSWING_BAR_MAX_DURATION_MS / swingSpeed;

    if (elapsedTime > maxDurationAdjusted) {
        progressBackswing.style.backgroundColor = '#FFA500'; // Orange (was Red #dc3545)
    } else if (elapsedTime > idealDurationAdjusted) {
        progressBackswing.style.backgroundColor = '#ffc107'; // Yellow
    } else {
        progressBackswing.style.backgroundColor = '#28a745'; // Green
    }
}

// Function to visually mark hip initiation on the backswing bar
export function markHipInitiationOnBackswingBar(hipPressTime, swingSpeed) {
    if (!hipInitiationMarker) return; // Element might not exist

    const effectiveBackswingDuration = BACKSWING_BAR_MAX_DURATION_MS / swingSpeed;
    const markerPercent = Math.min(100, Math.max(0, (hipPressTime / effectiveBackswingDuration) * 100));

    hipInitiationMarker.style.left = `${markerPercent}%`;
    hipInitiationMarker.style.display = 'block';
    console.log(`UI: Marked hip initiation at ${hipPressTime.toFixed(0)}ms (${markerPercent.toFixed(1)}%) on backswing bar.`);
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

    // Populate and show the shot summary widget
    if (shotSummaryWidget && summaryCarrySpan && summaryRollSpan) {
        summaryCarrySpan.textContent = formatNum(resultData.carryDistance, 1);
        summaryRollSpan.textContent = formatNum(resultData.rolloutDistance, 1);
        shotSummaryWidget.style.display = 'block'; // Or 'flex' if styled with flex
    }

    // DO NOT show the full shot result pop-up here automatically
    // if (shotResultDiv) {
    //     shotResultDiv.style.display = 'block';
    // }
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
    if (hipInitiationMarker) hipInitiationMarker.style.display = 'none'; // Hide hip marker
    if (postShotIdealJWindowOnBackswing) postShotIdealJWindowOnBackswing.style.display = 'none'; // Hide J press feedback window
    
    // Hide post-shot downswing feedback windows
    if (windowA) windowA.style.display = 'none';
    if (windowJ) windowJ.style.display = 'none';
    if (windowD) windowD.style.display = 'none';

    // Hide shot result pop-up and its button
    if (shotResultDiv) {
        shotResultDiv.style.display = 'none';
    }
    // Hide shot summary widget
    if (shotSummaryWidget) {
        shotSummaryWidget.style.display = 'none';
    }
    // nextShotButton.style.display = 'none'; // Button is inside shotResultDiv

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
    if (hipInitiationMarker) hipInitiationMarker.style.display = 'none'; // Hide hip marker
    if (postShotIdealJWindowOnBackswing) postShotIdealJWindowOnBackswing.style.display = 'none'; // Hide J press feedback window

    // Hide post-shot downswing feedback windows
    if (windowA) windowA.style.display = 'none';
    if (windowJ) windowJ.style.display = 'none';
    if (windowD) windowD.style.display = 'none';

    // Hide shot result pop-up and its button
    if (shotResultDiv) {
        shotResultDiv.style.display = 'none';
    }
    // Hide shot summary widget
    if (shotSummaryWidget) {
        shotSummaryWidget.style.display = 'none';
    }
    // nextShotButton.style.display = 'none'; // Button is inside shotResultDiv

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

    // Timing Windows (window-a, window-j, window-d) are now handled by displayDownswingFeedbackWindows post-shot.
    // They should be hidden by default by setupTimingBarWindows and resetUI functions.
    // So, no specific visibility change needed here based on shotType during the swing itself.
    // if (windowA) windowA.style.display = isFullSwing ? '' : 'none'; // OLD LOGIC
    // if (windowJ) windowJ.style.display = isFullSwing ? '' : 'none'; // OLD LOGIC
    // if (windowD) windowD.style.display = isFullSwing ? '' : 'none'; // OLD LOGIC

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


// Export function to set the initial display value for the slider text
export function setInitialSwingSpeedDisplay(percentage) {
    swingSpeedValueSpan.textContent = percentage;
}

// Initial setup call for ball position
updateBallPositionDisplay();


// --- Post-Shot Feedback Window Functions ---

/**
 * Displays a window on the backswing bar indicating the ideal timing for the 'J' press (transition).
 * @param {number} windowStartMs - The start time of the window (ms) relative to the beginning of the backswing.
 * @param {number} windowWidthMs - The width of the window (ms).
 * @param {number} shotSwingSpeed - The swing speed factor (0.3-1.0) used for that shot.
 */
export function displayIdealJPressWindowOnBackswing(windowStartMs, windowWidthMs, shotSwingSpeed) {
    if (!postShotIdealJWindowOnBackswing) {
        // console.warn("UI: 'post-shot-ideal-j-window-on-backswing' element not found.");
        return;
    }
    if (typeof windowStartMs !== 'number' || typeof windowWidthMs !== 'number' || typeof shotSwingSpeed !== 'number' || shotSwingSpeed <= 0) {
        console.warn("UI: Invalid parameters for displayIdealJPressWindowOnBackswing.", { windowStartMs, windowWidthMs, shotSwingSpeed });
        postShotIdealJWindowOnBackswing.style.display = 'none';
        return;
    }

    const effectiveBackswingDuration = BACKSWING_BAR_MAX_DURATION_MS / shotSwingSpeed;
    if (effectiveBackswingDuration <= 0) {
        postShotIdealJWindowOnBackswing.style.display = 'none';
        return;
    }

    let leftPercent = (windowStartMs / effectiveBackswingDuration) * 100;
    let widthPercent = (windowWidthMs / effectiveBackswingDuration) * 100;

    leftPercent = Math.max(0, leftPercent);
    widthPercent = Math.max(0, widthPercent);
    if (leftPercent + widthPercent > 100) widthPercent = 100 - leftPercent;
    if (leftPercent >= 100 || widthPercent <= 0) {
        postShotIdealJWindowOnBackswing.style.display = 'none';
        return;
    }

    postShotIdealJWindowOnBackswing.style.left = `${leftPercent}%`;
    postShotIdealJWindowOnBackswing.style.width = `${widthPercent}%`;
    postShotIdealJWindowOnBackswing.style.display = 'block';
}

/**
 * Displays feedback windows on the downswing timing bars (rotation, arms, wrists)
 * showing the ideal timing for that specific shot.
 * @param {number} rotationStartMs - Ideal start time for rotation window (ms from downswing start).
 * @param {number} rotationWidthMs - Ideal width for rotation window (ms).
 * @param {number} armsStartMs - Ideal start time for arms window (ms from downswing start).
 * @param {number} armsWidthMs - Ideal width for arms window (ms).
 * @param {number} wristsStartMs - Ideal start time for wrists window (ms from downswing start).
 * @param {number} wristsWidthMs - Ideal width for wrists window (ms).
 * @param {number} shotSwingSpeed - The swing speed factor (0.3-1.0) used for that shot.
 */
export function displayDownswingFeedbackWindows(rotationStartMs, rotationWidthMs, armsStartMs, armsWidthMs, wristsStartMs, wristsWidthMs, shotSwingSpeed) {
    const elements = [
        { el: windowA, start: rotationStartMs, width: rotationWidthMs, name: "Rotation" },
        { el: windowJ, start: armsStartMs, width: armsWidthMs, name: "Arms" },
        { el: windowD, start: wristsStartMs, width: wristsWidthMs, name: "Wrists" }
    ];

    if (typeof shotSwingSpeed !== 'number' || shotSwingSpeed <= 0) {
        console.warn("UI: Invalid shotSwingSpeed for displayDownswingFeedbackWindows.", { shotSwingSpeed });
        elements.forEach(item => { if (item.el) item.el.style.display = 'none'; });
        return;
    }

    const effectiveDownswingDuration = DOWNSWING_TIMING_BAR_DURATION_MS / shotSwingSpeed;
    if (effectiveDownswingDuration <= 0) {
        elements.forEach(item => { if (item.el) item.el.style.display = 'none'; });
        return;
    }

    elements.forEach(item => {
        if (!item.el) {
            // console.warn(`UI: Feedback window element for ${item.name} not found.`);
            return;
        }
        if (typeof item.start !== 'number' || typeof item.width !== 'number') {
            console.warn(`UI: Invalid start/width for ${item.name} feedback window.`, item);
            item.el.style.display = 'none';
            return;
        }

        let leftPercent = (item.start / effectiveDownswingDuration) * 100;
        let widthPercent = (item.width / effectiveDownswingDuration) * 100;

        leftPercent = Math.max(0, leftPercent);
        widthPercent = Math.max(0, widthPercent);
        if (leftPercent + widthPercent > 100) widthPercent = 100 - leftPercent;
        
        if (leftPercent >= 100 || widthPercent <= 0) {
            item.el.style.display = 'none';
            return;
        }

        item.el.style.left = `${leftPercent}%`;
        item.el.style.width = `${widthPercent}%`;
        item.el.style.display = 'block';
        // console.log(`UI: Displaying ${item.name} feedback window at ${leftPercent.toFixed(1)}% width ${widthPercent.toFixed(1)}%`);
    });
}


// --- NEW Visual Overlay UI Function ---

/**
 * Updates the text content of the elements within the visual info overlay.
 * @param {number | string} holeNum - The current hole number.
 * @param {number | string} par - The par for the current hole.
 * @param {number | string} distToFlag - The distance to the flag in yards.
 * @param {number | string} shotNum - The current shot number for the hole.
 * @param {number | string} score - The current score relative to par for the hole.
 * @param {string} [lie='N/A'] - The current lie of the ball.
 * @param {string} [wind='N/A'] - The current wind conditions.
 * @param {string} [playerName='Player 1'] - The current player's name.
 * @param {number | string} [totalScore='N/A'] - The total score for the round (Play Hole).
 * @param {string} [position='N/A'] - The player's position/rank (Play Hole).
 * @param {number | string} [lastShotDist='N/A'] - Distance of the last shot (Range).
 * @param {number | string} [backSpin='N/A'] - Backspin of the last shot (Range).
 * @param {number | string} [sideSpin='N/A'] - Sidespin of the last shot (Range).
 */
export function updateVisualOverlayInfo(mode, { holeNum = 'N/A', par = 'N/A', distToFlag = 'N/A', shotNum = 'N/A', score = 'N/A', lie = 'N/A', wind = 'N/A', playerName = 'Player 1', totalScore = 'N/A', position = 'N/A', lastShotDist = 'N/A', backSpin = 'N/A', sideSpin = 'N/A' } = {}) {
    const formatNum = (num, digits = 0) => (num !== undefined && num !== null && !isNaN(num)) ? num.toFixed(digits) : 'N/A';
    const formatScore = (s) => {
        if (s === null || s === undefined || isNaN(s)) return 'N/A';
        if (s === 0) return 'E';
        if (s > 0) return `+${s}`;
        return String(s); // Already includes '-' sign
    };

    // --- Update Common Elements ---
    if (overlayWindSpan) overlayWindSpan.textContent = wind;
    if (overlayLieSpan) overlayLieSpan.textContent = lie;

    // --- Update Mode-Specific Elements ---
    if (mode === 'play-hole' || mode === 'closest-to-flag') {
        // Calculate 'for score' text (only for play-hole, maybe CTF later?)
        let forScoreText = '';
        if (mode === 'play-hole' && par !== 'N/A' && shotNum !== 'N/A') {
            const scoreRelativeToPar = shotNum - par;
            const distMeters = distToFlag / (1 / YARDS_TO_METERS); // Convert yards back to meters for check
            if (distMeters <= 50) { // Only show if <= 50 meters
                if (scoreRelativeToPar < -2) forScoreText = '(for Albatross)';
                else if (scoreRelativeToPar === -2) forScoreText = '(for Eagle)';
                else if (scoreRelativeToPar === -1) forScoreText = '(for Birdie)';
                else if (scoreRelativeToPar === 0) forScoreText = '(for Par)';
                else if (scoreRelativeToPar === 1) forScoreText = '(for Bogey)';
                else if (scoreRelativeToPar === 2) forScoreText = '(for Double Bogey)';
                else if (scoreRelativeToPar > 2) forScoreText = `(for +${scoreRelativeToPar - par})`;
            }
        }

        // Update Top Left (Play Hole / CTF)
        if (overlayHoleNumSpan) overlayHoleNumSpan.textContent = holeNum ?? 'N/A';
        if (overlayParSpan) overlayParSpan.textContent = par ?? 'N/A';
        if (overlayShotNumSpan) overlayShotNumSpan.textContent = shotNum ?? 'N/A';
        if (overlayForScoreTextSpan) overlayForScoreTextSpan.textContent = forScoreText;

        // Update Top Right (Distance to Flag)
        if (overlayDistFlagSpan) overlayDistFlagSpan.textContent = formatNum(distToFlag, 0);

        // Update Bottom Left (Play Hole)
        if (mode === 'play-hole') {
            if (overlayPlayerNameSpan) overlayPlayerNameSpan.textContent = playerName;
            if (overlayTotalScoreSpan) overlayTotalScoreSpan.textContent = formatScore(totalScore);
            if (overlayPositionSpan) overlayPositionSpan.textContent = position;
        }

    } else if (mode === 'range') {
        // Update Top Left (Range)
        if (overlayLastShotDistSpan) overlayLastShotDistSpan.textContent = formatNum(lastShotDist, 1);
        if (overlayBackSpinSpan) overlayBackSpinSpan.textContent = formatNum(backSpin, 0);
        if (overlaySideSpinSpan) overlaySideSpinSpan.textContent = formatNum(sideSpin, 0);

        // Clear other mode-specific fields (optional, but good practice)
        if (overlayHoleNumSpan) overlayHoleNumSpan.textContent = 'N/A';
        if (overlayParSpan) overlayParSpan.textContent = 'N/A';
        if (overlayShotNumSpan) overlayShotNumSpan.textContent = 'N/A';
        if (overlayForScoreTextSpan) overlayForScoreTextSpan.textContent = '';
        if (overlayDistFlagSpan) overlayDistFlagSpan.textContent = 'N/A';
        if (overlayPlayerNameSpan) overlayPlayerNameSpan.textContent = 'N/A';
        if (overlayTotalScoreSpan) overlayTotalScoreSpan.textContent = 'N/A';
        if (overlayPositionSpan) overlayPositionSpan.textContent = 'N/A';
    }
}


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

// --- Play Hole UI Functions (REMOVED - Now handled by overlay) ---

// export function updatePlayHoleInfo(par, lengthYards, score) { ... }
// export function resetPlayHoleDisplay() { ... }
// export function showHoleOutMessage(score) { ... }


// --- Environment Display Update ---

// Helper function to get a wind direction arrow
function getWindArrow(direction) {
    // Normalize direction to 0-359.9 degrees
    const normalizedDir = ((direction % 360) + 360) % 360;
    // Determine the arrow based on 8 directions (N, NE, E, SE, S, SW, W, NW)
    if (normalizedDir >= 337.5 || normalizedDir < 22.5) return '↓'; // North (Down arrow - wind from North)
    if (normalizedDir >= 22.5 && normalizedDir < 67.5) return '↙'; // Northeast
    if (normalizedDir >= 67.5 && normalizedDir < 112.5) return '←'; // East
    if (normalizedDir >= 112.5 && normalizedDir < 157.5) return '↖'; // Southeast
    if (normalizedDir >= 157.5 && normalizedDir < 202.5) return '↑'; // South
    if (normalizedDir >= 202.5 && normalizedDir < 247.5) return '↗'; // Southwest
    if (normalizedDir >= 247.5 && normalizedDir < 292.5) return '→'; // West
    if (normalizedDir >= 292.5 && normalizedDir < 337.5) return '↘'; // Northwest
    return '?'; // Should not happen
}

/**
 * Updates the wind and temperature display in the UI overlay.
 */
function updateEnvironmentDisplay() {
    if (!overlayWindSpan || !overlayTempSpan) return; // Elements might not exist

    const windData = getWind();
    const temperatureData = getTemperature();

    const windSpeedText = windData.speed.toFixed(1);
    const windArrow = getWindArrow(windData.direction);
    const windDisplayText = `${windSpeedText} m/s ${windArrow}`;

    const tempDisplayText = `${temperatureData.toFixed(0)}°C`;

    // Update the DOM (only if text has changed to avoid unnecessary reflows)
    if (overlayWindSpan.textContent !== windDisplayText) {
        overlayWindSpan.textContent = windDisplayText;
    }
    if (overlayTempSpan.textContent !== tempDisplayText) {
        overlayTempSpan.textContent = tempDisplayText;
    }
}

// Start the periodic update for the environment display
// Update interval (e.g., 5 times per second)
// Consider moving this to main.js if it's better controlled there
if (overlayWindSpan && overlayTempSpan) { // Only run if elements exist
    setInterval(updateEnvironmentDisplay, 200);
}


// Remove initial setup calls from here; they will be called explicitly from main.js
// populateClubSelect();
// setupBackswingBar();


// --- Measurement Distance Label Functions ---

const distanceLabelContainer = document.body; // Or a more specific container if available
const distanceLabelClass = 'measurement-distance-label'; // CSS class for styling

/**
 * Creates or updates an HTML element to display distance text at a specific screen position.
 * @param {string} id - Unique ID for the label element (e.g., 'dist-label-ball-click').
 * @param {string} text - The text content (e.g., '150.5 yd').
 * @param {number} screenX - The X coordinate on the screen.
 * @param {number} screenY - The Y coordinate on the screen.
 */
export function createOrUpdateDistanceLabel(id, text, screenX, screenY) {
    let labelElement = document.getElementById(id);

    if (!labelElement) {
        labelElement = document.createElement('div');
        labelElement.id = id;
        labelElement.classList.add(distanceLabelClass);
        // Basic inline styles (consider moving to style.css)
        labelElement.style.position = 'absolute';
        labelElement.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        labelElement.style.color = 'white';
        labelElement.style.padding = '3px 6px';
        labelElement.style.borderRadius = '4px';
        labelElement.style.fontSize = '12px';
        labelElement.style.pointerEvents = 'none'; // Prevent interaction
        labelElement.style.whiteSpace = 'nowrap';
        labelElement.style.zIndex = '100'; // Ensure it's above the canvas
        distanceLabelContainer.appendChild(labelElement);
    }

    labelElement.textContent = text;
    // Position the label centered horizontally above the point, offset slightly vertically
    labelElement.style.left = `${screenX}px`;
    labelElement.style.top = `${screenY + 30}px`; // Adjust vertical offset as needed
    labelElement.style.transform = 'translateX(-50%)'; // Center horizontally
    labelElement.style.display = 'block'; // Ensure it's visible
}

/**
 * Removes a specific distance label element from the DOM.
 * @param {string} id - The ID of the label element to remove.
 */
export function removeDistanceLabel(id) {
    const labelElement = document.getElementById(id);
    if (labelElement) {
        labelElement.remove();
    }
}

/**
 * Hides all distance label elements by setting their display style to 'none'.
 */
export function hideAllDistanceLabels() {
    const labels = document.querySelectorAll(`.${distanceLabelClass}`);
    labels.forEach(label => {
        label.style.display = 'none';
    });
}

// --- View Switching Functions ---
export function showMainMenu() {
    if (mainMenuDiv) mainMenuDiv.style.display = 'flex'; // Or 'block' based on its CSS
    if (gameViewDiv) gameViewDiv.style.display = 'none';
    if (shotResultDiv) shotResultDiv.style.display = 'none'; // Ensure shot result is hidden
    console.log("UI: Switched to Main Menu");
}

export function showGameView() {
    if (mainMenuDiv) mainMenuDiv.style.display = 'none';
    if (gameViewDiv) gameViewDiv.style.display = 'block'; // Or 'flex'
    console.log("UI: Switched to Game View");
}

// --- Event Listener Setup for Menu Navigation ---
export function addBackToMenuClickListener(callback) {
    if (backToMenuButton) {
        backToMenuButton.addEventListener('click', () => {
            showMainMenu(); // Show main menu
            if (callback) callback(); // Call additional callback if provided (e.g., to reset game state)
        });
    }
}

// Initial state: Show main menu by default when script loads
// This might be better handled in main.js after all initializations
// showMainMenu();

// --- Event Listener for Show Details Button & Click-Outside-to-Close for Pop-up ---

// Function to hide the shot result pop-up and remove the global click listener
function hideShotResultPopup() {
    if (shotResultDiv) {
        shotResultDiv.style.display = 'none';
    }
    document.removeEventListener('click', handleClickOutsideShotResultPopup, true); // Use capture phase
}

// Global click listener function
function handleClickOutsideShotResultPopup(event) {
    if (shotResultDiv && shotResultDiv.style.display !== 'none') {
        // Check if the click is outside the shotResultDiv and not on the showDetailsButton
        if (!shotResultDiv.contains(event.target) && event.target !== showDetailsButton) {
            hideShotResultPopup();
        }
    }
}

if (showDetailsButton) {
    showDetailsButton.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent this click from being caught by the document listener immediately
        if (shotResultDiv) {
            shotResultDiv.style.display = 'block'; // Or 'flex'
            // Add the global click listener when the pop-up is shown
            // Use true for capture phase to catch clicks on other elements before they might stop propagation
            document.addEventListener('click', handleClickOutsideShotResultPopup, true);
        }
    });
}

// Modify the NextShotClickListener to also remove the global listener
export function addNextShotClickListener(callback) {
    nextShotButton.addEventListener('click', () => {
        hideShotResultPopup(); // This now also removes the global listener
        callback(); // Call original callback
    });
}
