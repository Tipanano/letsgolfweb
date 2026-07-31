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
export const IDEAL_BACKSWING_DURATION_MS = 1150; // Base ideal duration
const BACKSWING_BAR_MAX_DURATION_MS = 1500; // Max duration shown on bar (Added here for calculation)
const BACKSWING_POWER_SENSITIVITY = 1.0; // How much duration affects PCHS (linear = 1.0)
const OVERSWING_PCHS_BONUS_FACTOR = 0.2; // Max % PCHS bonus for reaching max overswing duration
const OVERSWING_DIFFICULTY_PENALTY = 0.15; // Max % ACHS penalty for reaching max overswing duration
// Clubhead speed scales with sqrt(power): easing off costs real distance but
// less than proportionally, like a real smooth swing (57% power → 75% CHS →
// a ~185 m drive instead of a 250 m bomb). The old linear factor of 0.3 let
// a 57% swing keep 87% of its speed while every timing window got the full
// 1/0.57 slow-down — low power made the swing much easier at almost no
// distance cost.
const SWING_SPEED_TO_CHS_EXPONENT = 0.5;

// Transition & Speed Efficiency
export const IDEAL_TRANSITION_OFFSET_MS = -150; // Ideal 'j' press relative to ideal backswing end
const TRANSITION_TIMING_SENSITIVITY = 350; // ms deviation window for transition affecting ACHS
const MAX_TRANSITION_SPEED_LOSS = 0.4; // Max % ACHS loss from poor transition timing (40% penalty for very late/no hip initiation)

// ACHS Penalty Scaling based on PCHS
const PCHS_THRESHOLD_FOR_REDUCED_PENALTY = 75; // PCHS at or below which the minimum penalty scaling applies (mph)
const PCHS_THRESHOLD_FOR_FULL_PENALTY = 100;   // PCHS at or above which the full, original penalty applies (mph)
const MIN_PENALTY_SCALE_FACTOR = 0.6;          // Multiplier for max loss at low PCHS (e.g., 0.6 = 60% of original max loss)


// Arms/Rotation & Path/Speed Efficiency
// Touch thumbs can't drum the pianistic keyboard offsets (+50/+100/+250 ms
// between alternating taps), so the touch layer stretches the downswing
// ideal offsets. Sensitivities (deg/ms) stay untouched - precision still
// matters, the targets just land at humanly drummable times.
let downswingTimingStretch = 1.0;
export function setDownswingTimingStretch(factor) {
    downswingTimingStretch = Math.max(1, Math.min(3, factor || 1));
}
export function getDownswingTimingStretch() {
    return downswingTimingStretch;
}

export const IDEAL_ROTATION_OFFSET_MS = 50; // Ideal 'a' press relative to downswing start
export const IDEAL_ARMS_OFFSET_MS = 100; // Ideal 'd' press relative to downswing start
const RELATIVE_ARMS_ROTATION_PATH_SENSITIVITY = 1.0; // Degrees of path change per ms of relative diff (d vs a)
const MAX_RELATIVE_PATH_CHANGE = 10.0; // Max degrees path change from relative timing
const ABSOLUTE_ARMS_ROTATION_TIMING_SENSITIVITY = 225; // ms deviation window for absolute timing affecting path/speed
const MAX_ABSOLUTE_PATH_SHIFT = 6.0; // Max additional degrees path change from poor absolute timing
const MAX_ABSOLUTE_SPEED_LOSS = 0.4; // Max % ACHS loss from poor absolute arms/rotation timing

// Wrists & Face/Loft/Strike
export const IDEAL_WRISTS_OFFSET_MS = 250; // Ideal 'i' press relative to downswing start
const WRIST_TIMING_FACE_SENSITIVITY = 0.5; // Degrees of face-relative-to-path change per ms deviation
const MAX_FACE_ANGLE_CHANGE = 12.0; // Max degrees face change from wrist timing
const WRIST_TIMING_LOFT_SENSITIVITY = 0.3; // Degrees of dynamic loft change per ms deviation
const MAX_DYNAMIC_LOFT_CHANGE = 15.0; // Max degrees dynamic loft change
const WRIST_FAT_THIN_THRESHOLD_MS = 100; // ms deviation threshold for Fat/Thin strike

// Attack Angle
const BALLPOS_AOA_SENSITIVITY = 5.0; // Max degrees AoA change from ball position (-1 to +1 factor)
const BALLPOS_STRIKE_WINDOW_TILT = 0.15; // Ball forward off turf tightens the fat/thin wrist window (max -15%)
const MAX_NON_TEE_AOA_BONUS = 1.0; // Max degrees positive AoA bonus from ball position when *not* on tee
// const ARMS_AOA_SENSITIVITY = 0.0; // How much arms timing affects AoA (set to 0 based on new rules?)

// Strike & Smash Factor
const FAT_STRIKE_SMASH_PENALTY = 0.25; // % smash factor reduction
const THIN_STRIKE_SMASH_PENALTY = 0.20; // % smash factor reduction
const FLIP_STRIKE_SMASH_PENALTY = 0.05; // % smash factor reduction (early release, displays as "High")
const PUNCH_STRIKE_SMASH_PENALTY = 0.05; // % smash factor reduction (late release)
const BUNKER_FAT_STRIKE_SMASH_PENALTY = 0.10; // Reduced penalty for fat shots from sand

// Spin Calculation: physics-based via spin loft and spin axis tilt.
//
// Total spin (RPM) ≈ k(loft) · BallSpeed(mph) · sin(SpinLoft)
//   where SpinLoft = DynamicLoft − AttackAngle.
// k(loft) rises super-linearly with loft because wedge friction/groove
// engagement is much higher than driver face friction. A quadratic fit
// matches PGA Tour data better than a linear coefficient:
//   Driver  10.5° → k ≈ 87    →  ~2700 rpm
//   7-iron  32°   → k ≈ 105   →  ~7400 rpm
//   PW      45°   → k ≈ 125   →  ~9700 rpm
//   LW      60°   → k ≈ 157   → ~10800 rpm
const SPIN_LOFT_K_BASE = 85;        // coefficient at 0° loft
const SPIN_LOFT_K_QUAD = 0.020;     // adds k(loft) = base + quad·loft²

// Strike quality multipliers on spin loft engagement (not on final spin —
// these scale the effective spin loft to model groove/contact deterioration).
const STRIKE_SPIN_MOD = {
    Center: 1.00,
    Flip:   1.15,  // early release → adds loft → adds spin
    Punch:  0.75,  // late release → delofts → less spin
    Thin:   0.55,  // contacts equator → poor compression
    Fat:    0.70,  // grass/turf between face and ball
};

// (Strike spin modifiers now live in STRIKE_SPIN_MOD above; bunker fat is handled
// in the spin calculation explicitly.)


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
 * @param {number} actualBackswingDuration - The player's actual backswing duration in ms.
 * @param {number} idealBackswingBaseMs - The game's base ideal backswing duration (e.g., IDEAL_BACKSWING_DURATION_MS).
 * @param {number} [penaltyTime=5000] - Time added if actualTime is null (missed input).
 * @returns {number} The timing deviation in milliseconds. Positive means late, negative means early.
 */
function calculateTimingDeviation(actualTime, downswingStartTime, idealOffset, swingSpeed, actualBackswingDuration, idealBackswingBaseMs, penaltyTime = 5000) {
    const idealBackswingForTempo = idealBackswingBaseMs / swingSpeed;
    const durationScalingFactor = actualBackswingDuration / idealBackswingForTempo;
    // Ideal offset is scaled first by swingSpeed (overall tempo), then by the ratio of actual backswing length to the ideal length for that tempo.
    const scaledIdealOffset = (idealOffset / swingSpeed) * durationScalingFactor;
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
    }

    // Base PCHS calculation
    let modifiedSwingSpeedFactor = Math.pow(swingSpeed, SWING_SPEED_TO_CHS_EXPONENT);

    let potentialCHS = clubBaseSpeed * powerFactor * modifiedSwingSpeedFactor; // Apply slider speed last

    return potentialCHS;
}

/**
 * Calculates Actual Club Head Speed (ACHS) by applying efficiency losses to PCHS
 * based on transition timing, absolute arms/rotation timing, and overswing penalty.
 * @param {number} backswingDuration - Actual duration of the backswing in ms.
 */
function calculateActualCHS(potentialCHS, transitionDev, armsDev, rotationDev, backswingDuration, swingSpeed, scaledTransitionSensitivity) {
    // Calculate Penalty Scale Factor based on PCHS
    let penaltyScaleFactor = 1.0;
    if (potentialCHS <= PCHS_THRESHOLD_FOR_REDUCED_PENALTY) {
        penaltyScaleFactor = MIN_PENALTY_SCALE_FACTOR;
    } else if (potentialCHS < PCHS_THRESHOLD_FOR_FULL_PENALTY) {
        // Linearly interpolate between MIN_PENALTY_SCALE_FACTOR and 1.0
        const range = PCHS_THRESHOLD_FOR_FULL_PENALTY - PCHS_THRESHOLD_FOR_REDUCED_PENALTY;
        const progress = (potentialCHS - PCHS_THRESHOLD_FOR_REDUCED_PENALTY) / range;
        penaltyScaleFactor = MIN_PENALTY_SCALE_FACTOR + (1.0 - MIN_PENALTY_SCALE_FACTOR) * progress;
    }
    // If potentialCHS >= PCHS_THRESHOLD_FOR_FULL_PENALTY, penaltyScaleFactor remains 1.0


    // Transition Efficiency: Perfect timing = 1.0, max loss at edge of sensitivity window
    // Use the scaledTransitionSensitivity passed in.
    const adjustedMaxTransitionLoss = MAX_TRANSITION_SPEED_LOSS * penaltyScaleFactor;
    const transitionLoss = clamp(Math.abs(transitionDev) / scaledTransitionSensitivity, 0, 1) * adjustedMaxTransitionLoss;
    const transitionEfficiency = 1.0 - transitionLoss;

    // Absolute Sequence Efficiency: Average deviation of arms and rotation
    // The sensitivity for this is already scaled within calculateTimingDeviation via durationScalingFactor
    const adjustedMaxSequenceLoss = MAX_ABSOLUTE_SPEED_LOSS * penaltyScaleFactor;
    const absoluteAvgDev = (Math.abs(armsDev) + Math.abs(rotationDev)) / 2;
    const sequenceLoss = clamp(absoluteAvgDev / (ABSOLUTE_ARMS_ROTATION_TIMING_SENSITIVITY / swingSpeed), 0, 1) * adjustedMaxSequenceLoss;
    const sequenceEfficiency = 1.0 - sequenceLoss;

    // Apply Overswing Difficulty Penalty Factor
    let overswingPenaltyFactor = 1.0;
    const scaledMaxDuration = BACKSWING_BAR_MAX_DURATION_MS / swingSpeed;
    if (backswingDuration > scaledMaxDuration) { // Check if backswingDuration is available
        const overswingWindow = 500 / swingSpeed; // Window beyond max duration for full penalty
        const overswingProgress = clamp((backswingDuration - scaledMaxDuration) / overswingWindow, 0, 1);
        overswingPenaltyFactor = 1.0 - (overswingProgress * OVERSWING_DIFFICULTY_PENALTY);
    } else {
    }


    // Final ACHS
    const actualCHS = potentialCHS * transitionEfficiency * sequenceEfficiency * overswingPenaltyFactor;
    return actualCHS;
}

/**
 * Calculates the Club Path Angle relative to the target line based on
 * relative timing (arms vs rotation) and absolute timing (average deviation).
 */
function calculateClubPathAngle(armsDev, rotationDev, swingSpeed) {
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
    const MAX_NON_TEE_AOA_BONUS = 1.0; // Max positive AoA bonus when not on tee
    if (currentSurface.toLowerCase() !== 'tee' && aoaFromBallPos > 0) {
        aoaFromBallPos = Math.min(aoaFromBallPos, MAX_NON_TEE_AOA_BONUS);
       if (baseAoA > 0) {
            baseAoA = 0
       }
    }

    const attackAngle = baseAoA + aoaFromBallPos;

    return attackAngle;
}

/**
 * Determines the strike quality (Center, Fat, Thin, Flip, Punch) based on
 * extreme wrist timing or large AoA deviations. Ball forward off turf moves
 * the strike past the swing's low point, so the clean-contact timing window
 * tightens (up to -15% at full forward); tee shots are exempt — a teed-up
 * driver is meant to be played forward.
 */
function calculateStrikeQuality(wristsDev, attackAngle, baseAoA, swingSpeed, ballPositionFactor = 0, currentSurface = 'FAIRWAY') {
    const posTilt = (currentSurface.toLowerCase() !== 'tee' && ballPositionFactor < 0)
        ? 1 + ballPositionFactor * BALLPOS_STRIKE_WINDOW_TILT
        : 1;
    const scaledFatThinThreshold = (WRIST_FAT_THIN_THRESHOLD_MS / swingSpeed) * posTilt;
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
    if (wristsDev < -scaledFatThinThreshold / 2) return "Flip"; // Early-ish (was "High")
    if (wristsDev > scaledFatThinThreshold / 2) return "Punch"; // Late-ish

    return "Center";
}

/**
 * Calculates the Smash Factor based on base club smash, strike quality penalty, and surface.
 * Adds random variation to make contact feel more natural.
 * @param {number} baseSmash - Club's base smash factor.
 * @param {string} strikeQuality - Calculated strike quality ("Fat", "Thin", etc.).
 * @param {string} currentSurface - The surface the ball is on.
 * @returns {number} The final smash factor.
 */
function calculateSmashFactor(baseSmash, strikeQuality, currentSurface) {
    let basePenalty = 0;
    // Special handling for fat shots from bunker
    if (strikeQuality === "Fat" && currentSurface.toUpperCase() === 'BUNKER') {
        basePenalty = BUNKER_FAT_STRIKE_SMASH_PENALTY;
    } else {
        // Standard penalties
        switch (strikeQuality) {
            case "Fat": basePenalty = FAT_STRIKE_SMASH_PENALTY; break;
        case "Thin": basePenalty = THIN_STRIKE_SMASH_PENALTY; break;
        case "Flip": basePenalty = FLIP_STRIKE_SMASH_PENALTY; break;
        case "Punch": basePenalty = PUNCH_STRIKE_SMASH_PENALTY; break;
            default: basePenalty = 0; break; // Center
        }
    }

    // Add random variation to penalty (±30% of base penalty)
    // This makes contact feel less rigid - e.g., "High" could be 3.5% to 6.5% penalty instead of always 5%
    const variationRange = basePenalty * 0.3;
    const randomVariation = (Math.random() - 0.5) * 2 * variationRange; // -30% to +30%
    const finalPenalty = Math.max(0, basePenalty + randomVariation); // Ensure penalty doesn't go negative

    const smash = baseSmash * (1 - finalPenalty);
    return smash;
}

/** Calculates Ball Speed from Actual CHS and Smash Factor. */
function calculateBallSpeed(actualCHS, smashFactor) {
    return actualCHS * smashFactor;
}

/**
 * Launch angle from dynamic loft and attack angle.
 * Coefficients fit to 2023 PGA Tour TrackMan averages across the bag:
 *   Driver LA 10.4° (DL 13.5°, AoA +3) → 0.70·DL + 0.45·AoA  ≈ 10.8°
 *   7-iron LA 16.3° (DL 28°,  AoA -4.5) ≈ 17.6°
 *   PW     LA 24.2° (DL 40°,  AoA -5.8) ≈ 25.4°
 * Negative AoA depresses launch significantly (vertical gear effect from
 * compressing the ball below the face plane), so the AoA coefficient is
 * larger than in many naive models.
 */
function calculateLaunchAngle(dynamicLoft, attackAngle) {
    return 0.70 * dynamicLoft + 0.45 * attackAngle;
}

/**
 * Spin axis tilt from face-to-path and spin loft.
 * tilt = atan2(sin(F2P), sin(SpinLoft))
 * Positive tilt = side axis tilted right → slice (right-curving) for a righty.
 */
function calculateSpinAxisTilt(faceAngleRelPath, spinLoft) {
    const f = faceAngleRelPath * Math.PI / 180;
    const sl = Math.max(1e-3, Math.abs(spinLoft)) * Math.PI / 180; // avoid /0 at zero spin loft
    const tiltRad = Math.atan2(Math.sin(f), Math.sin(sl));
    return tiltRad * 180 / Math.PI;
}

/**
 * Total spin (RPM) and decomposition into backspin and sidespin via spin axis tilt.
 *
 * totalSpin = k(loft) · BallSpeed_mph · sin(effectiveSpinLoft)
 *   where effectiveSpinLoft folds in strike-quality compression modifiers.
 * backspin = totalSpin · cos(tilt)
 * sidespin = totalSpin · sin(tilt)
 *
 * @returns {{ backspin: number, sidespin: number, totalSpin: number, tiltDeg: number, spinLoft: number }}
 */
function calculateSpinComponents({
    dynamicLoft, attackAngle, faceAngleRelPath, ballSpeed,
    staticLoft, strikeQuality, currentSurface,
}) {
    const spinLoft = dynamicLoft - attackAngle; // degrees

    // Strike modifier reduces compression / groove engagement
    let strikeMod = STRIKE_SPIN_MOD[strikeQuality] ?? 1.0;
    // Sand acts as a buffer for fat shots — less spin loss than fat off turf
    if (strikeQuality === 'Fat' && currentSurface?.toUpperCase() === 'BUNKER') {
        strikeMod = 0.90;
    }

    const effectiveSpinLoft = spinLoft * strikeMod;
    const slRad = effectiveSpinLoft * Math.PI / 180;
    const k = SPIN_LOFT_K_BASE + SPIN_LOFT_K_QUAD * staticLoft * staticLoft;
    const totalSpin = Math.max(0, k * ballSpeed * Math.sin(Math.max(0, slRad)));

    const tiltDeg = calculateSpinAxisTilt(faceAngleRelPath, spinLoft);
    const tiltRad = tiltDeg * Math.PI / 180;

    const backspin = totalSpin * Math.cos(tiltRad);
    const sidespin = totalSpin * Math.sin(tiltRad);

    return { backspin, sidespin, totalSpin, tiltDeg, spinLoft };
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

    // Calculate Deviations (relative to downswing start)
    const rotationTime = timingInputs.rotationStartTime ?? timingInputs.rotationInitiationTime; // Use whichever 'a' press happened
    // Pass actualBackswingDuration and IDEAL_BACKSWING_DURATION_MS for scaling calculations
    const rotationDev = calculateTimingDeviation(rotationTime, timingInputs.downswingPhaseStartTime, IDEAL_ROTATION_OFFSET_MS * downswingTimingStretch, swingSpeed, timingInputs.backswingDuration, IDEAL_BACKSWING_DURATION_MS);
    const armsDev = calculateTimingDeviation(timingInputs.armsStartTime, timingInputs.downswingPhaseStartTime, IDEAL_ARMS_OFFSET_MS * downswingTimingStretch, swingSpeed, timingInputs.backswingDuration, IDEAL_BACKSWING_DURATION_MS);
    const wristsDev = calculateTimingDeviation(timingInputs.wristsStartTime, timingInputs.downswingPhaseStartTime, IDEAL_WRISTS_OFFSET_MS * downswingTimingStretch, swingSpeed, timingInputs.backswingDuration, IDEAL_BACKSWING_DURATION_MS);

    // --- New Transition Deviation Logic ---
    // CRITICAL ASSUMPTION: timingInputs.idealBackswingEndTime is now expected to be the timestamp of the ACTUAL 'w' key release (end of player's chosen backswing).
    // If it's not, the calling code needs to be updated to provide this, perhaps as timingInputs.actualBackswingReleaseTime.
    const actualBackswingReleaseTimestamp = timingInputs.idealBackswingEndTime; // Assuming this field now holds the actual release time.
    
    const baseIdealBackswingForTempo = IDEAL_BACKSWING_DURATION_MS / swingSpeed;
    const durationScalingFactor = timingInputs.backswingDuration / baseIdealBackswingForTempo;

    // Ideal 'j' press offset is scaled by overall tempo (swingSpeed) and by the player's chosen backswing length.
    const scaledIdealTransitionOffset = (IDEAL_TRANSITION_OFFSET_MS / swingSpeed) * durationScalingFactor;
    
    const idealTransitionPressTime = actualBackswingReleaseTimestamp + scaledIdealTransitionOffset; // Ideal 'j' press time relative to actual backswing end.
    
    const actualTransitionPressTime = timingInputs.hipInitiationTime ?? actualBackswingReleaseTimestamp; // If 'j' not pressed, effectively at end of actual backswing.
    
    const transitionDev = actualTransitionPressTime - idealTransitionPressTime;
    
    // The sensitivity window for transition should also scale.
    const scaledTransitionSensitivity = TRANSITION_TIMING_SENSITIVITY * durationScalingFactor;
    // Ensure sensitivity is not zero if durationScalingFactor is very small.
    const finalScaledTransitionSensitivity = Math.max(50, scaledTransitionSensitivity); // Min sensitivity window, e.g. 50ms


    // --- Calculate Core Parameters ---
    const potentialCHS = calculatePotentialCHS(timingInputs.backswingDuration, swingSpeed, club.basePotentialSpeed);
    // Pass backswingDuration and the new scaledTransitionSensitivity to calculateActualCHS
    const actualCHS = calculateActualCHS(potentialCHS, transitionDev, armsDev, rotationDev, timingInputs.backswingDuration, swingSpeed, finalScaledTransitionSensitivity);
    const clubPathAngle = calculateClubPathAngle(armsDev, rotationDev, swingSpeed); // Path relative to target line

    // Calculate face angle relative to target line, influenced by wrist timing
    // If wrists are perfect, this is 0 (face square to target).
    // Positive = open to target, Negative = closed to target.
    const dynamicFaceAngleToTarget = calculateFaceAngleRelativeToPath(wristsDev, swingSpeed);

    // Absolute face angle is now directly the dynamicFaceAngleToTarget
    const absoluteFaceAngle = dynamicFaceAngleToTarget;

    // Face-to-Path is the difference between where the face points (rel to target) and where the path goes (rel to target)
    // This is the critical angle for sidespin.
    // Example: Path -5 (left), Face_to_Target 0 (square) => Face-to-Path = 0 - (-5) = +5 (open to path)
    // Example: Path -5 (left), Face_to_Target -2 (closed) => Face-to-Path = -2 - (-5) = +3 (open to path)
    // Example: Path +5 (right), Face_to_Target 0 (square) => Face-to-Path = 0 - 5 = -5 (closed to path)
    const faceAngleRelPath = dynamicFaceAngleToTarget - clubPathAngle;

    const attackAngle = calculateAttackAngle(club.baseAoA, ballPositionFactor, currentSurface);
    const dynamicLoft = calculateDynamicLoft(club.loft, wristsDev, attackAngle, swingSpeed);
    const strikeQuality = calculateStrikeQuality(wristsDev, attackAngle, club.baseAoA, swingSpeed, ballPositionFactor, currentSurface);
    const smashFactor = calculateSmashFactor(club.baseSmash, strikeQuality, currentSurface);
    let ballSpeed = calculateBallSpeed(actualCHS, smashFactor);
    let launchAngle = calculateLaunchAngle(dynamicLoft, attackAngle);

    // --- Apply Surface Flight Modifications (lie effects on ball speed / launch / spin) ---
    const surfaceProps = getSurfaceProperties(currentSurface);
    const flightMod = surfaceProps?.flightModification;

    const sampleMod = (m) => {
        if (m === undefined || m === null) return 0;
        if (Array.isArray(m)) {
            const [min, max] = m;
            return min + Math.random() * (max - min);
        }
        return m;
    };

    const velReduction  = sampleMod(flightMod?.velocityReduction);
    const spinReduction = sampleMod(flightMod?.spinReduction);
    const launchChange  = sampleMod(flightMod?.launchAngleChange);

    ballSpeed   *= (1 - velReduction);
    launchAngle += launchChange;

    // --- Spin: spin loft + axis tilt, decomposed into backspin / sidespin ---
    const spinResult = calculateSpinComponents({
        dynamicLoft,
        attackAngle,
        faceAngleRelPath,
        ballSpeed,
        staticLoft: club.loft,
        strikeQuality,
        currentSurface,
    });

    let backSpin = spinResult.backspin * (1 - spinReduction);
    let sideSpin = spinResult.sidespin * (1 - spinReduction);
    const spinAxisTilt = spinResult.tiltDeg;


    // --- Assemble Result Object ---
    // Calculate ideal J press window for backswing bar UI feedback
    let idealJWindowStartOnBackswing = null;
    let idealJWindowWidthOnBackswing = null;

    if (timingInputs.backswingDuration && typeof timingInputs.backswingDuration === 'number' && timingInputs.backswingDuration > 0 && swingSpeed > 0) {
        const idealJPressCenterMs_from_backswingStart =
            timingInputs.backswingDuration + (IDEAL_TRANSITION_OFFSET_MS * (timingInputs.backswingDuration / IDEAL_BACKSWING_DURATION_MS));

        idealJWindowWidthOnBackswing = 50 / swingSpeed; // Base width 50ms, scaled by swingSpeed
        idealJWindowStartOnBackswing = idealJPressCenterMs_from_backswingStart - (idealJWindowWidthOnBackswing / 2);

    } else {
        console.warn("Physics: Could not calculate ideal J window for UI due to invalid backswingDuration or swingSpeed.");
    }

    // Calculate ideal window parameters for downswing events (rotation, arms, wrists) for UI feedback
    const downswingFeedbackWindowWidth = 50 / swingSpeed; // Consistent width for feedback windows

    // Helper to get the scaled ideal offset which is the center of the window
    const getIdealCenter = (actualTime, idealOffset) => {
        // Recalculate scaledIdealOffset as it's done in calculateTimingDeviation
        const idealBackswingForTempo = IDEAL_BACKSWING_DURATION_MS / swingSpeed;
        const currentDurationScalingFactor = timingInputs.backswingDuration / idealBackswingForTempo;
        return (idealOffset / swingSpeed) * currentDurationScalingFactor;
    };

    const idealRotationCenterMs = getIdealCenter(rotationTime, IDEAL_ROTATION_OFFSET_MS * downswingTimingStretch);
    const idealArmsCenterMs = getIdealCenter(timingInputs.armsStartTime, IDEAL_ARMS_OFFSET_MS * downswingTimingStretch);
    const idealWristsCenterMs = getIdealCenter(timingInputs.wristsStartTime, IDEAL_WRISTS_OFFSET_MS * downswingTimingStretch);

    const idealRotationWindowStart = idealRotationCenterMs - (downswingFeedbackWindowWidth / 2);
    const idealArmsWindowStart = idealArmsCenterMs - (downswingFeedbackWindowWidth / 2);
    const idealWristsWindowStart = idealWristsCenterMs - (downswingFeedbackWindowWidth / 2);

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

        // Ideal J Press Window parameters for UI feedback on backswing bar
        idealJWindowStartOnBackswing: idealJWindowStartOnBackswing,
        idealJWindowWidthOnBackswing: idealJWindowWidthOnBackswing,

        // Ideal Downswing Event Window parameters for UI feedback
        idealRotationWindowStart: idealRotationWindowStart,
        idealRotationWindowWidth: downswingFeedbackWindowWidth,
        idealArmsWindowStart: idealArmsWindowStart,
        idealArmsWindowWidth: downswingFeedbackWindowWidth,
        idealWristsWindowStart: idealWristsWindowStart,
        idealWristsWindowWidth: downswingFeedbackWindowWidth,
    };


    return impactResult;
}
