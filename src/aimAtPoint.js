// src/aimAtPoint.js
//
// Point-to-aim, shared by touch (double-tap) and mouse (double-click):
// raycast the screen point through the camera onto the real terrain, set
// the absolute target line with the same math as the keyboard's
// aim-at-flag ('h'), and confirm with a ring at the selected spot.

import { camera, ball, scene, applyAimAngleToCamera } from './visuals/core.js';
import { setShotDirectionAngle } from './gameLogic/state.js';
import { updateStatus } from './ui.js';
import { queryTerrainHeight } from './visuals.js';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';

// Confirmation ring at the selected world point — instant feedback that
// the commit landed where the pointer aimed.
let tapMarker = null;
let tapMarkerTimer = null;
function showTapMarker(x, z) {
    if (!scene) return;
    if (!tapMarker) {
        const geom = new THREE.RingGeometry(1.1, 1.6, 40);
        geom.rotateX(-Math.PI / 2);
        tapMarker = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
            color: 0x7dffa0, transparent: true, opacity: 0.85,
            depthTest: false, depthWrite: false, side: THREE.DoubleSide,
        }));
        tapMarker.name = 'AimTapMarker';
        tapMarker.renderOrder = 999;
        scene.add(tapMarker);
    }
    tapMarker.position.set(x, queryTerrainHeight(x, z) + 0.06, z);
    tapMarker.visible = true;
    clearTimeout(tapMarkerTimer);
    tapMarkerTimer = setTimeout(() => { tapMarker.visible = false; }, 2200);
}

/**
 * Sets the aim toward the world point under a screen position.
 * Works from any camera angle, including the fly-over.
 */
export function aimAtScreenPoint(sx, sy) {
    if (!camera || !ball) return;
    const canvas = document.getElementById('golf-canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    let ndcX = ((sx - rect.left) / rect.width) * 2 - 1;
    // The canvas is DISPLAYED horizontally mirrored (style.css scaleX(-1)),
    // so a tap's screen-x is the mirror of the render-space x the raycaster
    // needs. Read the live transform rather than assuming, so this keeps
    // working if the CSS flip is ever removed. (Same fix as measurementView.)
    if (canvas) {
        const tf = getComputedStyle(canvas).transform;
        if (tf && tf !== 'none' && new DOMMatrix(tf).a < 0) ndcX = -ndcX;
    }
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(
        ndcX,
        -((sy - rect.top) / rect.height) * 2 + 1), camera);
    const { origin, direction } = raycaster.ray;

    // March the ray against the real terrain — on uphill/downhill ground a
    // flat-plane intersect selects a laterally displaced point, which reads
    // as a mirrored/wrong aim. Fall back to the ball's plane on no hit.
    let hit = null;
    const above = (t) => {
        const x = origin.x + direction.x * t;
        const z = origin.z + direction.z * t;
        return (origin.y + direction.y * t) - queryTerrainHeight(x, z);
    };
    let tPrev = 1;
    for (let t = 3; t <= 900; t += 3) {
        if (above(t) <= 0) {
            let lo = tPrev, hi = t;
            for (let i = 0; i < 12; i++) {
                const mid = (lo + hi) / 2;
                if (above(mid) <= 0) hi = mid; else lo = mid;
            }
            hit = (lo + hi) / 2;
            break;
        }
        tPrev = t;
    }
    if (hit === null) {
        const tPlane = (ball.position.y - origin.y) / direction.y;
        if (!isFinite(tPlane) || tPlane <= 0) return; // didn't hit the ground
        hit = tPlane;
    }

    const px = origin.x + direction.x * hit;
    const pz = origin.z + direction.z * hit;
    const dx = px - ball.position.x;
    const dz = pz - ball.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 2) return; // tapped/clicked the ball itself
    setShotDirectionAngle(Math.atan2(dx, dz) * (180 / Math.PI));
    applyAimAngleToCamera();
    showTapMarker(px, pz);
    updateStatus(`🎯 Aiming at that spot — ${dist.toFixed(0)} m out`);
}
