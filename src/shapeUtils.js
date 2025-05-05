// src/shapeUtils.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';

/**
 * Creates a smooth, closed shape from a set of control points using Catmull-Rom splines.
 * @param {Array<{x: number, z: number}>} controlPoints - An array of objects defining the control points.
 * @param {number} [segments=32] - The number of points to generate between each control point for smoothness.
 * @returns {Array<{x: number, z: number}>} An array of vertices defining the smooth shape. Returns empty array if input is invalid.
 */
export function createSmoothClosedShape(controlPoints, segments = 32) {
    if (!controlPoints || controlPoints.length < 3) {
        console.warn("createSmoothClosedShape: Need at least 3 control points.");
        return [];
    }

    // Convert control points to THREE.Vector2 for spline generation
    // We use X and Z from our coordinate system as X and Y for the 2D shape/spline functions.
    const pointsVec2 = controlPoints.map(p => new THREE.Vector2(p.x, p.z));

    // Create a shape and use splineThru to generate the curve
    const shape = new THREE.Shape();
    shape.moveTo(pointsVec2[0].x, pointsVec2[0].y); // Start at the first point
    shape.splineThru(pointsVec2); // Generate spline through all points
    // splineThru automatically connects back to the start for a closed shape if the points form a loop

    // Get the generated points along the curve
    // The number of points generated depends on the curve complexity and THREE.js internals,
    // but we can specify divisions for more control if needed using shape.getPoints(divisions).
    // For splineThru, it often generates enough points automatically. Let's retrieve them.
    // Note: getPoints() returns Vector2, we need to convert back to {x, z}
    const generatedPoints = shape.getPoints(controlPoints.length * segments); // Increase divisions for smoothness

    // Convert back to our {x, z} format
    const finalVertices = generatedPoints.map(v2 => ({ x: v2.x, z: v2.y }));

    // Ensure the path is explicitly closed if needed (splineThru usually handles this)
    if (finalVertices.length > 0) {
         const first = finalVertices[0];
         const last = finalVertices[finalVertices.length - 1];
         if (first.x !== last.x || first.z !== last.z) {
             finalVertices.push({ ...first }); // Close the loop explicitly if needed
         }
    }


    console.log(`createSmoothClosedShape: Generated ${finalVertices.length} vertices from ${controlPoints.length} control points.`);
    return finalVertices;
}

/**
 * Calculates the approximate center (centroid) of a polygon by averaging its vertices.
 * @param {Array<{x: number, z: number}>} vertices - The vertices of the polygon.
 * @returns {{x: number, z: number} | null} The calculated center point, or null if input is invalid.
 */
export function calculatePolygonCenter(vertices) {
    if (!vertices || vertices.length === 0) {
        console.warn("calculatePolygonCenter: No vertices provided.");
        return null;
    }

    let sumX = 0;
    let sumZ = 0;
    const count = vertices.length;

    // Handle potential duplicate closing vertex if present
    const first = vertices[0];
    const last = vertices[count - 1];
    const effectiveCount = (count > 1 && first.x === last.x && first.z === last.z) ? count - 1 : count;

    if (effectiveCount === 0) {
         console.warn("calculatePolygonCenter: No effective vertices.");
         return null;
    }

    for (let i = 0; i < effectiveCount; i++) {
        sumX += vertices[i].x;
        sumZ += vertices[i].z;
    }

    return {
        x: sumX / effectiveCount,
        z: sumZ / effectiveCount
    };
}

/**
 * Checks if a 2D point is inside a polygon using the ray casting algorithm.
 * Handles points on the polygon edge inconsistently (may return true or false).
 * @param {{x: number, z: number}} point - The point to check.
 * @param {Array<{x: number, z: number}>} polygonVertices - An array of vertices defining the polygon. Assumes vertices are ordered.
 * @returns {boolean} True if the point is inside the polygon, false otherwise.
 */
export function isPointInPolygon(point, polygonVertices) {
    if (!point || !polygonVertices || polygonVertices.length < 3) {
        return false; // Need at least 3 vertices for a polygon
    }

    const x = point.x;
    const z = point.z;
    let isInside = false;
    const n = polygonVertices.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygonVertices[i].x;
        const zi = polygonVertices[i].z;
        const xj = polygonVertices[j].x;
        const zj = polygonVertices[j].z;

        // Check if the point is exactly on a horizontal boundary (handle with care or specific logic if needed)
        // if (zi === z && zj === z && ((xi <= x && x <= xj) || (xj <= x && x <= xi))) {
        //     return true; // Or handle as edge case
        // }
        // Check if the point is exactly on a vertical boundary (handle with care)
        // if (xi === x && xj === x && ((zi <= z && z <= zj) || (zj <= z && z <= zi))) {
        //     return true; // Or handle as edge case
        // }

        // Ray casting intersection check
        const intersect = ((zi > z) !== (zj > z)) &&
                          (x < (xj - xi) * (z - zi) / (zj - zi) + xi);
        if (intersect) {
            isInside = !isInside;
        }
    }

    return isInside;
}


// Future function examples:
// export function createSmoothPath(controlPoints, segments) { ... }
