// src/visuals/wind.js
//
// One wind state, shared by everything that moves: grass tufts, tree canopies
// and the flag.
//
// It's driven by the REAL game wind rather than a decorative constant, which
// makes the scene do double duty — the player can read strength and direction
// off the course itself instead of only off the HUD number. Trees leaning
// downwind past the green tell you as much as "6.2 m/s ↗", and they agree with
// the ball flight because both read the same source.
//
// The uniform objects here are handed directly to every patched shader, so a
// single assignment per frame drives thousands of instances.

// Deliberately imports nothing but three. gameLogic/state.js already imports
// visuals/core.js, so reading the wind from here directly would close an
// import cycle; core.js (which already has a working state.js import) reads it
// and passes it in instead. That also keeps this module purely visual.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';

// Wind speed that corresponds to "full" sway amplitude in the shaders. Above
// this things stop leaning further — real grass lies flat and stays there.
const FULL_SWAY_SPEED = 9.0; // m/s

// Shaders read these. uDir is the horizontal unit vector the wind blows TOWARD
// (game state stores the direction it blows FROM, matching simulation.js).
export const windUniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: 0.45 },
    uWindDir: { value: new THREE.Vector2(0, 1) },
};

// Smoothed so gusts don't snap the whole course sideways; the simulation
// ticks wind at 60Hz and it can move quickly.
let smoothedStrength = 0.45;
let smoothedX = 0;
let smoothedZ = 1;
let lastTime = 0;

// Seconds for the smoothing to cover ~63% of a step. Frame-rate independent:
// a fixed per-frame lerp factor would settle in a third of the time at 144Hz
// that it does at 48Hz, so the course would visibly respond to wind at a
// different speed on different machines.
const WIND_SMOOTH_TAU = 0.35;

/**
 * Advances the shared wind state. Called once per frame from the render loop.
 * @param {number} timeSeconds - monotonic animation clock
 * @param {{speed:number, direction:number}} [wind] - live game wind; direction
 *        is degrees the wind blows FROM, matching gameLogic/simulation.js
 */
export function updateWind(timeSeconds, wind) {
    // Clamped so a background tab resuming (or a long hitch) doesn't jump the
    // whole course to the new wind in a single frame
    const dt = Math.min(0.1, Math.max(0, timeSeconds - lastTime));
    lastTime = timeSeconds;
    windUniforms.uTime.value = timeSeconds;

    if (wind && typeof wind.speed === 'number') {
        const rad = (wind.direction || 0) * Math.PI / 180;
        // Negated: state stores where the wind comes FROM
        const targetX = -Math.sin(rad);
        const targetZ = -Math.cos(rad);
        const targetStrength = Math.min(1, Math.max(0.08, wind.speed / FULL_SWAY_SPEED));

        const k = 1 - Math.exp(-dt / WIND_SMOOTH_TAU);
        smoothedX += (targetX - smoothedX) * k;
        smoothedZ += (targetZ - smoothedZ) * k;
        smoothedStrength += (targetStrength - smoothedStrength) * k;

        const len = Math.hypot(smoothedX, smoothedZ) || 1;
        windUniforms.uWindDir.value.set(smoothedX / len, smoothedZ / len);
        windUniforms.uWindStrength.value = smoothedStrength;
    }
}

/** Current smoothed strength (0–1), for CPU-side animation like the flag. */
export function getWindStrength() {
    return windUniforms.uWindStrength.value;
}

/** Current smoothed direction as {x, z}, the way the wind blows toward. */
export function getWindDirection() {
    const d = windUniforms.uWindDir.value;
    return { x: d.x, z: d.y };
}

/**
 * GLSL injected into a vertex shader's <common> block. Declares the shared
 * uniforms plus swayOffset(), which every wind-driven mesh uses so grass,
 * canopies and anything added later all move to the same gusts.
 *
 *   worldPos  – instance root in world space (drives the phase, so neighbours
 *               are offset rather than moving in lockstep)
 *   lever     – 0 at the anchored end, 1 at the free end. Callers square it or
 *               otherwise shape it to taste before passing it in.
 *   amount    – metres of travel at full lever and full wind
 */
export const WIND_GLSL_COMMON = `
uniform float uTime;
uniform float uWindStrength;
uniform vec2 uWindDir;

// Rotates a WORLD-space direction into the instance's own object space.
//
// This matters more than it looks. three applies instanceMatrix AFTER
// <begin_vertex>, so a world-space vector added to the transformed position
// gets spun by whatever random Y rotation that instance was given — every tree
// and tuft would blow in its own private direction. Projecting onto the
// instance's normalized basis undoes exactly that rotation.
// (No backticks in this block: it lives inside a JS template literal.)
//
// The instance's scale is deliberately NOT divided out: it survives as a
// +/-15% variation in sway amplitude, which is the natural variety we want
// anyway.
vec3 windToLocal(vec3 w) {
    mat3 im = mat3(instanceMatrix);
    return vec3(dot(w, normalize(im[0])), dot(w, normalize(im[1])), dot(w, normalize(im[2])));
}

/**
 * Object-space sway displacement for an instanced, ground-rooted object.
 *   rootWorld – instance origin in world space, drives the gust phase
 *   lever     – 0 anchored, 1 free end (callers shape the ramp)
 *   amount    – metres of travel at full lever and full wind
 */
vec3 windSway(vec3 rootWorld, float lever, float amount) {
    // Travelling wave along the wind direction, so gusts sweep across the
    // course rather than everything pulsing in unison
    float phase = dot(rootWorld.xz, uWindDir) * 0.22 - uTime * 1.5;
    float gust = sin(phase) + 0.4 * sin(phase * 2.3 + 1.7);
    // Steady lean downwind with the gust riding on top: things in real wind
    // don't swing back past vertical on every cycle
    float lean = 0.55 + 0.45 * gust;
    vec3 worldOffset = vec3(uWindDir.x, 0.0, uWindDir.y) * amount * uWindStrength * lever * lean;
    return windToLocal(worldOffset);
}
`;

/** Wires the shared uniforms into a shader being compiled. */
export function bindWindUniforms(shader) {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
}
