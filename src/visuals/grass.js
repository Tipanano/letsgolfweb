// src/visuals/grass.js
//
// Instanced grass for rough and native areas: thousands of small blade tufts
// in one draw call per surface type. Stylized colored blades (no textures) —
// they read as texture at density. Light rough gets sparse short tufts,
// thick rough dense shaggy ones, native areas tall golden wisps clumped into
// natural patches by a noise mask.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { createNoise2D } from 'https://esm.sh/simplex-noise';
import { getSurfaceTypeAtPoint } from '../utils/gameUtils.js';
import { heightAt as contourHeightAt } from '../greenContours.js';
import { SURFACES } from '../surfaces.js';

// Per-surface tuft styling. density = tufts per m².
const GRASS_STYLES = {
    lightRough: {
        surfaceKey: 'LIGHT_ROUGH', density: 0.35, minH: 0.09, maxH: 0.16,
        colors: ['#4e8a44', '#5f9c4e', '#457a3e'], patchNoise: null,
    },
    mediumRough: {
        surfaceKey: 'MEDIUM_ROUGH', density: 1.1, minH: 0.14, maxH: 0.26,
        colors: ['#41763a', '#528a46', '#39682f'], patchNoise: null,
    },
    thickRough: {
        surfaceKey: 'THICK_ROUGH', density: 2.2, minH: 0.22, maxH: 0.4,
        colors: ['#35622f', '#417538', '#2c5427'], patchNoise: null,
    },
    nativeAreas: {
        surfaceKey: 'NATIVE_AREA', density: 3.0, minH: 0.35, maxH: 0.75,
        colors: ['#b89d4f', '#c9b160', '#a98f45', '#d3bf78'],
        patchNoise: { scale: 0.12, threshold: -0.15 }, // Clumpy patches
    },
};

const MAX_TUFTS_PER_TYPE = 14000;
const BLADES_PER_TUFT = 5;

/** One unit-height tuft: BLADES_PER_TUFT thin leaning triangles. */
function createTuftGeometry() {
    const positions = [];
    for (let b = 0; b < BLADES_PER_TUFT; b++) {
        const angle = (b / BLADES_PER_TUFT) * Math.PI * 2 + Math.random() * 0.8;
        const lean = 0.15 + Math.random() * 0.3; // Tip offset from root
        const baseX = Math.cos(angle) * 0.03;
        const baseZ = Math.sin(angle) * 0.03;
        const halfW = 0.012 + Math.random() * 0.01;
        const tipX = baseX + Math.cos(angle) * lean;
        const tipZ = baseZ + Math.sin(angle) * lean;
        positions.push(
            baseX - halfW * Math.sin(angle), 0, baseZ + halfW * Math.cos(angle),
            baseX + halfW * Math.sin(angle), 0, baseZ - halfW * Math.cos(angle),
            tipX, 1, tipZ
        );
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();
    return geom;
}

function polygonAreaAndBBox(vertices) {
    let area = 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i], b = vertices[(i + 1) % vertices.length];
        area += a.x * b.z - b.x * a.z;
        minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x);
        minZ = Math.min(minZ, a.z); maxZ = Math.max(maxZ, a.z);
    }
    return { area: Math.abs(area / 2), minX, maxX, minZ, maxZ };
}

/**
 * Builds instanced grass for every rough/native polygon in the layout.
 * Meshes are appended to objectsArray so the hole cleanup removes them.
 */
export function buildGrass(holeLayout, scene, objectsArray) {
    if (!holeLayout || !scene) return;

    const noise2D = createNoise2D();
    const tuftGeom = createTuftGeometry();
    const dummy = new THREE.Object3D();

    for (const [layoutKey, style] of Object.entries(GRASS_STYLES)) {
        const polys = holeLayout[layoutKey];
        if (!Array.isArray(polys) || polys.length === 0) continue;

        const layerHeight = SURFACES[style.surfaceKey]?.height ?? 0;
        const palette = style.colors.map(c => new THREE.Color(c));

        // Collect accepted tuft placements across all polygons of this type
        const placements = [];
        for (const poly of polys) {
            if (!poly?.vertices || poly.vertices.length < 3) continue;
            const { area, minX, maxX, minZ, maxZ } = polygonAreaAndBBox(poly.vertices);
            const bboxArea = (maxX - minX) * (maxZ - minZ);
            if (area < 0.5 || bboxArea <= 0) continue;

            const target = Math.min(MAX_TUFTS_PER_TYPE - placements.length,
                                    Math.floor(area * style.density));
            const maxAttempts = Math.ceil(target * (bboxArea / area) * 1.5) + 20;

            let accepted = 0;
            for (let i = 0; i < maxAttempts && accepted < target; i++) {
                const x = minX + Math.random() * (maxX - minX);
                const z = minZ + Math.random() * (maxZ - minZ);

                // Patch mask (native areas): clumps, not uniform fill
                let heightBoost = 1;
                if (style.patchNoise) {
                    const n = noise2D(x * style.patchNoise.scale, z * style.patchNoise.scale);
                    if (n < style.patchNoise.threshold) continue;
                    heightBoost = 0.7 + 0.6 * Math.min(1, (n - style.patchNoise.threshold));
                }

                // Only place where THIS surface is actually on top (skips
                // greens/fairways/bunkers layered above the rough)
                if (getSurfaceTypeAtPoint({ x, z }, holeLayout) !== style.surfaceKey) continue;

                placements.push({ x, z, heightBoost });
                accepted++;
            }
            if (placements.length >= MAX_TUFTS_PER_TYPE) break;
        }

        if (placements.length === 0) continue;

        const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
        const mesh = new THREE.InstancedMesh(tuftGeom, material, placements.length);
        mesh.receiveShadow = true;

        for (let i = 0; i < placements.length; i++) {
            const p = placements[i];
            const h = (style.minH + Math.random() * (style.maxH - style.minH)) * p.heightBoost;
            dummy.position.set(p.x, contourHeightAt(p.x, p.z) + layerHeight, p.z);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            dummy.scale.set(0.8 + Math.random() * 0.5, h, 0.8 + Math.random() * 0.5);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            mesh.setColorAt(i, palette[(Math.random() * palette.length) | 0]);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.name = `Grass_${layoutKey}`;

        scene.add(mesh);
        objectsArray.push(mesh);
        console.log(`🌾 Grass: ${placements.length} tufts for ${layoutKey}`);
    }
}
