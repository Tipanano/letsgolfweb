import {
    getGameState, getCurrentShotType, getSelectedClub, getSwingSpeed,
    getBackswingDuration, getHipInitiationTime, getRotationStartTime,
    getRotationInitiationTime, getArmsStartTime, getWristsStartTime,
    getDownswingPhaseStartTime, getChipRotationStartTime, getChipWristsStartTime,
    getPuttHitTime, getOnShotCompleteCallback, setGameState, getChipProfile,
    getBackswingStartTime, // <-- Added missing import
    getShotDirectionAngle, // <-- Gets RELATIVE angle
    getCurrentTargetLineAngle, // <-- Gets ABSOLUTE target line angle
    resetSwingVariablesOnly,
    // getCurrentHoleLayout is NOT in state.js
} from './state.js'; // Removed PUTT_DISTANCE_FACTOR, IDEAL_BACKSWING_DURATION_MS is fine as is.
import { getCurrentHoleLayout } from '../modes/playHole.js'; // <-- Import from correct module
import { getHoleConfig as getCTFHoleConfig } from '../visuals/targetView.js'; // Import CTF hole config getter
import { ctfConfigToHoleLayout } from '../holeConfigGenerator.js'; // Import CTF config converter
import { stopFullDownswingAnimation, stopChipDownswingAnimation /* Putt stopped in actions */ } from './animations.js';
import { updateStatus, getBallPositionIndex, getBallPositionLevels, displayIdealJPressWindowOnBackswing, displayDownswingFeedbackWindows, resetUIForNewShot } from '../ui.js'; // Added displayDownswingFeedbackWindows
import { calculateImpactPhysics } from '../swingPhysics.js';
import { calculateChipImpact, calculateRhythmChipImpact, CHIP_PROFILES } from '../chipPhysics.js';
import { calculatePuttImpact, calculateRhythmPuttImpact } from '../puttPhysics.js';
import { consumeStrike as consumeRhythmStrike } from '../rhythmPutt.js';
// Import both simulation functions and HOLE_RADIUS
import { simulateFlightStepByStep, simulateBouncePhase, simulateGroundRoll, HOLE_RADIUS_METERS } from './simulation.js';
import { getSurfaceProperties } from '../surfaces.js'; // Import surface properties getter
// Removed Putt Trajectory import as roll simulation handles it
import { clamp, getSurfaceTypeAtPoint } from '../utils/gameUtils.js'; // Import getSurfaceTypeAtPoint
import { getCurrentGameMode } from '../main.js'; // Import mode checker
import { setSwingReport, showAddressHint } from '../ui/rhythmPuttHud.js';
import { isPracticeSwingArmed, practiceSwingSummary, practiceSwingDetail } from '../practiceSwing.js';
import { showPracticeSwingCard } from '../ui/practiceSwingCard.js';

/**
 * Ends a rehearsal. The impact calculation has already run — that IS the
 * point, it is what produces the tempo and speed feedback — so all that is
 * left is to show it and hand control back without touching the ball, the
 * card, or the camera.
 *
 * The detail card opens EVERY time. A rehearsal produces no ball flight, so
 * the numbers are the whole of its output; leaving them in a status line and
 * a HUD hint (which the player may have muted) meant a practice swing could
 * look like nothing happened at all.
 *
 * It returns straight to ADDRESS rather than to 'result'. A rehearsal is not
 * a shot: there is nothing to advance past, and parking in 'result' put a
 * NEXT button under a swing that never happened — so rehearsing twice in a
 * row, which is the entire point of a toggle that stays on, cost a tap in
 * between. Going back to ready also keeps touch in its address phase, since
 * both the bottom pill and the address-mode exit key off 'result'.
 */
function finishPracticeSwing(impact, club, report, opts = {}) {
    setSwingReport(report);
    try {
        showPracticeSwingCard(practiceSwingDetail(impact, club, {
            backswingMs: getBackswingDuration(), ...opts,
        }), opts.shotType === 'full' ? 'Practice swing' : `Practice ${(opts.label || opts.shotType).toLowerCase()}`);
    } catch (e) { console.error('practice swing report failed', e); }

    // Timing bars and swing variables back to their starting state, so the
    // next backswing can begin immediately. The ball, the lie, the aim and
    // the camera were never touched, so nothing else needs restoring.
    resetSwingVariablesOnly();   // also sets gameState back to 'ready'
    resetUIForNewShot();         // ...which ends by setting the status to Ready
    updateStatus(practiceSwingSummary());
    showAddressHint(getCurrentShotType(), { hasClub: !!getSelectedClub() });
}

/**
 * Human-readable swing feedback: what shape came
 * out, and which beats of the swing caused it.
 */
function buildSwingReport(r) {
    const face = r.faceAngleRelPath;
    const path = r.clubPathAngle;
    const curve = Math.abs(face) < 2 ? 'straight'
        : face > 6 ? 'slice' : face > 0 ? 'fade'
        : face < -6 ? 'hook' : 'draw';
    const start = Math.abs(path) < 2.5 ? '' : path > 0 ? ' push' : ' pull';
    // Efficiency = delivered / potential clubhead speed (timing losses).
    // NOT the speed setting and NOT backswing size — don't call it "power",
    // the setup control used to share that word and it read as the setting.
    const efficiency = (r.potentialCHS > 0)
        ? Math.round((r.actualCHS / r.potentialCHS) * 100) : null;

    const beats = [
        ['hips', r.transitionDev], ['rotation', r.rotationDev],
        ['arms', r.armsDev], ['wrists', r.wristsDev],
    ].map(([name, dev]) => {
        if (typeof dev !== 'number' || !isFinite(dev) || Math.abs(dev) > 999) return `${name} missed`;
        if (Math.abs(dev) < 25) return null; // close enough to pure
        return `${name} ${dev > 0 ? 'late' : 'early'} ${Math.round(Math.abs(dev))}ms`;
    }).filter(Boolean);

    const line1 = `${r.strikeQuality} strike · ${curve}${start}` +
        (efficiency !== null ? ` · efficiency ${efficiency}%` : '');
    const line2 = beats.length ? beats.join(' · ') : 'timing pure — great swing';
    return `${line1}\n${line2}`;
}

/**
 * Chip/pitch feedback. Rhythm chips have two skills —
 * strike tap vs the beat (direction) and tap-tempo steadiness (contact) — so
 * the report names both, and on a mishit says which one caused it.
 */
function buildChipReport(r, label) {
    const rhythm = r.rhythm;
    if (!rhythm) return null; // legacy timing path — no rhythm data to explain

    const face = r.absoluteFaceAngle;
    const dir = Math.abs(face) < 1.5 ? 'straight'
        : face > 0 ? 'push right' : 'pull left';
    const line1 = `${r.strikeQuality} ${label.toLowerCase()} · ${dir}`;

    const devPct = Math.round((rhythm.beatDeviationMs / rhythm.tempoMs) * 100);
    const cvPct = rhythm.cv * 100;
    const parts = [];
    parts.push(Math.abs(devPct) <= 6 ? 'strike on the beat'
        : `strike ${Math.abs(devPct)}% ${devPct > 0 ? 'late' : 'early'}`);
    parts.push(cvPct < 5 ? `tempo steady (±${Math.max(1, Math.round(cvPct))}%)`
        : cvPct < 9 ? `tempo uneven (±${Math.round(cvPct)}%)`
        : `tempo wobbly (±${Math.round(cvPct)}%)`);

    // On a mishit, name the cause — contact rolls dice against a window, and
    // what widened the dice matters more than the unlucky roll itself.
    if (r.strikeQuality !== 'Center' && r.contact) {
        const c = r.contact;
        if (c.offbeatRisk > c.cvRisk) parts.push('mishit: strike far off the beat');
        else if (cvPct >= 6) parts.push('mishit: uneven taps');
        else if (c.threshold < c.baseThreshold * 0.85) parts.push('mishit: tough lie');
        else parts.push('mishit: unlucky — rhythm was fine');
    }
    return `${line1}\n${parts.join(' · ')}`;
}
import { getCurrentBallPosition as getPlayHoleBallPosition } from '../modes/playHole.js'; // Import position getter
import { BALL_RADIUS } from '../visuals/core.js'; // Import BALL_RADIUS
import { queryTerrainHeight } from '../visuals.js'; // Ground under the ball (DEM courses sit at real elevations)

import { getFlagPosition, getGreenCenter, getGreenRadius, getObstacles as getHoleObstacles } from '../visuals/holeView.js'; // For hole/green checks
import { getObstacles as getCTFObstacles } from '../visuals/targetView.js'; // Import obstacles getter for CTF mode
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js'; // For Vector3

/**
 * Floor for a shot's starting height: the ground under the ball, never an
 * absolute number. This used to be Math.max(BALL_RADIUS, y), which reads as
 * "don't start underground" but only holds on a flat course sitting at y=0.
 * Imported DEM courses sit at their real elevation — Bethpage's green is at
 * y ≈ −12 m — so the clamp yanked the ball up to sea level and the shot flew
 * from twelve metres in the air. Chips showed it worst: the whole shot is
 * shorter than the error.
 */
export function groundedStartY(pos) {
    const groundY = queryTerrainHeight(pos.x, pos.z) + BALL_RADIUS;
    return Math.max(groundY, pos.y);
}

// --- Calculation Functions ---

export function calculateFullSwingShot() {
    const state = getGameState();
    const shotType = getCurrentShotType();
    if (state !== 'downswingWaiting' || shotType !== 'full') return;

    // Stop full downswing timing bar animation
    stopFullDownswingAnimation();

    setGameState('calculating');
    updateStatus('Calculating Full Swing...');

    // --- Prepare Inputs for swingPhysics Module ---
    const ballPositionIndex = getBallPositionIndex();
    const ballPositionLevels = getBallPositionLevels();
    const centerIndex = Math.floor(ballPositionLevels / 2);
    const ballPositionFactor = ballPositionLevels > 1 ? (centerIndex - ballPositionIndex) / centerIndex : 0;
    const backswingDuration = getBackswingDuration();
    const swingSpeed = getSwingSpeed();
    const backswingStartTime = getBackswingStartTime();
    const selectedClub = getSelectedClub();

    // Calculate the ACTUAL timestamp when the player's backswing ended (e.g., 'w' release)
    // This is crucial for the new adaptive timing logic in swingPhysics.js
    const actualBackswingReleaseTimestamp = backswingStartTime ? backswingStartTime + backswingDuration : null;

    // The field `idealBackswingEndTime` in `timingInputs` is now expected by `swingPhysics.js`
    // to hold this actual release timestamp for the new transition logic.
    const timingInputs = {
        backswingDuration, // Actual duration
        hipInitiationTime: getHipInitiationTime(),
        rotationStartTime: getRotationStartTime(),
        rotationInitiationTime: getRotationInitiationTime(),
        armsStartTime: getArmsStartTime(),
        wristsStartTime: getWristsStartTime(),
        downswingPhaseStartTime: getDownswingPhaseStartTime(),
        idealBackswingEndTime: actualBackswingReleaseTimestamp // Pass actual end time
    };

    // --- Call the full swing physics calculation module ---
    // --- Determine Initial Position and Surface ---
    let initialPositionObj;
    let currentSurface = 'fairway'; // Default surface
    const currentMode = getCurrentGameMode();
    let currentHoleLayout = getCurrentHoleLayout(); // Get layout (let for CTF override)

    // If in CTF mode and no hole layout, get it from CTF config
    if (currentMode === 'closest-to-flag' && !currentHoleLayout) {
        const ctfConfig = getCTFHoleConfig();
        if (ctfConfig) {
            currentHoleLayout = ctfConfigToHoleLayout(ctfConfig);
        }
    }

    if (currentMode === 'play-hole' && currentHoleLayout) {
        initialPositionObj = getPlayHoleBallPosition();
        initialPositionObj.y = groundedStartY(initialPositionObj);
        // Determine surface type at the starting position
        currentSurface = getSurfaceTypeAtPoint(initialPositionObj, currentHoleLayout);
    } else {
        // Range or other modes
        initialPositionObj = { x: 0, y: BALL_RADIUS, z: 0 };
        currentSurface = 'TEE'; // Assume range is always off a tee for full swings
    }
    // Ensure surfaceType is uppercase for consistency (though lowercase check is used in physics)
    currentSurface = currentSurface.toUpperCase().replace(' ', '_');


    // --- Call the full swing physics calculation module ---
    const impactResult = calculateImpactPhysics(timingInputs, selectedClub, swingSpeed, ballPositionFactor, currentSurface); // Pass currentSurface

    // Every full swing gets a post-shot report explaining the outcome; it
    // renders with the next-shot hint. It was practice-only at first, but a
    // player on the course who just sliced one wants to know which beat did
    // it just as much as one on the range. A rehearsal always gets one — with
    // no ball to watch, the report is the entire output of the swing.
    const rehearsal = isPracticeSwingArmed();
    let swingReportText = null;
    try {
        swingReportText = buildSwingReport(impactResult);
        setSwingReport(swingReportText);
    } catch (e) { /* feedback must never break the shot */ }

    // A rehearsal stops here: everything below simulates flight, moves the
    // ball and records a stroke.
    if (rehearsal) return finishPracticeSwing(impactResult, selectedClub, swingReportText, { shotType: 'full' });

    // --- Use results from impactResult ---
    const ballSpeed = impactResult.ballSpeed;
    const launchAngle = impactResult.launchAngle;
    const backSpin = impactResult.backSpin;
    const sideSpin = impactResult.sideSpin;
    // Map "Flip" to "High" for full swings (Flip is used internally for penalty calculation)
    const strikeQuality = impactResult.strikeQuality === "Flip" ? "High" : impactResult.strikeQuality;
    let peakHeight = 0;
    let carryDistance = 0;
    let totalDistance = 0;
    let resultMessage = "";
    let isHoledOut = false;
    let finalPosition = null; // Will be Vector3

    // --- Prepare for Simulation ---

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

    // --- Run Flight Simulation ---
    // Initial position already determined above
    // Get obstacles (CTF has them in targetView, Play Hole has them in holeView)
    let obstacles = [];
    if (currentMode === 'closest-to-flag') {
        obstacles = getCTFObstacles();
    } else if (currentMode === 'play-hole') {
        obstacles = getHoleObstacles();
    }
    const flightSimulationResult = simulateFlightStepByStep(initialPositionObj, initialVelocityObj, spinVectorRPM, selectedClub, obstacles);

    // --- Extract Results from Flight Simulation ---
    carryDistance = flightSimulationResult.carryDistance;
    peakHeight = flightSimulationResult.peakHeight;
    const visualTimeOfFlight = Math.max(0.5, Math.min(5.0, flightSimulationResult.timeOfFlight));
    const landingPositionObj = flightSimulationResult.landingPosition;

    // Landing velocity is now returned directly
    const landingVelocity = flightSimulationResult.landingVelocity || { x: 0, y: 0, z: 0 }; // Use returned velocity or fallback

    // --- Check for Slam Dunk ---
    const holePosition = getFlagPosition();
    if (currentMode === 'play-hole' && holePosition) {
        const dxSlam = landingPositionObj.x - holePosition.x;
        const dzSlam = landingPositionObj.z - holePosition.z;
        const distToHoleSlam = Math.sqrt(dxSlam*dxSlam + dzSlam*dzSlam);
        if (distToHoleSlam < HOLE_RADIUS_METERS) {
            isHoledOut = true;
            finalPosition = new THREE.Vector3(holePosition.x, BALL_RADIUS / 2, holePosition.z);
        }
    }

    // --- Run Bounce/Ground Simulation (if not holed out) ---
    let landingSurfaceType = 'OUT_OF_BOUNDS'; // Default to OOB - declare outside block for scope
    let shotImpact = null; // deepest crater this shot dug (see simulateBouncePhase)
    if (!isHoledOut) {
        if ((currentMode === 'play-hole' || currentMode === 'closest-to-flag') && currentHoleLayout) {
            // Use the utility function to determine surface type at landing position (meters)
            landingSurfaceType = getSurfaceTypeAtPoint(landingPositionObj, currentHoleLayout);
        } else if (currentMode === 'range') {
            landingSurfaceType = 'FAIRWAY'; // Range mode defaults to Fairway landing
        } else {
             console.warn("Calc (Full): Could not get hole layout for surface detection. Defaulting landing surface to FAIRWAY.");
             landingSurfaceType = 'FAIRWAY'; // Fallback if layout missing
        }
        // Ensure surfaceType is uppercase for getSurfaceProperties lookup
        landingSurfaceType = landingSurfaceType.toUpperCase().replace(' ', '_');

        // --- Decide: Bounce Phase or Direct to Roll? ---
        const landingSpeed = Math.sqrt(landingVelocity.x**2 + landingVelocity.y**2 + landingVelocity.z**2);
        const landingAngleRadians = flightSimulationResult.landingAngleRadians || 0;
        const landingAngleDegrees = landingAngleRadians * 180 / Math.PI;

        // Always use full bounce simulation - it handles shallow landings correctly
        let rollStartPosition, rollStartVelocity, rollStartBackspinRPM, rollStartSidespinRPM;
        let bounceTrajectory = [];
        let bounceEndTime = flightSimulationResult.timeOfFlight; // Start with flight time

        // Get spin state from flight simulation
        const landingSpinRadPerSec = flightSimulationResult.landingSpinRadPerSec || { x: 0, y: 0, z: 0 };

        // Run bounce simulation (pass flight end time and holeLayout)
        const bounceResult = simulateBouncePhase(
            landingPositionObj,
            landingVelocity,
            landingAngleRadians,
            landingSpinRadPerSec,
            landingSurfaceType,
            flightSimulationResult.timeOfFlight, // Start bounce time from end of flight
            currentHoleLayout // Pass holeLayout for dynamic surface detection
        );

        // Use bounce results as starting point for roll
        rollStartPosition = bounceResult.position;
        rollStartVelocity = bounceResult.velocity;
        // Convert spin back to RPM for ground roll
        rollStartBackspinRPM = Math.abs(bounceResult.spin.x) * (60 / (2 * Math.PI));
        rollStartSidespinRPM = bounceResult.spin.y * (60 / (2 * Math.PI));
        bounceTrajectory = bounceResult.bouncePoints || [];
        bounceEndTime = bounceResult.endTime; // Get end time from bounce phase
        shotImpact = bounceResult.impact || null;

        // --- Run Ground Roll Simulation (pass bounce end time and holeLayout) ---
        const groundRollResult = simulateGroundRoll(rollStartPosition, rollStartVelocity, bounceResult.endSurface || landingSurfaceType, rollStartBackspinRPM, rollStartSidespinRPM, bounceEndTime, currentHoleLayout);
        finalPosition = groundRollResult.finalPosition; // Vector3
        isHoledOut = groundRollResult.isHoledOut;

        // Combine trajectories: flight + bounce + roll
        const fullTrajectory = flightSimulationResult.trajectoryPoints
            .concat(bounceTrajectory)
            .concat(groundRollResult.rollTrajectoryPoints || []);
        flightSimulationResult.trajectoryPoints = fullTrajectory;

        // Update total time for animation
        const totalAnimationTime = groundRollResult.endTime || bounceEndTime;
        flightSimulationResult.timeOfFlight = totalAnimationTime;

    } else {
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
    totalDistance = Math.sqrt(dxTotal*dxTotal + dzTotal*dzTotal); // Keep in meters
    const sideDistance = dxTotal; // Keep in meters

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
        strikeQuality: strikeQuality, // Use mapped value (Flip -> High for full swings)
        potentialCHS: impactResult.potentialCHS,
        dynamicLoft: impactResult.dynamicLoft,
        smashFactor: impactResult.smashFactor,
        // Simulation results (all distances in meters)
        peakHeight: peakHeight,
        carryDistance: carryDistance,
        rolloutDistance: totalDistance - carryDistance, // Calculate rollout
        totalDistance: totalDistance,
        timeOfFlight: flightSimulationResult.timeOfFlight, // Use actual total time (flight + bounce + roll)
        trajectory: flightSimulationResult.trajectoryPoints, // Now contains combined flight + roll
        sideDistance: sideDistance,
        finalPosition: { x: finalPosition.x, y: finalPosition.y, z: finalPosition.z }, // Convert final Vector3 back to object
        isHoledOut: isHoledOut,
        surfaceName: getSurfaceTypeAtPoint({ x: finalPosition.x, z: finalPosition.z }, currentHoleLayout) || landingSurfaceType, // Use final position surface, not landing surface
        // How hard the ball buried itself on its deepest impact: 0 skipped
        // off, 1 stopped in its own pitch mark. Nothing reads this yet — it is
        // the measurement a plugged-lie rule would be written against.
        impact: shotImpact
    };

    // Update internal state - set to 'calculating' during animation, will be set to 'result' after animation completes
    setGameState('calculating');

    // --- Display Ideal J Press Window on Backswing Bar (Transition Timing Feedback) ---
    if (impactResult && typeof impactResult.idealJWindowStartOnBackswing === 'number' && typeof impactResult.idealJWindowWidthOnBackswing === 'number') {
        // swingSpeed is the variable already in scope in this function, holding the speed for the current shot.
        displayIdealJPressWindowOnBackswing(
            impactResult.idealJWindowStartOnBackswing,
            impactResult.idealJWindowWidthOnBackswing,
            swingSpeed
        );
    } else {
        console.warn("Calc (Full): Could not display ideal J press window on backswing bar due to missing/invalid data from impactResult.");
    }

    // --- Display Ideal Downswing Event Windows ---
    if (impactResult &&
        typeof impactResult.idealRotationWindowStart === 'number' && typeof impactResult.idealRotationWindowWidth === 'number' &&
        typeof impactResult.idealArmsWindowStart === 'number' && typeof impactResult.idealArmsWindowWidth === 'number' &&
        typeof impactResult.idealWristsWindowStart === 'number' && typeof impactResult.idealWristsWindowWidth === 'number') {
        displayDownswingFeedbackWindows(
            impactResult.idealRotationWindowStart, impactResult.idealRotationWindowWidth,
            impactResult.idealArmsWindowStart, impactResult.idealArmsWindowWidth,
            impactResult.idealWristsWindowStart, impactResult.idealWristsWindowWidth,
            swingSpeed // Pass the swingSpeed used for this shot's calculations
        );
    } else {
        console.warn("Calc (Full): Could not display ideal downswing event windows due to missing/invalid data from impactResult.");
    }

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
    setSwingReport(null); // replaced below once the impact is known
    const state = getGameState();
    const shotType = getCurrentShotType();
    if (state !== 'calculatingChip' || shotType !== 'chip') return;

    stopChipDownswingAnimation();
    setGameState('calculating');
    updateStatus('Calculating Chip...');

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

    // --- Determine Initial Position and Surface ---
    let initialPositionObj;
    let currentSurface = 'fairway'; // Default surface
    const currentMode = getCurrentGameMode();
    let currentHoleLayout = getCurrentHoleLayout(); // Get layout (let for CTF override)

    // If in CTF mode and no hole layout, get it from CTF config
    if (currentMode === 'closest-to-flag' && !currentHoleLayout) {
        const ctfConfig = getCTFHoleConfig();
        if (ctfConfig) {
            currentHoleLayout = ctfConfigToHoleLayout(ctfConfig);
        }
    }

    if (currentMode === 'play-hole' && currentHoleLayout) {
        initialPositionObj = getPlayHoleBallPosition();
        initialPositionObj.y = groundedStartY(initialPositionObj);
        // Determine surface type at the starting position
        currentSurface = getSurfaceTypeAtPoint(initialPositionObj, currentHoleLayout);
    } else {
        // Range or other modes
        initialPositionObj = { x: 0, y: BALL_RADIUS, z: 0 };
        currentSurface = 'fairway'; // Assume range chips are off fairway/short grass
    }
    // Ensure surfaceType is uppercase for consistency
    currentSurface = currentSurface.toUpperCase().replace(' ', '_');

    // --- Call chip physics ---
    // Rhythm chipping: strike scored against the player's tap tempo.
    const rhythmStrike = consumeRhythmStrike();
    const chipProfile = CHIP_PROFILES[getChipProfile()] || CHIP_PROFILES.chip;
    const impactResult = rhythmStrike
        ? calculateRhythmChipImpact(rhythmStrike, selectedClub, ballPositionFactor, currentSurface, chipProfile)
        : calculateChipImpact(backswingDuration, rotationOffset, hitOffset, selectedClub, ballPositionFactor, currentSurface); // Legacy fallback

    // Chips get the same post-shot explanation full swings do, on the course
    // as well as in practice; a rehearsal always does, since the report is
    // all it produces.
    const chipRehearsal = isPracticeSwingArmed();
    let chipReportText = null;
    try {
        chipReportText = buildChipReport(impactResult, chipProfile.label);
        setSwingReport(chipReportText);
    } catch (e) { /* feedback must never break the shot */ }

    if (chipRehearsal) return finishPracticeSwing(impactResult, selectedClub, chipReportText,
        { shotType: 'chip', label: chipProfile.label });

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

    // --- Run Flight Simulation ---
    // Initial position already determined above
    // Get obstacles (CTF has them in targetView, Play Hole has them in holeView)
    let obstacles_chip = [];
    if (currentMode === 'closest-to-flag') {
        obstacles_chip = getCTFObstacles();
    } else if (currentMode === 'play-hole') {
        obstacles_chip = getHoleObstacles();
    }
    const flightSimulationResult = simulateFlightStepByStep(initialPositionObj, initialVelocityObj, spinVectorRPM, selectedClub, obstacles_chip);

    // --- Extract Results ---
    carryDistance = flightSimulationResult.carryDistance;
    peakHeight = flightSimulationResult.peakHeight;
    const visualTimeOfFlight = Math.max(0.2, Math.min(3.0, flightSimulationResult.timeOfFlight));
    const landingPositionObj = flightSimulationResult.landingPosition;

    // Approx Landing Velocity (same crude method as full swing)
    let landingVelocityApprox = { x: 0, y: 0, z: 0 };
     // Landing velocity is now returned directly
     const landingVelocity = flightSimulationResult.landingVelocity || { x: 0, y: 0, z: 0 };

    // --- Check for Slam Dunk ---
    const holePosition = getFlagPosition();
    if (currentMode === 'play-hole' && holePosition) {
        const dxSlam = landingPositionObj.x - holePosition.x;
        const dzSlam = landingPositionObj.z - holePosition.z;
        const distToHoleSlam = Math.sqrt(dxSlam*dxSlam + dzSlam*dzSlam);
        if (distToHoleSlam < HOLE_RADIUS_METERS) {
            isHoledOut = true;
            finalPosition = new THREE.Vector3(holePosition.x, BALL_RADIUS / 2, holePosition.z);
        }
    }

    // --- Run Bounce/Ground Simulation (if not holed out) ---
    let landingSurfaceType = 'OUT_OF_BOUNDS'; // Default to OOB - declare outside block for scope
    let shotImpact = null; // deepest crater this shot dug (see simulateBouncePhase)
    if (!isHoledOut) {
        if ((currentMode === 'play-hole' || currentMode === 'closest-to-flag') && currentHoleLayout) {
             // Use the utility function to determine surface type at landing position (meters)
             landingSurfaceType = getSurfaceTypeAtPoint(landingPositionObj, currentHoleLayout);
        } else if (currentMode === 'range') {
            landingSurfaceType = 'FAIRWAY'; // Range mode defaults to Fairway landing
        } else {
             console.warn("Calc (Chip): Could not get hole layout for surface detection. Defaulting landing surface to FAIRWAY.");
             landingSurfaceType = 'FAIRWAY'; // Fallback if layout missing
        }
         // Ensure surfaceType is uppercase for getSurfaceProperties lookup
        landingSurfaceType = landingSurfaceType.toUpperCase().replace(' ', '_');

        // --- Decide: Bounce Phase or Direct to Roll? ---
        const landingSpeed = Math.sqrt(landingVelocity.x**2 + landingVelocity.y**2 + landingVelocity.z**2);
        const landingAngleRadians = flightSimulationResult.landingAngleRadians || 0;
        const landingAngleDegrees = landingAngleRadians * 180 / Math.PI;

        // Always use full bounce simulation - it handles shallow landings correctly
        let rollStartPosition, rollStartVelocity, rollStartBackspinRPM, rollStartSidespinRPM;
        let bounceTrajectory = [];
        let bounceEndTime = flightSimulationResult.timeOfFlight; // Start with flight time

        // Get spin state from flight simulation
        const landingSpinRadPerSec = flightSimulationResult.landingSpinRadPerSec || { x: 0, y: 0, z: 0 };

        // Run bounce simulation (pass flight end time and holeLayout)
        const bounceResult = simulateBouncePhase(
            landingPositionObj,
            landingVelocity,
            landingAngleRadians,
            landingSpinRadPerSec,
            landingSurfaceType,
            flightSimulationResult.timeOfFlight, // Start bounce time from end of flight
            currentHoleLayout // Pass holeLayout for dynamic surface detection
        );

        // Use bounce results as starting point for roll
        rollStartPosition = bounceResult.position;
        rollStartVelocity = bounceResult.velocity;
        // Convert spin back to RPM for ground roll
        rollStartBackspinRPM = Math.abs(bounceResult.spin.x) * (60 / (2 * Math.PI));
        rollStartSidespinRPM = bounceResult.spin.y * (60 / (2 * Math.PI));
        bounceTrajectory = bounceResult.bouncePoints || [];
        bounceEndTime = bounceResult.endTime; // Get end time from bounce phase
        shotImpact = bounceResult.impact || null;

        // --- Run Ground Roll Simulation (pass bounce end time and holeLayout) ---
        const groundRollResult = simulateGroundRoll(rollStartPosition, rollStartVelocity, bounceResult.endSurface || landingSurfaceType, rollStartBackspinRPM, rollStartSidespinRPM, bounceEndTime, currentHoleLayout);
        finalPosition = groundRollResult.finalPosition;
        isHoledOut = groundRollResult.isHoledOut;

        // Combine trajectories: flight + bounce + roll
        const fullTrajectory = flightSimulationResult.trajectoryPoints
            .concat(bounceTrajectory)
            .concat(groundRollResult.rollTrajectoryPoints || []);
        flightSimulationResult.trajectoryPoints = fullTrajectory;

        // Update total time for animation
        const totalAnimationTime = groundRollResult.endTime || bounceEndTime;
        flightSimulationResult.timeOfFlight = totalAnimationTime;

    } else {
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
    totalDistance = Math.sqrt(dxTotal*dxTotal + dzTotal*dzTotal); // Keep in meters
    const sideDistance = dxTotal; // Keep in meters

    // --- Determine Result Message ---
     if (isHoledOut) {
        resultMessage += " CHIP IN!";
    }

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
        strikeQuality: strikeQuality, // Use mapped value (Flip -> High for full swings)
        potentialCHS: impactResult.potentialCHS,
        dynamicLoft: impactResult.dynamicLoft,
        smashFactor: impactResult.smashFactor,
        // Simulation results (all distances in meters)
        peakHeight: peakHeight,
        carryDistance: carryDistance,
        rolloutDistance: totalDistance - carryDistance, // Calculate rollout
        totalDistance: totalDistance,
        timeOfFlight: flightSimulationResult.timeOfFlight, // Use actual total time (flight + bounce + roll)
        trajectory: flightSimulationResult.trajectoryPoints, // Now contains combined flight + roll
        sideDistance: sideDistance,
        finalPosition: { x: finalPosition.x, y: finalPosition.y, z: finalPosition.z },
        isHoledOut: isHoledOut,
        surfaceName: getSurfaceTypeAtPoint({ x: finalPosition.x, z: finalPosition.z }, currentHoleLayout) || landingSurfaceType, // Use final position surface, not landing surface
        // How hard the ball buried itself on its deepest impact: 0 skipped
        // off, 1 stopped in its own pitch mark. Nothing reads this yet — it is
        // the measurement a plugged-lie rule would be written against.
        impact: shotImpact
    };

    // Update internal state - set to 'calculating' during animation, will be set to 'result' after animation completes
    setGameState('calculating');

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
    setSwingReport(null); // full-swing feedback only
    const state = getGameState();
    const shotType = getCurrentShotType();
    if (state !== 'calculatingPutt' || shotType !== 'putt') return;

    // Putt animation stopped elsewhere

    setGameState('calculating');
    updateStatus('Calculating Putt...');

    // --- Prepare Inputs ---
    // Rhythm putting: the strike scored against the player's tap tempo.
    const rhythmStrike = consumeRhythmStrike();

    let impactResult;
    if (rhythmStrike) {
        impactResult = calculateRhythmPuttImpact(rhythmStrike);
    } else {
        // Legacy fallback (e.g. timeout path): hold-w-for-power scheme
        const backswingDuration = getBackswingDuration();
        const downswingPhaseStartTime = getDownswingPhaseStartTime();
        const puttHitTime = getPuttHitTime();
        const hitOffset = puttHitTime ? puttHitTime - downswingPhaseStartTime : null;
        impactResult = calculatePuttImpact(backswingDuration, hitOffset);
    }

    // --- Use results ---
    const ballSpeed = impactResult.ballSpeed; // This is speed in mph, need m/s for simulation
    const horizontalLaunchAngleDeg = impactResult.horizontalLaunchAngle; // Horizontal deviation (Push/Pull)
    const strikeQuality = impactResult.strikeQuality;
    let resultMessage = impactResult.message || "Putt Result";
    let isHoledOut = false;
    let finalPosition = null; // Will be Vector3

    // --- Prepare for Simulation ---
    const ballSpeedMPS = ballSpeed * 0.44704; // Convert mph to m/s

    // Calculate Initial Velocity Vector for Simulation
    const targetLineAngleRad = getCurrentTargetLineAngle() * Math.PI / 180;
    const physicsDeviationRad = horizontalLaunchAngleDeg * Math.PI / 180;
    const relativeAimAngleRad = getShotDirectionAngle() * Math.PI / 180;
    const finalHorizontalLaunchAngleRad = targetLineAngleRad + physicsDeviationRad + relativeAimAngleRad;
    const initialVelX = ballSpeedMPS * Math.sin(finalHorizontalLaunchAngleRad);
    const initialVelZ = ballSpeedMPS * Math.cos(finalHorizontalLaunchAngleRad);
    const initialVelocity = new THREE.Vector3(initialVelX, 0, initialVelZ); // Putt starts with Y velocity = 0


    // --- Determine Initial Position ---
    let initialPositionObj;
    const currentMode = getCurrentGameMode();
    if (currentMode === 'play-hole') {
        initialPositionObj = getPlayHoleBallPosition();
        initialPositionObj.y = groundedStartY(initialPositionObj);
    } else {
        initialPositionObj = { x: 0, y: BALL_RADIUS, z: 0 };
    }
    const initialPosition = new THREE.Vector3(initialPositionObj.x, initialPositionObj.y, initialPositionObj.z);

    // --- Run Ground Simulation ---
    // Get current hole layout for surface detection
    const currentHoleLayout = getCurrentHoleLayout();
    // Detect initial surface (default to GREEN for putts)
    let initialSurfaceType = 'GREEN';
    if (currentHoleLayout) {
        const detectedSurface = getSurfaceTypeAtPoint({ x: initialPosition.x, z: initialPosition.z }, currentHoleLayout);
        if (detectedSurface) {
            initialSurfaceType = detectedSurface;
        }
    }
    // Pass a low default backspin for putts (e.g., 100 RPM)
    // Putts start at time 0 (no flight phase)
    const groundRollResult = simulateGroundRoll(initialPosition, initialVelocity, initialSurfaceType, 100, 0, 0, currentHoleLayout);
    finalPosition = groundRollResult.finalPosition; // Vector3
    isHoledOut = groundRollResult.isHoledOut;
    const totalAnimationTime = groundRollResult.endTime || 0;

    // Prepend initial position with time=0 to the roll trajectory (keeps timestamps).
    // Use the roll's display height (terrain + radius + lie offset) so the
    // animation starts exactly where the resting ball is shown — initialPosition.y
    // is the physical height and would make the ball dip at stroke start.
    const rollPts = groundRollResult.rollTrajectoryPoints || [];
    const startY = rollPts.length > 0 ? rollPts[0].y : initialPosition.y;
    const puttTrajectory = [
        { x: initialPosition.x, y: startY, z: initialPosition.z, time: 0 }
    ].concat(rollPts);

    // Calculate final distances
    const dxTotal = finalPosition.x - initialPosition.x;
    const dzTotal = finalPosition.z - initialPosition.z;
    const totalDistance = Math.sqrt(dxTotal*dxTotal + dzTotal*dzTotal); // Keep in meters
    const sideDistance = dxTotal; // Keep in meters

    // --- Determine Final Surface Type ---
    let finalSurfaceType = 'GREEN'; // Default to green
    if (!isHoledOut) {
        const currentHoleLayout = getCurrentHoleLayout();
        if (currentMode === 'play-hole' && currentHoleLayout) {
            const finalPositionObj = { x: finalPosition.x, y: finalPosition.y, z: finalPosition.z };
            finalSurfaceType = getSurfaceTypeAtPoint(finalPositionObj, currentHoleLayout);
            finalSurfaceType = finalSurfaceType.toUpperCase().replace(' ', '_');
        }
    }

    // --- Determine Result Message ---
    if (isHoledOut) {
        resultMessage += " Sunk!";
    } else if (currentMode === 'play-hole' && currentHoleLayout?.flagPosition) {
        // Leave feedback: how far past/short of the hole the putt finished.
        const flag = currentHoleLayout.flagPosition;
        const remaining = Math.hypot(finalPosition.x - flag.x, finalPosition.z - flag.z);
        const startDist = Math.hypot(initialPosition.x - flag.x, initialPosition.z - flag.z);
        if (startDist > 0.01) {
            const dirX = (flag.x - initialPosition.x) / startDist;
            const dirZ = (flag.z - initialPosition.z) / startDist;
            const beyond = (finalPosition.x - flag.x) * dirX + (finalPosition.z - flag.z) * dirZ > 0;
            const distText = remaining < 1
                ? `${(remaining * 100).toFixed(0)} cm`
                : `${remaining.toFixed(1)} m`;
            resultMessage += ` — ${distText} ${beyond ? 'past' : 'short'}`;
        }
    }

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
        strikeQuality: strikeQuality, // Use mapped value (Flip -> High for full swings)
        potentialCHS: 0,
        dynamicLoft: 0,
        smashFactor: 0,
        // Simulation results (all distances in meters)
        peakHeight: 0,
        carryDistance: 0, // No carry for putt
        rolloutDistance: totalDistance, // All putt distance is rollout
        totalDistance: totalDistance,
        timeOfFlight: totalAnimationTime, // Use actual roll time for putts
        // Use the putt trajectory with initial position and timestamps preserved
        trajectory: puttTrajectory,
        sideDistance: sideDistance,
        finalPosition: { x: finalPosition.x, y: finalPosition.y, z: finalPosition.z },
        isHoledOut: isHoledOut,
        surfaceName: finalSurfaceType // Add surface type for lie display
    };

    // Update internal state - set to 'calculating' during animation, will be set to 'result' after animation completes
    setGameState('calculating');

    // --- Call Registered Callback ---
    const callback = getOnShotCompleteCallback();
    if (callback) {
        callback(shotData);
    } else {
        console.warn("Calc (Putt): No shot completion callback registered.");
        updateStatus('Result (Callback Missing) - Press (n)');
    }
}
