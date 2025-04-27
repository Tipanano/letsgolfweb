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
const progressA = document.getElementById('progress-a');
const progressS = document.getElementById('progress-s');
const progressD = document.getElementById('progress-d');
const windowA = document.getElementById('window-a');
const windowS = document.getElementById('window-s');
const windowD = document.getElementById('window-d');
const markerA = document.getElementById('marker-a');
const markerS = document.getElementById('marker-s');
const markerD = document.getElementById('marker-d');

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

// --- Constants from gameLogic (will be passed in or imported if needed) ---
// These might be better managed within gameLogic or passed during initialization
const DOWNSWING_TIMING_BAR_DURATION_MS = 500;
const BACKSWING_BAR_MAX_DURATION_MS = 1500;
const IDEAL_BACKSWING_DURATION_MS = 1000;

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
    clubSelect.value = '7I'; // Set default selection
}

export function setupBackswingBar() {
    const idealPercent = (IDEAL_BACKSWING_DURATION_MS / BACKSWING_BAR_MAX_DURATION_MS) * 100;
    idealBackswingMarker.style.left = `${idealPercent}%`;
}

export function setupTimingBarWindows(swingSpeed) {
    const idealWindowWidthMs = 50 / swingSpeed;
    const idealArmsStart = 100 / swingSpeed;
    const idealRotationStart = 50 / swingSpeed;
    const idealWristsStart = 200 / swingSpeed;
    const effectiveDownswingDuration = DOWNSWING_TIMING_BAR_DURATION_MS / swingSpeed;

    const calculateWindow = (idealStart) => {
        const startMs = idealStart - idealWindowWidthMs / 2;
        const endMs = idealStart + idealWindowWidthMs / 2;
        const leftPercent = Math.max(0, (startMs / effectiveDownswingDuration) * 100);
        const rightPercent = Math.min(100, (endMs / effectiveDownswingDuration) * 100);
        const widthPercent = Math.max(0, rightPercent - leftPercent);
        return { left: leftPercent, width: widthPercent };
    };

    const winA = calculateWindow(idealArmsStart);
    const winS = calculateWindow(idealRotationStart);
    const winD = calculateWindow(idealWristsStart);

    windowA.style.left = `${winA.left}%`; windowA.style.width = `${winA.width}%`;
    windowS.style.left = `${winS.left}%`; windowS.style.width = `${winS.width}%`;
    windowD.style.left = `${winD.left}%`; windowD.style.width = `${winD.width}%`;
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

export function updateTimingBars(elapsedTime, swingSpeed) {
    const effectiveDownswingDuration = DOWNSWING_TIMING_BAR_DURATION_MS / swingSpeed;
    const progressPercent = Math.min(100, (elapsedTime / effectiveDownswingDuration) * 100);
    progressA.style.width = `${progressPercent}%`;
    progressS.style.width = `${progressPercent}%`;
    progressD.style.width = `${progressPercent}%`;
    return progressPercent; // Return progress to check if animation should stop
}

export function showKeyPressMarker(key, offset, swingSpeed) {
    const effectiveDownswingDuration = DOWNSWING_TIMING_BAR_DURATION_MS / swingSpeed;
    const markerPercent = Math.min(100, (offset / effectiveDownswingDuration) * 100);
    let markerElement;
    switch (key) {
        case 'a': markerElement = markerA; break;
        case 's': markerElement = markerS; break;
        case 'd': markerElement = markerD; break;
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
    progressBackswing.style.backgroundColor = '#28a745'; // Reset color
    progressA.style.width = '0%';
    progressS.style.width = '0%';
    progressD.style.width = '0%';
    markerA.style.display = 'none';
    markerS.style.display = 'none';
    markerD.style.display = 'none';
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

// Remove initial setup calls from here; they will be called explicitly from main.js
// populateClubSelect();
// setupBackswingBar();
