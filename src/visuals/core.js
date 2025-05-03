import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { getShotDirectionAngle } from '../gameLogic/state.js'; // Import for aiming
// Import position getters needed for re-applying hole view camera
import { getCurrentBallPosition as getPlayHoleBallPosition } from '../modes/playHole.js';
import { getFlagPosition } from './holeView.js';

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
const BALL_PIVOT_POINT = new THREE.Vector3(0, BALL_RADIUS, 0); // Define pivot for standard views

// --- Helper Function for Rotation ---
// Rotates a point (Vector3) around a pivot (Vector3) on the XZ plane by an angle in degrees
function rotatePointAroundPivot(point, pivot, angleDegrees) {
    const angleRad = THREE.MathUtils.degToRad(angleDegrees);
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    // Translate point back to origin relative to pivot
    const translatedX = point.x - pivot.x;
    const translatedZ = point.z - pivot.z;

    // Rotate point
    const rotatedX = translatedX * cos - translatedZ * sin;
    const rotatedZ = translatedX * sin + translatedZ * cos;

    // Translate point back and return a new Vector3
    return new THREE.Vector3(rotatedX + pivot.x, point.y, rotatedZ + pivot.z);
}


export function initCoreVisuals(canvasElement) {
    console.log("Initializing core visuals on canvas:", canvasElement);

    // 1. Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue background
    // Increase fog start and far distance
    // scene.fog = new THREE.Fog(0x87CEEB, 150, 500); // Start further, end further // TEMP DISABLED

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
let cameraLookAtTarget = new THREE.Vector3(); // For smooth lookAt lerping

function updateCamera(timestamp) {
    if (!camera || !ball) return;

    const aimAngle = getShotDirectionAngle(); // Get current aim angle

    if (activeCameraMode === CameraMode.FOLLOW_BALL && isBallAnimating) {
        // Base offset (behind and above)
        const baseOffset = new THREE.Vector3(0, 3, -6);
        // Rotate the offset based on the aim angle around the Y-axis using applyAxisAngle
        const rotatedOffset = baseOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(aimAngle));

        // Calculate target camera position relative to the moving ball
        const targetPosition = new THREE.Vector3().copy(ball.position).add(rotatedOffset);

        // Look at the ball's current position
        const lookAtPosition = ball.position; // Direct lookAt for follow cam is usually fine

        // Smoothly interpolate camera position
        camera.position.lerp(targetPosition, 0.05); // Adjust lerp factor for smoothness
        camera.lookAt(lookAtPosition); // Look directly at the ball

    } else if (activeCameraMode === CameraMode.STATIC) {
        // Static camera position is set by the setCamera... functions.
        // Aiming adjustments for static cameras are applied *when aiming* via applyAimAngleToCamera,
        // not continuously in the update loop. No per-frame update needed here unless adding transitions.
        // unless we add smooth transitions *between* static views later.
    } else if (activeCameraMode === CameraMode.REVERSE_ANGLE) {
        // Position is set once by setCameraReverseAngle, no per-frame update needed.
    } else if (activeCameraMode === CameraMode.GREEN_FOCUS) {
        // Position is set once by setCameraGreenFocus, no per-frame update needed.
    }
    // Ensure projection matrix is updated if camera properties change
    // camera.updateProjectionMatrix(); // Usually only needed if FOV, aspect, near/far change
}

// --- Function to Apply Aim Angle (Called by Input Handler) ---
export function applyAimAngleToCamera() {
    if (!camera) return;
    const aimAngle = getShotDirectionAngle(); // Get the latest angle
    console.log(`Visuals: Applying aim angle ${aimAngle.toFixed(1)} to camera mode ${activeCameraMode}, static view: ${currentStaticView}`);

    if (activeCameraMode === CameraMode.STATIC) {
        // Re-apply the current static view using its dedicated setter function.
        // These setters already read the latest aimAngle internally.
        switch (currentStaticView) {
            case 'range':
                resetCameraPosition(); // Applies aim angle internally
                break;
            case 'chip':
                setCameraForChipView(); // Applies aim angle internally
                break;
            case 'putt':
                setCameraForPuttView(); // Applies aim angle internally
                break;
            case 'target':
                // Need the stored targetZ distance for this one
                if (currentTargetZ !== undefined) {
                    setCameraForTargetView(currentTargetZ); // Applies aim angle internally
                } else {
                     console.warn("applyAimAngleToCamera: Cannot re-apply target view, currentTargetZ is undefined. Resetting to range.");
                     resetCameraPosition();
                }
                break;
            case 'tee': // Tee view might also need its length parameter? For now, just call it.
                 setCameraForHoleTeeView(); // Applies aim angle internally
                 break;
            case 'hole':
                // This is the specific view set by setCameraBehindBallLookingAtTarget.
                // Re-setting requires current ball/target positions.
                const ballPos = getPlayHoleBallPosition();
                const targetPos = getFlagPosition();
                if (ballPos && targetPos) {
                    const ballPosVec3 = ballPos instanceof THREE.Vector3 ? ballPos : new THREE.Vector3(ballPos.x, ballPos.y, ballPos.z);
                    const distance = ballPosVec3.distanceTo(targetPos);
                    // Re-apply the specific hole view function with current positions and the new angle
                    setCameraBehindBallLookingAtTarget(ballPosVec3, targetPos, distance);
                } else {
                    console.warn("applyAimAngleToCamera: Could not get ball/target position for hole view update. Resetting to range.");
                    resetCameraPosition(); // Fallback if positions unavailable
                }
                break;
            default:
                 console.warn(`applyAimAngleToCamera: Unknown currentStaticView '${currentStaticView}'. Resetting to range.`);
                 resetCameraPosition();
                 break;
        }
    } else if (activeCameraMode === CameraMode.FOLLOW_BALL) {
        // If follow ball mode is active *before* the shot (not animating),
        // update its position based on the aim angle relative to the stationary ball.
        // Use the current ball position if available, otherwise default pivot.
        const pivot = ball ? ball.position.clone() : BALL_PIVOT_POINT.clone();

        // Base offset (behind and above)
        const baseOffset = new THREE.Vector3(0, 3, -6);
        // Rotate the offset
        const rotatedOffset = baseOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(aimAngle));
        // Calculate position relative to the pivot point
        const targetPosition = pivot.clone().add(rotatedOffset);
        // Look at the pivot point (or slightly ahead based on angle?)
        // For simplicity, look at the pivot (ball position)
        const lookAtTarget = pivot;

        camera.position.copy(targetPosition); // Snap position
        camera.lookAt(lookAtTarget);          // Snap lookAt
    }
    // Other modes (Reverse, Green) likely don't need aiming adjustments.
}


// --- Trajectory Line Removal ---
export function removeTrajectoryLine() {
    if (trajectoryLine && scene) { // Check if scene also exists
        scene.remove(trajectoryLine);
        trajectoryLine.geometry.dispose();
        trajectoryLine.material.dispose();
        trajectoryLine = null;
        console.log("Trajectory line removed.");
    }
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

    // If switching TO follow ball, set the camera position relative to the current ball position,
    // UNLESS it was just pre-positioned by setInitialFollowCameraLookingAtTarget (indicated by currentStaticView === 'hole')
    if (mode === CameraMode.FOLLOW_BALL && camera && ball) {
        if (currentStaticView !== 'hole') { // Check if not pre-positioned for hole view
            console.log("Setting default initial follow ball camera position.");
            const targetPosition = new THREE.Vector3().copy(ball.position).add(new THREE.Vector3(0, 3, -6)); // Default offset from ball
            const lookAtPosition = new THREE.Vector3().copy(ball.position); // Look at ball
            camera.position.copy(targetPosition); // Snap position
            camera.lookAt(lookAtPosition);      // Snap lookAt
        } else {
             console.log("Skipping default follow ball setup; using pre-positioned hole view.");
             // Reset currentStaticView so subsequent static camera calls work correctly
             // Or maybe we don't need to? Let's leave it for now. If static view '1' breaks after using '2', we might need to reset it here.
        }
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
        case 'tee': // Add case for the hole tee view (overview)
            setCameraForHoleTeeView();
            break;
        case 'hole': // Add case for the behind-ball hole view
            // This view is set dynamically by setCameraBehindBallLookingAtTarget,
            // This case should ideally not be hit directly when aiming anymore,
            // as applyAimAngleToCamera handles it. But keep the warning just in case.
            console.warn("applyStaticCameraView('hole') called. This view should be set via setCameraBehindBallLookingAtTarget.");
            // Avoid resetting to range here if called during aiming adjustment.
            // The logic in applyAimAngleToCamera should handle re-applying the view correctly.
            // If we reach here some other way, maybe a different fallback is needed?
            // For now, let's just log the warning and do nothing to prevent the jump.
            // resetCameraPosition(); // Avoid resetting to range
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
    const aimAngle = getShotDirectionAngle();
    const pivot = BALL_PIVOT_POINT;

    // Base position and lookAt relative to pivot (0,0,0) before rotation
    const baseCamPos = new THREE.Vector3(0, 18, -25);
    const baseLookAt = new THREE.Vector3(0, 0, 80);

    // Rotate points around the pivot
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos.add(pivot), pivot, aimAngle);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAt.add(pivot), pivot, aimAngle);

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt);
    currentStaticView = 'range'; // Update stored static view type
    console.log(`Static camera set to: Range View (Angle: ${aimAngle.toFixed(1)})`);
}

// Sets camera for Target view
let currentTargetZ = 150; // Store target Z for potential re-application
export function setCameraForTargetView(targetZ = 150) {
    if (!camera) return;
    currentTargetZ = targetZ; // Store the Z distance
    const aimAngle = getShotDirectionAngle();
    const pivot = BALL_PIVOT_POINT; // Assume aiming relative to the ball at the tee

    // Base position and lookAt relative to pivot (0,0,0) before rotation
    const cameraHeight = 20;
    const cameraDistBack = 30; // Distance behind the target Z plane
    const baseCamPos = new THREE.Vector3(0, cameraHeight, targetZ - cameraDistBack);
    const baseLookAt = new THREE.Vector3(0, 0, targetZ / 1.5); // Look towards target Z

    // Rotate points around the pivot
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos.add(pivot), pivot, aimAngle);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAt.add(pivot), pivot, aimAngle);

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt);
    currentStaticView = 'target'; // Update stored static view type
    console.log(`Static camera set to: Target View (Z=${targetZ.toFixed(1)}, Angle: ${aimAngle.toFixed(1)})`);
}

// Sets camera for Chip view
export function setCameraForChipView() {
    if (!camera) return;
    const aimAngle = getShotDirectionAngle();
    const pivot = ball ? ball.position.clone() : BALL_PIVOT_POINT.clone(); // Pivot around current ball pos if available

    // Base position and lookAt relative to pivot before rotation
    const baseCamPos = new THREE.Vector3(0, 4, -8);
    const baseLookAt = new THREE.Vector3(0, 0, 20);

    // Rotate points around the pivot
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos.add(pivot), pivot, aimAngle);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAt.add(pivot), pivot, aimAngle);

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt);
    currentStaticView = 'chip'; // Update stored static view type
    console.log(`Static camera set to: Chip View (Angle: ${aimAngle.toFixed(1)})`);
}

// Sets camera for Putt view
export function setCameraForPuttView() {
    if (!camera) return;
    const aimAngle = getShotDirectionAngle();
    const pivot = ball ? ball.position.clone() : BALL_PIVOT_POINT.clone(); // Pivot around current ball pos if available

    // Use chip view settings for now
    const baseCamPos = new THREE.Vector3(0, 4, -8);
    const baseLookAt = new THREE.Vector3(0, 0, 20);

    // Rotate points around the pivot
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos.add(pivot), pivot, aimAngle);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAt.add(pivot), pivot, aimAngle);

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt);
    currentStaticView = 'putt'; // Update stored static view type
    console.log(`Static camera set to: Putt View (Angle: ${aimAngle.toFixed(1)})`);
}

// Sets camera for Hole Tee view (overview)
export function setCameraForHoleTeeView(holeLengthYards = 400) {
    if (!camera) return;
    const aimAngle = getShotDirectionAngle(); // Allow aiming from tee view? Maybe not needed, but include for consistency.
    const pivot = BALL_PIVOT_POINT; // Pivot around tee box

    const holeLengthMeters = holeLengthYards * YARDS_TO_METERS;
    // Base position and lookAt relative to pivot before rotation
    const baseCamPos = new THREE.Vector3(0, 30, -40);
    const baseLookAt = new THREE.Vector3(0, 5, holeLengthMeters * 0.6);

    // Rotate points around the pivot
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos.add(pivot), pivot, aimAngle);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAt.add(pivot), pivot, aimAngle);

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt);
    currentStaticView = 'tee'; // Update stored static view type
    console.log(`Static camera set to: Hole Tee View (Angle: ${aimAngle.toFixed(1)}, looking towards Z=${(holeLengthMeters * 0.6).toFixed(1)})`);
}

// Sets camera behind the ball, looking directly at a target, adjusting distance based on proximity
// This function ALREADY calculates position relative to ball/target, so we just need to apply the aim angle rotation *around the ballPosition* at the end.
export function setCameraBehindBallLookingAtTarget(ballPosition, targetPosition, distanceToTarget) {
    if (!camera || !ballPosition || !targetPosition || distanceToTarget === undefined) return;

    const aimAngle = getShotDirectionAngle();
    const pivot = ballPosition.clone(); // Pivot around the current ball position

    // --- Calculate Base Position and LookAt (as before) ---
    // Define min/max values for interpolation
    const maxDist = 50; // Distance at which interpolation starts/ends
    const minDistBehind = 8; // Distance behind ball at 0m distance (like chip)
    const maxDistBehind = 25; // Distance behind ball at maxDist or greater
    const minHeight = 4;    // Height at 0m distance (like chip)
    const maxHeight = 18;   // Height at maxDist or greater

    // Clamp distance and calculate interpolation factor (0 = close, 1 = far)
    const clampedDistance = Math.min(distanceToTarget, maxDist);
    const interpFactor = clampedDistance / maxDist; // Goes from 0 to 1 as distance increases

    // Interpolate distanceBehind and cameraHeight
    const distanceBehind = THREE.MathUtils.lerp(minDistBehind, maxDistBehind, interpFactor);
    const cameraHeight = THREE.MathUtils.lerp(minHeight, maxHeight, interpFactor);

    console.log(`Distance: ${distanceToTarget.toFixed(1)}m, Interp: ${interpFactor.toFixed(2)}, DistBehind: ${distanceBehind.toFixed(1)}, Height: ${cameraHeight.toFixed(1)}`);

    // Calculate direction from target to ball (ignoring y for direction calculation)
    const direction = new THREE.Vector3(ballPosition.x - targetPosition.x, 0, ballPosition.z - targetPosition.z).normalize();

    // Calculate base camera position (before rotation)
    const baseCamPos = new THREE.Vector3()
        .copy(ballPosition)
        .addScaledVector(direction, distanceBehind) // Move back along the direction vector
        .add(new THREE.Vector3(0, cameraHeight, 0)); // Add height

    // Base lookAt is the target position (before rotation)
    const baseLookAt = targetPosition.clone();

    // --- Rotate Position and LookAt around the ball (pivot) ---
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos, pivot, aimAngle);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAt, pivot, aimAngle); // Rotate the lookAt target as well

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt); // Look at the rotated target point
    currentStaticView = 'hole'; // Update stored static view type
    setActiveCameraMode(CameraMode.STATIC); // Ensure mode is static

    console.log(`Static camera set to: Hole View (Angle: ${aimAngle.toFixed(1)}, behind ball at ${ballPosition.z.toFixed(1)}, looking towards ${targetPosition.z.toFixed(1)})`);
}

// Sets the initial position and lookAt for the follow camera, aiming at a target
// This should also incorporate the aim angle.
export function setInitialFollowCameraLookingAtTarget(ballPosition, targetPosition) {
    if (!camera || !ballPosition || !targetPosition) return;

    const aimAngle = getShotDirectionAngle();
    const pivot = ballPosition.clone(); // Pivot around the ball

    const distanceBehind = 6; // How far behind the ball
    const cameraHeight = 3;   // How high above the ball's plane

    // Calculate direction from target to ball (ignoring y for direction)
    const direction = new THREE.Vector3(ballPosition.x - targetPosition.x, 0, ballPosition.z - targetPosition.z).normalize();

     // Calculate base camera position (before rotation)
    const baseCamPos = new THREE.Vector3()
        .copy(ballPosition)
        .addScaledVector(direction, distanceBehind) // Move back along the direction vector
        .add(new THREE.Vector3(0, cameraHeight, 0)); // Add height

    // Base lookAt is the target position (before rotation)
    const baseLookAt = targetPosition.clone();

    // --- Rotate Position and LookAt around the ball (pivot) ---
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos, pivot, aimAngle);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAt, pivot, aimAngle);

    camera.position.copy(rotatedCamPos);   // Set initial position
    camera.lookAt(rotatedLookAt); // Set initial lookAt
    currentStaticView = 'hole'; // Set flag to indicate pre-positioning

    // DO NOT change activeCameraMode here, let the calling function do that
    console.log(`Initial follow camera position set (Angle: ${aimAngle.toFixed(1)}) behind ball at ${ballPosition.z.toFixed(1)}, looking towards ${targetPosition.z.toFixed(1)}`);
}

// Sets camera for Reverse Angle view - Aiming likely not applicable here
export function setCameraReverseAngle(positionZ) {
    if (!camera) return;
    const cameraHeight = 10; // Height above ground
    const offsetBehind = 15; // Distance behind the target Z
    camera.position.set(0, cameraHeight, positionZ + offsetBehind);
    camera.lookAt(0, 0, 0); // Look back towards the tee (origin)
    setActiveCameraMode(CameraMode.REVERSE_ANGLE); // Set the mode
    console.log(`Camera set to: Reverse Angle (looking from Z=${(positionZ + offsetBehind).toFixed(1)})`);
}

// Sets camera for Green Focus view - Aiming likely not applicable here
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

// Sets camera to a static view behind a specific target position, mimicking chip/putt/range views
// This function is likely superseded by setCameraBehindBallLookingAtTarget or the specific view setters,
// but let's update it for aiming consistency.
export function setCameraBehindBall(targetPosition, viewType = 'range') {
    if (!camera || !targetPosition) return;

    // Ensure targetPosition is a THREE.Vector3
    const targetPosVec3 = targetPosition instanceof THREE.Vector3 ? targetPosition : new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z);

    const aimAngle = getShotDirectionAngle();
    const pivot = targetPosVec3.clone(); // Pivot around the target position (ball) - Use Vector3

    let baseCamPos = new THREE.Vector3();
    let baseLookAtPos = new THREE.Vector3();

    // Determine base offset based on view type (relative to pivot)
    switch (viewType) {
        case 'chip':
        case 'putt':
            baseCamPos.set(0, 4, -8);
            baseLookAtPos.set(0, 0, 12); // Look a bit further than the ball
            currentStaticView = viewType;
            break;
        case 'range':
        default:
            baseCamPos.set(0, 18, -25);
            baseLookAtPos.set(0, 0, 55); // Look further down
            currentStaticView = 'range';
            break;
    }

    // Rotate points around the pivot
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos.add(pivot), pivot, aimAngle); // baseCamPos is relative, add pivot before rotating
    const rotatedLookAt = rotatePointAroundPivot(baseLookAtPos.add(pivot), pivot, aimAngle); // baseLookAtPos is relative, add pivot before rotating

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt);
    setActiveCameraMode(CameraMode.STATIC); // Ensure mode is static

    console.log(`Static camera set behind ball (Angle: ${aimAngle.toFixed(1)}) at (${targetPosVec3.x.toFixed(1)}, ${targetPosVec3.z.toFixed(1)}) with view type: ${currentStaticView}`);
}

// Snaps the follow camera instantly to its starting offset relative to a target position
// This should also incorporate the aim angle.
export function snapFollowCameraToBall(targetPosition) {
    if (!camera || !targetPosition || activeCameraMode !== CameraMode.FOLLOW_BALL) return;

     // Ensure targetPosition is a THREE.Vector3
    const targetPosVec3 = targetPosition instanceof THREE.Vector3 ? targetPosition : new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z);

    const aimAngle = getShotDirectionAngle();
    const pivot = targetPosVec3.clone(); // Pivot around the target position - Use Vector3

    console.log(`Snapping follow ball camera position (Angle: ${aimAngle.toFixed(1)}).`);
    const baseOffset = new THREE.Vector3(0, 3, -6); // Standard follow offset
    // Rotate the offset
    const rotatedOffset = baseOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(aimAngle));
    // Calculate position relative to the pivot
    const camPos = pivot.clone().add(rotatedOffset);
    const lookAtPos = pivot; // Look at the ball

    camera.position.copy(camPos); // Snap position
    camera.lookAt(lookAtPos);      // Snap lookAt
}


// --- Getters ---
export function getActiveCameraMode() {
    return activeCameraMode;
}
