// src/visuals/slopeOverlay.js
//
// Green-reading overlay: a grid of small chevron arrows across the contoured
// green, each pointing downhill, colored by steepness (green = gentle,
// yellow = moderate, red = steep). Toggled with 'g'. Built once per hole from
// the analytic contour field.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { scene } from './core.js';
import { heightAt, gradientAt, hasContour } from '../greenContours.js';

const GRID_SPACING = 1.0;     // m between arrows — tight grid for exact reads
const MIN_SLOPE = 0.006;      // Hide arrows on effectively flat spots (0.6%)
const STEEP_SLOPE = 0.06;     // Fully red at 6%
const ARROW_LEN = 0.38;       // m
const ARROW_HALF_W = 0.09;    // m
const LIFT = 0.075;           // Above the green's render layer (0.06)
// Flow animation: every chevron glides downhill and loops with a fade —
// the direction is readable at a glance and speed encodes steepness.
const FLOW_TRAVEL_M = 1.0;    // glide distance per cycle (≈ one grid cell)
const FLOW_SPEED_BASE = 0.35; // cycles/s on the gentlest visible slope
const FLOW_SPEED_SLOPE = 10;  // + cycles/s per unit of slope (6% → +0.6)

let overlayMesh = null;
let overlayVisible = false;
let flowUniforms = null;
let flowRafId = null;

function driveFlow() {
    if (!overlayMesh || !overlayVisible || !flowUniforms) { flowRafId = null; return; }
    flowUniforms.uTime.value = performance.now() / 1000;
    flowRafId = requestAnimationFrame(driveFlow);
}

export function disposeSlopeOverlay() {
    if (flowRafId) { cancelAnimationFrame(flowRafId); flowRafId = null; }
    flowUniforms = null;
    if (overlayMesh) {
        scene?.remove(overlayMesh);
        overlayMesh.geometry.dispose();
        overlayMesh.material.dispose();
        overlayMesh = null;
    }
    overlayVisible = false;
}

/**
 * Builds the overlay for the active contour, centered on the given region
 * (usually the green center + radius). Hidden until toggled on.
 */
export function buildSlopeOverlay(centerX, centerZ, radius) {
    disposeSlopeOverlay();
    if (!scene || !hasContour()) return;

    const positions = [];
    const colors = [];
    const dirs = [];    // downhill unit direction per vertex (for the glide)
    const speeds = [];  // flow cycles/s per vertex (steeper = faster)
    const phases = [];  // random per-arrow phase so the field shimmers
    // Saturated ramp — the pale palette washed out against the green
    const colGentle = new THREE.Color(0x35e08a);
    const colModerate = new THREE.Color(0xffc94d);
    const colSteep = new THREE.Color(0xff5645);

    for (let x = centerX - radius; x <= centerX + radius; x += GRID_SPACING) {
        for (let z = centerZ - radius; z <= centerZ + radius; z += GRID_SPACING) {
            const dx = x - centerX, dz = z - centerZ;
            if (dx * dx + dz * dz > radius * radius) continue;

            const grad = gradientAt(x, z);
            if (!grad) continue;
            const slope = Math.sqrt(grad.x * grad.x + grad.z * grad.z);
            if (slope < MIN_SLOPE) continue;

            // Downhill unit direction
            const dirX = -grad.x / slope;
            const dirZ = -grad.z / slope;
            // Perpendicular (for arrow width)
            const perpX = -dirZ, perpZ = dirX;

            // Chevron: tip downhill, two tail corners uphill
            const tipX = x + dirX * ARROW_LEN * 0.5;
            const tipZ = z + dirZ * ARROW_LEN * 0.5;
            const tailX = x - dirX * ARROW_LEN * 0.5;
            const tailZ = z - dirZ * ARROW_LEN * 0.5;

            positions.push(
                tipX, heightAt(tipX, tipZ) + LIFT, tipZ,
                tailX + perpX * ARROW_HALF_W, heightAt(tailX, tailZ) + LIFT, tailZ + perpZ * ARROW_HALF_W,
                tailX - perpX * ARROW_HALF_W, heightAt(tailX, tailZ) + LIFT, tailZ - perpZ * ARROW_HALF_W
            );

            // Steepness color (two-stop ramp)
            const t = Math.min(1, slope / STEEP_SLOPE);
            const c = t < 0.5
                ? colGentle.clone().lerp(colModerate, t * 2)
                : colModerate.clone().lerp(colSteep, (t - 0.5) * 2);
            const speed = FLOW_SPEED_BASE + slope * FLOW_SPEED_SLOPE;
            const phase = Math.random();
            for (let k = 0; k < 3; k++) {
                colors.push(c.r, c.g, c.b);
                dirs.push(dirX, dirZ);
                speeds.push(speed);
                phases.push(phase);
            }
        }
    }

    if (positions.length === 0) return;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.setAttribute('aDir', new THREE.Float32BufferAttribute(dirs, 2));
    geom.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speeds, 1));
    geom.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));

    const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    const uniforms = { uTime: { value: 0 } };
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uniforms.uTime;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
                uniform float uTime;
                attribute vec2 aDir;
                attribute float aSpeed;
                attribute float aPhase;
                varying float vFlowFade;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                float flowT = fract(uTime * aSpeed + aPhase);
                transformed.x += aDir.x * (flowT - 0.5) * ${FLOW_TRAVEL_M.toFixed(3)};
                transformed.z += aDir.y * (flowT - 0.5) * ${FLOW_TRAVEL_M.toFixed(3)};
                vFlowFade = 1.0 - abs(flowT * 2.0 - 1.0);`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                varying float vFlowFade;`)
            .replace('#include <dithering_fragment>', `#include <dithering_fragment>
                gl_FragColor.a *= 0.35 + 0.65 * vFlowFade;`);
    };

    overlayMesh = new THREE.Mesh(geom, mat);
    overlayMesh.renderOrder = 6;
    overlayMesh.visible = overlayVisible;
    scene.add(overlayMesh);
    flowUniforms = uniforms;
    if (overlayVisible && !flowRafId) flowRafId = requestAnimationFrame(driveFlow);
}

export function toggleSlopeOverlay() {
    overlayVisible = !overlayVisible;
    if (overlayMesh) overlayMesh.visible = overlayVisible;
    if (overlayVisible && !flowRafId && flowUniforms) flowRafId = requestAnimationFrame(driveFlow);
    return overlayVisible;
}

export function isSlopeOverlayVisible() {
    return overlayVisible;
}
