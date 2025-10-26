// src/visuals/holeRenderer.js
// Renders hole layouts with 3D terrain support (heights on vertices)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { TextureLoader } from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { createNoise2D } from 'https://esm.sh/simplex-noise';
import earcut from 'https://cdn.skypack.dev/earcut@2.2.4';

/**
 * Triangulates a polygon with optional height data on vertices
 * @param {Array} vertices - Array of {x, y?, z} vertices
 * @returns {Object} - {positions: Float32Array, indices: Uint16Array/Uint32Array}
 */
function triangulatePolygonWithHeights(vertices) {
    if (!vertices || vertices.length < 3) {
        throw new Error('Need at least 3 vertices to triangulate');
    }

    // Flatten vertices to [x, z, x, z, ...] for earcut (2D triangulation)
    const coords = [];
    const heights = [];

    for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i];
        coords.push(v.x, v.z);
        heights.push(v.y !== undefined ? v.y : 0); // Store height, default to 0
    }

    // Triangulate using earcut
    const triangles = earcut(coords);

    // Create 3D positions array: [x, y, z, x, y, z, ...]
    const positions = new Float32Array(vertices.length * 3);
    for (let i = 0; i < vertices.length; i++) {
        positions[i * 3] = vertices[i].x;
        positions[i * 3 + 1] = heights[i]; // Use height as Y coordinate
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

    const { name = 'Polygon', addNoise = false, noiseScale = 0.001, variationStrength = 0.4 } = options;

    try {
        // Triangulate with heights
        const { positions, indices } = triangulatePolygonWithHeights(polygonData.vertices);

        // Create geometry
        const geometry = createGeometryFromTriangulation(positions, indices);

        // Add vertex colors with simplex noise if requested
        if (addNoise) {
            const noise2D = createNoise2D();
            const colors = new Float32Array(positions.length);
            const baseColor = new THREE.Color(polygonData.surface?.color || '#228b22');

            for (let i = 0; i < positions.length / 3; i++) {
                const x = positions[i * 3];
                const z = positions[i * 3 + 2];
                const noiseValue = noise2D(x * noiseScale, z * noiseScale);
                const variation = 1.0 + noiseValue * variationStrength;
                const clampedVariation = Math.max(0, variation);

                colors[i * 3] = baseColor.r * clampedVariation;
                colors[i * 3 + 1] = baseColor.g * clampedVariation;
                colors[i * 3 + 2] = baseColor.b * clampedVariation;
            }

            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }

        // Create mesh
        const mesh = new THREE.Mesh(geometry);
        mesh.receiveShadow = true;
        mesh.name = name;

        // Apply material
        const surface = polygonData.surface;
        const materialOptions = {
            side: THREE.DoubleSide,
            ...(addNoise && { vertexColors: true })
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
                color: surface?.color || '#228b22'
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

    renderPolygonWithHeights(bgData, scene, textureLoader, objectsArray, {
        name: 'Background',
        textureRepetitions: 5
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
