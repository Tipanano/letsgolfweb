// src/visuals/slopeOverlay.js
//
// Green-reading overlay: a grid of small chevron arrows across the contoured
// green, each pointing downhill, colored by steepness (green = gentle,
// yellow = moderate, red = steep). Toggled with 'g'. Built once per hole from
// the analytic contour field.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { scene } from './core.js';
import { heightAt, gradientAt, hasContour } from '../greenContours.js';

const GRID_SPACING = 1.6;     // m between arrows
const MIN_SLOPE = 0.006;      // Hide arrows on effectively flat spots (0.6%)
const STEEP_SLOPE = 0.06;     // Fully red at 6%
const ARROW_LEN = 0.55;       // m
const ARROW_HALF_W = 0.13;    // m
const LIFT = 0.075;           // Above the green's render layer (0.06)

let overlayMesh = null;
let overlayVisible = false;

export function disposeSlopeOverlay() {
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
    const colGentle = new THREE.Color(0x9fdcae);
    const colModerate = new THREE.Color(0xffd76a);
    const colSteep = new THREE.Color(0xff7a6a);

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

            const y = heightAt(x, z) + LIFT;
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
            for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
        }
    }

    if (positions.length === 0) return;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
    });

    overlayMesh = new THREE.Mesh(geom, mat);
    overlayMesh.renderOrder = 6;
    overlayMesh.visible = overlayVisible;
    scene.add(overlayMesh);
}

export function toggleSlopeOverlay() {
    overlayVisible = !overlayVisible;
    if (overlayMesh) overlayMesh.visible = overlayVisible;
    return overlayVisible;
}

export function isSlopeOverlayVisible() {
    return overlayVisible;
}
