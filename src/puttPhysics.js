/**
 * puttPhysics.js
 *
 * Calculates the impact physics specifically for putting strokes.
 * Focuses on backswing length for power and timing of the hit for push/pull effect.
 */

// --- Tunable Putt Parameters ---
const MAX_PUTT_BACKSWING_MS = 1500; // Max backswing duration contributing to putt power
const PUTT_POWER_FACTOR = 0.015;    // Ball speed (mph?) per ms of backswing (needs tuning)
const PUTT_VISUAL_DURATION_MS = 1500; // Fixed visual duration for putt downswing bar
const PUTT_IDEAL_TIMING_PERCENT = 0.825; // Ideal timing as percentage of visual duration (82.5% = middle of 70-95% zone)
// Vertical launch angle is fixed at 0 for putts
// Timing Parameters (relative to downswing start, which is 'w' release)
const PUTT_TIMING_SENSITIVITY_MS = 150; // Window (+/- ms) around ideal for timing effects (push/pull) - relaxed
const PUTT_TIMING_SIDE_ANGLE_FACTOR = 0.03; // Degrees of horizontal angle change per ms of *hit* deviation (Push/Pull)
// Strike Quality Thresholds (ms deviation for hit timing) - Simplified for Putt
const PUTT_PUSH_THRESHOLD_MS = -50; // Early hit -> Push (Right) - relaxed
const PUTT_PULL_THRESHOLD_MS = 50;  // Late hit -> Pull (Left) - relaxed
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
    // Putting uses FIXED TEMPO - downswing is always the same duration regardless of backswing
    // Backswing determines power, downswing timing determines direction (push/pull)
    // Ideal timing is at a fixed percentage of the visual bar duration (matches colored zone)
    const idealHitOffset = PUTT_VISUAL_DURATION_MS * PUTT_IDEAL_TIMING_PERCENT; // ~1237ms for 82.5%
    const hitDeviation = effectiveHitOffset - idealHitOffset;
    console.log(`PUTT TIMING DEBUG:`);
    console.log(`  Backswing Duration: ${backswingDuration?.toFixed(0)}ms (determines power only)`);
    console.log(`  Hit Offset (actual): ${effectiveHitOffset.toFixed(0)}ms`);
    console.log(`  Ideal Offset: ${idealHitOffset.toFixed(0)}ms (${(PUTT_IDEAL_TIMING_PERCENT * 100).toFixed(1)}% of fixed ${PUTT_VISUAL_DURATION_MS}ms tempo)`);
    console.log(`  Deviation: ${hitDeviation.toFixed(0)}ms`);

    // 1. Calculate Base Power/Speed from Backswing Duration
    // Use non-linear curve: short putts easier to control, long putts harder
    const effectiveBackswing = clamp(backswingDuration || 0, 0, MAX_PUTT_BACKSWING_MS);
    const backswingPercent = effectiveBackswing / MAX_PUTT_BACKSWING_MS; // 0-1

    // Apply exponential curve: power = percent^2
    // This makes: 50% backswing = 25% power, 70% = 49% power, 100% = 100% power
    const powerPercent = Math.pow(backswingPercent, 2);
    const maxPuttSpeed = MAX_PUTT_BACKSWING_MS * PUTT_POWER_FACTOR; // Max speed at full backswing
    let actualBallSpeed = maxPuttSpeed * powerPercent;

    // Apply minimum speed
    actualBallSpeed = Math.max(PUTT_MIN_SPEED, actualBallSpeed);

    console.log(`Power Calculation: Backswing=${effectiveBackswing.toFixed(0)}ms (${(backswingPercent*100).toFixed(0)}%) → Power=${(powerPercent*100).toFixed(0)}% → Speed=${actualBallSpeed.toFixed(1)}mph`);

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
