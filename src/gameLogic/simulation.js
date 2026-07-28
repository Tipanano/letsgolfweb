import { getWind, getTemperature } from './state.js';
import { handleObstacleCollision } from '../obstaclePhysics.js';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { getSurfaceProperties, SURFACES } from '../surfaces.js';
import { getFlagPosition } from '../visuals/holeView.js';
import { BALL_RADIUS } from '../visuals/core.js';
import { getSurfaceTypeAtPoint } from '../utils/gameUtils.js';
import { queryTerrainHeight } from '../visuals.js';
import { gradientAt as contourGradientAt } from '../greenContours.js';

// ============================================================
// Physical constants (sea level, regulation golf ball)
// ============================================================
const BALL_DIAMETER  = 0.04267;            // m (1.68 in)
const BALL_R         = BALL_DIAMETER / 2;  // m
const BALL_AREA      = Math.PI * BALL_R * BALL_R;
const BALL_MASS      = 0.04593;            // kg
const BALL_I         = (2 / 5) * BALL_MASS * BALL_R * BALL_R; // sphere moment of inertia
const GRAVITY        = 9.81;               // m/s^2

// Per-step physics tracing (flight/roll telemetry every shot). Turn on when
// tuning; off by default to keep the console usable.
const PHYSICS_LOG = false;
const AIR_VISCOSITY  = 1.81e-5;            // Pa·s, dynamic viscosity of air at ~15 °C

// ============================================================
// Aerodynamic coefficient curves (physically motivated)
// ============================================================

/**
 * Drag coefficient for a dimpled golf ball as a function of Reynolds number
 * and spin ratio. Curve fit to Bearman & Harvey (1976) and Aoki (2009)
 * wind-tunnel data on real dimpled balls:
 *   Re < 40k:           Cd ~ 0.50  (subcritical)
 *   40k–70k:            drag crisis, drops to ~0.21
 *   > 70k:              flat post-critical trough at ~0.21
 *                       (dimples keep boundary layer turbulent; unlike a smooth
 *                        sphere which rises again at very high Re, real golf
 *                        balls stay in the trough)
 *   + 0.12·S            spin-induced drag rise. Aoki measured 10-20% Cd rise
 *                       across S = 0–0.5; we're at the upper end. This is the
 *                       term that primarily separates iron behavior (S ~ 0.3)
 *                       from driver behavior (S ~ 0.08) in flight.
 */
function dragCoefficient(reynolds, spinRatio) {
    let cd;
    if (reynolds < 4e4)       cd = 0.50;
    else if (reynolds < 7e4)  cd = 0.50 - 0.29 * (reynolds - 4e4) / 3e4;
    else                       cd = 0.21;
    return cd + 0.16 * Math.min(spinRatio, 0.5);
}

/**
 * Lift coefficient for a dimpled golf ball as a function of spin ratio S = ωR/v.
 * Faster onset (scale = 0.06) so a moderate-spin driver shot reaches ~70% of
 * max CL, while high-spin shots saturate to the same plateau. This shape
 * matches Aoki (2009) data better than slow saturation — real measurements
 * show CL climbing steeply through S = 0.05–0.15 then flattening.
 */
function liftCoefficient(spinRatio) {
    return 0.22 * (1 - Math.exp(-spinRatio / 0.06));
}

/** Helper: Y-position of ball on the ground for a given surface and XZ. */
function getBallYPositionForSurface(surfaceType, x = 0, z = 0) {
    const terrainHeight = queryTerrainHeight(x, z);
    const surfaceProps = getSurfaceProperties(surfaceType);
    const lieOffset = (surfaceProps && typeof surfaceProps.ballLieOffset === 'number' && surfaceProps.ballLieOffset !== -1)
        ? surfaceProps.ballLieOffset
        : 0;
    return terrainHeight + BALL_RADIUS + lieOffset;
}

// ============================================================
// FLIGHT SIMULATION (RK4 integrator)
// ============================================================

/**
 * Simulate ball flight from launch to ground contact.
 * Inputs:
 *   initialPos: {x,y,z} (m)
 *   initialVel: {x,y,z} (m/s)
 *   spinVec:    {x,y,z} (RPM) — game convention:
 *                  +x = backspin magnitude (will be stored as negative ωx, so Magnus lifts the ball)
 *                  +y = slice sidespin (right-curve for a right-handed shot)
 *                  +z = rifle spin (unused)
 *   club:       club object (only used for obstacle collision wiring)
 *   obstacles:  obstacle array
 */
export function simulateFlightStepByStep(initialPos, initialVel, spinVec, club, obstacles = []) {
    const wind = getWind();
    const tempC = getTemperature();

    // Air density from ideal gas at sea level pressure
    const airDensity = 101325 / (287.05 * (tempC + 273.15));

    // Wind vector (direction is where wind blows FROM, per existing convention)
    const windAngleRad = wind.direction * Math.PI / 180;
    const baseWindVel = {
        x: -wind.speed * Math.sin(windAngleRad),
        y: 0,
        z: -wind.speed * Math.cos(windAngleRad),
    };
    const WIND_HEIGHT_REF = 20;     // m — height where reported wind applies
    const GROUND_WIND_FACTOR = 0.3; // ground level fraction

    // Convert spin to rad/s. Note backspin component is stored negative so that
    // F_lift ∝ (ω × v) points up when the ball travels in +Z.
    const RPM_TO_RAD = 2 * Math.PI / 60;
    let spin = {
        x: -(spinVec.x || 0) * RPM_TO_RAD,
        y:  (spinVec.y || 0) * RPM_TO_RAD,
        z:  (spinVec.z || 0) * RPM_TO_RAD,
    };

    let position = { ...initialPos };
    let velocity = { ...initialVel };
    let peakHeight = position.y;
    let lastVelocityBeforeLanding = { ...velocity };

    const dt = 0.01;
    let time = 0;

    const trajectoryPoints = [{ ...position, time: 0 }];

    // Flight logging
    let lastLoggedDistance = 0;
    const LOG_INTERVAL_M = 25;

    // Spin decay: dω/dt = -k * |v| * ω. Tuned so at v=30 m/s decay ≈ 3.8%/s,
    // which matches measured PGA Tour drives losing ~25% spin over ~6 s.
    const SPIN_DECAY_K = 0.00125; // 1/m  (per metre travelled per radian)

    // -- Acceleration field --------------------------------------------------
    // Returns acceleration vector for a given position/velocity/spin state.
    function accel(pos, vel, omega) {
        // Wind at this height
        let hf;
        if (pos.y >= WIND_HEIGHT_REF) hf = 1.0;
        else hf = GROUND_WIND_FACTOR + (1 - GROUND_WIND_FACTOR) * Math.max(0, pos.y) / WIND_HEIGHT_REF;
        const w = { x: baseWindVel.x * hf, y: 0, z: baseWindVel.z * hf };

        // Air-relative velocity
        const rv = { x: vel.x - w.x, y: vel.y - w.y, z: vel.z - w.z };
        const vMag = Math.sqrt(rv.x * rv.x + rv.y * rv.y + rv.z * rv.z);

        let a = { x: 0, y: -GRAVITY, z: 0 };

        if (vMag < 0.01) return a; // gravity only when nearly still

        // Reynolds number, and spin ratio used by both Cd (drag rise) and CL
        const Re = airDensity * vMag * BALL_DIAMETER / AIR_VISCOSITY;
        const ox = omega.x, oy = omega.y, oz = omega.z;
        const omegaMag = Math.sqrt(ox * ox + oy * oy + oz * oz);
        const spinRatio = omegaMag > 0.1 ? (omegaMag * BALL_R / vMag) : 0;
        const Cd = dragCoefficient(Re, spinRatio);

        // Drag: F = -0.5 ρ A Cd |v| v_rel
        const dragK = -0.5 * airDensity * BALL_AREA * Cd / BALL_MASS;
        a.x += dragK * vMag * rv.x;
        a.y += dragK * vMag * rv.y;
        a.z += dragK * vMag * rv.z;

        // Magnus / lift: F = 0.5 ρ A C_L |v|^2 (ω̂ × v̂)
        if (omegaMag > 0.1) {
            const Cl = liftCoefficient(spinRatio);
            const cx = oy * rv.z - oz * rv.y;
            const cy = oz * rv.x - ox * rv.z;
            const cz = ox * rv.y - oy * rv.x;
            const crossMag = Math.sqrt(cx * cx + cy * cy + cz * cz);
            if (crossMag > 1e-6) {
                const liftScale = 0.5 * airDensity * BALL_AREA * Cl * vMag * vMag / (BALL_MASS * crossMag);
                a.x += liftScale * cx;
                a.y += liftScale * cy;
                a.z += liftScale * cz;
            }
        }

        return a;
    }

    // -- Main RK4 loop -------------------------------------------------------
    while (position.y > queryTerrainHeight(position.x, position.z) + 0.01 || time === 0) {

        // k1
        const a1 = accel(position, velocity, spin);
        const k1v = { x: a1.x * dt, y: a1.y * dt, z: a1.z * dt };
        const k1x = { x: velocity.x * dt, y: velocity.y * dt, z: velocity.z * dt };

        // k2
        const p2 = { x: position.x + k1x.x / 2, y: position.y + k1x.y / 2, z: position.z + k1x.z / 2 };
        const v2 = { x: velocity.x + k1v.x / 2, y: velocity.y + k1v.y / 2, z: velocity.z + k1v.z / 2 };
        const a2 = accel(p2, v2, spin);
        const k2v = { x: a2.x * dt, y: a2.y * dt, z: a2.z * dt };
        const k2x = { x: v2.x * dt, y: v2.y * dt, z: v2.z * dt };

        // k3
        const p3 = { x: position.x + k2x.x / 2, y: position.y + k2x.y / 2, z: position.z + k2x.z / 2 };
        const v3 = { x: velocity.x + k2v.x / 2, y: velocity.y + k2v.y / 2, z: velocity.z + k2v.z / 2 };
        const a3 = accel(p3, v3, spin);
        const k3v = { x: a3.x * dt, y: a3.y * dt, z: a3.z * dt };
        const k3x = { x: v3.x * dt, y: v3.y * dt, z: v3.z * dt };

        // k4
        const p4 = { x: position.x + k3x.x, y: position.y + k3x.y, z: position.z + k3x.z };
        const v4 = { x: velocity.x + k3v.x, y: velocity.y + k3v.y, z: velocity.z + k3v.z };
        const a4 = accel(p4, v4, spin);
        const k4v = { x: a4.x * dt, y: a4.y * dt, z: a4.z * dt };
        const k4x = { x: v4.x * dt, y: v4.y * dt, z: v4.z * dt };

        // Combine
        velocity.x += (k1v.x + 2 * k2v.x + 2 * k3v.x + k4v.x) / 6;
        velocity.y += (k1v.y + 2 * k2v.y + 2 * k3v.y + k4v.y) / 6;
        velocity.z += (k1v.z + 2 * k2v.z + 2 * k3v.z + k4v.z) / 6;
        position.x += (k1x.x + 2 * k2x.x + 2 * k3x.x + k4x.x) / 6;
        position.y += (k1x.y + 2 * k2x.y + 2 * k3x.y + k4x.y) / 6;
        position.z += (k1x.z + 2 * k2x.z + 2 * k3x.z + k4x.z) / 6;

        // Velocity-coupled spin decay over this step
        const vNow = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
        const decay = Math.exp(-SPIN_DECAY_K * vNow * dt);
        spin.x *= decay;
        spin.y *= decay;
        spin.z *= decay;

        // Obstacle collision (kept from original)
        if (obstacles.length > 0) {
            const r = handleObstacleCollision(position.x, position.y, position.z,
                                              BALL_RADIUS, velocity.x, velocity.z, obstacles);
            if (r.collided) {
                velocity.x = r.velocityX;
                velocity.z = r.velocityZ;
            }
        }

        if (position.y > peakHeight) peakHeight = position.y;

        // Periodic logging
        const dxh = position.x - initialPos.x;
        const dzh = position.z - initialPos.z;
        const horizDist = Math.sqrt(dxh * dxh + dzh * dzh);
        if (PHYSICS_LOG && horizDist - lastLoggedDistance >= LOG_INTERVAL_M) {
            const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
            const hSpeed = Math.sqrt(velocity.x ** 2 + velocity.z ** 2);
            const Re = airDensity * speed * BALL_DIAMETER / AIR_VISCOSITY;
            const oMag = Math.sqrt(spin.x ** 2 + spin.y ** 2 + spin.z ** 2);
            const S = (speed > 0.01) ? (oMag * BALL_R / speed) : 0;
            const Cd = dragCoefficient(Re, S);
            const Cl = liftCoefficient(S);
            const bsRPM = Math.abs(spin.x) * 60 / (2 * Math.PI);
            const ssRPM = Math.abs(spin.y) * 60 / (2 * Math.PI);
            console.log(`\n✈️  FLIGHT @ ${horizDist.toFixed(0)}m:`);
            console.log(`   Speed: ${speed.toFixed(1)} m/s (H: ${hSpeed.toFixed(1)}, V: ${velocity.y.toFixed(1)})`);
            console.log(`   Height: ${position.y.toFixed(1)} m`);
            console.log(`   Backspin: ${bsRPM.toFixed(0)} rpm   Sidespin: ${ssRPM.toFixed(0)} rpm`);
            console.log(`   Re: ${(Re / 1000).toFixed(0)}k  Cd: ${Cd.toFixed(3)}  S: ${S.toFixed(3)}  CL: ${Cl.toFixed(3)}`);
            console.log(`   Wind: ${wind.speed.toFixed(1)} m/s from ${wind.direction}°`);
            lastLoggedDistance = horizDist;
        }

        trajectoryPoints.push({ ...position, time });
        time += dt;
        lastVelocityBeforeLanding = { ...velocity };

        if (time > 20) {
            console.warn("Flight sim exceeded 20s, breaking.");
            break;
        }
    }

    // Landing kinematics
    const landingPosition = trajectoryPoints.length > 1
        ? trajectoryPoints[trajectoryPoints.length - 1]
        : initialPos;
    const finalVel = lastVelocityBeforeLanding;
    const horizMag = Math.sqrt(finalVel.x ** 2 + finalVel.z ** 2);
    const landingAngleRadians = horizMag > 0.01
        ? Math.atan2(Math.abs(finalVel.y), horizMag)
        : Math.PI / 2;

    const dx = landingPosition.x - initialPos.x;
    const dz = landingPosition.z - initialPos.z;
    const carryDistanceMeters = Math.sqrt(dx * dx + dz * dz);

    return {
        landingPosition,
        carryDistance: carryDistanceMeters,
        peakHeight,
        timeOfFlight: time,
        landingAngleRadians,
        landingVelocity: finalVel,
        landingSpinRadPerSec: spin,
        trajectoryPoints,
    };
}


// ============================================================
// BOUNCE PHASE — impulse-based with Coulomb friction
// ============================================================

const MIN_BOUNCE_VY      = 0.4;   // m/s — below this, drop into roll
const BOUNCE_DT          = 0.005; // s — between-bounce ballistic dt
const MAX_BOUNCES        = 8;
const MIN_ROLL_SPEED     = 0.05;

/**
 * Derive an impact friction coefficient for the bounce surface.
 * Uses surface.spinResponse (a "grippiness" knob already present on each surface):
 * firmer / higher-spin-response surfaces grip more during contact.
 */
function impactFrictionFor(surfaceProps) {
    const sr = surfaceProps?.spinResponse ?? 1.0;
    return 0.35 + 0.20 * sr; // GREEN(1.5)=0.65, FAIRWAY(1.0)=0.55, ROUGH(0.5)=0.45, BUNKER(0.4)=0.43
}

/**
 * Apply a single bounce impulse to ball velocity + spin.
 * Returns updated {velocity, spin} (mutating local copies of inputs).
 *
 * Physics:
 *   Normal impulse:    J_n = m (1+e) |v_y|
 *   Slip velocity at contact patch:
 *      v_slip_x = v_x + ω_z R
 *      v_slip_z = v_z - ω_x R
 *   Coulomb limit:     |J_t| ≤ μ J_n
 *   Stick impulse:     J_t_stick = -(2/7) m v_slip   (sphere, I = 2/5 m R^2)
 *   Spin update via torque τ = r × J_t with r = (0, -R, 0).
 */
function bounceImpulse(vel, omega, cor, mu) {
    const Jn = BALL_MASS * (1 + cor) * Math.abs(vel.y);

    // Slip at contact patch
    const sx = vel.x + omega.z * BALL_R;
    const sz = vel.z - omega.x * BALL_R;
    const sMag = Math.sqrt(sx * sx + sz * sz);

    // Tangential impulse: stick if friction allows, else Coulomb slide.
    let Jtx = 0, Jtz = 0;
    if (sMag > 1e-6) {
        const stickMag = (2 / 7) * BALL_MASS * sMag;
        const slideMag = mu * Jn;
        const useMag = Math.min(stickMag, slideMag);
        Jtx = -useMag * (sx / sMag);
        Jtz = -useMag * (sz / sMag);
    }

    // Apply impulses
    const out = {
        velocity: {
            x: vel.x + Jtx / BALL_MASS,
            y: -cor * vel.y,
            z: vel.z + Jtz / BALL_MASS,
        },
        spin: {
            // τ = (0,-R,0) × (Jtx, 0, Jtz) = (-R Jtz, 0, R Jtx); Δω = τ / I
            x: omega.x + (-BALL_R * Jtz) / BALL_I,
            y: omega.y, // y-axis spin (sidespin around vertical) unchanged by horizontal contact
            z: omega.z + ( BALL_R * Jtx) / BALL_I,
        },
    };
    return out;
}

/**
 * Bounce against sloped ground: rotate velocity/spin into the surface frame
 * (normal from the terrain gradient), apply the flat-ground impulse model,
 * rotate back. On flat ground this is exactly bounceImpulse.
 */
function bounceImpulseOnSlope(vel, omega, cor, mu, grad) {
    const slopeSq = grad ? grad.x * grad.x + grad.z * grad.z : 0;
    if (slopeSq < 0.0001) return bounceImpulse(vel, omega, cor, mu);

    const up = new THREE.Vector3(0, 1, 0);
    const n = new THREE.Vector3(-grad.x, 1, -grad.z).normalize();
    const toLocal = new THREE.Quaternion().setFromUnitVectors(n, up);
    const toWorld = toLocal.clone().invert();

    const vL = new THREE.Vector3(vel.x, vel.y, vel.z).applyQuaternion(toLocal);
    const wL = new THREE.Vector3(omega.x, omega.y, omega.z).applyQuaternion(toLocal);
    const r = bounceImpulse(vL, wL, cor, mu);
    const vW = new THREE.Vector3(r.velocity.x, r.velocity.y, r.velocity.z).applyQuaternion(toWorld);
    const wW = new THREE.Vector3(r.spin.x, r.spin.y, r.spin.z).applyQuaternion(toWorld);
    return {
        velocity: { x: vW.x, y: vW.y, z: vW.z },
        spin: { x: wW.x, y: wW.y, z: wW.z },
    };
}

export function simulateBouncePhase(landingPosition, landingVelocity, landingAngleRadians,
                                    spinRadPerSec, surfaceType, startTime = 0, holeLayout = null) {
    const initialSurfaceProps = getSurfaceProperties(surfaceType);
    const initialCoR = initialSurfaceProps?.bounce ?? 0.4;

    // Penalty surface (water / OOB): stop immediately
    if (initialCoR < 0) {
        return {
            position: new THREE.Vector3(landingPosition.x, landingPosition.y, landingPosition.z),
            velocity: new THREE.Vector3(0, 0, 0),
            spin: spinRadPerSec,
            bouncePoints: [{ x: landingPosition.x, y: landingPosition.y, z: landingPosition.z, time: startTime }],
            bounceCount: 0,
            endTime: startTime,
        };
    }

    let position = new THREE.Vector3(landingPosition.x, landingPosition.y, landingPosition.z);
    let velocity = new THREE.Vector3(landingVelocity.x, landingVelocity.y, landingVelocity.z);
    let omega = { ...spinRadPerSec };

    const bouncePoints = [];
    let bounceCount = 0;
    let inAir = false;
    let airTime = 0;
    let time = startTime;
    let currentSurfaceType = surfaceType;

    while (bounceCount < MAX_BOUNCES) {
        if (!inAir) {
            bounceCount++;

            // Dynamic surface detection at this bounce point
            if (holeLayout) {
                const detected = getSurfaceTypeAtPoint({ x: position.x, z: position.z }, holeLayout);
                if (detected) currentSurfaceType = detected;
            }
            const surfaceProps = getSurfaceProperties(currentSurfaceType);
            const cor = surfaceProps?.bounce ?? 0.4;
            if (cor < 0) { // Hit penalty surface during bounce
                velocity.set(0, 0, 0);
                break;
            }
            const mu = impactFrictionFor(surfaceProps);

            // Log pre-impact state
            const impactSpeed = velocity.length();
            const hSpeed = Math.sqrt(velocity.x ** 2 + velocity.z ** 2);
            const bsRPM = Math.abs(omega.x) * 60 / (2 * Math.PI);

            const before = { x: velocity.x, y: velocity.y, z: velocity.z };
            const beforeOmega = { ...omega };

            // Apply impulse
            const r = bounceImpulseOnSlope({ x: velocity.x, y: velocity.y, z: velocity.z }, omega, cor, mu,
                                           contourGradientAt(position.x, position.z));
            velocity.set(r.velocity.x, r.velocity.y, r.velocity.z);
            omega = r.spin;

            const newHSpeed = Math.sqrt(velocity.x ** 2 + velocity.z ** 2);
            const newBsRPM = Math.abs(omega.x) * 60 / (2 * Math.PI);

            if (PHYSICS_LOG) {
                console.log(`\n⚾ BOUNCE #${bounceCount} (${currentSurfaceType}):`);
                console.log(`   Impact: ${impactSpeed.toFixed(2)} m/s  (H: ${hSpeed.toFixed(2)}, V: ${Math.abs(before.y).toFixed(2)})`);
                console.log(`   CoR: ${cor.toFixed(2)}  μ: ${mu.toFixed(2)}`);
                console.log(`   Vy: ${Math.abs(before.y).toFixed(2)} → ${velocity.y.toFixed(2)} m/s`);
                console.log(`   H-speed: ${hSpeed.toFixed(2)} → ${newHSpeed.toFixed(2)} m/s`);
                console.log(`   Backspin: ${bsRPM.toFixed(0)} → ${newBsRPM.toFixed(0)} rpm`);
            }

            // Stop bouncing when upward velocity is too small to lift the ball clear
            if (velocity.y < MIN_BOUNCE_VY) {
                position.y = getBallYPositionForSurface(currentSurfaceType, position.x, position.z);
                bouncePoints.push({ x: position.x, y: position.y, z: position.z, time });
                break;
            }

            position.y = getBallYPositionForSurface(currentSurfaceType, position.x, position.z);
            bouncePoints.push({ x: position.x, y: position.y, z: position.z, time });
            inAir = true;
            airTime = 0;

        } else {
            // Between-bounce ballistic flight (gravity only — Magnus negligible at this scale)
            airTime += BOUNCE_DT;
            velocity.y -= GRAVITY * BOUNCE_DT;
            position.x += velocity.x * BOUNCE_DT;
            position.y += velocity.y * BOUNCE_DT;
            position.z += velocity.z * BOUNCE_DT;
            time += BOUNCE_DT;

            bouncePoints.push({ x: position.x, y: position.y, z: position.z, time });

            const groundY = getBallYPositionForSurface(currentSurfaceType, position.x, position.z);
            if (position.y <= groundY) {
                position.y = groundY;
                inAir = false;
            }
            if (airTime > 2.0) {
                console.warn("Bounce airtime > 2s, forcing landing");
                position.y = groundY;
                inAir = false;
            }
        }

        const speed = velocity.length();
        if (speed < MIN_ROLL_SPEED && !inAir) break;
    }

    return {
        position,
        velocity,
        spin: omega,
        bouncePoints,
        bounceCount,
        endTime: time,
    };
}


// ============================================================
// GROUND ROLL
// ============================================================

const GROUND_DT             = 0.02;
export const HOLE_RADIUS_METERS = 0.108 / 2; // regulation hole (4.25 in)
const MAX_HOLE_ENTRY_SPEED  = 1.5;            // m/s
const SURFACE_CHECK_DIST    = 0.25;           // m

/**
 * Friction coefficient (m/s² of deceleration / g) for rolling on a surface.
 * Uses explicit surface.friction if present, otherwise maps from rollOut with
 * an exponential model calibrated to:
 *   green (rollOut 0.90) → ~0.08
 *   fairway (rollOut 0.50) → ~0.20
 *   thick rough (rollOut 0.15) → ~0.45
 */
function rollingFrictionFor(surfaceProps) {
    // getSurfaceProperties() overwrites the green's hand-set friction (0.08)
    // with a rollOut-derived 0.2, which made greens roll 2.5× too slow. Use
    // the raw value for the green only — other surfaces keep the derived
    // value so full-swing rollout tuning is unaffected.
    if (surfaceProps?.name === SURFACES.GREEN.name && SURFACES.GREEN.friction !== undefined) {
        return SURFACES.GREEN.friction;
    }
    if (surfaceProps?.friction !== undefined) return surfaceProps.friction;
    const rollOut = surfaceProps?.rollOut ?? 0.5;
    return 0.63 * Math.exp(-2.3 * rollOut);
}

/**
 * Ground roll with rolling/sliding friction and gentle lateral curvature from sidespin.
 * Backspin during roll is mostly already shed in the bounce phase; any residual
 * decays here and creates a small extra deceleration while it persists.
 */
export function simulateGroundRoll(initialPosition, initialVelocity, surfaceType,
                                   initialBackspinRPM = 0, initialSideSpinRPM = 0,
                                   startTime = 0, holeLayout = null) {
    let position = initialPosition.clone();
    let velocity = initialVelocity.clone();
    velocity.y = 0;

    const initialHDir = velocity.clone().setY(0).normalize();

    let bsRPM = initialBackspinRPM;
    let ssRPM = initialSideSpinRPM;

    let surfaceProps = getSurfaceProperties(surfaceType);
    if ((surfaceProps?.rollOut ?? 0.5) < 0) {
        // penalty surface
        return {
            finalPosition: initialPosition.clone(),
            isHoledOut: false,
            rollTrajectoryPoints: [{ x: initialPosition.x, y: initialPosition.y, z: initialPosition.z, time: startTime }],
            endTime: startTime,
        };
    }

    position.y = getBallYPositionForSurface(surfaceType, position.x, position.z);

    let mu = rollingFrictionFor(surfaceProps);
    let decel = mu * GRAVITY;

    // Sidespin curvature: lateral acceleration = k * ω_side * v
    // Tuned k so that a 1500 RPM sidespin on a 5 m/s putt curves ~5 cm over 5 m of roll.
    const SIDESPIN_CURVE_K = 0.000012;

    // Residual backspin slightly increases effective friction (still sliding part of the time)
    const BACKSPIN_DRAG_K = 0.000008; // m/s² added per RPM of |backspin|

    // Spin decay during roll: fast on grass, slower on green
    const SPIN_DECAY_PER_S = 1200; // RPM/s

    let time = startTime;
    let totalRolled = 0;
    let lastPos = position.clone();
    let distSinceSurfaceCheck = 0;
    let currentSurface = surfaceType;
    let isHoledOut = false;

    const holePos = getFlagPosition();
    const rollPoints = [];
    let nextLogTime = startTime;
    let hasLoggedFirst = false;

    while (true) {
        const speed = velocity.length();

        if (PHYSICS_LOG && time >= nextLogTime && speed > MIN_ROLL_SPEED) {
            console.log(`\n🏃 ROLL @ ${totalRolled.toFixed(1)}m (${time.toFixed(2)}s):`);
            console.log(`   Surface: ${currentSurface}`);
            console.log(`   Speed: ${speed.toFixed(2)} m/s`);
            console.log(`   Backspin: ${bsRPM.toFixed(0)} rpm   Sidespin: ${ssRPM.toFixed(0)} rpm`);
            console.log(`   μ: ${mu.toFixed(3)}  decel: ${decel.toFixed(3)} m/s²`);
            if (!hasLoggedFirst) { hasLoggedFirst = true; nextLogTime = startTime + 0.5; }
            else nextLogTime += 0.5;
        }

        // Hole check on green
        if (currentSurface === 'GREEN' && holePos) {
            const dx = position.x - holePos.x;
            const dz = position.z - holePos.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < HOLE_RADIUS_METERS && speed < MAX_HOLE_ENTRY_SPEED) {
                isHoledOut = true;
                console.log(`\n⛳ HOLED OUT! distance ${(d * 100).toFixed(1)} cm, speed ${speed.toFixed(2)} m/s`);
                position.set(holePos.x, BALL_RADIUS / 2, holePos.z);
                velocity.set(0, 0, 0);
                break;
            }
        }

        // Slope at the current position (green contour break). The ball may
        // only come to rest where friction can hold it — on a steeper slope
        // it keeps creeping downhill.
        const grad = contourGradientAt(position.x, position.z);
        const slopePullDecel = grad ? GRAVITY * Math.sqrt(grad.x * grad.x + grad.z * grad.z) : 0;

        if (speed < MIN_ROLL_SPEED) {
            if (slopePullDecel <= decel) {
                velocity.set(0, 0, 0);
                break;
            }
            // Too steep to rest: nudge the ball downhill so it keeps rolling
            if (speed < 0.01 && grad) {
                velocity.set(-grad.x, 0, -grad.z).normalize().multiplyScalar(0.02);
            }
        }

        // Spin decay
        if (Math.abs(bsRPM) > 0) {
            const sign = Math.sign(bsRPM);
            bsRPM -= SPIN_DECAY_PER_S * GROUND_DT * sign;
            if (Math.sign(bsRPM) !== sign) bsRPM = 0;
        }
        if (Math.abs(ssRPM) > 0) {
            const sign = Math.sign(ssRPM);
            ssRPM -= SPIN_DECAY_PER_S * GROUND_DT * sign;
            if (Math.sign(ssRPM) !== sign) ssRPM = 0;
        }

        // Build acceleration
        const vDir = velocity.clone().normalize();
        const accel = new THREE.Vector3(0, 0, 0);

        // Friction (kinetic + small spin penalty while backspin remains)
        const effectiveDecel = decel + BACKSPIN_DRAG_K * Math.abs(bsRPM);
        accel.addScaledVector(vDir, -effectiveDecel);

        // Sidespin curvature (perpendicular to current velocity, sign by sidespin direction)
        if (Math.abs(ssRPM) > 50) {
            const lateralDir = vDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0),
                                                          ssRPM > 0 ? -Math.PI / 2 : Math.PI / 2);
            accel.addScaledVector(lateralDir, SIDESPIN_CURVE_K * Math.abs(ssRPM) * speed * GRAVITY);
        }

        // Gravity along the slope: downhill acceleration = -g·∇h (break)
        if (grad && slopePullDecel > 0.001) {
            accel.x += -GRAVITY * grad.x;
            accel.z += -GRAVITY * grad.z;
        }

        // Will the next step over-shoot to a stop? (Only rest where friction holds)
        if (speed <= effectiveDecel * GROUND_DT && slopePullDecel <= decel) {
            velocity.set(0, 0, 0);
        } else {
            velocity.addScaledVector(accel, GROUND_DT);
        }

        // Update position, keep on surface
        position.addScaledVector(velocity, GROUND_DT);
        position.y = getBallYPositionForSurface(currentSurface, position.x, position.z);

        // Distance tracking
        const stepDist = position.distanceTo(lastPos);
        totalRolled += stepDist;
        distSinceSurfaceCheck += stepDist;

        // Surface change detection
        if (distSinceSurfaceCheck >= SURFACE_CHECK_DIST && holeLayout) {
            const detected = getSurfaceTypeAtPoint({ x: position.x, z: position.z }, holeLayout);
            if (detected && detected !== currentSurface) {
                currentSurface = detected;
                surfaceProps = getSurfaceProperties(currentSurface);
                if ((surfaceProps?.rollOut ?? 0.5) < 0) {
                    velocity.set(0, 0, 0);
                    console.log(`Ball entered ${currentSurface}, stopping.`);
                    break;
                }
                mu = rollingFrictionFor(surfaceProps);
                decel = mu * GRAVITY;
            }
            distSinceSurfaceCheck = 0;
        }

        lastPos = position.clone();
        rollPoints.push({ x: position.x, y: position.y, z: position.z, time });
        time += GROUND_DT;

        if (time - startTime > 30) {
            console.warn("Roll sim exceeded 30s, breaking.");
            velocity.set(0, 0, 0);
            break;
        }
    }

    // Final stored position uses the PHYSICAL convention: terrain + ball radius.
    // Display code (showBallAtAddress) adds the surface's ballLieOffset on top —
    // baking it in here double-applied the offset and made the ball pop up
    // after every shot. Roll trajectory points keep their display heights so
    // the animation ends where the resting ball will be shown.
    if (!isHoledOut) {
        const finalProps = getSurfaceProperties(currentSurface);
        if (finalProps?.ballLieOffset === -1) {
            position.y = (finalProps.height ?? 0) - BALL_RADIUS * 2; // Submerged (water)
        } else {
            position.y = queryTerrainHeight(position.x, position.z) + BALL_RADIUS;
        }
    }

    return {
        finalPosition: position,
        isHoledOut,
        rollTrajectoryPoints: rollPoints,
        endTime: time,
    };
}
