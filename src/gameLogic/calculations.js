import {
    getGameState, getCurrentShotType, getSelectedClub, getSwingSpeed,
    getBackswingDuration, getHipInitiationTime, getRotationStartTime,
    getRotationInitiationTime, getArmsStartTime, getWristsStartTime,
    getDownswingPhaseStartTime, getChipRotationStartTime, getChipWristsStartTime,
    getPuttHitTime, getOnShotCompleteCallback, setGameState,
    getBackswingStartTime, // <-- Added missing import
    getShotDirectionAngle, // <-- Gets RELATIVE angle
    getCurrentTargetLineAngle, // <-- Gets ABSOLUTE target line angle
    IDEAL_BACKSWING_DURATION_MS // Removed PUTT_DISTANCE_FACTOR
} from './state.js';
import { stopFullDownswingAnimation, stopChipDownswingAnimation /* Putt stopped in actions */ } from './animations.js';
import { updateStatus, getBallPositionIndex, getBallPositionLevels } from '../ui.js';
import { calculateImpactPhysics } from '../swingPhysics.js';
import { calculateChipImpact } from '../chipPhysics.js';
import { calculatePuttImpact } from '../puttPhysics.js';
// Import both simulation functions and HOLE_RADIUS
import { simulateFlightStepByStep, simulateGroundRoll, HOLE_RADIUS_METERS } from './simulation.js';
// Removed Putt Trajectory import as roll simulation handles it
import { clamp } from './utils.js';
import { getCurrentGameMode } from '../main.js'; // Import mode checker
import { getCurrentBallPosition as getPlayHoleBallPosition } from '../modes/playHole.js'; // Import position getter
import { BALL_RADIUS, YARDS_TO_METERS } from '../visuals/core.js'; // Import BALL_RADIUS and conversion
import { getFlagPosition, getGreenCenter, getGreenRadius } from '../visuals/holeView.js'; // For hole/green checks
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js'; // For Vector3

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
    const ballPositionFactor = ballPositionLevels > 1 ? (centerIndex - ballPositionIndex) / centerIndex : 0;
    const backswingDuration = getBackswingDuration();
    const swingSpeed = getSwingSpeed();
    const backswingStartTime = getBackswingStartTime();
    const selectedClub = getSelectedClub();
    const scaledIdealBackswingDuration = IDEAL_BACKSWING_DURATION_MS / swingSpeed;
    const idealBackswingEndTime = backswingStartTime ? backswingStartTime + scaledIdealBackswingDuration : null;
    const timingInputs = { backswingDuration, hipInitiationTime: getHipInitiationTime(), rotationStartTime: getRotationStartTime(), rotationInitiationTime: getRotationInitiationTime(), armsStartTime: getArmsStartTime(), wristsStartTime: getWristsStartTime(), downswingPhaseStartTime: getDownswingPhaseStartTime(), idealBackswingEndTime };

    // --- Call the full swing physics calculation module ---
    const impactResult = calculateImpactPhysics(timingInputs, selectedClub, swingSpeed, ballPositionFactor);

    // --- Use results from impactResult ---
    const ballSpeed = impactResult.ballSpeed;
    const launchAngle = impactResult.launchAngle;
    const backSpin = impactResult.backSpin;
    const sideSpin = impactResult.sideSpin;
    const strikeQuality = impactResult.strikeQuality;
    let peakHeight = 0;
    let carryDistance = 0;
    let totalDistance = 0;
    let resultMessage = "";
    let isHoledOut = false;
    let finalPosition = null; // Will be Vector3

    // --- Prepare for Simulation ---
    console.log("Calc (Full): --- Preparing Simulation ---");
    console.log(`Calc (Full): Launch Conditions: BallSpeed=${ballSpeed.toFixed(1)}mph, LaunchAngle=${launchAngle.toFixed(1)}deg, BackSpin=${backSpin.toFixed(0)}rpm, SideSpin=${sideSpin.toFixed(0)}rpm`);

    // --- Calculate Initial Vectors for Simulation ---
    const ballSpeedMPS = ballSpeed * 0.44704;
    const launchAngleRad = launchAngle * Math.PI / 180;
    const initialVelY = ballSpeedMPS * Math.sin(launchAngleRad);
    const initialVelHorizontalMag = ballSpeedMPS * Math.cos(launchAngleRad);
    const targetLineAngleRad = getCurrentTargetLineAngle() * Math.PI / 180;
    const physicsDeviationRad = impactResult.absoluteFaceAngle * Math.PI / 180;
    const relativeAimAngleRad = getShotDirectionAngle() * Math.PI / 180;
    const finalLaunchDirectionRad = targetLineAngleRad + physicsDeviationRad + relativeAimAngleRad;
    const initialVelX = initialVelHorizontalMag * Math.sin(finalLaunchDirectionRad);
    const initialVelZ = initialVelHorizontalMag * Math.cos(finalLaunchDirectionRad);
    const initialVelocityObj = { x: initialVelX, y: initialVelY, z: initialVelZ };
    const spinVectorRPM = { x: backSpin, y: sideSpin, z: 0 };

    // --- Determine Initial Position based on Game Mode ---
    let initialPositionObj;
    const currentMode = getCurrentGameMode();
    if (currentMode === 'play-hole') {
        initialPositionObj = getPlayHoleBallPosition();
        initialPositionObj.y = Math.max(BALL_RADIUS, initialPositionObj.y);
    } else {
        initialPositionObj = { x: 0, y: BALL_RADIUS, z: 0 };
    }
    console.log(`Calc (Full): Initial position: x=${initialPositionObj.x.toFixed(2)}, y=${initialPositionObj.y.toFixed(2)}, z=${initialPositionObj.z.toFixed(2)}`);

    // --- Run Flight Simulation ---
    const flightSimulationResult = simulateFlightStepByStep(initialPositionObj, initialVelocityObj, spinVectorRPM, selectedClub);

    // --- Extract Results from Flight Simulation ---
    carryDistance = flightSimulationResult.carryDistance;
    peakHeight = flightSimulationResult.peakHeight;
    const visualTimeOfFlight = Math.max(0.5, Math.min(5.0, flightSimulationResult.timeOfFlight));
    const landingPositionObj = flightSimulationResult.landingPosition;

    // Landing velocity is now returned directly
    const landingVelocity = flightSimulationResult.landingVelocity || { x: 0, y: 0, z: 0 }; // Use returned velocity or fallback
    console.log(`Calc (Full): Landing Pos: (${landingPositionObj.x.toFixed(2)}, ${landingPositionObj.y.toFixed(2)}, ${landingPositionObj.z.toFixed(2)})`);
    console.log(`Calc (Full): Landing Vel: (${landingVelocity.x.toFixed(2)}, ${landingVelocity.y.toFixed(2)}, ${landingVelocity.z.toFixed(2)})`);

    // --- Check for Slam Dunk ---
    const holePosition = getFlagPosition();
    if (currentMode === 'play-hole' && holePosition) {
        const dxSlam = landingPositionObj.x - holePosition.x;
        const dzSlam = landingPositionObj.z - holePosition.z;
        const distToHoleSlam = Math.sqrt(dxSlam*dxSlam + dzSlam*dzSlam);
        if (distToHoleSlam < HOLE_RADIUS_METERS) {
            console.log("Calc (Full): SLAM DUNK HOLE IN!");
            isHoledOut = true;
            finalPosition = new THREE.Vector3(holePosition.x, BALL_RADIUS / 2, holePosition.z);
        }
    }

    // --- Run Ground Simulation (if not holed out) ---
    if (!isHoledOut) {
        let surfaceType = 'rough'; // Default
        // TODO: Implement proper surface detection based on holeLayout data
        if (currentMode === 'play-hole') {
            const greenCenter = getGreenCenter();
            const greenRadius = getGreenRadius();
            if (greenCenter && greenRadius) {
                const dxGreen = landingPositionObj.x - greenCenter.x;
                const dzGreen = landingPositionObj.z - greenCenter.z;
                surfaceType = (Math.sqrt(dxGreen*dxGreen + dzGreen*dzGreen) <= greenRadius) ? 'green' : 'fairway';
            } else {
                 surfaceType = 'fairway'; // Fallback
            }
        } else {
            surfaceType = 'fairway'; // Range mode etc.
        }
        console.log(`Calc (Full): Determined landing surface: ${surfaceType}`);

        const rollStartPosition = new THREE.Vector3(landingPositionObj.x, landingPositionObj.y, landingPositionObj.z);

        // Calculate landing angle factor to adjust initial roll speed
        const landingVelHorizontalMag = Math.sqrt(landingVelocity.x**2 + landingVelocity.z**2);
        let landingAngleRad = Math.PI / 2; // Default 90 deg
        if (landingVelHorizontalMag > 0.01) {
            landingAngleRad = Math.atan2(Math.abs(landingVelocity.y), landingVelHorizontalMag);
        }
        // Simple factor: cos(angle). Steeper angle (closer to PI/2) -> lower factor. Shallow angle (closer to 0) -> higher factor.
        // Add power for more effect? e.g., Math.pow(Math.cos(landingAngleRad), 0.5)
        const initialRollSpeedFactor = Math.cos(landingAngleRad);
        console.log(`Calc (Full): Landing Angle: ${(landingAngleRad * 180 / Math.PI).toFixed(1)} deg, RollSpeedFactor: ${initialRollSpeedFactor.toFixed(2)}`);

        // Apply factor to horizontal landing velocity components
        const rollStartVelocity = new THREE.Vector3(
            landingVelocity.x * initialRollSpeedFactor,
            0, // Y velocity is zero for roll start
            landingVelocity.z * initialRollSpeedFactor
        );

        // Pass the backSpin and sideSpin values (from impactResult) to the ground roll simulation
        const groundRollResult = simulateGroundRoll(rollStartPosition, rollStartVelocity, surfaceType, backSpin, sideSpin);
        finalPosition = groundRollResult.finalPosition; // Vector3
        isHoledOut = groundRollResult.isHoledOut;
        // Combine trajectories
        const fullTrajectory = flightSimulationResult.trajectoryPoints.concat(groundRollResult.rollTrajectoryPoints || []);
        flightSimulationResult.trajectoryPoints = fullTrajectory; // Overwrite the original trajectory with the combined one
    } else {
         console.log("Calc (Full): Skipping ground roll due to slam dunk.");
         // Ensure trajectoryPoints exists even if roll is skipped
         if (!flightSimulationResult.trajectoryPoints) flightSimulationResult.trajectoryPoints = [];
    }

    // Ensure finalPosition is set
    if (!finalPosition) {
        console.warn("Calc (Full): finalPosition was not set, using landing position as fallback.");
        finalPosition = new THREE.Vector3(landingPositionObj.x, landingPositionObj.y, landingPositionObj.z);
    }

    // Calculate final distances
    const dxTotal = finalPosition.x - initialPositionObj.x;
    const dzTotal = finalPosition.z - initialPositionObj.z;
    totalDistance = Math.sqrt(dxTotal*dxTotal + dzTotal*dzTotal) * (1 / YARDS_TO_METERS);
    const sideDistance = dxTotal * (1 / YARDS_TO_METERS); // Side distance is just the X difference in yards
    console.log(`Calc (Full): Final Position: (${finalPosition.x.toFixed(2)}, ${finalPosition.y.toFixed(2)}, ${finalPosition.z.toFixed(2)})m`);
    console.log(`Calc (Full): Calculated Total Distance: ${totalDistance.toFixed(1)} yd, Side Distance: ${sideDistance.toFixed(1)} yd`);

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
    if (isHoledOut) {
        resultMessage += " HOLE IN ONE!"; // Adjust later based on shot count
    }
    console.log(`Calc (Full): ResultMessage: ${resultMessage}`);

    // --- Prepare Shot Data Object ---
    const shotData = {
        // ... (copy timingDeviations, ballPositionFactor etc. from impactResult)
        timingDeviations: { transition: impactResult.transitionDev, rotation: impactResult.rotationDev, arms: impactResult.armsDev, wrists: impactResult.wristsDev },
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
        // Simulation results
        peakHeight: peakHeight,
        carryDistance: carryDistance,
        totalDistance: totalDistance,
        timeOfFlight: visualTimeOfFlight,
        trajectory: flightSimulationResult.trajectoryPoints, // Now contains combined flight + roll
        sideDistance: sideDistance,
        finalPosition: { x: finalPosition.x, y: finalPosition.y, z: finalPosition.z }, // Convert final Vector3 back to object
        isHoledOut: isHoledOut
    };

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
    if (state !== 'calculatingChip' || shotType !== 'chip') return;

    stopChipDownswingAnimation();
    setGameState('calculating');
    updateStatus('Calculating Chip...');
    console.log("Calc: Calculating Chip Shot...");

    // --- Prepare Inputs ---
    const ballPositionIndex = getBallPositionIndex();
    const ballPositionLevels = getBallPositionLevels();
    const centerIndex = Math.floor(ballPositionLevels / 2);
    const ballPositionFactor = ballPositionLevels > 1 ? (centerIndex - ballPositionIndex) / centerIndex : 0;
    const backswingDuration = getBackswingDuration();
    const downswingPhaseStartTime = getDownswingPhaseStartTime();
    const chipRotationStartTime = getChipRotationStartTime();
    const chipWristsStartTime = getChipWristsStartTime();
    const selectedClub = getSelectedClub();
    const rotationOffset = chipRotationStartTime ? chipRotationStartTime - downswingPhaseStartTime : null;
    const hitOffset = chipWristsStartTime ? chipWristsStartTime - downswingPhaseStartTime : null;

    // --- Call chip physics ---
    const impactResult = calculateChipImpact(backswingDuration, rotationOffset, hitOffset, selectedClub, ballPositionFactor);

    // --- Use results ---
    const ballSpeed = impactResult.ballSpeed;
    const launchAngle = impactResult.launchAngle;
    const backSpin = impactResult.backSpin;
    const sideSpin = impactResult.sideSpin;
    const strikeQuality = impactResult.strikeQuality;
    let peakHeight = 0;
    let carryDistance = 0;
    let totalDistance = 0;
    let resultMessage = impactResult.message || "Chip Result";
    let isHoledOut = false;
    let finalPosition = null; // Will be Vector3

    // --- Prepare for Simulation ---
    console.log("Calc (Chip): --- Preparing Simulation ---");
    console.log(`Calc (Chip): Launch Conditions: BallSpeed=${ballSpeed.toFixed(1)}mph, LaunchAngle=${launchAngle.toFixed(1)}deg, BackSpin=${backSpin.toFixed(0)}rpm, SideSpin=${sideSpin.toFixed(0)}rpm`);

    // --- Calculate Initial Vectors ---
    const ballSpeedMPS = ballSpeed * 0.44704;
    const launchAngleRad = launchAngle * Math.PI / 180;
    const initialVelY = ballSpeedMPS * Math.sin(launchAngleRad);
    const initialVelHorizontalMag = ballSpeedMPS * Math.cos(launchAngleRad);
    const targetLineAngleRad = getCurrentTargetLineAngle() * Math.PI / 180;
    const physicsDeviationRad = impactResult.absoluteFaceAngle * Math.PI / 180;
    const relativeAimAngleRad = getShotDirectionAngle() * Math.PI / 180;
    const finalLaunchDirectionRad = targetLineAngleRad + physicsDeviationRad + relativeAimAngleRad;
    const initialVelX = initialVelHorizontalMag * Math.sin(finalLaunchDirectionRad);
    const initialVelZ = initialVelHorizontalMag * Math.cos(finalLaunchDirectionRad);
    const initialVelocityObj = { x: initialVelX, y: initialVelY, z: initialVelZ };
    const spinVectorRPM = { x: backSpin, y: sideSpin, z: 0 };

    // --- Determine Initial Position ---
    let initialPositionObj;
    const currentMode = getCurrentGameMode();
    if (currentMode === 'play-hole') {
        initialPositionObj = getPlayHoleBallPosition();
        initialPositionObj.y = Math.max(BALL_RADIUS, initialPositionObj.y);
    } else {
        initialPositionObj = { x: 0, y: BALL_RADIUS, z: 0 };
    }
    console.log(`Calc (Chip): Initial position: x=${initialPositionObj.x.toFixed(2)}, y=${initialPositionObj.y.toFixed(2)}, z=${initialPositionObj.z.toFixed(2)}`);

    // --- Run Flight Simulation ---
    const flightSimulationResult = simulateFlightStepByStep(initialPositionObj, initialVelocityObj, spinVectorRPM, selectedClub);

    // --- Extract Results ---
    carryDistance = flightSimulationResult.carryDistance;
    peakHeight = flightSimulationResult.peakHeight;
    const visualTimeOfFlight = Math.max(0.2, Math.min(3.0, flightSimulationResult.timeOfFlight));
    const landingPositionObj = flightSimulationResult.landingPosition;

    // Approx Landing Velocity (same crude method as full swing)
    let landingVelocityApprox = { x: 0, y: 0, z: 0 };
     // Landing velocity is now returned directly
     const landingVelocity = flightSimulationResult.landingVelocity || { x: 0, y: 0, z: 0 };
     console.log(`Calc (Chip): Landing Pos: (${landingPositionObj.x.toFixed(2)}, ${landingPositionObj.y.toFixed(2)}, ${landingPositionObj.z.toFixed(2)})`);
     console.log(`Calc (Chip): Landing Vel: (${landingVelocity.x.toFixed(2)}, ${landingVelocity.y.toFixed(2)}, ${landingVelocity.z.toFixed(2)})`);

    // --- Check for Slam Dunk ---
    const holePosition = getFlagPosition();
    if (currentMode === 'play-hole' && holePosition) {
        const dxSlam = landingPositionObj.x - holePosition.x;
        const dzSlam = landingPositionObj.z - holePosition.z;
        const distToHoleSlam = Math.sqrt(dxSlam*dxSlam + dzSlam*dzSlam);
        if (distToHoleSlam < HOLE_RADIUS_METERS) {
            console.log("Calc (Chip): SLAM DUNK HOLE IN!");
            isHoledOut = true;
            finalPosition = new THREE.Vector3(holePosition.x, BALL_RADIUS / 2, holePosition.z);
        }
    }

    // --- Run Ground Simulation (if not holed out) ---
    if (!isHoledOut) {
        let surfaceType = 'rough'; // Default
        // TODO: Implement proper surface detection
        if (currentMode === 'play-hole') {
            const greenCenter = getGreenCenter();
            const greenRadius = getGreenRadius();
            if (greenCenter && greenRadius) {
                const dxGreen = landingPositionObj.x - greenCenter.x;
                const dzGreen = landingPositionObj.z - greenCenter.z;
                surfaceType = (Math.sqrt(dxGreen*dxGreen + dzGreen*dzGreen) <= greenRadius) ? 'green' : 'fairway';
            } else {
                 surfaceType = 'fairway'; // Fallback
            }
        } else {
            surfaceType = 'fairway'; // Range mode etc.
        }
        console.log(`Calc (Chip): Determined landing surface: ${surfaceType}`);

        const rollStartPosition = new THREE.Vector3(landingPositionObj.x, landingPositionObj.y, landingPositionObj.z);

        // Calculate landing angle factor
        const landingVelHorizontalMag = Math.sqrt(landingVelocity.x**2 + landingVelocity.z**2);
        let landingAngleRad = Math.PI / 2;
        if (landingVelHorizontalMag > 0.01) {
            landingAngleRad = Math.atan2(Math.abs(landingVelocity.y), landingVelHorizontalMag);
        }
        const initialRollSpeedFactor = Math.cos(landingAngleRad);
        console.log(`Calc (Chip): Landing Angle: ${(landingAngleRad * 180 / Math.PI).toFixed(1)} deg, RollSpeedFactor: ${initialRollSpeedFactor.toFixed(2)}`);

        // Apply factor to horizontal landing velocity components
        const rollStartVelocity = new THREE.Vector3(
            landingVelocity.x * initialRollSpeedFactor,
            0,
            landingVelocity.z * initialRollSpeedFactor
        );

        // Pass the backSpin and sideSpin values (from impactResult) to the ground roll simulation
        const groundRollResult = simulateGroundRoll(rollStartPosition, rollStartVelocity, surfaceType, backSpin, sideSpin);
        finalPosition = groundRollResult.finalPosition;
        isHoledOut = groundRollResult.isHoledOut;
        // Combine trajectories
        const fullTrajectory = flightSimulationResult.trajectoryPoints.concat(groundRollResult.rollTrajectoryPoints || []);
        flightSimulationResult.trajectoryPoints = fullTrajectory; // Overwrite the original trajectory
    } else {
         console.log("Calc (Chip): Skipping ground roll due to slam dunk.");
         // Ensure trajectoryPoints exists even if roll is skipped
         if (!flightSimulationResult.trajectoryPoints) flightSimulationResult.trajectoryPoints = [];
    }

     // Ensure finalPosition is set
    if (!finalPosition) {
        console.warn("Calc (Chip): finalPosition was not set, using landing position as fallback.");
        finalPosition = new THREE.Vector3(landingPositionObj.x, landingPositionObj.y, landingPositionObj.z);
    }

    // Calculate final distances
    const dxTotal = finalPosition.x - initialPositionObj.x;
    const dzTotal = finalPosition.z - initialPositionObj.z;
    totalDistance = Math.sqrt(dxTotal*dxTotal + dzTotal*dzTotal) * (1 / YARDS_TO_METERS);
    const sideDistance = dxTotal * (1 / YARDS_TO_METERS);
    console.log(`Calc (Chip): Final Position: (${finalPosition.x.toFixed(2)}, ${finalPosition.y.toFixed(2)}, ${finalPosition.z.toFixed(2)})m`);
    console.log(`Calc (Chip): Calculated Total Distance: ${totalDistance.toFixed(1)} yd, Side Distance: ${sideDistance.toFixed(1)} yd`);

    // --- Determine Result Message ---
     if (isHoledOut) {
        resultMessage += " CHIP IN!";
    }
    console.log(`Calc (Chip): ResultMessage: ${resultMessage}`);

    // --- Prepare Shot Data Object ---
    const shotData = {
        // ... (copy timingDeviations etc. from impactResult)
        timingDeviations: { rotationDeviation: impactResult.timingDeviations?.rotationDeviation, hitDeviation: impactResult.timingDeviations?.hitDeviation },
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
        // Simulation results
        peakHeight: peakHeight,
        carryDistance: carryDistance,
        totalDistance: totalDistance,
        timeOfFlight: visualTimeOfFlight,
        trajectory: flightSimulationResult.trajectoryPoints, // Now contains combined flight + roll
        sideDistance: sideDistance,
        finalPosition: { x: finalPosition.x, y: finalPosition.y, z: finalPosition.z },
        isHoledOut: isHoledOut
    };

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
    if (state !== 'calculatingPutt' || shotType !== 'putt') return;

    // Putt animation stopped elsewhere

    setGameState('calculating');
    updateStatus('Calculating Putt...');
    console.log("Calc: Calculating Putt Shot...");

    // --- Prepare Inputs ---
    const backswingDuration = getBackswingDuration();
    const downswingPhaseStartTime = getDownswingPhaseStartTime();
    const puttHitTime = getPuttHitTime();
    const hitOffset = puttHitTime ? puttHitTime - downswingPhaseStartTime : null;

    // --- Call putt physics ---
    const impactResult = calculatePuttImpact(backswingDuration, hitOffset);

    // --- Use results ---
    const ballSpeed = impactResult.ballSpeed; // This is speed in mph, need m/s for simulation
    const horizontalLaunchAngleDeg = impactResult.horizontalLaunchAngle; // Horizontal deviation (Push/Pull)
    const strikeQuality = impactResult.strikeQuality;
    let resultMessage = impactResult.message || "Putt Result";
    let isHoledOut = false;
    let finalPosition = null; // Will be Vector3

    // --- Prepare for Simulation ---
    console.log("Calc (Putt): --- Preparing Simulation ---");
    const ballSpeedMPS = ballSpeed * 0.44704; // Convert mph to m/s

    // Calculate Initial Velocity Vector for Simulation
    const targetLineAngleRad = getCurrentTargetLineAngle() * Math.PI / 180;
    const physicsDeviationRad = horizontalLaunchAngleDeg * Math.PI / 180;
    const relativeAimAngleRad = getShotDirectionAngle() * Math.PI / 180;
    const finalHorizontalLaunchAngleRad = targetLineAngleRad + physicsDeviationRad + relativeAimAngleRad;
    const initialVelX = ballSpeedMPS * Math.sin(finalHorizontalLaunchAngleRad);
    const initialVelZ = ballSpeedMPS * Math.cos(finalHorizontalLaunchAngleRad);
    const initialVelocity = new THREE.Vector3(initialVelX, 0, initialVelZ); // Putt starts with Y velocity = 0

    console.log(`Calc (Putt): Initial Vel: (${initialVelocity.x.toFixed(2)}, ${initialVelocity.y.toFixed(2)}, ${initialVelocity.z.toFixed(2)}) m/s`);

    // --- Determine Initial Position ---
    let initialPositionObj;
    const currentMode = getCurrentGameMode();
    if (currentMode === 'play-hole') {
        initialPositionObj = getPlayHoleBallPosition();
        initialPositionObj.y = Math.max(BALL_RADIUS, initialPositionObj.y);
    } else {
        initialPositionObj = { x: 0, y: BALL_RADIUS, z: 0 };
    }
    const initialPosition = new THREE.Vector3(initialPositionObj.x, initialPositionObj.y, initialPositionObj.z);
    console.log(`Calc (Putt): Initial position: x=${initialPosition.x.toFixed(2)}, y=${initialPosition.y.toFixed(2)}, z=${initialPosition.z.toFixed(2)}`);

    // --- Run Ground Simulation ---
    // Assume putts always start on the green
    // Pass a low default backspin for putts (e.g., 100 RPM)
    const groundRollResult = simulateGroundRoll(initialPosition, initialVelocity, 'green', 100);
    finalPosition = groundRollResult.finalPosition; // Vector3
    isHoledOut = groundRollResult.isHoledOut;

    // Calculate final distances
    const dxTotal = finalPosition.x - initialPosition.x;
    const dzTotal = finalPosition.z - initialPosition.z;
    const totalDistance = Math.sqrt(dxTotal*dxTotal + dzTotal*dzTotal) * (1 / YARDS_TO_METERS);
    const sideDistance = dxTotal * (1 / YARDS_TO_METERS);
    console.log(`Calc (Putt): Final Position: (${finalPosition.x.toFixed(2)}, ${finalPosition.y.toFixed(2)}, ${finalPosition.z.toFixed(2)})m`);
    console.log(`Calc (Putt): Calculated Total Distance: ${totalDistance.toFixed(1)} yd, Side Distance: ${sideDistance.toFixed(1)} yd`);

    // --- Determine Result Message ---
    if (isHoledOut) {
        resultMessage += " Sunk!";
    }
     console.log(`Calc (Putt): ResultMessage: ${resultMessage}`);

    // --- Prepare Shot Data Object ---
    const shotData = {
        // ... (copy timingDeviations etc. from impactResult)
        timingDeviations: { hitDeviation: impactResult.timingDeviations?.hitDeviation },
        ballPositionFactor: 0,
        message: resultMessage,
        clubHeadSpeed: 0,
        ballSpeed: impactResult.ballSpeed, // Original speed in mph for display
        launchAngle: 0, // Vertical launch angle
        horizontalLaunchAngle: finalHorizontalLaunchAngleRad * 180 / Math.PI, // Final angle
        attackAngle: 0,
        backSpin: impactResult.backSpin,
        sideSpin: 0,
        clubPathAngle: 0,
        absoluteFaceAngle: horizontalLaunchAngleDeg, // Initial push/pull angle
        faceAngleRelPath: 0,
        strikeQuality: impactResult.strikeQuality,
        potentialCHS: 0,
        dynamicLoft: 0,
        smashFactor: 0,
        // Simulation results
        peakHeight: 0,
        carryDistance: 0, // No carry for putt
        totalDistance: totalDistance,
        timeOfFlight: 0, // No flight time
        // Use the actual roll trajectory points for the putt animation
        trajectory: groundRollResult.rollTrajectoryPoints ? groundRollResult.rollTrajectoryPoints.map(p => ({ x: p.x, y: p.y, z: p.z })) : [initialPositionObj, { x: finalPosition.x, y: finalPosition.y, z: finalPosition.z }],
        sideDistance: sideDistance,
        finalPosition: { x: finalPosition.x, y: finalPosition.y, z: finalPosition.z },
        isHoledOut: isHoledOut
    };

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
