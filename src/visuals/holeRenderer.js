// src/visuals/holeRenderer.js
// Renders hole layouts with 3D terrain support (heights on vertices)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { TextureLoader } from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { createNoise2D } from 'https://esm.sh/simplex-noise';
import earcut from 'https://cdn.skypack.dev/earcut@2.2.4';
import { heightAt as contourHeightAt, gradientAt as contourGradientAt, hasContour, isNearContour, isNearFineFeature, bankLevelAt, getWaterSheets, WATER_SURFACE_Y } from '../greenContours.js';
import { getSurfaceMaterial } from './textures.js';
import { fringeAt } from '../fringe.js';

// Baked hillshade for contoured ground: the scene's high ambient light washes
// out real shading, so slope readability is painted into vertex colors —
// slopes facing the sun brighten, slopes facing away darken. Exaggerated on
// purpose; matches the directional light at (50, 100, 20).
const SHADE_SUN = (() => {
    const len = Math.sqrt(60 * 60 + 70 * 70 + 25 * 25);
    return { x: 60 / len, y: 70 / len, z: 25 / len };
})();
const SHADE_EXAGGERATION = 5.0;
const SHADE_MIN = 0.68, SHADE_MAX = 1.22;

/** Brightness factor (≈1 on flat ground) for the contour slope at x,z. */
function hillshadeFactor(x, z) {
    const grad = contourGradientAt(x, z);
    if (!grad || (grad.x === 0 && grad.z === 0)) return 1;
    const invLen = 1 / Math.sqrt(grad.x * grad.x + 1 + grad.z * grad.z);
    const lambert = (-grad.x * SHADE_SUN.x + SHADE_SUN.y - grad.z * SHADE_SUN.z) * invLen;
    const flat = SHADE_SUN.y; // Lambert of perfectly flat ground
    const factor = Math.pow(Math.max(0.01, lambert / flat), SHADE_EXAGGERATION);
    return Math.min(SHADE_MAX, Math.max(SHADE_MIN, factor));
}

/**
 * Adaptively subdivides triangles near the active green contour and displaces
 * vertices by the analytic heightfield. Triangles far from the contour pass
 * through untouched; near ones split (4-way, midpoints welded via cache)
 * until edges are under ~0.9m, which renders the analytic field smoothly.
 * Because the field feathers to exactly 0 at its outer edge, T-junctions at
 * the subdivision boundary are coplanar and invisible.
 */
function adaptiveSubdivideForContour(positions, indices, fixedBudgetSq = null) {
    if (!hasContour()) return { positions, indices };

    const verts = [];
    for (let i = 0; i < positions.length; i += 3) {
        verts.push([positions[i], positions[i + 1], positions[i + 2]]);
    }

    const midCache = new Map();
    const midpoint = (a, b) => {
        const key = a < b ? a + '_' + b : b + '_' + a;
        let idx = midCache.get(key);
        if (idx === undefined) {
            const va = verts[a], vb = verts[b];
            verts.push([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]);
            idx = verts.length - 1;
            midCache.set(key, idx);
        }
        return idx;
    };

    const FINE_EDGE_SQ = 0.65 * 0.65;   // Bunker rims, green contours
    const COARSE_EDGE_SQ = 4.0 * 4.0;    // Broad DEM elevation (20m cells)
    const MAX_DEPTH = 9;
    const out = [];
    const edgeLenSq = (a, b) => {
        const va = verts[a], vb = verts[b];
        const dx = va[0] - vb[0], dz = va[2] - vb[2];
        return dx * dx + dz * dz;
    };

    const process = (a, b, c, depth) => {
        const maxESq = Math.max(edgeLenSq(a, b), edgeLenSq(b, c), edgeLenSq(c, a));
        const cx = (verts[a][0] + verts[b][0] + verts[c][0]) / 3;
        const cz = (verts[a][2] + verts[b][2] + verts[c][2]) / 3;
        const margin = Math.sqrt(maxESq);
        const budget = fixedBudgetSq ?? (isNearFineFeature(cx, cz, margin) ? FINE_EDGE_SQ : COARSE_EDGE_SQ);
        if (depth >= MAX_DEPTH || maxESq < budget || !isNearContour(cx, cz, margin)) {
            out.push(a, b, c);
            return;
        }
        const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
        process(a, ab, ca, depth + 1);
        process(ab, b, bc, depth + 1);
        process(ca, bc, c, depth + 1);
        process(ab, bc, ca, depth + 1);
    };

    for (let i = 0; i < indices.length; i += 3) {
        process(indices[i], indices[i + 1], indices[i + 2], 0);
    }

    const newPositions = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
        const [x, y, z] = verts[i];
        newPositions[i * 3] = x;
        newPositions[i * 3 + 1] = y + contourHeightAt(x, z);
        newPositions[i * 3 + 2] = z;
    }
    const IndexArr = verts.length > 65535 ? Uint32Array : Uint16Array;
    return { positions: newPositions, indices: new IndexArr(out) };
}

/**
 * Forces every triangle to wind so its geometric normal points UP (+Y).
 *
 * Ring winding can't do this job: earcut normalizes its output orientation, so
 * reversing the input polygon changes nothing. With the (x → x, z → z) mapping
 * used here that fixed orientation comes out facing DOWN, so the indices have
 * to be flipped after the fact.
 *
 * This never mattered while every surface used DoubleSide — three flips the
 * normal for back faces, which hid both the wrong orientation and the wrong
 * lighting that came with it. Under front-face culling a down-facing ground
 * polygon simply vanishes, leaving the bare earth backdrop showing through.
 *
 * Measured from the mesh itself rather than assumed, so an earcut version that
 * changes its convention can't silently invert the whole course.
 */
function orientTrianglesUp(positions, triangles) {
    for (let t = 0; t < triangles.length; t += 3) {
        const ia = triangles[t] * 3, ib = triangles[t + 1] * 3, ic = triangles[t + 2] * 3;
        // Cross product's Y component for this triangle, in the XZ plane
        const abx = positions[ib] - positions[ia], abz = positions[ib + 2] - positions[ia + 2];
        const acx = positions[ic] - positions[ia], acz = positions[ic + 2] - positions[ia + 2];
        const ny = abz * acx - abx * acz;
        if (ny === 0) continue; // Degenerate sliver — no orientation to read
        if (ny < 0) {
            // Flip the whole set to match the first triangle that has an
            // opinion; earcut is internally consistent, so one probe is enough.
            for (let k = 0; k < triangles.length; k += 3) {
                const tmp = triangles[k + 1];
                triangles[k + 1] = triangles[k + 2];
                triangles[k + 2] = tmp;
            }
        }
        return triangles;
    }
    return triangles;
}

/**
 * Triangulates a polygon with optional height data on vertices
 * @param {Array} vertices - Array of {x, y?, z} vertices
 * @returns {Object} - {positions: Float32Array, indices: Uint16Array/Uint32Array}
 */
function triangulatePolygonWithHeights(vertices, heightOffset = 0) {
    if (!vertices || vertices.length < 3) {
        throw new Error('Need at least 3 vertices to triangulate');
    }

    // Flatten vertices to [x, z, x, z, ...] for earcut (2D triangulation)
    const coords = [];
    const heights = [];

    for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i];
        coords.push(v.x, v.z);
        heights.push((v.y !== undefined ? v.y : 0) + heightOffset); // Store height + offset, default to 0 + offset
    }

    // Triangulate using earcut
    const triangles = earcut(coords);

    // Create 3D positions array: [x, y, z, x, y, z, ...]
    const positions = new Float32Array(vertices.length * 3);
    for (let i = 0; i < vertices.length; i++) {
        positions[i * 3] = vertices[i].x;
        positions[i * 3 + 1] = heights[i]; // Use height (with offset) as Y coordinate
        positions[i * 3 + 2] = vertices[i].z;
    }

    // Ground must face up, or front-face culling removes it entirely
    orientTrianglesUp(positions, triangles);

    // Convert triangles to appropriate typed array
    const indices = vertices.length > 65535
        ? new Uint32Array(triangles)
        : new Uint16Array(triangles);

    return { positions, indices };
}

/**
 * Creates a BufferGeometry from triangulated polygon data with proper UVs
 * @param {Float32Array} positions
 * @param {Uint16Array|Uint32Array} indices
 * @returns {THREE.BufferGeometry}
 */
function createGeometryFromTriangulation(positions, indices, uvScale = 4.0) {
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // Compute normals for lighting
    geometry.computeVertexNormals();

    // WORLD-SPACE UVs: uvScale is metres of ground per texture tile, so grass
    // is the same physical size on a 15m bunker and a 300m rough. The old
    // bounding-box normalization + fixed texture.repeat meant tile size scaled
    // with the polygon — a huge rough got 30m grass blades and visible
    // stretching, a small one got 2m. It also let one shared texture instance
    // serve every polygon, since repeat can now stay at (1, 1).
    const uvs = new Float32Array((positions.length / 3) * 2);
    const inv = 1 / uvScale;
    for (let i = 0; i < positions.length / 3; i++) {
        uvs[i * 2] = positions[i * 3] * inv;
        uvs[i * 2 + 1] = positions[i * 3 + 2] * inv;
    }

    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.computeBoundingBox();

    return geometry;
}

// --- Mow patterns ------------------------------------------------------
// Real golf reads as golf largely because of mow stripes. The vertex-colour
// attribute already exists on these meshes and is already written per-vertex,
// so banding costs nothing: no extra attribute, no shader change, no draw call.
const STRIPE_WIDTH_M = { Green: 3.2, Fairway: 7.0, 'Tee Box': 2.4 };
const STRIPE_CONTRAST = { Green: 0.05, Fairway: 0.055, 'Tee Box': 0.05 };

// Mow direction, set per hole so all 18 don't look stamped from one template.
let stripeAngle = 0;

/** Seeds the mow direction for a hole (any stable per-hole number works). */
export function setMowPattern(seed = 0) {
    // Irrational multiplier keeps consecutive holes far apart in angle
    stripeAngle = ((seed * 0.6180339887) % 1) * Math.PI;
}

/**
 * Brightness multiplier for the mow band at x,z, or 1 for unmown surfaces.
 * Greens are cut across the fairway's direction, the way they usually are.
 */
function mowFactor(surfaceName, x, z) {
    const width = STRIPE_WIDTH_M[surfaceName];
    if (!width) return 1;
    const angle = surfaceName === 'Green' ? stripeAngle + Math.PI / 2 : stripeAngle;
    const along = x * Math.cos(angle) + z * Math.sin(angle);
    const band = Math.floor(along / width);
    const contrast = STRIPE_CONTRAST[surfaceName] ?? 0.05;
    // Soften the seam so bands read as mown grass, not painted stripes
    const frac = along / width - band;
    const edge = Math.min(1, Math.min(frac, 1 - frac) * 8);
    return 1 + ((band & 1) ? contrast : -contrast) * (0.55 + 0.45 * edge);
}

// --- Bunker rims -------------------------------------------------------
// A bunker reads from the tee mostly through the darker, shadowed grass lip
// around it. Sand is deliberately excluded from hillshade (exaggerated
// darkening turns a bowl into a pit), so the definition has to come from the
// grass side. Baked into vertex colour at build time: free at render.

const RIM_WIDTH_M = 1.6;
const RIM_DARKEN = 0.26; // Peak darkening right at the sand's edge
let bunkerRims = []; // { verts, minX, maxX, minZ, maxZ }

/** Registers the hole's bunker polygons so surrounding grass can be shaded. */
export function setBunkerRims(bunkers) {
    bunkerRims = [];
    if (!Array.isArray(bunkers)) return;
    for (const b of bunkers) {
        const verts = b?.vertices;
        if (!verts || verts.length < 3) continue;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const v of verts) {
            if (v.x < minX) minX = v.x;
            if (v.x > maxX) maxX = v.x;
            if (v.z < minZ) minZ = v.z;
            if (v.z > maxZ) maxZ = v.z;
        }
        bunkerRims.push({ verts, minX, maxX, minZ, maxZ });
    }
}

/** Squared distance from a point to a segment, on the XZ plane. */
function distSqToSegment(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((px - ax) * dx + (pz - az) * dz) / lenSq : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const cx = ax + dx * t - px, cz = az + dz * t - pz;
    return cx * cx + cz * cz;
}

/** Brightness multiplier for grass near a bunker edge (1 = untouched). */
function bunkerRimShade(surfaceName, x, z) {
    // Sand shades itself; water and OOB have no lip
    if (!bunkerRims.length || surfaceName === 'Bunker' || surfaceName === 'Water') return 1;

    let bestSq = Infinity;
    for (const rim of bunkerRims) {
        // Cheap bbox reject keeps this near-free for the vast majority of
        // ground vertices, which are nowhere near a bunker
        if (x < rim.minX - RIM_WIDTH_M || x > rim.maxX + RIM_WIDTH_M ||
            z < rim.minZ - RIM_WIDTH_M || z > rim.maxZ + RIM_WIDTH_M) continue;
        const v = rim.verts;
        for (let i = 0; i < v.length; i++) {
            const a = v[i], b = v[(i + 1) % v.length];
            const d = distSqToSegment(x, z, a.x, a.z, b.x, b.z);
            if (d < bestSq) bestSq = d;
        }
    }
    if (bestSq === Infinity) return 1;

    const d = Math.sqrt(bestSq);
    if (d >= RIM_WIDTH_M) return 1;
    const t = d / RIM_WIDTH_M;          // 0 at the sand edge, 1 at rim's outer limit
    return 1 - RIM_DARKEN * (1 - t) * (1 - t);
}

// --- Fringe ------------------------------------------------------------
// The collar has no mesh of its own (see src/fringe.js for why), so it has to
// read as a lighter, tighter-mown band painted onto whatever polygon is drawn
// there — usually the rough corridor, sometimes the approach fairway. Same
// vertex-colour pass as hillshade and mow stripes, so it is free at render.
//
// Near-green ground is already tessellated at the FINE 0.65 m budget, because
// the green contour is a fine feature, so a 2 m band gets about three vertices
// across it. That is enough for an edge; it would not be at the coarse budget.

const FRINGE_LIGHTEN = 0.14;   // Peak lift right at the green's edge
let fringeLayout = null;

/**
 * Registers the hole so its greens' collars can be shaded.
 *
 * The WHOLE layout, not just the greens: the collar's width depends on the
 * approach bearing, which is read from the rough corridor's centreline. Handing
 * this a greens-only object would not merely draw a uniform band — the
 * approach cache is keyed on the green's vertex array and shared with the
 * surface lookup, so whichever ran first would decide the width for both.
 */
export function setFringeLayout(holeLayout) {
    fringeLayout = holeLayout?.greens?.length || holeLayout?.green ? holeLayout : null;
}

/** Brightness multiplier for grass in a green's collar (1 = untouched). */
function fringeShade(surfaceName, x, z) {
    // The green paints its own edge, and sand and water have no collar.
    if (!fringeLayout || surfaceName === 'Green' || surfaceName === 'Bunker' ||
        surfaceName === 'Water') return 1;
    const f = fringeAt(x, z, fringeLayout);
    if (!f) return 1;
    // Normalised by the LOCAL width, so the apron and the collar each fade out
    // at their own edge instead of the apron ending in a hard step.
    const t = f.dist / f.width;     // 0 at the green's edge, 1 at the outer limit
    return 1 + FRINGE_LIGHTEN * (1 - t) * (1 - t);
}

/**
 * Renders a polygon with heights (fairway, green, rough, etc.)
 * @param {Object} polygonData - Polygon data with vertices array
 * @param {THREE.Scene} scene
 * @param {TextureLoader} textureLoader
 * @param {Array} objectsArray - Array to track created objects
 * @param {Object} options - {name, addNoise, noiseScale, variationStrength}
 */
export function renderPolygonWithHeights(polygonData, scene, textureLoader, objectsArray, options = {}) {
    if (!polygonData?.vertices || polygonData.vertices.length < 3) {
        console.warn(`${options.name || 'Polygon'} has invalid vertices, skipping`);
        return;
    }

    const { name = 'Polygon', addNoise = false, noiseScale = 0.001, variationStrength = 0.4, heightOffset = 0, colorOverride = null, flatY = undefined, drapeY = undefined } = options;

    try {
        // Triangulate with heights
        let { positions, indices } = triangulatePolygonWithHeights(polygonData.vertices, heightOffset);

        if (drapeY !== undefined) {
            // Draped sheet (creeks on sloping terrain): per-vertex level from
            // a callback. Coarse 3m budget — a water surface needs no rim
            // detail, and the fine budget explodes long ribbons into 10⁶ verts.
            ({ positions, indices } = adaptiveSubdivideForContour(positions, indices, 9));
            for (let i = 0; i < positions.length; i += 3) {
                positions[i + 1] = drapeY(positions[i], positions[i + 2]);
            }
        } else if (flatY !== undefined) {
            // Fixed-level sheet (water surface): no terrain displacement —
            // the depressed ground slopes down underneath it instead.
            for (let i = 1; i < positions.length; i += 3) positions[i] = flatY;
        } else {
            // Subdivide + displace near terrain features (smooth elevation)
            ({ positions, indices } = adaptiveSubdivideForContour(positions, indices));
        }

        const surface = polygonData.surface;
        const surfaceName = surface?.name;

        // Create geometry (world-space UVs at the surface's real-world tiling)
        const geometry = createGeometryFromTriangulation(positions, indices, surface?.uvScale ?? 4.0);

        // Vertex colours carry three free effects: optional simplex noise
        // (rough), baked hillshade near the contour, and mow stripes on the
        // mown surfaces. All are written in this one pass — no extra cost.
        const vertexCount = positions.length / 3;
        const colors = new Float32Array(positions.length);
        const noise2D = addNoise ? createNoise2D() : null;
        // A textured surface must keep a WHITE vertex base: the texture already
        // carries the grass colour, so tinting it by the surface colour as well
        // multiplies two dark greens together and crushes the rough to near
        // black. Only untextured surfaces use their flat colour as the base.
        const textured = !!surface?.texturePath;
        const baseColor = (addNoise && !textured)
            ? new THREE.Color(colorOverride || surface?.color || '#228b22')
            : new THREE.Color(1, 1, 1);
        // Textures supply their own fine detail, so noise only needs to break
        // up the large-scale flatness — a much gentler hand than on flat colour.
        const noiseAmount = textured ? variationStrength * 0.35 : variationStrength;
        const contourActive = hasContour();

        for (let i = 0; i < vertexCount; i++) {
            const x = positions[i * 3];
            const z = positions[i * 3 + 2];

            let factor = 1.0;
            if (addNoise) {
                factor *= Math.max(0, 1.0 + noise2D(x * noiseScale, z * noiseScale) * noiseAmount);
            }
            // Bake slope shading into grass — but not sand: exaggerated
            // darkening makes bunker bowls read as pits instead of sand
            if (contourActive && surfaceName !== 'Bunker' && isNearContour(x, z, 0)) {
                factor *= hillshadeFactor(x, z);
            }
            factor *= mowFactor(surfaceName, x, z);
            // Grass darkens into a bunker's lip — real bunkers read from
            // distance almost entirely via that rim, and the sand itself is
            // deliberately excluded from hillshade above.
            factor *= bunkerRimShade(surfaceName, x, z);
            factor *= fringeShade(surfaceName, x, z);

            colors[i * 3] = baseColor.r * factor;
            colors[i * 3 + 1] = baseColor.g * factor;
            colors[i * 3 + 2] = baseColor.b * factor;
        }

        // Always attach colours so every ground polygon can share one material
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // Create mesh
        const mesh = new THREE.Mesh(geometry);
        mesh.receiveShadow = true;
        mesh.name = name;

        // Layer stacking: surfaces overlap freely in layouts (rough often sits
        // under fairway/green/bunkers), so coplanar polygons would z-fight.
        // Each surface type lifts by its 'height' layer value — the cm-scale
        // gaps in SURFACES are enough for depth precision at all camera
        // distances. No polygonOffset: depth biasing overdraws small objects
        // sitting on the surface (the ball) at grazing angles.
        const layerHeight = flatY !== undefined ? 0 : (surface?.height ?? 0);
        mesh.position.y = layerHeight;

        // Ground is only ever seen from above, so front-face culling halves the
        // rasterization work and makes the shadow pass correct. Safe now that
        // triangulatePolygonWithHeights normalizes ring winding. Water sheets
        // stay double-sided — the camera can end up under the surface.
        const side = flatY !== undefined || drapeY !== undefined
            ? THREE.DoubleSide
            : THREE.FrontSide;

        // Shared material from the registry: one instance per surface type
        // instead of one per polygon, and the texture behind it is uploaded to
        // the GPU exactly once for the whole app. Assigned synchronously —
        // TextureLoader hands back the Texture immediately and fills in the
        // image later, so there's no longer a flash of default white material.
        mesh.material = getSurfaceMaterial({
            texturePath: surface?.texturePath,
            color: colorOverride || surface?.color || '#228b22',
            side,
        });

        scene.add(mesh);
        objectsArray.push(mesh);

        return mesh;

    } catch (error) {
        console.error(`Error rendering ${name}:`, error);
        return null;
    }
}

/**
 * Renders background (out of bounds) - typically flat at y=0 or negative
 */
export function renderBackground(holeLayout, scene, textureLoader, objectsArray) {
    if (!holeLayout.background?.vertices) return;

    const bgData = {
        vertices: holeLayout.background.vertices.map(v => ({
            x: v.x,
            y: v.y !== undefined ? v.y : -0.01, // Slightly below ground
            z: v.z
        })),
        surface: holeLayout.background.surface
    };

    // Out of bounds is a RULE, not a ground type: don't render it at all —
    // the earth plane and scrub grass ARE the land beyond the course, and
    // white stakes mark the boundary (see oobStakes.js). The logical OOB
    // region (surface detection, penalties) is unaffected.
    if (holeLayout.background.surface?.name === 'Out of Bounds') return;
    // Same reasoning for a background that is only a LIE: the land beyond the
    // course is the earth plane, not a polygon laid over it.
    if (holeLayout.background.sceneryOnly) return;

    renderPolygonWithHeights(bgData, scene, textureLoader, objectsArray, {
        name: 'Background',
    });
}

/**
 * Renders rough areas (light, medium, thick)
 */
export function renderRoughAreas(holeLayout, scene, textureLoader, objectsArray) {
    const roughTypes = [
        { key: 'lightRough', name: 'Light Rough' },
        { key: 'mediumRough', name: 'Medium Rough' },
        { key: 'thickRough', name: 'Thick Rough' },
        { key: 'nativeAreas', name: 'Native Area' }, // Wild grass base
        { key: 'rough', name: 'Rough (Legacy)' } // Legacy support
    ];

    roughTypes.forEach(({ key, name }) => {
        const roughData = holeLayout[key];

        if (Array.isArray(roughData)) {
            roughData.forEach((rough, idx) => {
                renderPolygonWithHeights(rough, scene, textureLoader, objectsArray, {
                    name: `${name} #${idx + 1}`,
                    addNoise: true,
                    noiseScale: 0.001,
                    variationStrength: 0.4,
                });
            });
        } else if (roughData?.vertices) {
            renderPolygonWithHeights(roughData, scene, textureLoader, objectsArray, {
                name,
                addNoise: true,
                noiseScale: 0.001,
                variationStrength: 0.4,
            });
        }
    });
}

// --- Water motion ------------------------------------------------------
// A static blue sheet doesn't read as water no matter how good the specular
// is; motion is what sells it. Crossed sine waves perturb the surface normal
// in the fragment shader, so the specular highlight breaks up and travels.
// A few ALU ops on a surface that covers a small fraction of the screen —
// far cheaper than the real alternatives (planar reflection or a CubeCamera
// both mean rendering the scene a second time every frame).
const waterUniforms = { uTime: { value: 0 } };
const waterMaterials = [];

/** Advances the water animation. Called once per frame from the render loop. */
export function updateWater(timeSeconds) {
    waterUniforms.uTime.value = timeSeconds;
}

function applyWaterRipple(material) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = waterUniforms.uTime;
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `
                #include <common>
                uniform float uTime;
            `)
            .replace('#include <normal_fragment_begin>', `
                #include <normal_fragment_begin>
                // Two wave trains at different speeds and headings
                float w1 = sin(vViewPosition.x * 1.7 + uTime * 1.1)
                         + sin(vViewPosition.z * 2.1 - uTime * 0.8);
                float w2 = sin(vViewPosition.x * 3.3 - uTime * 1.7)
                         + sin(vViewPosition.z * 2.9 + uTime * 1.3);
                normal = normalize(normal + vec3(w1 * 0.045, 0.0, w2 * 0.045));
            `);
    };
    material.customProgramCacheKey = () => 'water_ripple';
}

/**
 * Renders water hazards with transparency
 */
export function renderWaterHazards(holeLayout, scene, textureLoader, objectsArray) {
    if (!holeLayout.waterHazards || !Array.isArray(holeLayout.waterHazards)) return;

    holeLayout.waterHazards.forEach((water, idx) => {
        if (water.type === 'circle' && water.center && water.radius) {
            // Legacy circle water support
            const geometry = new THREE.CircleGeometry(water.radius, 32);
            const material = new THREE.MeshStandardMaterial({
                color: water.surface?.color || '#ADD8E6',
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.85
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(water.center.x, water.surface?.height || 0.002, water.center.z);
            mesh.rotation.x = -Math.PI / 2;
            mesh.receiveShadow = true;
            scene.add(mesh);
            objectsArray.push(mesh);
        } else if (water.type === 'polygon' || water.vertices) {
            // Sheet mode comes from the terrain module (which carved the
            // matching depression): ponds get a LEVEL sheet at their level
            // floor's height; creeks drape 0.18m below the bank line so the
            // run descends with the DEM.
            const info = getWaterSheets()[idx];
            const opts = {
                name: `Water Hazard #${idx + 1}`,
            };
            if (info?.mode === 'flat') opts.flatY = info.y;
            else opts.drapeY = (x, z) => bankLevelAt(x, z) + WATER_SURFACE_Y;
            const mesh = renderPolygonWithHeights(water, scene, textureLoader, objectsArray, opts);

            // Lit water with a specular glint so it reads as water, plus a
            // slight emissive floor so it never collapses into a dark pit.
            // Note: no dispose of the outgoing material — it belongs to the
            // shared surface registry and is still in use by other polygons.
            if (mesh) {
                const waterMat = new THREE.MeshPhongMaterial({
                    color: 0x3f81b8,
                    specular: 0xcfe6ff,
                    shininess: 130,
                    emissive: 0x10314a,
                    transparent: true,
                    opacity: 0.9,
                    // OSM polygons wind either way — never let the sheet
                    // backface-cull into invisibility when seen from above
                    side: THREE.DoubleSide,
                });
                applyWaterRipple(waterMat);
                mesh.material = waterMat;
                mesh.geometry.computeVertexNormals();
                waterMaterials.push(waterMat);
            }
        }
    });
}

/**
 * Renders bunkers (sand traps)
 */
export function renderBunkers(holeLayout, scene, textureLoader, objectsArray) {
    if (!holeLayout.bunkers || !Array.isArray(holeLayout.bunkers)) return;

    holeLayout.bunkers.forEach((bunker, idx) => {
        if (bunker.type === 'circle' && bunker.center && bunker.radius) {
            // Legacy circle bunker
            const geometry = new THREE.CircleGeometry(bunker.radius, 32);
            const material = new THREE.MeshStandardMaterial({
                color: bunker.surface?.color || '#D2B48C',
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(bunker.center.x, bunker.surface?.height || 0.005, bunker.center.z);
            mesh.rotation.x = -Math.PI / 2;
            mesh.receiveShadow = true;
            scene.add(mesh);
            objectsArray.push(mesh);
        } else if (bunker.type === 'polygon' || bunker.vertices) {
            renderPolygonWithHeights(bunker, scene, textureLoader, objectsArray, {
                name: `Bunker #${idx + 1}`,
            });
        }
    });
}

/**
 * Renders fairways
 */
export function renderFairways(holeLayout, scene, textureLoader, objectsArray) {
    const fairways = holeLayout.fairways || (holeLayout.fairway ? [holeLayout.fairway] : []);

    fairways.forEach((fairway, idx) => {
        renderPolygonWithHeights(fairway, scene, textureLoader, objectsArray, {
            name: `Fairway #${idx + 1}`,
        });
    });
}

/**
 * Renders the green(s) with height support
 * @returns {Object} {center: THREE.Vector3, radius: number} or null
 */
export function renderGreen(holeLayout, scene, textureLoader, objectsArray) {
    const greens = holeLayout.greens || (holeLayout.green ? [holeLayout.green] : []);

    if (greens.length === 0) {
        console.warn('No green data found');
        return null;
    }

    let allVertices = [];

    // Render all green polygons
    greens.forEach((green, idx) => {
        if (green.type === 'polygon' || green.vertices) {
            renderPolygonWithHeights(green, scene, textureLoader, objectsArray, {
                name: `Green #${idx + 1}`,
            });

            // Collect all vertices for calculating overall center
            if (green.vertices) {
                allVertices = allVertices.concat(green.vertices);
            }
        } else if (green.center && green.radius) {
            // Legacy circle green
            const geometry = new THREE.CircleGeometry(green.radius, 64);
            const material = new THREE.MeshStandardMaterial({
                color: green.surface?.color || '#3A9A3A',
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geometry, material);
            const height = green.surface?.height || 0.02;
            mesh.position.set(green.center.x, height, green.center.z);
            mesh.rotation.x = -Math.PI / 2;
            mesh.receiveShadow = true;
            scene.add(mesh);
            objectsArray.push(mesh);
        }
    });

    if (allVertices.length > 0) {
        let sumX = 0, sumZ = 0, sumY = 0;
        allVertices.forEach(v => {
            sumX += v.x;
            sumZ += v.z;
            sumY += (v.y !== undefined ? v.y : 0);
        });
        const count = allVertices.length;
        const centerX = sumX / count;
        const centerZ = sumZ / count;
        const centerY = sumY / count;

        const greenCenter = new THREE.Vector3(centerX, centerY, centerZ);

        // Calculate approximate radius
        let sumDist = 0;
        allVertices.forEach(v => {
            const dx = v.x - centerX;
            const dz = v.z - centerZ;
            sumDist += Math.sqrt(dx * dx + dz * dz);
        });
        const greenRadius = sumDist / count;

        return { center: greenCenter, radius: greenRadius };
    }

    return null;
}

/**
 * Renders the tee box (now using polygon with heights like other surfaces)
 */
export function renderTeeBox(holeLayout, scene, textureLoader, objectsArray) {
    if (!holeLayout.tee) return;

    console.log('renderTeeBox: tee data:', holeLayout.tee);

    // If tee box has vertices (from holeLoader processing), render as polygon with heights
    if (holeLayout.tee.vertices && holeLayout.tee.vertices.length >= 3) {
        console.log('renderTeeBox: Rendering as polygon with vertices:', holeLayout.tee.vertices);
        renderPolygonWithHeights(holeLayout.tee, scene, textureLoader, objectsArray, {
            name: 'Tee Box',
            // Layer lift comes from SURFACES.TEE.height (0.03) like every other surface
        });
    } else if (holeLayout.tee.center) {
        // Fallback to old method for legacy holes without vertices
        console.log('renderTeeBox: Using legacy flat rendering at center:', holeLayout.tee.center);
        const teeWidth = holeLayout.tee.width || 10;
        const teeDepth = holeLayout.tee.depth || 10;
        const terrainHeight = holeLayout.tee.center.y || 0; // Use terrain height from center

        const geometry = new THREE.PlaneGeometry(teeWidth, teeDepth);
        const material = new THREE.MeshLambertMaterial({
            color: holeLayout.tee.surface?.color || '#ecf0f1',
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(holeLayout.tee.center.x, terrainHeight + 0.03, holeLayout.tee.center.z);
        mesh.rotation.x = -Math.PI / 2;
        mesh.receiveShadow = true;
        scene.add(mesh);
        objectsArray.push(mesh);
    }
}
