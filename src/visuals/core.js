import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { TextureLoader } from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js'; // Import TextureLoader
// Import both relative and target line angles
import { getShotDirectionAngle, getCurrentTargetLineAngle, getSelectedClub } from '../gameLogic/state.js';
import * as MeasurementView from './measurementView.js';
// Import position getters needed for re-applying hole view camera
import { getCurrentBallPosition as getPlayHoleBallPosition } from '../modes/playHole.js';
import { getFlagPosition as getHoleFlagPosition, getCurrentHoleObjects } from './holeView.js'; // Import getCurrentHoleObjects
import { getTargetObjects, getFlagPosition as getTargetFlagPosition } from './targetView.js'; // Import target view objects and flag position for CTF mode
import { createTeeMesh } from './objects.js'; // Import the tee creator
import { getSurfaceProperties } from '../surfaces.js'; // Import surface properties getter

import { YARDS_TO_METERS } from '../utils/unitConversions.js';

export let scene, camera, renderer, ball, trajectoryLine, teeMesh, smallTeeMesh; // Add teeMesh and smallTeeMesh
// export const BALL_RADIUS = 0.2; // Old, incorrect value
export const BALL_RADIUS = 0.021336; // Regulation radius (1.68 inches / 2) in meters

// Ball Scale Factors for Visibility
const BALL_SCALE_NORMAL = 1.0; // Scale for on the green
const BALL_SCALE_ENLARGED = 10.0; // Scale for off the green (Adjust as needed)
const BALL_SCALE_VECTOR_NORMAL = new THREE.Vector3(BALL_SCALE_NORMAL, BALL_SCALE_NORMAL, BALL_SCALE_NORMAL);
const BALL_SCALE_VECTOR_ENLARGED = new THREE.Vector3(BALL_SCALE_ENLARGED, BALL_SCALE_ENLARGED, BALL_SCALE_ENLARGED);


// Camera Modes
export const CameraMode = {
    STATIC: 'static',
    FOLLOW_BALL: 'follow_ball',
    REVERSE_ANGLE: 'reverse_angle',
    GREEN_FOCUS: 'green_focus',
};
let activeCameraMode = CameraMode.STATIC;
let currentStaticView = 'range'; // 'range', 'target', 'chip', 'putt', 'tee', 'hole' - Tracks the *current* static view setting

// Static Camera Zoom State
const DEFAULT_STATIC_ZOOM_LEVEL = 0.5;
const DEFAUTLT_STATIC_PUTT_ZOOM_LEVEL = 0.1; // Default zoom level for putt view
const STATIC_ZOOM_STEP = 0.1;
const STATIC_ZOOM_MIN_LEVEL = 0.0;
const STATIC_ZOOM_MAX_LEVEL = 1.0;
const STATIC_ZOOM_MIN_DIST_FACTOR = 0.15; // Multiplier for base distance when fully zoomed in
const STATIC_ZOOM_MAX_DIST_FACTOR = 3.0; // Multiplier for base distance when fully zoomed out
const STATIC_ZOOM_MIN_HEIGHT = BALL_RADIUS + 0.5; // Minimum height above ball radius
const STATIC_ZOOM_MAX_HEIGHT = 25.0; // Maximum height in meters
const STATIC_ZOOM_MAX_HEIGHT_THRESHOLD = 1.0; // Zoom level at which max height is reached
// let staticCameraZoomLevel = DEFAULT_STATIC_ZOOM_LEVEL; // Deprecated
let staticCameraHeightLevel = DEFAULT_STATIC_ZOOM_LEVEL; // New: Controls height
let staticCameraDistanceLevel = DEFAULT_STATIC_ZOOM_LEVEL; // New: Controls distance/zoom
let staticCameraZoomLevelPutt = DEFAUTLT_STATIC_PUTT_ZOOM_LEVEL; // Putt view zoom level

// Animation state
let isBallAnimating = false;
let ballAnimationStartTime = 0;
let ballAnimationDuration = 1500; // Total duration in milliseconds (from timestamps)
let currentTrajectoryPoints = [];
let currentAnimationCallback = null; // Add variable to store the callback
let currentIsHoledOut = false; // Added for holed-out state
let currentHoledOutPosition = null; // Added for holed-out state
let hasLandedDuringAnimation = false; // Track if ball has landed to show carry data
const BALL_PIVOT_POINT = new THREE.Vector3(0, BALL_RADIUS, 0); // Define pivot for standard views

// --- Helper Function for Rotation ---
// Rotates a point (Vector3) around a pivot (Vector3) on the XZ plane by an angle in degrees
function rotatePointAroundPivot(point, pivot, angleDegrees) {
    const angleRad = THREE.MathUtils.degToRad(-angleDegrees); // Negate the angle (Keep negation for reversed controls)
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
    const textureLoader = new TextureLoader();
    const ballTexture = textureLoader.load('assets/textures/golf_ball.jpg');
    const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
    // Apply the texture to the material
    const ballMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff, // Keep white base color, texture will overlay
        map: ballTexture
     });
     ball = new THREE.Mesh(ballGeometry, ballMaterial);
     ball.castShadow = true;
     // ball.renderOrder = 1; // REMOVED - Will use polygonOffset on terrain instead
     ball.scale.copy(BALL_SCALE_VECTOR_ENLARGED); // Start with enlarged scale
     scene.add(ball);

    // 6. Tee Meshes (created but hidden initially)
    teeMesh = createTeeMesh('large'); // Large tee for driver/woods
    smallTeeMesh = createTeeMesh('small'); // Small tee for irons/hybrids
    scene.add(teeMesh);
    scene.add(smallTeeMesh);

    // Position ball and potentially tee initially
    showBallAtAddress();

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Start render loop
    animate();


    // Return essential elements needed by other modules
    return { scene, camera, renderer, ball };
}

export function onWindowResize() {
    if (!renderer || !camera) {
        console.warn("onWindowResize: Renderer or Camera not available.");
        return;
    }
    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const newWidth = rect.width;
    const newHeight = rect.height;


    if (newHeight === 0) {
        console.warn("onWindowResize: Canvas clientHeight is 0, skipping update to prevent NaN aspect ratio.");
        return;
    }

    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(newWidth, newHeight, false);

    // Explicitly render the scene with the updated camera and renderer size
    // Determine which camera is active for rendering (main or measurement view)
    const activeRenderCamera = MeasurementView.isViewActive() && MeasurementView.getCamera() ? MeasurementView.getCamera() : camera;
    if (scene && activeRenderCamera) { // Ensure scene and an active camera exist
        renderer.render(scene, activeRenderCamera);
    }
}

function animate(timestamp) {
    if (!renderer) return; // Ensure renderer exists
    requestAnimationFrame(animate);

    // --- Camera Update Logic ---
    updateCamera(timestamp); // Call camera update logic each frame

    // --- Ball Flight Animation Logic (Time-Based) ---
    if (isBallAnimating) {
        const elapsedTime = timestamp - ballAnimationStartTime;
        const currentTime = elapsedTime / 1000; // Convert to seconds to match trajectory timestamps

        if (currentTrajectoryPoints.length > 0) {
            // Find the two points that bracket the current time
            let pointIndex = 0;
            for (let i = 0; i < currentTrajectoryPoints.length - 1; i++) {
                if (currentTrajectoryPoints[i].time <= currentTime && currentTrajectoryPoints[i + 1].time > currentTime) {
                    pointIndex = i;
                    break;
                }
                // If we've passed all timestamps, use the last segment
                if (i === currentTrajectoryPoints.length - 2) {
                    pointIndex = i;
                }
            }

            const currentPoint = currentTrajectoryPoints[pointIndex];
            const nextPoint = currentTrajectoryPoints[Math.min(pointIndex + 1, currentTrajectoryPoints.length - 1)];

            if (currentPoint && nextPoint && currentPoint.time !== undefined && nextPoint.time !== undefined) {
                // Calculate interpolation factor based on time
                const timeDelta = nextPoint.time - currentPoint.time;
                const segmentProgress = timeDelta > 0 ? (currentTime - currentPoint.time) / timeDelta : 1;

                // Interpolate ball position based on time
                const interpolatedPosition = new THREE.Vector3().lerpVectors(
                    currentPoint,
                    nextPoint,
                    Math.max(0, Math.min(1, segmentProgress))
                );
                if (ball) {
                    ball.position.copy(interpolatedPosition);

                    // Detect when ball lands (y position close to BALL_RADIUS, which is ground level)
                    // Only trigger once per shot
                    if (!hasLandedDuringAnimation && interpolatedPosition.y <= BALL_RADIUS + 0.1) {
                        hasLandedDuringAnimation = true;
                        // Import and call UI function to show carry data
                        import('../ui.js').then(ui => {
                            ui.showShotCarryData();
                        });
                    }
                }

            } else {
                console.error(`Invalid trajectory point or missing timestamp: current=${currentPoint}, next=${nextPoint}`);
                isBallAnimating = false; // Stop animation on error
            }

            // Update trajectory line draw range based on current point index
            if (trajectoryLine) {
                const drawCount = Math.min(pointIndex + 2, currentTrajectoryPoints.length);
                if (drawCount >= 0 && drawCount <= currentTrajectoryPoints.length) {
                    trajectoryLine.geometry.setDrawRange(0, drawCount);
                }
            }
        }

        // Check if animation is complete (current time >= total duration)
        if (currentTime >= ballAnimationDuration / 1000) {
            isBallAnimating = false;

            let trueFinalBallPosition;
            if (currentIsHoledOut && currentHoledOutPosition) {
                trueFinalBallPosition = currentHoledOutPosition;
            } else if (currentTrajectoryPoints.length > 0) {
                trueFinalBallPosition = currentTrajectoryPoints[currentTrajectoryPoints.length - 1];
            }

            if (ball && trueFinalBallPosition) {
                ball.position.copy(trueFinalBallPosition);
            }

            if (trajectoryLine) {
                // Draw the line to the end of the calculated trajectory.
                // If holed out, currentTrajectoryPoints should already end at the hole.
                if (currentTrajectoryPoints.length > 0) { // Ensure there are points to draw
                    trajectoryLine.geometry.setDrawRange(0, currentTrajectoryPoints.length);
                } else {
                    trajectoryLine.geometry.setDrawRange(0, 0); // No points, draw nothing
                }
            }
             // Execute the callback if it exists
             if (currentAnimationCallback) {
                 currentAnimationCallback();
                 currentAnimationCallback = null; // Clear callback after execution
             }
         }
     }

    // Determine which camera to use for rendering
    const activeRenderCamera = MeasurementView.isViewActive() ? MeasurementView.getCamera() : camera;
    if (activeRenderCamera) { // Ensure there's a camera to render with
        // Add occasional debug logging
        if (Math.random() < 0.001) { // Log ~once per second at 60fps
        }
        renderer.render(scene, activeRenderCamera);
    } else {
        // This case should ideally not happen if MeasurementView.init ensures its camera is created
        // and 'camera' (main perspective) is always available after core init.
        console.warn("No active camera available for rendering.");
    }
}

// --- Camera Update Function (called in animate loop) ---
let cameraLookAtTarget = new THREE.Vector3(); // For smooth lookAt lerping

function updateCamera(timestamp) {
    if (!camera || !ball) return;

    // Calculate the total absolute aim angle for camera rotation during animation
    const totalAimAngle = getCurrentTargetLineAngle() + getShotDirectionAngle();

    if (activeCameraMode === CameraMode.FOLLOW_BALL && isBallAnimating) {
        // Base offset (behind, above, and slightly to the right)
        const baseOffset = new THREE.Vector3(2, 3, -6); // Changed X from 0 to 2
        // Rotate the offset based on the TOTAL aim angle around the Y-axis using applyAxisAngle
        // Keep negation for reversed controls
        const rotatedOffset = baseOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(-totalAimAngle));

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
    } else if (activeCameraMode === CameraMode.REVERSE_ANGLE) {
        // Position is set once by setCameraReverseAngle, no per-frame update needed.
    } else if (activeCameraMode === CameraMode.GREEN_FOCUS) {
        // Position is set once by setCameraGreenFocus, no per-frame update needed.
    }
    // Ensure projection matrix is updated if camera properties change
    // camera.updateProjectionMatrix(); // Usually only needed if FOV, aspect, near/far change
}

// Helper to get flag position based on current mode
function getFlagPosition() {
    if (currentStaticView === 'target') {
        return getTargetFlagPosition(); // CTF mode
    } else {
        return getHoleFlagPosition(); // Play-hole mode
    }
}

// --- Function to Apply Aim Angle (Called by Input Handler) ---
export function applyAimAngleToCamera() {
    if (!camera) return;
    // Calculate the total absolute aim angle for camera rotation
    const totalAimAngle = getCurrentTargetLineAngle() + getShotDirectionAngle();

    if (activeCameraMode === CameraMode.STATIC) {
        // Re-apply the current static view using its dedicated setter function.
        // Pass the TOTAL angle now.
        switch (currentStaticView) {
            case 'range':
                resetCameraPosition(totalAimAngle); // Pass total angle
                break;
            case 'chip':
                setCameraForChipView(totalAimAngle); // Pass total angle
                break;
            case 'putt':
                setCameraForPuttView(totalAimAngle); // Pass total angle
                break;
            case 'target':
                // Need the stored targetZ distance for this one
                if (currentTargetZ !== undefined) {
                    setCameraForTargetView(currentTargetZ, totalAimAngle); // Pass total angle
                } else {
                     console.warn("applyAimAngleToCamera: Cannot re-apply target view, currentTargetZ is undefined. Resetting to range.");
                     resetCameraPosition(0); // Reset with 0 angle
                }
                break;
            case 'tee': // Tee view might also need its length parameter? For now, just call it.
                 setCameraForHoleTeeView(undefined, totalAimAngle); // Pass total angle (undefined for length)
                 break;
            case 'hole':
                // This is the specific view set by setCameraBehindBallLookingAtTarget.
                // Re-setting requires current ball/target positions.
                const ballPos = getPlayHoleBallPosition();
                const targetPos = getFlagPosition();
                // --- DEBUG LOGGING ---
                // --- END DEBUG LOGGING ---
                if (ballPos && targetPos) {
                    const ballPosVec3 = ballPos instanceof THREE.Vector3 ? ballPos : new THREE.Vector3(ballPos.x, ballPos.y, ballPos.z);
                    const distance = ballPosVec3.distanceTo(targetPos);
                    // Re-apply the specific hole view function with current positions and the new angle
                    // *** FIX 1: Ensure totalAimAngle is passed ***
                    setCameraBehindBallLookingAtTarget(ballPosVec3, targetPos, distance, totalAimAngle);
                } else {
                    console.warn("applyAimAngleToCamera: Could not get ball/target position for hole view update. Resetting to range.");
                    resetCameraPosition(0); // Fallback if positions unavailable (reset with 0 angle)
                }
                break;
            default:
                 console.warn(`applyAimAngleToCamera: Unknown currentStaticView '${currentStaticView}'. Resetting to range.`);
                 resetCameraPosition(0); // Reset with 0 angle
                 break;
        }
    } else if (activeCameraMode === CameraMode.FOLLOW_BALL && !isBallAnimating) {
        // --- Follow Cam Aiming BEFORE Shot ---
        // *** FIX 2: Replace logic for aiming before shot ***
        const ballPos = ball ? ball.position.clone() : null; // Use current ball position
        const targetPos = getFlagPosition(); // Get the actual target (flag)

        if (ballPos && targetPos) {
            const pivot = ballPos;
            const distanceBehind = 6; // Use consistent offset
            const cameraHeight = 3;   // Use consistent offset

            // Calculate direction from target to ball (this implicitly includes currentTargetLineAngle)
            // We need a base position assuming 0 degrees, then rotate by totalAimAngle
            const baseDirection = new THREE.Vector3(0, 0, 1); // Standard direction (down +Z)
            const baseOffsetVector = baseDirection.clone().multiplyScalar(-distanceBehind); // Go backwards along Z
            baseOffsetVector.y = cameraHeight; // Add height

            const baseCamPos = pivot.clone().add(baseOffsetVector); // Base position relative to pivot at 0 degrees

            // Base LookAt: Should be a point far ahead along the 0-degree line from the pivot
            const baseLookAtTargetPoint = pivot.clone().add(new THREE.Vector3(0, 0, 100)); // Look 100 units down +Z from pivot

            // Rotate Position and LookAt around the ball (pivot) using the total angle
            const rotatedCamPos = rotatePointAroundPivot(baseCamPos, pivot, totalAimAngle);
            const rotatedLookAt = rotatePointAroundPivot(baseLookAtTargetPoint, pivot, totalAimAngle); // Rotate lookAt too!

            camera.position.copy(rotatedCamPos); // Snap position
            camera.lookAt(rotatedLookAt);        // Snap lookAt to rotated target point
        } else {
            console.warn("applyAimAngleToCamera (FOLLOW_BALL aiming): Could not get ball/target position for update.");
            // Optional: Add fallback if needed
        }
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
    }
}

// --- Ball and Tee Visibility/Positioning ---
export function showBallAtAddress(position = null, surfaceType = null) {
    if (!ball) return;

    // Use provided position or default tee box position
    // Create a new Vector3 from the plain object if position is provided
    const ballPos = position
        ? new THREE.Vector3(position.x, position.y, position.z)
        : new THREE.Vector3(0, 0, 0); // Default if position is null (Y will be calculated below)

    // Determine surface type. Use provided type, otherwise default to 'TEE'
    // If a specific position was given, we should ideally determine the surface there,
    // but for now, we'll allow overriding or default to TEE.
    const currentSurface = surfaceType || 'TEE'; // Default to TEE if not specified

    // Set ball scale based on surface type
    // Ball should be small (normal scale) only on green, enlarged everywhere else
    const isOnGreen = currentSurface.toUpperCase() === 'GREEN';
    setBallScale(!isOnGreen); // Enlarged if NOT on green

    // --- Tee Visibility and Positioning ---
    let teeHeightOffset = 0; // Additional height from tee
    if (teeMesh && smallTeeMesh) {
        if (currentSurface.toUpperCase() === 'TEE') {
            // Determine tee size based on club type
            const selectedClub = getSelectedClub();
            const clubType = selectedClub?.type || 'iron';
            const useLargeTee = clubType === 'driver' || clubType === 'wood';

            // Tee heights accounting for 10x ball scale (visual representation)
            // The ball is scaled 10x for visibility, so tee height needs similar scaling
            const largeTeeHeight = 0.50; // 50mm tee with 10x visual scale
            const smallTeeHeight = 0.15; // 15mm tee with 10x visual scale
            teeHeightOffset = useLargeTee ? largeTeeHeight : smallTeeHeight;

            // Position and show appropriate tee
            const activeTee = useLargeTee ? teeMesh : smallTeeMesh;
            const inactiveTee = useLargeTee ? smallTeeMesh : teeMesh;

            // Get terrain height at ball position (ballPos.y already includes it from playHole)
            const terrainHeight = ballPos.y - BALL_RADIUS; // Extract terrain height from ball position
            activeTee.position.set(ballPos.x, terrainHeight, ballPos.z);
            activeTee.visible = true;
            inactiveTee.visible = false;

        } else {
            teeMesh.visible = false;
            smallTeeMesh.visible = false;
        }
    }

    // Adjust ball Y position based on surface offset and tee height
    // This is crucial for placing the ball correctly *before* the shot
    // ballPos.y already contains terrain height + BALL_RADIUS from playHole.js
    const surfaceProps = typeof getSurfaceProperties === 'function' ? getSurfaceProperties(currentSurface) : null;
    if (surfaceProps && typeof surfaceProps.ballLieOffset === 'number' && surfaceProps.ballLieOffset !== -1) {
        // Add surface offset and tee height to the existing position
        ballPos.y = ballPos.y + surfaceProps.ballLieOffset + teeHeightOffset;
    } else {
        // Just add tee height offset if on tee
        ballPos.y = ballPos.y + teeHeightOffset;
    }

    ball.position.copy(ballPos);
    ball.visible = true;
}

// Function to hide the ball and tee
export function hideBall() {
    if (ball) {
        ball.visible = false;
    }
    if (teeMesh) {
        teeMesh.visible = false;
    }
    if (smallTeeMesh) {
        smallTeeMesh.visible = false;
    }
}

// Function to handle the animation logic, potentially called by visuals.js
export function startBallAnimation(points, duration, onCompleteCallback = null, isHoledOut = false, holedOutPosition = null, trajectoryColor = 0xffff00) { // Add callback, isHoledOut, holedOutPosition, and color parameters
     if (!scene) return; // Guard against uninitialized scene

    // Store the callback and holed-out state
    currentAnimationCallback = onCompleteCallback;
    currentIsHoledOut = isHoledOut;
    currentHoledOutPosition = holedOutPosition ? new THREE.Vector3(holedOutPosition.x, holedOutPosition.y, holedOutPosition.z) : null;

    if (currentIsHoledOut) {
    }

    // Remove previous line if it exists
    if (trajectoryLine) {
        scene.remove(trajectoryLine);
        trajectoryLine.geometry.dispose();
        trajectoryLine.material.dispose();
        trajectoryLine = null;
    }

    if (points && points.length > 0) {

        // Verify timestamps are present
        const firstTime = points[0].time;
        const lastTime = points[points.length - 1].time;

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color: trajectoryColor, linewidth: 3 });
        trajectoryLine = new THREE.Line(geometry, material);
        trajectoryLine.geometry.setDrawRange(0, 0);
        scene.add(trajectoryLine);

        ballAnimationDuration = duration;

        currentTrajectoryPoints = points; // Store Vector3 points with timestamps
        isBallAnimating = true;
        hasLandedDuringAnimation = false; // Reset landing flag for new shot
        ballAnimationStartTime = performance.now();
    } else {
        console.warn("No trajectory data received for animation.");
    }
}


export function resetCoreVisuals() {
     if (!scene) return; // Guard against uninitialized scene

    // Remove trajectory line if it exists
    if (trajectoryLine) {
        scene.remove(trajectoryLine);
        trajectoryLine.geometry.dispose();
        trajectoryLine.material.dispose();
        trajectoryLine = null;
    }
    // Stop any ongoing animation and reset state
    isBallAnimating = false;
    currentTrajectoryPoints = [];
    // Reset ball and tee based on current game state
    // For simplicity during reset, assume we are back on the TEE or range default
    showBallAtAddress(null, 'TEE'); // Reset ball/tee assuming TEE surface

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

    // If switching TO follow ball, set the camera position relative to the current ball position,
    // UNLESS it was just pre-positioned by setInitialFollowCameraLookingAtTarget (indicated by currentStaticView === 'hole')
    if (mode === CameraMode.FOLLOW_BALL && camera && ball) {
        if (currentStaticView !== 'hole') { // Check if not pre-positioned for hole view
            // Use snapFollowCameraToBall to ensure consistent aiming logic
            snapFollowCameraToBall(ball.position);
            // const targetPosition = new THREE.Vector3().copy(ball.position).add(new THREE.Vector3(0, 3, -6)); // Default offset from ball
            // const lookAtPosition = new THREE.Vector3().copy(ball.position); // Look at ball
            // camera.position.copy(targetPosition); // Snap position
            // camera.lookAt(lookAtPosition);      // Snap lookAt
        } else {
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
    activeCameraMode = CameraMode.STATIC; // Ensure mode is static

    // Calculate the total angle to apply for the static view
    const totalAimAngle = getCurrentTargetLineAngle() + getShotDirectionAngle();

    switch (viewToApply) {
        case 'target':
            // Re-apply the target view using the stored Z distance
            if (currentTargetZ !== undefined) {
                setCameraForTargetView(currentTargetZ, totalAimAngle); // Pass total angle
            } else {
                console.error("applyStaticCameraView: Cannot apply target view, currentTargetZ is undefined.");
                resetCameraPosition(0); // Reset with 0 angle
            }
            break;
        case 'chip':
            setCameraForChipView(totalAimAngle); // Pass total angle
            break;
        case 'putt':
            setCameraForPuttView(totalAimAngle); // Pass total angle
            break;
        case 'tee': // Add case for the hole tee view (overview)
            setCameraForHoleTeeView(undefined, totalAimAngle); // Pass total angle
            break;
        case 'hole': // Add case for the behind-ball hole view
            // This view is set dynamically by setCameraBehindBallLookingAtTarget,
            // This case should ideally not be hit directly when aiming anymore,
            // as applyAimAngleToCamera handles it. But keep the warning just in case.
            console.warn("applyStaticCameraView('hole') called. This view should be set via setCameraBehindBallLookingAtTarget or applyAimAngleToCamera.");
            // Attempt to re-apply using current ball/target if possible
            const ballPos = getPlayHoleBallPosition();
            const targetPos = getFlagPosition();
            if (ballPos && targetPos) {
                const ballPosVec3 = ballPos instanceof THREE.Vector3 ? ballPos : new THREE.Vector3(ballPos.x, ballPos.y, ballPos.z);
                const distance = ballPosVec3.distanceTo(targetPos);
                setCameraBehindBallLookingAtTarget(ballPosVec3, targetPos, distance, totalAimAngle); // Pass total angle
            } else {
                 console.warn("applyStaticCameraView: Could not get ball/target position for hole view update. Resetting to range.");
                 resetCameraPosition(0); // Fallback if positions unavailable
            }
            break;
        case 'range':
        default:
            resetCameraPosition(totalAimAngle); // Pass total angle
            break;
    }
}


// --- Specific Camera Setters ---
// Modified to accept angleToUse parameter

// Sets camera to default Range view
export function resetCameraPosition(angleToUse = 0) { // Accept angle parameter
    if (!camera) return;
    // const aimAngle = getShotDirectionAngle(); // REMOVED - Use parameter
    const pivot = BALL_PIVOT_POINT;

    // Base position and lookAt relative to pivot (0,0,0) assuming 0 degrees
    const baseCamPosOffset = new THREE.Vector3(0, 18, -25); // Offset from pivot
    const baseLookAtOffset = new THREE.Vector3(0, 0, 80);  // Offset from pivot

    // Calculate absolute base positions before rotation
    const baseCamPos = pivot.clone().add(baseCamPosOffset);
    const baseLookAtTargetPoint = pivot.clone().add(baseLookAtOffset);

    // Rotate points around the pivot using the provided angle
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos, pivot, angleToUse);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAtTargetPoint, pivot, angleToUse);

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt);
    currentStaticView = 'range'; // Update stored static view type
    // staticCameraZoomLevel = DEFAULT_STATIC_ZOOM_LEVEL; // REMOVED: Don't reset zoom on aim/view change
    updateStaticCameraView(); // Apply existing zoom level to new view
}

// Sets camera for Target view
let currentTargetZ = 150; // Store target Z for potential re-application
export function setCameraForTargetView(targetZ = 150, angleToUse = 0) { // Accept angle parameter
    if (!camera) return;
    currentTargetZ = targetZ; // Store the Z distance
    // const aimAngle = getShotDirectionAngle(); // REMOVED - Use parameter
    const pivot = BALL_PIVOT_POINT; // Assume aiming relative to the ball at the tee

    // Base position and lookAt relative to pivot (0,0,0) assuming 0 degrees
    // Camera should be BEHIND the tee, looking TOWARD the target
    const cameraHeight = 18;
    const cameraDistBack = 12; // Distance behind the tee (negative Z) - closer to tee
    // Position camera behind the tee at origin, looking down the fairway toward target
    const baseCamPosOffset = new THREE.Vector3(0, cameraHeight, -cameraDistBack); // Behind tee (negative Z)
    const baseLookAtOffset = new THREE.Vector3(0, 0, targetZ / 1.5); // Look toward target (positive Z)

    // Calculate absolute base positions before rotation
    const baseCamPos = pivot.clone().add(baseCamPosOffset);
    const baseLookAtTargetPoint = pivot.clone().add(baseLookAtOffset);

    // Rotate points around the pivot using the provided angle
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos, pivot, angleToUse);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAtTargetPoint, pivot, angleToUse);

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt);
    currentStaticView = 'target'; // Update stored static view type
    // staticCameraZoomLevel = DEFAULT_STATIC_ZOOM_LEVEL; // REMOVED: Don't reset zoom on aim/view change
    updateStaticCameraView(); // Apply existing zoom level to new view
}

// Sets camera for Chip view
export function setCameraForChipView(angleToUse = 0) { // Accept angle parameter
    if (!camera) return;
    // const aimAngle = getShotDirectionAngle(); // REMOVED - Use parameter
    const pivot = ball ? ball.position.clone() : BALL_PIVOT_POINT.clone(); // Pivot around current ball pos if available

    // Base position and lookAt relative to pivot assuming 0 degrees
    const baseCamPosOffset = new THREE.Vector3(0, 4, -8); // Offset from pivot
    const baseLookAtOffset = new THREE.Vector3(0, 0, 20); // Offset from pivot

    // Calculate absolute base positions before rotation
    const baseCamPos = pivot.clone().add(baseCamPosOffset);
    const baseLookAtTargetPoint = pivot.clone().add(baseLookAtOffset);

    // Rotate points around the pivot using the provided angle
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos, pivot, angleToUse);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAtTargetPoint, pivot, angleToUse);

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt);
    currentStaticView = 'chip'; // Update stored static view type
    // staticCameraZoomLevel = DEFAULT_STATIC_ZOOM_LEVEL; // REMOVED: Don't reset zoom on aim/view change
    updateStaticCameraView(); // Apply existing zoom level to new view
}

// Sets camera for Putt view
export function setCameraForPuttView(angleToUse = 0) { // Accept angle parameter
    if (!camera) return;
    // const aimAngle = getShotDirectionAngle(); // REMOVED - Use parameter
    const pivot = ball ? ball.position.clone() : BALL_PIVOT_POINT.clone(); // Pivot around current ball pos if available

    // Base position and lookAt relative to pivot assuming 0 degrees (using chip settings)
    const baseCamPosOffset = new THREE.Vector3(0, 4, -8); // Offset from pivot
    const baseLookAtOffset = new THREE.Vector3(0, 0, 20); // Offset from pivot

    // Calculate absolute base positions before rotation
    const baseCamPos = pivot.clone().add(baseCamPosOffset);
    const baseLookAtTargetPoint = pivot.clone().add(baseLookAtOffset);

    // Rotate points around the pivot using the provided angle
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos, pivot, angleToUse);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAtTargetPoint, pivot, angleToUse);

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt);
    currentStaticView = 'putt'; // Update stored static view type
    // staticCameraZoomLevel = DEFAULT_STATIC_ZOOM_LEVEL; // REMOVED: Don't reset zoom on aim/view change
    updateStaticCameraView(); // Apply existing zoom level to new view
}

// Sets camera for Hole Tee view (overview)
export function setCameraForHoleTeeView(holeLengthYards = 400, angleToUse = 0) { // Accept angle parameter
    if (!camera) return;
    // const aimAngle = getShotDirectionAngle(); // REMOVED - Use parameter
    const pivot = BALL_PIVOT_POINT; // Pivot around tee box

    const holeLengthMeters = holeLengthYards * YARDS_TO_METERS;
    // Base position and lookAt relative to pivot assuming 0 degrees
    const baseCamPosOffset = new THREE.Vector3(0, 30, -40); // Offset from pivot
    const baseLookAtOffset = new THREE.Vector3(0, 5, holeLengthMeters * 0.6); // Offset from pivot

    // Calculate absolute base positions before rotation
    const baseCamPos = pivot.clone().add(baseCamPosOffset);
    const baseLookAtTargetPoint = pivot.clone().add(baseLookAtOffset);

    // Rotate points around the pivot using the provided angle
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos, pivot, angleToUse);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAtTargetPoint, pivot, angleToUse);

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt);
    currentStaticView = 'tee'; // Update stored static view type
    // staticCameraZoomLevel = DEFAULT_STATIC_ZOOM_LEVEL; // REMOVED: Don't reset zoom on aim/view change
    updateStaticCameraView(); // Apply existing zoom level to new view
}

// Sets camera behind the ball, looking directly at a target, adjusting distance based on proximity
/**
 * Helper: Calculate camera distance parameters based on distance to target
 * Shared between setCameraBehindBallLookingAtTarget and updateStaticCameraView
 */
function getCameraDistanceParameters(distanceToTarget) {
    let minDistBehind, maxDistBehind, minHeight, maxHeight, maxDist;

    if (distanceToTarget <= 10) {
        // Very close shots (putts, very short chips) - Close and low camera
        maxDist = 10;
        minDistBehind = 3;  // Very close for putts
        maxDistBehind = 6;  // Still close for short chips
        minHeight = 1.5;    // Very low for putting perspective
        maxHeight = 3;      // Low for short chips
    } else if (distanceToTarget <= 30) {
        // Short chips/pitches - Medium-close camera
        maxDist = 30;
        minDistBehind = 6;
        maxDistBehind = 10;
        minHeight = 3;
        maxHeight = 6;
    } else if (distanceToTarget <= 60) {
        // Longer chips/short approach - Medium camera
        maxDist = 60;
        minDistBehind = 10;
        maxDistBehind = 15;
        minHeight = 6;
        maxHeight = 12;
    } else {
        // Full approach/long shots - Further back camera
        maxDist = 100;
        minDistBehind = 15;
        maxDistBehind = 25;
        minHeight = 12;
        maxHeight = 18;
    }

    return { minDistBehind, maxDistBehind, minHeight, maxHeight, maxDist };
}

export function setCameraBehindBallLookingAtTarget(ballPosition, targetPosition, distanceToTarget, angleToUse = 0) { // Accept angle parameter
    if (!camera || !ballPosition || !targetPosition || distanceToTarget === undefined) return;

    // const aimAngle = getShotDirectionAngle(); // REMOVED - Use parameter
    const pivot = ballPosition.clone(); // Pivot around the current ball position

    // --- Calculate Distance/Height (Context-aware based on distance to target) ---
    const { minDistBehind, maxDistBehind, minHeight, maxHeight, maxDist } = getCameraDistanceParameters(distanceToTarget);

    const clampedDistance = Math.min(distanceToTarget, maxDist);
    const interpFactor = clampedDistance / maxDist;
    const distanceBehind = THREE.MathUtils.lerp(minDistBehind, maxDistBehind, interpFactor);
    const cameraHeight = THREE.MathUtils.lerp(minHeight, maxHeight, interpFactor);
    const rangeLabel = distanceToTarget <= 10 ? 'Putt' : distanceToTarget <= 30 ? 'Short Chip' : distanceToTarget <= 60 ? 'Long Chip' : 'Full';

    // --- Calculate Base Position and LookAt (Relative to Pivot at 0 degrees) ---
    // Assume 0 degrees means looking down positive Z axis from behind the ball
    const baseDirection = new THREE.Vector3(0, 0, 1); // Direction FROM pivot at 0 degrees
    const baseOffsetVector = baseDirection.clone().multiplyScalar(-distanceBehind); // Go backwards
    baseOffsetVector.y = cameraHeight; // Add height
    const baseCamPos = pivot.clone().add(baseOffsetVector); // Base position relative to pivot

    // Base LookAt: Point far ahead along the 0-degree line from the pivot
    const baseLookAtTargetPoint = pivot.clone().add(new THREE.Vector3(0, 0, 100)); // Look 100 units down +Z from pivot

    // --- Rotate Position and LookAt around the ball (pivot) using the provided angleToUse ---
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos, pivot, angleToUse);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAtTargetPoint, pivot, angleToUse); // Rotate the baseLookAt target point as well

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt); // Look at the rotated target point
    currentStaticView = 'hole'; // Update stored static view type
    setActiveCameraMode(CameraMode.STATIC); // Ensure mode is static
    // staticCameraZoomLevel = DEFAULT_STATIC_ZOOM_LEVEL; // REMOVED: Don't reset zoom on aim/view change

    updateStaticCameraView(); // Apply existing zoom level to new view
}

// Sets the initial position and lookAt for the follow camera, aiming at a target
export function setInitialFollowCameraLookingAtTarget(ballPosition, targetPosition) {
    if (!camera || !ballPosition || !targetPosition) return;

    // Calculate the angle this view should use (typically 0 for initial setup, but use state for consistency)
    // This function is usually called *before* aiming, so relative angle should be 0.
    // It sets the camera based on the *target line* only.
    const angleToUse = getCurrentTargetLineAngle(); // Use the absolute target line angle
    const pivot = ballPosition.clone(); // Pivot around the ball

    const distanceBehind = 6; // How far behind the ball
    const cameraHeight = 3;   // How high above the ball's plane
    const offsetX = 2;        // How far to the right

    // --- Calculate Base Position and LookAt (Relative to Pivot at 0 degrees) ---
    // Base offset includes X offset now
    const baseOffsetVector = new THREE.Vector3(offsetX, cameraHeight, -distanceBehind);
    const baseCamPos = pivot.clone().add(baseOffsetVector); // Base position relative to pivot at 0 degrees

    // Base LookAt: Point far ahead along the 0-degree line from the pivot
    const baseLookAtTargetPoint = pivot.clone().add(new THREE.Vector3(0, 0, 100)); // Look 100 units down +Z from pivot

    // --- Rotate Position and LookAt around the ball (pivot) using the angleToUse ---
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos, pivot, angleToUse);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAtTargetPoint, pivot, angleToUse); // Rotate lookAt too!

    camera.position.copy(rotatedCamPos);   // Set initial position
    camera.lookAt(rotatedLookAt); // Set initial lookAt
    currentStaticView = 'hole'; // Set flag to indicate pre-positioning

    // DO NOT change activeCameraMode here, let the calling function do that
}

// Sets camera for Reverse Angle view - Aiming likely not applicable here
export function setCameraReverseAngle(targetPosition) {
    if (!camera || !targetPosition) return;
    const cameraHeight = 10; // Height above ground
    const offsetBehind = 30; // Distance behind the target Z (increased from 15 for better view)

    // Use the target position's X coordinate to account for green lateral offset
    const positionX = targetPosition.x || 0;
    const positionZ = targetPosition.z || targetPosition; // Support both Vector3 and number for backward compatibility

    camera.position.set(positionX, cameraHeight, positionZ + offsetBehind);
    camera.lookAt(positionX, 0, 0); // Look towards the green center line, not just centerline
    setActiveCameraMode(CameraMode.REVERSE_ANGLE); // Set the mode
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
}

// Sets camera to a static view behind a specific target position, mimicking chip/putt/range views
export function setCameraBehindBall(targetPosition, viewType = 'range') { // Keep original signature for now
    if (!camera || !targetPosition) return;

    // Calculate total angle internally for this specific function
    const totalAimAngle = getCurrentTargetLineAngle() + getShotDirectionAngle();

    // Ensure targetPosition is a THREE.Vector3
    const targetPosVec3 = targetPosition instanceof THREE.Vector3 ? targetPosition : new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z);

    const pivot = targetPosVec3.clone(); // Pivot around the target position (ball) - Use Vector3

    let baseCamPosOffset = new THREE.Vector3();
    let baseLookAtOffset = new THREE.Vector3();

    // Determine base offset based on view type (relative to pivot, assuming 0 degrees)
    switch (viewType) {
        case 'chip':
        case 'putt':
            baseCamPosOffset.set(0, 4, -8);
            baseLookAtOffset.set(0, 0, 12); // Look a bit further than the ball
            currentStaticView = viewType;
            break;
        case 'range':
        default:
            baseCamPosOffset.set(0, 18, -25);
            baseLookAtOffset.set(0, 0, 55); // Look further down
            currentStaticView = 'range';
            break;
    }

    // Calculate absolute base positions before rotation
    const baseCamPos = pivot.clone().add(baseCamPosOffset);
    const baseLookAtTargetPoint = pivot.clone().add(baseLookAtOffset);

    // Rotate points around the pivot using the total angle
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos, pivot, totalAimAngle);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAtTargetPoint, pivot, totalAimAngle);

    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt);
    setActiveCameraMode(CameraMode.STATIC); // Ensure mode is static
    // staticCameraZoomLevel = DEFAULT_STATIC_ZOOM_LEVEL; // REMOVED: Don't reset zoom on aim/view change

    updateStaticCameraView(); // Apply existing zoom level to new view
}

// Snaps the follow camera instantly to its starting offset relative to a target position
export function snapFollowCameraToBall(targetPosition) { // Keep original signature
    if (!camera || !targetPosition || activeCameraMode !== CameraMode.FOLLOW_BALL) return;

     // Calculate total angle internally
    let totalAimAngle = getCurrentTargetLineAngle() + getShotDirectionAngle()
    totalAimAngle = 0.0; // TEMP - Disable for now

     // Ensure targetPosition is a THREE.Vector3
    const targetPosVec3 = targetPosition instanceof THREE.Vector3 ? targetPosition : new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z);

    const pivot = targetPosVec3.clone(); // Pivot around the target position - Use Vector3

    const baseOffset = new THREE.Vector3(0, 3, -6); // Standard follow offset
    // Rotate the offset using the total angle (keep negation for reversed controls)
    const rotatedOffset = baseOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(-totalAimAngle));
    // Calculate position relative to the pivot
    const camPos = pivot.clone().add(rotatedOffset);
    const lookAtPos = pivot; // Look at the ball

    camera.position.copy(camPos); // Snap position
    camera.lookAt(lookAtPos);      // Snap lookAt
}

// --- Zoom Functions ---
const MIN_FOV = 10; // Minimum Field of View (Zoom In Limit) for non-static modes
const MAX_FOV = 150; // Maximum Field of View (Zoom Out Limit) for non-static modes
const FOV_ZOOM_STEP = 5;  // How much FOV changes per step for non-static modes

// Renamed function: updateStaticCameraView
// This function will be further modified to use staticCameraHeightLevel and staticCameraDistanceLevel
function updateStaticCameraView() {
    if (!camera || activeCameraMode !== CameraMode.STATIC) return;

    const totalAimAngle = getCurrentTargetLineAngle() + getShotDirectionAngle();
    const pivot = ball ? ball.position.clone() : BALL_PIVOT_POINT.clone(); // Pivot around current ball pos if available

    // 1. Determine Base Offsets for the current view (relative to pivot, 0 degrees)
    let baseCamPosOffset = new THREE.Vector3();
    let baseLookAtOffset = new THREE.Vector3();
    let baseDistance = 0; // Horizontal distance from pivot
    let baseHeight = 0;   // Vertical distance from pivot plane

    // --- Get base offsets based on currentStaticView ---
    // This logic mirrors the setCamera... functions but extracts offsets
    switch (currentStaticView) {
        case 'range':
            baseCamPosOffset.set(0, 18, -25);
            baseLookAtOffset.set(0, 0, 80);
            break;
        case 'target':
            // Use stored target Z for target view base calculation
            const targetZ = currentTargetZ !== undefined ? currentTargetZ : 150;
            const cameraHeightTarget = 18;
            const cameraDistBackTarget = 12; // Closer to tee
            // Camera should be BEHIND the tee (negative Z), looking TOWARD the target
            baseCamPosOffset.set(0, cameraHeightTarget, -cameraDistBackTarget); // Behind tee
            baseLookAtOffset.set(0, 0, targetZ / 1.5); // Look toward target
            break;
        case 'chip':
        case 'putt':
            baseCamPosOffset.set(0, 4, -8);
            baseLookAtOffset.set(0, 0, 20);
            break;
        case 'tee':
            // Need hole length if available, otherwise default
            const layout = typeof getCurrentHoleLayout === 'function' ? getCurrentHoleLayout() : null; // Check if function exists
            const holeLengthYards = layout ? layout.length : 400;
            const holeLengthMeters = holeLengthYards * YARDS_TO_METERS;
            baseCamPosOffset.set(0, 30, -40);
            baseLookAtOffset.set(0, 5, holeLengthMeters * 0.6);
            break;
        case 'hole':
            // For 'hole' view, the base is calculated dynamically in setCameraBehindBallLookingAtTarget
            // We need to recalculate the base offsets here based on current ball/target
            const ballPos = getPlayHoleBallPosition();
            const targetPos = getFlagPosition();
            if (ballPos && targetPos) {
                const ballPosVec3 = ballPos instanceof THREE.Vector3 ? ballPos : new THREE.Vector3(ballPos.x, ballPos.y, ballPos.z);
                const distanceToTarget = ballPosVec3.distanceTo(targetPos);
                // Use the same distance calculation as setCameraBehindBallLookingAtTarget
                const { minDistBehind, maxDistBehind, minHeight, maxHeight, maxDist } = getCameraDistanceParameters(distanceToTarget);
                const clampedDistance = Math.min(distanceToTarget, maxDist);
                const interpFactor = clampedDistance / maxDist;
                const baseDistBehind = THREE.MathUtils.lerp(minDistBehind, maxDistBehind, interpFactor);
                const baseCamHeight = THREE.MathUtils.lerp(minHeight, maxHeight, interpFactor);
                baseCamPosOffset.set(0, baseCamHeight, -baseDistBehind); // Offset relative to ball
                baseLookAtOffset.set(0, 0, 100); // Look far ahead along the line
            } else {
                console.warn("updateStaticCameraPositionFromZoom: Could not get ball/target for 'hole' view base. Using range defaults.");
                baseCamPosOffset.set(0, 18, -25); // Fallback
                baseLookAtOffset.set(0, 0, 80);
            }
            break;
        default:
            console.warn(`updateStaticCameraPositionFromZoom: Unknown view '${currentStaticView}'. Using range defaults.`);
            baseCamPosOffset.set(0, 18, -25);
            baseLookAtOffset.set(0, 0, 80);
            break;
    }

    // Calculate base distance (XZ plane) and height (Y) from the offset
    baseDistance = Math.sqrt(baseCamPosOffset.x * baseCamPosOffset.x + baseCamPosOffset.z * baseCamPosOffset.z);
    // baseHeight is implicitly defined by baseCamPosOffset.y, but we'll use STATIC_ZOOM_MIN_HEIGHT and STATIC_ZOOM_MAX_HEIGHT for interpolation.

    // 2. Calculate Target Distance and Height based on new independent levels
    const targetDist = THREE.MathUtils.lerp(baseDistance * STATIC_ZOOM_MIN_DIST_FACTOR, baseDistance * STATIC_ZOOM_MAX_DIST_FACTOR, staticCameraDistanceLevel);

    let targetHeight;
    // Use staticCameraHeightLevel for height calculation, applying the threshold logic
    // The threshold logic here might need re-evaluation if baseHeight was meant to be part of the interpolation.
    // For now, height is purely based on staticCameraHeightLevel and fixed min/max.
    if (staticCameraHeightLevel <= STATIC_ZOOM_MAX_HEIGHT_THRESHOLD) {
        const heightInterpFactor = staticCameraHeightLevel / STATIC_ZOOM_MAX_HEIGHT_THRESHOLD;
        targetHeight = THREE.MathUtils.lerp(STATIC_ZOOM_MIN_HEIGHT, STATIC_ZOOM_MAX_HEIGHT, heightInterpFactor);
    } else {
        targetHeight = STATIC_ZOOM_MAX_HEIGHT; // Cap at max height
    }
    targetHeight = Math.max(STATIC_ZOOM_MIN_HEIGHT, targetHeight); // Ensure min height

    // 3. Construct the New Base Camera Position Offset (before rotation)
    // Find the original direction vector on the XZ plane
    const baseDirXZ = new THREE.Vector3(baseCamPosOffset.x, 0, baseCamPosOffset.z).normalize();
    // Scale this direction by the target distance
    const targetOffsetXZ = baseDirXZ.multiplyScalar(targetDist);
    // Create the new offset vector with the target height
    const newBaseCamPosOffset = new THREE.Vector3(targetOffsetXZ.x, targetHeight, targetOffsetXZ.z);

    // 4. Calculate Absolute Positions (relative to world origin) before rotation
    const baseCamPos = pivot.clone().add(newBaseCamPosOffset);
    // Keep the lookAt target based on the original base offset direction, but relative to the pivot
    const baseLookAtTargetPoint = pivot.clone().add(baseLookAtOffset);

    // 5. Rotate Position and LookAt around the pivot
    const rotatedCamPos = rotatePointAroundPivot(baseCamPos, pivot, totalAimAngle);
    const rotatedLookAt = rotatePointAroundPivot(baseLookAtTargetPoint, pivot, totalAimAngle);

    // 6. Apply to Camera
    camera.position.copy(rotatedCamPos);
    camera.lookAt(rotatedLookAt);

}

// --- New functions to adjust height and distance independently ---
export function adjustStaticCameraHeight(delta) {
    if (!camera || activeCameraMode !== CameraMode.STATIC) return;
    staticCameraHeightLevel = Math.max(STATIC_ZOOM_MIN_LEVEL, Math.min(STATIC_ZOOM_MAX_LEVEL, staticCameraHeightLevel + delta));
    updateStaticCameraView();
}

export function adjustStaticCameraDistance(delta) {
    if (!camera || activeCameraMode !== CameraMode.STATIC) return;
    staticCameraDistanceLevel = Math.max(STATIC_ZOOM_MIN_LEVEL, Math.min(STATIC_ZOOM_MAX_LEVEL, staticCameraDistanceLevel + delta));
    updateStaticCameraView();
}

// --- Zoom Functions (Modified to control height for static, FOV for others) ---
export function zoomCameraIn() { // Corresponds to '+' key, will adjust height UP
    if (!camera) return;

    if (activeCameraMode === CameraMode.STATIC) {
        adjustStaticCameraHeight(STATIC_ZOOM_STEP); // Increase height level
    } else {
        // Original FOV zoom for non-static modes
        camera.fov = Math.max(MIN_FOV, FOV_ZOOM_STEP);
        camera.updateProjectionMatrix();
    }
}

export function zoomCameraOut() { // Corresponds to '-' key, will adjust height DOWN
    if (!camera) return;

    if (activeCameraMode === CameraMode.STATIC) {
        adjustStaticCameraHeight(-STATIC_ZOOM_STEP); // Decrease height level
    } else {
        // Original FOV zoom for non-static modes
        camera.fov = Math.min(MAX_FOV, camera.fov + FOV_ZOOM_STEP);
        camera.updateProjectionMatrix();
    }
}

// --- New function to explicitly reset static zoom (now height/distance levels) ---
export function resetStaticCameraZoom() {
    staticCameraHeightLevel = DEFAULT_STATIC_ZOOM_LEVEL; // Reset new levels
    staticCameraDistanceLevel = DEFAULT_STATIC_ZOOM_LEVEL; // Reset new levels
    // Optionally, call updateStaticCameraView() here if the camera should
    // immediately reflect the reset zoom level visually. Let's add it for consistency.
    updateStaticCameraView();
}

// --- Getters ---
export function getActiveCameraMode() {
     return activeCameraMode;
}

// --- Course Objects Getter for Raycasting ---
/**
 * Returns an array of THREE.Object3D that constitute the currently loaded hole/target objects.
 * These are used by MeasurementView for raycasting.
 * Checks both hole view (playHole) and target view (CTF) objects.
 * @returns {Array<THREE.Object3D>}
 */
export function getCourseObjects() {
    // Try hole objects first (playHole mode)
    const holeObjects = getCurrentHoleObjects ? getCurrentHoleObjects() : [];
    if (holeObjects.length > 0) {
        return holeObjects;
    }

    // Fall back to target objects (CTF mode)
    const targetObjects = getTargetObjects ? getTargetObjects() : [];
    return targetObjects;
}


/**
 * Sets the visual scale of the golf ball.
 * @param {boolean} enlarged - True to use enlarged scale, false for normal scale.
 */
export function setBallScale(enlarged) {
    if (ball) {
        const targetScale = enlarged ? BALL_SCALE_VECTOR_ENLARGED : BALL_SCALE_VECTOR_NORMAL;
        ball.scale.copy(targetScale);
    }
}
