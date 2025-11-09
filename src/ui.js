import { clubs, defaultPlayerBag } from './clubs.js'; // Import club data and defaultPlayerBag
import { metersToYards, YARDS_TO_METERS } from './utils/unitConversions.js'; // Import conversion utilities
import { getWind, getTemperature, getCurrentShotType } from './gameLogic/state.js'; // Import environment state getters (Corrected Path)
import { toast } from './ui/toast.js';
import { modal } from './ui/modal.js';
import * as playHoleModal from './playHoleModal.js';
import { DEBUG_MODE } from './config.js'; // Import debug mode setting

// --- Initialize Debug Mode ---
// Apply debug-mode class to body if DEBUG_MODE is enabled
if (DEBUG_MODE) {
    document.body.classList.add('debug-mode');
}

// --- DOM Element References ---
// --- DOM Element References ---
// Views
const mainMenuDiv = document.getElementById('main-menu');
const gameViewDiv = document.getElementById('game-view');

// Buttons
const backToMenuButton = document.getElementById('back-to-menu-button');
const switchHoleButton = document.getElementById('switch-hole-button');
const fullscreenToggleBtn = document.getElementById('fullscreen-toggle-btn'); // Fullscreen button

// Fullscreen bar buttons
const fsExitFullscreenBtn = document.getElementById('fs-exit-fullscreen-btn');
const fsMenuBtn = document.getElementById('fs-menu-btn');
const fsSwitchHoleBtn = document.getElementById('fs-switch-hole-btn');
const fsResetDataBtn = document.getElementById('fs-reset-data-btn');


// Other UI Elements
const statusTextDisplay = document.getElementById('status-text-display'); // New top-center status
const nextShotButton = document.getElementById('next-shot-button');

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
// Impact data elements
const summaryClubspeedItem = document.getElementById('summary-clubspeed-item');
const summaryClubspeedSpan = document.getElementById('summary-clubspeed');
const summaryBallspeedItem = document.getElementById('summary-ballspeed-item');
const summaryBallspeedSpan = document.getElementById('summary-ballspeed');
const summarySmashfactorItem = document.getElementById('summary-smashfactor-item');
const summarySmashfactorSpan = document.getElementById('summary-smashfactor');
const summaryBackspinItem = document.getElementById('summary-backspin-item');
const summaryBackspinSpan = document.getElementById('summary-backspin');
const summarySidespinItem = document.getElementById('summary-sidespin-item');
const summarySidespinSpan = document.getElementById('summary-sidespin');
const summaryLaunchAngleItem = document.getElementById('summary-launch-angle-item');
const summaryLaunchAngleSpan = document.getElementById('summary-launch-angle');
// Landing/Final data elements
const summaryPeakHeightItem = document.getElementById('summary-peak-height-item');
const summaryPeakHeightSpan = document.getElementById('summary-peak-height');
const summaryCarryItem = document.getElementById('summary-carry-item');
const summaryCarrySpan = document.getElementById('summary-carry');
const summaryRollItem = document.getElementById('summary-roll-item');
const summaryRollSpan = document.getElementById('summary-roll');
const summaryTotalItem = document.getElementById('summary-total-item');
const summaryTotalSpan = document.getElementById('summary-total');
const summaryMessageItem = document.getElementById('summary-message-item');
const summaryMessageSpan = document.getElementById('summary-message');
const showDetailsButton = document.getElementById('show-details-button');



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
const BACKSWING_BAR_MAX_DURATION_CHIP_PUTT_MS = 2000; // Slower for chips and putts - easier timing
const IDEAL_BACKSWING_DURATION_MS = 1150; // Match physics (swingPhysics.js)
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
    if (statusTextDisplay) {
        if (text.toLowerCase().includes("next shot")) {
            statusTextDisplay.textContent = "'n' for next shot";
        } else if (text.toLowerCase().includes("ready")) {
            statusTextDisplay.textContent = "Ready...";
        } else {
            statusTextDisplay.textContent = text; // Fallback for other statuses
        }
    }
}

// Store the currently selected club (for fullscreen controls)
let selectedClubKey = null;
let onClubChangeCallback = null; // To store the callback for club changes

export function createClubButtons(gameMode = null) {
    // Populate fullscreen club grid inline (can't call initFSClubSelection before it's defined)
    const fsClubGrid = document.getElementById('fs-club-grid');
    const fsClubValue = document.getElementById('fs-club-value');

    if (fsClubGrid) {
        fsClubGrid.innerHTML = '';

        // Get club list based on game mode
        const currentMode = gameMode || (window.getCurrentGameMode ? window.getCurrentGameMode() : null);
        const displayClubKeys = (currentMode === 'range')
            ? Object.keys(clubs).filter(key => key !== 'PT')
            : defaultPlayerBag;

        displayClubKeys.forEach(clubKey => {
            const club = clubs[clubKey];
            if (!club) return;

            const fsBtn = document.createElement('button');
            fsBtn.className = 'fs-club-btn';
            fsBtn.textContent = club.name.length > 6 ? clubKey : club.name;
            fsBtn.dataset.clubKey = clubKey;

            fsBtn.addEventListener('click', () => {
                // Update selection
                selectedClubKey = clubKey;
                fsClubGrid.querySelectorAll('.fs-club-btn').forEach(b => b.classList.remove('selected'));
                fsBtn.classList.add('selected');
                if (fsClubValue) fsClubValue.textContent = fsBtn.textContent;

                // Call the club change callback
                if (onClubChangeCallback) {
                    onClubChangeCallback(clubKey);
                }

                closeFSPanels();
            });

            fsClubGrid.appendChild(fsBtn);
        });

        // Set default club selection
        const defaultClubToSelect = displayClubKeys.includes('I7') ? 'I7' : displayClubKeys[0];
        if (defaultClubToSelect) {
            selectedClubKey = defaultClubToSelect;

            const defaultBtn = fsClubGrid.querySelector(`.fs-club-btn[data-club-key="${defaultClubToSelect}"]`);
            if (defaultBtn) {
                defaultBtn.classList.add('selected');
                if (fsClubValue && clubs[defaultClubToSelect]) {
                    const club = clubs[defaultClubToSelect];
                    fsClubValue.textContent = club.name.length > 6 ? defaultClubToSelect : club.name;
                }
            }

            // Trigger the callback
            if (onClubChangeCallback) {
                onClubChangeCallback(defaultClubToSelect);
            }
        }
    }
}

export function setupBackswingBar(shotType = 'full') {
    // Use appropriate max duration based on shot type
    const baseDuration = (shotType === 'chip' || shotType === 'putt') ? BACKSWING_BAR_MAX_DURATION_CHIP_PUTT_MS : BACKSWING_BAR_MAX_DURATION_MS;
    const idealPercent = (IDEAL_BACKSWING_DURATION_MS / baseDuration) * 100;
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

}

export function updateBackswingBar(elapsedTime, swingSpeed, shotType = 'full') {
    // Use longer duration for chip/putt (2000ms) to make timing easier
    const baseDuration = (shotType === 'chip' || shotType === 'putt') ? BACKSWING_BAR_MAX_DURATION_CHIP_PUTT_MS : BACKSWING_BAR_MAX_DURATION_MS;
    const effectiveBackswingDuration = baseDuration / swingSpeed;
    const progressPercent = Math.min(100, (elapsedTime / effectiveBackswingDuration) * 100);
    progressBackswing.style.width = `${progressPercent}%`;

    const idealDurationAdjusted = IDEAL_BACKSWING_DURATION_MS / swingSpeed;
    const maxDurationAdjusted = baseDuration / swingSpeed;

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
export function updateChipTimingBars(elapsedTime, backswingDuration) {
    // Chip downswing duration should match backswing for ideal timing visualization
    // Use backswing duration + buffer to ensure we show full progress
    const effectiveChipDownswingDuration = Math.max(backswingDuration * 1.5, 1000); // At least 1000ms, or 1.5x backswing
    const progressPercent = Math.min(100, (elapsedTime / effectiveChipDownswingDuration) * 100);
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
    
    // Convert distances from meters to yards for display
    const peakHeightYards = resultData.peakHeight ? metersToYards(resultData.peakHeight) : undefined;
    const carryDistanceYards = resultData.carryDistance ? metersToYards(resultData.carryDistance) : undefined;
    const rolloutDistanceYards = resultData.rolloutDistance ? metersToYards(resultData.rolloutDistance) : undefined;
    const totalDistanceYards = resultData.totalDistance ? metersToYards(resultData.totalDistance) : undefined;
    
    peakHeightText.textContent = formatNum(peakHeightYards, 1);
    carryDistanceText.textContent = formatNum(carryDistanceYards, 1);
    // Added rollout and total distance display
    rolloutDistanceText.textContent = formatNum(rolloutDistanceYards, 1);
    totalDistanceText.textContent = formatNum(totalDistanceYards, 1);
    launchAngleText.textContent = formatNum(resultData.launchAngle, 1); // Added Launch Angle display

    // Show impact data immediately in shot summary widget
    showShotImpactData(resultData, formatNum);

    // Populate all data for later progressive display
    if (shotSummaryWidget) {
        if (summaryPeakHeightSpan) summaryPeakHeightSpan.textContent = formatNum(peakHeightYards, 1);
        if (summaryCarrySpan) summaryCarrySpan.textContent = formatNum(carryDistanceYards, 1);
        if (summaryRollSpan) summaryRollSpan.textContent = formatNum(rolloutDistanceYards, 1);
        if (summaryTotalSpan) summaryTotalSpan.textContent = formatNum(totalDistanceYards, 1);
        if (summaryMessageSpan) summaryMessageSpan.textContent = resultData.message || 'N/A';
    }

    // DO NOT show the full shot result pop-up here automatically
    // if (shotResultDiv) {
    //     shotResultDiv.style.display = 'block';
    // }
}

// Show impact data immediately when shot is hit
function showShotImpactData(resultData, formatNum) {
    if (!shotSummaryWidget) return;

    // Hide all items first
    hideAllShotSummaryItems();

    // Show widget with impact data
    shotSummaryWidget.style.display = 'block';

    // Show impact data
    if (summaryClubspeedItem && summaryClubspeedSpan) {
        summaryClubspeedSpan.textContent = formatNum(resultData.clubHeadSpeed, 1);
        summaryClubspeedItem.style.display = 'block';
    }
    if (summaryBallspeedItem && summaryBallspeedSpan) {
        summaryBallspeedSpan.textContent = formatNum(resultData.ballSpeed, 1);
        summaryBallspeedItem.style.display = 'block';
    }
    if (summarySmashfactorItem && summarySmashfactorSpan) {
        const smashFactor = resultData.clubHeadSpeed > 0 ? resultData.ballSpeed / resultData.clubHeadSpeed : 0;
        summarySmashfactorSpan.textContent = formatNum(smashFactor, 2);
        summarySmashfactorItem.style.display = 'block';
    }
    if (summaryBackspinItem && summaryBackspinSpan) {
        summaryBackspinSpan.textContent = formatNum(resultData.backSpin, 0);
        summaryBackspinItem.style.display = 'block';
    }
    if (summarySidespinItem && summarySidespinSpan) {
        summarySidespinSpan.textContent = formatNum(resultData.sideSpin, 0);
        summarySidespinItem.style.display = 'block';
    }
    if (summaryLaunchAngleItem && summaryLaunchAngleSpan) {
        summaryLaunchAngleSpan.textContent = formatNum(resultData.launchAngle, 1);
        summaryLaunchAngleItem.style.display = 'block';
    }
}

// Show carry distance when ball lands
export function showShotCarryData() {
    if (!shotSummaryWidget) return;
    if (summaryPeakHeightItem) summaryPeakHeightItem.style.display = 'block';
    if (summaryCarryItem) summaryCarryItem.style.display = 'block';
}

// Show final roll and total when ball stops
export function showShotFinalData() {
    if (!shotSummaryWidget) return;
    if (summaryRollItem) summaryRollItem.style.display = 'block';
    if (summaryTotalItem) summaryTotalItem.style.display = 'block';
    if (summaryMessageItem) summaryMessageItem.style.display = 'block';
}

// Hide all summary items (for reset)
function hideAllShotSummaryItems() {
    const items = [
        summaryClubspeedItem, summaryBallspeedItem, summarySmashfactorItem, summaryBackspinItem, summarySidespinItem,
        summaryLaunchAngleItem, summaryPeakHeightItem, summaryCarryItem, summaryRollItem,
        summaryTotalItem, summaryMessageItem
    ];
    items.forEach(item => {
        if (item) item.style.display = 'none';
    });
}

// Legacy function for compatibility
export function showShotSummaryWidget() {
    if (shotSummaryWidget) {
        shotSummaryWidget.style.display = 'block';
    }
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
// Ball position is now controlled via fullscreen stance panel (fs-stance-panel)

export function adjustBallPosition(delta) {
    const newIndex = currentBallPositionIndex + delta;
    currentBallPositionIndex = Math.max(0, Math.min(ballPositionLevels - 1, newIndex));
    // Update fullscreen visual
    updateFullscreenStancePosition();
}

export function setBallPosition(index) {
    currentBallPositionIndex = Math.max(0, Math.min(ballPositionLevels - 1, index));
    // Update fullscreen visual
    updateFullscreenStancePosition();
}

export function getBallPositionIndex() {
    return currentBallPositionIndex;
}

export function getBallPositionLevels() {
    return ballPositionLevels;
}

function updateFullscreenStancePosition() {
    const fsBallMarker = document.getElementById('fs-ball-marker');
    if (fsBallMarker) {
        const totalSegments = ballPositionLevels - 1;
        const positionPercent = 10 + ((totalSegments - currentBallPositionIndex) / totalSegments) * 80;
        fsBallMarker.style.top = `${positionPercent}%`;
    }
}

// --- Shot Type UI Functions ---
// Shot type is now controlled via fullscreen shot type panel (fs-shot-type-panel)

let currentShotType = 'full'; // Store current shot type

export function getShotType() {
    return currentShotType;
}

export function setShotTypeRadio(shotType) {
    currentShotType = shotType;
    // Update fullscreen display
    const fsShotTypeValue = document.getElementById('fs-shot-type-value');
    const fsShotTypeBtns = document.querySelectorAll('.fs-shot-type-btn');

    if (fsShotTypeValue) {
        fsShotTypeValue.textContent = shotType === 'full' ? 'Regular' : 'Chip';
    }

    fsShotTypeBtns.forEach(btn => {
        if (btn.dataset.type === shotType) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });

    // Update help button text
    updateHelpButtonText(shotType);
}

export function setSwingSpeedControlState(enabled) {
    const fsPowerSlider = document.getElementById('fs-power-slider');
    if (fsPowerSlider) {
        fsPowerSlider.disabled = !enabled;
    }
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

    // Fullscreen stance button visibility
    const fsStanceBtn = document.getElementById('fs-stance-btn');
    if (fsStanceBtn) {
        fsStanceBtn.style.display = (isFullSwing || isChip) ? '' : 'none';
    }

    // Ideal Backswing Marker Visibility: Show only for Full swing
    if (idealBackswingMarker) {
        idealBackswingMarker.style.display = isFullSwing ? '' : 'none';
    }

}

// New function specifically for updating the putt downswing timing bar (e.g., progressD)
// The visual fill rate is constant at 2000ms (matches physics PUTT_VISUAL_DURATION_MS).
export function updatePuttTimingBar(elapsedTime) {
    // Use 2000ms duration for easier timing (matches backswing bar duration for consistency)
    const PUTT_DOWNSWING_DURATION_MS = 2000;
    const progressPercent = Math.min(100, (elapsedTime / PUTT_DOWNSWING_DURATION_MS) * 100);
    // Update only the bar designated for putt downswing (progressD)
    progressD.style.width = `${progressPercent}%`;
    return progressPercent;
}

// Function to programmatically set the selected club button
export function setSelectedClubButton(clubKey) {
    selectedClubKey = clubKey;

    // Update fullscreen club display
    const fsClubValue = document.getElementById('fs-club-value');
    const fsClubGrid = document.getElementById('fs-club-grid');

    if (fsClubValue && clubs[clubKey]) {
        const club = clubs[clubKey];
        fsClubValue.textContent = club.name.length > 6 ? clubKey : club.name;
    }

    if (fsClubGrid) {
        fsClubGrid.querySelectorAll('.fs-club-btn').forEach(btn => {
            if (btn.dataset.clubKey === clubKey) {
                btn.classList.add('selected');
            } else {
                btn.classList.remove('selected');
            }
        });
    }
}

// Function to clear club selection
export function clearClubSelection() {
    selectedClubKey = null;

    const fsClubValue = document.getElementById('fs-club-value');
    if (fsClubValue) {
        fsClubValue.textContent = 'Select Club';
    }

    const fsClubGrid = document.getElementById('fs-club-grid');
    if (fsClubGrid) {
        fsClubGrid.querySelectorAll('.fs-club-btn').forEach(btn => btn.classList.remove('selected'));
    }
}

// Function to hide/show controls based on shot type
export function setPutterControlsVisibility(isPutter) {
    const isChipOrPutt = (currentShotType === 'chip' || currentShotType === 'putt');

    // Hide fullscreen shot type button when putter is selected
    const fsShotTypeBtn = document.getElementById('fs-shot-type-btn');
    if (fsShotTypeBtn) {
        fsShotTypeBtn.style.display = isPutter ? 'none' : '';
    }

    // Hide fullscreen power button when putter is selected OR when shot type is chip/putt
    const fsPowerBtn = document.getElementById('fs-power-btn');
    if (fsPowerBtn) {
        fsPowerBtn.style.display = (isPutter || isChipOrPutt) ? 'none' : '';
    }

    // Hide fullscreen stance button when putter is selected
    const fsStanceBtn = document.getElementById('fs-stance-btn');
    if (fsStanceBtn) {
        fsStanceBtn.style.display = isPutter ? 'none' : '';
    }
}

// Function to update control visibility based on shot type
export function updateControlsForShotType(shotType) {
    const isChipOrPutt = (shotType === 'chip' || shotType === 'putt');

    // Hide fullscreen power button for chip and putt
    const fsPowerBtn = document.getElementById('fs-power-btn');
    if (fsPowerBtn) {
        fsPowerBtn.style.display = isChipOrPutt ? 'none' : '';
    }
}

// --- Event Listener Setup ---
// We export functions to attach listeners from main.js
// This allows main.js to pass callbacks that interact with gameLogic

export function addSwingSpeedInputListener(callback) {
    // Store callback for use in initFSPowerSlider
    window._swingSpeedCallback = callback;
}

// --- Event Listener for Reset Game Data Button ---
export function addResetGameDataListener() {
    const resetButton = document.getElementById('reset-game-data-button');
    if (resetButton) {
        resetButton.addEventListener('click', async () => {
            const confirmed = await modal.confirm(
                'Are you sure you want to reload the page?',
                'Reload Page',
                'warning'
            );
            if (confirmed) {
                toast.info('Reloading the page...');
                setTimeout(() => window.location.reload(), 1000);
            }
        });
    } else {
        console.warn("UI: Reset Game Data button not found.");
    }
}

export function addClubChangeListener(callback) {
    onClubChangeCallback = callback;
}

export function addShotTypeChangeListener(callback) {
    // Fullscreen shot type buttons are initialized in initFSShotTypeSelection
    // Store the callback for use in that initialization
    window._shotTypeChangeCallback = callback;
}

export function setInitialSwingSpeedDisplay(percentage) {
    const fsPowerDisplay = document.getElementById('fs-power-display');
    const fsPowerValue = document.getElementById('fs-power-value');
    if (fsPowerDisplay) fsPowerDisplay.textContent = `${percentage}%`;
    if (fsPowerValue) fsPowerValue.textContent = `${percentage}%`;
}


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
    });
}


// --- NEW Visual Overlay UI Function ---

/**
 * Updates the text content of the elements within the visual info overlay.
 * @param {number | string} holeNum - The current hole number.
 * @param {number | string} par - The par for the current hole.
 * @param {number | string} distToFlag - The distance to the flag in meters.
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
    if (overlayLieSpan) overlayLieSpan.textContent = lie ? lie.toUpperCase() : '';

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
        // Convert from meters to yards if needed (check if distToFlag is already in yards)
        const distToFlagYards = (typeof distToFlag === 'number' && distToFlag > 0) ? metersToYards(distToFlag) : distToFlag;
        if (overlayDistFlagSpan) overlayDistFlagSpan.textContent = formatNum(distToFlagYards, 0);

        // Update Bottom Left (Play Hole)
        if (mode === 'play-hole') {
            if (overlayPlayerNameSpan) overlayPlayerNameSpan.textContent = playerName;
            if (overlayTotalScoreSpan) overlayTotalScoreSpan.textContent = formatScore(totalScore);
            if (overlayPositionSpan) overlayPositionSpan.textContent = position;
        }

    } else if (mode === 'range') {
        // Update Top Left (Range)
        // Convert from meters to yards if needed
        const lastShotDistYards = (typeof lastShotDist === 'number' && lastShotDist > 0) ? metersToYards(lastShotDist) : lastShotDist;
        if (overlayLastShotDistSpan) overlayLastShotDistSpan.textContent = formatNum(lastShotDistYards, 1);
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
export function updateEnvironmentDisplay() { // Added export
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
// createClubButtons(); // This will be called from main.js
// setupBackswingBar();


// --- Measurement Distance Label Functions ---

const distanceLabelContainer = document.body; // Or a more specific container if available
const distanceLabelClass = 'measurement-distance-label'; // CSS class for styling

/**
 * Creates or updates an HTML element to display distance text at a specific screen position.
 * @param {string} id - Unique ID for the label element (e.g., 'dist-label-ball-click').
 * @param {string|number} text - The text content (e.g., '150.5 yd' or a number in meters to be converted).
 * @param {number} screenX - The X coordinate on the screen.
 * @param {number} screenY - The Y coordinate on the screen.
 * @param {boolean} [convertToYards=true] - Whether to convert the text from meters to yards if it's a number.
 */
export function createOrUpdateDistanceLabel(id, text, screenX, screenY, convertToYards = true) {
    let labelElement = document.getElementById(id);
    let isNewElement = false;

    if (!labelElement) {
        isNewElement = true;
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
        labelElement.style.zIndex = '10000'; // Much higher z-index to ensure it's visible
        distanceLabelContainer.appendChild(labelElement);
    }

    // Convert to yards if text is a number and convertToYards is true
    let displayText = text;
    if (convertToYards && typeof text === 'number') {
        const yards = metersToYards(text);
        displayText = `${yards.toFixed(1)} yd`;
    }
    labelElement.textContent = displayText;
    // Position the label centered horizontally above the point, offset slightly vertically
    labelElement.style.left = `${screenX}px`;
    labelElement.style.top = `${screenY + 30}px`; // Adjust vertical offset as needed
    labelElement.style.transform = 'translateX(-50%)'; // Center horizontally
    labelElement.style.display = 'block'; // Ensure it's visible

    console.log(`${isNewElement ? '✨ Created' : '🔄 Updated'} label #${id}: "${displayText}" at (${screenX}, ${screenY + 30}), z-index: ${labelElement.style.zIndex}, display: ${labelElement.style.display}`);
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
export async function showMainMenu() {
    if (mainMenuDiv) mainMenuDiv.style.display = 'flex'; // Or 'block' based on its CSS
    if (gameViewDiv) gameViewDiv.style.display = 'none';
    if (shotResultDiv) shotResultDiv.style.display = 'none'; // Ensure shot result is hidden

    // Check for active multiplayer game and update menu accordingly
    await updateMultiplayerMenuState();
}

/**
 * Update the multiplayer section of the main menu based on active game status
 */
async function updateMultiplayerMenuState() {
    const multiplayerSection = document.getElementById('multiplayer-section');
    if (!multiplayerSection) return;

    try {
        // Dynamically import multiplayerManager to avoid circular deps
        const { checkForActiveGame } = await import('./multiplayerManager.js');
        const activeGameCheck = await checkForActiveGame();

        if (activeGameCheck.hasActiveGame) {
            // Player has an active game - show Resume/Leave buttons
            const session = activeGameCheck.session;
            const refundInfoHTML = session.refundInfo ? `
                <div style="background: ${session.refundInfo.canRefund ? '#d4edda' : '#f8d7da'}; padding: 6px 8px; border-radius: 4px; margin-top: 6px; font-size: 0.85em; border-left: 3px solid ${session.refundInfo.canRefund ? '#28a745' : '#dc3545'};">
                    <strong>Refund:</strong> ${session.refundInfo.refundReason}
                    ${session.refundInfo.prepaidBalance > 0 ? `<br><strong>Balance:</strong> ${session.refundInfo.prepaidBalance} NANO` : ''}
                </div>
            ` : '';

            multiplayerSection.innerHTML = `
                <strong>Multiplayer (Active Game)</strong><br>
                <div style="background: #fff3cd; padding: 8px; border-radius: 4px; margin: 8px 0; border-left: 3px solid #ffc107;">
                    <div style="font-size: 0.9em; margin-bottom: 6px;">
                        <strong>Room:</strong> ${session.roomCode}<br>
                        <strong>Status:</strong> ${session.gameState === 'waiting' ? 'In Lobby' : 'Playing'}<br>
                        <strong>Players:</strong> ${session.playerCount}
                        ${session.isWageringGame ? `<br><strong>Wager:</strong> ${session.wagerAmount} NANO` : ''}
                    </div>
                    ${refundInfoHTML}
                </div>
                <button id="resume-game-btn" style="background: #4CAF50; color: white;">Resume Game</button>
                <button id="leave-active-game-btn" style="background: #f44336; color: white;">Leave Game</button>
                <div id="connection-status" style="margin-top: 5px; font-size: 0.9em;">Active game found</div>
            `;

            // Add event listeners to new buttons
            const resumeBtn = document.getElementById('resume-game-btn');
            const leaveBtn = document.getElementById('leave-active-game-btn');

            if (resumeBtn) {
                resumeBtn.addEventListener('click', async () => {
                    const { resumeGame } = await import('./multiplayerManager.js');
                    await resumeGame(activeGameCheck.session);
                });
            }

            if (leaveBtn) {
                leaveBtn.addEventListener('click', async () => {
                    const { modal } = await import('./ui/modal.js');
                    const { toast } = await import('./ui/toast.js');

                    const message = activeGameCheck.session.isWageringGame
                        ? `Are you sure you want to leave this game?\n\nYou will forfeit the game${activeGameCheck.session.gameState === 'waiting' ? ' and be refunded your wager' : ' and lose your wager of ' + activeGameCheck.session.wagerAmount + ' NANO'}.`
                        : 'Are you sure you want to leave this game? You will forfeit the match.';

                    const confirmed = await modal.confirm(message, 'Leave Game', 'warning');

                    if (confirmed) {
                        const { handleLeaveActiveGameFromMenu } = await import('./multiplayerManager.js');
                        const success = await handleLeaveActiveGameFromMenu();
                        if (success) {
                            toast.success('Left the game');
                            // Refresh menu state
                            await updateMultiplayerMenuState();
                        }
                    }
                });
            }
        } else {
            // No active game - show normal Host/Join buttons
            multiplayerSection.innerHTML = `
                <strong>Multiplayer (Beta)</strong><br>
                <button id="test-connection-btn">Test Connection</button>
                <button id="host-game-btn">Host Game</button>
                <button id="join-game-btn">Join Game</button>
                <div id="connection-status" style="margin-top: 5px; font-size: 0.9em;">Not connected</div>
            `;

            // Re-initialize multiplayer buttons (they need to be re-attached)
            const { initMultiplayerUI } = await import('./multiplayerTest.js');
            initMultiplayerUI();
        }
    } catch (error) {
        console.error('Error updating multiplayer menu state:', error);
    }
}

export function showGameView() {
    if (mainMenuDiv) mainMenuDiv.style.display = 'none';
    if (gameViewDiv) gameViewDiv.style.display = 'block'; // Or 'flex'

    // Enter fullscreen by default
    if (!isFullscreen) {
        setTimeout(() => toggleFullscreen(), 100);
    }
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

// --- Fullscreen Toggle Functionality ---
let isFullscreen = false;

async function toggleFullscreen() {
    isFullscreen = !isFullscreen;

    if (isFullscreen) {
        document.body.classList.add('fullscreen-mode');
        if (fullscreenToggleBtn) {
            fullscreenToggleBtn.textContent = 'Exit Fullscreen';
        }
    } else {
        document.body.classList.remove('fullscreen-mode');
        if (fullscreenToggleBtn) {
            fullscreenToggleBtn.textContent = 'Fullscreen';
        }
    }

    // Wait for CSS transition/layout to complete, then trigger resize
    await new Promise(resolve => setTimeout(resolve, 100));

    // Import modules
    const [coreModule, visualsModule] = await Promise.all([
        import('./visuals/core.js'),
        import('./visuals.js')
    ]);

    // First update canvas/camera dimensions
    if (coreModule.onWindowResize) {
        coreModule.onWindowResize();
    }

    // Wait a bit for renderer to settle
    await new Promise(resolve => setTimeout(resolve, 50));

    // Then redraw the geometry with new dimensions
    if (visualsModule.redrawCurrentView) {
        visualsModule.redrawCurrentView();
    }

    // Initialize fullscreen controls if entering fullscreen
    if (isFullscreen) {
        setTimeout(initFullscreenControls, 100);
    }
}

// Add event listener for fullscreen button
if (fullscreenToggleBtn) {
    fullscreenToggleBtn.addEventListener('click', toggleFullscreen);
}

// Fullscreen bar button listeners
if (fsExitFullscreenBtn) {
    fsExitFullscreenBtn.addEventListener('click', toggleFullscreen);
}

if (fsMenuBtn) {
    fsMenuBtn.addEventListener('click', () => {
        // Exit fullscreen first, then go to menu
        if (isFullscreen) {
            toggleFullscreen();
        }
        showMainMenu();
        // Trigger the back to menu callback if set
        if (backToMenuButton) {
            backToMenuButton.click();
        }
    });
}

if (fsSwitchHoleBtn) {
    fsSwitchHoleBtn.addEventListener('click', () => {
        if (switchHoleButton) {
            switchHoleButton.click();
        }
    });
}

if (fsResetDataBtn) {
    fsResetDataBtn.addEventListener('click', () => {
        const resetButton = document.getElementById('reset-game-data-button');
        if (resetButton) {
            resetButton.click();
        }
    });
}

// --- Fullscreen Control Panels ---
const fsClubBtn = document.getElementById('fs-club-btn');
const fsShotTypeBtn = document.getElementById('fs-shot-type-btn');
const fsPowerBtn = document.getElementById('fs-power-btn');
const fsStanceBtn = document.getElementById('fs-stance-btn');

const fsClubPanel = document.getElementById('fs-club-panel');
const fsShotTypePanel = document.getElementById('fs-shot-type-panel');
const fsPowerPanel = document.getElementById('fs-power-panel');
const fsStancePanel = document.getElementById('fs-stance-panel');

let currentOpenPanel = null;

function closeFSPanels() {
    [fsClubPanel, fsShotTypePanel, fsPowerPanel, fsStancePanel].forEach(panel => {
        if (panel) panel.classList.remove('active');
    });
    currentOpenPanel = null;
}

function toggleFSPanel(panel) {
    if (currentOpenPanel === panel) {
        closeFSPanels();
    } else {
        closeFSPanels();
        panel.classList.add('active');
        currentOpenPanel = panel;
    }
}

// Close panels when clicking outside
document.addEventListener('click', (e) => {
    if (currentOpenPanel && !e.target.closest('.fs-control-panel') && !e.target.closest('.fs-control-btn')) {
        closeFSPanels();
    }
});

// Toggle panels on button click
if (fsClubBtn && fsClubPanel) {
    fsClubBtn.addEventListener('click', () => toggleFSPanel(fsClubPanel));
}
if (fsShotTypeBtn && fsShotTypePanel) {
    fsShotTypeBtn.addEventListener('click', () => toggleFSPanel(fsShotTypePanel));
}
if (fsPowerBtn && fsPowerPanel) {
    fsPowerBtn.addEventListener('click', () => toggleFSPanel(fsPowerPanel));
}
if (fsStanceBtn && fsStancePanel) {
    fsStanceBtn.addEventListener('click', () => toggleFSPanel(fsStancePanel));
}

// Initialize fullscreen club selection
function initFSClubSelection() {
    const fsClubGrid = document.getElementById('fs-club-grid');
    const fsClubValue = document.getElementById('fs-club-value');
    if (!fsClubGrid) return;

    // Clear existing buttons first
    fsClubGrid.innerHTML = '';

    // Get club list based on game mode
    const currentMode = window.getCurrentGameMode ? window.getCurrentGameMode() : null;
    const displayClubKeys = (currentMode === 'range')
        ? Object.keys(clubs).filter(key => key !== 'PT')
        : defaultPlayerBag;

    displayClubKeys.forEach(clubKey => {
        const club = clubs[clubKey];
        if (!club) return;

        const fsBtn = document.createElement('button');
        fsBtn.className = 'fs-club-btn';
        fsBtn.textContent = club.name.length > 6 ? clubKey : club.name;
        fsBtn.dataset.clubKey = clubKey;

        if (selectedClubKey === clubKey) {
            fsBtn.classList.add('selected');
            if (fsClubValue) fsClubValue.textContent = fsBtn.textContent;
        }

        fsBtn.addEventListener('click', () => {
            // Update selection
            selectedClubKey = clubKey;
            fsClubGrid.querySelectorAll('.fs-club-btn').forEach(b => b.classList.remove('selected'));
            fsBtn.classList.add('selected');
            if (fsClubValue) fsClubValue.textContent = fsBtn.textContent;

            // Call the club change callback
            if (onClubChangeCallback) {
                onClubChangeCallback(clubKey);
            }

            closeFSPanels();
        });

        fsClubGrid.appendChild(fsBtn);
    });
}

// Initialize fullscreen shot type selection
function initFSShotTypeSelection() {
    const fsShotTypeValue = document.getElementById('fs-shot-type-value');
    const fsShotTypeBtns = document.querySelectorAll('.fs-shot-type-btn');
    const callback = window._shotTypeChangeCallback;

    fsShotTypeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;

            // Update current shot type
            currentShotType = type;

            // Update display
            fsShotTypeBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            if (fsShotTypeValue) fsShotTypeValue.textContent = btn.textContent;

            // Call the shot type change callback
            if (callback) {
                callback(type);
            }

            closeFSPanels();
        });
    });

    // Set initial selection based on currentShotType
    const matchingBtn = document.querySelector(`.fs-shot-type-btn[data-type="${currentShotType}"]`);
    if (matchingBtn) {
        matchingBtn.classList.add('selected');
        if (fsShotTypeValue) fsShotTypeValue.textContent = matchingBtn.textContent;
    }
}

// Initialize fullscreen power slider
function initFSPowerSlider() {
    const fsPowerSlider = document.getElementById('fs-power-slider');
    const fsPowerDisplay = document.getElementById('fs-power-display');
    const fsPowerValue = document.getElementById('fs-power-value');
    const callback = window._swingSpeedCallback;

    if (fsPowerSlider) {
        // Set initial value
        fsPowerSlider.value = 90;
        if (fsPowerDisplay) fsPowerDisplay.textContent = '90%';
        if (fsPowerValue) fsPowerValue.textContent = '90%';

        // Call callback with initial value
        if (callback) {
            callback(90);
        }

        fsPowerSlider.addEventListener('input', () => {
            const value = parseInt(fsPowerSlider.value, 10);
            if (fsPowerDisplay) fsPowerDisplay.textContent = `${value}%`;
            if (fsPowerValue) fsPowerValue.textContent = `${value}%`;

            // Call the swing speed callback
            if (callback) {
                callback(value);
            }
        });
    }
}

// Initialize fullscreen stance control
function initFSStanceVisual() {
    const fsStanceVisual = document.getElementById('fs-stance-visual');
    const fsBallMarker = document.getElementById('fs-ball-marker');
    const fsStanceValue = document.getElementById('fs-stance-value');

    if (!fsStanceVisual || !fsBallMarker) return;

    // Sync initial position
    updateFullscreenStancePosition();
    updateStanceValueText();

    // Make the stance visual clickable
    fsStanceVisual.addEventListener('click', (e) => {
        const rect = fsStanceVisual.getBoundingClientRect();
        const clickY = e.clientY - rect.top;
        const percent = (clickY / rect.height) * 100;

        // Convert percent to ball position index
        // percent 10% = index 9 (Far Forward)
        // percent 90% = index 0 (Far Back)
        const totalSegments = ballPositionLevels - 1;
        const index = Math.round(totalSegments - ((percent - 10) / 80) * totalSegments);
        const clampedIndex = Math.max(0, Math.min(ballPositionLevels - 1, index));

        // Update ball position (this will update the visual via updateFullscreenStancePosition)
        setBallPosition(clampedIndex);
        updateStanceValueText();
    });

    function updateStanceValueText() {
        if (!fsStanceValue) return;
        const label = ballPositionLabels[currentBallPositionIndex];
        fsStanceValue.textContent = label;
    }
}

// Initialize all fullscreen controls when entering fullscreen
function initFullscreenControls() {
    initFSClubSelection();
    initFSShotTypeSelection();
    initFSPowerSlider();
    initFSStanceVisual();
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
        event.stopPropagation(); 
        if (shotResultDiv) {
            // Hide other popups if open
            hideBallPosInfoPopup();
            hideSwingSpeedInfoPopup();
            shotResultDiv.style.display = 'block'; 
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


// --- Switch Hole Button ---
if (switchHoleButton) {
    switchHoleButton.addEventListener('click', () => {
        // Open the play hole modal to select a different hole
        playHoleModal.showModal(async (holeData) => {
            // Hole selected - reinitialize the game mode with the new hole
            console.log('Hole selected from switch button:', holeData);

            // Import setGameMode and GAME_MODES from main.js
            const { setGameMode, GAME_MODES } = await import('./main.js');

            // Reinitialize play hole mode - this will load the new hole from localStorage
            await setGameMode(GAME_MODES.PLAY_HOLE);
        });
    });
}

// Fullscreen switch hole button - just clicks the main button
if (fsSwitchHoleBtn) {
    fsSwitchHoleBtn.addEventListener('click', () => {
        if (switchHoleButton) {
            switchHoleButton.click();
        }
    });
}

/**
 * Update switch hole button visibility/text based on game mode
 * @param {string} gameMode - Current game mode
 * @param {boolean} isMultiplayer - Whether in multiplayer mode
 */
export function updateSwitchHoleButton(gameMode, isMultiplayer = false) {
    if (!switchHoleButton) return;

    // For now, just show the button in play-hole mode
    if (gameMode === 'play-hole') {
        switchHoleButton.style.display = 'block';
        switchHoleButton.textContent = 'Switch Hole';
    } else {
        switchHoleButton.style.display = 'none';
    }
}

/**
 * Update player display in main menu
 * @param {string} playerName - The player's display name
 * @param {string} playerType - 'guest' or 'registered'
 */
export function updatePlayerDisplay(playerName, playerType = 'guest') {
    const playerNameElement = document.getElementById('player-name');
    const playerTypeBadge = document.getElementById('player-type-badge');
    const registerBtn = document.getElementById('register-btn-placeholder');
    const logoutBtn = document.getElementById('logout-btn');
    const profileBtn = document.getElementById('profile-btn');

    if (playerNameElement) {
        playerNameElement.textContent = playerName;
    }

    if (playerTypeBadge) {
        if (playerType === 'registered') {
            playerTypeBadge.textContent = 'REGISTERED';
            playerTypeBadge.style.backgroundColor = '#4CAF50';
            playerTypeBadge.style.color = 'white';
        } else {
            playerTypeBadge.textContent = 'GUEST';
            playerTypeBadge.style.backgroundColor = '#9E9E9E';
            playerTypeBadge.style.color = 'white';
        }
    }

    // Show/hide buttons based on player type
    if (registerBtn) {
        registerBtn.style.display = playerType === 'guest' ? 'inline-block' : 'none';
    }
    if (logoutBtn) {
        logoutBtn.style.display = playerType === 'registered' ? 'inline-block' : 'none';
    }
    if (profileBtn) {
        profileBtn.style.display = playerType === 'registered' ? 'inline-block' : 'none';
    }
}

// --- Shot Instructions Modal ---

const fsHelpBtn = document.getElementById('fs-help-btn');
const fsHelpBtnText = document.getElementById('fs-help-btn-text');
const shotInstructionsModal = document.getElementById('shot-instructions-modal');
const shotInstructionsTitle = document.getElementById('shot-instructions-title');
const fullSwingInstructions = document.getElementById('full-swing-instructions');
const chipInstructions = document.getElementById('chip-instructions');
const puttInstructions = document.getElementById('putt-instructions');
const closeShotInstructionsBtn = document.getElementById('close-shot-instructions-btn');

/**
 * Update the help button text based on the current shot type
 * @param {string} shotType - 'full', 'chip', or 'putt'
 */
export function updateHelpButtonText(shotType) {
    if (!fsHelpBtnText) return;

    switch (shotType) {
        case 'chip':
            fsHelpBtnText.textContent = 'How to Chip';
            break;
        case 'putt':
            fsHelpBtnText.textContent = 'How to Putt';
            break;
        case 'full':
        default:
            fsHelpBtnText.textContent = 'How to Swing';
            break;
    }
}

/**
 * Show the shot instructions modal based on the current shot type
 * @param {string} shotType - 'full', 'chip', or 'putt'
 */
function showShotInstructions(shotType) {
    if (!shotInstructionsModal) return;

    // Hide all instruction sections
    if (fullSwingInstructions) fullSwingInstructions.style.display = 'none';
    if (chipInstructions) chipInstructions.style.display = 'none';
    if (puttInstructions) puttInstructions.style.display = 'none';

    // Show the appropriate section and update title
    switch (shotType) {
        case 'chip':
            if (shotInstructionsTitle) shotInstructionsTitle.textContent = 'How to Chip';
            if (chipInstructions) chipInstructions.style.display = 'block';
            break;
        case 'putt':
            if (shotInstructionsTitle) shotInstructionsTitle.textContent = 'How to Putt';
            if (puttInstructions) puttInstructions.style.display = 'block';
            break;
        case 'full':
        default:
            if (shotInstructionsTitle) shotInstructionsTitle.textContent = 'How to Swing';
            if (fullSwingInstructions) fullSwingInstructions.style.display = 'block';
            break;
    }

    // Show the modal
    shotInstructionsModal.style.display = 'flex';
}

/**
 * Hide the shot instructions modal
 */
function hideShotInstructions() {
    if (shotInstructionsModal) {
        shotInstructionsModal.style.display = 'none';
    }
}

// Event listeners for help button and modal
if (fsHelpBtn) {
    fsHelpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentType = getShotType();
        showShotInstructions(currentType);
    });
}

if (closeShotInstructionsBtn) {
    closeShotInstructionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideShotInstructions();
    });
}

// Close modal when clicking outside of it
if (shotInstructionsModal) {
    shotInstructionsModal.addEventListener('click', (e) => {
        if (e.target === shotInstructionsModal) {
            hideShotInstructions();
        }
    });
}
