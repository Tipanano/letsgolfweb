// src/visuals/flagstick.js
//
// The flagstick and hole cup.
//
// The old flag was a static PlaneGeometry offset 0.25m in +X from the pole,
// with an unlit MeshBasicMaterial. Three problems, all visible on every shot:
// viewed from roughly half the compass it was edge-on and vanished entirely;
// being unlit it never responded to the sun and read as a flat red sticker;
// and it didn't touch the pole. The cup was a black cylinder with a renderOrder
// hack, which read as a sticker on the green rather than a hole in it.
//
// Everything here is a few hundred triangles and three draw calls, on the one
// object the player looks at every single time they play a shot.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { gradientAt as contourGradientAt } from '../greenContours.js';

const UP = new THREE.Vector3(0, 1, 0);
// Vertex colours are consumed as linear, so convert once from the sRGB value
const FLAG_RED = new THREE.Color(0xe03a2c);

const POLE_HEIGHT = 2.5;
const POLE_RADIUS = 0.017;   // Real flagsticks are ~14mm; the old 0.05 was a mast
const BAND_COUNT = 6;        // Alternating stripes — a real distance cue, not decor
const CLOTH_W = 0.46;
const CLOTH_H = 0.30;
const CLOTH_SEGS = 6;        // Enough to carry a wave without being wasteful

const HOLE_RADIUS = 0.108 / 2; // Regulation 4.25in diameter
const CUP_DEPTH = 0.102;       // Regulation minimum depth

/**
 * Striped pole, built as one geometry from alternating band cylinders so the
 * whole stick is a single draw call. Origin at the ground.
 */
function createPoleGeometry() {
    const bandH = POLE_HEIGHT / BAND_COUNT;
    const parts = [];
    for (let i = 0; i < BAND_COUNT; i++) {
        const g = new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, bandH, 8, 1, true);
        g.translate(0, bandH * (i + 0.5), 0);
        // CylinderGeometry is INDEXED. Concatenating raw position attributes
        // without the index buffer loses the triangles entirely (the result
        // renders as nothing), so flatten to a triangle soup first.
        parts.push(g.toNonIndexed());
        g.dispose();
    }
    // Merge by hand — no BufferGeometryUtils import needed for this shape
    let total = 0;
    for (const g of parts) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const white = new THREE.Color(0xffffff);
    const red = new THREE.Color(0xd8342c);
    let o = 0;
    parts.forEach((g, i) => {
        const p = g.attributes.position, n = g.attributes.normal;
        const c = (i % 2) ? red : white;
        for (let v = 0; v < p.count; v++) {
            pos[(o + v) * 3] = p.getX(v); pos[(o + v) * 3 + 1] = p.getY(v); pos[(o + v) * 3 + 2] = p.getZ(v);
            nrm[(o + v) * 3] = n.getX(v); nrm[(o + v) * 3 + 1] = n.getY(v); nrm[(o + v) * 3 + 2] = n.getZ(v);
            col[(o + v) * 3] = c.r; col[(o + v) * 3 + 1] = c.g; col[(o + v) * 3 + 2] = c.b;
        }
        o += p.count;
        g.dispose();
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.computeBoundingSphere();
    return geom;
}

/**
 * Flag cloth: a grid rooted at the pole (x = 0) and free at the fly end, so
 * the wave amplitude can grow along its length. Built in local space; the
 * whole mesh yaws to face the camera each frame.
 */
function createClothGeometry() {
    const geom = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, CLOTH_SEGS, 2);
    // Shift so x = 0 is the hoist (attached) edge rather than the centre
    geom.translate(CLOTH_W / 2, 0, 0);
    return geom;
}

let poleMesh = null;
let finialMesh = null;
let clothMesh = null;
let cupGroup = null;
let haloMesh = null; // hole marker ring, shown while the flagstick is pulled
let clothBasePositions = null;

/**
 * Builds the flagstick, cloth and cup at a position.
 * @returns {{objects: THREE.Object3D[]}} everything added, for hole cleanup
 */
export function buildFlagstick(scene, x, groundY, z) {
    const objects = [];

    // --- Pole ---
    poleMesh = new THREE.Mesh(
        createPoleGeometry(),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.0 })
    );
    poleMesh.name = 'FlagstickPole';
    poleMesh.position.set(x, groundY, z);
    poleMesh.castShadow = true;
    scene.add(poleMesh);
    objects.push(poleMesh);

    // --- Finial (the little cap real sticks have) ---
    finialMesh = new THREE.Mesh(
        new THREE.SphereGeometry(POLE_RADIUS * 2.0, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.5 })
    );
    finialMesh.position.set(x, groundY + POLE_HEIGHT, z);
    finialMesh.castShadow = true;
    scene.add(finialMesh);
    objects.push(finialMesh);

    // --- Cloth ---
    const clothGeom = createClothGeometry();
    clothBasePositions = clothGeom.attributes.position.array.slice();
    clothGeom.setAttribute('color',
        new THREE.BufferAttribute(new Float32Array(clothGeom.attributes.position.count * 3), 3));
    // Unlit on purpose. The cloth billboards to the camera, so its normal
    // almost never points at the sun — under a lit material it sat in its own
    // shadow from most angles and went near-black. The pin is the player's
    // aiming reference and has to stay vivid from everywhere, so the shading
    // comes from the wave itself instead of the light (see updateFlagstick).
    clothMesh = new THREE.Mesh(clothGeom, new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide, // A flag is visible from both faces
    }));
    clothMesh.name = 'FlagCloth';
    // Flush against the pole, just under the finial
    clothMesh.position.set(x + POLE_RADIUS, groundY + POLE_HEIGHT - CLOTH_H / 2 - 0.06, z);
    clothMesh.castShadow = true;
    scene.add(clothMesh);
    objects.push(clothMesh);

    // --- Cup ---
    cupGroup = buildCup(x, groundY, z);
    scene.add(cupGroup);
    objects.push(cupGroup);

    return { objects };
}

/**
 * The hole itself: a white liner ring at the rim, a dark shaft, and a floor.
 * Real depth instead of a flat black disc, so it reads as a hole in the green.
 */
function buildCup(x, groundY, z) {
    const group = new THREE.Group();
    group.name = 'HoleCup';

    // Built around the origin, then placed and TILTED to the green's local
    // slope. A flat cup on a contoured green half-sinks below the surface —
    // the same reason the ball halo tracks the gradient (see core.js).
    const inner = HOLE_RADIUS * 0.86;

    // White liner ring at the lip. Sits a shade proud of the mown surface so
    // it reads as a rim; this replaces the old renderOrder hack, which was
    // fragile against the cm-scale surface layer stack.
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(inner, HOLE_RADIUS * 1.06, 24),
        new THREE.MeshBasicMaterial({ color: 0xececea, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    group.add(ring);

    // Shaft: open cylinder seen from the inside, so the hole has real depth
    const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(inner, inner, CUP_DEPTH, 24, 1, true),
        new THREE.MeshLambertMaterial({ color: 0x25281f, side: THREE.BackSide })
    );
    shaft.position.y = 0.003 - CUP_DEPTH / 2;
    group.add(shaft);

    // Floor, so you never see through the green
    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(inner, 24),
        new THREE.MeshBasicMaterial({ color: 0x0d0f0c })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.003 - CUP_DEPTH;
    group.add(floor);

    // Hole halo: a wide white ring shown while the flagstick is PULLED (ball
    // on the green) — a 10.8 cm cup is invisible from 15 m, especially under
    // the slope-arrow overlay. Rendered above the arrows (their renderOrder
    // is 6) and lifted past their 0.075 m float so it always reads.
    haloMesh = new THREE.Mesh(
        new THREE.RingGeometry(HOLE_RADIUS * 2.6, HOLE_RADIUS * 4.4, 40),
        new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.8,
            side: THREE.DoubleSide, depthWrite: false,
        })
    );
    haloMesh.rotation.x = -Math.PI / 2;
    haloMesh.position.y = 0.08;
    haloMesh.renderOrder = 7;
    haloMesh.visible = false; // flag starts in the cup
    group.add(haloMesh);

    // GREEN surface layer height from surfaces.js, plus clearance
    group.position.set(x, groundY + 0.061, z);

    const grad = contourGradientAt(x, z);
    if (grad) {
        const normal = new THREE.Vector3(-grad.x, 1, -grad.z).normalize();
        group.quaternion.setFromUnitVectors(UP, normal);
    }

    return group;
}

/**
 * Per-frame: yaw the cloth to face the camera and run the wave.
 *
 * Billboarding is what stops the flag disappearing edge-on, which the old
 * fixed +X plane did from about half of all viewing angles. The wave is a
 * couple of sine terms on a 21-vertex grid — the cost is noise.
 */
export function updateFlagstick(camera, timeSeconds, windStrength = 0.5) {
    if (!clothMesh || !camera) return;

    // Face the camera about Y only; the cloth stays vertical.
    // The cloth is a PlaneGeometry, so its face normal is local +Z and its
    // length runs along local +X. Pointing +Z at the camera therefore puts the
    // flag broadside — no additional quarter turn, which would stand it
    // edge-on, exactly the failure the billboard exists to prevent.
    const dx = camera.position.x - clothMesh.position.x;
    const dz = camera.position.z - clothMesh.position.z;
    clothMesh.rotation.y = Math.atan2(dx, dz);

    const pos = clothMesh.geometry.attributes.position;
    const col = clothMesh.geometry.attributes.color;
    const base = clothBasePositions;

    // windStrength is the shared 0–1 wind scalar. The flag is the most-watched
    // object on the course, so it doubles as a wind gauge: limp and drooping
    // in light air, stretched flat and snapping in a gale. That reads at a
    // glance and agrees with the HUD number and the ball flight, because all
    // three come from the same wind state.
    const amp = 0.02 + windStrength * 0.075;
    const speed = 2.6 + windStrength * 4.5;
    const droop = 0.11 * (1 - windStrength); // Hangs when there's nothing to hold it
    const furl = 0.28 * (1 - windStrength);  // Fly end curls in toward the pole

    for (let i = 0; i < pos.count; i++) {
        const bx = base[i * 3], by = base[i * 3 + 1];
        // Amplitude ramps from 0 at the hoist to full at the fly end
        const t = bx / CLOTH_W;
        const phase = bx * 6.5 - timeSeconds * speed;
        const wave = Math.sin(phase) + 0.35 * Math.sin(by * 7 + timeSeconds * speed * 0.62);
        pos.setX(i, bx * (1 - furl * t));
        pos.setZ(i, wave * amp * t * t);
        pos.setY(i, by - (0.02 + droop) * t * t);

        // Fold shading: the wave's slope stands in for how much each band of
        // cloth turns away from the viewer. Keeps the flag reading as fabric
        // with folds rather than a flat red rectangle.
        const shade = 0.78 + 0.22 * Math.cos(phase);
        col.setXYZ(i, FLAG_RED.r * shade, FLAG_RED.g * shade, FLAG_RED.b * shade);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
}

/** Show/hide pole, finial and cloth (cup stays — it's the target). */
export function setFlagstickVisible(visible) {
    if (poleMesh) poleMesh.visible = visible;
    if (finialMesh) finialMesh.visible = visible;
    if (clothMesh) clothMesh.visible = visible;
    // Flag out = halo on: the cup must stay findable without the stick
    if (haloMesh) haloMesh.visible = !visible;
}

/** Drops module references; the caller disposes the objects it was handed. */
export function resetFlagstick() {
    poleMesh = null;
    finialMesh = null;
    clothMesh = null;
    cupGroup = null;
    haloMesh = null;
    clothBasePositions = null;
}
