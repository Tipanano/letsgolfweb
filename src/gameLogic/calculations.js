import {
    getGameState, getCurrentShotType, getSelectedClub, getSwingSpeed,
    getBackswingDuration, getHipInitiationTime, getRotationStartTime,
    getRotationInitiationTime, getArmsStartTime, getWristsStartTime,
    getDownswingPhaseStartTime, getChipRotationStartTime, getChipWristsStartTime,
    getPuttHitTime, getOnShotCompleteCallback, setGameState,
    getBackswingStartTime, // <-- Added missing import
    getShotDirectionAngle, // <-- Gets RELATIVE angle
    getCurrentTargetLineAngle, // <-- Gets ABSOLUTE target line angle
    IDEAL_BACKSWING_DURATION_MS, PUTT_DISTANCE_FACTOR // Import constants from state
} from './state.js';
import { stopFullDownswingAnimation, stopChipDownswingAnimation /* Putt stopped in actions */ } from './animations.js';
import { updateStatus, getBallPositionIndex, getBallPositionLevels } from '../ui.js';
import { calculateImpactPhysics } from '../swingPhysics.js';
import { calculateChipImpact } from '../chipPhysics.js';
import { calculatePuttImpact } from '../puttPhysics.js';
import { simulateFlightStepByStep } from './simulation.js';
import { calculatePuttTrajectoryPoints } from './trajectory.js'; // Removed calculateTrajectoryPoints import
import { clamp } from './utils.js';
import { getCurrentGameMode } from '../main.js'; // Import mode checker
import { getCurrentBallPosition as getPlayHoleBallPosition } from '../modes/playHole.js'; // Import position getter
import { BALL_RADIUS } from '../visuals/core.js'; // Import BALL_RADIUS for default position

// --- Calculation Functions ---

export function calculateFullSwingShot() {
    const state = getGameState();
    const shotType = getCurrentShotType();
    if (state !== 'downswingWaiting' || shotType !== 'full') return;

    // Stop full downswing timing bar animation
    stopFullDownswingAnimation();

    setGameState('calculating');
    updateStatus('Calculating Full Swing...');
    console.log("Calc: Calculating Full Swing Shot...");

    // --- Prepare Inputs for swingPhysics Module ---
    const ballPositionIndex = getBallPositionIndex();
    const ballPositionLevels = getBallPositionLevels();
    const centerIndex = Math.floor(ballPositionLevels / 2);
    // Calculate ball position factor: -1 (Fwd) to +1 (Back), 0 for Center
    const ballPositionFactor = ballPositionLevels > 1 ? (centerIndex - ballPositionIndex) / centerIndex : 0;
    console.log(`Calc (Full): Ball Position: Index=${ballPositionIndex}, Factor=${ballPositionFactor.toFixed(2)} (-1=Fwd, 0=Ctr, +1=Back)`);

    const backswingDuration = getBackswingDuration();
    const swingSpeed = getSwingSpeed();
    const backswingStartTime = getBackswingStartTime(); // Need start time for ideal end calc
    const selectedClub = getSelectedClub();

    // Calculate ideal backswing end time for transition reference
    const scaledIdealBackswingDuration = IDEAL_BACKSWING_DURATION_MS / swingSpeed;
    const idealBackswingEndTime = backswingStartTime ? backswingStartTime + scaledIdealBackswingDuration : null;

    const timingInputs = {
        backswingDuration: backswingDuration,
        hipInitiationTime: getHipInitiationTime(),
        rotationStartTime: getRotationStartTime(),
        rotationInitiationTime: getRotationInitiationTime(),
        armsStartTime: getArmsStartTime(),
        wristsStartTime: getWristsStartTime(),
        downswingPhaseStartTime: getDownswingPhaseStartTime(), // When the timing bars started
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
    const ballSpeed = impactResult.ballSpeed;
    const launchAngle = impactResult.launchAngle;
    const backSpin = impactResult.backSpin;
    const sideSpin = impactResult.sideSpin;
    const strikeQuality = impactResult.strikeQuality;
    let peakHeight = 0;
    let carryDistance = 0;
    let rolloutDistance = 0;
    let totalDistance = 0;
    let resultMessage = "";

    // --- Prepare for Simulation ---
    console.log("Calc (Full): --- Preparing Simulation ---");
    console.log(`Calc (Full): Launch Conditions: BallSpeed=${ballSpeed.toFixed(1)}mph, LaunchAngle=${launchAngle.toFixed(1)}deg, BackSpin=${backSpin.toFixed(0)}rpm, SideSpin=${sideSpin.toFixed(0)}rpm`);

    // --- Calculate Initial Vectors for Simulation ---
    const ballSpeedMPS = ballSpeed * 0.44704; // Convert mph to m/s
    const launchAngleRad = launchAngle * Math.PI / 180;
    const initialVelY = ballSpeedMPS * Math.sin(launchAngleRad);
    const initialVelHorizontalMag = ballSpeedMPS * Math.cos(launchAngleRad);
    // Get target line, physics deviation, and relative aim adjustment angles
    const targetLineAngleRad = getCurrentTargetLineAngle() * Math.PI / 180;
    const physicsDeviationRad = impactResult.absoluteFaceAngle * Math.PI / 180; // Deviation relative to target line
    const relativeAimAngleRad = getShotDirectionAngle() * Math.PI / 180; // Player's fine-tuning relative to target line
    // Calculate final absolute launch direction
    const finalLaunchDirectionRad = targetLineAngleRad + physicsDeviationRad + relativeAimAngleRad;
    console.log(`Calc (Full): TargetLine=${getCurrentTargetLineAngle().toFixed(1)}deg, PhysicsDev=${impactResult.absoluteFaceAngle.toFixed(1)}deg, RelativeAim=${getShotDirectionAngle().toFixed(1)}deg, FinalLaunchDir=${(finalLaunchDirectionRad * 180 / Math.PI).toFixed(1)}deg`);
    const initialVelX = initialVelHorizontalMag * Math.sin(finalLaunchDirectionRad); // Positive angle = positive X (right)
    const initialVelZ = initialVelHorizontalMag * Math.cos(finalLaunchDirectionRad); // Positive Z = forward
    const initialVelocity = { x: initialVelX, y: initialVelY, z: initialVelZ };
    const spinVectorRPM = { x: backSpin, y: sideSpin, z: 0 };

    // --- Determine Initial Position based on Game Mode ---
    let initialPosition;
    const currentMode = getCurrentGameMode();
    if (currentMode === 'play-hole') {
        initialPosition = getPlayHoleBallPosition();
        console.log('the new positions in playHole are', initialPosition);
        // Ensure y is at least BALL_RADIUS
        initialPosition.y = Math.max(BALL_RADIUS, initialPosition.y);
        console.log(`Calc (Full): Using PlayHole initial position: x=${initialPosition.x.toFixed(2)}, y=${initialPosition.y.toFixed(2)}, z=${initialPosition.z.toFixed(2)}`);
    } else {
        initialPosition = { x: 0, y: BALL_RADIUS, z: 0 }; // Default tee position for other modes
        console.log(`Calc (Full): Using default initial position: x=${initialPosition.x.toFixed(2)}, y=${initialPosition.y.toFixed(2)}, z=${initialPosition.z.toFixed(2)}`);
    }


    // --- Run Simulation ---
    const simulationResult = simulateFlightStepByStep(initialPosition, initialVelocity, spinVectorRPM, selectedClub);

    // --- Extract Results from Simulation ---
    carryDistance = simulationResult.carryDistance;
    peakHeight = simulationResult.peakHeight;
    const landingAngleRadians = simulationResult.landingAngleRadians;
    const visualTimeOfFlight = Math.max(0.5, Math.min(5.0, simulationResult.timeOfFlight)); // Clamp visual time

    console.log(`Calc (Full): Simulated Time of Flight: ${simulationResult.timeOfFlight.toFixed(2)}s`);
    console.log(`Calc (Full): Simulated Carry: ${carryDistance.toFixed(1)} yd, Peak Height: ${peakHeight.toFixed(1)} yd, Landing Angle: ${(landingAngleRadians * 180 / Math.PI).toFixed(1)} deg`);

    // --- Calculate Rollout ---
    let baseRollFactor = 0.06;
    switch (strikeQuality) {
        case "Thin": baseRollFactor += 0.08; break;
        case "Punch": baseRollFactor += 0.04; break;
        case "Fat": baseRollFactor -= 0.04; break;
        case "Flip": baseRollFactor -= 0.02; break;
    }
    baseRollFactor = Math.max(0.01, baseRollFactor);
    const targetSpinForZeroRoll = 7500;
    const spinSensitivity = 3500;
    const spinRollFactor = 1 - (backSpin - targetSpinForZeroRoll) / spinSensitivity;
    const landingAngleFactor = clamp(Math.pow(Math.cos(landingAngleRadians), 0.5), 0.1, 1.5);
    console.log(`Calc (Full): Rollout Factors: Base=${baseRollFactor.toFixed(2)} (Strike: ${strikeQuality}), SpinFactor=${spinRollFactor.toFixed(2)} (BackSpin: ${backSpin.toFixed(0)}), AngleFactor=${landingAngleFactor.toFixed(2)} (Angle: ${(landingAngleRadians * 180 / Math.PI).toFixed(1)} deg)`);
    rolloutDistance = carryDistance * baseRollFactor * spinRollFactor * landingAngleFactor;
    const maxPositiveRollFactor = 0.25;
    const minNegativeRollFactor = -0.08;
    rolloutDistance = Math.max(carryDistance * minNegativeRollFactor, rolloutDistance);
    rolloutDistance = Math.min(carryDistance * maxPositiveRollFactor, rolloutDistance);
    totalDistance = carryDistance + rolloutDistance;
    console.log(`Calc (Full): Calculated Rollout: ${rolloutDistance.toFixed(1)} yd, Total Distance: ${totalDistance.toFixed(1)} yd`);

    // --- Determine Result Message ---
    let spinDesc = "";
    const absSideSpin = Math.abs(sideSpin);
    if (absSideSpin < 300) spinDesc = "Straight";
    else if (sideSpin > 0) spinDesc = absSideSpin > 1500 ? "Slice" : "Fade";
    else spinDesc = absSideSpin > 1500 ? "Hook" : "Draw";
    let startDirPrefix = "";
    const pathThreshold = 3.5;
    if (impactResult.clubPathAngle > pathThreshold) startDirPrefix = "Push ";
    else if (impactResult.clubPathAngle < -pathThreshold) startDirPrefix = "Pull ";
    resultMessage = `${strikeQuality} ${startDirPrefix}${spinDesc}.`;
    console.log(`Calc (Full): ResultMessage: Strike=${strikeQuality}, Path=${impactResult.clubPathAngle.toFixed(1)}, SideSpin=${sideSpin.toFixed(0)} => ${resultMessage}`);

    // --- Prepare Shot Data Object ---
    const shotData = {
        backswingDuration: backswingDuration,
        timingDeviations: {
            transition: impactResult.transitionDev,
            rotation: impactResult.rotationDev,
            arms: impactResult.armsDev,
            wrists: impactResult.wristsDev
        },
        ballPositionFactor: ballPositionFactor,
        message: resultMessage,
        clubHeadSpeed: impactResult.actualCHS,
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
        peakHeight: peakHeight,
        carryDistance: carryDistance,
        rolloutDistance: rolloutDistance,
        totalDistance: totalDistance,
        timeOfFlight: visualTimeOfFlight,
        trajectory: null,
        sideDistance: 0,
        finalPosition: { ...initialPosition } // Default final position (use determined initial pos)
    };

    // --- Use Simulation Trajectory Points ---
    // Optional: Downsample simulationResult.trajectoryPoints if needed for performance
    // const simplifiedTrajectory = downsamplePoints(simulationResult.trajectoryPoints, 5); // Example: keep every 5th point
    // shotData.trajectory = simplifiedTrajectory;
    shotData.trajectory = simulationResult.trajectoryPoints; // Use full simulation points for now

    // Calculate final side distance and position using simulation's landing position
    // (simulationResult.landingPosition already accounts for initialPosition)
    shotData.finalPosition = simulationResult.landingPosition;
    // Calculate side distance relative to initial position's X
    shotData.sideDistance = (simulationResult.landingPosition.x - initialPosition.x) * 1.09361; // Convert meters to yards
    console.log(`Calc (Full): Final Position: (${shotData.finalPosition.x.toFixed(1)}, ${shotData.finalPosition.y.toFixed(1)}, ${shotData.finalPosition.z.toFixed(1)})m`);
    console.log(`Calc (Full): Calculated Side Distance: ${shotData.sideDistance.toFixed(1)} yards (relative to start X: ${initialPosition.x.toFixed(1)}m)`);

    // Update internal state
    setGameState('result');
    console.log("Calc (Full): Shot calculation complete.");

    // --- Call Registered Callback ---
    const callback = getOnShotCompleteCallback();
    if (callback) {
        callback(shotData);
    } else {
        console.warn("Calc (Full): No shot completion callback registered.");
        updateStatus('Result (Callback Missing) - Press (n)');
    }
}


export function calculateChipShot() {
    const state = getGameState();
    const shotType = getCurrentShotType();
    // Check if state is 'calculatingChip' (set in animation timeout or action trigger)
    if (state !== 'calculatingChip' || shotType !== 'chip') return;

    // Stop any chip downswing timeout (already stopped if triggered by key press)
    stopChipDownswingAnimation();

    // Set state to generic 'calculating' now
    setGameState('calculating');
    updateStatus('Calculating Chip...');
    console.log("Calc: Calculating Chip Shot...");

    // --- Prepare Inputs for chipPhysics Module ---
    const ballPositionIndex = getBallPositionIndex();
    const ballPositionLevels = getBallPositionLevels();
    const centerIndex = Math.floor(ballPositionLevels / 2);
    const ballPositionFactor = ballPositionLevels > 1 ? (centerIndex - ballPositionIndex) / centerIndex : 0;
    const backswingDuration = getBackswingDuration();
    const downswingPhaseStartTime = getDownswingPhaseStartTime();
    const chipRotationStartTime = getChipRotationStartTime();
    const chipWristsStartTime = getChipWristsStartTime(); // Hit time
    const selectedClub = getSelectedClub();

    // Calculate chip timing offsets relative to downswingPhaseStartTime
    const rotationOffset = chipRotationStartTime ? chipRotationStartTime - downswingPhaseStartTime : null;
    const hitOffset = chipWristsStartTime ? chipWristsStartTime - downswingPhaseStartTime : null;

    console.log(`Calc (Chip): Inputs: Duration=${backswingDuration?.toFixed(0)}, DownswingStart=${downswingPhaseStartTime?.toFixed(0)}, RotTime=${chipRotationStartTime?.toFixed(0)}, HitTime=${chipWristsStartTime?.toFixed(0)}`);
    console.log(`Calc (Chip): Inputs: RotationOffset=${rotationOffset?.toFixed(0)}, HitOffset=${hitOffset?.toFixed(0)}, Club=${selectedClub.name}, BallPosFactor=${ballPositionFactor.toFixed(2)}`);

    // --- Call the chip physics calculation module ---
    const impactResult = calculateChipImpact(
        backswingDuration,
        rotationOffset,
        hitOffset,
        selectedClub,
        ballPositionFactor
    );

    // --- Use results from impactResult ---
    const ballSpeed = impactResult.ballSpeed;
    const launchAngle = impactResult.launchAngle;
    const backSpin = impactResult.backSpin;
    const sideSpin = impactResult.sideSpin;
    const strikeQuality = impactResult.strikeQuality;
    let peakHeight = 0;
    let carryDistance = 0;
    let rolloutDistance = 0;
    let totalDistance = 0;
    let resultMessage = impactResult.message || "Chip Result";

    // --- Prepare for Simulation ---
    console.log("Calc (Chip): --- Preparing Simulation ---");
    console.log(`Calc (Chip): Launch Conditions: BallSpeed=${ballSpeed.toFixed(1)}mph, LaunchAngle=${launchAngle.toFixed(1)}deg, BackSpin=${backSpin.toFixed(0)}rpm, SideSpin=${sideSpin.toFixed(0)}rpm`);

    // --- Calculate Initial Vectors for Simulation ---
    const ballSpeedMPS = ballSpeed * 0.44704;
    const launchAngleRad = launchAngle * Math.PI / 180;
    const initialVelY = ballSpeedMPS * Math.sin(launchAngleRad);
    const initialVelHorizontalMag = ballSpeedMPS * Math.cos(launchAngleRad);
    // Get target line, physics deviation, and relative aim adjustment angles
    const targetLineAngleRad = getCurrentTargetLineAngle() * Math.PI / 180;
    const physicsDeviationRad = impactResult.absoluteFaceAngle * Math.PI / 180; // Deviation relative to target line
    const relativeAimAngleRad = getShotDirectionAngle() * Math.PI / 180; // Player's fine-tuning relative to target line
    // Calculate final absolute launch direction
    const finalLaunchDirectionRad = targetLineAngleRad + physicsDeviationRad + relativeAimAngleRad;
    console.log(`Calc (Chip): TargetLine=${getCurrentTargetLineAngle().toFixed(1)}deg, PhysicsDev=${impactResult.absoluteFaceAngle.toFixed(1)}deg, RelativeAim=${getShotDirectionAngle().toFixed(1)}deg, FinalLaunchDir=${(finalLaunchDirectionRad * 180 / Math.PI).toFixed(1)}deg`);
    const initialVelX = initialVelHorizontalMag * Math.sin(finalLaunchDirectionRad);
    const initialVelZ = initialVelHorizontalMag * Math.cos(finalLaunchDirectionRad);
    const initialVelocity = { x: initialVelX, y: initialVelY, z: initialVelZ };
    const spinVectorRPM = { x: backSpin, y: sideSpin, z: 0 };

    // --- Determine Initial Position based on Game Mode ---
    let initialPosition;
    const currentMode = getCurrentGameMode();
    if (currentMode === 'play-hole') {
        initialPosition = getPlayHoleBallPosition();
        // Ensure y is at least BALL_RADIUS
        initialPosition.y = Math.max(BALL_RADIUS, initialPosition.y);
        console.log(`Calc (Chip): Using PlayHole initial position: x=${initialPosition.x.toFixed(2)}, y=${initialPosition.y.toFixed(2)}, z=${initialPosition.z.toFixed(2)}`);
    } else {
        initialPosition = { x: 0, y: BALL_RADIUS, z: 0 }; // Default tee position for other modes
        console.log(`Calc (Chip): Using default initial position: x=${initialPosition.x.toFixed(2)}, y=${initialPosition.y.toFixed(2)}, z=${initialPosition.z.toFixed(2)}`);
    }

    // --- Run Simulation ---
    const simulationResult = simulateFlightStepByStep(initialPosition, initialVelocity, spinVectorRPM, selectedClub);

    // --- Extract Results from Simulation ---
    carryDistance = simulationResult.carryDistance;
    peakHeight = simulationResult.peakHeight;
    const landingAngleRadians = simulationResult.landingAngleRadians;
    const visualTimeOfFlight = Math.max(0.2, Math.min(3.0, simulationResult.timeOfFlight)); // Shorter max time for chips?

    console.log(`Calc (Chip): Simulated Time of Flight: ${simulationResult.timeOfFlight.toFixed(2)}s`);
    console.log(`Calc (Chip): Simulated Carry: ${carryDistance.toFixed(1)} yd, Peak Height: ${peakHeight.toFixed(1)} yd, Landing Angle: ${(landingAngleRadians * 180 / Math.PI).toFixed(1)} deg`);

    // --- Calculate Rollout ---
    let baseRollFactor = 0.10;
    switch (strikeQuality) {
        case "Thin": baseRollFactor += 0.10; break;
        case "Fat": baseRollFactor -= 0.05; break;
    }
    baseRollFactor = Math.max(0.02, baseRollFactor);
    const targetSpinForZeroRoll = 5000;
    const spinSensitivity = 2500;
    const spinRollFactor = 1 - (backSpin - targetSpinForZeroRoll) / spinSensitivity;
    const landingAngleFactor = clamp(Math.pow(Math.cos(landingAngleRadians), 0.5), 0.1, 1.5);
    console.log(`Calc (Chip): Rollout Factors: Base=${baseRollFactor.toFixed(2)} (Strike: ${strikeQuality}), SpinFactor=${spinRollFactor.toFixed(2)} (BackSpin: ${backSpin.toFixed(0)}), AngleFactor=${landingAngleFactor.toFixed(2)} (Angle: ${(landingAngleRadians * 180 / Math.PI).toFixed(1)} deg)`);
    rolloutDistance = carryDistance * baseRollFactor * spinRollFactor * landingAngleFactor;
    const maxPositiveRollFactor = 0.35;
    const minNegativeRollFactor = -0.05;
    rolloutDistance = Math.max(carryDistance * minNegativeRollFactor, rolloutDistance);
    rolloutDistance = Math.min(carryDistance * maxPositiveRollFactor, rolloutDistance);
    totalDistance = carryDistance + rolloutDistance;
    console.log(`Calc (Chip): Calculated Rollout: ${rolloutDistance.toFixed(1)} yd, Total Distance: ${totalDistance.toFixed(1)} yd`);

    // --- Prepare Shot Data Object ---
    const shotData = {
        backswingDuration: backswingDuration,
        timingDeviations: { // Chip specific timing from physics result
            rotationDeviation: impactResult.timingDeviations?.rotationDeviation,
            hitDeviation: impactResult.timingDeviations?.hitDeviation,
        },
        ballPositionFactor: ballPositionFactor,
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
        peakHeight: peakHeight,
        carryDistance: carryDistance,
        rolloutDistance: rolloutDistance,
        totalDistance: totalDistance,
        timeOfFlight: visualTimeOfFlight,
        trajectory: null,
        sideDistance: 0,
        finalPosition: { ...initialPosition } // Default final position (use determined initial pos)
    };

    // --- Use Simulation Trajectory Points ---
    shotData.trajectory = simulationResult.trajectoryPoints; // Use simulation points

    // Calculate final side distance and position using simulation's landing position
    shotData.finalPosition = simulationResult.landingPosition;
    // Calculate side distance relative to initial position's X
    shotData.sideDistance = (simulationResult.landingPosition.x - initialPosition.x) * 1.09361; // Convert meters to yards
    console.log(`Calc (Chip): Final Position: (${shotData.finalPosition.x.toFixed(1)}, ${shotData.finalPosition.y.toFixed(1)}, ${shotData.finalPosition.z.toFixed(1)})m`);
    console.log(`Calc (Chip): Calculated Side Distance: ${shotData.sideDistance.toFixed(1)} yards (relative to start X: ${initialPosition.x.toFixed(1)}m)`);

    // Update internal state
    setGameState('result');
    console.log("Calc (Chip): Shot calculation complete.");

    // --- Call Registered Callback ---
    const callback = getOnShotCompleteCallback();
    if (callback) {
        callback(shotData);
    } else {
        console.warn("Calc (Chip): No shot completion callback registered.");
        updateStatus('Result (Callback Missing) - Press (n)');
    }
}


export function calculatePuttShot() {
    const state = getGameState();
    const shotType = getCurrentShotType();
    // Check if state is 'calculatingPutt' (set in animation timeout or action trigger)
    if (state !== 'calculatingPutt' || shotType !== 'putt') return;

    // Putt animation is stopped when 'i' is pressed (in actions.js) or on timeout (in animations.js)

    // Set state to generic 'calculating' now
    setGameState('calculating');
    updateStatus('Calculating Putt...');
    console.log("Calc: Calculating Putt Shot...");

    // --- Prepare Inputs for puttPhysics Module ---
    const backswingDuration = getBackswingDuration();
    const downswingPhaseStartTime = getDownswingPhaseStartTime();
    const puttHitTime = getPuttHitTime(); // Hit time

    // Calculate hit offset relative to downswingPhaseStartTime (W release)
    const hitOffset = puttHitTime ? puttHitTime - downswingPhaseStartTime : null; // Can be null if timed out

    console.log(`Calc (Putt): Inputs: Duration=${backswingDuration?.toFixed(0)}, DownswingStart=${downswingPhaseStartTime?.toFixed(0)}, HitTime=${puttHitTime?.toFixed(0)}`);
    console.log(`Calc (Putt): Inputs: HitOffset=${hitOffset?.toFixed(0)}`);

    // --- Call the putt physics calculation module ---
    const impactResult = calculatePuttImpact(
        backswingDuration,
        hitOffset // Pass offset (can be null)
    );

    // --- Use results from impactResult ---
    const ballSpeed = impactResult.ballSpeed;
    const horizontalLaunchAngle = impactResult.horizontalLaunchAngle; // Horizontal (Push/Pull)
    const strikeQuality = impactResult.strikeQuality; // Center, Push, Pull
    let resultMessage = impactResult.message || "Putt Result";

    // --- Simplified Putt Distance Calculation ---
    let totalDistance = ballSpeed * PUTT_DISTANCE_FACTOR; // Simple scaling factor
    totalDistance = Math.max(0.1, totalDistance); // Ensure minimum distance

    // Get target line, physics deviation, and relative aim adjustment angles
    const targetLineAngleRad = getCurrentTargetLineAngle() * Math.PI / 180;
    const physicsDeviationRad = horizontalLaunchAngle * Math.PI / 180; // Deviation relative to target line
    const relativeAimAngleRad = getShotDirectionAngle() * Math.PI / 180; // Player's fine-tuning relative to target line
    // Calculate final absolute launch direction
    const finalHorizontalLaunchAngleRad = targetLineAngleRad + physicsDeviationRad + relativeAimAngleRad;
    console.log(`Calc (Putt): TargetLine=${getCurrentTargetLineAngle().toFixed(1)}deg, PhysicsDev=${horizontalLaunchAngle.toFixed(1)}deg, RelativeAim=${getShotDirectionAngle().toFixed(1)}deg, FinalHorizAngle=${(finalHorizontalLaunchAngleRad * 180 / Math.PI).toFixed(1)}deg`);

    // Calculate side distance based on the *final* horizontal launch angle and total distance
    let sideDistance = totalDistance * Math.tan(finalHorizontalLaunchAngleRad);

    console.log(`Calc (Putt): BallSpeed=${ballSpeed.toFixed(1)}mph, Final HorizAngle=${(finalHorizontalLaunchAngleRad * 180 / Math.PI).toFixed(1)}deg`);
    console.log(`Calc (Putt): Calculated Total Distance: ${totalDistance.toFixed(1)} yd, Side Distance: ${sideDistance.toFixed(1)} yd`);

    // --- Prepare Shot Data Object ---
    const shotData = {
        backswingDuration: backswingDuration,
        timingDeviations: { // Putt specific timing from physics result
            hitDeviation: impactResult.timingDeviations?.hitDeviation,
        },
        ballPositionFactor: 0, // Not applicable for putt
        message: resultMessage,
        clubHeadSpeed: 0,
        ballSpeed: impactResult.ballSpeed,
        launchAngle: impactResult.launchAngle, // Vertical (fixed at 0)
        horizontalLaunchAngle: finalHorizontalLaunchAngleRad * 180 / Math.PI, // Store the FINAL angle in degrees
        attackAngle: 0,
        backSpin: impactResult.backSpin,
        sideSpin: impactResult.sideSpin, // Should be 0
        clubPathAngle: 0,
        absoluteFaceAngle: impactResult.horizontalLaunchAngle, // Use horizontal angle
        faceAngleRelPath: 0,
        strikeQuality: impactResult.strikeQuality,
        potentialCHS: 0,
        dynamicLoft: 0,
        smashFactor: 0,
        peakHeight: 0,
        carryDistance: 0,
        rolloutDistance: totalDistance, // All distance is rollout
        totalDistance: totalDistance,
        timeOfFlight: 0,
        trajectory: null,
        sideDistance: sideDistance,
        finalPosition: null // Will be calculated below
    };

    // --- Determine Initial Position based on Game Mode ---
    let initialPosition;
    const currentMode = getCurrentGameMode();
    if (currentMode === 'play-hole') {
        initialPosition = getPlayHoleBallPosition();
        // Ensure y is at least BALL_RADIUS
        initialPosition.y = Math.max(BALL_RADIUS, initialPosition.y);
        console.log(`Calc (Putt): Using PlayHole initial position: x=${initialPosition.x.toFixed(2)}, y=${initialPosition.y.toFixed(2)}, z=${initialPosition.z.toFixed(2)}`);
    } else {
        initialPosition = { x: 0, y: BALL_RADIUS, z: 0 }; // Default tee position for other modes
        console.log(`Calc (Putt): Using default initial position: x=${initialPosition.x.toFixed(2)}, y=${initialPosition.y.toFixed(2)}, z=${initialPosition.z.toFixed(2)}`);
    }

    // --- Calculate Trajectory Points (Simple Straight Line for Putt) ---
    // Pass initialPosition to the trajectory calculator
    const trajectoryPoints = calculatePuttTrajectoryPoints(shotData, initialPosition);
    shotData.trajectory = trajectoryPoints;

    // Set final position from trajectory (which now starts from the correct initialPosition)
    if (trajectoryPoints && trajectoryPoints.length > 0) {
        shotData.finalPosition = trajectoryPoints[trajectoryPoints.length - 1];
        console.log(`Calc (Putt): Final Position: x=${shotData.finalPosition.x.toFixed(2)}, y=${shotData.finalPosition.y.toFixed(2)}, z=${shotData.finalPosition.z.toFixed(2)}`);
    } else {
        // Fallback if trajectory calculation fails
        shotData.finalPosition = { ...initialPosition };
        console.warn("Calc (Putt): Trajectory calculation failed, using initial position as final.");
    }

    // Update internal state
    setGameState('result');
    console.log("Calc (Putt): Shot calculation complete.");

    // --- Call Registered Callback ---
    const callback = getOnShotCompleteCallback();
    if (callback) {
        callback(shotData);
    } else {
        console.warn("Calc (Putt): No shot completion callback registered.");
        updateStatus('Result (Callback Missing) - Press (n)');
    }
}
