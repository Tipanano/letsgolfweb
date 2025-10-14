import { getWind, getTemperature } from './state.js'; // Import environment state getters
import { handleObstacleCollision } from '../obstaclePhysics.js'; // Import obstacle collision
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js'; // For Vector3 operations
import { getSurfaceProperties } from '../surfaces.js'; // Import getSurfaceProperties
import { getFlagPosition } from '../visuals/holeView.js'; // To get hole coordinates
import { BALL_RADIUS } from '../visuals/core.js'; // For ground check, hole interaction, and obstacle collision

// --- Step-by-Step Flight Simulation ---
// Takes initial position, velocity, spin vector (RPM), and the selected club object.
// Returns simulation results including landing position, carry distance, peak height, time of flight, landing angle, and trajectory points.
export function simulateFlightStepByStep(initialPos, initialVel, spinVec, club, obstacles = []) {
    // --- Get Environment Conditions at Start of Shot ---
    let currentWind = getWind(); // { speed, direction }
    const currentTemperature = getTemperature(); // degrees C
    console.log(`Sim: Conditions - Temp: ${currentTemperature}°C, Wind: ${currentWind.speed.toFixed(1)}m/s @ ${currentWind.direction}°`);

    //currentWind.speed = 0 // Temporarily disable wind for testing


    const trajectoryPoints = [initialPos];
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
    const Cd_base = 0.20; // Start with your current working value from the "old code" DRAG COEFFICIENT
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
    console.log(`Sim: Calculated Air Density=${airDensity.toFixed(3)} kg/m^3`);
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

    console.log("Sim: Starting step-by-step simulation...");
    console.log(`Sim: Initial Vel: (${velocity.x.toFixed(2)}, ${velocity.y.toFixed(2)}, ${velocity.z.toFixed(2)}) m/s`);
    console.log(`Sim: Spin Vec (RPM): (${spinVec.x.toFixed(0)}, ${spinVec.y.toFixed(0)}, ${spinVec.z.toFixed(0)})`);

    // Convert wind speed (m/s) and direction (degrees from North) to a velocity vector
    // Wind direction is where it comes FROM. So a 90deg (East) wind blows West (-X).
    const windAngleRad = currentWind.direction * Math.PI / 180;
    const windVel = {
        x: -currentWind.speed * Math.sin(windAngleRad), // Negative sin for X component
        y: 0, // Assume horizontal wind
        z: -currentWind.speed * Math.cos(windAngleRad)  // Negative cos for Z component
    };
    console.log(`Sim: WindVel Vector = (${windVel.x.toFixed(2)}, ${windVel.y.toFixed(2)}, ${windVel.z.toFixed(2)}) m/s`);

    // Convert spin from RPM to rad/s - Use 'let' to allow decay
    // Assuming side spin is around Y axis, back spin around X axis relative to path
    // This needs refinement based on how side/back spin are defined relative to world coords
    let spinRadPerSec = {
        x: -(spinVec.x || 0) * (2 * Math.PI / 60), // Backspin around X (Negated to produce upward lift)
        y: (spinVec.y || 0) * (2 * Math.PI / 60), // Sidespin around Y
        z: (spinVec.z || 0) * (2 * Math.PI / 60)  // Rifle spin? (Assume 0 for now)
    };
     console.log(`Sim: Initial Spin rad/s: (${spinRadPerSec.x.toFixed(2)}, ${spinRadPerSec.y.toFixed(2)}, ${spinRadPerSec.z.toFixed(2)})`);


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
        //console.log(`CurrentBackspinRPM: ${currentBackspinRPM.toFixed(0)}, SpinInducedDragReduction: ${spinInducedDragReduction.toFixed(6)}, effectiveCd: ${effectiveCd.toFixed(4)}`);

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

        // 5b. Check for obstacle collision (only if ball is near ground level)
        // Trees/bushes affect ball when it's at their height
        if (obstacles.length > 0 && position.y < 10) { // Check obstacles if below 10m height
            const obstacleResult = handleObstacleCollision(
                position.x,
                position.z,
                BALL_RADIUS,
                velocity.x,
                velocity.z,
                obstacles
            );

            if (obstacleResult.collided) {
                velocity.x = obstacleResult.velocityX;
                velocity.z = obstacleResult.velocityZ;
                console.log(`Ball hit ${obstacleResult.obstacle.type} (${obstacleResult.obstacle.size})!`);
            }
        }

        // 6. Track Peak Height
        if (position.y > peakHeight) {
            peakHeight = position.y;
        }

        // 7. Store Point
        trajectoryPoints.push({ ...position });

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

    console.log(`Sim: Simulation finished. Time: ${time.toFixed(2)}s, Steps: ${trajectoryPoints.length}`);
    console.log(`let's see the trajectory points:`, trajectoryPoints.map(p => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`).join(", "));
    const landingPosition = trajectoryPoints.length > 1 ? trajectoryPoints[trajectoryPoints.length - 1] : initialPos;

    // Calculate landing angle
    const finalVel = lastVelocityBeforeLanding;
    const horizontalVelMag = Math.sqrt(finalVel.x**2 + finalVel.z**2);
    let landingAngleRadians = Math.PI / 2; // Default to 90 deg if horizontal speed is near zero
    if (horizontalVelMag > 0.01) {
        landingAngleRadians = Math.atan2(Math.abs(finalVel.y), horizontalVelMag);
    }
    console.log(`Sim: Final Velocity (y): ${finalVel.y.toFixed(2)}, Horizontal Vel: ${horizontalVelMag.toFixed(2)}, Landing Angle: ${(landingAngleRadians * 180 / Math.PI).toFixed(1)} deg`);


    // Calculate carry based on X/Z distance between initialPos and landingPosition
    const dx = landingPosition.x - initialPos.x;
    const dz = landingPosition.z - initialPos.z;
    const carryDistanceMeters = Math.sqrt(dx*dx + dz*dz);
    console.log(`Sim: Carry Distance (m): ${carryDistanceMeters.toFixed(2)} (dx=${dx.toFixed(2)}, dz=${dz.toFixed(2)})`);

    return {
        landingPosition: landingPosition,
        carryDistance: carryDistanceMeters, // Keep in meters
        peakHeight: peakHeight, // Keep in meters
        timeOfFlight: time, // Actual simulated time
        landingAngleRadians: landingAngleRadians, // Add landing angle
        landingVelocity: finalVel, // Return the velocity vector just before landing
        trajectoryPoints: trajectoryPoints // Array of {x, y, z} objects
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
const BACKSPIN_ACCELERATION_FACTOR = 0.000005; // Acceleration per RPM (m/s^2 / RPM) - Needs tuning!
const SIDESPIN_ACCELERATION_FACTOR = 0.000004; // Acceleration per RPM (m/s^2 / RPM) - Needs tuning!
const BACKSPIN_DECAY_RATE_PER_SECOND = 1500; // RPM decay per second - Needs tuning!
const SIDESPIN_DECAY_RATE_PER_SECOND = 2000; // RPM decay per second - Needs tuning!
const MIN_SPIN_EFFECT_RPM = 200; // Spin below this RPM has no acceleration effect

/**
 * Simulates the ball rolling on the ground with friction and spin effects (backspin and sidespin).
 *
 * @param {THREE.Vector3} initialPosition - Starting position of the ball (meters).
 * @param {THREE.Vector3} initialVelocity - Starting velocity of the ball (m/s).
 * @param {string} surfaceType - The type of surface the ball is on ('green', 'fairway', 'rough', etc.).
 * @param {number} initialBackspinRPM - Initial backspin in RPM.
 * @param {number} [initialSideSpinRPM=0] - Initial sidespin in RPM.
 * @returns {object} Result containing finalPosition (THREE.Vector3), isHoledOut (boolean), and rollTrajectoryPoints (array of THREE.Vector3).
 */
export function simulateGroundRoll(initialPosition, initialVelocity, surfaceType, initialBackspinRPM = 0, initialSideSpinRPM = 0) {
    console.log(`Sim (Roll): Starting ground roll. Surface: ${surfaceType}, Backspin: ${initialBackspinRPM.toFixed(0)} RPM, Sidespin: ${initialSideSpinRPM.toFixed(0)} RPM`);
    console.log(`Sim (Roll): Initial Pos: (${initialPosition.x.toFixed(2)}, ${initialPosition.y.toFixed(2)}, ${initialPosition.z.toFixed(2)})`);
    console.log(`Sim (Roll): Initial Vel: (${initialVelocity.x.toFixed(2)}, ${initialVelocity.y.toFixed(2)}, ${initialVelocity.z.toFixed(2)})`);

    let position = initialPosition.clone();
    let velocity = initialVelocity.clone();
    // Store initial horizontal velocity direction for backspin force
    const initialHorizontalVelocityDir = velocity.clone().setY(0).normalize();
    // Ensure ball starts exactly on the ground visually for roll simulation
    position.y = BALL_RADIUS;
    // We only care about horizontal velocity for rolling friction
    velocity.y = 0;

    // Track current spin amounts
    let currentBackspinRPM = initialBackspinRPM;
    let currentSideSpinRPM = initialSideSpinRPM;

    const surfaceProps = getSurfaceProperties(surfaceType);
    const baseFrictionCoefficient = surfaceProps?.friction || 0.1; // Base friction from surface
    const gravity = 9.81;

    // Adjust friction based on backspin
    // Higher backspin increases friction, lower backspin/topspin decreases it.
    const spinDeviation = initialBackspinRPM - NEUTRAL_BACKSPIN_RPM;
    // *** Corrected formula: Use '+' so high spin increases friction factor ***
    let effectiveFrictionCoefficient = baseFrictionCoefficient * (1 + (spinDeviation * SPIN_FRICTION_FACTOR));
    // Clamp effective friction to prevent negative values or excessive reduction/increase
    effectiveFrictionCoefficient = Math.max(0.01, effectiveFrictionCoefficient); // Ensure minimum friction
    // Let's remove the upper clamp for now to see the full effect of high spin
    // effectiveFrictionCoefficient = Math.min(baseFrictionCoefficient * 3.0, effectiveFrictionCoefficient); // Optional: Cap max friction increase

    // Calculate base friction deceleration magnitude (we might remove the spin effect on friction later)
    const frictionDecelerationMagnitude = effectiveFrictionCoefficient * gravity;
    console.log(`Sim (Roll): Surface='${surfaceType}', BaseFriction=${baseFrictionCoefficient.toFixed(3)}, SpinDev=${spinDeviation.toFixed(0)}, EffectiveFriction=${effectiveFrictionCoefficient.toFixed(3)}, FrictionDecelMag=${frictionDecelerationMagnitude.toFixed(2)} m/s^2`);

    let time = 0;
    const dt = GROUND_FRICTION_TIME_STEP;
    let steps = 0;
    let isHoledOut = false; // Track if the ball falls in the hole
    const holePosition = getFlagPosition(); // Get hole position once at the start
    const rollTrajectoryPoints = []; // Initialize array to store roll points

    while (true) {
        const speed = velocity.length(); // Current speed (horizontal only as y=0)

        //console.log('the speed is:', speed.toFixed(3), 'm/s');

        // --- Hole Interaction Check ---
        // Only check if on the green and hole position is known
        if (surfaceType === 'green' && holePosition) {
            // Calculate 2D distance to hole center
            const dx = position.x - holePosition.x;
            const dz = position.z - holePosition.z;
            const distanceToHoleCenter = Math.sqrt(dx*dx + dz*dz);

            console.log('Sim (Roll): Distance to hole center:', distanceToHoleCenter.toFixed(3), 'm');

            console.log('hole out min dist:', (HOLE_RADIUS_METERS).toFixed(3), 'm');
            // Check capture condition
            if (distanceToHoleCenter < HOLE_RADIUS_METERS && speed < MAX_HOLE_ENTRY_SPEED) {
                console.log(`Sim (Roll): HOLE IN! Dist=${distanceToHoleCenter.toFixed(3)}, Speed=${speed.toFixed(2)}`);
                isHoledOut = true;
                position.set(holePosition.x, BALL_RADIUS / 2, holePosition.z); // Center ball in hole, slightly sunk
                velocity.set(0, 0, 0); // Stop the ball
                break; // Exit simulation loop
            }
            // TODO: Add lip-out logic here later if desired
        }

        // --- Stop Check ---
        if (speed < MIN_ROLL_SPEED) {
            console.log(`Sim (Roll): Ball stopped at speed ${speed.toFixed(3)} m/s after ${time.toFixed(2)}s`);
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
             const frictionAccel = currentVelocityDir.clone().multiplyScalar(-frictionDecelerationMagnitude);
             netAccelerationVec.add(frictionAccel);
        }

        // 2. Backspin Acceleration (Opposite initial velocity direction)
        if (Math.abs(currentBackspinRPM) >= MIN_SPIN_EFFECT_RPM) {
            // Positive backspin creates force opposite initial direction (slows down faster or pulls back)
            // Negative backspin (topspin) creates force *along* initial direction (less slowing)
            const backspinAccelMag = currentBackspinRPM * BACKSPIN_ACCELERATION_FACTOR; // Magnitude can be negative for topspin
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
            const frictionDecelMagnitude = frictionDecelerationMagnitude; // Already calculated

            // Calculate the component of backspin acceleration opposing the *current* velocity
            let opposingBackspinMagnitude = 0;
            if (Math.abs(currentBackspinRPM) >= MIN_SPIN_EFFECT_RPM) {
                const backspinAccelMag = currentBackspinRPM * BACKSPIN_ACCELERATION_FACTOR;
                const backspinAccelVec = initialHorizontalVelocityDir.clone().multiplyScalar(-backspinAccelMag);
                // Project backspin accel onto the negative current velocity direction
                opposingBackspinMagnitude = -backspinAccelVec.dot(currentVelocityDir);
                opposingBackspinMagnitude = Math.max(0, opposingBackspinMagnitude); // Ensure non-negative
            }

            // Total deceleration magnitude purely opposing the current direction of motion
            const totalOpposingDecelMagnitude = frictionDecelMagnitude + opposingBackspinMagnitude;
            const stoppingDecelerationAmount = totalOpposingDecelMagnitude * dt;

            if (speed <= stoppingDecelerationAmount) {
                console.log(`Sim (Roll): Stopping ball. Speed (${speed.toFixed(3)}) <= Total Opposing Decel Amount (${stoppingDecelerationAmount.toFixed(3)})`);
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
        // Keep ball on the ground plane
        position.y = BALL_RADIUS;

        // Store the current position for the roll trajectory
        rollTrajectoryPoints.push(position.clone());

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
        console.log('BALL LIE OFFESET STUFF are we doing this at all???')
        if (surfaceProps.ballLieOffset === -1) { // Special case for water
            console.log("Sim (Roll): Ball ended in water, setting Y low.");
            // Set Y significantly below typical surface height, e.g., based on water surface height
            position.y = (surfaceProps.height ?? 0) - BALL_RADIUS * 2; // Example: below water surface
        } else {
            const finalY = BALL_RADIUS + surfaceProps.ballLieOffset;
            console.log(`Sim (Roll): Applying lie offset. Surface: ${surfaceType}, Offset: ${surfaceProps.ballLieOffset.toFixed(3)}, Final Y: ${finalY.toFixed(3)}`);
            position.y = finalY;
        }
    } else if (isHoledOut) {
        console.log("Sim (Roll): Ball holed out, skipping lie offset.");
    } else {
        console.warn(`Sim (Roll): Could not apply lie offset. HoledOut=${isHoledOut}, SurfaceProps=${!!surfaceProps}, Offset=${surfaceProps?.ballLieOffset}`);
        // Keep position.y as BALL_RADIUS if offset couldn't be applied and not holed out
        position.y = BALL_RADIUS;
    }

    // --- Apply Ball Lie Offset to the final position AND the last trajectory point ---
    let finalAdjustedY = BALL_RADIUS; // Default to standard radius height
    if (!isHoledOut && surfaceProps && typeof surfaceProps.ballLieOffset === 'number') {
        if (surfaceProps.ballLieOffset === -1) { // Special case for water
            console.log("Sim (Roll): Ball ended in water, setting Y low.");
            finalAdjustedY = (surfaceProps.height ?? 0) - BALL_RADIUS * 2; // Example: below water surface
        } else {
            finalAdjustedY = BALL_RADIUS + surfaceProps.ballLieOffset;
            console.log(`Sim (Roll): Applying lie offset. Surface: ${surfaceType}, Offset: ${surfaceProps.ballLieOffset.toFixed(3)}, Final Y: ${finalAdjustedY.toFixed(3)}`);
        }
        position.y = finalAdjustedY; // Update the final position vector

        // Also update the last point in the trajectory array
        if (rollTrajectoryPoints.length > 0) {
            rollTrajectoryPoints[rollTrajectoryPoints.length - 1].y = finalAdjustedY;
        }

    } else if (isHoledOut) {
        console.log("Sim (Roll): Ball holed out, using hole depth Y.");
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
    console.log("--- Sim (Roll) Final State ---");
    console.log(`Surface Type: ${surfaceType}`);
    console.log(`Surface Props:`, surfaceProps);
    console.log(`Ball Radius: ${BALL_RADIUS.toFixed(3)}`);
    console.log(`Calculated Lie Offset: ${surfaceProps?.ballLieOffset?.toFixed(3) ?? 'N/A'}`);
    console.log(`Final Adjusted Y: ${finalAdjustedY.toFixed(3)}`);
    console.log(`Final Position Vec: (${position.x.toFixed(3)}, ${position.y.toFixed(3)}, ${position.z.toFixed(3)})`);
    if (rollTrajectoryPoints.length > 0) {
        console.log(`Last Trajectory Point Y: ${rollTrajectoryPoints[rollTrajectoryPoints.length - 1].y.toFixed(3)}`);
    } else {
        console.log(`Last Trajectory Point Y: N/A (No roll points)`);
    }
    console.log("-----------------------------");


    console.log(`Sim (Roll): Finished. HoledOut=${isHoledOut}, Steps: ${steps}, Final Pos Adjusted: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);

    return {
        finalPosition: position, // Position now includes the lie offset adjustment
        isHoledOut: isHoledOut,
        rollTrajectoryPoints: rollTrajectoryPoints // Return the collected points (last point Y is now adjusted)
    };
}
