import { clubs } from './clubs.js';
import * as ui from './ui.js';
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
    // Explicitly log state just before checking 'w'
    console.log(`handleKeyDown Check: Key='${event.key}', State='${gameState}'`);

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

    // Capture 'h' press (Hip Initiation)
    if (event.key === 'h' && (gameState === 'backswing' || gameState === 'backswingPausedAtTop') && !hipInitiationTime) {
        hipInitiationTime = performance.now();
        console.log(`'h' pressed at ${hipInitiationTime.toFixed(0)}ms. State: ${gameState}`);
        ui.updateStatus("Hips Initiated..."); // Update status

        // If paused at top, pressing 'h' starts the downswing phase immediately
        if (gameState === 'backswingPausedAtTop') {
            gameState = 'downswingWaiting';
            ui.updateStatus('Downswing: Press a, s, d...');
            console.log("Transitioning from Paused to DownswingWaiting due to 'h' press.");
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

        // Check keys in the new sequence: a (rotation), j (arms), d (wrists)
        if (event.key === 'j' && !armsStartTime) { // 'j' now controls Arms
            armsStartTime = timeNow;
            ui.showKeyPressMarker('j', offset, swingSpeed); // Pass 'j' to UI
            ui.updateDebugTimingInfo(getDebugTimingData());
            console.log(`'j' (Arms) pressed at offset: ${offset.toFixed(0)} ms`);
        } else if (event.key === 'd' && !wristsStartTime) { // 'd' still controls Wrists
            wristsStartTime = timeNow;
            ui.showKeyPressMarker('d', offset, swingSpeed);
             ui.updateDebugTimingInfo(getDebugTimingData());
           console.log(`'d' (Wrists) pressed at offset: ${offset.toFixed(0)} ms`);
        } else if (event.key === 'a' && !rotationStartTime && !rotationInitiationTime) { // 'a' now controls Rotation
            rotationStartTime = timeNow;
            ui.showKeyPressMarker('a', offset, swingSpeed); // Pass 'a' to UI
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

    // Ideal offsets remain associated with the ACTION, but triggered by NEW KEYS
    const idealTransitionOffset = -50 / swingSpeed; // Transition (early rotation 'a' or regular 'a')
    const idealRotationOffset = 50 / swingSpeed;    // Rotation ('a' key)
    const idealArmsOffset = 100 / swingSpeed;       // Arms ('j' key)
    const idealWristsOffset = 200 / swingSpeed;     // Wrists ('d' key)

    // Assign large penalty time if input is missing, instead of Infinity
    const MAX_PENALTY_TIME_MS = 5000;
    const effectiveArmsStartTime = armsStartTime !== null ? armsStartTime : backswingEndTime + MAX_PENALTY_TIME_MS; // Triggered by 'j'
    const effectiveWristsStartTime = wristsStartTime !== null ? wristsStartTime : backswingEndTime + MAX_PENALTY_TIME_MS; // Triggered by 'd'
    // Use rotationStartTime ('a' press) if available, otherwise use rotationInitiationTime ('a' press early) if available, otherwise penalty
    const effectiveRotationStartTime = rotationStartTime !== null ? rotationStartTime : (rotationInitiationTime !== null ? rotationInitiationTime : backswingEndTime + MAX_PENALTY_TIME_MS); // Triggered by 'a'
    // Transition time is based on when rotation was initiated ('a' key, early or regular)
    const effectiveTransitionTime = rotationInitiationTime !== null ? rotationInitiationTime : effectiveRotationStartTime;


    // Calculate deviations using the correct ideal offsets for each action's effective time
    const transitionDev = (effectiveTransitionTime - backswingEndTime) - idealTransitionOffset; // Based on 'a' timing
    const rotationDev = (effectiveRotationStartTime - backswingEndTime) - idealRotationOffset; // Based on 'a' timing
    const armsDev = (effectiveArmsStartTime - backswingEndTime) - idealArmsOffset;             // Based on 'j' timing
    const wristsDev = (effectiveWristsStartTime - backswingEndTime) - idealWristsOffset;       // Based on 'd' timing

    console.log(`Deviations - Rotation('a'): ${rotationDev.toFixed(0)}, Arms('j'): ${armsDev.toFixed(0)}, Wrists('d'): ${wristsDev.toFixed(0)}`); // Updated log

    // --- Calculate Potential CHS based on new basePotentialSpeed ---
    const backswingLengthFactor = 1 - Math.min(0.5, Math.abs(backswingDuration - IDEAL_BACKSWING_DURATION_MS) / IDEAL_BACKSWING_DURATION_MS);
    const baseSpeed = selectedClub.basePotentialSpeed || 90; // Get base speed, fallback to 90
    console.log(`Club: ${selectedClub.name}, Base Potential Speed: ${baseSpeed} mph`);
    console.log(`Backswing Duration: ${backswingDuration.toFixed(0)}ms, Ideal: ${IDEAL_BACKSWING_DURATION_MS}ms, Length Factor: ${backswingLengthFactor.toFixed(2)}`);

    // Calculate potential CHS based on base speed, length factor, and swing speed slider
    let potentialCHS = baseSpeed * backswingLengthFactor * swingSpeed;

    // Apply a minimum speed clamp (e.g., 60% of base potential, also scaled by slider)
    const minPotentialCHS = baseSpeed * 0.6 * swingSpeed;
    potentialCHS = Math.max(minPotentialCHS, potentialCHS);
    console.log(`Potential CHS (after length factor, speed slider, min clamp): ${potentialCHS.toFixed(1)} mph`);

    // --- Apply Penalties ---
    // Sequence Penalty
    const sequencePenaltyFactor = Math.max(0.6, 1 - (Math.abs(armsDev) + Math.abs(rotationDev) + Math.abs(wristsDev)) / (1500 / swingSpeed));
    clubHeadSpeed = potentialCHS * sequencePenaltyFactor;

    let overswingPenalty = 0;
    if (backswingDuration > BACKSWING_BAR_MAX_DURATION_MS) {
        overswingPenalty = Math.min(0.3, (backswingDuration - BACKSWING_BAR_MAX_DURATION_MS) / 1000);
        clubHeadSpeed *= (1 - overswingPenalty);
        console.log(`Overswing Penalty Applied: ${(overswingPenalty * 100).toFixed(1)}%`);
    }
    console.log(`Sequence Penalty Factor: ${sequencePenaltyFactor.toFixed(2)}`);
    clubHeadSpeed = potentialCHS * sequencePenaltyFactor;

    // Overswing Penalty (Declaration removed from here, kept below)
    // let overswingPenalty = 0; // REMOVED redundant declaration
    if (backswingDuration > BACKSWING_BAR_MAX_DURATION_MS) {
        // Calculate penalty
        const overswingPenalty = Math.min(0.3, (backswingDuration - BACKSWING_BAR_MAX_DURATION_MS) / 1000); // Keep calculation
        clubHeadSpeed *= (1 - overswingPenalty);
        console.log(`Overswing Penalty Applied: ${(overswingPenalty * 100).toFixed(1)}%`);
    }
    console.log(`Final CHS (after penalties): ${clubHeadSpeed.toFixed(1)} mph`);


    // --- Calculate other shot parameters ---
    const baseAoA = selectedClub.baseAoA;
    const aoaAdjustment = Math.max(-5, Math.min(5, -armsDev / (20 / swingSpeed))); // Still based on armsDev ('j' key timing)
    attackAngle = baseAoA + aoaAdjustment;
    console.log(`Club Base AoA: ${baseAoA}, ArmsDev: ${armsDev.toFixed(0)}, AoA Adjust: ${aoaAdjustment.toFixed(1)}, Final AoA: ${attackAngle.toFixed(1)}`);

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
    console.log(`Face Angle Dev: ${faceAngleDev.toFixed(1)}, Path Dev: ${pathDev.toFixed(1)}, Face-to-Path: ${faceToPath.toFixed(1)}`);
    console.log(`Back Spin: ${backSpin.toFixed(0)}, Side Spin: ${sideSpin.toFixed(0)}`);

    const staticLoft = selectedClub.loft;
    const dynamicLoftFactor = 0.5; // Reduced from 0.8 to lower launch angle influence
    launchAngle = staticLoft + attackAngle * dynamicLoftFactor;
    const minLaunch = selectedClub.name === 'Driver' ? 5 : (selectedClub.loft / 3);
    const maxLaunch = selectedClub.name === 'Driver' ? 25 : (selectedClub.loft * 1.2);
    launchAngle = Math.max(minLaunch, Math.min(maxLaunch, launchAngle));
    console.log(`Club Loft: ${staticLoft}, Estimated Launch Angle: ${launchAngle.toFixed(1)} deg`);

    const gravity = 9.81; // m/s^2
    const ballSpeedMPS = ballSpeed * 0.44704; // Convert mph to m/s
    const launchAngleRad = launchAngle * Math.PI / 180;
    const vy0 = ballSpeedMPS * Math.sin(launchAngleRad); // Initial vertical velocity
    const vx0 = ballSpeedMPS * Math.cos(launchAngleRad); // Initial horizontal velocity (in launch direction)

    // Calculate time of flight based on vertical motion (vy = vy0 - g*t)
    // Time to peak height (when vy = 0) is t_peak = vy0 / gravity
    // Total time of flight (ignoring air resistance) is 2 * t_peak
    let timeOfFlight = (2 * vy0) / gravity;
    const rawTimeOfFlight = timeOfFlight; // Store raw ToF for physics

    // Clamp visual animation duration for sensibility (e.g., 0.5s to 5s)
    const visualTimeOfFlight = Math.max(0.5, Math.min(5.0, timeOfFlight));

    // --- Apply Basic Drag ---
    // Simple drag factor reducing distance based on raw time of flight
    // Reduced coefficient significantly from 0.08 to 0.02, increased min effect
    const dragFactor = Math.max(0.7, 1 - (rawTimeOfFlight * 0.02));
    console.log(`Drag Factor (based on raw ToF ${rawTimeOfFlight.toFixed(2)}s): ${dragFactor.toFixed(3)}`);

    const carryMeters = vx0 * rawTimeOfFlight * dragFactor; // Apply drag factor to distance based on raw ToF
    let carryDistance_preSpinFactors = carryMeters * 1.09361; // Convert meters to yards

    // --- Apply Absolute Spin Penalty ---
    // Reduce carry based on *total* spin magnitude and launch angle
    const totalSpinMagnitude = Math.sqrt(backSpin * backSpin + sideSpin * sideSpin);
    console.log(`Total Spin Magnitude: ${totalSpinMagnitude.toFixed(0)}rpm`);
    // Tunable constants: spin divisor (40k), launch divisor (30), min factor (0.7)
    const absoluteSpinPenalty = Math.max(0.7, 1 - (totalSpinMagnitude / 40000) * (launchAngle / 30));
    console.log(`Absolute Spin Penalty Factor (Total Spin): ${absoluteSpinPenalty.toFixed(3)}`);
    carryDistance = carryDistance_preSpinFactors * absoluteSpinPenalty; // Apply absolute penalty first

    const peakHeightMeters = (vy0 * vy0) / (2 * gravity); // Peak height calculation remains similar
    peakHeight = peakHeightMeters * 1.09361;

    // --- Apply Deviation-from-Optimal Spin Factor ---
    // Use club-specific optimalSpin for factors
    const optimalSpin = selectedClub.optimalSpin || 7000; // Fallback to 7000 (7i)
    const spinDeviation = backSpin - optimalSpin;
    console.log(`Spin Deviation from Optimal (${optimalSpin}rpm): ${spinDeviation.toFixed(0)}rpm`);

    // Calculate factors based on deviation from club's optimal spin
    // Adjust denominator based on typical spin range/sensitivity per club type (needs tuning)
    const carrySpinDenominator = optimalSpin < 4000 ? 15000 : 12000; // Lower denominator for low-spin clubs?
    const heightSpinDenominator = optimalSpin < 4000 ? 20000 : 18000;

    const spinCarryFactor = Math.max(0.6, Math.min(1.15, 1 - spinDeviation / carrySpinDenominator));
    const spinHeightFactor = Math.max(0.8, Math.min(1.25, 1 + spinDeviation / heightSpinDenominator));
    carryDistance *= spinCarryFactor; // Apply spin factor AFTER drag
    peakHeight *= spinHeightFactor;
    // Keep only min distance clamp
    carryDistance = Math.max(10, carryDistance);
    peakHeight = Math.max(5, Math.min(60, peakHeight)); // Keep height clamps
    console.log(`Time of Flight (simple): ${rawTimeOfFlight.toFixed(2)}s`); // Log raw time
    console.log(`Carry: ${carryDistance.toFixed(1)} yd, Peak Height: ${peakHeight.toFixed(1)} yd (Spin factors C:${spinCarryFactor.toFixed(2)} H:${spinHeightFactor.toFixed(2)})`);

    // --- Calculate Rollout ---
    let baseRollFactor = 0.1; // Base 10% roll
    if (strikeQuality === "Thin") {
        baseRollFactor += 0.15; // Thin shots roll more
    } else if (strikeQuality === "Fat") {
        baseRollFactor -= 0.08; // Fat shots roll less
    }
    // Lower spin = more roll
    const spinRollFactor = Math.max(0.5, Math.min(1.5, 1 - (backSpin - 4000) / 5000));
    // Lower landing angle (approximated by launch angle) = more roll
    const landingAngleFactor = Math.max(0.7, Math.min(1.3, 1 - (launchAngle - 15) / 20));

    rolloutDistance = carryDistance * baseRollFactor * spinRollFactor * landingAngleFactor;
    rolloutDistance = Math.max(0, Math.min(carryDistance * 0.5, rolloutDistance)); // Clamp rollout
    totalDistance = carryDistance + rolloutDistance;

    console.log(`Rollout Factors: Base=${baseRollFactor.toFixed(2)}, Spin=${spinRollFactor.toFixed(2)}, Angle=${landingAngleFactor.toFixed(2)}`);
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
