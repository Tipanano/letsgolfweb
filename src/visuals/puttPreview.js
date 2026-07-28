// src/visuals/puttPreview.js
//
// Ground marker showing where the current putting tempo would send the ball:
// a ring at the projected stop point plus a soft dispersion ellipse that
// tightens as the player's rhythm steadies.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { scene } from './core.js';
import { heightAt as contourHeightAt, gradientAt as contourGradientAt } from '../greenContours.js';

const MARKER_LIFT = 0.07; // Above the green's layer height (0.06), plus terrain

let group = null;
let ellipseMesh = null;
let ringMesh = null;
let ellipseMaterial = null;
let ringMaterial = null;

function ensureCreated() {
    if (group || !scene) return;

    group = new THREE.Group();
    group.visible = false;
    group.renderOrder = 10;

    // Dispersion ellipse (unit circle, scaled per update)
    const ellipseGeom = new THREE.CircleGeometry(1, 40);
    ellipseGeom.rotateX(-Math.PI / 2);
    ellipseMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        depthTest: false, // Never clipped by sloped terrain
    });
    ellipseMesh = new THREE.Mesh(ellipseGeom, ellipseMaterial);
    ellipseMesh.renderOrder = 10;
    group.add(ellipseMesh);

    // Center ring at the projected stop point
    const ringGeom = new THREE.RingGeometry(0.055, 0.095, 32);
    ringGeom.rotateX(-Math.PI / 2);
    ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false, // Never clipped by sloped terrain
    });
    ringMesh = new THREE.Mesh(ringGeom, ringMaterial);
    ringMesh.position.y = 0.005;
    ringMesh.renderOrder = 11;
    group.add(ringMesh);

    scene.add(group);
}

/**
 * Positions/updates the preview marker.
 * @param {object} opts
 * @param {THREE.Vector3|{x,y,z}} opts.ballPos - Current ball position (meters)
 * @param {number} opts.aimAngleRad - Aim angle from +Z axis (radians)
 * @param {number} opts.distanceMeters - Projected roll distance
 * @param {number} opts.spreadFrac - Dispersion half-length as a fraction of distance
 * @param {boolean} opts.armed - Whether the rhythm has enough taps to strike
 */
export function updatePuttPreview({ ballPos, aimAngleRad, distanceMeters, spreadFrac, armed }) {
    ensureCreated();
    if (!group || !ballPos || !distanceMeters) return;

    const dirX = Math.sin(aimAngleRad);
    const dirZ = Math.cos(aimAngleRad);

    const markerX = ballPos.x + dirX * distanceMeters;
    const markerZ = ballPos.z + dirZ * distanceMeters;
    group.position.set(
        markerX,
        contourHeightAt(markerX, markerZ) + MARKER_LIFT,
        markerZ
    );

    // Aim yaw + tilt to the local terrain slope
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), aimAngleRad);
    const grad = contourGradientAt(markerX, markerZ);
    if (grad) {
        const normal = new THREE.Vector3(-grad.x, 1, -grad.z).normalize();
        const tiltQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        group.quaternion.copy(tiltQ).multiply(yawQ);
    } else {
        group.quaternion.copy(yawQ);
    }

    const semiLength = Math.max(0.25, distanceMeters * spreadFrac);
    const semiWidth = Math.max(0.15, semiLength * 0.35);
    ellipseMesh.scale.set(semiWidth, 1, semiLength);

    const color = armed ? 0x7dffa0 : 0xffffff;
    ellipseMaterial.color.setHex(color);
    ringMaterial.color.setHex(color);

    group.visible = true;
}

export function hidePuttPreview() {
    if (group) group.visible = false;
}
