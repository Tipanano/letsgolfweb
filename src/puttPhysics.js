/**
 * puttPhysics.js
 *
 * Calculates the impact physics specifically for putting strokes.
 *
 * Two input schemes live here:
 *  - calculateRhythmPuttImpact: the current rhythm-tap scheme (tempo = power,
 *    strike timing scored against the player's own beat).
 *  - calculatePuttImpact: the legacy hold-w-for-power scheme, kept as a
 *    fallback and for reference.
 */

import { tempoToDistance, distanceToSpeedMps } from './rhythmPutt.js';

// --- Tunable Rhythm Putt Parameters ---
const RHYTHM_PURE_WINDOW_FRAC = 0.12;  // |beat deviation| under 12% of tempo = pure strike
const RHYTHM_MAX_EFFECT_FRAC = 0.40;   // Push/pull maxes out at 40% of tempo off the beat
const RHYTHM_MAX_ANGLE_DEG = 4.5;      // Max push/pull angle (matches old scheme's max)
const RHYTHM_WOBBLE_NOISE_FACTOR = 0.6; // Distance noise sigma = cv * this
const RHYTHM_NOISE_CLAMP_SIGMA = 2.2;  // Clamp injected noise to ± this many sigmas
const MPS_TO_MPH = 2.23694;

/** Standard normal sample (Box-Muller). */
function gaussianRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Calculates putt impact from a rhythm strike.
 *
 * @param {object} strike - From rhythmPutt.scoreStrike():
 *   { tempoMs, cv, beatDeviationMs, targetDistance }
 * @returns {object} Impact parameters in the same shape as calculatePuttImpact.
 */
export function calculateRhythmPuttImpact(strike) {
    const { tempoMs, cv, beatDeviationMs } = strike;

    // 1. Power: tempo → intended distance → ball speed, with a small
    //    dispersion scaled by how wobbly the tapping was.
    const targetDistance = strike.targetDistance ?? tempoToDistance(tempoMs);
    const noiseSigmas = clamp(gaussianRandom(), -RHYTHM_NOISE_CLAMP_SIGMA, RHYTHM_NOISE_CLAMP_SIGMA);
    const distanceNoiseFrac = noiseSigmas * cv * RHYTHM_WOBBLE_NOISE_FACTOR;
    const actualDistance = Math.max(0.1, targetDistance * (1 + distanceNoiseFrac));
    const ballSpeedMps = distanceToSpeedMps(actualDistance);
    const actualBallSpeed = ballSpeedMps * MPS_TO_MPH; // Downstream expects mph

    // 2. Direction: score the strike against the player's own beat.
    //    Early = push (right), late = pull (left) — same convention as before.
    const devFrac = clamp(beatDeviationMs / tempoMs, -1, 1);
    let horizontalLaunchAngle = 0;
    let strikeQuality = 'Center';
    if (Math.abs(devFrac) > RHYTHM_PURE_WINDOW_FRAC) {
        const effect = clamp(
            (Math.abs(devFrac) - RHYTHM_PURE_WINDOW_FRAC) / (RHYTHM_MAX_EFFECT_FRAC - RHYTHM_PURE_WINDOW_FRAC),
            0, 1
        );
        // Early (negative deviation) → positive angle (push right)
        horizontalLaunchAngle = -Math.sign(devFrac) * effect * RHYTHM_MAX_ANGLE_DEG;
        strikeQuality = devFrac < 0 ? 'Push' : 'Pull';
    }

    const backSpin = 50 + actualBallSpeed * 5;

    console.log('\n⛳ RHYTHM PUTT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Tempo: ${tempoMs.toFixed(0)} ms  (cv ${(cv * 100).toFixed(1)}%)`);
    console.log(`   Beat deviation: ${beatDeviationMs.toFixed(0)} ms (${(devFrac * 100).toFixed(0)}% of tempo) → ${strikeQuality}`);
    console.log(`   Target distance: ${targetDistance.toFixed(2)} m, actual (with wobble): ${actualDistance.toFixed(2)} m`);
    console.log(`   Ball speed: ${actualBallSpeed.toFixed(1)} mph, angle: ${horizontalLaunchAngle.toFixed(2)}°`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return {
        timingDeviations: { hitDeviation: beatDeviationMs },
        strikeQuality,
        ballSpeed: actualBallSpeed,
        launchAngle: 0,
        horizontalLaunchAngle,
        backSpin: clamp(backSpin, 0, 500),
        sideSpin: 0,
        targetDistance,
        rhythm: { tempoMs, cv, beatDeviationMs },
        message: strikeQuality === 'Push' ? 'Pushed (early)' :
                 strikeQuality === 'Pull' ? 'Pulled (late)' :
                 'Pure Strike'
    };
}

// --- Tunable Putt Parameters ---
const MAX_PUTT_BACKSWING_MS = 2000; // Max backswing duration contributing to putt power (matches UI bar duration)
const PUTT_POWER_FACTOR = 0.015;    // Ball speed (mph?) per ms of backswing (needs tuning)
const PUTT_VISUAL_DURATION_MS = 2000; // Fixed visual duration for putt downswing bar (increased for easier timing)
const PUTT_IDEAL_TIMING_PERCENT = 0.825; // Ideal timing as percentage of visual duration (82.5% = middle of 70-95% zone)
// Vertical launch angle is fixed at 0 for putts
// Timing Parameters (relative to downswing start, which is 'w' release)
const PUTT_TIMING_SENSITIVITY_MS = 150; // Window (+/- ms) around ideal for timing effects (push/pull) - relaxed
const PUTT_TIMING_SIDE_ANGLE_FACTOR = 0.03; // Degrees of horizontal angle change per ms of *hit* deviation (Push/Pull)
// Strike Quality Thresholds (ms deviation for hit timing) - Simplified for Putt
const PUTT_PUSH_THRESHOLD_MS = -50; // Early hit -> Push (Right) - relaxed
const PUTT_PULL_THRESHOLD_MS = 50;  // Late hit -> Pull (Left) - relaxed
const PUTT_MIN_SPEED = 1.7; // Minimum ball speed for a putt (mph) - ensures short putts move noticeably
const PUTT_POWER_CURVE = 1.5; // Exponent for power curve (1.5 = gentler than quadratic, still progressive)

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

    // Handle missing inputs
    const effectiveHitOffset = hitOffset ?? 9999; // Use large offset if 'i' wasn't pressed

    // Calculate Deviation from Ideal Hit Time
    // Putting uses FIXED TEMPO - downswing is always the same duration regardless of backswing
    // Backswing determines power, downswing timing determines direction (push/pull)
    // Ideal timing is at a fixed percentage of the visual bar duration (matches colored zone)
    const idealHitOffset = PUTT_VISUAL_DURATION_MS * PUTT_IDEAL_TIMING_PERCENT; // ~1237ms for 82.5%
    const hitDeviation = effectiveHitOffset - idealHitOffset;

    console.log('\n⛳ PUTT CALCULATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`⏱️  Timing:`);
    console.log(`   Backswing Duration: ${backswingDuration?.toFixed(0) || 'N/A'} ms`);
    console.log(`   Hit Offset ('i'): ${hitOffset?.toFixed(0) || 'MISSED'} ms`);
    console.log(`   Ideal Hit Offset: ${idealHitOffset.toFixed(0)} ms (${(PUTT_IDEAL_TIMING_PERCENT * 100).toFixed(1)}% of ${PUTT_VISUAL_DURATION_MS}ms bar)`);
    console.log(`   Hit Deviation: ${hitDeviation.toFixed(0)} ms ${hitDeviation > 0 ? '(LATE ⏩)' : hitDeviation < 0 ? '(EARLY ⏪)' : '(PERFECT ✓)'}`);

    // 1. Calculate Base Power/Speed from Backswing Duration
    // Use non-linear curve: short putts easier to control, long putts harder
    const effectiveBackswing = clamp(backswingDuration || 0, 0, MAX_PUTT_BACKSWING_MS);
    const backswingPercent = effectiveBackswing / MAX_PUTT_BACKSWING_MS; // 0-1

    // Apply power curve: power = percent^1.5 (gentler than quadratic)
    // This makes: 50% backswing = 35% power, 70% = 59% power, 100% = 100% power
    // Less punishing for short putts, still progressive for long putts
    const powerPercent = Math.pow(backswingPercent, PUTT_POWER_CURVE);
    const maxPuttSpeed = MAX_PUTT_BACKSWING_MS * PUTT_POWER_FACTOR; // Max speed at full backswing
    let actualBallSpeed = maxPuttSpeed * powerPercent;

    // Apply minimum speed (ensures short putts move noticeably)
    actualBallSpeed = Math.max(PUTT_MIN_SPEED, actualBallSpeed);


    // 2. Determine Strike Quality (Push/Pull/Center) based on Hit Timing Deviation
    let strikeQuality = "Center";
    if (hitDeviation < PUTT_PUSH_THRESHOLD_MS) {
        strikeQuality = "Push"; // Early
    } else if (hitDeviation > PUTT_PULL_THRESHOLD_MS) {
        strikeQuality = "Pull"; // Late
    }

    // 3. Calculate Horizontal Launch Angle (Push/Pull Effect)
    // Positive deviation (late) = Pull (negative angle)
    // Negative deviation (early) = Push (positive angle)
    // Clamp the deviation effect
    const clampedHitDeviation = clamp(hitDeviation, -PUTT_TIMING_SENSITIVITY_MS, PUTT_TIMING_SENSITIVITY_MS);
    let horizontalLaunchAngle = -clampedHitDeviation * PUTT_TIMING_SIDE_ANGLE_FACTOR; // Negative sign makes late pull left (-)

    // 4. Set Vertical Launch Angle (Fixed at 0 for putts)
    const launchAngle = 0; // Vertical launch angle is always 0

    // 5. Calculate Spin (Minimal for putts)
    let backSpin = 50 + actualBallSpeed * 5; // Very low backspin, slightly speed dependent
    let sideSpin = 0; // Assume no side spin imparted by putter face directly (handled by horizontal angle)

    console.log(`\n📊 Results:`);
    console.log(`   Strike Quality: ${strikeQuality}`);
    console.log(`   Power: ${(powerPercent * 100).toFixed(1)}% (backswing: ${(backswingPercent * 100).toFixed(1)}% of max)`);
    console.log(`   Ball Speed: ${actualBallSpeed.toFixed(1)} mph`);
    console.log(`   Horizontal Angle: ${horizontalLaunchAngle.toFixed(2)}° ${horizontalLaunchAngle > 0 ? '(PUSH →)' : horizontalLaunchAngle < 0 ? '(PULL ←)' : '(STRAIGHT)'}`);
    console.log(`   Backspin: ${backSpin.toFixed(0)} rpm (minimal)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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


    return impactResult;
}
