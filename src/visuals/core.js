import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';

export let scene, camera, renderer, ball, trajectoryLine;
export const BALL_RADIUS = 0.2;

// Animation state
let isBallAnimating = false;
let ballAnimationStartTime = 0;
let ballAnimationDuration = 1500; // Default duration, will be overwritten
let currentTrajectoryPoints = [];
let currentAnimationCallback = null; // Add variable to store the callback

export function initCoreVisuals(canvasElement) {
    console.log("Initializing core visuals on canvas:", canvasElement);

    // 1. Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue background
    // Increase fog start and far distance
    scene.fog = new THREE.Fog(0x87CEEB, 150, 500); // Start further, end further

    // 2. Camera (Default - Range View)
    const aspectRatio = canvasElement.clientWidth / canvasElement.clientHeight;
    camera = new THREE.PerspectiveCamera(60, aspectRatio, 0.1, 1000);
    // Slightly higher default position for range view
    camera.position.set(0, 18, -25); // Raised Y, moved back Z
    camera.lookAt(0, 0, 80); // Look slightly further down range
    scene.add(camera); // Add camera to scene

    // 3. Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvasElement, antialias: true });
    renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 20);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    scene.add(directionalLight);

    // 5. Ball (Common element)
    const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
    const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    ball = new THREE.Mesh(ballGeometry, ballMaterial);
    ball.castShadow = true;
    showBallAtAddress(); // Position the ball initially
    scene.add(ball);

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Start render loop
    animate();

    console.log("Core Three.js scene initialized.");

    // Return essential elements needed by other modules
    return { scene, camera, renderer, ball };
}

function onWindowResize() {
    if (!renderer || !camera) return;
    const canvas = renderer.domElement;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
}

function animate(timestamp) {
    if (!renderer) return; // Ensure renderer exists
    requestAnimationFrame(animate);

    // Ball flight animation logic
    if (isBallAnimating) {
        const elapsedTime = timestamp - ballAnimationStartTime;
        // Ensure progress is clamped between 0 and 1 before use
        const progress = Math.max(0, Math.min(1, elapsedTime / ballAnimationDuration));

        if (currentTrajectoryPoints.length > 0) {
            // Calculate index using clamped progress
            const pointIndex = Math.floor(progress * (currentTrajectoryPoints.length - 1));

            // Ensure pointIndex is valid (this check might be redundant now but safe to keep)
             if (pointIndex < 0 || pointIndex >= currentTrajectoryPoints.length) {
                 // Log progress as well for debugging
                 console.error(`Invalid pointIndex: ${pointIndex} (Progress: ${progress.toFixed(4)}) for trajectory length ${currentTrajectoryPoints.length}`);
                 isBallAnimating = false; // Stop animation if index is bad
                 return;
             }

            const nextPointIndex = Math.min(pointIndex + 1, currentTrajectoryPoints.length - 1);
            const segmentProgress = (progress * (currentTrajectoryPoints.length - 1)) - pointIndex;

            const vec1 = currentTrajectoryPoints[pointIndex];
            const vec2 = currentTrajectoryPoints[nextPointIndex];

            // Check if points exist before attempting lerp
            if (vec1 && vec2) {
                 const interpolatedPosition = new THREE.Vector3().lerpVectors(
                    vec1,
                    vec2,
                    segmentProgress
                );
                if (ball) ball.position.copy(interpolatedPosition);
            } else {
                 console.error(`Undefined vector encountered during animation: vec1=${vec1}, vec2=${vec2}, index=${pointIndex}, nextIndex=${nextPointIndex}`);
                 // Optionally stop animation or handle error appropriately
                 isBallAnimating = false;
            }


            if (trajectoryLine) {
                const drawCount = Math.ceil(progress * currentTrajectoryPoints.length);
                 // Ensure drawCount is valid before setting
                 if (drawCount >= 0 && drawCount <= currentTrajectoryPoints.length) {
                    trajectoryLine.geometry.setDrawRange(0, drawCount);
                 } else {
                     console.error(`Invalid drawCount: ${drawCount} for trajectory length ${currentTrajectoryPoints.length}`);
                 }
            }
        }

        if (progress >= 1) {
            isBallAnimating = false;
            console.log("Ball animation finished.");
            if (trajectoryLine) {
                 // Ensure final draw range is valid
                 if (currentTrajectoryPoints.length >= 0) {
                    trajectoryLine.geometry.setDrawRange(0, currentTrajectoryPoints.length);
                 }
            }
             if (ball && currentTrajectoryPoints.length > 0) {
                 // Ensure final position point exists
                 const finalPoint = currentTrajectoryPoints[currentTrajectoryPoints.length - 1];
                 if (finalPoint) {
                     ball.position.copy(finalPoint);
                 }
             }
             // Execute the callback if it exists
             if (currentAnimationCallback) {
                 console.log("Executing animation completion callback.");
                 currentAnimationCallback();
                 currentAnimationCallback = null; // Clear callback after execution
             }
         }
     }

    renderer.render(scene, camera);
}

export function showBallAtAddress() {
    if (ball) {
        ball.position.set(0, BALL_RADIUS, 0);
        console.log("Showing ball at address position");
        ball.visible = true; // Ensure it's visible
    }
}

// Function to hide the ball
export function hideBall() {
    if (ball) {
        ball.visible = false;
        console.log("Hiding ball.");
    }
}

// Function to handle the animation logic, potentially called by visuals.js
export function startBallAnimation(points, duration, onCompleteCallback = null) { // Add callback parameter
     if (!scene) return; // Guard against uninitialized scene

    // Store the callback
    currentAnimationCallback = onCompleteCallback;

    // Remove previous line if it exists
    if (trajectoryLine) {
        scene.remove(trajectoryLine);
        trajectoryLine.geometry.dispose();
        trajectoryLine.material.dispose();
        trajectoryLine = null;
    }

    if (points && points.length > 0) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 3 });
        trajectoryLine = new THREE.Line(geometry, material);
        trajectoryLine.geometry.setDrawRange(0, 0);
        scene.add(trajectoryLine);
        console.log("Trajectory line added to scene (initially hidden).");

        ballAnimationDuration = duration;
        console.log(`Setting ball animation duration to: ${ballAnimationDuration.toFixed(0)} ms`);

        currentTrajectoryPoints = points; // Store Vector3 points directly
        isBallAnimating = true;
        ballAnimationStartTime = performance.now();
        console.log("Starting ball animation...");
    } else {
        console.warn("No trajectory data received for animation.");
    }
}


export function resetCoreVisuals() {
    console.log("Resetting core visuals");
     if (!scene) return; // Guard against uninitialized scene

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

// Function to reset camera to default position/view
export function resetCameraPosition() {
    if (camera) {
        camera.position.set(0, 15, -20); // Default position
        camera.lookAt(0, 0, 60); // Default lookAt
        console.log("Camera position reset for Range view.");
    }
}

// Function to set camera for Target view
export function setCameraForTargetView(targetZ = 150) { // Default target Z if not provided
    if (camera) {
        // Position camera higher and further back, looking down at the target
        const cameraHeight = 30; // Higher Y position
        const cameraDistBack = 100; // Further back along Z
        camera.position.set(0, cameraHeight, targetZ - cameraDistBack);
        // Look at a point slightly in front of the target Z on the ground
        camera.lookAt(0, 0, targetZ / 1.5);
        console.log(`Camera position set for Target view (looking at Z=${targetZ.toFixed(1)}).`);
    }
}
