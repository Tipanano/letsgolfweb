// src/visuals/holeRenderer.js
// Renders hole layouts with 3D terrain support (heights on vertices)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { TextureLoader } from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { createNoise2D } from 'https://esm.sh/simplex-noise';
import earcut from 'https://cdn.skypack.dev/earcut@2.2.4';
import { heightAt as contourHeightAt, gradientAt as contourGradientAt, hasContour, isNearContour } from '../greenContours.js';

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
function adaptiveSubdivideForContour(positions, indices) {
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

    const MAX_EDGE_SQ = 0.9 * 0.9;
    const MAX_DEPTH = 8;
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
        if (depth >= MAX_DEPTH || maxESq < MAX_EDGE_SQ || !isNearContour(cx, cz, Math.sqrt(maxESq))) {
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
function createGeometryFromTriangulation(positions, indices) {
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // Compute normals for lighting
    geometry.computeVertexNormals();

    // Compute bounding box for UVs
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox;

    // Generate UVs based on XZ plane (top-down)
    const uvs = new Float32Array((positions.length / 3) * 2);
    const sizeX = bbox.max.x - bbox.min.x;
    const sizeZ = bbox.max.z - bbox.min.z;

    if (sizeX > 0 && sizeZ > 0) {
        for (let i = 0; i < positions.length / 3; i++) {
            const x = positions[i * 3];
            const z = positions[i * 3 + 2];
            uvs[i * 2] = (x - bbox.min.x) / sizeX;
            uvs[i * 2 + 1] = (z - bbox.min.z) / sizeZ;
        }
    }

    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    return geometry;
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

    const { name = 'Polygon', addNoise = false, noiseScale = 0.001, variationStrength = 0.4, heightOffset = 0, colorOverride = null } = options;

    try {
        // Triangulate with heights
        let { positions, indices } = triangulatePolygonWithHeights(polygonData.vertices, heightOffset);

        // Subdivide + displace near the active green contour (smooth elevation)
        ({ positions, indices } = adaptiveSubdivideForContour(positions, indices));

        // Create geometry
        const geometry = createGeometryFromTriangulation(positions, indices);

        // Vertex colors: optional simplex noise (rough) and baked hillshade
        // near the contour, so slopes read even under heavy ambient light.
        const vertexCount = positions.length / 3;
        let useVertexColors = false;
        const colors = new Float32Array(positions.length);
        const noise2D = addNoise ? createNoise2D() : null;
        const baseColor = addNoise
            ? new THREE.Color(colorOverride || polygonData.surface?.color || '#228b22')
            : new THREE.Color(1, 1, 1); // White multiplies textures unchanged
        const contourActive = hasContour();

        for (let i = 0; i < vertexCount; i++) {
            const x = positions[i * 3];
            const z = positions[i * 3 + 2];

            let factor = 1.0;
            if (addNoise) {
                factor *= Math.max(0, 1.0 + noise2D(x * noiseScale, z * noiseScale) * variationStrength);
            }
            if (contourActive && isNearContour(x, z, 0)) {
                factor *= hillshadeFactor(x, z);
            }
            if (factor !== 1.0) useVertexColors = true;

            colors[i * 3] = baseColor.r * factor;
            colors[i * 3 + 1] = baseColor.g * factor;
            colors[i * 3 + 2] = baseColor.b * factor;
        }

        if (addNoise || useVertexColors) {
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }

        // Create mesh
        const mesh = new THREE.Mesh(geometry);
        mesh.receiveShadow = true;
        mesh.name = name;

        // Apply material
        const surface = polygonData.surface;

        // Layer stacking: surfaces overlap freely in layouts (rough often sits
        // under fairway/green/bunkers), so coplanar polygons would z-fight.
        // Each surface type lifts by its 'height' layer value — the cm-scale
        // gaps in SURFACES are enough for depth precision at all camera
        // distances. No polygonOffset: depth biasing overdraws small objects
        // sitting on the surface (the ball) at grazing angles.
        const layerHeight = surface?.height ?? 0;
        mesh.position.y = layerHeight;

        const materialOptions = {
            side: THREE.DoubleSide,
            ...((addNoise || useVertexColors) && { vertexColors: true })
        };

        if (surface?.texturePath) {
            textureLoader.load(
                surface.texturePath,
                (texture) => {
                    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                    const textureRepetitions = options.textureRepetitions || 10;
                    texture.repeat.set(textureRepetitions, textureRepetitions);
                    mesh.material = new THREE.MeshStandardMaterial({
                        ...materialOptions,
                        map: texture
                    });
                    mesh.material.needsUpdate = true;
                },
                undefined,
                (err) => {
                    console.error(`Error loading ${name} texture:`, err);
                    mesh.material = new THREE.MeshStandardMaterial({
                        ...materialOptions,
                        color: surface?.color || '#228b22'
                    });
                    mesh.material.needsUpdate = true;
                }
            );
        } else {
            mesh.material = new THREE.MeshStandardMaterial({
                ...materialOptions,
                color: colorOverride || surface?.color || '#228b22'
            });
        }

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

    renderPolygonWithHeights(bgData, scene, textureLoader, objectsArray, {
        name: 'Background',
        textureRepetitions: 5,
    });
}

/**
 * Renders rough areas (light, medium, thick)
 */
export function renderRoughAreas(holeLayout, scene, textureLoader, objectsArray) {
    const roughTypes = [
        { key: 'lightRough', name: 'Light Rough', reps: 10 },
        { key: 'mediumRough', name: 'Medium Rough', reps: 10 },
        { key: 'thickRough', name: 'Thick Rough', reps: 10 },
        { key: 'nativeAreas', name: 'Native Area', reps: 10 }, // Wild grass base
        { key: 'rough', name: 'Rough (Legacy)', reps: 10 } // Legacy support
    ];

    roughTypes.forEach(({ key, name, reps }) => {
        const roughData = holeLayout[key];

        if (Array.isArray(roughData)) {
            roughData.forEach((rough, idx) => {
                renderPolygonWithHeights(rough, scene, textureLoader, objectsArray, {
                    name: `${name} #${idx + 1}`,
                    addNoise: true,
                    noiseScale: 0.001,
                    variationStrength: 0.4,
                    textureRepetitions: reps
                });
            });
        } else if (roughData?.vertices) {
            renderPolygonWithHeights(roughData, scene, textureLoader, objectsArray, {
                name,
                addNoise: true,
                noiseScale: 0.001,
                variationStrength: 0.4,
                textureRepetitions: reps
            });
        }
    });
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
            // Polygon water with heights
            const mesh = renderPolygonWithHeights(water, scene, textureLoader, objectsArray, {
                name: `Water Hazard #${idx + 1}`,
                textureRepetitions: 5
            });

            // Make water transparent
            if (mesh && mesh.material) {
                mesh.material.transparent = true;
                mesh.material.opacity = 0.85;
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
                textureRepetitions: 8
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
            textureRepetitions: 15
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
                textureRepetitions: 10
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
            textureRepetitions: 5
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
