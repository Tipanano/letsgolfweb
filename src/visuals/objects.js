import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
// Import scaling factors if needed directly, or pass them in
// For now, let's assume a fixed scale factor matching the ball's enlarged scale
const TEE_SCALE_FACTOR = 10.0; // Matches BALL_SCALE_ENLARGED from core.js

/**
 * Creates a scaled Three.js mesh representing a golf tee.
 * @returns {THREE.Mesh} The tee mesh object.
 */
export function createTeeMesh() {
    // Dimensions for the tee (adjust as needed)
    const teeHeight = 0.05; // Meters (standard tee height approx 2 inches)
    const topRadius = 0.01;
    const bottomRadius = 0.003;
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

    console.log("Tee mesh created.");
    return teeMesh;
}

// Future functions for trees, bushes, etc. can be added here
// export function createTreeMesh() { ... }
// export function createBushMesh() { ... }
