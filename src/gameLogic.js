import { clubs } from './clubs.js';
// Import specific UI functions needed
import { adjustBallPosition, getBallPositionIndex, getBallPositionLevels, setBallPosition, markHipInitiationOnBackswingBar, resetUIForNewShot, setupTimingBarWindows, updateStatus, resetUI, updateBackswingBar, updateTimingBars, updateChipTimingBars, showKeyPressMarker, updateResultDisplay, updateDebugTimingInfo, getShotType, setSwingSpeedControlState, updateTimingBarVisibility } from './ui.js'; // Added updateChipTimingBars, getShotType, setSwingSpeedControlState, updateTimingBarVisibility
import * as visuals from './visuals.js'; // Import visuals main module
// Import specific camera functions from core visuals
import { resetCameraPosition, setCameraForChipView, setCameraForPuttView } from './visuals/core.js';
import { calculateImpactPhysics } from './swingPhysics.js'; // Import the new physics calculation module
import { calculateChipImpact } from './chipPhysics.js'; // Import the new chip physics module

// --- Constants ---
const DOWNSWING_TIMING_BAR_DURATION_MS = 500;
const BACKSWING_BAR_MAX_DURATION_MS = 1500;
const IDEAL_BACKSWING_DURATION_MS = 1000;

// --- Game State ---
let gameState = 'ready'; // ready, backswing, backswingPausedAtTop, downswingWaiting, calculating, result, chipDownswingWaiting, calculatingChip
let currentShotType = 'full'; // 'full', 'chip', 'putt'
let swingSpeed = 1.0; // Base speed factor (0.3 to 1.0) - Only for 'full' swing
let selectedClub = clubs['7I']; // Default club

// --- Timing Variables ---
let backswingStartTime = null;
let backswingEndTime = null;
let backswingDuration = null;
let rotationInitiationTime = null;
let armsStartTime = null;
let wristsStartTime = null;
let rotationStartTime = null; // Full swing rotation start
let hipInitiationTime = null; // Added

// Chip Timing Variables
let chipRotationStartTime = null;
let chipWristsStartTime = null;

// --- Animation Frame IDs ---
let backswingAnimationFrameId = null;
let fullDownswingAnimationFrameId = null; // Renamed for clarity
let chipDownswingAnimationFrameId = null; // Added for chip
let downswingPhaseStartTime = null; // Common start time for downswing phase

// Callback for when shot calculation is complete
let onShotCompleteCallback = null;

// --- Initialization ---
export function initializeGameLogic() {
    // Initial swing speed setup is handled by UI calling setSwingSpeed
    resetSwingState();
    console.log("Game Logic Initialized.");
}

// Function for main.js to register its handler
export function registerShotCompletionCallback(callback) {
    if (typeof callback === 'function') {
        onShotCompleteCallback = callback;
        console.log("Shot completion callback registered.");
    } else {
        console.error("Attempted to register invalid shot completion callback.");
    }
}


// --- State Management ---
export function setSwingSpeed(percentage) {
    swingSpeed = percentage / 100;
    setupTimingBarWindows(swingSpeed); // Update UI windows when speed changes
    console.log(`Logic Swing Speed set to: ${percentage}% (Multiplier: ${swingSpeed.toFixed(2)})`);
}

export function setSelectedClub(clubKey) {
    selectedClub = clubs[clubKey];
    console.log(`Logic Club set to: ${selectedClub.name}`);

    // Set the default ball position for the selected club
    if (selectedClub && selectedClub.defaultBallPositionIndex !== undefined) {
        setBallPosition(selectedClub.defaultBallPositionIndex);
    } else {
        // Fallback if property is missing (optional, could default to center)
        console.warn(`Club ${clubKey} missing defaultBallPositionIndex. Setting to center.`);
        setBallPosition(Math.floor(getBallPositionLevels() / 2)); // Default to center index
    }
}

// New function to set the shot type
export function setShotType(type) {
    if (currentShotType === type) return; // No change

    console.log(`Logic Shot Type set to: ${type}`);
    currentShotType = type;

    // Enable/disable swing speed slider based on type
    const isFullSwing = (type === 'full');
    setSwingSpeedControlState(isFullSwing);

    // Update visibility of timing bars based on shot type
    updateTimingBarVisibility(type);

    // Update camera position based on shot type
    switch (type) {
        case 'chip':
            setCameraForChipView();
            break;
        case 'putt':
            setCameraForPuttView();
            break;
        case 'full':
        default:
            resetCameraPosition(); // Use default range view camera
            break;
    }

    // Reset swing state when changing type
    resetSwingState();
}


function resetSwingState() {
    gameState = 'ready';
    backswingStartTime = null;
    backswingEndTime = null;
    backswingDuration = null;
    rotationInitiationTime = null;
    armsStartTime = null; // Full swing
    wristsStartTime = null; // Full swing
    rotationStartTime = null; // Full swing
    hipInitiationTime = null; // Full swing reset
    chipRotationStartTime = null; // Chip reset
    chipWristsStartTime = null; // Chip reset

    // Stop animations if still running
    if (backswingAnimationFrameId) cancelAnimationFrame(backswingAnimationFrameId);
    if (fullDownswingAnimationFrameId) cancelAnimationFrame(fullDownswingAnimationFrameId); // Use renamed ID
    if (chipDownswingAnimationFrameId) cancelAnimationFrame(chipDownswingAnimationFrameId); // Stop chip animation too
    backswingAnimationFrameId = null;
    fullDownswingAnimationFrameId = null; // Use renamed ID
    chipDownswingAnimationFrameId = null; // Reset chip animation ID
    downswingPhaseStartTime = null;

    resetUIForNewShot(); // Use the new reset function that preserves ball position
    visuals.resetVisuals(); // Reset visuals (e.g., ball position)
    console.log("Swing state reset (preserving ball position).");
}

// --- Input Handling Callbacks (to be called by main.js) ---
export function handleKeyDown(event) {
    // Explicitly log state just before checking keys
    console.log(`handleKeyDown Check: Key='${event.key}', State='${gameState}', ShotType='${currentShotType}'`);

    // Adjust Ball Position with Arrow Keys (always allowed when ready, regardless of shot type)
    if (gameState === 'ready') {
        if (event.key === 'ArrowUp') {
            event.preventDefault(); // Prevent page scrolling
            adjustBallPosition(1); // Move ball forward (higher index)
            return; // Don't process other keys if adjusting position
        } else if (event.key === 'ArrowDown') {
            event.preventDefault(); // Prevent page scrolling
            adjustBallPosition(-1); // Move ball backward (lower index)
            return; // Don't process other keys if adjusting position
        }
    }

    // --- Full Swing Logic ---
    if (currentShotType === 'full') {
        // Start Backswing with 'w' key
        if (event.key === 'w' && gameState === 'ready') {
            console.log("Full Swing: 'w' pressed in ready state - starting backswing");
            gameState = 'backswing';
            backswingStartTime = performance.now();
            updateStatus('Backswing...');
            resetUIForNewShot(); // Use the reset function that preserves ball position

            // Start backswing bar animation
            if (backswingAnimationFrameId) cancelAnimationFrame(backswingAnimationFrameId);
            backswingAnimationFrameId = requestAnimationFrame(updateBackswingBarAnimation);
        }

        // Trigger reset with 'n' key when in result state
        if (event.key === 'n' && gameState === 'result') {
            console.log("Full Swing: 'n' pressed in result state - resetting");
            resetSwingState();
        }

        // Capture 'a' press during backswing for early rotation/transition
        if (event.key === 'a' && gameState === 'backswing' && !rotationInitiationTime) {
            rotationInitiationTime = performance.now();
            console.log("Full Swing: 'a' pressed during backswing (early rotation)");
        }

        // Capture 'j' press (Hip Initiation)
        if (event.key === 'j' && (gameState === 'backswing' || gameState === 'backswingPausedAtTop') && !hipInitiationTime) {
            hipInitiationTime = performance.now();
            console.log(`Full Swing: 'j' (Hips) pressed at ${hipInitiationTime.toFixed(0)}ms. State: ${gameState}`);
            updateStatus("Hips Initiated...");
            markHipInitiationOnBackswingBar();

            // If paused at top, pressing 'j' starts the downswing phase immediately
            if (gameState === 'backswingPausedAtTop') {
                gameState = 'downswingWaiting';
                updateStatus('Downswing: Press a, d, i...');
                console.log("Full Swing: Transitioning from Paused to DownswingWaiting due to 'j' press.");
                downswingPhaseStartTime = performance.now(); // Set common downswing start time
                if (fullDownswingAnimationFrameId) cancelAnimationFrame(fullDownswingAnimationFrameId); // Use renamed ID
                fullDownswingAnimationFrameId = requestAnimationFrame(updateFullDownswingBarsAnimation); // Use renamed animation function
                updateDebugTimingInfo(getDebugTimingData());
            }
        }

        // Capture downswing sequence keys *only if hips have been initiated*
        if (gameState === 'downswingWaiting' && hipInitiationTime) {
            const timeNow = performance.now();
            const offset = timeNow - backswingEndTime; // Offset relative to backswing end

            // Check keys in the sequence: a (rotation), d (arms), i (wrists)
            if (event.key === 'd' && !armsStartTime) { // 'd' controls Arms
                armsStartTime = timeNow;
                showKeyPressMarker('d', offset, swingSpeed);
                updateDebugTimingInfo(getDebugTimingData());
                console.log(`Full Swing: 'd' (Arms) pressed at offset: ${offset.toFixed(0)} ms`);
            } else if (event.key === 'i' && !wristsStartTime) { // 'i' controls Wrists
                wristsStartTime = timeNow;
                showKeyPressMarker('i', offset, swingSpeed);
                updateDebugTimingInfo(getDebugTimingData());
                console.log(`Full Swing: 'i' (Wrists) pressed at offset: ${offset.toFixed(0)} ms`);
            } else if (event.key === 'a' && !rotationStartTime && !rotationInitiationTime) { // 'a' controls Rotation
                rotationStartTime = timeNow;
                showKeyPressMarker('a', offset, swingSpeed);
                updateDebugTimingInfo(getDebugTimingData());
                console.log(`Full Swing: 'a' (Rotation) pressed post-backswing at offset: ${offset.toFixed(0)} ms`);
            }

            // Check if all required downswing keys are pressed
            if (armsStartTime && wristsStartTime && (rotationInitiationTime || rotationStartTime)) {
                calculateFullSwingShot(); // Renamed calculation function
            }
        }
    }
    // --- Chip Shot Logic ---
    else if (currentShotType === 'chip') {
        // Start Backswing with 'w' key
        if (event.key === 'w' && gameState === 'ready') {
            console.log("Chip: 'w' pressed in ready state - starting backswing");
            gameState = 'backswing'; // Use same state for backswing bar
            backswingStartTime = performance.now();
            updateStatus('Chip Backswing...');
            resetUIForNewShot();

            // Start backswing bar animation (using existing function, swingSpeed=1 for chip?)
            // For chip, swingSpeed doesn't apply, so pass 1.0? Or modify updateBackswingBar?
            // Let's assume updateBackswingBar can handle swingSpeed=1.0 for now.
            if (backswingAnimationFrameId) cancelAnimationFrame(backswingAnimationFrameId);
            backswingAnimationFrameId = requestAnimationFrame(updateBackswingBarAnimation);
        }

        // Trigger reset with 'n' key when in result state
        if (event.key === 'n' && gameState === 'result') {
            console.log("Chip: 'n' pressed in result state - resetting");
            resetSwingState();
        }

        // Capture chip downswing keys ('a', then 'i') *after* downswing has started
        if (gameState === 'chipDownswingWaiting' && downswingPhaseStartTime) {
            const timeNow = performance.now();
            const offset = timeNow - downswingPhaseStartTime; // Offset relative to chip downswing start

            // Chip uses 'a' for rotation start
            if (event.key === 'a' && !chipRotationStartTime) {
                chipRotationStartTime = timeNow;
                // Use 'a' marker (rotation) and 'i' marker (wrists/hit) from UI
                showKeyPressMarker('a', offset, 1.0); // Show marker relative to downswing start (use speed 1.0 for chip duration)
                updateStatus('Chip: Rotation...');
                console.log(`Chip: 'a' (Rotation) pressed at offset ${offset.toFixed(0)} ms`);
                // updateDebugTimingInfo(getDebugTimingData()); // Need chip-specific debug info
            }
            // Chip uses 'i' for hit/wrists, must be after 'a'
            else if (event.key === 'i' && chipRotationStartTime && !chipWristsStartTime) {
                chipWristsStartTime = timeNow;
                showKeyPressMarker('i', offset, 1.0); // Show marker relative to downswing start (use speed 1.0 for chip duration)
                console.log(`Chip: 'i' (Hit) pressed at offset ${offset.toFixed(0)} ms`);
                // updateDebugTimingInfo(getDebugTimingData());

                // Stop the chip animation loop
                if (chipDownswingAnimationFrameId) cancelAnimationFrame(chipDownswingAnimationFrameId);
                chipDownswingAnimationFrameId = null;

                gameState = 'calculatingChip'; // Set state BEFORE calling calculation
                calculateChipShot(); // Trigger chip calculation
            }
        }
    }
    // --- Putt Shot Logic (Placeholder) ---
    else if (currentShotType === 'putt') {
        // TODO: Implement putt key handling
    }
}

export function handleKeyUp(event) {
    console.log(`gameLogic keyup: ${event.key}, gameState: ${gameState}, ShotType='${currentShotType}'`); // Log function call and state

    // --- Full Swing Logic ---
    if (currentShotType === 'full') {
        // End Backswing with 'w' key release
        if (event.key === 'w' && gameState === 'backswing') {
            console.log("Full Swing: 'w' released in backswing state - ending backswing");
            backswingEndTime = performance.now();
            backswingDuration = backswingEndTime - backswingStartTime;

            // Stop backswing bar animation
            if (backswingAnimationFrameId) cancelAnimationFrame(backswingAnimationFrameId);
            backswingAnimationFrameId = null;

            // Decide next state based on whether 'j' was pressed during backswing
            if (hipInitiationTime) {
                // Hips already initiated, go straight to downswing waiting
                gameState = 'downswingWaiting';
                updateStatus('Downswing: Press a, d, i...');
                console.log(`Full Swing: Backswing ended. Hips initiated. Duration: ${backswingDuration.toFixed(0)} ms. Waiting for a, d, i.`);
                downswingPhaseStartTime = performance.now(); // Set common downswing start time
                if (fullDownswingAnimationFrameId) cancelAnimationFrame(fullDownswingAnimationFrameId); // Use renamed ID
                fullDownswingAnimationFrameId = requestAnimationFrame(updateFullDownswingBarsAnimation); // Use renamed animation function
            } else {
                // Hips not initiated yet, pause at the top
                gameState = 'backswingPausedAtTop';
                updateStatus("Paused at Top... Press 'j' to start downswing");
                console.log(`Full Swing: Backswing ended. Hips NOT initiated. Duration: ${backswingDuration.toFixed(0)} ms. Paused.`);
            }
            updateDebugTimingInfo(getDebugTimingData()); // Update debug display
        }
    }
    // --- Chip Shot Logic ---
    else if (currentShotType === 'chip') {
        // End Backswing with 'w' key release
        if (event.key === 'w' && gameState === 'backswing') {
            console.log("Chip: 'w' released in backswing state - ending backswing");
            backswingEndTime = performance.now();
            backswingDuration = backswingEndTime - backswingStartTime;

            console.log(`Chip: Backswing ended. Duration: ${backswingDuration.toFixed(0)} ms`);

            // Stop backswing bar animation
            if (backswingAnimationFrameId) cancelAnimationFrame(backswingAnimationFrameId);
            backswingAnimationFrameId = null;

            // Transition to waiting for chip inputs AND start the downswing phase
            gameState = 'chipDownswingWaiting';
            downswingPhaseStartTime = performance.now(); // Start chip downswing phase NOW
            updateStatus('Chip: Press a (rotate), then i (hit)');
            console.log(`Chip: Backswing ended. Duration: ${backswingDuration.toFixed(0)} ms. Starting downswing phase. Waiting for a, i.`);

            // Start chip timing bar animation
            if (chipDownswingAnimationFrameId) cancelAnimationFrame(chipDownswingAnimationFrameId);
            chipDownswingAnimationFrameId = requestAnimationFrame(updateChipDownswingBarsAnimation);

            // updateDebugTimingInfo(getDebugTimingData()); // Need chip-specific debug info
        }
    }
     // --- Putt Shot Logic (Placeholder) ---
    else if (currentShotType === 'putt') {
        // TODO: Implement putt key handling
    }
}

// --- Animation Loops ---
function updateBackswingBarAnimation(timestamp) {
    if (gameState !== 'backswing' || !backswingStartTime) {
        backswingAnimationFrameId = null;
        return;
    }
    const elapsedTime = timestamp - backswingStartTime;
    // Use current swingSpeed for full, assume 1.0 for chip/putt? Or pass explicitly?
    const speedForBar = (currentShotType === 'full') ? swingSpeed : 1.0;
    updateBackswingBar(elapsedTime, speedForBar); // Call UI update function
    backswingAnimationFrameId = requestAnimationFrame(updateBackswingBarAnimation);
}

// Renamed animation loop for full swing
function updateFullDownswingBarsAnimation(timestamp) {
    // Only run if it's a full swing in the correct state
    if (currentShotType !== 'full' || gameState !== 'downswingWaiting' || !downswingPhaseStartTime) {
        fullDownswingAnimationFrameId = null; // Use renamed ID
        return;
    }
    const elapsedTime = timestamp - downswingPhaseStartTime;
    const progressPercent = updateTimingBars(elapsedTime, swingSpeed); // Call UI update for full swing bars

    if (progressPercent < 100) {
        fullDownswingAnimationFrameId = requestAnimationFrame(updateFullDownswingBarsAnimation); // Use renamed ID
    } else {
        // Bars filled up - Timeout
        fullDownswingAnimationFrameId = null; // Use renamed ID
        console.log("Full Swing: Downswing timing bars reached 100%");
        // Check if the shot hasn't already been triggered by key presses
        if (gameState === 'downswingWaiting') {
            console.log("Full Swing: Downswing timed out. Triggering calculation with potentially missing inputs.");
            calculateFullSwingShot(); // Trigger shot calculation
        }
    }
}

// New animation loop for chip downswing bars
function updateChipDownswingBarsAnimation(timestamp) {
    // Only run if it's a chip swing in the correct state
    if (currentShotType !== 'chip' || gameState !== 'chipDownswingWaiting' || !downswingPhaseStartTime) {
        chipDownswingAnimationFrameId = null;
        return;
    }
    const elapsedTime = timestamp - downswingPhaseStartTime;
    // Call the new UI function for chip bars
    const progressPercent = updateChipTimingBars(elapsedTime); // Pass only elapsed time

    if (progressPercent < 100) {
        chipDownswingAnimationFrameId = requestAnimationFrame(updateChipDownswingBarsAnimation);
    } else {
        // Bars filled up - Timeout
        chipDownswingAnimationFrameId = null;
        console.log("Chip: Downswing timing bars reached 100%");
        // Check if the shot hasn't already been triggered by key presses
        if (gameState === 'chipDownswingWaiting') {
            console.log("Chip: Downswing timed out. Triggering calculation with potentially missing inputs.");
            gameState = 'calculatingChip'; // Set state before calling
            calculateChipShot(); // Trigger shot calculation
        }
    }
}


// --- Calculation ---

// Renamed original function
function calculateFullSwingShot() {
    if (gameState !== 'downswingWaiting' || currentShotType !== 'full') return;

    // Stop full downswing timing bar animation
    if (fullDownswingAnimationFrameId) cancelAnimationFrame(fullDownswingAnimationFrameId); // Use renamed ID
    fullDownswingAnimationFrameId = null; // Use renamed ID

    gameState = 'calculating'; // Use generic calculating state? Or calculatingFull?
    updateStatus('Calculating Full Swing...');
    console.log("Calculating Full Swing Shot...");

    // --- Prepare Inputs for swingPhysics Module ---
    const ballPositionIndex = getBallPositionIndex();
    const ballPositionLevels = getBallPositionLevels();
    const centerIndex = Math.floor(ballPositionLevels / 2);
    // Calculate ball position factor: -1 (Fwd) to +1 (Back), 0 for Center
    const ballPositionFactor = ballPositionLevels > 1 ? (centerIndex - ballPositionIndex) / centerIndex : 0;
    console.log(`Ball Position: Index=${ballPositionIndex}, Factor=${ballPositionFactor.toFixed(2)} (-1=Fwd, 0=Ctr, +1=Back)`);

    // Calculate ideal backswing end time for transition reference
    // Note: backswingEndTime is the *actual* end time when 'w' was released.
    // We need the *ideal* end time based on the start time and ideal duration.
    const scaledIdealBackswingDuration = IDEAL_BACKSWING_DURATION_MS / swingSpeed;
    const idealBackswingEndTime = backswingStartTime + scaledIdealBackswingDuration;

    const timingInputs = {
        backswingDuration: backswingDuration,
        hipInitiationTime: hipInitiationTime,
        rotationStartTime: rotationStartTime,
        rotationInitiationTime: rotationInitiationTime,
        armsStartTime: armsStartTime,
        wristsStartTime: wristsStartTime,
        downswingPhaseStartTime: downswingPhaseStartTime, // When the timing bars started
        idealBackswingEndTime: idealBackswingEndTime, // For transition calculation
    };

    // --- Call the full swing physics calculation module ---
    const impactResult = calculateImpactPhysics(
        timingInputs,
        selectedClub,
        swingSpeed,
        ballPositionFactor
    );

    // --- Use results from impactResult ---
    // We will pull most values directly from impactResult when creating shotData.
    // Only declare local variables needed for intermediate steps (simulation, rollout).
    const ballSpeed = impactResult.ballSpeed; // Needed for simulation input
    const launchAngle = impactResult.launchAngle; // Needed for simulation input
    const backSpin = impactResult.backSpin; // Needed for simulation input & rollout
    const sideSpin = impactResult.sideSpin; // Needed for simulation input
    const strikeQuality = impactResult.strikeQuality; // Needed for rollout & message
    // Declare variables for simulation outputs and rollout
    let peakHeight = 0;
    let carryDistance = 0;
    let rolloutDistance = 0;
    let totalDistance = 0;
    let resultMessage = "";

    // --- Prepare for Simulation (using calculated launch conditions) ---
    console.log("Full Swing: --- Preparing Simulation ---");
    console.log(`Full Swing: Launch Conditions: BallSpeed=${ballSpeed.toFixed(1)}mph, LaunchAngle=${launchAngle.toFixed(1)}deg, BackSpin=${backSpin.toFixed(0)}rpm, SideSpin=${sideSpin.toFixed(0)}rpm`);

    // --- Calculate Initial Vectors for Simulation (Common for all shot types?) ---
    const ballSpeedMPS = ballSpeed * 0.44704; // Convert mph to m/s
    const launchAngleRad = launchAngle * Math.PI / 180;

    // Initial velocity components
    const initialVelY = ballSpeedMPS * Math.sin(launchAngleRad);
    const initialVelHorizontalMag = ballSpeedMPS * Math.cos(launchAngleRad);

    // Determine initial X/Z velocity based on absolute face angle (relative to target line)
    const launchDirectionAngleRad = impactResult.absoluteFaceAngle * Math.PI / 180; // Convert face angle to radians

    const initialVelX = initialVelHorizontalMag * Math.sin(launchDirectionAngleRad); // Positive angle = positive X (right)
    const initialVelZ = initialVelHorizontalMag * Math.cos(launchDirectionAngleRad); // Positive Z = forward

    const initialVelocity = { x: initialVelX, y: initialVelY, z: initialVelZ };
    const initialPosition = { x: 0, y: 0.1, z: 0 }; // Start slightly above ground

    // Define Spin Vector (RPM) - Simplification: backspin around X, sidespin around Y.
    // Positive side spin (slice) means spin around positive Y axis (clockwise from above).
    const spinVectorRPM = { x: backSpin, y: sideSpin, z: 0 };
    // const clubLiftFactor = selectedClub.liftFactor || 1.0; // REMOVED - Incorrect application

    // --- Run Simulation ---
    const simulationResult = simulateFlightStepByStep(initialPosition, initialVelocity, spinVectorRPM, selectedClub); // Pass selectedClub

    // --- Extract Results from Simulation ---
    carryDistance = simulationResult.carryDistance;
    peakHeight = simulationResult.peakHeight;
    const landingAngleRadians = simulationResult.landingAngleRadians; // Get landing angle
    const visualTimeOfFlight = Math.max(0.5, Math.min(5.0, simulationResult.timeOfFlight)); // Clamp visual time

    console.log(`Full Swing: Simulated Time of Flight: ${simulationResult.timeOfFlight.toFixed(2)}s`);
    console.log(`Full Swing: Simulated Carry: ${carryDistance.toFixed(1)} yd, Peak Height: ${peakHeight.toFixed(1)} yd, Landing Angle: ${(landingAngleRadians * 180 / Math.PI).toFixed(1)} deg`);

    // --- Calculate Rollout (Common for all shot types?) ---
    let baseRollFactor = 0.06; // Base roll factor (6%)
    // Adjust base roll based on strike quality
    switch (strikeQuality) {
        case "Thin": baseRollFactor += 0.08; break;
        case "Punch": baseRollFactor += 0.04; break; // Punch rolls more than center
        case "Fat": baseRollFactor -= 0.04; break;
        case "Flip": baseRollFactor -= 0.02; break; // Flip rolls slightly less than center
    }
    baseRollFactor = Math.max(0.01, baseRollFactor); // Ensure base roll doesn't go below 1%

    // Spin factor for roll (same logic as before, using the newly calculated backSpin)
    const targetSpinForZeroRoll = 7500;
    const spinSensitivity = 3500;
    const spinRollFactor = 1 - (backSpin - targetSpinForZeroRoll) / spinSensitivity;

    // Landing angle factor (shallower angle = more roll)
    // Using cosine: angle 0 (horizontal) -> cos(0)=1; angle 90 (vertical) -> cos(90)=0
    // Power helps control sensitivity. Clamp to avoid extreme values.
    const landingAngleFactor = clamp(Math.pow(Math.cos(landingAngleRadians), 0.5), 0.1, 1.5); // Function clamp is defined in chipPhysics.js, need it here or redefine

    console.log(`Full Swing: Rollout Factors: Base=${baseRollFactor.toFixed(2)} (Strike: ${strikeQuality}), SpinFactor=${spinRollFactor.toFixed(2)} (BackSpin: ${backSpin.toFixed(0)}), AngleFactor=${landingAngleFactor.toFixed(2)} (Angle: ${(landingAngleRadians * 180 / Math.PI).toFixed(1)} deg)`);

    // Calculate initial rollout including landing angle factor
    rolloutDistance = carryDistance * baseRollFactor * spinRollFactor * landingAngleFactor;

    // Clamp rollout
    const maxPositiveRollFactor = 0.25;
    const minNegativeRollFactor = -0.08;
    rolloutDistance = Math.max(carryDistance * minNegativeRollFactor, rolloutDistance);
    rolloutDistance = Math.min(carryDistance * maxPositiveRollFactor, rolloutDistance);

    totalDistance = carryDistance + rolloutDistance;

    console.log(`Full Swing: Calculated Rollout: ${rolloutDistance.toFixed(1)} yd, Total Distance: ${totalDistance.toFixed(1)} yd`);

    // --- Determine Result Message (Common for all shot types?) ---
    // Shape based on side spin
    let spinDesc = "";
    const absSideSpin = Math.abs(sideSpin);
    if (absSideSpin < 300) spinDesc = "Straight";
    else if (sideSpin > 0) spinDesc = absSideSpin > 1500 ? "Slice" : "Fade"; // Positive sideSpin = Slice
    else spinDesc = absSideSpin > 1500 ? "Hook" : "Draw"; // Negative sideSpin = Hook

    // Start direction based on club path
    let startDirPrefix = "";
    const pathThreshold = 3.5; // Degrees threshold for push/pull
    if (impactResult.clubPathAngle > pathThreshold) {
        startDirPrefix = "Push "; // Add space
    } else if (impactResult.clubPathAngle < -pathThreshold) {
        startDirPrefix = "Pull "; // Add space
    }

    // Combine strike, start direction (if any), and shape
    resultMessage = `${strikeQuality} ${startDirPrefix}${spinDesc}.`;
    console.log(`Full Swing: ResultMessage: Strike=${strikeQuality}, Path=${impactResult.clubPathAngle.toFixed(1)}, SideSpin=${sideSpin.toFixed(0)} => ${resultMessage}`);


    // --- Prepare Shot Data Object for Callback (Common structure) ---
    // Assign values directly from impactResult where appropriate
    const shotData = {
        // Input/Timing related
        backswingDuration: backswingDuration, // From gameLogic scope
        timingDeviations: { // From impactResult
            transition: impactResult.transitionDev,
            rotation: impactResult.rotationDev,
            arms: impactResult.armsDev,
            wrists: impactResult.wristsDev
        },
        ballPositionFactor: ballPositionFactor, // From gameLogic scope

        // Core Impact & Launch Parameters (Directly from impactResult)
        message: resultMessage, // Combined message (calculated above)
        clubHeadSpeed: impactResult.actualCHS,
        ballSpeed: impactResult.ballSpeed,
        launchAngle: impactResult.launchAngle,
        attackAngle: impactResult.attackAngle,
        backSpin: impactResult.backSpin,
        sideSpin: impactResult.sideSpin,
        clubPathAngle: impactResult.clubPathAngle,
        absoluteFaceAngle: impactResult.absoluteFaceAngle,
        faceAngleRelPath: impactResult.faceAngleRelPath,
        strikeQuality: impactResult.strikeQuality, // Use value from impactResult
        // Include other potentially useful impact results
        potentialCHS: impactResult.potentialCHS,
        dynamicLoft: impactResult.dynamicLoft,
        smashFactor: impactResult.smashFactor,

        // Simulation Results (Calculated in gameLogic)
        peakHeight: peakHeight, // Calculated via simulationResult
        carryDistance: carryDistance,
        rolloutDistance: rolloutDistance,
        totalDistance: totalDistance,
        timeOfFlight: visualTimeOfFlight, // Clamped time for visuals

        // Trajectory (calculated below)
        trajectory: null,
        sideDistance: 0 // Placeholder - calculated after trajectory
    };

    // --- Calculate Trajectory Points (Common for all shot types?) ---
    const trajectoryPoints = calculateTrajectoryPoints(shotData); // Pass updated shotData
    shotData.trajectory = trajectoryPoints; // Add points to data

    // Calculate final side distance based on trajectory end point
    if (trajectoryPoints && trajectoryPoints.length > 0) {
        const finalX = trajectoryPoints[trajectoryPoints.length - 1].x; // Meters
        // Convert final X (meters) to yards. Positive X should be right (slice).
        // The trajectory calculation already handles the direction.
        shotData.sideDistance = finalX * 1.09361; // Convert meters to yards
        console.log(`Full Swing: Calculated Side Distance: ${shotData.sideDistance.toFixed(1)} yards (based on final X: ${finalX.toFixed(1)}m)`);
    }

    // Update internal state
    gameState = 'result';
    console.log("Full Swing: Shot calculation complete.");
    // Log the final shotData object just before calling the callback
    //console.log("Final shotData:", JSON.stringify(shotData, null, 2));

    // --- Call Registered Callback (Common) ---
    if (onShotCompleteCallback) {
        onShotCompleteCallback(shotData); // Pass the comprehensive shot data object
    } else {
        console.warn("No shot completion callback registered in gameLogic.");
        updateStatus('Result (Callback Missing) - Press (n)');
    }
}

// --- Chip Shot Calculation ---
function calculateChipShot() {
    if (gameState !== 'calculatingChip' || currentShotType !== 'chip') return;

    // Stop any chip downswing timeout if implemented
    // if (chipTimeoutId) clearTimeout(chipTimeoutId);

    gameState = 'calculating'; // Use generic calculating state?
    updateStatus('Calculating Chip...');
    console.log("Calculating Chip Shot...");

    // --- Prepare Inputs for chipPhysics Module ---
    const ballPositionIndex = getBallPositionIndex();
    const ballPositionLevels = getBallPositionLevels();
    const centerIndex = Math.floor(ballPositionLevels / 2);
    const ballPositionFactor = ballPositionLevels > 1 ? (centerIndex - ballPositionIndex) / centerIndex : 0;

    // Calculate chip timing offsets relative to downswingPhaseStartTime
    const rotationOffset = chipRotationStartTime ? chipRotationStartTime - downswingPhaseStartTime : null;
    const hitOffset = chipWristsStartTime ? chipWristsStartTime - downswingPhaseStartTime : null;

    console.log(`Chip Inputs: Duration=${backswingDuration?.toFixed(0)}, DownswingStart=${downswingPhaseStartTime?.toFixed(0)}, RotTime=${chipRotationStartTime?.toFixed(0)}, HitTime=${chipWristsStartTime?.toFixed(0)}`);
    console.log(`Chip Inputs: RotationOffset=${rotationOffset?.toFixed(0)}, HitOffset=${hitOffset?.toFixed(0)}, Club=${selectedClub.name}, BallPosFactor=${ballPositionFactor.toFixed(2)}`);

    // --- Call the chip physics calculation module (passing offsets) ---
    // TODO: Update calculateChipImpact in chipPhysics.js to accept these offsets
    console.log("Chip: Calling chipPhysics with backswing duration", backswingDuration);
    const impactResult = calculateChipImpact(
        backswingDuration,
        rotationOffset, // Pass rotation offset
        hitOffset,      // Pass hit offset
        selectedClub,
        ballPositionFactor
    );


    // --- Use results from impactResult (similar structure to full swing) ---
    const ballSpeed = impactResult.ballSpeed;
    const launchAngle = impactResult.launchAngle;
    const backSpin = impactResult.backSpin;
    const sideSpin = impactResult.sideSpin;
    const strikeQuality = impactResult.strikeQuality;
    let peakHeight = 0;
    let carryDistance = 0;
    let rolloutDistance = 0;
    let totalDistance = 0;
    let resultMessage = impactResult.message || "Chip Result"; // Use message from physics or default

    // --- Prepare for Simulation (using calculated launch conditions) ---
    console.log("Chip: --- Preparing Simulation ---");
    console.log(`Chip: Launch Conditions: BallSpeed=${ballSpeed.toFixed(1)}mph, LaunchAngle=${launchAngle.toFixed(1)}deg, BackSpin=${backSpin.toFixed(0)}rpm, SideSpin=${sideSpin.toFixed(0)}rpm`);

    // --- Calculate Initial Vectors for Simulation (Common?) ---
    const ballSpeedMPS = ballSpeed * 0.44704;
    const launchAngleRad = launchAngle * Math.PI / 180;
    const initialVelY = ballSpeedMPS * Math.sin(launchAngleRad);
    const initialVelHorizontalMag = ballSpeedMPS * Math.cos(launchAngleRad);
    const launchDirectionAngleRad = impactResult.absoluteFaceAngle * Math.PI / 180;
    const initialVelX = initialVelHorizontalMag * Math.sin(launchDirectionAngleRad);
    const initialVelZ = initialVelHorizontalMag * Math.cos(launchDirectionAngleRad);
    const initialVelocity = { x: initialVelX, y: initialVelY, z: initialVelZ };
    const initialPosition = { x: 0, y: 0.1, z: 0 };
    const spinVectorRPM = { x: backSpin, y: sideSpin, z: 0 };

    // --- Run Simulation (Common?) ---
    const simulationResult = simulateFlightStepByStep(initialPosition, initialVelocity, spinVectorRPM, selectedClub);

    // --- Extract Results from Simulation ---
    carryDistance = simulationResult.carryDistance;
    peakHeight = simulationResult.peakHeight;
    const landingAngleRadians = simulationResult.landingAngleRadians; // Get landing angle
    const visualTimeOfFlight = Math.max(0.2, Math.min(3.0, simulationResult.timeOfFlight)); // Shorter max time for chips?

    console.log(`Chip: Simulated Time of Flight: ${simulationResult.timeOfFlight.toFixed(2)}s`);
    console.log(`Chip: Simulated Carry: ${carryDistance.toFixed(1)} yd, Peak Height: ${peakHeight.toFixed(1)} yd, Landing Angle: ${(landingAngleRadians * 180 / Math.PI).toFixed(1)} deg`);

    // --- Calculate Rollout (Common?) ---
    // Use same logic, but maybe adjust baseRollFactor for chips?
    let baseRollFactor = 0.10; // Chips might roll more initially?
    switch (strikeQuality) {
        case "Thin": baseRollFactor += 0.10; break;
        case "Fat": baseRollFactor -= 0.05; break;
        // Flip/Punch less relevant for chips?
    }
    baseRollFactor = Math.max(0.02, baseRollFactor);
    const targetSpinForZeroRoll = 5000; // Lower target for chips?
    const spinSensitivity = 2500;
    const spinRollFactor = 1 - (backSpin - targetSpinForZeroRoll) / spinSensitivity;
    // Landing angle factor (same logic as full swing)
    const landingAngleFactor = clamp(Math.pow(Math.cos(landingAngleRadians), 0.5), 0.1, 1.5); // Function clamp is defined in chipPhysics.js, need it here or redefine
    console.log(`Chip: Rollout Factors: Base=${baseRollFactor.toFixed(2)} (Strike: ${strikeQuality}), SpinFactor=${spinRollFactor.toFixed(2)} (BackSpin: ${backSpin.toFixed(0)}), AngleFactor=${landingAngleFactor.toFixed(2)} (Angle: ${(landingAngleRadians * 180 / Math.PI).toFixed(1)} deg)`);
    rolloutDistance = carryDistance * baseRollFactor * spinRollFactor * landingAngleFactor;
    const maxPositiveRollFactor = 0.35; // Allow more roll %
    const minNegativeRollFactor = -0.05;
    rolloutDistance = Math.max(carryDistance * minNegativeRollFactor, rolloutDistance);
    rolloutDistance = Math.min(carryDistance * maxPositiveRollFactor, rolloutDistance);
    totalDistance = carryDistance + rolloutDistance;
    console.log(`Chip: Calculated Rollout: ${rolloutDistance.toFixed(1)} yd, Total Distance: ${totalDistance.toFixed(1)} yd`);

    // --- Determine Result Message (if not provided by physics) ---
    // TODO: Update this logic based on new offset deviations from chipPhysics.js
    if (!impactResult.message) {
        // Placeholder message until physics provides one based on new timing
        resultMessage = "Chip Result";
        // Example based on offsets (needs ideal values from physics):
        // const rotDev = rotationOffset - IDEAL_CHIP_ROTATION_OFFSET;
        // const hitDev = hitOffset - IDEAL_CHIP_HIT_OFFSET;
        // if (Math.abs(rotDev) < 30 && Math.abs(hitDev) < 30) resultMessage = "Good Chip";
        // else if (hitDev < -30) resultMessage = "Early Chip";
        // else resultMessage = "Late Chip";
    }

    // --- Prepare Shot Data Object for Callback (Common structure) ---
    const shotData = {
        // Input/Timing related
        backswingDuration: backswingDuration,
        timingDeviations: { // Chip specific timing (using offsets for now)
            // TODO: Populate with deviations calculated in chipPhysics.js
            rotationOffset: rotationOffset,
            hitOffset: hitOffset,
            // chipTimingError: chipTimingError, // Remove old error metric
        },
        ballPositionFactor: ballPositionFactor,

        // Core Impact & Launch Parameters (From chipImpactResult)
        message: resultMessage,
        clubHeadSpeed: impactResult.clubHeadSpeed,
        ballSpeed: impactResult.ballSpeed,
        launchAngle: impactResult.launchAngle,
        attackAngle: impactResult.attackAngle,
        backSpin: impactResult.backSpin,
        sideSpin: impactResult.sideSpin,
        clubPathAngle: impactResult.clubPathAngle,
        absoluteFaceAngle: impactResult.absoluteFaceAngle,
        faceAngleRelPath: impactResult.faceAngleRelPath,
        strikeQuality: impactResult.strikeQuality,
        potentialCHS: impactResult.potentialCHS,
        dynamicLoft: impactResult.dynamicLoft,
        smashFactor: impactResult.smashFactor,

        // Simulation Results
        peakHeight: peakHeight,
        carryDistance: carryDistance,
        rolloutDistance: rolloutDistance,
        totalDistance: totalDistance,
        timeOfFlight: visualTimeOfFlight,

        // Trajectory (calculated below)
        trajectory: null,
        sideDistance: 0
    };

    // --- Calculate Trajectory Points (Common?) ---
    const trajectoryPoints = calculateTrajectoryPoints(shotData);
    shotData.trajectory = trajectoryPoints;

    // Calculate final side distance
    if (trajectoryPoints && trajectoryPoints.length > 0) {
        const finalX = trajectoryPoints[trajectoryPoints.length - 1].x;
        shotData.sideDistance = finalX * 1.09361;
        console.log(`Chip: Calculated Side Distance: ${shotData.sideDistance.toFixed(1)} yards (based on final X: ${finalX.toFixed(1)}m)`);
    }

    // Update internal state
    gameState = 'result';
    console.log("Chip: Shot calculation complete.");

    // --- Call Registered Callback (Common) ---
    if (onShotCompleteCallback) {
        onShotCompleteCallback(shotData);
    } else {
        console.warn("No shot completion callback registered in gameLogic.");
        updateStatus('Result (Callback Missing) - Press (n)');
    }
}


// --- Trajectory Calculation (Common?) ---
// NOTE: This function relies on shotData containing the results from physics
// (e.g., carryDistance, peakHeight, sideSpin, absoluteFaceAngle)
function calculateTrajectoryPoints(shotData) {
    const airPoints = []; // Points during flight
    const rollPoints = []; // Points during roll
    const airSteps = 50; // Number of points in the air line
    const rollSteps = 10; // Number of points for the roll segment

    const carryYards = shotData.carryDistance;
    const peakYards = shotData.peakHeight;
    // Use sideSpin directly from shotData. Positive = Slice (right), Negative = Hook (left)
    // Simple linear deviation model (needs tuning)
    const sideDeviationYards = shotData.sideSpin / 150;

    // Convert yards to scene units (meters)
    const carryMeters = carryYards / 1.09361;
    const peakMeters = peakYards / 1.09361;
    // Positive side deviation (slice) should result in positive X (right visually)
    const sideDeviationMeters = sideDeviationYards / 1.09361;

    // Initial horizontal launch angle based on face angle
    const initialLaunchAngleRad = shotData.absoluteFaceAngle * Math.PI / 180;
    const tanInitialLaunch = Math.tan(initialLaunchAngleRad);

    // Simple parabolic trajectory calculation (y vs z)
    const h = carryMeters / 2; // z-coordinate of vertex
    const k = peakMeters;      // y-coordinate of vertex
    const a = (k > 0.2) ? (0.2 - k) / (h * h) : 0; // Avoid issues if peak is below start

    // Calculate air points
    for (let i = 0; i <= airSteps; i++) {
        const progress = i / airSteps; // 0 to 1
        const z = progress * carryMeters;

        // Calculate vertical position (parabola)
        let y = (a !== 0) ? a * (z - h) * (z - h) + k : 0.2;
        y = Math.max(0.2, y); // Ensure y doesn't go below ground

        // Calculate horizontal position (quadratic curve for side deviation vs z)
        // x = initial direction + spin curve
        // initial direction = z * tan(initial angle)
        // spin curve = c_side * z^2 (where c_side makes curve end at sideDeviationMeters)
        let x = z * tanInitialLaunch; // Start with linear initial direction
        if (carryMeters > 0.1) { // Avoid division by zero for spin curve
             const c_side = sideDeviationMeters / (carryMeters * carryMeters);
             // Add the quadratic curve for spin deviation
             // We need to adjust the target deviation for the curve calculation
             // Target deviation for curve = final deviation - deviation from initial angle at carry
             const curveTargetDeviation = sideDeviationMeters - (carryMeters * tanInitialLaunch);
             const c_side_adjusted = curveTargetDeviation / (carryMeters * carryMeters);
             x += c_side_adjusted * z * z;
         }
        airPoints.push({ x: x, y: y, z: z });
    }

    // Calculate roll points (straight line from landing point)
    const landingPoint = airPoints[airSteps] || { x: 0, y: 0.2, z: 0 }; // Last point or default
    const rolloutMeters = (shotData.rolloutDistance || 0) / 1.09361;
    // const totalDistanceMeters = carryMeters + rolloutMeters; // Not needed here

    if (Math.abs(rolloutMeters) > 0.1 && rollSteps > 0) { // Add roll if significant (positive or negative)
        const rollStartX = landingPoint.x;
        const rollStartZ = landingPoint.z;
        // Roll direction based on the vector from origin (0,0) to landing point
        let directionX = landingPoint.x; // Vector component X from origin
        let directionZ = landingPoint.z; // Vector component Z from origin
        const length = Math.sqrt(directionX * directionX + directionZ * directionZ);

        if (length > 0.001) {
            directionX /= length;
            directionZ /= length;
        } else { // If landing point is same as previous, assume roll goes straight forward
            directionX = 0;
            directionZ = 1;
        }

        for (let i = 1; i <= rollSteps; i++) {
            const rollProgress = i / rollSteps;
            const currentRollDistance = rollProgress * rolloutMeters; // Handles negative roll

            const x = rollStartX + directionX * currentRollDistance;
            const z = rollStartZ + directionZ * currentRollDistance;
             const y = 0.2; // Ball sits on the ground
             // Use the calculated X directly for roll points as well.
             rollPoints.push({ x: x, y: y, z: z });
         }
    }

    const allPoints = [...airPoints, ...rollPoints];

    if (allPoints.length > 0) {
        console.log(`Calculated ${airPoints.length} air + ${rollPoints.length} roll points. End: (${allPoints[allPoints.length - 1].x.toFixed(1)}, ${allPoints[allPoints.length - 1].y.toFixed(1)}, ${allPoints[allPoints.length - 1].z.toFixed(1)})`);
    } else {
        console.warn("No trajectory points generated.");
        allPoints.push({ x: 0, y: 0.2, z: 0 }); // Add starting point if empty
    }
    return allPoints;
}

// --- Step-by-Step Flight Simulation ---
// NOTE: This function remains largely the same, taking initial physics parameters.
function simulateFlightStepByStep(initialPos, initialVel, spinVec, club) { // Added club parameter
    const trajectoryPoints = [initialPos];
    let position = { ...initialPos }; // Current position (copy)
    let velocity = { ...initialVel }; // Current velocity (copy)
    let lastVelocityBeforeLanding = { ...initialVel }; // Store velocity before impact
    let time = 0;
    const dt = 0.01; // Time step in seconds
    const gravity = 9.81;
    let peakHeight = initialPos.y;

    // --- Simulation Constants (Tunable) ---
    const Cd = 0.38; // Drag coefficient (placeholder)
    const Cl = 0.01; // Lift coefficient (placeholder, related to spin). Reduced from 0.1, still higher than original 0.002.
    const airDensity = 1.225; // kg/m^3 (standard air density)
    const ballArea = Math.PI * (0.04267 / 2) * (0.04267 / 2); // Cross-sectional area of golf ball (m^2)
    const ballMass = 0.04593; // kg (standard golf ball mass)
    // Pre-calculate constant part of drag/lift force calculation
    const dragConst = -0.5 * airDensity * ballArea * Cd / ballMass;
    const liftConst = 0.5 * airDensity * ballArea * Cl / ballMass;
    // --- End Constants ---

    console.log("Sim: Starting step-by-step simulation...");
    console.log(`Sim: Initial Vel: (${velocity.x.toFixed(2)}, ${velocity.y.toFixed(2)}, ${velocity.z.toFixed(2)}) m/s`);
    console.log(`Sim: Spin Vec (RPM): (${spinVec.x.toFixed(0)}, ${spinVec.y.toFixed(0)}, ${spinVec.z.toFixed(0)})`);

    // Convert spin from RPM to rad/s
    // Assuming side spin is around Y axis, back spin around X axis relative to path
    // This needs refinement based on how side/back spin are defined relative to world coords
    const spinRadPerSec = {
        x: -(spinVec.x || 0) * (2 * Math.PI / 60), // Backspin around X (Negated to produce upward lift)
        y: (spinVec.y || 0) * (2 * Math.PI / 60), // Sidespin around Y
        z: (spinVec.z || 0) * (2 * Math.PI / 60)  // Rifle spin? (Assume 0 for now)
    };
     console.log(`Sim: Spin rad/s: (${spinRadPerSec.x.toFixed(2)}, ${spinRadPerSec.y.toFixed(2)}, ${spinRadPerSec.z.toFixed(2)})`);


    while (position.y > 0.01 || time === 0) { // Loop until ball is near/below ground (allow at least one step)
        // 1. Calculate Velocity Magnitude
        const velMag = Math.sqrt(velocity.x**2 + velocity.y**2 + velocity.z**2);
        if (velMag < 0.01) break; // Stop if ball stops mid-air

        // 2. Calculate Forces (as accelerations)
        const accel_gravity = { x: 0, y: -gravity, z: 0 };

        // Drag Force: Fd = -0.5 * rho * A * Cd * v^2 * (v_unit) => a = F/m
        const accel_drag = {
            x: dragConst * velMag * velocity.x,
            y: dragConst * velMag * velocity.y,
            z: dragConst * velMag * velocity.z
        };

        // Lift (Magnus) Force: Fl = 0.5 * rho * A * Cl * (w x v) => a = F/m
        // Cross Product: w x v = (wy*vz - wz*vy, wz*vx - wx*vz, wx*vy - wy*vx)
        const crossProd = {
            x: spinRadPerSec.y * velocity.z - spinRadPerSec.z * velocity.y,
            y: spinRadPerSec.z * velocity.x - spinRadPerSec.x * velocity.z,
            z: spinRadPerSec.x * velocity.y - spinRadPerSec.y * velocity.x
        };
        const accel_lift = {
            x: liftConst * crossProd.x,
            y: liftConst * crossProd.y,
            z: liftConst * crossProd.z
        };

        // Additive "cheat" lift based on club's liftFactor
        const cheatLiftAccelY = (club.liftFactor || 0) * 0.25; // Scaled boost

        // 3. Net Acceleration
        const accel_net = {
            x: accel_gravity.x + accel_drag.x + accel_lift.x,
            y: accel_gravity.y + accel_drag.y + accel_lift.y + cheatLiftAccelY, // Added cheat lift
            z: accel_gravity.z + accel_drag.z + accel_lift.z
        };

        // 4. Update Velocity (Euler integration)
        velocity.x += accel_net.x * dt;
        velocity.y += accel_net.y * dt;
        velocity.z += accel_net.z * dt;

        // 5. Update Position
        position.x += velocity.x * dt;
        position.y += velocity.y * dt;
        position.z += velocity.z * dt;

        // 6. Track Peak Height
        if (position.y > peakHeight) {
            peakHeight = position.y;
        }

        // 7. Store Point
        trajectoryPoints.push({ ...position });

        // 8. Increment Time
        time += dt;

        // Safety break
        if (time > 20) {
            console.warn("Simulation exceeded 20 seconds, breaking loop.");
            break;
        }
        // Store the velocity from the step *before* potential termination
        lastVelocityBeforeLanding = { ...velocity };
    }

    console.log(`Sim: Simulation finished. Time: ${time.toFixed(2)}s, Steps: ${trajectoryPoints.length}`);
    const landingPosition = trajectoryPoints.length > 1 ? trajectoryPoints[trajectoryPoints.length - 1] : initialPos;

    // Calculate landing angle
    const finalVel = lastVelocityBeforeLanding;
    const horizontalVelMag = Math.sqrt(finalVel.x**2 + finalVel.z**2);
    let landingAngleRadians = Math.PI / 2; // Default to 90 deg if horizontal speed is near zero
    if (horizontalVelMag > 0.01) {
        landingAngleRadians = Math.atan2(Math.abs(finalVel.y), horizontalVelMag);
    }
    console.log(`Sim: Final Velocity (y): ${finalVel.y.toFixed(2)}, Horizontal Vel: ${horizontalVelMag.toFixed(2)}, Landing Angle: ${(landingAngleRadians * 180 / Math.PI).toFixed(1)} deg`);


    // Calculate carry based on X/Z distance from origin at landing
    const carryDistanceMeters = Math.sqrt(landingPosition.x**2 + landingPosition.z**2);

    return {
        landingPosition: landingPosition,
        carryDistance: carryDistanceMeters * 1.09361, // Convert to yards
        peakHeight: peakHeight * 1.09361, // Convert to yards
        timeOfFlight: time, // Actual simulated time
        landingAngleRadians: landingAngleRadians, // Add landing angle
        trajectoryPoints: trajectoryPoints // Array of {x, y, z} objects
    };
}


// Helper to get current timing data for debug display (Full Swing only for now)
function getDebugTimingData() {
    if (currentShotType !== 'full') {
        // Return default/empty values for non-full swings
        return {
            backswingDuration: backswingDuration, // Still relevant maybe?
            rotationStartOffset: null,
            rotationInitiatedEarly: false,
            armsStartOffset: null,
            wristsStartOffset: null,
            hipInitiationOffset: null,
        };
    }

    let rotationOffset = null;
    let rotationInitiatedEarly = false;
    if (rotationInitiationTime) {
        rotationOffset = rotationInitiationTime - backswingEndTime;
        rotationInitiatedEarly = true;
    } else if (rotationStartTime) {
        rotationOffset = rotationStartTime - backswingEndTime;
    }

    return {
        backswingDuration: backswingDuration,
        rotationStartOffset: rotationOffset,
        rotationInitiatedEarly: rotationInitiatedEarly,
        armsStartOffset: armsStartTime ? armsStartTime - backswingEndTime : null,
        wristsStartOffset: wristsStartTime ? wristsStartTime - backswingEndTime : null,
        hipInitiationOffset: hipInitiationTime ? hipInitiationTime - backswingEndTime : null,
    };
}

// Export reset function for button/key binding
export const resetSwing = resetSwingState;
