import { clubs } from './clubs.js';
import * as ui from './ui.js';
// Import specific UI functions needed for ball position
import { adjustBallPosition, getBallPositionIndex, getBallPositionLevels, setBallPosition, markHipInitiationOnBackswingBar } from './ui.js';
import * as visuals from './visuals.js'; // Import visuals

// --- Constants ---
const DOWNSWING_TIMING_BAR_DURATION_MS = 500;
const BACKSWING_BAR_MAX_DURATION_MS = 1500;
const IDEAL_BACKSWING_DURATION_MS = 1000;

// --- Game State ---
let gameState = 'ready'; // ready, backswing, backswingPausedAtTop, downswingWaiting, calculating, result
let swingSpeed = 1.0; // Base speed factor (0.3 to 1.0)
let selectedClub = clubs['7I']; // Default club

// --- Timing Variables ---
let backswingStartTime = null;
let backswingEndTime = null;
let backswingDuration = null;
let rotationInitiationTime = null;
let armsStartTime = null;
let wristsStartTime = null;
let rotationStartTime = null;
let hipInitiationTime = null; // Added

// --- Animation Frame IDs ---
let downswingAnimationFrameId = null;
let backswingAnimationFrameId = null;
let downswingPhaseStartTime = null;

// --- Initialization ---
export function initializeGameLogic() {
    // Initial swing speed setup is handled by UI calling setSwingSpeed
    resetSwingState();
    console.log("Game Logic Initialized.");
}

// --- State Management ---
export function setSwingSpeed(percentage) {
    swingSpeed = percentage / 100;
    ui.setupTimingBarWindows(swingSpeed); // Update UI windows when speed changes
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

function resetSwingState() {
    gameState = 'ready';
    backswingStartTime = null;
    backswingEndTime = null;
    backswingDuration = null;
    rotationInitiationTime = null;
    armsStartTime = null;
    wristsStartTime = null;
    rotationStartTime = null;
    hipInitiationTime = null; // Added reset

    // Stop animations if still running
    if (backswingAnimationFrameId) cancelAnimationFrame(backswingAnimationFrameId);
    if (downswingAnimationFrameId) cancelAnimationFrame(downswingAnimationFrameId);
    backswingAnimationFrameId = null;
    downswingAnimationFrameId = null;
    downswingPhaseStartTime = null;

    ui.resetUI(); // Reset all UI elements
    visuals.resetVisuals(); // Reset visuals (e.g., ball position)
    console.log("Swing state reset.");
}

// --- Input Handling Callbacks (to be called by main.js) ---
export function handleKeyDown(event) {
    // Explicitly log state just before checking keys
    console.log(`handleKeyDown Check: Key='${event.key}', State='${gameState}'`);

    // Adjust Ball Position with Arrow Keys (only when ready)
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

    // Start Backswing with 'w' key
    if (event.key === 'w' && gameState === 'ready') {
        console.log("'w' pressed in ready state - starting backswing"); // Log branch execution
        gameState = 'backswing';
        backswingStartTime = performance.now();
        ui.updateStatus('Backswing...');
        console.log("Backswing started");
        ui.resetUI(); // Reset UI elements for the new swing start

        // Start backswing bar animation
        if (backswingAnimationFrameId) cancelAnimationFrame(backswingAnimationFrameId);
        backswingAnimationFrameId = requestAnimationFrame(updateBackswingBarAnimation);
    }

    // Trigger reset with 'n' key when in result state
    if (event.key === 'n' && gameState === 'result') {
        console.log("'n' pressed in result state - resetting"); // Log branch execution
        resetSwingState();
    }

    // Capture 'a' press during backswing for early rotation/transition (NEW KEY)
    if (event.key === 'a' && gameState === 'backswing' && !rotationInitiationTime) {
        console.log("'a' pressed during backswing (early rotation)"); // Log branch execution
        rotationInitiationTime = performance.now();
        console.log("'a' pressed during backswing (early rotation)");
    }

    // Capture 'j' press (Hip Initiation) - NEW KEY
    if (event.key === 'j' && (gameState === 'backswing' || gameState === 'backswingPausedAtTop') && !hipInitiationTime) {
        hipInitiationTime = performance.now();
        console.log(`'j' (Hips) pressed at ${hipInitiationTime.toFixed(0)}ms. State: ${gameState}`); // UPDATED LOG
        ui.updateStatus("Hips Initiated..."); // Update status
        markHipInitiationOnBackswingBar(); // Call UI function to change bar color

        // If paused at top, pressing 'j' starts the downswing phase immediately
        if (gameState === 'backswingPausedAtTop') {
            gameState = 'downswingWaiting';
            ui.updateStatus('Downswing: Press a, d, i...'); // UPDATED PROMPT
            console.log("Transitioning from Paused to DownswingWaiting due to 'j' press."); // UPDATED LOG
            // Start downswing timing bar animation
            downswingPhaseStartTime = performance.now(); // Start timing from 'h' press
            if (downswingAnimationFrameId) cancelAnimationFrame(downswingAnimationFrameId);
            downswingAnimationFrameId = requestAnimationFrame(updateDownswingBarsAnimation);
            ui.updateDebugTimingInfo(getDebugTimingData()); // Update debug display
        }
    }

    // Capture downswing sequence keys *only if hips have been initiated*
    if (gameState === 'downswingWaiting' && hipInitiationTime) {
        console.log(`Key '${event.key}' pressed during downswingWaiting (Hips Initiated)`); // Log branch execution
        const timeNow = performance.now();
        // Offset relative to hip initiation time might be more relevant now? Or stick to backswingEnd? Let's stick to backswingEnd for now.
        const offset = timeNow - backswingEndTime; // Offset relative to backswing end

        // Check keys in the new sequence: a (rotation), d (arms), i (wrists)
        if (event.key === 'd' && !armsStartTime) { // 'd' still controls Arms
            armsStartTime = timeNow;
            ui.showKeyPressMarker('d', offset, swingSpeed); // Pass 'd' to UI for Arms marker
            ui.updateDebugTimingInfo(getDebugTimingData());
            console.log(`'d' (Arms) pressed at offset: ${offset.toFixed(0)} ms`);
        } else if (event.key === 'i' && !wristsStartTime) { // 'i' now controls Wrists - NEW KEY
            wristsStartTime = timeNow;
            ui.showKeyPressMarker('i', offset, swingSpeed); // Pass 'i' to UI for Wrists marker
             ui.updateDebugTimingInfo(getDebugTimingData());
           console.log(`'i' (Wrists) pressed at offset: ${offset.toFixed(0)} ms`); // UPDATED LOG
        } else if (event.key === 'a' && !rotationStartTime && !rotationInitiationTime) { // 'a' still controls Rotation
            rotationStartTime = timeNow;
            ui.showKeyPressMarker('a', offset, swingSpeed); // Pass 'a' to UI for Rotation marker
             ui.updateDebugTimingInfo(getDebugTimingData());
            console.log(`'a' (Rotation) pressed post-backswing at offset: ${offset.toFixed(0)} ms`);
        }

        // Check if all required downswing keys are pressed
        if (armsStartTime && wristsStartTime && (rotationInitiationTime || rotationStartTime)) {
            calculateShot();
        }
    }
}

export function handleKeyUp(event) {
    console.log(`gameLogic keyup: ${event.key}, gameState: ${gameState}`); // Log function call and state

    // End Backswing with 'w' key release
    if (event.key === 'w' && gameState === 'backswing') {
        // event.preventDefault(); // No longer needed for 'w'
        console.log("'w' released in backswing state - ending backswing"); // Log branch execution
        backswingEndTime = performance.now();
        backswingDuration = backswingEndTime - backswingStartTime;

        // Stop backswing bar animation
        if (backswingAnimationFrameId) cancelAnimationFrame(backswingAnimationFrameId);
        backswingAnimationFrameId = null;

        // Decide next state based on whether 'h' was pressed during backswing
        if (hipInitiationTime) {
            // Hips already initiated, go straight to downswing waiting
            gameState = 'downswingWaiting';
            ui.updateStatus('Downswing: Press a, s, d...');
            console.log(`Backswing ended. Hips initiated during backswing. Duration: ${backswingDuration.toFixed(0)} ms. Waiting for a, s, d.`);
            // Start downswing timing bar animation
            downswingPhaseStartTime = performance.now(); // Start timing from 'w' release
            if (downswingAnimationFrameId) cancelAnimationFrame(downswingAnimationFrameId);
            downswingAnimationFrameId = requestAnimationFrame(updateDownswingBarsAnimation);
        } else {
            // Hips not initiated yet, pause at the top
            gameState = 'backswingPausedAtTop';
            ui.updateStatus("Paused at Top... Press 'h' to start downswing");
            console.log(`Backswing ended. Hips NOT initiated. Duration: ${backswingDuration.toFixed(0)} ms. Paused.`);
            // Do not start downswing bars yet
        }
        ui.updateDebugTimingInfo(getDebugTimingData()); // Update debug display
    }
}

// --- Animation Loops ---
function updateBackswingBarAnimation(timestamp) {
    if (gameState !== 'backswing' || !backswingStartTime) {
        backswingAnimationFrameId = null;
        return;
    }
    const elapsedTime = timestamp - backswingStartTime;
    ui.updateBackswingBar(elapsedTime, swingSpeed); // Call UI update function
    backswingAnimationFrameId = requestAnimationFrame(updateBackswingBarAnimation);
}

function updateDownswingBarsAnimation(timestamp) {
    if (gameState !== 'downswingWaiting' || !downswingPhaseStartTime) {
        downswingAnimationFrameId = null;
        return;
    }
    const elapsedTime = timestamp - downswingPhaseStartTime;
    const progressPercent = ui.updateTimingBars(elapsedTime, swingSpeed); // Call UI update

    if (progressPercent < 100) {
        downswingAnimationFrameId = requestAnimationFrame(updateDownswingBarsAnimation);
    } else {
        // Bars filled up - Timeout
        downswingAnimationFrameId = null;
        console.log("Downswing timing bars reached 100%");
        // Check if the shot hasn't already been triggered by key presses
        if (gameState === 'downswingWaiting') {
            console.log("Downswing timed out. Triggering calculation with potentially missing inputs.");
            calculateShot(); // Trigger shot calculation
        }
    }
}

// --- Calculation ---
function calculateShot() {
    if (gameState !== 'downswingWaiting') return;

    // Stop downswing timing bar animation
    if (downswingAnimationFrameId) cancelAnimationFrame(downswingAnimationFrameId);
    downswingAnimationFrameId = null;

    gameState = 'calculating';
    ui.updateStatus('Calculating...');
    console.log("Calculating Shot...");

    // --- Calculation Logic (mostly unchanged, uses selectedClub) ---
    let clubHeadSpeed = 0;
    let ballSpeed = 0;
    let attackAngle = 0;
    let backSpin = 0;
    let sideSpin = 0;
    let launchAngle = 0;
    let peakHeight = 0;
    let carryDistance = 0;
    let rolloutDistance = 0; // Added
    let totalDistance = 0; // Added
    let resultMessage = "";
    let strikeQuality = "Center";

    // Ideal offsets remain associated with the ACTION, but triggered by NEW KEYS (a=Rotation, d=Arms, i=Wrists)
    const idealTransitionOffset = -50 / swingSpeed; // Transition (early rotation 'a' or regular 'a')
    const idealRotationOffset = 50 / swingSpeed;    // Rotation ('a' key)
    const idealArmsOffset = 100 / swingSpeed;       // Arms ('d' key)
    const idealWristsOffset = 200 / swingSpeed;     // Wrists ('i' key) - NEW KEY

    // Assign large penalty time if input is missing, instead of Infinity
    const MAX_PENALTY_TIME_MS = 5000;
    const effectiveArmsStartTime = armsStartTime !== null ? armsStartTime : backswingEndTime + MAX_PENALTY_TIME_MS; // Triggered by 'd'
    const effectiveWristsStartTime = wristsStartTime !== null ? wristsStartTime : backswingEndTime + MAX_PENALTY_TIME_MS; // Triggered by 'i' - NEW KEY
    // Use rotationStartTime ('a' press) if available, otherwise use rotationInitiationTime ('a' press early) if available, otherwise penalty
    const effectiveRotationStartTime = rotationStartTime !== null ? rotationStartTime : (rotationInitiationTime !== null ? rotationInitiationTime : backswingEndTime + MAX_PENALTY_TIME_MS); // Triggered by 'a'
    // Transition time is based on when rotation was initiated ('a' key, early or regular)
    const effectiveTransitionTime = rotationInitiationTime !== null ? rotationInitiationTime : effectiveRotationStartTime;


    // Calculate deviations using the correct ideal offsets for each action's effective time
    const transitionDev = (effectiveTransitionTime - backswingEndTime) - idealTransitionOffset; // Based on 'a' timing
    const rotationDev = (effectiveRotationStartTime - backswingEndTime) - idealRotationOffset; // Based on 'a' timing
    const armsDev = (effectiveArmsStartTime - backswingEndTime) - idealArmsOffset;             // Based on 'd' timing
    const wristsDev = (effectiveWristsStartTime - backswingEndTime) - idealWristsOffset;       // Based on 'i' timing - NEW KEY

    console.log(`Deviations - Rotation('a'): ${rotationDev.toFixed(0)}, Arms('d'): ${armsDev.toFixed(0)}, Wrists('i'): ${wristsDev.toFixed(0)}`); // Updated log

    // --- Calculate Potential CHS based on backswing length relative to ideal mark ---
    // Ideal duration scaled by swing speed determines the timing for the ideal mark
    const scaledIdealBackswingDuration = IDEAL_BACKSWING_DURATION_MS / swingSpeed;
    // Power factor: How close was the actual duration to the scaled ideal duration? Clamp between 0.1 and 1.0.
    const powerFactor = Math.max(0.1, Math.min(1.0, backswingDuration / scaledIdealBackswingDuration));

    const baseSpeed = selectedClub.basePotentialSpeed || 90; // Get base speed, fallback to 90
    console.log(`Club: ${selectedClub.name}, Base Potential Speed: ${baseSpeed} mph`);
    // Log the new power factor calculation details
    console.log(`Backswing Duration: ${backswingDuration.toFixed(0)}ms, Scaled Ideal Duration (Mark): ${scaledIdealBackswingDuration.toFixed(0)}ms, Power Factor: ${powerFactor.toFixed(2)}`);

    // Calculate potential CHS based on base speed, power factor, and swing speed slider
    // Note: swingSpeed influences the powerFactor calculation AND multiplies the result.
    let potentialCHS = baseSpeed * powerFactor * swingSpeed;

    // Apply a minimum speed clamp (e.g., 60% of base potential, also scaled by slider)
    const minPotentialCHS = baseSpeed * 0.6 * swingSpeed; // Minimum potential based on slider
    potentialCHS = Math.max(minPotentialCHS, potentialCHS); // Ensure powerFactor doesn't drop below minimum
    console.log(`Potential CHS (after power factor, speed slider, min clamp): ${potentialCHS.toFixed(1)} mph`);

    // --- Apply Penalties ---
    // Sequence Penalty (Timing deviations of downswing keys)
    const sequencePenaltyFactor = Math.max(0.6, 1 - (Math.abs(armsDev) + Math.abs(rotationDev) + Math.abs(wristsDev)) / (1500 / swingSpeed)); // Denominator might need review
    console.log(`Sequence Penalty Factor: ${sequencePenaltyFactor.toFixed(2)}`);

    // Overswing Penalty (Holding backswing past the max bar duration)
    let overswingPenalty = 0;
    const scaledMaxBackswingDuration = BACKSWING_BAR_MAX_DURATION_MS / swingSpeed; // Max duration scaled by speed
    if (backswingDuration > scaledMaxBackswingDuration) { // Check against scaled max duration
        // Penalty based on how much *over* the scaled max duration
        overswingPenalty = Math.min(0.3, (backswingDuration - scaledMaxBackswingDuration) / 1000); // Penalty amount (consider scaling this by swingSpeed too?)
        console.log(`Overswing Penalty Applied: ${(overswingPenalty * 100).toFixed(1)}% (Duration ${backswingDuration.toFixed(0)} > Scaled Max ${scaledMaxBackswingDuration.toFixed(0)})`);
    }

    // Apply penalties to potential CHS
    clubHeadSpeed = potentialCHS * sequencePenaltyFactor * (1 - overswingPenalty);

    console.log(`Final CHS (after penalties): ${clubHeadSpeed.toFixed(1)} mph`);


    // --- Calculate other initial shot parameters ---
    // Get ball position setting from UI
    const ballPositionIndex = getBallPositionIndex(); // 0 (Back) to levels-1 (Forward)
    const ballPositionLevels = getBallPositionLevels(); // e.g., 5
    const centerIndex = Math.floor(ballPositionLevels / 2); // e.g., 2 for 5 levels

    // Calculate ball position factor: -1 (Back) to +1 (Forward), 0 for Center
    const ballPositionFactor = (centerIndex - ballPositionIndex) / centerIndex; // e.g., (2-0)/2=1, (2-1)/2=0.5, (2-2)/2=0, (2-3)/2=-0.5, (2-4)/2=-1
    console.log(`Ball Position: Index=${ballPositionIndex}, Factor=${ballPositionFactor.toFixed(2)} (-1=Fwd, 0=Ctr, +1=Back)`);

    // Attack Angle Calculation
    const baseAoA = selectedClub.baseAoA;
    // Base adjustment still comes from arms timing ('d' key)
    const armsTimingAoAAdjust = Math.max(-5, Math.min(5, -armsDev / (20 / swingSpeed)));
    // Additional adjustment based on ball position (more forward = more positive AoA)
    // Let's say max adjustment is +/- 3 degrees based on position? (Tunable)
    const ballPositionAoAAdjust = ballPositionFactor * -3.0; // Factor is -1 (Fwd) to +1 (Back), so multiply by -3 to get +3 (Fwd) to -3 (Back)
    attackAngle = baseAoA + armsTimingAoAAdjust + ballPositionAoAAdjust;
    console.log(`Club Base AoA: ${baseAoA}, ArmsDev: ${armsDev.toFixed(0)}, Arms AoA Adj: ${armsTimingAoAAdjust.toFixed(1)}, Ball Pos AoA Adj: ${ballPositionAoAAdjust.toFixed(1)}, Final AoA: ${attackAngle.toFixed(1)}`);


    let smashFactor = selectedClub.baseSmash;
    const aoaThreshold = selectedClub.name === 'Driver' ? 8 : 6;
    if (Math.abs(attackAngle - baseAoA) > aoaThreshold) {
        strikeQuality = attackAngle < baseAoA ? "Fat" : "Thin";
        smashFactor *= 0.8;
    } else if (Math.abs(wristsDev) > 100 / swingSpeed) {
        strikeQuality = wristsDev < 0 ? "Thin" : "Fat";
        smashFactor *= 0.9;
    }
    console.log(`Strike: ${strikeQuality}, Smash Factor: ${smashFactor.toFixed(2)}`);

    ballSpeed = clubHeadSpeed * smashFactor;

    // Revised Back Spin Calculation - Incorporating Loft and AoA more directly
    const baseSpin = 1000 + (clubHeadSpeed * 15) + (selectedClub.loft * 100) + (-attackAngle * 50);
    backSpin = baseSpin * selectedClub.spinRateFactor;
    backSpin = Math.max(500, Math.min(12000, backSpin)); // Keep clamp

    const faceAngleDev = (wristsDev * 0.6 + rotationDev * 0.4) / (20 / swingSpeed);
    const pathDev = (rotationDev * 0.7 - armsDev * 0.3) / (25 / swingSpeed);
    const faceToPath = faceAngleDev - pathDev;
    sideSpin = faceToPath * 200;
    sideSpin = Math.max(-4000, Math.min(4000, sideSpin));

    // Reduce backspin significantly if side spin is high (hook/slice)
    const sideSpinThreshold = 2000;
    if (Math.abs(sideSpin) > sideSpinThreshold) {
        const reductionFactor = 0.3; // Reduce backspin by 70% (very aggressive)
        const originalBackSpin = backSpin;
        backSpin *= reductionFactor;
        backSpin = Math.max(500, backSpin); // Ensure it doesn't go below minimum clamp
        console.log(`High side spin detected (${sideSpin.toFixed(0)}). Reducing back spin from ${originalBackSpin.toFixed(0)} to ${backSpin.toFixed(0)}.`);
    }

    console.log(`Face Angle Dev: ${faceAngleDev.toFixed(1)}, Path Dev: ${pathDev.toFixed(1)}, Face-to-Path: ${faceToPath.toFixed(1)}`);
    console.log(`Final Back Spin: ${backSpin.toFixed(0)}, Side Spin: ${sideSpin.toFixed(0)}`);


    // --- Prepare for Simulation ---
    const staticLoft = selectedClub.loft;
    const dynamicLoftFactor = 0.5; // Keep this for launch angle calculation
    launchAngle = staticLoft + attackAngle * dynamicLoftFactor; // Calculate launch angle
    const minLaunch = selectedClub.name === 'Driver' ? 5 : (selectedClub.loft / 3);
    const maxLaunch = selectedClub.name === 'Driver' ? 25 : (selectedClub.loft * 1.2);
    launchAngle = Math.max(minLaunch, Math.min(maxLaunch, launchAngle));
    // const maxLaunch = selectedClub.name === 'Driver' ? 25 : (selectedClub.loft * 1.2); // REMOVED Duplicate
    // launchAngle = Math.max(minLaunch, Math.min(maxLaunch, launchAngle)); // REMOVED Duplicate
    // console.log(`Club Loft: ${staticLoft}, Estimated Launch Angle: ${launchAngle.toFixed(1)} deg`); // REMOVED Duplicate

    // --- Calculate Initial Vectors for Simulation ---
    const ballSpeedMPS = ballSpeed * 0.44704; // Convert mph to m/s
    const launchAngleRad = launchAngle * Math.PI / 180;

    // Initial velocity components
    const initialVelY = ballSpeedMPS * Math.sin(launchAngleRad);
    const initialVelHorizontalMag = ballSpeedMPS * Math.cos(launchAngleRad);

    // Determine initial X/Z velocity based on side spin (simple model: side spin affects initial direction)
    // We need a relationship between sideSpin RPM and initial side angle/velocity.
    // Let's try a simple linear relationship for side angle first (needs tuning).
    // Max side spin ~4000rpm. Max angle ~5 deg? => angle = sideSpin / 800
    const sideAngleDeg = sideSpin / 800; // Degrees off target line
    const sideAngleRad = sideAngleDeg * Math.PI / 180;

    const initialVelX = initialVelHorizontalMag * Math.sin(sideAngleRad);
    const initialVelZ = initialVelHorizontalMag * Math.cos(sideAngleRad);

    const initialVelocity = { x: initialVelX, y: initialVelY, z: initialVelZ };
    const initialPosition = { x: 0, y: 0.1, z: 0 }; // Start slightly above ground

    // Define Spin Vector (RPM) - This is a simplification!
    // Assumes backspin is around world X, sidespin around world Y.
    // Positive side spin (slice) means spin around positive Y axis? (Needs verification/tuning)
    const spinVectorRPM = { x: backSpin, y: sideSpin, z: 0 };

    // --- Run Simulation ---
    const simulationResult = simulateFlightStepByStep(initialPosition, initialVelocity, spinVectorRPM);

    // --- Extract Results from Simulation ---
    carryDistance = simulationResult.carryDistance;
    peakHeight = simulationResult.peakHeight;
    const visualTimeOfFlight = Math.max(0.5, Math.min(5.0, simulationResult.timeOfFlight)); // Clamp visual time

    console.log(`Simulated Time of Flight: ${simulationResult.timeOfFlight.toFixed(2)}s`);
    console.log(`Simulated Carry: ${carryDistance.toFixed(1)} yd, Peak Height: ${peakHeight.toFixed(1)} yd`);

    // --- Calculate Rollout (Revised Logic for Spin Effect) ---
    let baseRollFactor = 0.06; // Lower base roll factor (6%)
    if (strikeQuality === "Thin") {
        baseRollFactor += 0.08; // Thin shots roll a bit more
    } else if (strikeQuality === "Fat") {
        baseRollFactor -= 0.04; // Fat shots roll less
    }
    baseRollFactor = Math.max(0.01, baseRollFactor); // Ensure base roll doesn't go below 1%

    // New spin factor: Target zero roll around 7500rpm, allow negative for higher spin. More sensitive.
    const targetSpinForZeroRoll = 7500; // Increased target slightly
    const spinSensitivity = 3500; // Increased sensitivity (smaller number = more sensitive)
    // Factor increases below target, decreases (potentially negative) above target
    const spinRollFactor = 1 - (backSpin - targetSpinForZeroRoll) / spinSensitivity;

    console.log(`Rollout Factors: Base=${baseRollFactor.toFixed(2)}, SpinFactor=${spinRollFactor.toFixed(2)} (BackSpin: ${backSpin.toFixed(0)})`);

    // Calculate initial rollout based on carry, base factor, and spin factor
    rolloutDistance = carryDistance * baseRollFactor * spinRollFactor;

    // Clamp rollout: Allow negative (spin back), but limit max positive roll.
    const maxPositiveRollFactor = 0.25; // Max positive roll is 25% of carry
    const minNegativeRollFactor = -0.08; // Max spin back is 8% of carry (increased slightly)

    rolloutDistance = Math.max(carryDistance * minNegativeRollFactor, rolloutDistance); // Apply min (negative) clamp
    rolloutDistance = Math.min(carryDistance * maxPositiveRollFactor, rolloutDistance); // Apply max (positive) clamp

    totalDistance = carryDistance + rolloutDistance; // Total distance correctly accounts for negative rollout

    console.log(`Calculated Rollout: ${rolloutDistance.toFixed(1)} yd, Total Distance: ${totalDistance.toFixed(1)} yd`);


    let spinDesc = "";
    if (Math.abs(sideSpin) < 300) spinDesc = "Straight";
    else if (sideSpin > 0) spinDesc = sideSpin > 1000 ? "Slice" : "Fade";
    else spinDesc = sideSpin < -1000 ? "Hook" : "Draw";
    resultMessage = `${strikeQuality} ${spinDesc}.`;

    // --- Update UI ---
    ui.updateResultDisplay({
        message: resultMessage,
        chs: clubHeadSpeed,
        ballSpeed: ballSpeed,
        attackAngle: attackAngle,
        backSpin: backSpin,
        sideSpin: sideSpin,
        peakHeight: peakHeight,
        carryDistance: carryDistance,
        rolloutDistance: rolloutDistance, // Add rollout
        totalDistance: totalDistance // Add total
    });
    gameState = 'result';
    ui.updateStatus('Result - Press (n) for next shot');

    // --- Trigger Visual Animation ---
    const shotDataForVisuals = {
        carryDistance: carryDistance,
        peakHeight: peakHeight,
        sideSpin: sideSpin, // Used to calculate curve/deviation
        timeOfFlight: visualTimeOfFlight, // Pass clamped visual time of flight
        rolloutDistance: rolloutDistance // Pass rollout distance
    };
    // --- Calculate Trajectory Points ---
    // Pass the full shotData including rollout
    const trajectoryPoints = calculateTrajectoryPoints(shotDataForVisuals);
    shotDataForVisuals.trajectory = trajectoryPoints; // Add points to data for visuals

    visuals.animateBallFlight(shotDataForVisuals); // Call the animation function
}

// --- Trajectory Calculation ---
function calculateTrajectoryPoints(shotData) {
    const airPoints = []; // Points during flight
    const rollPoints = []; // Points during roll
    const airSteps = 50; // Number of points in the air line
    const rollSteps = 10; // Number of points for the roll segment

    const carryYards = shotData.carryDistance;
    const peakYards = shotData.peakHeight;
    const sideDeviationYards = shotData.sideSpin / 150; // Simple linear deviation based on spin

    // Convert yards to scene units (assuming meters for now, adjust if needed)
    const carryMeters = carryYards / 1.09361;
    const peakMeters = peakYards / 1.09361;
    // Apply correction based on observation: Slice (positive sideSpin) was going left.
    // We need positive sideSpin to result in positive X (right visually).
    // The current calculation results in positive X, but it appears left.
    // So, we negate the deviation to flip the visual direction.
    const sideDeviationMeters = (sideDeviationYards / 1.09361) * -1.0;


    // Simple parabolic trajectory calculation (y = ax^2 + bx + c)
    // We know:
    // 1. Starts at (0, 0) [z=0, y=BALL_RADIUS ~ 0]
    // 2. Peaks at (carryMeters / 2, peakMeters)
    // 3. Ends at (carryMeters, 0) [z=carryMeters, y=BALL_RADIUS ~ 0]

    // Vertex form for parabola: y = a(z - h)^2 + k where (h, k) is the vertex
    const h = carryMeters / 2; // z-coordinate of vertex
    const k = peakMeters;      // y-coordinate of vertex
    // Use the starting point (0, BALL_RADIUS ~ 0) to find 'a'
    // BALL_RADIUS = a(0 - h)^2 + k => a = (BALL_RADIUS - k) / h^2
    const a = (0.2 - k) / (h * h); // Use BALL_RADIUS for slightly more accuracy start/end

    // Calculate air points
    for (let i = 0; i <= airSteps; i++) {
        const progress = i / airSteps; // 0 to 1
        const z = progress * carryMeters;

        // Calculate vertical position (parabola)
        let y = a * (z - h) * (z - h) + k;
        y = Math.max(0.2, y); // Ensure y doesn't go below ground (use BALL_RADIUS)

        // Calculate horizontal position (use a parabolic curve for side deviation)
        // Similar to vertical: x = ax^2 + bx + c, but using z as the independent variable
        // We want x=0 at z=0 and x=sideDeviationMeters at z=carryMeters
        // Let's make it peak sideways halfway (like height peaks halfway)
        // Vertex form: x = a_side * (z - h_side)^2 + k_side
        // Vertex (peak sideways deviation) is at z = carryMeters / 2
        // Let's assume peak deviation is roughly proportional to total deviation, maybe 1.2x? (Needs tuning)
        // Or simpler: Make the curve start flat and curve more towards the end.
        // Let's try a simple quadratic: x = c*z^2. We know x=sideDev at z=carry.
        // sideDeviationMeters = c * carryMeters^2 => c = sideDeviationMeters / (carryMeters^2)
        let x = 0;
        if (carryMeters > 0.1) { // Avoid division by zero if carry is tiny
             const c_side = sideDeviationMeters / (carryMeters * carryMeters);
             x = c_side * z * z;
        }


        airPoints.push({ x: x, y: y, z: z });
    }

    // Calculate roll points (straight line from landing point)
    const landingPoint = airPoints[airSteps]; // Last point of air trajectory
    const rolloutMeters = (shotData.rolloutDistance || 0) / 1.09361;
    const totalDistanceMeters = carryMeters + rolloutMeters;

    if (rolloutMeters > 0.1 && rollSteps > 0) { // Only add roll if significant
        const rollStartX = landingPoint.x;
        const rollStartZ = landingPoint.z;
        // Assume roll continues in the same horizontal direction as landing
        let directionX = landingPoint.x - (airPoints[airSteps - 1]?.x || 0);
        let directionZ = landingPoint.z - (airPoints[airSteps - 1]?.z || 0);
        const length = Math.sqrt(directionX * directionX + directionZ * directionZ);

        // Normalize the direction vector manually
        if (length > 0.001) { // Avoid division by zero
            directionX /= length;
            directionZ /= length;
        } else {
            // If landing point is same as previous, assume roll goes straight forward (positive Z)
            directionX = 0;
            directionZ = 1;
        }


        for (let i = 1; i <= rollSteps; i++) { // Start from 1 as landingPoint is step 0
            const rollProgress = i / rollSteps; // 0 to 1 for roll segment
            const currentRollDistance = rollProgress * rolloutMeters;

            const x = rollStartX + directionX * currentRollDistance; // Use normalized directionX
            const z = rollStartZ + directionZ * currentRollDistance; // Use normalized directionZ
            const y = 0.2; // Ball sits on the ground (BALL_RADIUS)

            rollPoints.push({ x: x, y: y, z: z });
        }
    }

    const allPoints = [...airPoints, ...rollPoints]; // Combine air and roll points

    console.log(`Calculated ${airPoints.length} air + ${rollPoints.length} roll points. End: (${allPoints[allPoints.length - 1].x.toFixed(1)}, ${allPoints[allPoints.length - 1].y.toFixed(1)}, ${allPoints[allPoints.length - 1].z.toFixed(1)})`);
    return allPoints;
}

// --- Step-by-Step Flight Simulation ---
function simulateFlightStepByStep(initialPos, initialVel, spinVec) {
    const trajectoryPoints = [initialPos]; // Start with the initial position
    let position = { ...initialPos }; // Current position (copy)
    let velocity = { ...initialVel }; // Current velocity (copy)
    let time = 0;
    const dt = 0.01; // Time step in seconds
    const gravity = 9.81;
    let peakHeight = initialPos.y;

    // --- Simulation Constants (Tunable) ---
    const Cd = 0.25; // Drag coefficient (placeholder)
    const Cl = 0.00005; // Lift coefficient (placeholder, related to spin)
    const airDensity = 1.225; // kg/m^3 (standard air density)
    const ballArea = Math.PI * (0.04267 / 2) * (0.04267 / 2); // Cross-sectional area of golf ball (m^2)
    const ballMass = 0.04593; // kg (standard golf ball mass)
    // Pre-calculate constant part of drag/lift force calculation
    const dragConst = -0.5 * airDensity * ballArea * Cd / ballMass;
    const liftConst = 0.5 * airDensity * ballArea * Cl / ballMass;
    // --- End Constants ---

    console.log("Starting step-by-step simulation...");
    console.log(`Initial Vel: (${velocity.x.toFixed(2)}, ${velocity.y.toFixed(2)}, ${velocity.z.toFixed(2)}) m/s`);
    console.log(`Spin Vec: (${spinVec.x.toFixed(0)}, ${spinVec.y.toFixed(0)}, ${spinVec.z.toFixed(0)}) rpm? (Needs conversion)`); // Spin units need clarification

    // Convert spin from RPM to rad/s (approximate axis for now)
    // Assuming side spin is around Y axis, back spin around X axis relative to path
    // This needs refinement based on how side/back spin are defined relative to world coords
    const spinRadPerSec = {
        x: (spinVec.x || 0) * (2 * Math.PI / 60), // Backspin around X
        y: (spinVec.y || 0) * (2 * Math.PI / 60), // Sidespin around Y
        z: (spinVec.z || 0) * (2 * Math.PI / 60)  // Rifle spin? (Assume 0 for now)
    };
     console.log(`Spin rad/s: (${spinRadPerSec.x.toFixed(2)}, ${spinRadPerSec.y.toFixed(2)}, ${spinRadPerSec.z.toFixed(2)})`);


    while (position.y > 0.01) { // Loop until ball is near/below ground
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

        // 3. Net Acceleration
        const accel_net = {
            x: accel_gravity.x + accel_drag.x + accel_lift.x,
            y: accel_gravity.y + accel_drag.y + accel_lift.y,
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
    }

    console.log(`Simulation finished. Time: ${time.toFixed(2)}s, Steps: ${trajectoryPoints.length}`);
    const landingPosition = trajectoryPoints[trajectoryPoints.length - 1];
    const carryDistanceMeters = Math.sqrt(landingPosition.x**2 + landingPosition.z**2);

    return {
        landingPosition: landingPosition,
        carryDistance: carryDistanceMeters * 1.09361, // Convert to yards
        peakHeight: peakHeight * 1.09361, // Convert to yards
        timeOfFlight: time, // Actual simulated time
        trajectoryPoints: trajectoryPoints // Array of {x, y, z} objects
    };
}


// Helper to get current timing data for debug display
function getDebugTimingData() {
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
        hipInitiationOffset: hipInitiationTime ? hipInitiationTime - backswingEndTime : null, // Added hip offset
    };
}

// Export reset function for button/key binding
export const resetSwing = resetSwingState;
