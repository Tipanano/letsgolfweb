/**
 * chipPhysics.js
 *
 * Calculates the impact physics specifically for chip shots.
 * Focuses on backswing length for power and timing between rotation/hit for quality.
 */

import { clubs } from './clubs.js'; // May need club data (loft)

// --- Tunable Chip Parameters ---
const MAX_CHIP_BACKSWING_MS = 1000; // Max backswing duration contributing to chip power
const CHIP_POWER_FACTOR = 0.04;     // Ball speed per ms of backswing (needs tuning)
const CHIP_BASE_LAUNCH_ANGLE = 25;  // Base launch angle before adjustments
const CHIP_LOFT_LAUNCH_FACTOR = 0.6; // How much club loft influences launch angle
// New Timing Parameters (relative to downswing start)
const IDEAL_CHIP_ROTATION_OFFSET_MS = 50;  // Ideal 'a' press time after 'w' release
// REMOVED: const IDEAL_CHIP_HIT_OFFSET_MS = 150; // Ideal 'i' press time is now dynamic (matches backswing duration)
const CHIP_TIMING_SENSITIVITY_MS = 75;   // Window (+/- ms) around ideal for timing effects (applies to both rotation and hit deviations)
const CHIP_TIMING_QUALITY_FACTOR = 0.25; // Max % reduction in speed/spin due to *hit* timing deviation (for near misses)
const CHIP_TIMING_SPIN_FACTOR = 15;    // Side spin RPM per ms of *hit* deviation (Currently disabled)
// Strike Quality Thresholds (ms deviation for hit timing)
const CHIP_DUFF_THRESHOLD_MS = 150;  // Very early hit
const CHIP_FAT_THRESHOLD_MS = 50;    // Early hit
const CHIP_THIN_THRESHOLD_MS = 50;   // Late hit
const CHIP_TOP_THRESHOLD_MS = 150;   // Very late hit
// Rotation timing thresholds (secondary check if hit is Center)
const CHIP_ROTATION_DUFF_THRESHOLD_MS = 75; // *Late* rotation deviation threshold causing Duff strike (for naming)
const CHIP_ROTATION_THIN_THRESHOLD_MS = 75; // *Early* rotation deviation threshold causing Thin strike (for naming)
// --- Gradual Effect Parameters ---
// Define points for piecewise linear interpolation based on hitDeviation (ms)
// Speed Multiplier Points: [deviation, multiplier]
const SPEED_MULT_POINTS = [
    [-150, 0.15], // Very Early (Duff)
    [-100, 0.15], // Duff Threshold
    [ -50, 0.60], // Fat Threshold
    [   0, 1.00], // Center
    [  50, 1.20], // Thin Threshold
    [ 100, 1.50], // Top Threshold
    [ 150, 1.50]  // Very Late (Top)
];
// Launch Adjustment Points: [deviation, adjustment_degrees]
const LAUNCH_ADJ_POINTS = [
    [-200, 3.0],  // Very Early (Duff) - Max positive adjust
    [-150, 3.0],  // Duff Threshold
    [ -50, 2.0],  // Fat Threshold
    [   0, 0.0],  // Center
    [  50,-15.0], // Thin Threshold
    [ 150,-40.0], // Top Threshold
    [ 200,-50.0]  // Very Late (Top) - Max negative adjust
];
// Spin Multiplier Points: [abs_deviation, multiplier] (Use absolute deviation)
const SPIN_MULT_POINTS = [
    [  0, 1.00], // Center
    [ 50, 0.70], // Fat/Thin Threshold
    [100, 0.40], // Duff/Top Threshold
    [150, 0.30]  // Very Early/Late
];
const CHIP_BASE_BACKSPIN = 2500;
const CHIP_BACKSPIN_LOFT_FACTOR = 50; // RPM per degree of loft
const CHIP_BACKSPIN_SPEED_FACTOR = 20; // RPM per mph of ball speed
const BALLPOS_CHIP_LAUNCH_ADJUST = 5; // Degrees launch change per unit of ball pos factor
const BALLPOS_CHIP_SPIN_ADJUST = 500; // RPM backspin change per unit of ball pos factor

/**
 * Clamps a value between a minimum and maximum.
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Linearly interpolates a value based on deviation between defined points.
 * @param {number} deviation - The input deviation.
 * @param {Array<Array<number>>} points - Array of [deviation, value] points, sorted by deviation.
 * @returns {number} The interpolated value.
 */
function interpolateEffect(deviation, points) {
    // Find the two points the deviation falls between
    let p1 = points[0];
    let p2 = points[points.length - 1];

    if (deviation <= p1[0]) return p1[1]; // Clamp to min
    if (deviation >= p2[0]) return p2[1]; // Clamp to max

    for (let i = 0; i < points.length - 1; i++) {
        if (deviation >= points[i][0] && deviation <= points[i+1][0]) {
            p1 = points[i];
            p2 = points[i+1];
            break;
        }
    }

    // Interpolate
    const devRange = p2[0] - p1[0];
    const valRange = p2[1] - p1[1];
    if (devRange === 0) return p1[1]; // Avoid division by zero if points overlap

    const progress = (deviation - p1[0]) / devRange;
    return p1[1] + progress * valRange;
}


/**
 * Calculates chip impact physics based on backswing and downswing timing offsets.
 *
 * @param {number | null} backswingDuration - Duration of the backswing (ms).
 * @param {number | null} rotationOffset - Time of 'a' press relative to downswing start (ms).
 * @param {number | null} hitOffset - Time of 'i' press relative to downswing start (ms).
 * @param {object} club - The selected club object.
 * @param {number} ballPositionFactor - Factor from -1 (Fwd) to +1 (Back).
 * @returns {object} An object containing calculated chip impact parameters.
 */
export function calculateChipImpact(backswingDuration, rotationOffset, hitOffset, club, ballPositionFactor) {
    console.log("--- Calculating Chip Impact Physics ---");
    console.log(`Inputs: Duration=${backswingDuration?.toFixed(0)}, RotOffset=${rotationOffset?.toFixed(0)}, HitOffset=${hitOffset?.toFixed(0)}, Club=${club.name}, BallPosFactor=${ballPositionFactor.toFixed(2)}`);

    // Handle missing inputs with large penalty offsets
    const effectiveRotationOffset = rotationOffset ?? 9999;
    const effectiveHitOffset = hitOffset ?? 9999;

    // Calculate Deviations from Ideal
    // Rotation deviation is relative to a fixed ideal offset
    const rotationDeviation = effectiveRotationOffset - IDEAL_CHIP_ROTATION_OFFSET_MS;
    // Hit deviation is relative to the actual backswing duration
    const idealHitOffset = backswingDuration || 0; // Use actual backswing duration as the ideal hit time
    const hitDeviation = effectiveHitOffset - idealHitOffset;
    console.log(`Deviations: RotDev=${rotationDeviation.toFixed(0)} (Ideal: ${IDEAL_CHIP_ROTATION_OFFSET_MS}), HitDev=${hitDeviation.toFixed(0)} (Ideal: ${idealHitOffset.toFixed(0)})`);

    // 1. Calculate Base Power/Speed from Backswing Duration
    const effectiveBackswing = clamp(backswingDuration || 0, 0, MAX_CHIP_BACKSWING_MS);
    let potentialBallSpeed = effectiveBackswing * CHIP_POWER_FACTOR; // Simple linear scaling for now

    // 2. Calculate Quality Modifier from *Hit* Timing Deviation
    const hitTimingRatio = clamp(Math.abs(hitDeviation) / CHIP_TIMING_SENSITIVITY_MS, 0, 1);
    const qualityModifier = 1.0 - (hitTimingRatio * CHIP_TIMING_QUALITY_FACTOR);
    console.log(`Quality: HitRatio=${hitTimingRatio.toFixed(2)}, Modifier=${qualityModifier.toFixed(2)}`);

    // 3. Apply Quality Modifier to Speed
    let actualBallSpeed = potentialBallSpeed * qualityModifier;
    // Ensure minimum speed
    actualBallSpeed = Math.max(5, actualBallSpeed); // Minimum 5 mph?

    // 4. Determine Strike Quality *Name* (for message) based on thresholds
    let strikeQuality = "Center";
    let strikeReason = "Hit Timing"; // Track reason for logging

    // Primary check: Hit timing (most severe first) - FOR NAMING ONLY
    if (hitDeviation < -CHIP_DUFF_THRESHOLD_MS) {
        strikeQuality = "Duff";
    } else if (hitDeviation < -CHIP_FAT_THRESHOLD_MS) {
        strikeQuality = "Fat";
    } else if (hitDeviation > CHIP_TOP_THRESHOLD_MS) {
        strikeQuality = "Top";
    } else if (hitDeviation > CHIP_THIN_THRESHOLD_MS) {
        strikeQuality = "Thin";
    }

    // Secondary check: Rotation timing (only if hit timing was Center)
    if (strikeQuality === "Center") {
        if (rotationDeviation > CHIP_ROTATION_DUFF_THRESHOLD_MS) { // Late rotation -> Duff
            strikeQuality = "Duff";
            strikeReason = "Rotation Timing (Late)";
        } else if (rotationDeviation < -CHIP_ROTATION_THIN_THRESHOLD_MS) { // Early rotation -> Thin (Naming only)
            strikeQuality = "Thin";
            strikeReason = "Rotation Timing (Early)";
        }
    }
    console.log(`Strike Quality Name: ${strikeQuality} (Reason: ${strikeReason})`);

    // --- Calculate Gradual Effects based on Deviations ---

    // Speed Adjustment (using hit deviation)
    const speedMultiplier = interpolateEffect(hitDeviation, SPEED_MULT_POINTS);
    actualBallSpeed *= speedMultiplier;
    console.log(`Gradual Speed: Multiplier=${speedMultiplier.toFixed(2)} (HitDev: ${hitDeviation.toFixed(0)})`);

    // Ensure minimum speed
    let minSpeed = 2; // Default min
    if (hitDeviation > CHIP_THIN_THRESHOLD_MS) minSpeed = 6; // Higher min for thin/top range
    if (hitDeviation > CHIP_TOP_THRESHOLD_MS) minSpeed = 8;
    actualBallSpeed = Math.max(minSpeed, actualBallSpeed);

    // 5. Calculate Launch Angle
    let launchAngle = CHIP_BASE_LAUNCH_ANGLE + (club.loft * CHIP_LOFT_LAUNCH_FACTOR);
    // Adjust launch based on ball position (Back = lower launch)
    launchAngle -= ballPositionFactor * BALLPOS_CHIP_LAUNCH_ADJUST;
    // Gradual Launch Adjustment (using hit deviation)
    const launchAdjustment = interpolateEffect(hitDeviation, LAUNCH_ADJ_POINTS);
    launchAngle += launchAdjustment;
    console.log(`Gradual Launch: Adjustment=${launchAdjustment.toFixed(1)} deg (HitDev: ${hitDeviation.toFixed(0)})`);
    launchAngle = clamp(launchAngle, 1, 60); // Clamp launch angle (allow very low for Top)

    // 6. Calculate Back Spin
    let backSpin = CHIP_BASE_BACKSPIN +
                   (club.loft * CHIP_BACKSPIN_LOFT_FACTOR) +
                   (potentialBallSpeed * CHIP_BACKSPIN_SPEED_FACTOR); // Base spin on *potential* speed before strike penalty
    // Adjust spin based on ball position (Back = more spin)
    backSpin += ballPositionFactor * BALLPOS_CHIP_SPIN_ADJUST;
    // Gradual Spin Adjustment (using absolute hit deviation)
    const spinMultiplier = interpolateEffect(Math.abs(hitDeviation), SPIN_MULT_POINTS);
    backSpin *= spinMultiplier;
    console.log(`Gradual Spin: Multiplier=${spinMultiplier.toFixed(2)} (AbsHitDev: ${Math.abs(hitDeviation).toFixed(0)})`);
    backSpin = clamp(backSpin * qualityModifier, 200, 6000); // Apply quality mod and clamp (lower min possible)

    // 7. Calculate Side Spin (Removed for now - assuming 0 for chips)
    let sideSpin = 0;
    // let sideSpin = hitDeviation * CHIP_TIMING_SPIN_FACTOR; // RPM side spin
    // sideSpin = clamp(sideSpin, -1500, 1500); // Clamp side spin
    // console.log(`Side Spin: ${sideSpin.toFixed(0)} RPM (HitDev: ${hitDeviation.toFixed(0)})`);

    // --- Assemble Result Object (matching structure of full swing where possible) ---
    const impactResult = {
        // Input Deviations (relative to ideal chip timings)
        timingDeviations: {
            rotationDeviation: rotationDeviation,
            hitDeviation: hitDeviation,
        },

        // Core Impact Parameters (Simplified for Chip)
        potentialCHS: actualBallSpeed / 1.25, // Estimate CHS based on ball speed (placeholder)
        actualCHS: actualBallSpeed / 1.25,    // Estimate CHS (placeholder)
        clubPathAngle: 0, // Assume 0 for chips for now
        faceAngleRelPath: 0, // Assume 0 for chips for now
        absoluteFaceAngle: 0, // Assume 0 for chips for now
        attackAngle: -2 + (ballPositionFactor * -3), // Simple AoA based on ball pos
        dynamicLoft: club.loft, // Placeholder - could adjust based on timing/AoA
        strikeQuality: strikeQuality,

        // Ball Launch Conditions
        smashFactor: 1.25, // Placeholder smash for chips
        ballSpeed: actualBallSpeed,
        launchAngle: launchAngle,
        spinAxisTilt: sideSpin / 10, // Placeholder tilt calculation
        backSpin: backSpin,
        sideSpin: sideSpin,

        // Message (can be generated here or in gameLogic)
        message: strikeQuality === 'Duff' ? 'Duffed it!' :
                 strikeQuality === 'Fat' ? 'Fatted it!' :
                 strikeQuality === 'Thin' ? 'Thinned it!' :
                 strikeQuality === 'Top' ? 'Topped it!' :
                 'Good Chip' // Updated message for 5 levels
    };

    console.log("--- Chip Impact Calculation Complete ---");
    console.log("Result:", impactResult);

    return impactResult;
}
