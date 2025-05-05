/**
 * swingPhysics.js
 *
 * This module calculates the core physics of the golf swing impact based on timing inputs.
 * It determines club path, face angle, speed, attack angle, dynamic loft, and resulting
 * ball launch conditions (speed, launch angle, spin).
 */

import { clubs } from './clubs.js'; // May need club data (base speed, loft, AoA)
import { getSurfaceProperties } from './surfaces.js'; // Import surface properties getter

// --- Tunable Parameters ---

// Backswing & Potential Speed
const IDEAL_BACKSWING_DURATION_MS = 1000; // Base ideal duration
const BACKSWING_BAR_MAX_DURATION_MS = 1500; // Max duration shown on bar (Added here for calculation)
const BACKSWING_POWER_SENSITIVITY = 1.0; // How much duration affects PCHS (linear = 1.0)
const OVERSWING_PCHS_BONUS_FACTOR = 0.1; // Max % PCHS bonus for reaching max overswing duration
const OVERSWING_DIFFICULTY_PENALTY = 0.15; // Max % ACHS penalty for reaching max overswing duration

// Transition & Speed Efficiency
const IDEAL_TRANSITION_OFFSET_MS = -50; // Ideal 'j' press relative to ideal backswing end
const TRANSITION_TIMING_SENSITIVITY = 350; // ms deviation window for transition affecting ACHS
const MAX_TRANSITION_SPEED_LOSS = 0.3; // Max % ACHS loss from poor transition timing

// Arms/Rotation & Path/Speed Efficiency
const IDEAL_ROTATION_OFFSET_MS = 50; // Ideal 'a' press relative to downswing start
const IDEAL_ARMS_OFFSET_MS = 100; // Ideal 'd' press relative to downswing start
const RELATIVE_ARMS_ROTATION_PATH_SENSITIVITY = 0.5; // Degrees of path change per ms of relative diff (d vs a)
const MAX_RELATIVE_PATH_CHANGE = 6.0; // Max degrees path change from relative timing
const ABSOLUTE_ARMS_ROTATION_TIMING_SENSITIVITY = 200; // ms deviation window for absolute timing affecting path/speed
const MAX_ABSOLUTE_PATH_SHIFT = 6.0; // Max additional degrees path change from poor absolute timing
const MAX_ABSOLUTE_SPEED_LOSS = 0.4; // Max % ACHS loss from poor absolute arms/rotation timing

// Wrists & Face/Loft/Strike
const IDEAL_WRISTS_OFFSET_MS = 200; // Ideal 'i' press relative to downswing start
const WRIST_TIMING_FACE_SENSITIVITY = 0.15; // Degrees of face-relative-to-path change per ms deviation
const MAX_FACE_ANGLE_CHANGE = 8.0; // Max degrees face change from wrist timing
const WRIST_TIMING_LOFT_SENSITIVITY = 0.3; // Degrees of dynamic loft change per ms deviation
const MAX_DYNAMIC_LOFT_CHANGE = 15.0; // Max degrees dynamic loft change
const WRIST_FAT_THIN_THRESHOLD_MS = 100; // ms deviation threshold for Fat/Thin strike

// Attack Angle
const BALLPOS_AOA_SENSITIVITY = 10.0; // Max degrees AoA change from ball position (-1 to +1 factor)
const MAX_NON_TEE_AOA_BONUS = 1.0; // Max degrees positive AoA bonus from ball position when *not* on tee
// const ARMS_AOA_SENSITIVITY = 0.0; // How much arms timing affects AoA (set to 0 based on new rules?)

// Strike & Smash Factor
const FAT_STRIKE_SMASH_PENALTY = 0.25; // % smash factor reduction
const THIN_STRIKE_SMASH_PENALTY = 0.20; // % smash factor reduction
const FLIP_STRIKE_SMASH_PENALTY = 0.10; // % smash factor reduction (early release)
const PUNCH_STRIKE_SMASH_PENALTY = 0.05; // % smash factor reduction (late release)
const BUNKER_FAT_STRIKE_SMASH_PENALTY = 0.10; // Reduced penalty for fat shots from sand

// Spin Calculation Factors (Placeholders - Need Refinement)
const SPIN_AXIS_SENSITIVITY = 6.0; // How much face-to-path affects spin axis tilt
const BACKSPIN_LOFT_FACTOR = 60; // Backspin per degree of dynamic loft
const BACKSPIN_SPEED_FACTOR = 30; // Backspin per mph of ACHS
const BACKSPIN_AOA_FACTOR = -500; // Backspin per degree of positive AoA
const FAT_STRIKE_SPIN_MOD = 0.8; // Multiplier for backspin
const THIN_STRIKE_SPIN_MOD = 0.5; // Multiplier for backspin
const FLIP_STRIKE_SPIN_MOD = 1.2; // Multiplier for backspin (adds spin)
const PUNCH_STRIKE_SPIN_MOD = 0.7; // Multiplier for backspin (reduces spin)
const BUNKER_FAT_STRIKE_SPIN_MOD = 0.9; // Less spin reduction for fat bunker shots


// --- Helper Functions ---

/**
 * Clamps a value between a minimum and maximum.
 * @param {number} value - The value to clamp.
 * @param {number} min - The minimum allowed value.
 * @param {number} max - The maximum allowed value.
 * @returns {number} The clamped value.
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Calculates timing deviation relative to an ideal offset, scaled by swing speed.
 * @param {number | null} actualTime - The timestamp of the action (e.g., armsStartTime).
 * @param {number} downswingStartTime - The timestamp when the downswing phase began.
 * @param {number} idealOffset - The ideal offset (ms) for this action relative to downswing start.
 * @param {number} swingSpeed - The swing speed multiplier (0.3 to 1.0).
 * @param {number} [penaltyTime=5000] - Time added if actualTime is null (missed input).
 * @returns {number} The timing deviation in milliseconds. Positive means late, negative means early.
 */
function calculateTimingDeviation(actualTime, downswingStartTime, idealOffset, swingSpeed, penaltyTime = 5000) {
    const scaledIdealOffset = idealOffset / swingSpeed;
    const effectiveTime = actualTime !== null ? actualTime : downswingStartTime + penaltyTime;
    const actualOffset = effectiveTime - downswingStartTime;
    return actualOffset - scaledIdealOffset;
}


// --- Core Calculation Functions ---

/**
 * Calculates Potential Club Head Speed (PCHS) based on backswing length and club.
 * Longer backswing generally increases PCHS. Overswing adds bonus but increases difficulty (handled elsewhere).
 */
function calculatePotentialCHS(backswingDuration, swingSpeed, clubBaseSpeed) {
    const scaledIdealDuration = IDEAL_BACKSWING_DURATION_MS / swingSpeed;
    // Power factor increases with duration up to ideal, then potentially more slowly.
    // Let's use a simple linear scaling up to ideal, then apply sensitivity beyond.
    let powerFactor;
    if (backswingDuration <= scaledIdealDuration) {
        // Scale linearly from 0 duration (assume min power, e.g., 0.6) up to 1.0 at ideal duration
        const minPowerFactor = 0.6;
        powerFactor = minPowerFactor + (1.0 - minPowerFactor) * (backswingDuration / scaledIdealDuration);
    } else {
        // Beyond ideal, increase factor based on sensitivity, capped potentially
        const overDuration = backswingDuration - scaledIdealDuration;
        // Example: Increase factor by 0.1 for every 500ms over ideal, capped at 1.2?
        powerFactor = 1.0 + clamp(overDuration / (500 / swingSpeed), 0, 2.0) * BACKSWING_POWER_SENSITIVITY * 0.1; // Adjust sensitivity scaling
    }
    powerFactor = clamp(powerFactor, 0.6, 1.5); // Clamp overall power factor

    // Apply Overswing Bonus to Power Factor
    const scaledMaxDuration = BACKSWING_BAR_MAX_DURATION_MS / swingSpeed;
    if (backswingDuration > scaledMaxDuration) {
        // Calculate how far into the "overswing zone" the duration is.
        // Assume the bonus scales linearly from 0 at scaledMaxDuration up to max bonus
        // at some further point (e.g., scaledMaxDuration + 500ms?)
        const overswingWindow = 500 / swingSpeed; // Window beyond max duration for full bonus
        const overswingProgress = clamp((backswingDuration - scaledMaxDuration) / overswingWindow, 0, 1);
        const bonusMultiplier = 1 + (overswingProgress * OVERSWING_PCHS_BONUS_FACTOR);
        powerFactor *= bonusMultiplier;
        console.log(`Overswing Bonus Applied: Progress=${overswingProgress.toFixed(2)}, Multiplier=${bonusMultiplier.toFixed(2)}`);
    }

    // Base PCHS calculation
    let potentialCHS = clubBaseSpeed * powerFactor * swingSpeed; // Apply slider speed last

    console.log(`PCHS Calc: Duration=${backswingDuration.toFixed(0)}, Ideal=${scaledIdealDuration.toFixed(0)}, Factor=${powerFactor.toFixed(2)}, Base=${clubBaseSpeed}, PCHS=${potentialCHS.toFixed(1)}`);
    return potentialCHS;
}

/**
 * Calculates Actual Club Head Speed (ACHS) by applying efficiency losses to PCHS
 * based on transition timing, absolute arms/rotation timing, and overswing penalty.
 * @param {number} backswingDuration - Actual duration of the backswing in ms.
 */
function calculateActualCHS(potentialCHS, transitionDev, armsDev, rotationDev, backswingDuration, swingSpeed) { // Added backswingDuration
    // Transition Efficiency: Perfect timing = 1.0, max loss at edge of sensitivity window
    const transitionLoss = clamp(Math.abs(transitionDev) / (TRANSITION_TIMING_SENSITIVITY / swingSpeed), 0, 1) * MAX_TRANSITION_SPEED_LOSS;
    const transitionEfficiency = 1.0 - transitionLoss;

    // Absolute Sequence Efficiency: Average deviation of arms and rotation
    const absoluteAvgDev = (Math.abs(armsDev) + Math.abs(rotationDev)) / 2;
    const sequenceLoss = clamp(absoluteAvgDev / (ABSOLUTE_ARMS_ROTATION_TIMING_SENSITIVITY / swingSpeed), 0, 1) * MAX_ABSOLUTE_SPEED_LOSS;
    const sequenceEfficiency = 1.0 - sequenceLoss;

    // Apply Overswing Difficulty Penalty Factor
    let overswingPenaltyFactor = 1.0;
    const scaledMaxDuration = BACKSWING_BAR_MAX_DURATION_MS / swingSpeed;
    if (backswingDuration > scaledMaxDuration) { // Check if backswingDuration is available
        const overswingWindow = 500 / swingSpeed; // Window beyond max duration for full penalty
        const overswingProgress = clamp((backswingDuration - scaledMaxDuration) / overswingWindow, 0, 1);
        overswingPenaltyFactor = 1.0 - (overswingProgress * OVERSWING_DIFFICULTY_PENALTY);
        console.log(`Overswing Difficulty Penalty Applied: Progress=${overswingProgress.toFixed(2)}, PenaltyFactor=${overswingPenaltyFactor.toFixed(2)}`);
    } else {
         console.log(`Overswing Difficulty Penalty Applied: Not applicable (Duration ${backswingDuration?.toFixed(0)} <= Scaled Max ${scaledMaxDuration.toFixed(0)})`);
    }


    // Final ACHS
    const actualCHS = potentialCHS * transitionEfficiency * sequenceEfficiency * overswingPenaltyFactor;
    console.log(`ACHS Calc: PCHS=${potentialCHS.toFixed(1)}, TransEff=${transitionEfficiency.toFixed(2)}, SeqEff=${sequenceEfficiency.toFixed(2)}, OverPenalty=${overswingPenaltyFactor.toFixed(2)}, ACHS=${actualCHS.toFixed(1)}`);
    return actualCHS;
}

/**
 * Calculates the Club Path Angle relative to the target line based on
 * relative timing (arms vs rotation) and absolute timing (average deviation).
 */
function calculateClubPathAngle(armsDev, rotationDev, swingSpeed) {
    console.log(`Path Calc: ArmsDev=${armsDev.toFixed(0)}, RotationDev=${rotationDev.toFixed(0)}`);
    // Relative Timing: Arms late ('d' after 'a') = negative path (out-to-in)
    //const relativeDev = armsDev - rotationDev; // Positive = arms later than rotation
    const relativeDev = rotationDev - armsDev; // Positive = arms later than rotation
    const scaledRelativeSensitivity = RELATIVE_ARMS_ROTATION_PATH_SENSITIVITY / (10 / swingSpeed); // Degrees per ms deviation, scaled
    let pathFromRelative = clamp(relativeDev * scaledRelativeSensitivity, -MAX_RELATIVE_PATH_CHANGE, MAX_RELATIVE_PATH_CHANGE);

    // Absolute Timing: Average deviation shifts path further
    const absoluteAvgDev = (armsDev + rotationDev) / 2;
    const absoluteFactor = clamp(absoluteAvgDev / (ABSOLUTE_ARMS_ROTATION_TIMING_SENSITIVITY / swingSpeed), -1, 1); // -1 (early) to +1 (late)
    // Late absolute timing exaggerates the path direction (e.g., makes out-to-in more negative)
    // Early absolute timing might moderate the path direction? Let's make it exaggerate for now.
    let pathShiftFromAbsolute = absoluteFactor * MAX_ABSOLUTE_PATH_SHIFT;

    // Combine: Add absolute shift to relative path
    // Consider if shift should always be in the same direction as relative path?
    // Example: Late relative (out-in, neg path) + Late absolute = more negative path.
    // Example: Late relative (out-in, neg path) + Early absolute = less negative path?
    // Let's try: Absolute shift adds to the magnitude in the direction of relative path.
    const finalPath = pathFromRelative + (pathFromRelative === 0 ? 0 : Math.sign(pathFromRelative) * pathShiftFromAbsolute);
    // Clamp final path? Maybe not needed if inputs are clamped.

    console.log(`Path Calc: RelDev=${relativeDev.toFixed(0)}, PathRel=${pathFromRelative.toFixed(1)}, AbsAvgDev=${absoluteAvgDev.toFixed(0)}, PathAbsShift=${pathShiftFromAbsolute.toFixed(1)}, FinalPath=${finalPath.toFixed(1)}`);
    return finalPath; // Degrees (negative = out-to-in, positive = in-to-out)
}

/**
 * Calculates the Clubface Angle relative to the calculated Club Path,
 * based primarily on wrist release timing.
 */
function calculateFaceAngleRelativeToPath(wristsDev, swingSpeed) {
    // Wrist Timing: Late release ('i' late) = open face relative to path (positive angle)
    // Early release ('i' early) = closed face relative to path (negative angle)
    const scaledWristSensitivity = WRIST_TIMING_FACE_SENSITIVITY / (10 / swingSpeed); // Degrees per ms deviation, scaled
    const faceAngle = clamp(wristsDev * scaledWristSensitivity, -MAX_FACE_ANGLE_CHANGE, MAX_FACE_ANGLE_CHANGE);

    console.log(`Face>Path Calc: WristsDev=${wristsDev.toFixed(0)}, FaceAngle=${faceAngle.toFixed(1)}`);
    return faceAngle; // Degrees (negative = closed, positive = open)
}

/**
 * Calculates the Dynamic Loft at impact, based on base club loft,
 * wrist release timing (adding/removing loft), and potentially Attack Angle.
 */
function calculateDynamicLoft(baseLoft, wristsDev, attackAngle, swingSpeed) {
    // Wrist Timing: Late release ('i' late) = deloft (negative change)
    // Early release ('i' early) = add loft (positive change)
    const scaledLoftSensitivity = WRIST_TIMING_LOFT_SENSITIVITY / (10 / swingSpeed); // Degrees per ms deviation, scaled
    // Negative wristsDev (early) should increase loft, so multiply by -1
    const loftChange = clamp(-wristsDev * scaledLoftSensitivity, -MAX_DYNAMIC_LOFT_CHANGE, MAX_DYNAMIC_LOFT_CHANGE);

    // Combine base loft and change from wrists. AoA influence is complex, handle in spin/launch.
    const dynamicLoft = baseLoft + loftChange;

    console.log(`DynLoft Calc: Base=${baseLoft}, WristsDev=${wristsDev.toFixed(0)}, LoftChange=${loftChange.toFixed(1)}, DynLoft=${dynamicLoft.toFixed(1)}`);
    return dynamicLoft;
}

/**
 * Calculates the Attack Angle (AoA) based on base club AoA, ball position, and surface.
 * @param {number} baseAoA - The club's default attack angle.
 * @param {number} ballPositionFactor - Factor from -1 (Fwd) to +1 (Back).
 * @param {string} currentSurface - The surface the ball is on (e.g., 'TEE', 'FAIRWAY').
 */
function calculateAttackAngle(baseAoA, ballPositionFactor, currentSurface) {
    // Ball Position Factor: -1 (Forward) to +1 (Back)
    // Forward ball pos (-1) = more positive AoA (upward hit) -> multiply factor by -Sensitivity
    // Backward ball pos (+1) = more negative AoA (downward hit) -> multiply factor by -Sensitivity
    let aoaFromBallPos = ballPositionFactor * -BALLPOS_AOA_SENSITIVITY;

    // Apply cap if not on tee and AoA bonus is positive
    // Convert surface to lowercase for comparison
    if (currentSurface.toLowerCase() !== 'tee' && aoaFromBallPos > 0) {
        aoaFromBallPos = Math.min(aoaFromBallPos, MAX_NON_TEE_AOA_BONUS);
        console.log(`AoA Calc: Capping non-tee AoA bonus to ${MAX_NON_TEE_AOA_BONUS}`);
    }

    const attackAngle = baseAoA + aoaFromBallPos;

    console.log(`AoA Calc: Base=${baseAoA}, BallPosFactor=${ballPositionFactor.toFixed(2)}, Surface=${currentSurface}, AoAChange=${aoaFromBallPos.toFixed(1)}, FinalAoA=${attackAngle.toFixed(1)}`);
    return attackAngle;
}

/**
 * Determines the strike quality (Center, Fat, Thin, Flip, Punch) based on
 * extreme wrist timing or large AoA deviations.
 */
function calculateStrikeQuality(wristsDev, attackAngle, baseAoA, swingSpeed) {
    const scaledFatThinThreshold = WRIST_FAT_THIN_THRESHOLD_MS / swingSpeed;
    const aoaDev = attackAngle - baseAoA;
    // Define AoA thresholds (could vary by club type later)
    const aoaFatThreshold = -5; // More negative than -5 deg vs base = Fat
    const aoaThinThreshold = 7; // More positive than +7 deg vs base = Thin

    // Check extreme wrist timing first
    if (wristsDev < -scaledFatThinThreshold) return "Fat"; // Very early release
    if (wristsDev > scaledFatThinThreshold) return "Thin"; // Very late release

    // Check large AoA deviations
    if (aoaDev < aoaFatThreshold) return "Fat";
    if (aoaDev > aoaThinThreshold) return "Thin";

    // Check intermediate wrist timing for Flip/Punch
    // Use half the threshold?
    if (wristsDev < -scaledFatThinThreshold / 2) return "Flip"; // Early-ish
    if (wristsDev > scaledFatThinThreshold / 2) return "Punch"; // Late-ish

    return "Center";
}

/**
 * Calculates the Smash Factor based on base club smash, strike quality penalty, and surface.
 * @param {number} baseSmash - Club's base smash factor.
 * @param {string} strikeQuality - Calculated strike quality ("Fat", "Thin", etc.).
 * @param {string} currentSurface - The surface the ball is on.
 * @returns {number} The final smash factor.
 */
function calculateSmashFactor(baseSmash, strikeQuality, currentSurface) {
    let penalty = 0;
    // Special handling for fat shots from bunker
    if (strikeQuality === "Fat" && currentSurface.toUpperCase() === 'BUNKER') {
        penalty = BUNKER_FAT_STRIKE_SMASH_PENALTY;
        console.log(`Smash Calc: Applying BUNKER Fat penalty: ${penalty.toFixed(2)}`);
    } else {
        // Standard penalties
        switch (strikeQuality) {
            case "Fat": penalty = FAT_STRIKE_SMASH_PENALTY; break;
        case "Thin": penalty = THIN_STRIKE_SMASH_PENALTY; break;
        case "Flip": penalty = FLIP_STRIKE_SMASH_PENALTY; break;
        case "Punch": penalty = PUNCH_STRIKE_SMASH_PENALTY; break;
            default: penalty = 0; break; // Center
        }
    }
    const smash = baseSmash * (1 - penalty);
    console.log(`Smash Calc: Base=${baseSmash}, Strike=${strikeQuality}, Surface=${currentSurface}, Penalty=${penalty.toFixed(2)}, FinalSmash=${smash.toFixed(2)}`);
    return smash;
}

/** Calculates Ball Speed from Actual CHS and Smash Factor. */
function calculateBallSpeed(actualCHS, smashFactor) {
    return actualCHS * smashFactor;
}

/**
 * Calculates the initial Launch Angle based on dynamic loft and attack angle.
 * Uses a 75/25 blend.
 */
function calculateLaunchAngle(dynamicLoft, attackAngle) {
    // Blend dynamic loft (75%) and attack angle (25%)
    const launchAngle = dynamicLoft * 0.8 + attackAngle * 1;
    console.log(`Launch Calc: DynLoft=${dynamicLoft.toFixed(1)}, AoA=${attackAngle.toFixed(1)}, BlendLaunch=${launchAngle.toFixed(1)}`);
    // Add clamping based on club type later if needed (e.g., min/max launch)
    return launchAngle;
}

/**
 * Calculates the Spin Axis Tilt (degrees from horizontal) based on face-to-path angle and dynamic loft.
 * Positive tilt corresponds to slice spin, negative to hook spin.
 */
function calculateSpinAxis(faceAngleRelativeToPath, dynamicLoft) {
    // Simplified physics model: tilt = atan(sin(face-to-path) / cos(dynamic_loft))
    // This approximates the tilt of the spin axis relative to the ground plane.
    const faceToPathRad = faceAngleRelativeToPath * Math.PI / 180;
    const loftRad = dynamicLoft * Math.PI / 180;

    let tiltAngleRad = 0;
    const cosLoft = Math.cos(loftRad);
    if (Math.abs(cosLoft) > 1e-6) { // Avoid division by zero if loft is 90 deg
       tiltAngleRad = Math.atan(Math.sin(faceToPathRad) / cosLoft);
    }

    let tiltAngleDeg = tiltAngleRad * 180 / Math.PI;
    tiltAngleDeg *= SPIN_AXIS_SENSITIVITY; // Apply sensitivity tuning factor

    console.log(`SpinAxis Calc: FaceToPath=${faceAngleRelativeToPath.toFixed(1)}, DynLoft=${dynamicLoft.toFixed(1)}, Tilt=${tiltAngleDeg.toFixed(1)}`);
    return tiltAngleDeg; // Degrees
}

/**
 * Calculates the Back Spin rate (RPM) based on dynamic loft, speed, AoA, strike quality, and surface.
 * @param {number} dynamicLoft - Calculated dynamic loft.
 * @param {number} actualCHS - Calculated actual club head speed.
 * @param {number} attackAngle - Calculated attack angle.
 * @param {string} strikeQuality - Calculated strike quality.
 * @param {string} currentSurface - The surface the ball is on.
 * @returns {number} The final backspin in RPM.
 */
function calculateBackSpin(dynamicLoft, actualCHS, attackAngle, strikeQuality, currentSurface) {
    // Base spin calculation (needs significant tuning)
    // Higher loft, higher speed = more spin. Steeper AoA (more negative) = more spin.
    let baseSpin = 1000 + // Base minimum spin
                   (dynamicLoft * BACKSPIN_LOFT_FACTOR) +
                   (actualCHS * BACKSPIN_SPEED_FACTOR) +
                   (attackAngle * BACKSPIN_AOA_FACTOR); // Note: More negative AoA increases spin

    // Apply modifier based on strike quality and surface
    let strikeMod = 1.0;
    // Special handling for fat shots from bunker
    if (strikeQuality === "Fat" && currentSurface.toUpperCase() === 'BUNKER') {
        strikeMod = BUNKER_FAT_STRIKE_SPIN_MOD;
        console.log(`BackSpin Calc: Applying BUNKER Fat strike modifier: ${strikeMod.toFixed(2)}`);
    } else {
        // Standard modifiers
        switch (strikeQuality) {
            case "Fat": strikeMod = FAT_STRIKE_SPIN_MOD; break; // Less compression
        case "Thin": strikeMod = THIN_STRIKE_SPIN_MOD; break; // Hits equator
        case "Flip": strikeMod = FLIP_STRIKE_SPIN_MOD; break; // Adds spin (scooping)
            case "Punch": strikeMod = PUNCH_STRIKE_SPIN_MOD; break; // Less spin (delofting)
        }
    }
    let backSpin = baseSpin * strikeMod;

    // Clamp backspin to reasonable limits
    backSpin = clamp(backSpin, 500, 12000);

    console.log(`BackSpin Calc: DynLoft=${dynamicLoft.toFixed(1)}, ACHS=${actualCHS.toFixed(1)}, AoA=${attackAngle.toFixed(1)}, BaseSpin=${baseSpin.toFixed(0)}, Strike=${strikeQuality}, Surface=${currentSurface}, Mod=${strikeMod.toFixed(2)}, FinalSpin=${backSpin.toFixed(0)}`);
    return backSpin; // RPM
}


// --- Main Exported Function ---

/**
 * Calculates all impact physics parameters based on swing timing inputs.
 *
 * @param {object} timingInputs - Object containing all timing data.
 * @param {number} timingInputs.backswingDuration - Duration of the backswing in ms.
 * @param {number | null} timingInputs.hipInitiationTime - Timestamp of 'j' press.
 * @param {number | null} timingInputs.rotationStartTime - Timestamp of 'a' press (if after backswing).
 * @param {number | null} timingInputs.rotationInitiationTime - Timestamp of 'a' press (if during backswing).
 * @param {number | null} timingInputs.armsStartTime - Timestamp of 'd' press.
 * @param {number | null} timingInputs.wristsStartTime - Timestamp of 'i' press.
 * @param {number} timingInputs.downswingPhaseStartTime - Timestamp when downswing bars started (triggered by 'j' or 'w' release).
 * @param {number} timingInputs.idealBackswingEndTime - Calculated ideal end time for transition reference.
 * @param {object} club - The selected club object from clubs.js.
 * @param {number} swingSpeed - The current swing speed multiplier (0.3 - 1.0).
 * @param {number} ballPositionFactor - Factor representing ball position (-1 Fwd to +1 Back).
 * @param {string} currentSurface - The surface the ball is currently on.
 * @returns {object} An object containing calculated impact parameters.
 */
export function calculateImpactPhysics(timingInputs, club, swingSpeed, ballPositionFactor, currentSurface) {
    console.log("--- Calculating Impact Physics ---");
    console.log("Inputs:", timingInputs, club.name, swingSpeed, ballPositionFactor, `Surface: ${currentSurface}`);

    // Calculate Deviations (relative to downswing start)
    const rotationTime = timingInputs.rotationStartTime ?? timingInputs.rotationInitiationTime; // Use whichever 'a' press happened
    const rotationDev = calculateTimingDeviation(rotationTime, timingInputs.downswingPhaseStartTime, IDEAL_ROTATION_OFFSET_MS, swingSpeed);
    const armsDev = calculateTimingDeviation(timingInputs.armsStartTime, timingInputs.downswingPhaseStartTime, IDEAL_ARMS_OFFSET_MS, swingSpeed);
    const wristsDev = calculateTimingDeviation(timingInputs.wristsStartTime, timingInputs.downswingPhaseStartTime, IDEAL_WRISTS_OFFSET_MS, swingSpeed);

    // Calculate Transition Deviation (relative to ideal backswing end)
    const idealTransitionTime = timingInputs.idealBackswingEndTime + (IDEAL_TRANSITION_OFFSET_MS / swingSpeed);
    const actualTransitionTime = timingInputs.hipInitiationTime ?? timingInputs.downswingPhaseStartTime; // Use 'j' press or fallback to downswing start
    const transitionDev = actualTransitionTime - idealTransitionTime;

    console.log(`Deviations: Trans=${transitionDev.toFixed(0)}, Rot=${rotationDev.toFixed(0)}, Arms=${armsDev.toFixed(0)}, Wrists=${wristsDev.toFixed(0)}`);

    // --- Calculate Core Parameters ---
    const potentialCHS = calculatePotentialCHS(timingInputs.backswingDuration, swingSpeed, club.basePotentialSpeed);
    // Pass backswingDuration to calculateActualCHS for overswing penalty
    const actualCHS = calculateActualCHS(potentialCHS, transitionDev, armsDev, rotationDev, timingInputs.backswingDuration, swingSpeed);
    const clubPathAngle = calculateClubPathAngle(armsDev, rotationDev, swingSpeed);
    const faceAngleRelPath = calculateFaceAngleRelativeToPath(wristsDev, swingSpeed);
    const absoluteFaceAngle = clubPathAngle + faceAngleRelPath;
    const attackAngle = calculateAttackAngle(club.baseAoA, ballPositionFactor, currentSurface); // Pass currentSurface
    const dynamicLoft = calculateDynamicLoft(club.loft, wristsDev, attackAngle, swingSpeed);
    const strikeQuality = calculateStrikeQuality(wristsDev, attackAngle, club.baseAoA, swingSpeed);
    // Pass surface to smash factor and backspin calculations
    const smashFactor = calculateSmashFactor(club.baseSmash, strikeQuality, currentSurface);
    let ballSpeed = calculateBallSpeed(actualCHS, smashFactor); // Calculate initial ball speed
    let launchAngle = calculateLaunchAngle(dynamicLoft, attackAngle); // Calculate initial launch angle
    let backSpin = calculateBackSpin(dynamicLoft, actualCHS, attackAngle, strikeQuality, currentSurface); // Calculate initial backspin

    // --- Apply Surface Flight Modifications ---
    const surfaceProps = getSurfaceProperties(currentSurface);
    const flightMod = surfaceProps?.flightModification;

    if (flightMod) {
        console.log("Applying surface flight modifications:", flightMod);
        // Velocity Reduction (Apply to Ball Speed)
        let velReduction = flightMod.velocityReduction || 0;
        if (Array.isArray(velReduction)) {
            const [min, max] = velReduction;
            velReduction = min + Math.random() * (max - min);
            console.log(`Randomized Velocity Reduction: ${velReduction.toFixed(3)} (Range: [${min}, ${max}])`);
        }
        ballSpeed *= (1 - velReduction);

        // Spin Reduction (Apply to Back Spin)
        let spinReduction = flightMod.spinReduction || 0;
        if (Array.isArray(spinReduction)) {
            const [min, max] = spinReduction;
            spinReduction = min + Math.random() * (max - min);
            console.log(`Randomized Spin Reduction: ${spinReduction.toFixed(3)} (Range: [${min}, ${max}])`);
        }
        backSpin *= (1 - spinReduction);
        // Also apply to side spin? Let's assume yes for now.
        // sideSpin *= (1 - spinReduction); // Apply before side spin calculation below

        // Launch Angle Change
        const launchChange = flightMod.launchAngleChange || 0;
        launchAngle += launchChange;

        console.log(`Post-Surface Mod: BallSpeed=${ballSpeed.toFixed(1)}, BackSpin=${backSpin.toFixed(0)}, LaunchAngle=${launchAngle.toFixed(1)}`);
    }

    // --- Calculate Spin Axis and Side Spin (AFTER potential backspin reduction) ---
    const spinAxisTilt = calculateSpinAxis(faceAngleRelPath, dynamicLoft); // Tilt depends on face/path/loft, not surface directly
    let sideSpin = spinAxisTilt * 150; // Example: 1 degree tilt = 150 RPM side spin

    // Apply spin reduction to side spin as well
    if (flightMod && flightMod.spinReduction) {
         let spinReductionFactor = flightMod.spinReduction;
         if (Array.isArray(spinReductionFactor)) {
             // If it was randomized for backspin, we should ideally use the *same* random factor
             // For simplicity now, let's just re-randomize or use the midpoint? Re-randomize is easier.
             const [min, max] = spinReductionFactor;
             spinReductionFactor = min + Math.random() * (max - min);
         }
         sideSpin *= (1 - spinReductionFactor);
         console.log(`Post-Surface Mod SideSpin: ${sideSpin.toFixed(0)} (ReductionFactor: ${spinReductionFactor.toFixed(3)})`);
    }

    console.log(`SideSpin Calc: Tilt=${spinAxisTilt.toFixed(1)}, Final SideSpin=${sideSpin.toFixed(0)}`);


    // --- Assemble Result Object ---

    console.log(`SideSpin Calc: Tilt=${spinAxisTilt.toFixed(1)}, SideSpin=${sideSpin.toFixed(0)}`);


    // --- Assemble Result Object ---
    const impactResult = {
        // Input Deviations (for potential UI display/logging)
        transitionDev: transitionDev,
        rotationDev: rotationDev,
        armsDev: armsDev,
        wristsDev: wristsDev,

        // Core Impact Parameters
        potentialCHS: potentialCHS,
        actualCHS: actualCHS,
        clubPathAngle: clubPathAngle, // degrees, relative to target line
        faceAngleRelPath: faceAngleRelPath, // degrees, relative to path
        absoluteFaceAngle: absoluteFaceAngle, // degrees, relative to target line
        attackAngle: attackAngle, // degrees
        dynamicLoft: dynamicLoft, // degrees
        strikeQuality: strikeQuality, // "Center", "Fat", "Thin", "Flip", "Punch"

        // Ball Launch Conditions
        smashFactor: smashFactor,
        ballSpeed: ballSpeed, // mph
        launchAngle: launchAngle, // degrees
        spinAxisTilt: spinAxisTilt, // degrees tilt from horizontal
        backSpin: backSpin, // RPM
        sideSpin: sideSpin, // RPM (positive = slice spin, negative = hook spin)
    };

    console.log("--- Impact Physics Calculation Complete ---");
    console.log("Result:", impactResult);

    return impactResult;
}
