import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';

export let scene, camera, renderer, ball, trajectoryLine;
export const BALL_RADIUS = 0.2;
export const YARDS_TO_METERS = 1 / 1.09361; // Define and export the conversion factor

// Camera Modes
export const CameraMode = {
    STATIC: 'static',
    FOLLOW_BALL: 'follow_ball',
    REVERSE_ANGLE: 'reverse_angle',
    GREEN_FOCUS: 'green_focus',
};
let activeCameraMode = CameraMode.STATIC;
let currentStaticView = 'range'; // 'range', 'target', 'chip', 'putt' - Tracks the *current* static view setting

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
    camera.position.set(0, 18, -25); // Default: Range view position
    camera.lookAt(0, 0, 80); // Default: Range view lookAt
    scene.add(camera); // Add camera to scene
    currentStaticView = 'range'; // Set initial static view type
    activeCameraMode = CameraMode.STATIC; // Set initial mode

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

    // --- Camera Update Logic ---
    updateCamera(timestamp); // Call camera update logic each frame

    // --- Ball Flight Animation Logic ---
    if (isBallAnimating) {
        const elapsedTime = timestamp - ballAnimationStartTime;
        const progress = Math.max(0, Math.min(1, elapsedTime / ballAnimationDuration)); // Clamped progress

        if (currentTrajectoryPoints.length > 0) {
            const pointIndex = Math.floor(progress * (currentTrajectoryPoints.length - 1)); // Current segment start index

            // Ensure pointIndex is valid (this check might be redundant now but safe to keep)
             if (pointIndex < 0 || pointIndex >= currentTrajectoryPoints.length) {
                 // Log progress as well for debugging
                 console.error(`Invalid pointIndex: ${pointIndex} (Progress: ${progress.toFixed(4)}) for trajectory length ${currentTrajectoryPoints.length}`);
                 isBallAnimating = false; // Stop animation if index is bad
                 return;
             }

            const nextPointIndex = Math.min(pointIndex + 1, currentTrajectoryPoints.length - 1);
            const segmentProgress = (progress * (currentTrajectoryPoints.length - 1)) - pointIndex; // Progress within the current segment

            // const nextPointIndex = Math.min(pointIndex + 1, currentTrajectoryPoints.length - 1); // Already declared above
            // const segmentProgress = (progress * (currentTrajectoryPoints.length - 1)) - pointIndex; // Already declared above

            const currentPoint = currentTrajectoryPoints[pointIndex];
            const nextPoint = currentTrajectoryPoints[nextPointIndex]; // Use the already declared nextPointIndex

            if (currentPoint && nextPoint) {
                // Interpolate ball position
                const interpolatedPosition = new THREE.Vector3().lerpVectors(
                    currentPoint,
                    nextPoint,
                    segmentProgress
                );
                if (ball) ball.position.copy(interpolatedPosition);

            } else {
                console.error(`Undefined vector encountered during animation: current=${currentPoint}, next=${nextPoint}, index=${pointIndex}, nextIndex=${nextPointIndex}`);
                isBallAnimating = false; // Stop animation on error
            }

            // Update trajectory line draw range
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

// --- Camera Update Function (called in animate loop) ---
function updateCamera(timestamp) {
    if (!camera || !ball) return;

    if (activeCameraMode === CameraMode.FOLLOW_BALL && isBallAnimating) {
        const targetPosition = new THREE.Vector3();
        const lookAtPosition = new THREE.Vector3();

        // Camera slightly behind and above the ball
        targetPosition.copy(ball.position).add(new THREE.Vector3(0, 3, -6)); // Offset from ball

        // Look at the ball's current position
        lookAtPosition.copy(ball.position);

        // Smoothly interpolate camera position and lookAt target
        camera.position.lerp(targetPosition, 0.05); // Adjust lerp factor for smoothness
        // To smoothly lookAt, we need to lerp the target point the camera is looking at,
        // then call lookAt() each frame. We'll store a temporary target.
        // This requires a variable outside this function scope, e.g., `cameraLookAtTarget`
        // For simplicity now, let's just look directly, which might be jittery.
        camera.lookAt(lookAtPosition);

    } else if (activeCameraMode === CameraMode.STATIC) {
        // Static camera is handled by the setCamera... functions, no per-frame update needed
        // unless we add smooth transitions *between* static views later.
    } else if (activeCameraMode === CameraMode.REVERSE_ANGLE) {
        // Position is set once by setCameraReverseAngle, no per-frame update needed.
    } else if (activeCameraMode === CameraMode.GREEN_FOCUS) {
        // Position is set once by setCameraGreenFocus, no per-frame update needed.
    }
    // Ensure projection matrix is updated if camera properties change
    // camera.updateProjectionMatrix(); // Usually only needed if FOV, aspect, near/far change
}


// --- Ball Visibility ---
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
        //console.log("Received trajectory points for animation 2:", points);
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

    // Reset camera to the default static view for the current mode
    // This might be redundant if resetVisuals in visuals.js handles it
    // setActiveCameraMode(CameraMode.STATIC); // Ensure mode is static
    // applyStaticCameraView(currentStaticView); // Re-apply the correct static view
}

// --- Camera Control Functions ---

// Sets the active camera mode and immediately applies starting position if needed
export function setActiveCameraMode(mode) {
    if (!Object.values(CameraMode).includes(mode)) {
        console.warn(`Attempted to set invalid camera mode: ${mode}`);
        return;
    }

    activeCameraMode = mode;
    console.log(`Camera mode set to: ${activeCameraMode}`);

    // If switching TO follow ball, immediately set the camera position relative to the current ball position
    if (mode === CameraMode.FOLLOW_BALL && camera && ball) {
        console.log("Setting initial follow ball camera position.");
        const targetPosition = new THREE.Vector3().copy(ball.position).add(new THREE.Vector3(0, 3, -6)); // Offset from ball
        const lookAtPosition = new THREE.Vector3().copy(ball.position);
        camera.position.copy(targetPosition); // Snap position
        camera.lookAt(lookAtPosition);      // Snap lookAt
    }
    // If switching away from follow, ensure ball animation doesn't control camera
    else if (mode !== CameraMode.FOLLOW_BALL) {
        // Potentially stop lerping if smooth lookAt was implemented
    }
}

// Applies a specific static camera view based on the stored type ('range', 'target', etc.)
// This is called by visuals.js when switching to static mode.
export function applyStaticCameraView(viewType = null) {
    const viewToApply = viewType || currentStaticView; // Use provided type or the stored one
    console.log(`Applying static camera view: ${viewToApply}`);
    activeCameraMode = CameraMode.STATIC; // Ensure mode is static

    switch (viewToApply) {
        case 'target':
            // Re-apply the target view using the stored Z distance
            if (currentTargetZ !== undefined) {
                setCameraForTargetView(currentTargetZ); // Call the setter with the stored value
            } else {
                console.error("applyStaticCameraView: Cannot apply target view, currentTargetZ is undefined.");
                // Fallback to range view?
                resetCameraPosition();
            }
            break;
        case 'chip':
            setCameraForChipView();
            break;
        case 'putt':
            setCameraForPuttView();
            break;
        case 'range':
        default:
            resetCameraPosition(); // Default to range view
            break;
    }
}


// --- Specific Camera Setters ---

// Sets camera to default Range view
export function resetCameraPosition() { // Renamed slightly for clarity (was default view)
    if (!camera) return;
    camera.position.set(0, 18, -25); // Raised Y, moved back Z
    camera.lookAt(0, 0, 80); // Look slightly further down range
    currentStaticView = 'range'; // Update stored static view type
    // activeCameraMode = CameraMode.STATIC; // Set by applyStaticCameraView or setActiveCameraMode
    console.log("Static camera set to: Range View");
}

// Sets camera for Target view
let currentTargetZ = 150; // Store target Z for potential re-application
export function setCameraForTargetView(targetZ = 150) {
    if (!camera) return;
    currentTargetZ = targetZ; // Store the Z distance
    const cameraHeight = 20;
    const cameraDistBack = targetZ + 30;
    camera.position.set(0, cameraHeight, targetZ - cameraDistBack);
    camera.lookAt(0, 0, targetZ / 1.5);
    currentStaticView = 'target'; // Update stored static view type
    // activeCameraMode = CameraMode.STATIC; // Set by applyStaticCameraView or setActiveCameraMode
    console.log(`Static camera set to: Target View (Z=${targetZ.toFixed(1)})`);
}

// Sets camera for Chip view
export function setCameraForChipView() {
    if (!camera) return;
    camera.position.set(0, 4, -8);
    camera.lookAt(0, 0, 20);
    currentStaticView = 'chip'; // Update stored static view type
    // activeCameraMode = CameraMode.STATIC; // Set by applyStaticCameraView or setActiveCameraMode
    console.log("Static camera set to: Chip View");
}

// Sets camera for Putt view
export function setCameraForPuttView() {
    if (!camera) return;
    // Use chip view settings for now
    camera.position.set(0, 4, -8);
    camera.lookAt(0, 0, 20);
    // Or define a slightly different putt-specific view later:
    // camera.position.set(0, 3, -6);
    // camera.lookAt(0, 0, 0);
    currentStaticView = 'putt'; // Update stored static view type
    // activeCameraMode = CameraMode.STATIC; // Set by applyStaticCameraView or setActiveCameraMode
    console.log("Static camera set to: Putt View");
}

// Sets camera for Reverse Angle view
export function setCameraReverseAngle(positionZ) {
    if (!camera) return;
    const cameraHeight = 10; // Height above ground
    const offsetBehind = 15; // Distance behind the target Z
    camera.position.set(0, cameraHeight, positionZ + offsetBehind);
    camera.lookAt(0, 0, 0); // Look back towards the tee (origin)
    setActiveCameraMode(CameraMode.REVERSE_ANGLE); // Set the mode
    console.log(`Camera set to: Reverse Angle (looking from Z=${(positionZ + offsetBehind).toFixed(1)})`);
}

// Sets camera for Green Focus view
export function setCameraGreenFocus(greenCenter, greenRadius) {
    if (!camera || !greenCenter || !greenRadius) return;
    // Example: Position camera overhead, slightly offset
    const cameraHeight = greenRadius * 2.5; // Adjust height based on green size
    const cameraOffsetZ = -greenRadius * 0.5; // Slight offset back from center

    camera.position.set(
        greenCenter.x,
        greenCenter.y + cameraHeight,
        greenCenter.z + cameraOffsetZ
    );
    camera.lookAt(greenCenter); // Look at the center of the green
    setActiveCameraMode(CameraMode.GREEN_FOCUS); // Set the mode
    console.log(`Camera set to: Green Focus (looking at ${greenCenter.z.toFixed(1)})`);
}

// --- Getters ---
export function getActiveCameraMode() {
    return activeCameraMode;
}
