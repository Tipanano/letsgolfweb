// src/visuals/obstacles.js
//
// Trees and bushes, drawn with instancing.
//
// These used to be one THREE.Group of two Meshes per obstacle, each with its
// own freshly allocated geometry AND material. Augusta's first hole carries
// 137 obstacles, so that was ~274 draw calls, 274 geometries and 274
// materials for a hole whose entire ground surface is a dozen meshes — around
// 90% of the scene's draw calls went to scenery.
//
// There are only six obstacle variants (tree/bush x small/medium/large), so
// everything collapses onto a handful of InstancedMeshes. That reclaimed
// budget is what pays for the trees actually looking like trees: a three-tier
// canopy instead of a single cone, per-instance colour/rotation/scale
// variation so 137 of them aren't visibly clones, and real shadows.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { OBSTACLE_TYPES } from '../obstacleConfig.js';
import { queryTerrainHeight } from '../visuals.js'; // For terrain-aware placement
import { WIND_GLSL_COMMON, bindWindUniforms } from './wind.js';

// Canopy tiers as fractions of the foliage span: bottom is widest and
// shortest, top is narrowest and tallest. Overlapping them slightly hides the
// seam where one cone's base meets the next.
const CANOPY_TIERS = [
    { yStart: 0.00, height: 0.46, radius: 1.00 },
    { yStart: 0.34, height: 0.42, radius: 0.74 },
    { yStart: 0.64, height: 0.40, radius: 0.46 },
];

const RADIAL_SEGMENTS = 7; // Odd count breaks up the mirror symmetry

/**
 * A whole conifer canopy as ONE geometry, origin at the base of the foliage.
 * Merging the tiers here (rather than instancing each tier separately) keeps
 * a tree to a single canopy draw call no matter how many tiers it has.
 */
function createCanopyGeometry(foliageRadius, foliageHeight) {
    const positions = [];
    const normals = [];

    for (const tier of CANOPY_TIERS) {
        const r = foliageRadius * tier.radius;
        const h = foliageHeight * tier.height;
        const baseY = foliageHeight * tier.yStart;
        const tipY = baseY + h;

        for (let i = 0; i < RADIAL_SEGMENTS; i++) {
            const a0 = (i / RADIAL_SEGMENTS) * Math.PI * 2;
            const a1 = ((i + 1) / RADIAL_SEGMENTS) * Math.PI * 2;
            const c0 = Math.cos(a0), s0 = Math.sin(a0);
            const c1 = Math.cos(a1), s1 = Math.sin(a1);
            const am = (a0 + a1) / 2;

            // Cone wall. The outward normal of a cone with base radius r and
            // height h is (cos a * h, r, sin a * h) normalized — flat per face,
            // which gives the faceted read a low-poly conifer wants.
            positions.push(c0 * r, baseY, s0 * r, c1 * r, baseY, s1 * r, 0, tipY, 0);
            const nx = Math.cos(am) * h, ny = r, nz = Math.sin(am) * h;
            const nl = Math.hypot(nx, ny, nz) || 1;
            for (let k = 0; k < 3; k++) normals.push(nx / nl, ny / nl, nz / nl);

            // Underside skirt, so the canopy isn't hollow when seen from below
            positions.push(c1 * r, baseY, s1 * r, c0 * r, baseY, s0 * r, 0, baseY, 0);
            for (let k = 0; k < 3; k++) normals.push(0, -1, 0);
        }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geom.computeBoundingSphere();
    return geom;
}

/** Tapered trunk, origin at the ground. */
function createTrunkGeometry(radius, height) {
    const geom = new THREE.CylinderGeometry(radius * 0.72, radius, height, 6);
    geom.translate(0, height / 2, 0);
    return geom;
}

/** Squashed sphere for a bush, origin at the ground. */
function createBushGeometry(radius, height) {
    const geom = new THREE.SphereGeometry(radius, 9, 6);
    geom.scale(1, height / (radius * 2), 1);
    geom.translate(0, height / 2, 0);
    return geom;
}

// Foliage palette. The configured colour (0x2d5016) is so dark it rendered as
// a black silhouette against the sky; these are the same hue family opened up
// into a range, and each instance picks one so a stand of trees has depth.
const FOLIAGE_TINTS = [0x4f7a3a, 0x5c8a42, 0x446b33, 0x638f4a, 0x3d6330];
const TRUNK_TINTS = [0x6b5138, 0x5c452f, 0x7a5d42];

/** Deterministic per-instance jitter so a hole looks the same on every load. */
function hashRandom(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

/**
 * Wind sway for one part of a tree, driven by the shared gust field.
 *
 * A tree is not a blade of grass: the trunk is stiff and the crown is not, so
 * the lever is a CUBIC of height — barely any motion low down, most of it in
 * the top third. A whole tree rocking rigidly from the roots reads as an
 * earthquake, not weather.
 *
 * The lever is measured from the ground, not from the part's own origin, and
 * both trunk and canopy pass the same treeHeight. That continuity is what
 * keeps the crown attached: at the trunk's top and the canopy's base the two
 * parts evaluate the identical lever, so they displace by the identical amount
 * and the seam never opens. Using each part's local height instead would tear
 * the canopy off the trunk the moment the wind blew.
 *
 * @param {number} amount     metres of crown travel at full wind
 * @param {number} treeHeight full height of the tree — the lever's reference
 * @param {number} yBase      this part's origin height above the tree's base
 * @param {number} flutter    extra high-frequency tip motion (0 = none)
 */
function applyTreeWind(material, amount, treeHeight, yBase, flutter = 0) {
    material.onBeforeCompile = (shader) => {
        bindWindUniforms(shader);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${WIND_GLSL_COMMON}`)
            .replace('#include <begin_vertex>', `
                #include <begin_vertex>
                vec4 rootWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                // Height above the TREE's base, not this part's origin
                float h = (${yBase.toFixed(3)} + position.y) / ${treeHeight.toFixed(3)};
                float lever = clamp(h, 0.0, 1.0);
                lever = lever * lever * lever;
                transformed += windSway(rootWorld.xyz, lever, ${amount.toFixed(3)});
                ${flutter > 0 ? `
                // Individual boughs shivering out of phase with the trunk's lean
                float fl = sin(uTime * 3.9 + rootWorld.x * 1.7 + position.y * 2.4)
                         + sin(uTime * 5.3 + rootWorld.z * 2.1);
                transformed += windToLocal(vec3(fl, 0.0, fl * 0.7))
                             * ${flutter.toFixed(4)} * uWindStrength * lever;
                ` : ''}
            `);
    };
    // Without a distinct key three reuses one compiled program for every variant
    material.customProgramCacheKey = () =>
        `tree_${amount.toFixed(3)}_${treeHeight.toFixed(3)}_${yBase.toFixed(3)}_${flutter.toFixed(4)}`;
}

let obstacleGroup = null;

/**
 * Builds the instanced meshes for a hole's obstacles.
 * @param {THREE.Scene} scene
 * @param {Array} obstacles - full obstacle objects (type, size, x, z, + props)
 */
export function renderObstacles(scene, obstacles) {
    clearObstacles(scene);

    obstacleGroup = new THREE.Group();
    obstacleGroup.name = 'obstacles';

    // Bucket by variant so each becomes one InstancedMesh
    const buckets = new Map();
    for (const o of obstacles) {
        const key = `${o.type}|${o.size}`;
        let bucket = buckets.get(key);
        if (!bucket) { bucket = { props: o, items: [] }; buckets.set(key, bucket); }
        bucket.items.push(o);
    }

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let seed = 1;

    for (const [key, { props, items }] of buckets) {
        const isTree = props.type === OBSTACLE_TYPES.TREE;

        // One material per variant part, shared by every instance of it
        const foliageMat = new THREE.MeshLambertMaterial({ vertexColors: false });
        const parts = [];

        if (isTree) {
            const foliageHeight = Math.max(0.5, props.height - props.trunkHeight);
            // Sway scales with the tree's size — a 20m pine's crown travels a
            // long way further than a 9m one's, and both beat a bush.
            const canopySway = 0.06 * props.height;
            // Both parts share amount AND treeHeight; only yBase differs, which
            // is what makes the trunk top and canopy base move together.
            applyTreeWind(foliageMat, canopySway, props.height, props.trunkHeight,
                          0.004 * props.height);
            parts.push({
                geom: createCanopyGeometry(props.foliageRadius, foliageHeight),
                mat: foliageMat,
                yOffset: props.trunkHeight,
                tints: FOLIAGE_TINTS,
                name: `canopy_${key}`,
            });

            const trunkMat = new THREE.MeshLambertMaterial();
            applyTreeWind(trunkMat, canopySway, props.height, 0);
            parts.push({
                geom: createTrunkGeometry(props.trunkRadius, props.trunkHeight),
                mat: trunkMat,
                yOffset: 0,
                tints: TRUNK_TINTS,
                name: `trunk_${key}`,
            });
        } else {
            // Bushes are low and dense — a gentle shiver, no real lean
            applyTreeWind(foliageMat, 0.035 * props.height, props.height, 0, 0.01);
            parts.push({
                geom: createBushGeometry(props.radius, props.height),
                mat: foliageMat,
                yOffset: 0,
                tints: FOLIAGE_TINTS,
                name: `bush_${key}`,
            });
        }

        for (const part of parts) {
            const mesh = new THREE.InstancedMesh(part.geom, part.mat, items.length);
            mesh.name = part.name;
            mesh.castShadow = true;      // Trees cast no shadow before this; they
            mesh.receiveShadow = true;   // looked pasted on rather than planted
            mesh.frustumCulled = true;

            items.forEach((o, i) => {
                const s = seed + i * 7;
                const rot = hashRandom(s) * Math.PI * 2;
                // +/-15% non-uniform scale, so no two read as the same model
                const sx = 0.85 + hashRandom(s + 1) * 0.3;
                const sy = 0.85 + hashRandom(s + 2) * 0.3;
                dummy.position.set(o.x, queryTerrainHeight(o.x, o.z) + part.yOffset * sy, o.z);
                dummy.rotation.set(0, rot, 0);
                dummy.scale.set(sx, sy, sx);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);

                const tint = part.tints[(hashRandom(s + 3) * part.tints.length) | 0];
                // Slight per-instance brightness on top of the palette pick
                color.setHex(tint).multiplyScalar(0.86 + hashRandom(s + 4) * 0.28);
                mesh.setColorAt(i, color);
            });

            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            mesh.computeBoundingSphere();
            obstacleGroup.add(mesh);
        }

        seed += items.length * 7 + 13;
    }

    scene.add(obstacleGroup);
    const drawCalls = obstacleGroup.children.length;
    console.log(`🌲 Obstacles: ${obstacles.length} instances in ${drawCalls} draw calls`);
    return obstacleGroup;
}

/** Removes and frees the obstacle meshes. */
export function clearObstacles(scene) {
    const group = obstacleGroup || scene?.getObjectByName('obstacles');
    if (!group) return;
    for (const child of group.children) {
        child.geometry?.dispose?.();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => m?.dispose?.());
        child.dispose?.(); // InstancedMesh: frees its instance attribute buffers
    }
    group.parent?.remove(group);
    scene?.remove(group);
    obstacleGroup = null;
}
