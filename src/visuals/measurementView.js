import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import { getCourseObjects as getCoreCourseObjects } from './core.js'; // Import getCourseObjects from core
import * as UIVisuals from '../ui.js'; // Import UI functions for labels
import { metersToYards } from '../utils/unitConversions.js'; // Import conversion utilities

let scene; // Reference to the main scene
let renderer; // Reference to the main renderer
let canvas; // Reference to the main canvas
let orthographicCamera;
let raycaster; // Add raycaster instance
let isActive = false;
let clickedPoint = null; // Stores the 3D coordinates of the clicked point on the course

let lineBallToClick = null;
let lineClickToFlag = null;

// REMOVED: No longer storing courseObjects locally
// let courseObjects = [];

const DEFAULT_CAMERA_HEIGHT = 200; // Meters above the target point
const MIN_VIEW_EXTENT = 50; // Minimum half-width/height of the orthographic view in meters

/**
 * Initializes the MeasurementView module.
 * @param {THREE.WebGLRenderer} coreRenderer - The main WebGL renderer.
 * @param {THREE.Scene} coreScene - The main scene.
 * @param {HTMLCanvasElement} coreCanvas - The main canvas element.
 * @param {Array<THREE.Object3D>} coreCourseObjects - Array of course objects for raycasting.
 */
export function init(coreRenderer, coreScene, coreCanvas /* Removed coreCourseObjects */) {
    renderer = coreRenderer;
    scene = coreScene;
    canvas = coreCanvas;
    // REMOVED: courseObjects = coreCourseObjects || [];

    // --- DEBUG LOGGING ---
    // REMOVED: if (courseObjects.length > 0) { ... }
    // --- END DEBUG LOGGING ---


    // Initialize the orthographic camera (will be configured in activate)
    // Using placeholder values for now, aspect ratio will be set based on canvas
    const aspect = canvas.clientWidth / canvas.clientHeight;
    orthographicCamera = new THREE.OrthographicCamera(
        -MIN_VIEW_EXTENT * aspect, MIN_VIEW_EXTENT * aspect,
        MIN_VIEW_EXTENT, -MIN_VIEW_EXTENT,
        0.1, 1000
    );
    // scene.add(orthographicCamera); // Camera is added to scene only when active, or managed by core render loop

    // Initialize the raycaster
    raycaster = new THREE.Raycaster();

}

/**
 * Activates the top-down measurement view.
 * @param {THREE.Vector3} ballPosition - Current 3D position of the golf ball.
 * @param {THREE.Vector3} flagPosition - 3D position of the flag.
 */
export function activate(ballPosition, flagPosition) {
    if (!orthographicCamera || !ballPosition || !flagPosition) {
        console.error("MeasurementView: Cannot activate without camera or target positions.");
        return;
    }

    isActive = true;
    clickedPoint = null; // Reset clicked point
    clearMeasurementVisuals(); // Clear any previous lines/text

    // 1. Calculate Midpoint
    const midpoint = new THREE.Vector3().addVectors(ballPosition, flagPosition).multiplyScalar(0.5);

    // 2. Position Camera
    orthographicCamera.position.set(midpoint.x, midpoint.y + DEFAULT_CAMERA_HEIGHT, midpoint.z);
    orthographicCamera.up.set(0, 0, 1); // Set world +Z axis as "up" for the camera view
    orthographicCamera.lookAt(midpoint.x, midpoint.y, midpoint.z); // Look straight down at the midpoint

    // 3. Adjust Orthographic Frustum
    // Calculate the distance from the midpoint to the furthest of ball or flag to determine view size
    const distToBall = midpoint.distanceTo(ballPosition);
    const distToFlag = midpoint.distanceTo(flagPosition);
    let furthestDist = Math.max(distToBall, distToFlag);

    // Add a buffer/padding to the view
    const viewPadding = 1.2; // Show 20% more than the direct extent
    let halfWidth = Math.max(MIN_VIEW_EXTENT, furthestDist * viewPadding);
    let halfHeight = halfWidth;

    const aspect = canvas.clientWidth / canvas.clientHeight;
    if (aspect > 1) { // Landscape
        halfWidth *= aspect;
    } else { // Portrait or square
        halfHeight /= aspect;
    }

    orthographicCamera.left = -halfWidth;
    orthographicCamera.right = halfWidth;
    orthographicCamera.top = halfHeight;
    orthographicCamera.bottom = -halfHeight;
    orthographicCamera.updateProjectionMatrix();

    // Note: The main render loop in core.js will need to switch to using this camera.
}

/**
 * Deactivates the measurement view.
 */
export function deactivate() {
    isActive = false;
    clearMeasurementVisuals();
    // Note: The main render loop in core.js will need to switch back to its primary camera.
}

/**
 * Returns the orthographic camera used by this view.
 * @returns {THREE.OrthographicCamera}
 */
export function getCamera() {
    return orthographicCamera;
}

/**
 * Checks if the measurement view is currently active.
 * @returns {boolean}
 */
export function isViewActive() { // Renamed from isActive to avoid conflict with module-level variable
    return isActive;
}

/**
 * Handles a click on the course when the measurement view is active.
 * @param {number} mouseX - Mouse X coordinate relative to the canvas.
 * @param {number} mouseY - Mouse Y coordinate relative to the canvas.
 * @param {THREE.Vector3} currentBallPosition - Current 3D position of the ball.
 * @param {THREE.Vector3} currentFlagPosition - Current 3D position of the flag.
 */
export function handleCourseClick(mouseX, mouseY, currentBallPosition, currentFlagPosition) {
    if (!isActive || !currentBallPosition || !currentFlagPosition) return;

    const intersection = getCourseIntersection(mouseX, mouseY);
    if (intersection) {
        clickedPoint = intersection.point.clone(); // Store a clone of the intersection point
        updateMeasurementLines(currentBallPosition, clickedPoint, currentFlagPosition); // Draw lines
        updateDistanceTexts(currentBallPosition, clickedPoint, currentFlagPosition); // Update text
        // console.warn("Line drawing and text update not yet implemented."); // Removed warning
    } else {
        // Optionally clear previous click point and lines if the user clicks off the course?
        // clickedPoint = null;
        // clearMeasurementVisuals();
    }
}

/**
 * Performs raycasting to find the intersection point on the course.
 * @param {number} mouseX - Mouse X coordinate.
 * @param {number} mouseY - Mouse Y coordinate.
 * @returns {THREE.Intersection | null} - The first intersection object or null.
 */
function getCourseIntersection(mouseX, mouseY) {
    // Fetch course objects dynamically
    const currentCourseObjects = getCoreCourseObjects ? getCoreCourseObjects() : [];

    // --- DEBUG LOGGING ---
    // --- END DEBUG LOGGING ---

    if (!raycaster || !orthographicCamera || !canvas || !currentCourseObjects || currentCourseObjects.length === 0) {
        console.error("Raycasting cannot proceed: Missing camera, canvas, or course objects.");
        return null;
    }

    // 1. Normalize mouse coordinates to NDC (-1 to +1 range)
    const ndc = new THREE.Vector2();
    // Apply potential fix for flipped X: Negate the calculated X
    ndc.x = -((mouseX / canvas.clientWidth) * 2 - 1);
    ndc.y = -(mouseY / canvas.clientHeight) * 2 + 1; // Y is inverted

    // 2. Set raycaster from camera
    raycaster.setFromCamera(ndc, orthographicCamera);

    // 3. Intersect with course objects
    // Make sure currentCourseObjects contains the actual meshes (fairway, green, rough, etc.)
    const intersects = raycaster.intersectObjects(currentCourseObjects, false); // false = don't check descendants recursively if objects are groups

    // 4. Return the first intersection (closest object)
    if (intersects.length > 0) {
        return intersects[0];
    } else {
        return null;
    }
}

/**
 * Creates or updates the lines for measurement.
 * @param {THREE.Vector3} ballPos
 * @param {THREE.Vector3} clickPos
 * @param {THREE.Vector3} flagPos
 */
function updateMeasurementLines(ballPos, clickPos, flagPos) {
    if (!scene) return;

    // Clear existing lines first
    if (lineBallToClick) {
        scene.remove(lineBallToClick);
        lineBallToClick.geometry.dispose();
        lineBallToClick.material.dispose();
        lineBallToClick = null;
    }
    if (lineClickToFlag) {
        scene.remove(lineClickToFlag);
        lineClickToFlag.geometry.dispose();
        lineClickToFlag.material.dispose();
        lineClickToFlag = null;
    }

    // Ensure all points are valid Vector3 instances
    if (!ballPos || !clickPos || !flagPos) {
        console.error("Cannot draw measurement lines: Missing position data.");
        return;
    }

    // Define line material (e.g., dashed yellow)
    const lineMaterial = new THREE.LineDashedMaterial({
        color: 0xffff00, // Yellow
        linewidth: 2, // Note: linewidth > 1 may not work on all platforms/drivers
        scale: 1,
        dashSize: 0.5, // Length of dashes
        gapSize: 0.2, // Length of gaps
    });

    // --- Create Line: Ball to Clicked Point ---
    // Raise points slightly so the line is visible above the terrain
    const yOffset = 0.1;
    const pointsBallClick = [
        new THREE.Vector3(ballPos.x, ballPos.y + yOffset, ballPos.z),
        new THREE.Vector3(clickPos.x, clickPos.y + yOffset, clickPos.z)
    ];
    const geometryBallClick = new THREE.BufferGeometry().setFromPoints(pointsBallClick);
    lineBallToClick = new THREE.Line(geometryBallClick, lineMaterial.clone()); // Clone material
    lineBallToClick.computeLineDistances(); // Required for dashed lines
    scene.add(lineBallToClick);

    // --- Create Line: Clicked Point to Flag ---
    const pointsClickFlag = [
        new THREE.Vector3(clickPos.x, clickPos.y + yOffset, clickPos.z),
        new THREE.Vector3(flagPos.x, flagPos.y + yOffset, flagPos.z) // Use flagPos directly (assuming its y is ground level)
    ];
    const geometryClickFlag = new THREE.BufferGeometry().setFromPoints(pointsClickFlag);
    lineClickToFlag = new THREE.Line(geometryClickFlag, lineMaterial.clone()); // Clone material
    lineClickToFlag.computeLineDistances(); // Required for dashed lines
    scene.add(lineClickToFlag);

}

/**
 * Updates the distance text labels on the UI.
 * @param {THREE.Vector3} ballPos
 * @param {THREE.Vector3} clickPos
 * @param {THREE.Vector3} flagPos
 */
function updateDistanceTexts(ballPos, clickPos, flagPos) {
    if (!ballPos || !clickPos || !flagPos || !orthographicCamera || !canvas) return;

    // Calculate distances (using XZ plane for golf distance)
    const distBallClick = new THREE.Vector2(ballPos.x, ballPos.z).distanceTo(new THREE.Vector2(clickPos.x, clickPos.z));
    const distClickFlag = new THREE.Vector2(clickPos.x, clickPos.z).distanceTo(new THREE.Vector2(flagPos.x, flagPos.z));

    // Convert meters to yards for display
    const distBallClickYards = metersToYards(distBallClick).toFixed(1);
    const distClickFlagYards = metersToYards(distClickFlag).toFixed(1);


    // Project the 3D endpoints of the lines to 2D screen coordinates
    // Use a slight Y offset for projection to match the line's visual position
    const yOffset = 0.1;
    const screenPosBall = projectToScreen(new THREE.Vector3(ballPos.x, ballPos.y + yOffset, ballPos.z));
    const screenPosClick = projectToScreen(new THREE.Vector3(clickPos.x, clickPos.y + yOffset, clickPos.z));
    const screenPosFlag = projectToScreen(new THREE.Vector3(flagPos.x, flagPos.y + yOffset, flagPos.z));

    // Update UI labels using the midpoint of the projected 2D screen coordinates
    if (screenPosBall && screenPosClick) {
        const midScreenX_BallClick = (screenPosBall.x + screenPosClick.x) / 2;
        const midScreenY_BallClick = (screenPosBall.y + screenPosClick.y) / 2;
        UIVisuals.createOrUpdateDistanceLabel('dist-label-ball-click', `${distBallClickYards} yd`, midScreenX_BallClick, midScreenY_BallClick);
    } else {
        // Hide label if endpoints aren't both on screen
        UIVisuals.removeDistanceLabel('dist-label-ball-click');
    }

    if (screenPosClick && screenPosFlag) {
        const midScreenX_ClickFlag = (screenPosClick.x + screenPosFlag.x) / 2;
        const midScreenY_ClickFlag = (screenPosClick.y + screenPosFlag.y) / 2;
        UIVisuals.createOrUpdateDistanceLabel('dist-label-click-flag', `${distClickFlagYards} yd`, midScreenX_ClickFlag, midScreenY_ClickFlag);
    } else {
        // Hide label if endpoints aren't both on screen
        UIVisuals.removeDistanceLabel('dist-label-click-flag');
    }
}

/**
 * Helper function to project a 3D world point to 2D screen coordinates.
 * @param {THREE.Vector3} worldVector - The 3D point in world space.
 * @returns {{x: number, y: number} | null} Screen coordinates or null if projection fails.
 */
function projectToScreen(worldVector) {
    if (!orthographicCamera || !canvas) return null;

    const vector = worldVector.clone();
    vector.project(orthographicCamera); // Project vector into NDC space (-1 to +1)

    // Convert NDC to coordinates relative to the canvas top-left
    // Apply negation to vector.x to potentially fix horizontal flipping
    const canvasX = ((-vector.x + 1) / 2) * canvas.clientWidth;
    const canvasY = ((-vector.y + 1) / 2) * canvas.clientHeight; // Y is inverted relative to NDC top

    // Get the canvas position relative to the viewport
    const rect = canvas.getBoundingClientRect();

    // Calculate screen coordinates relative to the viewport
    const screenX = Math.round(rect.left + canvasX);
    const screenY = Math.round(rect.top + canvasY);


    // Check if the projected point is within the camera's view frustum (NDC check is simpler)
    // We only need to display the label if the 3D point was visible.
    // Check if z is within NDC range (-1 to 1) - means it's between near and far planes.
    if (vector.z >= -1 && vector.z <= 1) {
         // The point is potentially visible on screen (though might be outside canvas bounds if canvas is smaller than viewport)
         return { x: screenX, y: screenY };
    } else {
        // Point is outside the camera's near/far planes
        return null;
    }
}

/**
 * Clears all measurement lines and text labels.
 */
export function clearMeasurementVisuals() {
    if (lineBallToClick) {
        scene.remove(lineBallToClick);
        lineBallToClick.geometry.dispose();
        lineBallToClick.material.dispose();
        lineBallToClick = null;
    }
    if (lineClickToFlag) {
        scene.remove(lineClickToFlag);
        lineClickToFlag.geometry.dispose();
        lineClickToFlag.material.dispose();
        lineClickToFlag = null;
    }
    // Hide UI labels
    UIVisuals.hideAllDistanceLabels();
}
