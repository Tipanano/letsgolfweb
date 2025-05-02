/**
 * puttPhysics.js
 *
 * Calculates the impact physics specifically for putting strokes.
 * Focuses on backswing length for power and timing of the hit for push/pull effect.
 */

// --- Tunable Putt Parameters ---
const MAX_PUTT_BACKSWING_MS = 1500; // Max backswing duration contributing to putt power
const PUTT_POWER_FACTOR = 0.015;    // Ball speed (mph?) per ms of backswing (needs tuning)
// Vertical launch angle is fixed at 0 for putts
// Timing Parameters (relative to downswing start, which is 'w' release)
// Ideal 'i' press time is dynamic (matches backswing duration)
const PUTT_TIMING_SENSITIVITY_MS = 100; // Window (+/- ms) around ideal for timing effects (push/pull)
const PUTT_TIMING_SIDE_ANGLE_FACTOR = 0.03; // Degrees of horizontal angle change per ms of *hit* deviation (Push/Pull)
// Strike Quality Thresholds (ms deviation for hit timing) - Simplified for Putt
const PUTT_PUSH_THRESHOLD_MS = -25; // Early hit -> Push (Right)
const PUTT_PULL_THRESHOLD_MS = 25;  // Late hit -> Pull (Left)
const PUTT_MIN_SPEED = 1; // Minimum ball speed for a putt

/**
 * Clamps a value between a minimum and maximum.
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Calculates putt impact physics based on backswing and hit timing offset.
 *
 * @param {number | null} backswingDuration - Duration of the backswing ('w' press) (ms).
 * @param {number | null} hitOffset - Time of 'i' press relative to downswing start ('w' release) (ms).
 * @returns {object} An object containing calculated putt impact parameters.
 */
export function calculatePuttImpact(backswingDuration, hitOffset) {
    console.log("--- Calculating Putt Impact Physics ---");
    console.log(`Inputs: Duration=${backswingDuration?.toFixed(0)}, HitOffset=${hitOffset?.toFixed(0)}`);

    // Handle missing inputs
    const effectiveHitOffset = hitOffset ?? 9999; // Use large offset if 'i' wasn't pressed

    // Calculate Deviation from Ideal Hit Time
    // Ideal hit time matches the backswing duration
    const idealHitOffset = backswingDuration || 0;
    const hitDeviation = effectiveHitOffset - idealHitOffset;
    console.log(`Deviations: HitDev=${hitDeviation.toFixed(0)} (Ideal: ${idealHitOffset.toFixed(0)})`);

    // 1. Calculate Base Power/Speed from Backswing Duration
    const effectiveBackswing = clamp(backswingDuration || 0, 0, MAX_PUTT_BACKSWING_MS);
    let actualBallSpeed = effectiveBackswing * PUTT_POWER_FACTOR;

    // Apply minimum speed
    actualBallSpeed = Math.max(PUTT_MIN_SPEED, actualBallSpeed);

    // 2. Determine Strike Quality (Push/Pull/Center) based on Hit Timing Deviation
    let strikeQuality = "Center";
    if (hitDeviation < PUTT_PUSH_THRESHOLD_MS) {
        strikeQuality = "Push"; // Early
    } else if (hitDeviation > PUTT_PULL_THRESHOLD_MS) {
        strikeQuality = "Pull"; // Late
    }
    console.log(`Strike Quality: ${strikeQuality}`);

    // 3. Calculate Horizontal Launch Angle (Push/Pull Effect)
    // Positive deviation (late) = Pull (negative angle)
    // Negative deviation (early) = Push (positive angle)
    // Clamp the deviation effect
    const clampedHitDeviation = clamp(hitDeviation, -PUTT_TIMING_SENSITIVITY_MS, PUTT_TIMING_SENSITIVITY_MS);
    let horizontalLaunchAngle = -clampedHitDeviation * PUTT_TIMING_SIDE_ANGLE_FACTOR; // Negative sign makes late pull left (-)
    console.log(`Horizontal Angle: ${horizontalLaunchAngle.toFixed(2)} deg (HitDev: ${hitDeviation.toFixed(0)})`);

    // 4. Set Vertical Launch Angle (Fixed at 0 for putts)
    const launchAngle = 0; // Vertical launch angle is always 0

    // 5. Calculate Spin (Minimal for putts)
    let backSpin = 50 + actualBallSpeed * 5; // Very low backspin, slightly speed dependent
    let sideSpin = 0; // Assume no side spin imparted by putter face directly (handled by horizontal angle)

    // --- Assemble Result Object ---
    const impactResult = {
        // Input Deviation
        timingDeviations: {
            hitDeviation: hitDeviation,
        },

        // Strike Quality
        strikeQuality: strikeQuality, // "Center", "Push", "Pull"

        // Ball Launch Conditions
        ballSpeed: actualBallSpeed,
        launchAngle: launchAngle,         // Vertical launch angle
        horizontalLaunchAngle: horizontalLaunchAngle, // Horizontal launch angle (Push/Pull)
        backSpin: clamp(backSpin, 0, 500),
        sideSpin: sideSpin,

        // Message
        message: strikeQuality === 'Push' ? 'Pushed' :
                 strikeQuality === 'Pull' ? 'Pulled' :
                 'Good Putt'
    };

    console.log("--- Putt Impact Calculation Complete ---");
    console.log("Result:", impactResult);

    return impactResult;
}
