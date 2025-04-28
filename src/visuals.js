import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';

let scene, camera, renderer, ball, ground, trajectoryLine;
const BALL_RADIUS = 0.2;

// Animation state
let isBallAnimating = false;
let ballAnimationStartTime = 0;
let ballAnimationDuration = 1500; // Default duration, will be overwritten
let currentTrajectoryPoints = [];

export function initVisuals(canvasElement) {
    console.log("Initializing visuals on canvas:", canvasElement);

    // 1. Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue background
    scene.fog = new THREE.Fog(0x87CEEB, 100, 300); // Add fog for depth perception

    // 2. Camera
    const aspectRatio = canvasElement.clientWidth / canvasElement.clientHeight;
    camera = new THREE.PerspectiveCamera(60, aspectRatio, 0.1, 1000);
    // Position camera higher and slightly further back for a better overview
    camera.position.set(0, 15, -20); // Increased y from 10 to 15, z from -15 to -20
    camera.lookAt(0, 0, 60); // Look slightly further down range
    scene.add(camera);

    // 3. Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvasElement, antialias: true });
    renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true; // Enable shadows

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Soft white light
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 20); // Coming from above and side
    directionalLight.castShadow = true;
    // Configure shadow properties for better quality
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    scene.add(directionalLight);
    // Optional: Add a light helper
    // const lightHelper = new THREE.DirectionalLightHelper(directionalLight, 5);
    // scene.add(lightHelper);

    // 5. Ground
    const groundGeometry = new THREE.PlaneGeometry(200, 400); // Large plane for range
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22, side: THREE.DoubleSide }); // Forest green
    ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    ground.position.y = 0; // Position at ground level
    ground.receiveShadow = true; // Allow ground to receive shadows
    scene.add(ground);

    // 6. Ball
    const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
    const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff }); // White ball
    ball = new THREE.Mesh(ballGeometry, ballMaterial);
    ball.castShadow = true; // Ball casts shadow
    showBallAtAddress(); // Position the ball initially
    scene.add(ball);

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Start render loop
    animate();

    console.log("Three.js scene initialized.");
}

function onWindowResize() {
    const canvas = renderer.domElement;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
}

function animate(timestamp) { // Pass timestamp for animation timing
    requestAnimationFrame(animate);

    // Ball flight animation logic
    if (isBallAnimating) {
        const elapsedTime = timestamp - ballAnimationStartTime;
        const progress = Math.min(1, elapsedTime / ballAnimationDuration); // 0 to 1

        if (currentTrajectoryPoints.length > 0) {
            // Find the index corresponding to the current progress
            const pointIndex = Math.floor(progress * (currentTrajectoryPoints.length - 1));
            const targetPoint = currentTrajectoryPoints[pointIndex];

            // Smooth interpolation between points (optional but nicer)
            const nextPointIndex = Math.min(pointIndex + 1, currentTrajectoryPoints.length - 1);
            const segmentProgress = (progress * (currentTrajectoryPoints.length - 1)) - pointIndex;

            // --- DEBUG LOGGING ---
            const vec1 = currentTrajectoryPoints[pointIndex];
            const vec2 = currentTrajectoryPoints[nextPointIndex];
            console.log(`Animating: progress=${progress.toFixed(3)}, pointIndex=${pointIndex}, nextPointIndex=${nextPointIndex}, segmentProgress=${segmentProgress.toFixed(3)}`);
            if (!vec1 || !vec2) {
                console.error(`!!! UNDEFINED VECTOR DETECTED: vec1=${vec1}, vec2=${vec2}`);
            }
            // --- END DEBUG LOGGING ---

            const interpolatedPosition = new THREE.Vector3().lerpVectors(
                vec1, // Use logged variable
                vec2, // Use logged variable
                segmentProgress
            );

            ball.position.copy(interpolatedPosition);

            // Update the draw range of the trajectory line
            if (trajectoryLine) {
                // The number of points to draw is based on the total points in the line * progress
                // However, setDrawRange uses vertex count, not line segments.
                // For a line with N points, there are N vertices.
                const drawCount = Math.ceil(progress * currentTrajectoryPoints.length);
                trajectoryLine.geometry.setDrawRange(0, drawCount);
            }
        }

        if (progress >= 1) {
            isBallAnimating = false; // Animation finished
            console.log("Ball animation finished.");
            // Ensure the full line is drawn at the end
            if (trajectoryLine) {
                trajectoryLine.geometry.setDrawRange(0, currentTrajectoryPoints.length);
            }
            // Ensure ball is exactly at the end point
             if (currentTrajectoryPoints.length > 0) {
                 ball.position.copy(currentTrajectoryPoints[currentTrajectoryPoints.length - 1]);
             }
        }
    }

    renderer.render(scene, camera);
}

export function showBallAtAddress() {
    if (ball) {
        ball.position.set(0, BALL_RADIUS, 0); // Place ball on the ground at origin
        console.log("Showing ball at address position");
    }
}

export function animateBallFlight(shotData) {
    console.log("Animating ball flight with data:", shotData);

    // Remove previous line if it exists
    if (trajectoryLine) {
        scene.remove(trajectoryLine);
        trajectoryLine.geometry.dispose();
        trajectoryLine.material.dispose();
        trajectoryLine = null;
    }

    if (shotData.trajectory && shotData.trajectory.length > 0) {
        // 1. Create geometry from points
        const points = shotData.trajectory.map(p => new THREE.Vector3(p.x, p.y, p.z));
        const geometry = new THREE.BufferGeometry().setFromPoints(points);

        // 2. Create material - Changed to yellow and thicker
        const material = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 3 }); // Yellow line, try width 3

        // 3. Create line object
        trajectoryLine = new THREE.Line(geometry, material);
        // Set initial draw range to zero - line starts invisible
        trajectoryLine.geometry.setDrawRange(0, 0);
        scene.add(trajectoryLine);
        console.log("Trajectory line added to scene (initially hidden).");

        // Set animation duration based on calculated time of flight (convert seconds to ms)
        ballAnimationDuration = shotData.timeOfFlight ? shotData.timeOfFlight * 1000 : 1500; // Use calculated time or default
        console.log(`Setting ball animation duration to: ${ballAnimationDuration.toFixed(0)} ms`);

        // Start animation
        currentTrajectoryPoints = points.map(p => new THREE.Vector3(p.x, p.y, p.z)); // Store Vector3 points
        isBallAnimating = true;
        ballAnimationStartTime = performance.now();
        console.log("Starting ball animation...");

    } else {
        console.warn("No trajectory data received for animation.");
    }

    // Ball position is now handled by the animate() loop, no instant move needed here.
}

export function resetVisuals() {
    console.log("Resetting visuals");
    // Remove trajectory line if it exists
    if (trajectoryLine) {
        scene.remove(trajectoryLine);
        trajectoryLine.geometry.dispose();
        trajectoryLine.material.dispose();
        trajectoryLine = null;
        console.log("Trajectory line removed.");
    }
    // Stop any ongoing animation and reset state
    isBallAnimating = false;
    currentTrajectoryPoints = [];
    showBallAtAddress(); // Put ball back at start
}
