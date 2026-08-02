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
import { WIND_GLSL_COMMON, bindWindUniforms } from './wind.js';

// Per-surface tuft styling. density = tufts per m².
const GRASS_STYLES = {
    lightRough: {
        surfaceKey: 'LIGHT_ROUGH', density: 0.35, minH: 0.09, maxH: 0.16,
        colors: ['#4e8a44', '#5f9c4e', '#457a3e'], patchNoise: null, sway: 0.05,
    },
    mediumRough: {
        surfaceKey: 'MEDIUM_ROUGH', density: 1.1, minH: 0.14, maxH: 0.26,
        colors: ['#41763a', '#528a46', '#39682f'], patchNoise: null, sway: 0.09,
    },
    thickRough: {
        surfaceKey: 'THICK_ROUGH', density: 2.2, minH: 0.22, maxH: 0.4,
        colors: ['#35622f', '#417538', '#2c5427'], patchNoise: null, sway: 0.14,
    },
    nativeAreas: {
        surfaceKey: 'NATIVE_AREA', density: 3.0, minH: 0.35, maxH: 0.75,
        colors: ['#b89d4f', '#c9b160', '#a98f45', '#d3bf78'],
        patchNoise: { scale: 0.12, threshold: -0.15 }, // Clumpy patches
        sway: 0.22, // Tall wispy stuff moves most
    },
};

// Sparse scrubby clumps on the land beyond the course (OOB region is not
// rendered as a surface — tufts root on the earth plane at y = -0.08)
const OOB_SCRUB_STYLE = {
    surfaceKey: 'OUT_OF_BOUNDS', density: 0.12, minH: 0.25, maxH: 0.55,
    colors: ['#6b7a45', '#7d8a4f', '#5a683c'],
    patchNoise: { scale: 0.06, threshold: 0.05 },
    sway: 0.16,
    rootY: -0.9, // Offset below local terrain — matches the draped earth plane (see core.js)
};

const MAX_TUFTS_PER_TYPE = 14000;

// The rough grades share ONE budget rather than getting 14k each.
//
// Until the corridor was graded by distance (roughBands.js) every hole's rough
// was a single LIGHT_ROUGH polygon, so exactly one of these four styles ever
// produced tufts and the per-type cap was in practice a total. Now all four
// can be live on the same hole, and 289 of 486 holes already saturate the cap
// on their own, so keeping it per-type would have quadrupled the tuft count
// and the placement attempts behind it.
//
// One pass samples the corridor and buckets each accepted point by the grade
// it resolves to — banding the SAMPLING, not the polygons. Relative density
// is preserved by accepting a grade with probability density/MAX_ROUGH_DENSITY,
// so thick rough still reads thicker than a first cut; only the totals are
// held down.
const ROUGH_KEYS = ['lightRough', 'mediumRough', 'thickRough', 'nativeAreas'];
const MAX_ROUGH_DENSITY = 3.0;   // NATIVE_AREA, the densest of the four
const ROUGH_TUFT_BUDGET = 16000;
const ROUGH_ATTEMPT_BUDGET = 60000;
const BLADES_PER_TUFT = 5;

// --- Wind ---------------------------------------------------------------
// The tuft field was completely static, which is the single thing that made
// it read as scenery rather than grass. Sway is injected into the stock
// Lambert vertex shader via onBeforeCompile, driven by the shared wind state
// (visuals/wind.js) so grass, tree canopies and the flag all answer to the
// real in-game wind — same direction, same gusts.
//
// Displacement scales with the vertex's local Y, so roots stay planted and
// only tips move. One shared uniform updated once per frame; the GPU cost is
// a handful of ALU ops on geometry already being transformed.

// Distance beyond which tufts scale to nothing, so the field has no hard
// "carpet edge" — and distant tufts stop costing fragments. One draw call
// either way.
const FADE_START = 55.0;
const FADE_END = 95.0;

/** Patches a Lambert material with tip sway and distance fade. */
function applyWindShader(material, swayAmount) {
    material.onBeforeCompile = (shader) => {
        bindWindUniforms(shader);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${WIND_GLSL_COMMON}`)
            .replace('#include <begin_vertex>', `
                #include <begin_vertex>
                // World position of this instance's root, for phase and range
                vec4 rootWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);

                // Fade out with distance: collapse the tuft toward its root
                float dist = length(cameraPosition - rootWorld.xyz);
                float fade = 1.0 - smoothstep(${FADE_START.toFixed(1)}, ${FADE_END.toFixed(1)}, dist);
                transformed *= fade;

                // position.y is 0 at the root and 1 at the blade tip
                float lever = position.y * position.y;
                transformed += windSway(rootWorld.xyz, lever, ${swayAmount.toFixed(3)});
            `);
    };
    // Distinct key or three reuses one compiled program for every sway value
    material.customProgramCacheKey = () => `grass_${swayAmount.toFixed(3)}`;
}

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

    // --- The graded corridor, sampled once and bucketed by grade ---
    const styleBySurface = new Map();
    for (const key of ROUGH_KEYS) {
        const st = GRASS_STYLES[key];
        if (st) styleBySurface.set(st.surfaceKey, { layoutKey: key, style: st });
    }
    const roughPolys = [];
    for (const key of ROUGH_KEYS)
        for (const p of (holeLayout[key] || [])) if (p?.vertices?.length >= 3) roughPolys.push(p);

    const buckets = new Map();   // surfaceKey -> placements[]
    let placed = 0;
    if (roughPolys.length) {
        const boxes = roughPolys.map(p => ({ p, ...polygonAreaAndBBox(p.vertices) }))
            .filter(b => b.area >= 0.5 && (b.maxX - b.minX) * (b.maxZ - b.minZ) > 0);
        const totalArea = boxes.reduce((s, b) => s + b.area, 0);
        for (const b of boxes) {
            if (placed >= ROUGH_TUFT_BUDGET) break;
            // Attempts split across polygons by area, so a hole with several
            // corridor pieces spends the same total as one with a single piece.
            const share = totalArea > 0 ? b.area / totalArea : 1;
            const attempts = Math.ceil(ROUGH_ATTEMPT_BUDGET * share);
            for (let i = 0; i < attempts && placed < ROUGH_TUFT_BUDGET; i++) {
                const x = b.minX + Math.random() * (b.maxX - b.minX);
                const z = b.minZ + Math.random() * (b.maxZ - b.minZ);
                const surface = getSurfaceTypeAtPoint({ x, z }, holeLayout);
                const entry = styleBySurface.get(surface);
                if (!entry) continue;                    // green, bunker, fairway, water
                const st = entry.style;
                // Relative density between grades, one pass.
                if (Math.random() * MAX_ROUGH_DENSITY >= st.density) continue;
                let heightBoost = 1;
                if (st.patchNoise) {
                    const n = noise2D(x * st.patchNoise.scale, z * st.patchNoise.scale);
                    if (n < st.patchNoise.threshold) continue;
                    heightBoost = 0.7 + 0.6 * Math.min(1, (n - st.patchNoise.threshold));
                }
                let list = buckets.get(surface);
                if (!list) buckets.set(surface, list = []);
                list.push({ x, z, heightBoost });
                placed++;
            }
        }
    }

    const jobs = [];
    for (const [surface, list] of buckets) {
        const entry = styleBySurface.get(surface);
        jobs.push({ layoutKey: entry.layoutKey, style: entry.style, placements: list });
    }
    if (holeLayout.background?.vertices &&
        (holeLayout.background.surface?.name === 'Out of Bounds' || holeLayout.background.sceneryOnly)) {
        jobs.push({ layoutKey: 'background', style: OOB_SCRUB_STYLE, polys: [holeLayout.background] });
    }

    /**
     * Rejection-samples one style's own polygons. Only the OOB scrub uses this
     * now — it has a single polygon, a single style and a budget of its own.
     * The corridor grades are sampled together above, because they share the
     * same ground and would otherwise each pay for a full pass over it.
     */
    const sampleOwnPolys = (style, polys) => {
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
        return placements;
    };

    for (const job of jobs) {
        const { layoutKey, style, polys } = job;
        const layerHeight = SURFACES[style.surfaceKey]?.height ?? 0;
        const palette = style.colors.map(c => new THREE.Color(c));

        const placements = job.placements
            || (Array.isArray(polys) && polys.length ? sampleOwnPolys(style, polys) : []);

        if (placements.length === 0) continue;

        const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
        // Taller grass sways further; native-area wisps move most of all
        applyWindShader(material, style.sway ?? 0.12);
        const mesh = new THREE.InstancedMesh(tuftGeom, material, placements.length);
        // Deliberately no receiveShadow: a shadow-map sample per fragment
        // across tens of thousands of 0.1–0.4m blades buys almost nothing.
        mesh.receiveShadow = false;
        // The wind shader displaces vertices, so three's bounds are a slight
        // underestimate; frustum culling on a field this wide would pop.
        mesh.frustumCulled = false;

        for (let i = 0; i < placements.length; i++) {
            const p = placements[i];
            const h = (style.minH + Math.random() * (style.maxH - style.minH)) * p.heightBoost;
            // style.rootY is an offset below the local terrain (earth plane
            // drapes over the DEM, so absolute heights don't exist anymore)
            const rootY = contourHeightAt(p.x, p.z) + (style.rootY !== undefined ? style.rootY : layerHeight);
            dummy.position.set(p.x, rootY, p.z);
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
