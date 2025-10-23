import { clubs } from './clubs.js';
import { calculateImpactPhysics, IDEAL_BACKSWING_DURATION_MS, IDEAL_ARMS_OFFSET_MS, IDEAL_TRANSITION_OFFSET_MS, IDEAL_WRISTS_OFFSET_MS, IDEAL_ROTATION_OFFSET_MS } from './swingPhysics.js';
import { simulateFlightStepByStep } from './gameLogic/simulation.js';
import { BALL_RADIUS } from './visuals/core.js';

export function runClubComparisonSimulation() {

    const clubIdsToTest = ['LW60', 'SW58','GW54', 'AW50','PW', 'I9', 'I8', 'I7', 'I6', 'I5', 'I4', 'I3', 'H4', 'H3', 'W7', 'W5', 'W3', 'MD', 'DR'];
    const results = {};

    const swingSpeed = 1.0;
    // let ballPositionFactor = 0 // This will be calculated per club
    const currentSurface = 'FAIRWAY';
    const BALL_POSITION_LEVELS_FOR_SIM = 10; // Assuming 9 levels for the simulation, like in the UI.

    const backswingDuration = IDEAL_BACKSWING_DURATION_MS;
    const backswingStartTime = 0;
    const actualBackswingReleaseTimestamp = backswingStartTime + backswingDuration;

    const idealTransitionOffsetMs = IDEAL_TRANSITION_OFFSET_MS
    const idealRotationOffsetMs = IDEAL_ROTATION_OFFSET_MS
    const idealArmsOffsetMs = IDEAL_ARMS_OFFSET_MS
    const idealWristsOffsetMs = IDEAL_WRISTS_OFFSET_MS

    const hipInitiationTime = actualBackswingReleaseTimestamp + idealTransitionOffsetMs;
    const downswingPhaseStartTime = hipInitiationTime;

    const timingInputs = {
        backswingDuration,
        hipInitiationTime,
        rotationStartTime: downswingPhaseStartTime + idealRotationOffsetMs,
        rotationInitiationTime: null,
        armsStartTime: downswingPhaseStartTime + idealArmsOffsetMs,
        wristsStartTime: downswingPhaseStartTime + idealWristsOffsetMs,
        downswingPhaseStartTime,
        idealBackswingEndTime: actualBackswingReleaseTimestamp
    };

    clubIdsToTest.forEach(clubId => {
        try {
            const club = clubs[clubId];
            if (!club) {
                console.error(`[ERROR] Club ${clubId} not found.`);
                return; // Skip this club
            }
            
            // Calculate ballPositionFactor based on club's defaultBallPositionIndex
            const ballPositionIndex = club.defaultBallPositionIndex;
            const centerIndex = Math.floor(BALL_POSITION_LEVELS_FOR_SIM / 2);
            const ballPositionFactor = BALL_POSITION_LEVELS_FOR_SIM > 1 ? (centerIndex - ballPositionIndex) / centerIndex : 0;


            // 1. Calculate Impact Physics
            const impactResult = calculateImpactPhysics(timingInputs, club, swingSpeed, ballPositionFactor, currentSurface);

            if (!impactResult) {
                console.error(`[ERROR] calculateImpactPhysics returned undefined or null for ${club.name}`);
                return; // Skip this club
            }
            // Check for a few key properties to ensure the object structure is as expected
            if (typeof impactResult.ballSpeed === 'undefined' || typeof impactResult.launchAngle === 'undefined' || typeof impactResult.backSpin === 'undefined') {
                console.error(`[ERROR] impactResult for ${club.name} is missing one or more key properties (ballSpeed, launchAngle, backSpin). Full result:`, impactResult);
                return; // Skip this club
            }

            // 2. Prepare for Flight Simulation
            const ballSpeedMPS = impactResult.ballSpeed * 0.44704;
            const launchAngleRad = impactResult.launchAngle * Math.PI / 180;
            const initialVelY = ballSpeedMPS * Math.sin(launchAngleRad);
            const initialVelHorizontalMag = ballSpeedMPS * Math.cos(launchAngleRad);
            const physicsDeviationRad = impactResult.absoluteFaceAngle * Math.PI / 180;
            const finalLaunchDirectionRad = physicsDeviationRad;
            const initialVelX = initialVelHorizontalMag * Math.sin(finalLaunchDirectionRad);
            const initialVelZ = initialVelHorizontalMag * Math.cos(finalLaunchDirectionRad);
            const initialVelocityObj = { x: initialVelX, y: initialVelY, z: initialVelZ };
            const spinVectorRPM = { x: impactResult.backSpin, y: impactResult.sideSpin, z: 0 };
            const initialPositionObj = { x: 0, y: BALL_RADIUS, z: 0 };

            // 3. Simulate Flight
            const flightSimulationResult = simulateFlightStepByStep(initialPositionObj, initialVelocityObj, spinVectorRPM, club);

            if (!flightSimulationResult) {
                console.error(`[ERROR] simulateFlightStepByStep returned undefined or null for ${club.name}`);
                return; // Skip this club
            }
            if (typeof flightSimulationResult.carryDistance === 'undefined' || typeof flightSimulationResult.peakHeight === 'undefined') {
                console.error(`[ERROR] flightSimulationResult for ${club.name} is missing one or more key properties (carryDistance, peakHeight). Full result:`, flightSimulationResult);
                return; // Skip this club
            }

            results[clubId] = {
                clubName: club.name,
                carryDistanceYards: flightSimulationResult.carryDistance,
                peakHeightYards: flightSimulationResult.peakHeight,
                ballSpeedMPH: impactResult.ballSpeed,
                launchAngleDeg: impactResult.launchAngle,
                backSpinRPM: impactResult.backSpin,
                sideSpinRPM: impactResult.sideSpin,
                strikeQuality: impactResult.strikeQuality
            };

        } catch (error) {
            console.error(`[CRITICAL ERROR] Exception during simulation for club ${clubId}:`, error.message, error.stack);
        }
    });

    if (Object.keys(results).length === 0) {
    } else {
        for (const clubId in results) {
            const res = results[clubId];
        }
    }
}

window.runClubComparisonSimulation = runClubComparisonSimulation;
