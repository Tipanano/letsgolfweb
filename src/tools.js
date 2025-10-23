import { clubs } from './clubs.js';
import { calculateImpactPhysics, IDEAL_BACKSWING_DURATION_MS, IDEAL_ARMS_OFFSET_MS, IDEAL_TRANSITION_OFFSET_MS, IDEAL_WRISTS_OFFSET_MS, IDEAL_ROTATION_OFFSET_MS } from './swingPhysics.js';
import { simulateFlightStepByStep } from './gameLogic/simulation.js';
import { BALL_RADIUS } from './visuals/core.js';

export function runClubComparisonSimulation() {
    console.log('\n========================================');
    console.log('🏌️ CLUB COMPARISON SIMULATION');
    console.log('========================================\n');

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

    console.log('⚙️  Simulation Parameters:');
    console.log(`   Swing Speed: ${(swingSpeed * 100).toFixed(0)}%`);
    console.log(`   Surface: ${currentSurface}`);
    console.log(`   Backswing Duration: ${backswingDuration}ms`);
    console.log(`   Timing: Perfect (all ideal offsets)\n`);

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
            console.log(`📊 Testing ${club.name} (${clubId})`);
            console.log(`   Ball Position: Index ${ballPositionIndex}, Factor ${ballPositionFactor.toFixed(2)}`);

            const impactResult = calculateImpactPhysics(timingInputs, club, swingSpeed, ballPositionFactor, currentSurface);

            if (!impactResult) {
                console.error(`   ❌ [ERROR] calculateImpactPhysics returned undefined or null for ${club.name}`);
                return; // Skip this club
            }
            // Check for a few key properties to ensure the object structure is as expected
            if (typeof impactResult.ballSpeed === 'undefined' || typeof impactResult.launchAngle === 'undefined' || typeof impactResult.backSpin === 'undefined') {
                console.error(`   ❌ [ERROR] impactResult for ${club.name} is missing one or more key properties (ballSpeed, launchAngle, backSpin). Full result:`, impactResult);
                return; // Skip this club
            }

            const formatNum = (val, decimals = 1) => (val != null && !isNaN(val)) ? val.toFixed(decimals) : 'N/A';

            console.log(`   Impact Physics:`);
            console.log(`      Club Speed: ${formatNum(impactResult.actualCHS)} mph`);
            console.log(`      Ball Speed: ${formatNum(impactResult.ballSpeed)} mph`);
            console.log(`      Smash Factor: ${formatNum(impactResult.ballSpeed / impactResult.actualCHS, 2)}`);
            console.log(`      Launch Angle: ${formatNum(impactResult.launchAngle)}°`);
            console.log(`      Attack Angle: ${formatNum(impactResult.attackAngle)}°`);
            console.log(`      Backspin: ${formatNum(impactResult.backSpin, 0)} rpm`);
            console.log(`      Sidespin: ${formatNum(impactResult.sideSpin, 0)} rpm`);
            console.log(`      Strike Quality: ${formatNum(impactResult.strikeQuality)}%`);

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
                console.error(`   ❌ [ERROR] simulateFlightStepByStep returned undefined or null for ${club.name}`);
                return; // Skip this club
            }
            if (typeof flightSimulationResult.carryDistance === 'undefined' || typeof flightSimulationResult.peakHeight === 'undefined') {
                console.error(`   ❌ [ERROR] flightSimulationResult for ${club.name} is missing one or more key properties (carryDistance, peakHeight). Full result:`, flightSimulationResult);
                return; // Skip this club
            }

            console.log(`   Flight Results:`);
            console.log(`      Carry Distance: ${formatNum(flightSimulationResult.carryDistance)} yds`);
            console.log(`      Total Distance: ${formatNum(flightSimulationResult.totalDistance)} yds`);
            console.log(`      Peak Height: ${formatNum(flightSimulationResult.peakHeight)} yds`);
            console.log(`      Rollout: ${formatNum(flightSimulationResult.rolloutDistance)} yds`);

            results[clubId] = {
                clubName: club.name,
                carryDistanceYards: flightSimulationResult.carryDistance || 0,
                peakHeightYards: flightSimulationResult.peakHeight || 0,
                ballSpeedMPH: impactResult.ballSpeed || 0,
                launchAngleDeg: impactResult.launchAngle || 0,
                backSpinRPM: impactResult.backSpin || 0,
                sideSpinRPM: impactResult.sideSpin || 0,
                strikeQuality: impactResult.strikeQuality || 0
            };

            console.log(`   ✅ ${club.name} simulation complete\n`);

        } catch (error) {
            console.error(`   ❌ [CRITICAL ERROR] Exception during simulation for club ${clubId}:`, error.message);
            console.error(error.stack);
        }
    });

    console.log('\n========================================');
    console.log('📈 SIMULATION SUMMARY');
    console.log('========================================\n');

    if (Object.keys(results).length === 0) {
        console.error('❌ No clubs were successfully simulated!');
    } else {
        console.log(`✅ Successfully simulated ${Object.keys(results).length} clubs\n`);

        console.table(
            Object.entries(results).map(([clubId, res]) => ({
                'Club': res.clubName,
                'Carry (yds)': res.carryDistanceYards.toFixed(1),
                'Peak (yds)': res.peakHeightYards.toFixed(1),
                'Ball Speed (mph)': res.ballSpeedMPH.toFixed(1),
                'Launch (°)': res.launchAngleDeg.toFixed(1),
                'Backspin (rpm)': res.backSpinRPM.toFixed(0),
                'Strike %': res.strikeQuality.toFixed(1)
            }))
        );

        console.log('\n📏 Distance Gaps:');
        const sortedByDistance = Object.entries(results).sort((a, b) =>
            b[1].carryDistanceYards - a[1].carryDistanceYards
        );

        for (let i = 0; i < sortedByDistance.length - 1; i++) {
            const current = sortedByDistance[i][1];
            const next = sortedByDistance[i + 1][1];
            const gap = current.carryDistanceYards - next.carryDistanceYards;
            console.log(`   ${current.clubName} → ${next.clubName}: ${gap.toFixed(1)} yds`);
        }
    }

    console.log('\n========================================\n');
}

window.runClubComparisonSimulation = runClubComparisonSimulation;
