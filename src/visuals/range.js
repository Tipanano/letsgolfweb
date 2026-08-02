// src/visuals/range.js
//
// Driving range scene, built from a layout object and rendered through the
// same pipeline as real holes (textured surfaces, noise variation, instanced
// grass, native areas) — plus target greens with pins and distance labels.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { TextureLoader } from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { SURFACES } from '../surfaces.js';
import { renderRoughAreas, renderFairways, renderGreen, renderBunkers, setMowPattern, setBunkerRims, setFringeLayout } from './holeRenderer.js';
import { disposeSceneObject } from './textures.js';
import { buildGrass } from './grass.js';
import { setTerrainFromLayout } from '../greenContours.js';
import { updateEarthTerrain } from './core.js';

let rangeObjects = []; // Everything added to the scene for the range

function circle(cx, cz, radius, segments = 20, wobble = 0.06) {
    const verts = [];
    for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const r = radius * (1 + wobble * Math.sin(a * 3 + radius));
        verts.push({ x: +(cx + Math.cos(a) * r).toFixed(2), z: +(cz + Math.sin(a) * r).toFixed(2) });
    }
    return verts;
}

// Target pins: distance from tee (meters), lateral offset, green radius
const RANGE_TARGETS = [
    { z: 60, x: -5, r: 6 },
    { z: 110, x: 9, r: 7 },
    { z: 160, x: -10, r: 8 },
    { z: 220, x: 6, r: 9 },
    { z: 280, x: 0, r: 10 },
];

function buildRangeLayout() {
    return {
        fairways: [{
            surface: SURFACES.FAIRWAY,
            vertices: [
                { x: -14, z: -6 }, { x: 14, z: -6 },
                { x: 22, z: 40 }, { x: 27, z: 120 }, { x: 26, z: 200 },
                { x: 22, z: 260 }, { x: 18, z: 310 },
                { x: -18, z: 310 }, { x: -22, z: 260 },
                { x: -26, z: 200 }, { x: -27, z: 120 }, { x: -22, z: 40 },
            ],
        }],
        greens: RANGE_TARGETS.map(t => ({
            surface: SURFACES.GREEN,
            vertices: circle(t.x, t.z, t.r),
        })),
        bunkers: [
            { type: 'polygon', surface: SURFACES.BUNKER, vertices: circle(16, 104, 4, 16, 0.1) },
            { type: 'polygon', surface: SURFACES.BUNKER, vertices: circle(-18, 166, 4.5, 16, 0.1) },
            { type: 'polygon', surface: SURFACES.BUNKER, vertices: circle(14, 226, 5, 16, 0.1) },
        ],
        lightRough: [{
            surface: SURFACES.LIGHT_ROUGH,
            vertices: [
                { x: -90, z: -25 }, { x: 90, z: -25 },
                { x: 90, z: 350 }, { x: -90, z: 350 },
            ],
        }],
        nativeAreas: [
            { surface: SURFACES.NATIVE_AREA, vertices: circle(52, 85, 13, 16, 0.18) },
            { surface: SURFACES.NATIVE_AREA, vertices: circle(-55, 130, 16, 16, 0.18) },
            { surface: SURFACES.NATIVE_AREA, vertices: circle(60, 210, 17, 16, 0.18) },
            { surface: SURFACES.NATIVE_AREA, vertices: circle(-62, 275, 14, 16, 0.18) },
        ],
        // Gentle rolling ground so the range reads as a landscape
        terrainFeatures: [
            { type: 'bump', x: -34, z: 150, radius: 26, height: 1.1 },
            { type: 'bump', x: 40, z: 245, radius: 30, height: 1.5 },
            { type: 'valley', x: 6, z: 185, angle: 0.45, length: 60, width: 18, height: -0.7 },
            { type: 'ridge', x: -48, z: 255, angle: -0.5, length: 55, width: 16, height: 0.9 },
        ],
    };
}

/** White pin with a red flag and a floating distance label. */
function createTargetPin(scene, x, z, distanceMeters) {
    const group = new THREE.Group();

    const poleH = 2.6;
    const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, poleH, 8),
        new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    pole.position.y = poleH / 2;
    pole.castShadow = true;
    group.add(pole);

    const cloth = new THREE.Mesh(
        new THREE.PlaneGeometry(0.55, 0.35),
        new THREE.MeshBasicMaterial({ color: 0xd93a2b, side: THREE.DoubleSide }) // Unlit: red from every angle
    );
    cloth.position.set(0.28, poleH - 0.22, 0);
    group.add(cloth);

    // Distance label sprite (canvas texture)
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    // Sprites render this texture mirrored — pre-flip so the text reads right
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.font = 'bold 40px "Open Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(20, 35, 26, 0.9)';
    ctx.strokeText(`${distanceMeters}m`, 64, 32);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${distanceMeters}m`, 64, 32);
    const labelTex = new THREE.CanvasTexture(canvas);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true }));
    label.scale.set(4.5, 2.25, 1);
    label.position.y = poleH + 1.3;
    group.add(label);

    group.position.set(x, 0, z);
    scene.add(group);
    rangeObjects.push(group);
}

export function initRangeVisuals(scene) {
    removeRangeVisuals(scene); // Safety: never double-build

    const layout = buildRangeLayout();
    setTerrainFromLayout(layout); // Bunker bowls on the range too
    updateEarthTerrain();
    const textureLoader = new TextureLoader();

    setMowPattern(7); // Fixed mow direction — the range is always the same place
    setBunkerRims(layout.bunkers);
    setFringeLayout(layout);

    renderRoughAreas(layout, scene, textureLoader, rangeObjects);
    renderBunkers(layout, scene, textureLoader, rangeObjects);
    renderFairways(layout, scene, textureLoader, rangeObjects);
    renderGreen(layout, scene, textureLoader, rangeObjects);
    buildGrass(layout, scene, rangeObjects);

    RANGE_TARGETS.forEach(t => createTargetPin(scene, t.x, t.z, t.z));
}

export function removeRangeVisuals(scene) {
    for (const obj of rangeObjects) {
        scene.remove(obj);
        // Frees geometry and per-object materials/maps, but skips anything
        // owned by the shared surface registry — those outlive every mode.
        disposeSceneObject(obj);
    }
    rangeObjects = [];
}
