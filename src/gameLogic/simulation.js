import { getWind, getTemperature } from './state.js'; // Import environment state getters
import { handleObstacleCollision } from '../obstaclePhysics.js'; // Import obstacle collision
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js'; // For Vector3 operations
import { getSurfaceProperties } from '../surfaces.js'; // Import getSurfaceProperties
import { getFlagPosition } from '../visuals/holeView.js'; // To get hole coordinates
import { BALL_RADIUS } from '../visuals/core.js'; // For ground check, hole interaction, and obstacle collision
import { getSurfaceTypeAtPoint } from '../utils/gameUtils.js'; // For dynamic surface detection

/**
 * Helper function to get the correct ball Y position based on surface type
 * @param {string} surfaceType - The surface type name
 * @returns {number} The Y position for the ball
 */
function getBallYPositionForSurface(surfaceType) {
    const surfaceProps = getSurfaceProperties(surfaceType);
    if (surfaceProps && typeof surfaceProps.ballLieOffset === 'number' && surfaceProps.ballLieOffset !== -1) {
        return BALL_RADIUS + surfaceProps.ballLieOffset;
    }
    return BALL_RADIUS; // Default
}

// --- Step-by-Step Flight Simulation ---
// Takes initial position, velocity, spin vector (RPM), and the selected club object.
// Returns simulation results including landing position, carry distance, peak height, time of flight, landing angle, and trajectory points.
export function simulateFlightStepByStep(initialPos, initialVel, spinVec, club, obstacles = []) {
    // --- Get Environment Conditions at Start of Shot ---
    let currentWind = getWind(); // { speed, direction }
    const currentTemperature = getTemperature(); // degrees C

    //currentWind.speed = 0 // Temporarily disable wind for testing


    const trajectoryPoints = [{ ...initialPos, time: 0 }]; // Add timestamp to initial point
    let position = { ...initialPos }; // Current position (copy)
    let velocity = { ...initialVel }; // Current velocity (copy)
    let lastVelocityBeforeLanding = { ...initialVel }; // Store velocity before impact
    let time = 0;
    const dt = 0.01; // Time step in seconds
    const gravity = 9.81;
    let peakHeight = initialPos.y;


    // Get the club-specific effective Cl for backspin
    const club_Cl_backspin_eff = club.clBackspinEff || 0.1; // Use club's value, or a default if undefined

    // Calculate the lift constant for backspin using the club's specific Cl
    // This will now be constant throughout the simulation for this shot,
    // as it's based on the selected club, not dynamically changing with spin.
 
    // --- Simulation Constants (Tunable) ---
    //const Cd = 0.26; // Drag coefficient (placeholder)

    // const SPIN_TO_DRAG_FACTOR = 0.000005//2; // START POSITIVE e.g. 0.0000005 to see drag reduction with spin // REPLACED by non-linear logic
    const Cd_base = 0.21; // Start with your current working value from the "old code" DRAG COEFFICIENT
    const MINIMUM_EFFECTIVE_CD = 0.0001; // Minimum allowed effective drag coefficient

    // Non-linear Spin-to-Drag Effect Constants
    const SPIN_DRAG_EFFECT_THRESHOLD_RPM = 8400; // RPM above which drag reduction starts
    const SPIN_DRAG_RPM_FOR_MAX_EFFECT = 11000;  // RPM at which the maximum drag reduction is achieved
    const SPIN_DRAG_MAX_CD_REDUCTION = 0.1;     // Maximum amount Cd_base can be reduced by spin
    const SPIN_DRAG_EFFECT_POWER = 0.1;          // Exponent for the curve (2.0 = quadratic)


    // const Cl = 0.03; // Lift coefficient (placeholder, related to spin). Reduced from 0.1, still higher than original 0.002. // Replaced by separate Cl values
    //const Cl_backspin = 0.025; // Controls vertical lift (tune for height)
    const Cl_sidespin = 0.040; // Controls side force (tune for curve)
    // Calculate air density based on temperature (using simplified Ideal Gas Law)
    const pressure = 101325; // Standard pressure in Pa
    const specificGasConstant = 287.05; // J/(kg·K) for dry air
    const temperatureKelvin = currentTemperature + 273.15;
    const airDensity = pressure / (specificGasConstant * temperatureKelvin);
    // const airDensity = 1.225; // kg/m^3 (standard air density) - REPLACED
    const ballArea = Math.PI * (0.04267 / 2) * (0.04267 / 2); // Cross-sectional area of golf ball (m^2)
    const ballMass = 0.04593; // kg (standard golf ball mass)
    // Pre-calculate constant part of drag/lift force calculation (now uses calculated airDensity)
    //const dragConst = -0.5 * airDensity * ballArea * Cd / ballMass;
    // const liftConst = 0.5 * airDensity * ballArea * Cl / ballMass; // Replaced by separate lift constants
    //const liftConst_backspin = 0.5 * airDensity * ballArea * Cl_backspin / ballMass;
    const liftConst_sidespin = 0.5 * airDensity * ballArea * Cl_sidespin / ballMass;
    const club_liftConst_backspin = 0.5 * airDensity * ballArea * club_Cl_backspin_eff / ballMass;


    // Air Spin Decay Constants (Tunable)
    const AIR_BACKSPIN_DECAY_RATE_RPM_PER_SECOND = 500; // RPM per second - Needs tuning!
    const AIR_SIDESPIN_DECAY_RATE_RPM_PER_SECOND = 400; // RPM per second - Needs tuning!
    const MIN_AIR_SPIN_EFFECT_RPM = 50; // Spin below this has no effect (avoids tiny calculations)
    // --- End Constants ---


    // Convert wind speed (m/s) and direction (degrees from North) to a velocity vector
    // Wind direction is where it comes FROM. So a 90deg (East) wind blows West (-X).
    const windAngleRad = currentWind.direction * Math.PI / 180;
    const windVel = {
        x: -currentWind.speed * Math.sin(windAngleRad), // Negative sin for X component
        y: 0, // Assume horizontal wind
        z: -currentWind.speed * Math.cos(windAngleRad)  // Negative cos for Z component
    };

    // Convert spin from RPM to rad/s - Use 'let' to allow decay
    // Assuming side spin is around Y axis, back spin around X axis relative to path
    // This needs refinement based on how side/back spin are defined relative to world coords
    let spinRadPerSec = {
        x: -(spinVec.x || 0) * (2 * Math.PI / 60), // Backspin around X (Negated to produce upward lift)
        y: (spinVec.y || 0) * (2 * Math.PI / 60), // Sidespin around Y
        z: (spinVec.z || 0) * (2 * Math.PI / 60)  // Rifle spin? (Assume 0 for now)
    };


     while (position.y > 0.01 || time === 0) { // Loop until ball is near/below ground (allow at least one step)
        // 1. Calculate Relative Velocity (Ball Velocity - Wind Velocity)
        const relativeVel = {
            x: velocity.x - windVel.x,
            y: velocity.y - windVel.y, // windVel.y is usually 0
            z: velocity.z - windVel.z
        };
        const relativeVelMag = Math.sqrt(relativeVel.x**2 + relativeVel.y**2 + relativeVel.z**2);
        if (relativeVelMag < 0.01) {
            // If relative velocity is negligible, forces are minimal.
            const absVelMag = Math.sqrt(velocity.x**2 + velocity.y**2 + velocity.z**2);
            if (absVelMag < 0.01) break; // Stop if absolute velocity is also negligible
        }

        // --- Air Spin Decay ---
        const decayFactor = dt; // Decay is per second, applied over dt
        const backspinDecayRad = (AIR_BACKSPIN_DECAY_RATE_RPM_PER_SECOND * (2 * Math.PI / 60)) * decayFactor;
        const sidespinDecayRad = (AIR_SIDESPIN_DECAY_RATE_RPM_PER_SECOND * (2 * Math.PI / 60)) * decayFactor;
        const minSpinRad = (MIN_AIR_SPIN_EFFECT_RPM * (2 * Math.PI / 60));

        // Decay backspin (spinRadPerSec.x) towards zero
        if (Math.abs(spinRadPerSec.x) > minSpinRad) {
            const decayAmount = Math.min(Math.abs(spinRadPerSec.x), backspinDecayRad);
            spinRadPerSec.x -= decayAmount * Math.sign(spinRadPerSec.x);
        } else {
            spinRadPerSec.x = 0;
        }
        // Decay sidespin (spinRadPerSec.y) towards zero
        if (Math.abs(spinRadPerSec.y) > minSpinRad) {
            const decayAmount = Math.min(Math.abs(spinRadPerSec.y), sidespinDecayRad);
            spinRadPerSec.y -= decayAmount * Math.sign(spinRadPerSec.y);
        } else {
            spinRadPerSec.y = 0;
        }
        // We are ignoring rifle spin decay (spinRadPerSec.z) for now

        // --- Calculate Effective Drag Coefficient for this step ---
        let spinInducedDragReduction = 0;
        const currentBackspinRPM = Math.abs(spinRadPerSec.x) * (60 / (2 * Math.PI));

        if (currentBackspinRPM > SPIN_DRAG_EFFECT_THRESHOLD_RPM) {
            const rangeOfEffectRPM = SPIN_DRAG_RPM_FOR_MAX_EFFECT - SPIN_DRAG_EFFECT_THRESHOLD_RPM;
            if (rangeOfEffectRPM > 0) { // Avoid division by zero
                const progressInEffectRange = (currentBackspinRPM - SPIN_DRAG_EFFECT_THRESHOLD_RPM) / rangeOfEffectRPM;
                const clampedProgress = Math.max(0, Math.min(1, progressInEffectRange));
                spinInducedDragReduction = Math.pow(clampedProgress, SPIN_DRAG_EFFECT_POWER) * SPIN_DRAG_MAX_CD_REDUCTION;
            }
        }

        let effectiveCd = Cd_base - spinInducedDragReduction;
        effectiveCd = Math.max(MINIMUM_EFFECTIVE_CD, effectiveCd); // Clamp to minimum
        
        // For debugging:

        // --- Pre-calculate drag force factor for THIS step using effectiveCd ---
        const currentDragForceFactor = -0.5 * airDensity * ballArea * effectiveCd / ballMass;

        // 2. Calculate Forces (as accelerations)
        const accel_gravity = { x: 0, y: -gravity, z: 0 };

        // Drag Force:
        let accel_drag = { x: 0, y: 0, z: 0 };
        if (relativeVelMag > 0.01) { // Only apply drag if there's significant relative velocity
            accel_drag = {
                x: currentDragForceFactor * relativeVelMag * relativeVel.x,
                y: currentDragForceFactor * relativeVelMag * relativeVel.y,
                z: currentDragForceFactor * relativeVelMag * relativeVel.z
            };
        }

        // Lift (Magnus) Force: (Using your "old code" structure EXACTLY for lift)
        /*
        const crossProd = {
            x: spinRadPerSec.y * relativeVel.z - spinRadPerSec.z * relativeVel.y,
            y: spinRadPerSec.z * relativeVel.x - spinRadPerSec.x * relativeVel.z,
            z: spinRadPerSec.x * relativeVel.y - spinRadPerSec.y * relativeVel.x
        };
        const accel_lift = {
            x: liftConst_sidespin * crossProd.x,
            y: liftConst_backspin * crossProd.y,
            // THIS IS EXACTLY FROM YOUR "OLD" WORKING CODE'S LIFT.Z CALCULATION:
            z: liftConst_backspin * (spinRadPerSec.x * velocity.y) - liftConst_sidespin * (spinRadPerSec.y * velocity.x)
        };
        */

        // Lift (Magnus) Force - Alternative for Z-component
        const crossProd = {
            x: spinRadPerSec.y * relativeVel.z - spinRadPerSec.z * relativeVel.y,
            y: spinRadPerSec.z * relativeVel.x - spinRadPerSec.x * relativeVel.z,
            z: spinRadPerSec.x * relativeVel.y - spinRadPerSec.y * relativeVel.x // This is (spin x relativeVel)_z
        };
        const accel_lift = {
            x: liftConst_sidespin * crossProd.x,
            y: club_liftConst_backspin * crossProd.y,
            // Z-component of acceleration due to lift/Magnus:
            // This version uses the Z-component of the (spin x relativeVel) cross product,
            // and typically this would be scaled by liftConst_sidespin as it contributes to lateral deviation.
            z: liftConst_sidespin * crossProd.z
            // which expands to:
            // z: liftConst_sidespin * (spinRadPerSec.x * relativeVel.y - spinRadPerSec.y * relativeVel.x)
        };

        // Additive "cheat" lift (Identical to your old code)
        const cheatLiftAccelY = (club?.liftFactor || 0) * 0.25;

        // 3. Net Acceleration
        const accel_net = {
            x: accel_gravity.x + accel_drag.x + accel_lift.x,
            y: accel_gravity.y + accel_drag.y + accel_lift.y, //+ cheatLiftAccelY, experimental
            z: accel_gravity.z + accel_drag.z + accel_lift.z
        };

        // 4. Update Velocity (Euler integration)
        velocity.x += accel_net.x * dt;
        velocity.y += accel_net.y * dt;
        velocity.z += accel_net.z * dt;

        // 5. Update Position
        position.x += velocity.x * dt;
        position.y += velocity.y * dt;
        position.z += velocity.z * dt;

        // 5b. Check for obstacle collision with full 3D height checking
        // Trees/bushes affect ball when it's at their height (foliage for trees, full height for bushes)
        if (obstacles.length > 0) {
            const obstacleResult = handleObstacleCollision(
                position.x,
                position.y,
                position.z,
                BALL_RADIUS,
                velocity.x,
                velocity.z,
                obstacles
            );

            if (obstacleResult.collided) {
                velocity.x = obstacleResult.velocityX;
                velocity.z = obstacleResult.velocityZ;
            }
        }

        // 6. Track Peak Height
        if (position.y > peakHeight) {
            peakHeight = position.y;
        }

        // 7. Store Point with timestamp
        trajectoryPoints.push({ ...position, time: time });

        // 8. Increment Time
        time += dt;

        // Safety break
        if (time > 20) {
            console.warn("Simulation exceeded 20 seconds, breaking loop.");
            break;
        }
        // Store the velocity from the step *before* potential termination
        lastVelocityBeforeLanding = { ...velocity };
    }

    const landingPosition = trajectoryPoints.length > 1 ? trajectoryPoints[trajectoryPoints.length - 1] : initialPos;

    // Calculate landing angle
    const finalVel = lastVelocityBeforeLanding;
    const horizontalVelMag = Math.sqrt(finalVel.x**2 + finalVel.z**2);
    let landingAngleRadians = Math.PI / 2; // Default to 90 deg if horizontal speed is near zero
    if (horizontalVelMag > 0.01) {
        landingAngleRadians = Math.atan2(Math.abs(finalVel.y), horizontalVelMag);
    }


    // Calculate carry based on X/Z distance between initialPos and landingPosition
    const dx = landingPosition.x - initialPos.x;
    const dz = landingPosition.z - initialPos.z;
    const carryDistanceMeters = Math.sqrt(dx*dx + dz*dz);

    return {
        landingPosition: landingPosition,
        carryDistance: carryDistanceMeters, // Keep in meters
        peakHeight: peakHeight, // Keep in meters
        timeOfFlight: time, // Actual simulated time
        landingAngleRadians: landingAngleRadians, // Add landing angle
        landingVelocity: finalVel, // Return the velocity vector just before landing
        landingSpinRadPerSec: spinRadPerSec, // Return final spin state in rad/s
        trajectoryPoints: trajectoryPoints // Array of {x, y, z} objects
    };
}


// --- Bounce Phase Simulation ---

// Bounce physics constants (Tunable)
const MIN_BOUNCE_HEIGHT = 0.02; // meters - Below this, transition to pure roll
const MAX_BOUNCES = 8; // Safety limit
const BOUNCE_TIME_STEP = 0.005; // seconds - Smaller step for accuracy during bounces
const BASE_HORIZONTAL_SCRUB_FACTOR = 0.15; // Base horizontal velocity loss per bounce (0-1)
const SPIN_ENHANCED_SCRUB_FACTOR = 0.25; // Additional scrub at max backspin (10000 RPM)
const ANGLE_ENHANCED_SCRUB_FACTOR = 0.35; // Additional scrub for steep landing angles (at 90°)
const SPIN_TO_VELOCITY_TRANSFER = 0.004; // How backspin converts to horizontal velocity change on bounce (increased from 0.0008)
const MAX_SPIN_COR_REDUCTION = 0.40; // Max % reduction in CoR from high backspin (40% at 10k RPM)
const SPIN_COR_FIRMNESS_FACTOR = 1.2; // Multiplier for firm surfaces (green responds more to spin than rough)

/**
 * Simulates the bouncing phase when ball first contacts ground.
 * Each bounce applies energy loss, spin effects, and brief flight physics between impacts.
 * Surface type is checked dynamically at each bounce point.
 *
 * @param {object} landingPosition - {x, y, z} position where ball first hits ground
 * @param {object} landingVelocity - {x, y, z} velocity at ground contact
 * @param {number} landingAngleRadians - Angle of descent
 * @param {object} spinRadPerSec - {x, y, z} current spin in rad/s
 * @param {string} surfaceType - Initial surface type (used if holeLayout not provided)
 * @param {number} startTime - Start time offset for animation
 * @param {object} holeLayout - Hole layout data for dynamic surface detection (optional)
 * @returns {object} Final state after bounces: {position: THREE.Vector3, velocity: THREE.Vector3, spin: {x, y, z} rad/s, bouncePoints: []}
 */
export function simulateBouncePhase(landingPosition, landingVelocity, landingAngleRadians, spinRadPerSec, surfaceType, startTime = 0, holeLayout = null) {

    // Store initial landing angle for scrub calculations
    const initialLandingAngleRadians = landingAngleRadians;

    // Check initial landing surface for penalty area
    const initialSurfaceProps = getSurfaceProperties(surfaceType);
    const initialCoR = initialSurfaceProps?.bounce || 0.4;

    // Check for special value -1.0 (water/penalty area): stop all physics immediately
    if (initialCoR < 0) {
        return {
            position: new THREE.Vector3(landingPosition.x, landingPosition.y, landingPosition.z),
            velocity: new THREE.Vector3(0, 0, 0),
            spin: spinRadPerSec,
            bouncePoints: [{ x: landingPosition.x, y: landingPosition.y, z: landingPosition.z, time: startTime }],
            bounceCount: 0,
            endTime: startTime
        };
    }

    let position = new THREE.Vector3(landingPosition.x, landingPosition.y, landingPosition.z);
    let velocity = new THREE.Vector3(landingVelocity.x, landingVelocity.y, landingVelocity.z);
    let currentSpin = { ...spinRadPerSec };

    const bouncePoints = []; // Track all positions during bounces
    let bounceCount = 0;
    let inAir = false;
    let airTime = 0;
    let currentSurfaceType = surfaceType; // Track current surface type throughout bounces

    // Constants for mini-flight between bounces (simplified from main flight sim)
    const gravity = 9.81;
    const dt = BOUNCE_TIME_STEP;
    let time = startTime; // Start from the end of flight time

    while (bounceCount < MAX_BOUNCES) {
        if (!inAir) {
            // ===== IMPACT EVENT =====
            bounceCount++;

            // Check surface at bounce point (dynamic detection)
            currentSurfaceType = surfaceType; // Default to initial surface
            if (holeLayout) {
                const detectedSurface = getSurfaceTypeAtPoint({ x: position.x, z: position.z }, holeLayout);
                if (detectedSurface) {
                    currentSurfaceType = detectedSurface;
                    if (bounceCount > 1 && detectedSurface !== surfaceType) {
                    }
                }
            }

            // Get surface properties for this bounce
            const surfaceProps = getSurfaceProperties(currentSurfaceType);
            const baseCoR = surfaceProps?.bounce || 0.4;

            const impactSpeed = Math.sqrt(velocity.x**2 + velocity.y**2 + velocity.z**2);
            const horizontalSpeed = Math.sqrt(velocity.x**2 + velocity.z**2);
            const backspinRPM = Math.abs(currentSpin.x) * (60 / (2 * Math.PI));


            // 1. Calculate spin-dependent CoR (backspin "grabs" surface, reducing bounce)
            // Higher backspin + firmer surface = more grip = lower bounce
            const spinGripRatio = Math.min(backspinRPM / 10000, 1.0); // 0 to 1 (caps at 10k RPM)
            // Firmness factor: higher CoR surfaces (firmer) respond more to spin
            const firmnessFactor = Math.pow(baseCoR / 0.4, SPIN_COR_FIRMNESS_FACTOR); // Normalized to 0.4 baseline
            const spinCoRReduction = spinGripRatio * firmnessFactor * MAX_SPIN_COR_REDUCTION;
            const effectiveCoR = baseCoR * (1 - spinCoRReduction);


            // 2. Apply effective coefficient of restitution to vertical velocity
            const oldVerticalVel = velocity.y;
            velocity.y = -velocity.y * effectiveCoR;


            // 3. Horizontal velocity scrub from ground contact friction (scales with backspin AND landing angle)
            // More backspin = more friction = more scrub
            // Steeper landing angle (first bounce only) = more scrub
            const spinScrubMultiplier = Math.min(backspinRPM / 10000, 1.0); // 0 to 1 based on spin (caps at 10k RPM)

            // Angle scrub bonus: only applies significantly on first bounce
            // 0° = 0 bonus, 45° = 0.5 bonus, 90° = 1.0 bonus
            let angleScrubMultiplier = 0;
            if (bounceCount === 1) { // First bounce uses initial landing angle
                angleScrubMultiplier = Math.min(initialLandingAngleRadians / (Math.PI / 2), 1.0); // Normalize to 0-1 (0° to 90°)
            }

            const effectiveScrubFactor = BASE_HORIZONTAL_SCRUB_FACTOR
                + (SPIN_ENHANCED_SCRUB_FACTOR * spinScrubMultiplier)
                + (ANGLE_ENHANCED_SCRUB_FACTOR * angleScrubMultiplier);

            const scrubAmount = horizontalSpeed * effectiveScrubFactor;
            if (horizontalSpeed > 0.01) {
                const horizontalDir = new THREE.Vector2(velocity.x, velocity.z).normalize();
                velocity.x -= horizontalDir.x * scrubAmount;
                velocity.z -= horizontalDir.y * scrubAmount;

                let scrubLog = `Horizontal scrub: ${scrubAmount.toFixed(3)} m/s (${(effectiveScrubFactor * 100).toFixed(1)}% loss, `;
                scrubLog += `base ${(BASE_HORIZONTAL_SCRUB_FACTOR*100).toFixed(0)}%`;
                if (spinScrubMultiplier > 0) {
                    scrubLog += ` + spin ${(spinScrubMultiplier * SPIN_ENHANCED_SCRUB_FACTOR * 100).toFixed(1)}%`;
                }
                if (angleScrubMultiplier > 0) {
                    scrubLog += ` + angle ${(angleScrubMultiplier * ANGLE_ENHANCED_SCRUB_FACTOR * 100).toFixed(1)}%`;
                }
                scrubLog += `)`;
            }

            // 3. Spin affects horizontal velocity on bounce (grip effect)
            // Backspin creates backward force (reduces forward velocity or reverses it)
            // Topspin creates forward force (increases forward velocity)
            let spinEffect = 0;
            if (Math.abs(backspinRPM) > 100 && horizontalSpeed > 0.01) {
                spinEffect = currentSpin.x * SPIN_TO_VELOCITY_TRANSFER;
                const horizontalDir = new THREE.Vector2(velocity.x, velocity.z).normalize();
                // Negative backspin (which we use) should reduce forward velocity
                velocity.x += horizontalDir.x * spinEffect;
                velocity.z += horizontalDir.y * spinEffect;

                const newHorizontalSpeed = Math.sqrt(velocity.x**2 + velocity.z**2);

                // Check if ball reversed direction due to extreme backspin
                const newHorizontalDir = new THREE.Vector2(velocity.x, velocity.z).normalize();
                const directionDot = horizontalDir.dot(newHorizontalDir);
                if (directionDot < 0) {
                }
            }

            // 4. Ground contact modifies spin
            // High friction surfaces "grab" the ball more, reducing spin faster
            const spinReductionFactor = 0.7 + (surfaceProps?.friction || 0.1) * 0.05; // Softer surfaces reduce spin more
            currentSpin.x *= spinReductionFactor;
            currentSpin.y *= spinReductionFactor;

            // Calculate expected bounce height
            const expectedHeight = (velocity.y ** 2) / (2 * gravity);

            // Check if bounce is too small to continue
            if (expectedHeight < MIN_BOUNCE_HEIGHT || velocity.y < 0.3) {
                break;
            }

            // Set position on ground with correct lie offset and mark as airborne
            position.y = getBallYPositionForSurface(currentSurfaceType);
            bouncePoints.push({ x: position.x, y: position.y, z: position.z, time: time });
            inAir = true;
            airTime = 0;

        } else {
            // ===== IN AIR BETWEEN BOUNCES =====
            // Simple ballistic trajectory (could add drag/magnus but keep it simpler for bounces)
            airTime += dt;

            // Apply gravity
            velocity.y -= gravity * dt;

            // Update position
            position.x += velocity.x * dt;
            position.y += velocity.y * dt;
            position.z += velocity.z * dt;

            // Increment time
            time += dt;

            bouncePoints.push({ x: position.x, y: position.y, z: position.z, time: time });

            // Check for ground contact (need to get current surface for proper height check)
            const groundY = getBallYPositionForSurface(currentSurfaceType);
            if (position.y <= groundY) {
                position.y = groundY;
                inAir = false;
                // Continue to next impact
            }

            // Safety: max airtime per bounce
            if (airTime > 2.0) {
                console.warn("Bounce airtime exceeded 2s, forcing landing");
                position.y = groundY;
                inAir = false;
            }
        }

        // Safety: check if ball is basically stopped
        const currentSpeed = Math.sqrt(velocity.x**2 + velocity.y**2 + velocity.z**2);
        if (currentSpeed < MIN_ROLL_SPEED && !inAir) {
            break;
        }
    }

    if (bounceCount >= MAX_BOUNCES) {
        console.warn(`Reached maximum bounces (${MAX_BOUNCES})`);
    }


    return {
        position: position,
        velocity: velocity,
        spin: currentSpin,
        bouncePoints: bouncePoints,
        bounceCount: bounceCount,
        endTime: time // Return the end time for next phase
    };
}


// --- Ground Roll Simulation ---

const MIN_ROLL_SPEED = 0.05; // m/s - Speed below which the ball is considered stopped
const GROUND_FRICTION_TIME_STEP = 0.02; // seconds - Simulation step for ground roll
export const HOLE_RADIUS_METERS = 0.108 / 2; // Regulation hole diameter is 4.25 inches (0.108m)
const MAX_HOLE_ENTRY_SPEED = 1.5; // m/s - Max speed to fall into the hole (needs tuning)
// Spin influence on roll
const NEUTRAL_BACKSPIN_RPM = 2500; // RPM at which spin has minimal effect on roll distance
const SPIN_FRICTION_FACTOR = 0.00008; // How much friction changes per RPM deviation (Increased, needs tuning!) // KEEPING THIS FOR NOW, might remove later

// --- New Spin Physics Constants (Tunable) ---
const BASE_BACKSPIN_ACCELERATION_FACTOR = 0.000012; // Base acceleration per RPM (m/s^2 / RPM) - INCREASED from 0.000005
const SIDESPIN_ACCELERATION_FACTOR = 0.000004; // Acceleration per RPM (m/s^2 / RPM) - Needs tuning!
const BACKSPIN_DECAY_RATE_PER_SECOND = 1500; // RPM decay per second - Needs tuning!
const SIDESPIN_DECAY_RATE_PER_SECOND = 2000; // RPM decay per second - Needs tuning!
const MIN_SPIN_EFFECT_RPM = 200; // Spin below this RPM has no acceleration effect
const SURFACE_CHECK_DISTANCE = 0.25; // meters - Check surface every 25cm

/**
 * Simulates the ball rolling on the ground with friction and spin effects (backspin and sidespin).
 * Surface type is checked dynamically every 25cm.
 *
 * @param {THREE.Vector3} initialPosition - Starting position of the ball (meters).
 * @param {THREE.Vector3} initialVelocity - Starting velocity of the ball (m/s).
 * @param {string} surfaceType - Initial surface type (used if holeLayout not provided).
 * @param {number} initialBackspinRPM - Initial backspin in RPM.
 * @param {number} [initialSideSpinRPM=0] - Initial sidespin in RPM.
 * @param {number} startTime - Start time offset for animation
 * @param {object} holeLayout - Hole layout data for dynamic surface detection (optional)
 * @returns {object} Result containing finalPosition (THREE.Vector3), isHoledOut (boolean), and rollTrajectoryPoints (array of THREE.Vector3).
 */
export function simulateGroundRoll(initialPosition, initialVelocity, surfaceType, initialBackspinRPM = 0, initialSideSpinRPM = 0, startTime = 0, holeLayout = null) {

    let position = initialPosition.clone();
    let velocity = initialVelocity.clone();
    // Store initial horizontal velocity direction for backspin force
    const initialHorizontalVelocityDir = velocity.clone().setY(0).normalize();
    const initialSpeed = Math.sqrt(velocity.x**2 + velocity.z**2);

    // Ensure ball starts on the ground with correct lie offset for roll simulation
    position.y = getBallYPositionForSurface(surfaceType);
    // We only care about horizontal velocity for rolling friction
    velocity.y = 0;

    // Track current spin amounts
    let currentBackspinRPM = initialBackspinRPM;
    let currentSideSpinRPM = initialSideSpinRPM;

    const surfaceProps = getSurfaceProperties(surfaceType);
    const baseFrictionCoefficient = surfaceProps?.friction || 0.1; // Base friction from surface
    const surfaceSpinResponse = surfaceProps?.spinResponse || 1.0; // How much surface responds to spin
    const gravity = 9.81;

    // Calculate surface-specific backspin acceleration factor
    const effectiveBackspinAccelFactor = BASE_BACKSPIN_ACCELERATION_FACTOR * surfaceSpinResponse;

    // COMMENTED OUT: Spin-modified friction (we handle spin effect via direct acceleration instead)
    // // Adjust friction based on backspin
    // // Higher backspin increases friction, lower backspin/topspin decreases it.
    // const spinDeviation = initialBackspinRPM - NEUTRAL_BACKSPIN_RPM;
    // // *** Corrected formula: Use '+' so high spin increases friction factor ***
    // let effectiveFrictionCoefficient = baseFrictionCoefficient * (1 + (spinDeviation * SPIN_FRICTION_FACTOR));
    // // Clamp effective friction to prevent negative values or excessive reduction/increase
    // effectiveFrictionCoefficient = Math.max(0.01, effectiveFrictionCoefficient); // Ensure minimum friction
    // // Let's remove the upper clamp for now to see the full effect of high spin
    // // effectiveFrictionCoefficient = Math.min(baseFrictionCoefficient * 3.0, effectiveFrictionCoefficient); // Optional: Cap max friction increase

    // Use base friction directly (no spin modification)
    const effectiveFrictionCoefficient = baseFrictionCoefficient;

    // Calculate base friction deceleration magnitude
    const frictionDecelerationMagnitude = effectiveFrictionCoefficient * gravity;


    let time = startTime; // Start from end of bounce time
    const dt = GROUND_FRICTION_TIME_STEP;
    let steps = 0;
    let isHoledOut = false; // Track if the ball falls in the hole
    const holePosition = getFlagPosition(); // Get hole position once at the start
    const rollTrajectoryPoints = []; // Initialize array to store roll points

    // Track distance rolled
    let totalDistanceRolled = 0;
    let lastPosition = position.clone();
    let distanceSinceLastSurfaceCheck = 0; // Track distance for surface checking

    // Track current surface and friction
    let currentSurfaceType = surfaceType;
    let currentFrictionCoefficient = baseFrictionCoefficient;
    let currentFrictionDecelerationMagnitude = frictionDecelerationMagnitude;

    // Sample logging every 0.5 seconds
    let nextLogTime = 0.5;


    while (true) {
        const speed = velocity.length(); // Current speed (horizontal only as y=0)

        // Periodic logging (adjust for startTime offset)
        if (time >= (startTime + nextLogTime) && speed > MIN_ROLL_SPEED) {
            const distRolled = totalDistanceRolled;
            nextLogTime += 0.5;
        }

        // --- Hole Interaction Check ---
        // Only check if on the green and hole position is known
        if (currentSurfaceType === 'GREEN' && holePosition) {
            // Calculate 2D distance to hole center
            const dx = position.x - holePosition.x;
            const dz = position.z - holePosition.z;
            const distanceToHoleCenter = Math.sqrt(dx*dx + dz*dz);


            // Check capture condition
            if (distanceToHoleCenter < HOLE_RADIUS_METERS && speed < MAX_HOLE_ENTRY_SPEED) {
                isHoledOut = true;
                position.set(holePosition.x, BALL_RADIUS / 2, holePosition.z); // Center ball in hole, slightly sunk
                velocity.set(0, 0, 0); // Stop the ball
                break; // Exit simulation loop
            }
            // TODO: Add lip-out logic here later if desired
        }

        // --- Stop Check ---
        if (speed < MIN_ROLL_SPEED) {
            velocity.set(0, 0, 0); // Ensure velocity is zeroed out
            break; // Exit simulation loop
        }

        // --- Spin Decay ---
        const spinDecayFactor = dt; // Decay is per second, applied over dt
        currentBackspinRPM -= BACKSPIN_DECAY_RATE_PER_SECOND * spinDecayFactor * Math.sign(currentBackspinRPM);
        currentSideSpinRPM -= SIDESPIN_DECAY_RATE_PER_SECOND * spinDecayFactor * Math.sign(currentSideSpinRPM);
        // Prevent spin from going past zero due to decay
        if (Math.abs(currentBackspinRPM) < MIN_SPIN_EFFECT_RPM) currentBackspinRPM = 0;
        if (Math.abs(currentSideSpinRPM) < MIN_SPIN_EFFECT_RPM) currentSideSpinRPM = 0;

        // --- Calculate Acceleration Vectors ---
        const netAccelerationVec = new THREE.Vector3(0, 0, 0);
        const currentVelocityDir = velocity.clone().normalize();

        // 1. Friction Acceleration (Opposite current velocity)
        if (speed > 0.01) { // Only apply friction if moving
             const frictionAccel = currentVelocityDir.clone().multiplyScalar(-currentFrictionDecelerationMagnitude);
             netAccelerationVec.add(frictionAccel);
        }

        // 2. Backspin Acceleration (Opposite initial velocity direction)
        if (Math.abs(currentBackspinRPM) >= MIN_SPIN_EFFECT_RPM) {
            // Positive backspin creates force opposite initial direction (slows down faster or pulls back)
            // Negative backspin (topspin) creates force *along* initial direction (less slowing)
            const backspinAccelMag = currentBackspinRPM * effectiveBackspinAccelFactor; // Magnitude can be negative for topspin
            const backspinAccel = initialHorizontalVelocityDir.clone().multiplyScalar(-backspinAccelMag); // Negate mag to align force correctly
            netAccelerationVec.add(backspinAccel);
        }

        // 3. Sidespin Acceleration (Perpendicular to current velocity)
        if (Math.abs(currentSideSpinRPM) >= MIN_SPIN_EFFECT_RPM && speed > 0.01) {
            const sidespinAccelMag = Math.abs(currentSideSpinRPM) * SIDESPIN_ACCELERATION_FACTOR;
            // Rotate current velocity direction 90 degrees around Y axis
            // Positive sidespin (slice) -> force to the right (negative X relative to Z dir) -> rotate -90 deg
            // Negative sidespin (hook) -> force to the left (positive X relative to Z dir) -> rotate +90 deg
            const rotationAngle = (currentSideSpinRPM > 0 ? -Math.PI / 2 : Math.PI / 2);
            const sidespinAccelDir = currentVelocityDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationAngle);
            const sidespinAccel = sidespinAccelDir.multiplyScalar(sidespinAccelMag);
            netAccelerationVec.add(sidespinAccel);
        }

        // --- Update Velocity (with refined stop check v3) ---
        let shouldStop = false;
        if (speed > 0.01) {
            // Calculate deceleration from friction (always opposes current velocity)
            const frictionDecelMagnitude = currentFrictionDecelerationMagnitude; // Use current surface friction

            // Calculate the component of backspin acceleration opposing the *current* velocity
            let opposingBackspinMagnitude = 0;
            if (Math.abs(currentBackspinRPM) >= MIN_SPIN_EFFECT_RPM) {
                const backspinAccelMag = currentBackspinRPM * effectiveBackspinAccelFactor;
                const backspinAccelVec = initialHorizontalVelocityDir.clone().multiplyScalar(-backspinAccelMag);
                // Project backspin accel onto the negative current velocity direction
                opposingBackspinMagnitude = -backspinAccelVec.dot(currentVelocityDir);
                opposingBackspinMagnitude = Math.max(0, opposingBackspinMagnitude); // Ensure non-negative
            }

            // Total deceleration magnitude purely opposing the current direction of motion
            const totalOpposingDecelMagnitude = frictionDecelMagnitude + opposingBackspinMagnitude;
            const stoppingDecelerationAmount = totalOpposingDecelMagnitude * dt;

            if (speed <= stoppingDecelerationAmount) {
                shouldStop = true;
            }
        } else {
             // If speed is already very low, consider stopping
             shouldStop = true;
        }


        if (shouldStop) {
            velocity.set(0, 0, 0);
        } else {
            // Apply the full net acceleration (friction + all spin forces)
            velocity.addScaledVector(netAccelerationVec, dt);
        }

        // Update position using the potentially modified velocity
        position.addScaledVector(velocity, dt);
        // Keep ball on the ground plane with correct lie offset
        position.y = getBallYPositionForSurface(currentSurfaceType);

        // Track distance traveled in this step
        const stepDistance = position.distanceTo(lastPosition);
        totalDistanceRolled += stepDistance;
        distanceSinceLastSurfaceCheck += stepDistance;

        // --- Check Surface Type Every 25cm ---
        if (distanceSinceLastSurfaceCheck >= SURFACE_CHECK_DISTANCE && holeLayout) {
            const detectedSurface = getSurfaceTypeAtPoint({ x: position.x, z: position.z }, holeLayout);
            if (detectedSurface && detectedSurface !== currentSurfaceType) {
                currentSurfaceType = detectedSurface;

                // Update friction coefficients
                const newSurfaceProps = getSurfaceProperties(currentSurfaceType);
                currentFrictionCoefficient = newSurfaceProps?.friction || 0.1;
                currentFrictionDecelerationMagnitude = currentFrictionCoefficient * gravity;

            }
            distanceSinceLastSurfaceCheck = 0; // Reset distance counter
        }

        lastPosition = position.clone();

        // Store the current position for the roll trajectory with timestamp
        rollTrajectoryPoints.push({ x: position.x, y: position.y, z: position.z, time: time });

        time += dt;
        steps++;

        // Safety break
        if (time > 30) { // Max 30 seconds of rolling
            console.warn("Sim (Roll): Ground roll simulation exceeded 30 seconds, breaking loop.");
            velocity.set(0, 0, 0); // Stop the ball
            break;
        }
    }

    // --- Apply Ball Lie Offset based on final surface ---
    if (!isHoledOut && surfaceProps && typeof surfaceProps.ballLieOffset === 'number') {
        if (surfaceProps.ballLieOffset === -1) { // Special case for water
            // Set Y significantly below typical surface height, e.g., based on water surface height
            position.y = (surfaceProps.height ?? 0) - BALL_RADIUS * 2; // Example: below water surface
        } else {
            const finalY = BALL_RADIUS + surfaceProps.ballLieOffset;
            position.y = finalY;
        }
    } else if (isHoledOut) {
    } else {
        console.warn(`Sim (Roll): Could not apply lie offset. HoledOut=${isHoledOut}, SurfaceProps=${!!surfaceProps}, Offset=${surfaceProps?.ballLieOffset}`);
        // Keep position.y as BALL_RADIUS if offset couldn't be applied and not holed out
        position.y = BALL_RADIUS;
    }

    // --- Apply Ball Lie Offset to the final position AND the last trajectory point ---
    let finalAdjustedY = BALL_RADIUS; // Default to standard radius height
    if (!isHoledOut && surfaceProps && typeof surfaceProps.ballLieOffset === 'number') {
        if (surfaceProps.ballLieOffset === -1) { // Special case for water
            finalAdjustedY = (surfaceProps.height ?? 0) - BALL_RADIUS * 2; // Example: below water surface
        } else {
            finalAdjustedY = BALL_RADIUS + surfaceProps.ballLieOffset;
        }
        position.y = finalAdjustedY; // Update the final position vector

        // Also update the last point in the trajectory array
        if (rollTrajectoryPoints.length > 0) {
            rollTrajectoryPoints[rollTrajectoryPoints.length - 1].y = finalAdjustedY;
        }

    } else if (isHoledOut) {
        finalAdjustedY = position.y; // Use the Y position set during hole-in check
         // Update the last trajectory point for hole-in as well
         if (rollTrajectoryPoints.length > 0) {
            rollTrajectoryPoints[rollTrajectoryPoints.length - 1].y = finalAdjustedY;
        }
    } else {
        console.warn(`Sim (Roll): Could not apply lie offset. HoledOut=${isHoledOut}, SurfaceProps=${!!surfaceProps}, Offset=${surfaceProps?.ballLieOffset}`);
        position.y = finalAdjustedY; // Ensure final position uses the default BALL_RADIUS height
        // Update the last trajectory point to default height too
        if (rollTrajectoryPoints.length > 0) {
            rollTrajectoryPoints[rollTrajectoryPoints.length - 1].y = finalAdjustedY;
        }
    }

    // --- Final Logging Before Return ---
    if (rollTrajectoryPoints.length > 0) {
    } else {
    }


    const rollDuration = time - startTime;


    return {
        finalPosition: position, // Position now includes the lie offset adjustment
        isHoledOut: isHoledOut,
        rollTrajectoryPoints: rollTrajectoryPoints, // Return the collected points (last point Y is now adjusted)
        endTime: time // Return final time
    };
}
