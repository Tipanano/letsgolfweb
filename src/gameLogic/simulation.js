// --- Step-by-Step Flight Simulation ---
// Takes initial position, velocity, spin vector (RPM), and the selected club object.
// Returns simulation results including landing position, carry distance, peak height, time of flight, landing angle, and trajectory points.
export function simulateFlightStepByStep(initialPos, initialVel, spinVec, club) {
    const trajectoryPoints = [initialPos];
    let position = { ...initialPos }; // Current position (copy)
    let velocity = { ...initialVel }; // Current velocity (copy)
    let lastVelocityBeforeLanding = { ...initialVel }; // Store velocity before impact
    let time = 0;
    const dt = 0.01; // Time step in seconds
    const gravity = 9.81;
    let peakHeight = initialPos.y;

    // --- Simulation Constants (Tunable) ---
    const Cd = 0.32; // Drag coefficient (placeholder)
    // const Cl = 0.03; // Lift coefficient (placeholder, related to spin). Reduced from 0.1, still higher than original 0.002. // Replaced by separate Cl values
    const Cl_backspin = 0.01; // Controls vertical lift (tune for height)
    const Cl_sidespin = 0.1; // Controls side force (tune for curve)
    const airDensity = 1.225; // kg/m^3 (standard air density)
    const ballArea = Math.PI * (0.04267 / 2) * (0.04267 / 2); // Cross-sectional area of golf ball (m^2)
    const ballMass = 0.04593; // kg (standard golf ball mass)
    // Pre-calculate constant part of drag/lift force calculation
    const dragConst = -0.5 * airDensity * ballArea * Cd / ballMass;
    // const liftConst = 0.5 * airDensity * ballArea * Cl / ballMass; // Replaced by separate lift constants
    const liftConst_backspin = 0.5 * airDensity * ballArea * Cl_backspin / ballMass;
    const liftConst_sidespin = 0.5 * airDensity * ballArea * Cl_sidespin / ballMass;
    // Air Spin Decay Constants (Tunable)
    const AIR_BACKSPIN_DECAY_RATE_RPM_PER_SECOND = 500; // RPM per second - Needs tuning!
    const AIR_SIDESPIN_DECAY_RATE_RPM_PER_SECOND = 400; // RPM per second - Needs tuning!
    const MIN_AIR_SPIN_EFFECT_RPM = 50; // Spin below this has no effect (avoids tiny calculations)
    // --- End Constants ---

    console.log("Sim: Starting step-by-step simulation...");
    console.log(`Sim: Initial Vel: (${velocity.x.toFixed(2)}, ${velocity.y.toFixed(2)}, ${velocity.z.toFixed(2)}) m/s`);
    console.log(`Sim: Spin Vec (RPM): (${spinVec.x.toFixed(0)}, ${spinVec.y.toFixed(0)}, ${spinVec.z.toFixed(0)})`);

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
        // 1. Calculate Velocity Magnitude
        const velMag = Math.sqrt(velocity.x**2 + velocity.y**2 + velocity.z**2);
        if (velMag < 0.01) break; // Stop if ball stops mid-air

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

        // 2. Calculate Forces (as accelerations)
        const accel_gravity = { x: 0, y: -gravity, z: 0 };

        // Drag Force: Fd = -0.5 * rho * A * Cd * v^2 * (v_unit) => a = F/m
        const accel_drag = {
            x: dragConst * velMag * velocity.x,
            y: dragConst * velMag * velocity.y,
            z: dragConst * velMag * velocity.z
        };

        // Lift (Magnus) Force: Fl = 0.5 * rho * A * Cl * (w x v) => a = F/m
        // Cross Product: w x v = (wy*vz - wz*vy, wz*vx - wx*vz, wx*vy - wy*vx)
        const crossProd = {
            x: spinRadPerSec.y * velocity.z - spinRadPerSec.z * velocity.y,
            y: spinRadPerSec.z * velocity.x - spinRadPerSec.x * velocity.z,
            z: spinRadPerSec.x * velocity.y - spinRadPerSec.y * velocity.x
        };
        // Lift (Magnus) Force: Split calculation using separate constants
        const accel_lift = {
            x: liftConst_sidespin * crossProd.x, // Horizontal force primarily from sidespin (crossProd.x involves spin.y)
            y: liftConst_backspin * crossProd.y, // Vertical force primarily from backspin (crossProd.y involves spin.x)
            z: liftConst_backspin * (spinRadPerSec.x * velocity.y) - liftConst_sidespin * (spinRadPerSec.y * velocity.x) // Apply respective constants to z-components
        };

        // Additive "cheat" lift based on club's liftFactor
        const cheatLiftAccelY = (club?.liftFactor || 0) * 0.25; // Scaled boost (Added null check for club)

        // 3. Net Acceleration
        const accel_net = {
            x: accel_gravity.x + accel_drag.x + accel_lift.x,
            y: accel_gravity.y + accel_drag.y + accel_lift.y + cheatLiftAccelY, // Added cheat lift
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
        carryDistance: carryDistanceMeters * 1.09361, // Convert to yards
        peakHeight: peakHeight * 1.09361, // Convert to yards
        timeOfFlight: time, // Actual simulated time
        landingAngleRadians: landingAngleRadians, // Add landing angle
        landingVelocity: finalVel, // Return the velocity vector just before landing
        trajectoryPoints: trajectoryPoints // Array of {x, y, z} objects
    };
}


// --- Ground Roll Simulation ---
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js'; // For Vector3 operations
import { getSurfaceProperties } from '../surfaces.js'; // To get friction coefficients
import { BALL_RADIUS } from '../visuals/core.js'; // For ground check and hole interaction
import { getFlagPosition } from '../visuals/holeView.js'; // To get hole coordinates

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

        console.log('the speed is:', speed.toFixed(3), 'm/s');

        // --- Hole Interaction Check ---
        // Only check if on the green and hole position is known
        if (surfaceType === 'green' && holePosition) {
            // Calculate 2D distance to hole center
            const dx = position.x - holePosition.x;
            const dz = position.z - holePosition.z;
            const distanceToHoleCenter = Math.sqrt(dx*dx + dz*dz);

            // Check capture condition
            if (distanceToHoleCenter < HOLE_RADIUS_METERS - BALL_RADIUS && speed < MAX_HOLE_ENTRY_SPEED) {
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

    console.log(`Sim (Roll): Finished. HoledOut=${isHoledOut}, Steps: ${steps}, Final Pos: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);

    return {
        finalPosition: position,
        isHoledOut: isHoledOut,
        rollTrajectoryPoints: rollTrajectoryPoints // Return the collected points
    };
}
