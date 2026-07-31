/**
 * chipPhysics.js
 *
 * Calculates the impact physics specifically for chip shots.
 * Focuses on backswing length for power and timing between rotation/hit for quality.
 */

import { clubs } from './clubs.js'; // May need club data (loft)
import { getSurfaceProperties } from './surfaces.js'; // Import surface properties getter
import { tempoToPower } from './rhythmPutt.js'; // Shared rhythm tempo mapping

// --- Tunable Rhythm Chip Parameters ---
// Direction (strike 'i' vs the beat — same convention as putting)
const RCHIP_PURE_WINDOW_FRAC = 0.06;   // |beat deviation| under 6% of tempo = dead straight
const RCHIP_MAX_FACE_FRAC = 0.35;      // Face angle effect maxes out here
const RCHIP_MAX_FACE_DEG = 8.0;        // Max push/pull face angle from strike timing

// Contact quality (driven by tempo steadiness — a wobbly rhythm risks fat/thin,
// scaled by the lie's strike forgiveness; this is where duffs come from)
const RCHIP_CONTACT_BASE_THRESHOLD = 0.085; // Contact-error units before a mishit
const RCHIP_CV_RISK_FACTOR = 1.0;      // How strongly tempo wobble feeds contact error

// Power profiles for the rhythm short game. A pitch is the same tap-tempo
// mechanic swung bigger: more clubhead speed and a higher floor, paid for
// with a tighter contact window (mishit risk grows with swing size).
export const CHIP_PROFILES = {
    chip:  { label: 'Chip',  speedFraction: 0.45, minPower: 0.15, contactThreshold: 0.085, cvRiskMult: 1.0 },
    pitch: { label: 'Pitch', speedFraction: 0.65, minPower: 0.30, contactThreshold: 0.070, cvRiskMult: 1.2 },
};
const RCHIP_OFFBEAT_RISK_FACTOR = 0.5; // Strikes way off the beat also risk contact
const RCHIP_OFFBEAT_RISK_START = 0.20; // ...but only beyond this |deviation| fraction
const RCHIP_DUFF_FACTOR = 1.8;         // Contact error this far past the threshold = full duff
const RCHIP_POWER_CURVE = 1.25;        // Shaping of tempo power → clubhead speed

// Shape tap (optional second 'i' vs the beat after the strike)
const RCHIP_SHAPE_PURE_FRAC = 0.10;    // Within this = spinner (extra backspin)
const RCHIP_SHAPE_MAX_FRAC = 0.45;     // Sidespin effect maxes out here
const RCHIP_SHAPE_MAX_SIDESPIN = 650;  // RPM of added draw/fade spin
const RCHIP_SPINNER_BACKSPIN_MULT = 1.30; // On-beat shape tap = extra bite

// Ball forward strikes past the swing's low point, so clean contact gets
// harder overall; ball back promotes ball-first contact, the safest strike.
// Shared by the rhythm and legacy chip models. The net tilt must outweigh
// the side bias ((1+tilt)·(1−bias) > 1) or a back stance ends up riskier
// than center — the narrowed fat side is where its misses funnel.
const BALLPOS_CONTACT_TILT = 0.20;      // fwd (-1) = 0.8× both thresholds, back (+1) = 1.2×
const BALLPOS_CONTACT_SIDE_BIAS = 0.15; // fwd leans thin, back leans fat (which miss you get)

/** Standard normal sample (Box-Muller). */
function gaussianRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Clubhead delivery for a rhythm chip: tempo → clubhead speed, stance/club →
 * loft and attack angle. Shared by the impact calculation and the preview.
 */
function rhythmChipDelivery(tempoMs, club, ballPositionFactor, currentSurface, profile = CHIP_PROFILES.chip) {
    const power = profile.minPower +
        (MAX_CHIP_POWER_FACTOR - profile.minPower) *
        Math.pow(tempoToPower(tempoMs), RCHIP_POWER_CURVE);
    const clubheadSpeed = club.basePotentialSpeed * profile.speedFraction * power;

    const dynamicLoft = club.loft - ballPositionFactor * BALLPOS_LOFT_EFFECT;

    let aoaFromBallPosition = -ballPositionFactor * BALLPOS_AOA_EFFECT;
    if (currentSurface.toLowerCase() !== 'tee' && aoaFromBallPosition > 0) {
        aoaFromBallPosition = Math.min(aoaFromBallPosition, MAX_NON_TEE_AOA_BONUS_CHIP);
    }
    const attackAngle = BASE_CHIP_AOA + aoaFromBallPosition;

    return { power, clubheadSpeed, dynamicLoft, attackAngle };
}

/**
 * Rough carry estimate (meters) for the HUD/preview while tapping.
 * Ideal-contact projectile with a speed-dependent drag knockdown — a learning
 * aid, deliberately approximate.
 */
export function estimateRhythmChipCarry(tempoMs, club, ballPositionFactor, currentSurface, profile = CHIP_PROFILES.chip) {
    const d = rhythmChipDelivery(tempoMs, club, ballPositionFactor, currentSurface, profile);
    const ballSpeedMps = d.clubheadSpeed * BASE_CHIP_SMASH * 0.44704;
    const launchRad = clamp(d.dynamicLoft * 0.75 + d.attackAngle * 0.5, 1, 85) * Math.PI / 180;
    const vacuumCarry = (ballSpeedMps * ballSpeedMps) * Math.sin(2 * launchRad) / 9.81;
    const dragFactor = clamp(1 - ballSpeedMps * 0.014, 0.55, 0.92);
    return Math.max(0.3, vacuumCarry * dragFactor);
}

/**
 * Calculates chip impact from a rhythm strike.
 *
 * Inputs (from rhythmPutt.js):
 *   strike = { tempoMs, cv, beatDeviationMs, shapeDevFrac|null }
 * Skill model:
 *   - Tempo → power (carry), normalized per club.
 *   - Strike tap vs the beat → face angle (early = push right, late = pull left).
 *   - Tempo steadiness (cv) → contact quality, scaled by lie forgiveness and
 *     ball position. Shaky rhythm from a bad lie is where duffs live.
 *   - Optional shape tap → sidespin (early = draw, late = fade) or extra
 *     backspin (on the beat).
 */
export function calculateRhythmChipImpact(strike, club, ballPositionFactor, currentSurface, profile = CHIP_PROFILES.chip) {
    const { tempoMs, cv, beatDeviationMs, shapeDevFrac } = strike;
    const devFrac = clamp(beatDeviationMs / tempoMs, -1, 1);

    const surfaceProps = getSurfaceProperties(currentSurface);
    const delivery = rhythmChipDelivery(tempoMs, club, ballPositionFactor, currentSurface, profile);
    const { clubheadSpeed, dynamicLoft, attackAngle } = delivery;

    // --- Direction: strike tap vs the beat (same feel as putting) ---
    let faceAngle = 0;
    if (Math.abs(devFrac) > RCHIP_PURE_WINDOW_FRAC) {
        const effect = clamp(
            (Math.abs(devFrac) - RCHIP_PURE_WINDOW_FRAC) / (RCHIP_MAX_FACE_FRAC - RCHIP_PURE_WINDOW_FRAC),
            0, 1);
        faceAngle = -Math.sign(devFrac) * effect * RCHIP_MAX_FACE_DEG; // Early = push right
    }
    faceAngle = clamp(faceAngle, -MAX_FACE_ANGLE_CHIP, MAX_FACE_ANGLE_CHIP);

    // --- Contact quality: steadiness is the skill ---
    const offbeatRisk = Math.max(0, Math.abs(devFrac) - RCHIP_OFFBEAT_RISK_START) * RCHIP_OFFBEAT_RISK_FACTOR;
    const cvRisk = cv * RCHIP_CV_RISK_FACTOR * profile.cvRiskMult;
    const contactRisk = cvRisk + offbeatRisk;
    const contactError = Math.abs(gaussianRandom()) * contactRisk;

    const fatForgiveness = surfaceProps?.strikeFactors?.fatForgiveness || 1.0;
    const thinForgiveness = surfaceProps?.strikeFactors?.thinForgiveness || 1.0;
    // Forward ball (factor < 0) = easier to thin AND net-riskier contact;
    // back ball (factor > 0) = easier to fat but net-safer contact
    const netTilt = 1 + ballPositionFactor * BALLPOS_CONTACT_TILT;
    const thinThreshold = profile.contactThreshold * thinForgiveness * netTilt * (1 + ballPositionFactor * BALLPOS_CONTACT_SIDE_BIAS);
    const fatThreshold = profile.contactThreshold * fatForgiveness * netTilt * (1 - ballPositionFactor * BALLPOS_CONTACT_SIDE_BIAS);

    // Miss side: an early strike leans thin, a late one leans fat (matches the
    // legacy model); near the beat, ball position decides; ties flip a coin.
    let missSide;
    if (devFrac < -0.1) missSide = 'thin';
    else if (devFrac > 0.1) missSide = 'fat';
    else if (ballPositionFactor < -0.15) missSide = 'thin';
    else if (ballPositionFactor > 0.15) missSide = 'fat';
    else missSide = Math.random() < 0.5 ? 'thin' : 'fat';

    let strikeQuality = 'Center';
    const sideThreshold = missSide === 'thin' ? thinThreshold : fatThreshold;
    if (contactError > sideThreshold * RCHIP_DUFF_FACTOR) {
        strikeQuality = 'Duff';
    } else if (contactError > sideThreshold) {
        strikeQuality = missSide === 'thin' ? 'Thin' : 'Fat';
    }

    // --- Smash factor / ball speed (same quality modifiers as the legacy model) ---
    let smashFactor = BASE_CHIP_SMASH;
    if (strikeQuality === 'Fat') {
        smashFactor *= (currentSurface.toUpperCase() === 'BUNKER') ? (1 - 0.15) : (1 - 0.25);
    } else if (strikeQuality === 'Thin') {
        smashFactor *= 1.4;
    } else if (strikeQuality === 'Duff') {
        smashFactor *= 0.6;
    }
    let ballSpeed = Math.max(3, clubheadSpeed * smashFactor);

    // --- Launch angle ---
    let launchAngle = dynamicLoft * 0.75 + attackAngle * 0.5;
    if (strikeQuality === 'Thin') launchAngle = Math.min(launchAngle * 0.35, 8); // Bladed: comes out low and hot

    // --- Backspin ---
    let backSpin = CHIP_BASE_BACKSPIN +
        (dynamicLoft * CHIP_BACKSPIN_LOFT_FACTOR) +
        (clubheadSpeed * CHIP_BACKSPIN_SPEED_FACTOR) +
        (attackAngle * CHIP_BACKSPIN_AOA_FACTOR);
    if (strikeQuality === 'Fat') backSpin *= (currentSurface.toUpperCase() === 'BUNKER') ? 0.7 : 0.5;
    else if (strikeQuality === 'Thin') backSpin *= 0.3;
    else if (strikeQuality === 'Duff') backSpin *= 0.4;

    // --- Sidespin: face (push/pull) + optional shape tap ---
    let sideSpin = faceAngle * CHIP_SIDESPIN_FACE_FACTOR;
    if (Math.abs(faceAngle) > 1.0) {
        sideSpin += (faceAngle / 5.0) * clubheadSpeed * CHIP_SIDESPIN_SPEED_FACTOR;
    }

    let shapeLabel = null;
    if (shapeDevFrac !== null && shapeDevFrac !== undefined && strikeQuality === 'Center') {
        if (Math.abs(shapeDevFrac) <= RCHIP_SHAPE_PURE_FRAC) {
            backSpin *= RCHIP_SPINNER_BACKSPIN_MULT; // On the beat: spinner
            shapeLabel = 'spinner';
        } else {
            const effect = clamp(
                (Math.abs(shapeDevFrac) - RCHIP_SHAPE_PURE_FRAC) / (RCHIP_SHAPE_MAX_FRAC - RCHIP_SHAPE_PURE_FRAC),
                0, 1);
            // Early = draw (hook, negative), late = fade (slice, positive)
            sideSpin += Math.sign(shapeDevFrac) * effect * RCHIP_SHAPE_MAX_SIDESPIN;
            shapeLabel = shapeDevFrac < 0 ? 'draw' : 'fade';
        }
    }
    sideSpin = clamp(sideSpin, -MAX_CHIP_SIDESPIN_RPM, MAX_CHIP_SIDESPIN_RPM);

    // --- Surface flight modification (same as legacy) ---
    const flightMod = surfaceProps?.flightModification;
    if (flightMod) {
        let velReduction = flightMod.velocityReduction || 0;
        if (Array.isArray(velReduction)) {
            const [min, max] = velReduction;
            velReduction = min + Math.random() * (max - min);
        }
        ballSpeed *= (1 - velReduction);

        let spinReduction = flightMod.spinReduction || 0;
        if (Array.isArray(spinReduction)) {
            const [min, max] = spinReduction;
            spinReduction = min + Math.random() * (max - min);
        }
        backSpin *= (1 - spinReduction);
        sideSpin *= (1 - spinReduction);

        launchAngle += flightMod.launchAngleChange || 0;
    }

    launchAngle = clamp(launchAngle, 1, 85);
    backSpin = clamp(backSpin, 100, 8000);
    sideSpin = clamp(sideSpin, -MAX_CHIP_SIDESPIN_RPM, MAX_CHIP_SIDESPIN_RPM);

    let message = generateChipMessage(strikeQuality, dynamicLoft, attackAngle, ballSpeed, backSpin);
    if (shapeLabel === 'draw') message += ' (draw spin)';
    else if (shapeLabel === 'fade') message += ' (cut spin)';
    else if (shapeLabel === 'spinner') message += ' (extra bite)';

    console.log('\n🏌️ RHYTHM CHIP');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Club: ${club.name}, tempo ${tempoMs.toFixed(0)}ms (cv ${(cv * 100).toFixed(1)}%)`);
    console.log(`   Strike deviation: ${(devFrac * 100).toFixed(0)}% of tempo → face ${faceAngle.toFixed(1)}°`);
    console.log(`   Contact: risk ${contactRisk.toFixed(3)}, error ${contactError.toFixed(3)} vs thr ${sideThreshold.toFixed(3)} → ${strikeQuality}`);
    console.log(`   Shape tap: ${shapeDevFrac === null || shapeDevFrac === undefined ? 'none' : (shapeDevFrac * 100).toFixed(0) + '%'} → ${shapeLabel || 'stock'}`);
    console.log(`   Ball: ${ballSpeed.toFixed(1)} mph, launch ${launchAngle.toFixed(1)}°, spin ${backSpin.toFixed(0)}/${sideSpin.toFixed(0)} rpm`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return {
        timingDeviations: { hitDeviation: beatDeviationMs },
        clubHeadSpeed: clubheadSpeed,
        potentialCHS: clubheadSpeed,
        actualCHS: clubheadSpeed,
        dynamicLoft,
        attackAngle,
        absoluteFaceAngle: faceAngle,
        faceAngleRelPath: faceAngle,
        clubPathAngle: 0,
        strikeQuality,
        smashFactor,
        ballSpeed,
        launchAngle,
        spinAxisTilt: sideSpin / 100,
        backSpin,
        sideSpin,
        rhythm: { tempoMs, cv, beatDeviationMs, shapeDevFrac },
        // Contact-quality diagnostics for the practice swing report: what fed
        // the mishit risk, and how tight the lie made the window.
        contact: {
            cvRisk, offbeatRisk, error: contactError,
            threshold: sideThreshold, baseThreshold: profile.contactThreshold,
        },
        message,
    };
}

// --- Tunable Chip Parameters ---
// Power/Speed
const MAX_CHIP_BACKSWING_MS = 2000; // Max backswing duration contributing to chip power (matches UI bar duration)
const MIN_CHIP_POWER_FACTOR = 0.15;  // Minimum power factor (for very short backswings)
const MAX_CHIP_POWER_FACTOR = 1.0;   // Maximum power factor (at full backswing)
const CHIP_POWER_CURVE_EXPONENT = 2.2; // Curve exponent (>1 = more gradual start, steeper end)

// Timing Parameters
const IDEAL_CHIP_ROTATION_OFFSET_MS = 100;  // Ideal 'a' press time after 'w' release
const BALL_POSITION_TIMING_OFFSET_MS = 150; // How much ball position shifts ideal 'i' timing (ms per unit)

// === CLUBHEAD DELIVERY PARAMETERS ===
// These determine HOW the club arrives at the ball, not the result directly

// Dynamic Loft Adjustments (degrees added to club base loft)
const BALLPOS_LOFT_EFFECT = 15.0;     // Ball forward (+15°), back (-15°)
const WRIST_TIMING_LOFT_EFFECT = 12.0; // Early 'i' (+12°), late 'i' (-12°)
const WRIST_TIMING_LOFT_SENSITIVITY_MS = 200; // Window for full effect

// Attack Angle Adjustments (degrees)
const BASE_CHIP_AOA = -2.0;            // Base slightly descending AoA
const BALLPOS_AOA_EFFECT = 7.5;        // Ball forward (+5° from base = +3°), back (-8° from base = -10°)
const WRIST_TIMING_AOA_EFFECT = 3.0;   // Early 'i' (+3° shallower), late 'i' (-3° steeper)
const WRIST_TIMING_AOA_SENSITIVITY_MS = 200; // Window for full effect
const MAX_NON_TEE_AOA_BONUS_CHIP = 1.0; // Max positive AoA bonus when not on tee

// Face Angle (for sidespin calculation - assumes path is 0°)
const ROTATION_TIMING_FACE_FACTOR = 0.08;  // Degrees of face angle per ms of rotation deviation
const BALLPOS_FACE_EFFECT = 3.0;          // Ball forward = open, back = closed (degrees)
const WRIST_TIMING_FACE_EFFECT = 4.0;     // Early 'i' = open, late 'i' = closed (degrees)
const WRIST_TIMING_FACE_SENSITIVITY_MS = 200; // Window for full effect
const MAX_FACE_ANGLE_CHIP = 15.0;         // Maximum face angle deviation

// === BALL FLIGHT CALCULATION PARAMETERS ===
// Strike Quality & Smash Factor
const BASE_CHIP_SMASH = 1.25;
const STRIKE_QUALITY_MISMATCH_THRESHOLD = 250; // ms mismatch between ideal and actual for Fat/Duff/Thin

// Spin Calculation
const CHIP_BASE_BACKSPIN = 400;  // Reduced - most chips should have minimal spin
const CHIP_BACKSPIN_LOFT_FACTOR = 20;   // RPM per degree of dynamic loft (reduced for realistic bump and run)
const CHIP_BACKSPIN_SPEED_FACTOR = 25;  // RPM per mph of clubhead speed (reduced - chips don't generate much spin)
const CHIP_BACKSPIN_AOA_FACTOR = -40;   // RPM per degree of AoA (reduced - shallow AoA doesn't create much spin)
const CHIP_SIDESPIN_FACE_FACTOR = 120;  // RPM per degree of face angle
const CHIP_SIDESPIN_SPEED_FACTOR = 8;   // Additional RPM per mph when face is open/closed
const MAX_CHIP_SIDESPIN_RPM = 800;      // Max sidespin RPM

// Bunker Adjustments
const BUNKER_FAT_CHIP_SMASH_RECOVERY = 0.5;  // Less penalty for fat from sand
const BUNKER_FAT_CHIP_SPIN_RECOVERY = 0.3;   // Less spin loss for fat from sand

/**
 * Clamps a value between a minimum and maximum.
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Calculates a scaling factor from timing deviation.
 * Returns 1.0 at perfect timing, 0.0 at full sensitivity window, linear between.
 * @param {number} deviation - The timing deviation in ms.
 * @param {number} sensitivity - The sensitivity window in ms.
 * @returns {number} Scaling factor from 0.0 to 1.0.
 */
function calculateTimingFactor(deviation, sensitivity) {
    return clamp(1.0 - (Math.abs(deviation) / sensitivity), 0, 1);
}


/**
 * Calculates chip impact physics based on backswing and downswing timing offsets.
 * NEW MODEL: Input → Clubhead Delivery → Ball Flight Output
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
    const rotationDeviation = effectiveRotationOffset - IDEAL_CHIP_ROTATION_OFFSET_MS;

    // Hit timing ideal is affected by ball position
    // Forward ball = need earlier release, Back ball = need later release
    const ballPositionTimingAdjustment = -ballPositionFactor * BALL_POSITION_TIMING_OFFSET_MS;
    const idealHitOffset = (backswingDuration || 0) + ballPositionTimingAdjustment;
    const hitDeviation = effectiveHitOffset - idealHitOffset;

    console.log('\n🏌️ CHIP SHOT CALCULATION (New Model)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`⏱️  Inputs:`);
    console.log(`   Club: ${club.name} (${club.loft}°)`);
    console.log(`   Ball Position: ${ballPositionFactor > 0 ? 'Back' : ballPositionFactor < 0 ? 'Forward' : 'Center'} (${ballPositionFactor.toFixed(2)})`);
    console.log(`   Backswing Duration: ${backswingDuration?.toFixed(0) || 'N/A'} ms`);
    console.log(`   Rotation Offset ('a'): ${rotationOffset?.toFixed(0) || 'MISSED'} ms (ideal: ${IDEAL_CHIP_ROTATION_OFFSET_MS}ms)`);
    console.log(`   Rotation Deviation: ${rotationDeviation.toFixed(0)} ms ${rotationDeviation > 0 ? '(LATE ⏩)' : rotationDeviation < 0 ? '(EARLY ⏪)' : '(PERFECT ✓)'}`);
    console.log(`   Hit Offset ('i'): ${hitOffset?.toFixed(0) || 'MISSED'} ms`);
    console.log(`   Ideal Hit Offset: ${idealHitOffset.toFixed(0)} ms (BS: ${backswingDuration?.toFixed(0) || 0}ms + BallPos adj: ${ballPositionTimingAdjustment.toFixed(0)}ms)`);
    console.log(`   Hit Deviation: ${hitDeviation.toFixed(0)} ms ${hitDeviation > 0 ? '(LATE ⏩)' : hitDeviation < 0 ? '(EARLY ⏪)' : '(PERFECT ✓)'}`);
    console.log(`   Surface: ${currentSurface}`);

    // ========================================
    // PHASE 1: CALCULATE CLUBHEAD DELIVERY
    // ========================================

    // 1.1 Calculate Clubhead Speed from Backswing Duration
    const effectiveBackswing = clamp(backswingDuration || 0, 0, MAX_CHIP_BACKSWING_MS);
    const backswingProgress = effectiveBackswing / MAX_CHIP_BACKSWING_MS;

    // Power curve (like putting: slow start, faster finish)
    const powerFactor = MIN_CHIP_POWER_FACTOR +
                       (MAX_CHIP_POWER_FACTOR - MIN_CHIP_POWER_FACTOR) *
                       Math.pow(backswingProgress, CHIP_POWER_CURVE_EXPONENT);

    const clubMaxChipSpeed = club.basePotentialSpeed * 0.45; // Chips = ~45% of full swing (allows longer chips/pitches)
    const clubheadSpeed = clubMaxChipSpeed * powerFactor;

    // 1.2 Calculate Dynamic Loft (how the club loft is presented at impact)
    const wristTimingFactor = clamp(hitDeviation / WRIST_TIMING_LOFT_SENSITIVITY_MS, -1, 1);

    // Ball position effect (PRIMARY): Forward = +15°, Back = -15°
    const loftFromBallPosition = -ballPositionFactor * BALLPOS_LOFT_EFFECT;

    // Wrist timing effect (SECONDARY): Early = +12° (flip), Late = -12° (compress)
    const loftFromWristTiming = -wristTimingFactor * WRIST_TIMING_LOFT_EFFECT;

    const dynamicLoft = club.loft + loftFromBallPosition + loftFromWristTiming;

    // 1.3 Calculate Attack Angle (descending vs ascending)
    const wristTimingAoAFactor = clamp(hitDeviation / WRIST_TIMING_AOA_SENSITIVITY_MS, -1, 1);

    // Ball position effect (PRIMARY): Forward = +5°, Back = -8° (from base -2°)
    let aoaFromBallPosition = -ballPositionFactor * BALLPOS_AOA_EFFECT;

    // Cap positive AoA if not on tee
    if (currentSurface.toLowerCase() !== 'tee' && aoaFromBallPosition > 0) {
        aoaFromBallPosition = Math.min(aoaFromBallPosition, MAX_NON_TEE_AOA_BONUS_CHIP);
    }

    // Wrist timing effect (SECONDARY): Early = +3° (shallow), Late = -3° (steep)
    const aoaFromWristTiming = -wristTimingAoAFactor * WRIST_TIMING_AOA_EFFECT;

    const attackAngle = BASE_CHIP_AOA + aoaFromBallPosition + aoaFromWristTiming;

    // 1.4 Calculate Face Angle (for sidespin - assumes path is 0°)
    const rotationTimingFaceAngle = rotationDeviation * ROTATION_TIMING_FACE_FACTOR;
    const ballPositionFaceAngle = -ballPositionFactor * BALLPOS_FACE_EFFECT; // Forward = open, back = closed
    const wristTimingFaceAngle = -wristTimingFactor * WRIST_TIMING_FACE_EFFECT; // Early = open, late = closed

    let faceAngle = rotationTimingFaceAngle + ballPositionFaceAngle + wristTimingFaceAngle;
    faceAngle = clamp(faceAngle, -MAX_FACE_ANGLE_CHIP, MAX_FACE_ANGLE_CHIP);

    console.log(`\n🏌️ CLUBHEAD DELIVERY:`);
    console.log(`   Clubhead Speed: ${clubheadSpeed.toFixed(1)} mph (power: ${(powerFactor * 100).toFixed(1)}%)`);
    console.log(`   Dynamic Loft: ${dynamicLoft.toFixed(1)}° (base: ${club.loft}°, ballPos: ${loftFromBallPosition.toFixed(1)}°, wrist: ${loftFromWristTiming.toFixed(1)}°)`);
    console.log(`   Attack Angle: ${attackAngle.toFixed(1)}° (base: ${BASE_CHIP_AOA}°, ballPos: ${aoaFromBallPosition.toFixed(1)}°, wrist: ${aoaFromWristTiming.toFixed(1)}°)`);
    console.log(`   Face Angle: ${faceAngle.toFixed(1)}° (rotation: ${rotationTimingFaceAngle.toFixed(1)}°, ballPos: ${ballPositionFaceAngle.toFixed(1)}°, wrist: ${wristTimingFaceAngle.toFixed(1)}°)`);

    // ========================================
    // PHASE 2: CALCULATE BALL FLIGHT OUTPUT
    // ========================================

    // Get surface properties (used for strike quality and later for flight mods)
    const surfaceProps = getSurfaceProperties(currentSurface);

    // 2.1 Determine Strike Quality from timing mismatch
    // Primary rule: Early release = Thin, Late release = Duff/Fat
    // Ball position affects susceptibility:
    //   - Forward ball = easier to thin (club past low point)
    //   - Back ball = easier to fat/duff (club hits ground first)
    // Surface affects susceptibility:
    //   - Tight lies (green) = easier to thin/fat
    //   - Heavy rough = easier to fat (grass grabs), harder to thin (ball sits up)
    //   - Bunker = harder to fat (sand slides), easier to thin (blade it)

    const mismatchMagnitude = Math.abs(hitDeviation);
    let strikeQuality = "Center";

    // Get surface strike factors
    const fatForgiveness = surfaceProps?.strikeFactors?.fatForgiveness || 1.0;
    const thinForgiveness = surfaceProps?.strikeFactors?.thinForgiveness || 1.0;

    // Base thresholds adjusted by ball position
    // Forward ball = lower thin threshold (easier to thin) and net-riskier
    // contact; back ball = lower fat threshold (easier to fat) but net-safer
    const netTilt = 1 + ballPositionFactor * BALLPOS_CONTACT_TILT;
    let thinThreshold = STRIKE_QUALITY_MISMATCH_THRESHOLD * netTilt * (1.0 + (ballPositionFactor * BALLPOS_CONTACT_SIDE_BIAS));
    let fatThreshold = STRIKE_QUALITY_MISMATCH_THRESHOLD * netTilt * (1.0 - (ballPositionFactor * BALLPOS_CONTACT_SIDE_BIAS));

    // Apply surface forgiveness factors
    // Higher forgiveness = higher threshold = harder to achieve that strike quality
    thinThreshold *= thinForgiveness;
    fatThreshold *= fatForgiveness;

    console.log(`\n🎯 STRIKE QUALITY CALCULATION:`);
    console.log(`   Base Threshold: ${STRIKE_QUALITY_MISMATCH_THRESHOLD}ms`);
    console.log(`   Surface: ${currentSurface} (fatForgive: ${fatForgiveness.toFixed(2)}x, thinForgive: ${thinForgiveness.toFixed(2)}x)`);
    console.log(`   Ball Position Factor: ${ballPositionFactor.toFixed(2)}`);
    console.log(`   Thin Threshold: ${thinThreshold.toFixed(0)}ms (base + ballPos + surface)`);
    console.log(`   Fat Threshold: ${fatThreshold.toFixed(0)}ms (base + ballPos + surface)`);
    console.log(`   Hit Deviation: ${hitDeviation.toFixed(0)}ms`);

    if (hitDeviation < -thinThreshold) {
        // Very early release = Thin
        strikeQuality = "Thin";
    } else if (hitDeviation > fatThreshold) {
        // Very late release = Duff
        strikeQuality = "Duff";
    } else if (hitDeviation > fatThreshold * 0.5) {
        // Moderately late release = Fat
        strikeQuality = "Fat";
    }

    console.log(`   → Strike Quality: ${strikeQuality}`);

    // 2.2 Calculate Smash Factor
    let smashFactor = BASE_CHIP_SMASH;

    if (strikeQuality === "Fat") {
        smashFactor *= (currentSurface.toUpperCase() === 'BUNKER') ?
            (1 - 0.15) : (1 - 0.25); // Less penalty in bunker
    } else if (strikeQuality === "Thin") {
        smashFactor *= 1.4; // Thin = hot contact, more ball speed
    } else if (strikeQuality === "Duff") {
        smashFactor *= 0.6; // Duff = poor contact
    }

    // 2.3 Calculate Ball Speed
    let ballSpeed = clubheadSpeed * smashFactor;
    ballSpeed = Math.max(3, ballSpeed); // Minimum ball speed

    // 2.4 Calculate Launch Angle (from dynamic loft and attack angle)
    // Launch angle is primarily from loft, with AoA influence
    let launchAngle = dynamicLoft * 0.75 + attackAngle * 0.5;

    // 2.5 Calculate Backspin
    let backSpin = CHIP_BASE_BACKSPIN +
                   (dynamicLoft * CHIP_BACKSPIN_LOFT_FACTOR) +
                   (clubheadSpeed * CHIP_BACKSPIN_SPEED_FACTOR) +
                   (attackAngle * CHIP_BACKSPIN_AOA_FACTOR); // Negative AoA (descending) adds spin

    // Strike quality affects spin
    if (strikeQuality === "Fat") {
        backSpin *= (currentSurface.toUpperCase() === 'BUNKER') ? 0.7 : 0.5;
    } else if (strikeQuality === "Thin") {
        backSpin *= 0.3; // Thin = blade contact, minimal spin
    } else if (strikeQuality === "Duff") {
        backSpin *= 0.4;
    }

    // 2.6 Calculate Sidespin (from face angle, since path is 0°)
    let sideSpin = faceAngle * CHIP_SIDESPIN_FACE_FACTOR;

    // Add speed contribution when face is open/closed
    if (Math.abs(faceAngle) > 1.0) {
        sideSpin += (faceAngle / 5.0) * clubheadSpeed * CHIP_SIDESPIN_SPEED_FACTOR;
    }

    // Strike quality affects sidespin
    if (strikeQuality === "Fat" || strikeQuality === "Thin" || strikeQuality === "Duff") {
        sideSpin *= 0.6;
    }

    sideSpin = clamp(sideSpin, -MAX_CHIP_SIDESPIN_RPM, MAX_CHIP_SIDESPIN_RPM);

    console.log(`\n📊 BALL FLIGHT OUTPUT:`);
    console.log(`   Strike Quality: ${strikeQuality}`);
    console.log(`   Smash Factor: ${smashFactor.toFixed(2)}`);
    console.log(`   Ball Speed: ${ballSpeed.toFixed(1)} mph`);
    console.log(`   Launch Angle: ${launchAngle.toFixed(1)}°`);
    console.log(`   Backspin: ${backSpin.toFixed(0)} rpm`);
    console.log(`   Sidespin: ${sideSpin.toFixed(0)} rpm ${sideSpin > 0 ? '(SLICE →)' : sideSpin < 0 ? '(HOOK ←)' : '(STRAIGHT)'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // ========================================
    // PHASE 3: APPLY SURFACE MODIFICATIONS
    // ========================================

    const flightMod = surfaceProps?.flightModification;

    if (flightMod) {
        // Velocity Reduction
        let velReduction = flightMod.velocityReduction || 0;
        if (Array.isArray(velReduction)) {
            const [min, max] = velReduction;
            velReduction = min + Math.random() * (max - min);
        }
        ballSpeed *= (1 - velReduction);

        // Spin Reduction
        let spinReduction = flightMod.spinReduction || 0;
        if (Array.isArray(spinReduction)) {
            const [min, max] = spinReduction;
            spinReduction = min + Math.random() * (max - min);
        }
        backSpin *= (1 - spinReduction);
        sideSpin *= (1 - spinReduction);

        // Launch Angle Change
        const launchChange = flightMod.launchAngleChange || 0;
        launchAngle += launchChange;
    }

    // Clamp final values
    launchAngle = clamp(launchAngle, 1, 85);
    backSpin = clamp(backSpin, 100, 8000);
    sideSpin = clamp(sideSpin, -MAX_CHIP_SIDESPIN_RPM, MAX_CHIP_SIDESPIN_RPM);

    // ========================================
    // ASSEMBLE RESULT OBJECT
    // ========================================

    const impactResult = {
        // Input Deviations
        timingDeviations: {
            rotationDeviation: rotationDeviation,
            hitDeviation: hitDeviation,
        },

        // Clubhead Delivery Parameters (NEW)
        clubHeadSpeed: clubheadSpeed,
        potentialCHS: clubheadSpeed,
        actualCHS: clubheadSpeed,
        dynamicLoft: dynamicLoft,
        attackAngle: attackAngle,
        absoluteFaceAngle: faceAngle,
        faceAngleRelPath: faceAngle, // Same as absolute since path is 0°
        clubPathAngle: 0, // Chips assume straight path

        // Strike Quality
        strikeQuality: strikeQuality,

        // Ball Launch Conditions
        smashFactor: smashFactor,
        ballSpeed: ballSpeed,
        launchAngle: launchAngle,
        spinAxisTilt: sideSpin / 100, // Approximate tilt from sidespin
        backSpin: backSpin,
        sideSpin: sideSpin,

        // Message - Determine shot type and quality
        message: generateChipMessage(strikeQuality, dynamicLoft, attackAngle, ballSpeed, backSpin)
    };

    return impactResult;
}

/**
 * Generates a descriptive message for the chip shot based on strike quality and shot characteristics.
 * @param {string} strikeQuality - The strike quality (Center, Fat, Thin, Duff)
 * @param {number} dynamicLoft - The dynamic loft at impact (degrees)
 * @param {number} attackAngle - The attack angle (degrees)
 * @param {number} ballSpeed - The ball speed (mph)
 * @param {number} backSpin - The backspin (rpm)
 * @returns {string} Descriptive message for the shot
 */
function generateChipMessage(strikeQuality, dynamicLoft, attackAngle, ballSpeed, backSpin) {
    // Bad strikes get their own messages
    if (strikeQuality === 'Duff') return 'Duffed it!';
    if (strikeQuality === 'Fat') return 'Fat contact!';
    if (strikeQuality === 'Thin') return 'Thinned it!';

    // Good strikes - determine shot type
    // Flop: Very high loft (>65°) and shallow attack angle
    if (dynamicLoft > 65 && attackAngle > -3) {
        return 'Flopped it!';
    }

    // Low Checker: Low loft (<45°), steep attack (-8° or steeper), high spin (>4000 rpm)
    if (dynamicLoft < 45 && attackAngle < -8 && backSpin > 4000) {
        return 'Low checker!';
    }

    // Bump and Run: Low-ish loft (<50°), not much spin (<3000 rpm)
    if (dynamicLoft < 50 && backSpin < 3000) {
        return 'Bump and run!';
    }

    // Good Pitch: Higher ball speed (>15 mph) and decent loft (50-65°)
    if (ballSpeed > 15 && dynamicLoft >= 50 && dynamicLoft <= 65) {
        return 'Good pitch!';
    }

    // Default: Good Chip
    return 'Good chip!';
}
