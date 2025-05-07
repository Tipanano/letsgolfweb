/**
 * chipPhysics.js
 *
 * Calculates the impact physics specifically for chip shots.
 * Focuses on backswing length for power and timing between rotation/hit for quality.
 */

import { clubs } from './clubs.js'; // May need club data (loft)
import { getSurfaceProperties } from './surfaces.js'; // Import surface properties getter

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
// const CHIP_TIMING_SPIN_FACTOR = 15;    // Side spin RPM per ms of *hit* deviation (REMOVED/REPLACED by new factor)
const CHIP_ROTATION_SIDESPIN_FACTOR = 2.0; // RPM of sidespin per ms of rotation deviation
const MAX_CHIP_SIDESPIN_RPM = 750;       // Max sidespin RPM for a chip shot
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
const BALLPOS_CHIP_AOA_SENSITIVITY = 3.0; // Degrees AoA change per unit of ball pos factor (simple model)
const MAX_NON_TEE_AOA_BONUS_CHIP = 1.0; // Max positive AoA bonus when not on tee for chips
// Bunker Fat Shot Adjustment Factors (Applied *after* interpolation)
const BUNKER_FAT_CHIP_SPEED_RECOVERY = 0.3; // Factor to recover speed lost from fat penalty (0=no recovery, 1=full recovery)
const BUNKER_FAT_CHIP_SPIN_RECOVERY = 0.2; // Factor to recover spin lost from fat penalty

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
 * @param {string} currentSurface - The surface the ball is currently on.
 * @returns {object} An object containing calculated chip impact parameters.
 */
export function calculateChipImpact(backswingDuration, rotationOffset, hitOffset, club, ballPositionFactor, currentSurface) {
    console.log("--- Calculating Chip Impact Physics ---");
    console.log(`Inputs: Duration=${backswingDuration?.toFixed(0)}, RotOffset=${rotationOffset?.toFixed(0)}, HitOffset=${hitOffset?.toFixed(0)}, Club=${club.name}, BallPosFactor=${ballPositionFactor.toFixed(2)}, Surface: ${currentSurface}`);

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
    let speedMultiplier = interpolateEffect(hitDeviation, SPEED_MULT_POINTS);
    // Spin Adjustment (using absolute hit deviation)
    let spinMultiplier = interpolateEffect(Math.abs(hitDeviation), SPIN_MULT_POINTS);

    // --- Bunker Fat Shot Adjustments ---
    if (strikeQuality === "Fat" && currentSurface.toUpperCase() === 'BUNKER') {
        const originalSpeedMult = speedMultiplier;
        const originalSpinMult = spinMultiplier;
        // Adjust multipliers closer to 1.0 based on recovery factors
        speedMultiplier = speedMultiplier + (1.0 - speedMultiplier) * BUNKER_FAT_CHIP_SPEED_RECOVERY;
        spinMultiplier = spinMultiplier + (1.0 - spinMultiplier) * BUNKER_FAT_CHIP_SPIN_RECOVERY;
        console.log(`Bunker Fat Chip Adjust: SpeedMult ${originalSpeedMult.toFixed(2)} -> ${speedMultiplier.toFixed(2)}, SpinMult ${originalSpinMult.toFixed(2)} -> ${spinMultiplier.toFixed(2)}`);
    }

    // Apply Speed Multiplier
    actualBallSpeed *= speedMultiplier;
    console.log(`Gradual Speed: Final Multiplier=${speedMultiplier.toFixed(2)} (HitDev: ${hitDeviation.toFixed(0)})`);

    // Ensure minimum speed AFTER multiplier
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
    // Launch angle clamped later, after surface mods

    // 6. Calculate Back Spin (Initial)
    let backSpin = CHIP_BASE_BACKSPIN +
                   (club.loft * CHIP_BACKSPIN_LOFT_FACTOR) +
                   (potentialBallSpeed * CHIP_BACKSPIN_SPEED_FACTOR); // Base spin on *potential* speed before strike penalty
    // Adjust spin based on ball position (Back = more spin)
    backSpin += ballPositionFactor * BALLPOS_CHIP_SPIN_ADJUST;

    // Apply Spin Multiplier (potentially adjusted for bunker fat)
    backSpin *= spinMultiplier;
    console.log(`Gradual Spin: Final Multiplier=${spinMultiplier.toFixed(2)} (AbsHitDev: ${Math.abs(hitDeviation).toFixed(0)})`);
    // Apply quality modifier from timing
    backSpin *= qualityModifier;

    // 7. Calculate Side Spin (NEW CALCULATION)
    // Late rotation ('a' pressed after ideal) = open face tendency = slice spin (positive for righty)
    // Early rotation ('a' pressed before ideal) = closed face tendency = hook spin (negative for righty)
    let sideSpin = rotationDeviation * CHIP_ROTATION_SIDESPIN_FACTOR;

    // Apply the general spinMultiplier (from hit quality) to sidespin as well
    sideSpin *= spinMultiplier;

    // Also apply the general qualityModifier (from hit timing)
    sideSpin *= qualityModifier;

    // Clamp to maximum chip sidespin
    sideSpin = clamp(sideSpin, -MAX_CHIP_SIDESPIN_RPM, MAX_CHIP_SIDESPIN_RPM);

    console.log(`Chip SideSpin Calc: RotDev=${rotationDeviation.toFixed(0)}, Factor=${CHIP_ROTATION_SIDESPIN_FACTOR}, InitialSS=${(rotationDeviation * CHIP_ROTATION_SIDESPIN_FACTOR).toFixed(0)}, SpinMult=${spinMultiplier.toFixed(2)}, QualityMod=${qualityModifier.toFixed(2)}, FinalSS=${sideSpin.toFixed(0)}`);

    // --- Apply Surface Flight Modifications ---
    const surfaceProps = getSurfaceProperties(currentSurface);
    const flightMod = surfaceProps?.flightModification;
    let appliedSpinReductionFactor = 0; // Store the randomized factor if needed

    if (flightMod) {
        console.log("Applying chip surface flight modifications:", flightMod);
        // Velocity Reduction (Apply to Ball Speed)
        let velReduction = flightMod.velocityReduction || 0;
        if (Array.isArray(velReduction)) {
            const [min, max] = velReduction;
            velReduction = min + Math.random() * (max - min);
            console.log(`Randomized Chip Velocity Reduction: ${velReduction.toFixed(3)} (Range: [${min}, ${max}])`);
        }
        actualBallSpeed *= (1 - velReduction);

        // Spin Reduction (Apply to Back Spin & Side Spin)
        let spinReduction = flightMod.spinReduction || 0;
        if (Array.isArray(spinReduction)) {
            const [min, max] = spinReduction;
            spinReduction = min + Math.random() * (max - min);
            console.log(`Randomized Chip Spin Reduction: ${spinReduction.toFixed(3)} (Range: [${min}, ${max}])`);
        }
        appliedSpinReductionFactor = spinReduction; // Store for side spin
        backSpin *= (1 - spinReduction);
        sideSpin *= (1 - spinReduction); // Apply to side spin too

        // Launch Angle Change
        const launchChange = flightMod.launchAngleChange || 0;
        launchAngle += launchChange;

        console.log(`Post-Surface Mod (Chip): BallSpeed=${actualBallSpeed.toFixed(1)}, BackSpin=${backSpin.toFixed(0)}, SideSpin=${sideSpin.toFixed(0)}, LaunchAngle=${launchAngle.toFixed(1)}`);
    }

    // Clamp final values
    launchAngle = clamp(launchAngle, 1, 60);
    backSpin = clamp(backSpin, 100, 6000); // Allow slightly lower min spin
    // sideSpin is already clamped by MAX_CHIP_SIDESPIN_RPM, but clamping again here is safe if other factors were to change it post-surface mod.
    sideSpin = clamp(sideSpin, -MAX_CHIP_SIDESPIN_RPM, MAX_CHIP_SIDESPIN_RPM);


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
        attackAngle: calculateChipAttackAngle(-2, ballPositionFactor, currentSurface), // Use helper function
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

/**
 * Helper function to calculate chip attack angle with surface capping.
 * @param {number} baseAoA - Base AoA for chips (e.g., -2).
 * @param {number} ballPositionFactor - Factor from -1 (Fwd) to +1 (Back).
 * @param {string} currentSurface - The surface the ball is on.
 * @returns {number} Calculated attack angle.
 */
function calculateChipAttackAngle(baseAoA, ballPositionFactor, currentSurface) {
    let aoaFromBallPos = ballPositionFactor * -BALLPOS_CHIP_AOA_SENSITIVITY;

    // Apply cap if not on tee and AoA bonus is positive
    if (currentSurface.toLowerCase() !== 'tee' && aoaFromBallPos > 0) {
        aoaFromBallPos = Math.min(aoaFromBallPos, MAX_NON_TEE_AOA_BONUS_CHIP);
        console.log(`AoA Calc (Chip): Capping non-tee AoA bonus to ${MAX_NON_TEE_AOA_BONUS_CHIP}`);
    }

    const attackAngle = baseAoA + aoaFromBallPos;
    console.log(`AoA Calc (Chip): Base=${baseAoA}, BallPosFactor=${ballPositionFactor.toFixed(2)}, Surface=${currentSurface}, AoAChange=${aoaFromBallPos.toFixed(1)}, FinalAoA=${attackAngle.toFixed(1)}`);
    return attackAngle;
}
