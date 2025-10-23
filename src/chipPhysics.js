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
const MIN_CHIP_POWER_FACTOR = 0.15;  // Minimum power factor (for very short backswings)
const MAX_CHIP_POWER_FACTOR = 1.0;   // Maximum power factor (at full backswing)
const CHIP_POWER_CURVE_EXPONENT = 2.2; // Curve exponent (>1 = more gradual start, steeper end)
const CHIP_BASE_LAUNCH_ANGLE = 25;  // Base launch angle before adjustments
const CHIP_LOFT_LAUNCH_FACTOR = 0.6; // How much club loft influences launch angle
// New Timing Parameters (relative to downswing start)
const IDEAL_CHIP_ROTATION_OFFSET_MS = 100;  // Ideal 'a' press time after 'w' release (relaxed from 50ms)
// REMOVED: const IDEAL_CHIP_HIT_OFFSET_MS = 150; // Ideal 'i' press time is now dynamic (matches backswing duration)
const CHIP_TIMING_SENSITIVITY_MS = 200;   // Window (+/- ms) around ideal for timing effects (MORE FORGIVING from 150ms)
const CHIP_TIMING_QUALITY_FACTOR = 0.15; // Max % reduction in speed/spin due to *hit* timing deviation (MORE FORGIVING from 0.25)
// const CHIP_TIMING_SPIN_FACTOR = 15;    // Side spin RPM per ms of *hit* deviation (REMOVED/REPLACED by new factor)
const CHIP_ROTATION_SIDESPIN_FACTOR = 1.2; // RPM of sidespin per ms of rotation deviation (MORE FORGIVING from 1.5)
const MAX_CHIP_SIDESPIN_RPM = 500;       // Max sidespin RPM for a chip shot (MORE FORGIVING from 600)
// Strike Quality Thresholds (ms deviation for hit timing)
// Asymmetric: More forgiving for EARLY (negative deviation), harsh for LATE (positive deviation)
const CHIP_DUFF_THRESHOLD_MS = 300;  // Very early hit (relaxed - gets poor low shot)
const CHIP_FAT_THRESHOLD_MS = 150;    // Early hit (relaxed - still playable)
const CHIP_THIN_THRESHOLD_MS = 50;   // Late hit (MORE FORGIVING from 30ms)
const CHIP_TOP_THRESHOLD_MS = 120;   // Very late hit (MORE FORGIVING from 80ms)
// Rotation timing thresholds (secondary check if hit is Center)
const CHIP_ROTATION_DUFF_THRESHOLD_MS = 75; // *Late* rotation deviation threshold causing Duff strike (for naming)
const CHIP_ROTATION_THIN_THRESHOLD_MS = 75; // *Early* rotation deviation threshold causing Thin strike (for naming)
// --- Gradual Effect Parameters ---
// Define points for piecewise linear interpolation based on hitDeviation (ms)
// Speed Multiplier Points: [deviation, multiplier]
// ASYMMETRIC: More forgiving for early (negative), harsh for late (positive)
const SPEED_MULT_POINTS = [
    [-300, 0.45], // Very Early (Duff) - More playable (was 0.35)
    [-150, 0.65], // Early Fat - More playable (was 0.55)
    [ -50, 0.90], // Slightly early - Much less penalty (was 0.80)
    [   0, 1.00], // Perfect timing
    [  30, 1.05], // Slightly late - Minor bonus (was thin screamer at 2.20)
    [  50, 1.95], // Thin - SCREAMER! Blade contact (moved threshold)
    [ 120, 1.60], // Topped - Still rockets off (moved threshold from 80)
    [ 200, 0.55]  // Very Late - Weak contact (was 0.50 at 150)
];
// Launch Adjustment Points: [deviation, adjustment_degrees]
// ASYMMETRIC: Early = high but playable, late = low disaster
const LAUNCH_ADJ_POINTS = [
    [-300, 4.0],  // Very Early (Duff) - High, poor flight (was 5.0)
    [-150, 2.5],  // Early Fat - Slightly high (was 3.0)
    [ -50, 0.5],  // Slightly early - Very minimal adjustment (was 1.0)
    [   0, 0.0],  // Perfect
    [  30, -1.0], // Slightly late - Minimal drop (was -4.0 thin)
    [  50, -5.0], // Thin - Low flight, screams off (moved threshold)
    [ 120,-12.0], // Topped - Ground ball that rolls (was -15 at 80)
    [ 200,-18.0]  // Very Late - Complete top, dribbles (was -20 at 150)
];
// Spin Multiplier Points: [abs_deviation, multiplier] (Use absolute deviation)
const SPIN_MULT_POINTS = [
    [  0, 1.00], // Perfect - Full spin
    [ 30, 0.85], // Slightly off - Still good spin (was 0.15)
    [ 50, 0.20], // Thin - Minimal backspin (equator contact) (was 0.10)
    [100, 0.60], // Moderately off - Decent spin (was 0.50)
    [200, 0.35]  // Way off - Some spin (was 0.25)
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

    // Handle missing inputs with large penalty offsets
    const effectiveRotationOffset = rotationOffset ?? 9999;
    const effectiveHitOffset = hitOffset ?? 9999;

    // Calculate Deviations from Ideal
    // Rotation deviation is relative to a fixed ideal offset
    const rotationDeviation = effectiveRotationOffset - IDEAL_CHIP_ROTATION_OFFSET_MS;
    // Hit deviation is relative to the actual backswing duration
    const idealHitOffset = backswingDuration || 0; // Use actual backswing duration as the ideal hit time
    const hitDeviation = effectiveHitOffset - idealHitOffset;

    // 1. Calculate Base Power/Speed from Backswing Duration (with curve like putting)
    const effectiveBackswing = clamp(backswingDuration || 0, 0, MAX_CHIP_BACKSWING_MS);

    // Calculate power factor using a curve (similar to putting green reader)
    // Progress from 0 to 1 based on backswing duration
    const backswingProgress = effectiveBackswing / MAX_CHIP_BACKSWING_MS;

    // Apply exponential curve: power = min + (max - min) * progress^exponent
    // Exponent > 1 means slow start, fast finish (like putting)
    const powerFactor = MIN_CHIP_POWER_FACTOR +
                       (MAX_CHIP_POWER_FACTOR - MIN_CHIP_POWER_FACTOR) *
                       Math.pow(backswingProgress, CHIP_POWER_CURVE_EXPONENT);

    // Base speed for a full power chip with this club
    const clubMaxChipSpeed = club.basePotentialSpeed * 0.35; // Chips are ~35% of full swing speed
    let potentialBallSpeed = clubMaxChipSpeed * powerFactor;


    // 2. Calculate Quality Modifier from *Hit* Timing Deviation
    const hitTimingRatio = clamp(Math.abs(hitDeviation) / CHIP_TIMING_SENSITIVITY_MS, 0, 1);
    const qualityModifier = 1.0 - (hitTimingRatio * CHIP_TIMING_QUALITY_FACTOR);

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
    }

    // Apply Speed Multiplier
    actualBallSpeed *= speedMultiplier;

    // Ensure minimum speed AFTER multiplier
    let minSpeed = 2; // Default min
    if (hitDeviation > CHIP_THIN_THRESHOLD_MS) minSpeed = 6; // Higher min for thin range (50ms)
    if (hitDeviation > CHIP_TOP_THRESHOLD_MS) minSpeed = 8; // Higher min for top range (120ms)
    actualBallSpeed = Math.max(minSpeed, actualBallSpeed);

    // 5. Calculate Launch Angle
    // When you thin it, you lose most of the loft effect (blade contact)
    // Calculate loft multiplier based on strike quality
    let loftMultiplier = 1.0; // Perfect contact = full loft
    if (hitDeviation > 0) {
        // Late hits (thin/topped) - dramatically reduce loft application
        // Thin (30ms) = ~20% loft, Topped (80ms) = ~5% loft
        loftMultiplier = Math.max(0.05, 1.0 - (hitDeviation / 35)); // Drops fast
    }

    let launchAngle = CHIP_BASE_LAUNCH_ANGLE + (club.loft * CHIP_LOFT_LAUNCH_FACTOR * loftMultiplier);

    // Adjust launch based on ball position (Back = lower launch)
    launchAngle -= ballPositionFactor * BALLPOS_CHIP_LAUNCH_ADJUST;

    // Gradual Launch Adjustment (using hit deviation)
    const launchAdjustment = interpolateEffect(hitDeviation, LAUNCH_ADJ_POINTS);
    launchAngle += launchAdjustment;
    // Launch angle clamped later, after surface mods

    // 6. Calculate Back Spin (Initial)
    let backSpin = CHIP_BASE_BACKSPIN +
                   (club.loft * CHIP_BACKSPIN_LOFT_FACTOR) +
                   (potentialBallSpeed * CHIP_BACKSPIN_SPEED_FACTOR); // Base spin on *potential* speed before strike penalty
    // Adjust spin based on ball position (Back = more spin)
    backSpin += ballPositionFactor * BALLPOS_CHIP_SPIN_ADJUST;

    // Apply Spin Multiplier (potentially adjusted for bunker fat)
    backSpin *= spinMultiplier;
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


    // --- Apply Surface Flight Modifications ---
    const surfaceProps = getSurfaceProperties(currentSurface);
    const flightMod = surfaceProps?.flightModification;
    let appliedSpinReductionFactor = 0; // Store the randomized factor if needed

    if (flightMod) {
        // Velocity Reduction (Apply to Ball Speed)
        let velReduction = flightMod.velocityReduction || 0;
        if (Array.isArray(velReduction)) {
            const [min, max] = velReduction;
            velReduction = min + Math.random() * (max - min);
        }
        actualBallSpeed *= (1 - velReduction);

        // Spin Reduction (Apply to Back Spin & Side Spin)
        let spinReduction = flightMod.spinReduction || 0;
        if (Array.isArray(spinReduction)) {
            const [min, max] = spinReduction;
            spinReduction = min + Math.random() * (max - min);
        }
        appliedSpinReductionFactor = spinReduction; // Store for side spin
        backSpin *= (1 - spinReduction);
        sideSpin *= (1 - spinReduction); // Apply to side spin too

        // Launch Angle Change
        const launchChange = flightMod.launchAngleChange || 0;
        launchAngle += launchChange;

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
    }

    const attackAngle = baseAoA + aoaFromBallPos;
    return attackAngle;
}
