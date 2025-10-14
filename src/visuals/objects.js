import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
// Import scaling factors if needed directly, or pass them in
// For now, let's assume a fixed scale factor matching the ball's enlarged scale
const TEE_SCALE_FACTOR = 10.0; // Matches BALL_SCALE_ENLARGED from core.js

/**
 * Creates a scaled Three.js mesh representing a golf tee.
 * @param {string} size - 'large' for driver/woods, 'small' for irons/hybrids
 * @returns {THREE.Mesh} The tee mesh object.
 */
export function createTeeMesh(size = 'large') {
    // Dimensions based on size
    let teeHeight, topRadius, bottomRadius;

    if (size === 'small') {
        // Small tee for irons/hybrids - barely visible
        teeHeight = 0.015; // Meters (about 0.6 inches)
        topRadius = 0.008;
        bottomRadius = 0.002;
    } else {
        // Large tee for driver/woods
        teeHeight = 0.05; // Meters (standard tee height approx 2 inches)
        topRadius = 0.01;
        bottomRadius = 0.003;
    }

    const radialSegments = 16;

    const teeGeometry = new THREE.CylinderGeometry(topRadius, bottomRadius, teeHeight, radialSegments);
    const teeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff }); // White tee
    const teeMesh = new THREE.Mesh(teeGeometry, teeMaterial);

    // Apply scaling to match the enlarged ball visual scale
    teeMesh.scale.set(TEE_SCALE_FACTOR, TEE_SCALE_FACTOR, TEE_SCALE_FACTOR);

    // Set the origin to the bottom center for easier positioning
    // Move geometry up by half its height so rotation/positioning is relative to the bottom
    teeGeometry.translate(0, teeHeight / 2, 0);

    teeMesh.castShadow = true; // Optional: allow tee to cast shadow
    teeMesh.visible = false; // Start hidden
    teeMesh.userData.size = size; // Store size for reference

    console.log(`${size} tee mesh created.`);
    return teeMesh;
}

// Future functions for trees, bushes, etc. can be added here
// export function createTreeMesh() { ... }
// export function createBushMesh() { ... }
