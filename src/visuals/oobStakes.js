// src/visuals/oobStakes.js
//
// White out-of-bounds stakes, placed automatically along the boundary
// between in-bounds ground and OOB — the way real courses mark the line.
// For every rough polygon edge, points are sampled every ~12m; where the
// ground just OUTSIDE that edge is out of bounds, a stake goes just inside.
// Only holes with an explicit OOB background get stakes.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { getSurfaceTypeAtPoint } from '../utils/gameUtils.js';
import { heightAt as contourHeightAt } from '../greenContours.js';

const STAKE_SPACING = 12;   // m along the boundary
const PROBE_DISTANCE = 2.0; // m outside the edge to test for OOB
const INSET = 0.4;          // Stake sits just inside the line
const MAX_STAKES = 400;
const STAKE_HEIGHT = 0.95;

export function buildOOBStakes(holeLayout, scene, objectsArray) {
    if (!holeLayout?.background?.vertices) return; // No explicit OOB → no stakes
    if (holeLayout.background.surface?.name !== 'Out of Bounds') return;

    const spots = [];
    const roughKeys = ['lightRough', 'mediumRough', 'thickRough'];

    for (const key of roughKeys) {
        const polys = holeLayout[key];
        if (!Array.isArray(polys)) continue;

        for (const poly of polys) {
            const verts = poly?.vertices;
            if (!verts || verts.length < 3) continue;

            let cx = 0, cz = 0;
            verts.forEach(v => { cx += v.x; cz += v.z; });
            cx /= verts.length;
            cz /= verts.length;

            for (let i = 0; i < verts.length && spots.length < MAX_STAKES; i++) {
                const a = verts[i], b = verts[(i + 1) % verts.length];
                const ex = b.x - a.x, ez = b.z - a.z;
                const len = Math.sqrt(ex * ex + ez * ez);
                if (len < 1) continue;

                // Edge normal pointing away from the polygon centroid
                let nx = ez / len, nz = -ex / len;
                const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
                if (nx * (midX - cx) + nz * (midZ - cz) < 0) { nx = -nx; nz = -nz; }

                const count = Math.max(1, Math.round(len / STAKE_SPACING));
                for (let k = 0; k < count && spots.length < MAX_STAKES; k++) {
                    const t = (k + 0.5) / count;
                    const px = a.x + ex * t, pz = a.z + ez * t;

                    // Stake only where the ground beyond this edge is OOB
                    const beyond = getSurfaceTypeAtPoint(
                        { x: px + nx * PROBE_DISTANCE, z: pz + nz * PROBE_DISTANCE }, holeLayout);
                    if (beyond !== 'OUT_OF_BOUNDS') continue;

                    spots.push({ x: px - nx * INSET, z: pz - nz * INSET });
                }
            }
        }
    }

    if (spots.length === 0) return;

    const geom = new THREE.CylinderGeometry(0.045, 0.045, STAKE_HEIGHT, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geom, mat, spots.length);
    mesh.castShadow = true;
    mesh.name = 'OOBStakes';

    const dummy = new THREE.Object3D();
    spots.forEach((s, i) => {
        dummy.position.set(s.x, contourHeightAt(s.x, s.z) + STAKE_HEIGHT / 2, s.z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;

    scene.add(mesh);
    objectsArray.push(mesh);
    console.log(`⚪ OOB stakes: ${spots.length} placed`);
}
