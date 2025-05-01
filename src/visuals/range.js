import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';

let ground, fairway, green1, green2;
const Y_OFFSET_GROUND = 0;
const Y_OFFSET_FAIRWAY = 0.01;
const Y_OFFSET_GREEN = 0.02;

export function initRangeVisuals(scene) {
    console.log("Initializing range visuals...");
    console.log("[range.js] initRangeVisuals: Received scene parameter:", scene); // ADD LOG

    // --- Ground (Rough) ---
    const groundGeometry = new THREE.PlaneGeometry(200, 400); // Width, Length
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22, side: THREE.DoubleSide }); // Forest green (rough)
    ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = Y_OFFSET_GROUND;
    ground.receiveShadow = true;
    scene.add(ground);
    console.log("Range ground (rough) added.");

    // --- Fairway (using ShapeGeometry) ---
    const fairwayLength = 300;
    const startWidth = 20;
    const maxWidth = 40;
    const curveControlOffset = 30; // How far out the curve control points go

    const fairwayShape = new THREE.Shape();

    // Start at bottom-left corner (relative to shape's local coords)
    fairwayShape.moveTo(-startWidth / 2, 0);

    // Curve out to max width on the left side
    fairwayShape.quadraticCurveTo(
        -maxWidth / 2 - curveControlOffset, fairwayLength * 0.25, // Control point
        -maxWidth / 2, fairwayLength * 0.5 // End point (midpoint left)
    );

    // Straight section on left side
    fairwayShape.lineTo(-maxWidth / 2, fairwayLength * 0.75);

    // Curve back in to start width on the left side
     fairwayShape.quadraticCurveTo(
        -maxWidth / 2 - curveControlOffset, fairwayLength * 0.9, // Control point
        -startWidth / 2, fairwayLength // End point (top-left)
    );

    // Top edge (straight for simplicity here, could be curved)
    fairwayShape.lineTo(startWidth / 2, fairwayLength);

    // Curve back in on the right side (mirroring left)
     fairwayShape.quadraticCurveTo(
        maxWidth / 2 + curveControlOffset, fairwayLength * 0.9, // Control point
        maxWidth / 2, fairwayLength * 0.75 // End point (mid-top right)
    );

    // Straight section on right side
    fairwayShape.lineTo(maxWidth / 2, fairwayLength * 0.5);

     // Curve out to max width on the right side
    fairwayShape.quadraticCurveTo(
        maxWidth / 2 + curveControlOffset, fairwayLength * 0.25, // Control point
        startWidth / 2, 0 // End point (bottom-right)
    );


    // Close the shape (back to bottom-left)
    fairwayShape.lineTo(-startWidth / 2, 0);

    const fairwayGeometry = new THREE.ShapeGeometry(fairwayShape);
    const fairwayMaterial = new THREE.MeshStandardMaterial({ color: 0x3CB371, side: THREE.DoubleSide }); // Medium sea green (fairway)
    // Translate the geometry so its center is at the local origin (0,0)
    // It was defined from Y=0 to Y=fairwayLength, so center is at Y=fairwayLength/2
    fairwayGeometry.translate(0, -fairwayLength / 2, 0);

    fairway = new THREE.Mesh(fairwayGeometry, fairwayMaterial);

    // ShapeGeometry is created in the XY plane. Rotate and position it.
    fairway.rotation.x = -Math.PI / 2; // Rotate to lay flat
    fairway.position.y = Y_OFFSET_FAIRWAY; // Place slightly above ground
    // Now position the mesh's origin (which is the geometry's center)
    // at the center of where the fairway should be in world space.
    fairway.position.z = fairwayLength / 2;


    fairway.receiveShadow = true;
    scene.add(fairway);
    console.log("Range fairway (ShapeGeometry) added.");

    // --- Greens ---
    const greenMaterial = new THREE.MeshStandardMaterial({ color: 0x006400, side: THREE.DoubleSide }); // Dark green (green)

    // Green 1 (Closer)
    const green1Radius = 10;
    const green1Geometry = new THREE.CircleGeometry(green1Radius, 32);
    green1 = new THREE.Mesh(green1Geometry, greenMaterial);
    green1.rotation.x = -Math.PI / 2;
    green1.position.set(0, Y_OFFSET_GREEN, 100); // Position 100 units down range
    green1.receiveShadow = true;
    scene.add(green1);
    console.log("Range green 1 added at z=100.");

    // Green 2 (Further)
    const green2Radius = 15;
    const green2Geometry = new THREE.CircleGeometry(green2Radius, 32);
    green2 = new THREE.Mesh(green2Geometry, greenMaterial);
    green2.rotation.x = -Math.PI / 2;
    green2.position.set(0, Y_OFFSET_GREEN, 200); // Position 200 units down range
    green2.receiveShadow = true;
    scene.add(green2);
    console.log("Range green 2 added at z=200.");


    // Add other range elements here later (targets, tee box markers, etc.)

    // Return elements if needed elsewhere (optional)
    return { ground, fairway, green1, green2 };
}

export function removeRangeVisuals(scene) {
    // Remove Greens
    if (green1) {
        scene.remove(green1);
        green1.geometry.dispose();
        green1.material.dispose();
        green1 = null;
        console.log("Range green 1 removed.");
    }
     if (green2) {
        scene.remove(green2);
        green2.geometry.dispose();
        green2.material.dispose();
        green2 = null;
        console.log("Range green 2 removed.");
    }
    // Remove Fairway
    if (fairway) {
        scene.remove(fairway);
        fairway.geometry.dispose();
        fairway.material.dispose();
        fairway = null;
        console.log("Range fairway removed.");
    }
    // Remove Ground
    if (ground) {
        scene.remove(ground);
        ground.geometry.dispose();
        ground.material.dispose();
        ground = null;
        console.log("Range ground (rough) removed.");
    }
    // Add removal logic for other range elements here
}
