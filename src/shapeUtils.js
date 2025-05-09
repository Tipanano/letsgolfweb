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
 * Creates a shape for the fairway with a mix of straight and curved segments.
 * The input controlPoints define the main vertices of the fairway polygon.
 * @param {Array<{x: number, z: number}>} controlPoints - An array of objects defining the fairway outline. Assumed to be ordered.
 * @param {number} [straightChance=0.4] - Probability (0-1) that a segment between control points will be straight.
 * @param {number} [segmentsPerCurve=10] - Number of points to generate for each curved segment.
 * @returns {Array<{x: number, z: number}>} An array of vertices defining the final fairway shape.
 */
export function createRandomizedFairwayShape(controlPoints, straightChance = 0.4, segmentsPerCurve = 10) {
    if (!controlPoints || controlPoints.length < 3) {
        console.warn("createRandomizedFairwayShape: Need at least 3 control points for a polygon. Returning original points if any, else empty.");
        return controlPoints ? [...controlPoints] : []; // Return a copy or empty
    }

    const finalVertices = [];
    const numPoints = controlPoints.length;

    // Start with the first control point
    finalVertices.push({ x: controlPoints[0].x, z: controlPoints[0].z });

    for (let i = 0; i < numPoints; i++) {
        const p_curr = controlPoints[i];
        const p_next_idx = (i + 1) % numPoints; // Loop back to the start for the last segment
        const p_next = controlPoints[p_next_idx];

        // The current point p_curr should already be the last point in finalVertices
        // *except* for the very first iteration where finalVertices only has controlPoints[0].
        // For subsequent iterations, p_curr is the p_next of the previous iteration.

        let forceStraight = false;
        if (numPoints >= 3) { // Need at least 3 points to define an angle
            const p_prev_idx_angle = (i - 1 + numPoints) % numPoints;
            const p_prev_angle = controlPoints[p_prev_idx_angle];

            const vec_prev_curr = { x: p_curr.x - p_prev_angle.x, z: p_curr.z - p_prev_angle.z };
            const vec_curr_next = { x: p_next.x - p_curr.x, z: p_next.z - p_curr.z };

            const dotProduct = vec_prev_curr.x * vec_curr_next.x + vec_prev_curr.z * vec_curr_next.z;
            const mag_prev_curr = Math.sqrt(vec_prev_curr.x**2 + vec_prev_curr.z**2);
            const mag_curr_next = Math.sqrt(vec_curr_next.x**2 + vec_curr_next.z**2);

            if (mag_prev_curr > 0 && mag_curr_next > 0) {
                const cosAngle = dotProduct / (mag_prev_curr * mag_curr_next);
                const angleRad = Math.acos(Math.max(-1, Math.min(1, cosAngle))); // Clamp cosAngle to [-1, 1]
                const angleDeg = angleRad * (180 / Math.PI);

                if (angleDeg < 90) { // If the angle is acute (sharp turn)
                    forceStraight = true;
                    // console.log(`Forcing straight segment at index ${i} due to sharp angle: ${angleDeg.toFixed(1)} degrees`);
                }
            } else {
                forceStraight = true; // If any segment has zero length, make it straight to avoid issues
            }
        }


        if (forceStraight || Math.random() < straightChance || numPoints < 4) { // Make segment p_curr to p_next straight or if not enough points for CatmullRom
            // Add p_next if it's not already the last point (which it shouldn't be here)
            // or if it's not identical to the current point (p_curr)
            const lastAddedPoint = finalVertices[finalVertices.length - 1];
            if (lastAddedPoint.x !== p_next.x || lastAddedPoint.z !== p_next.z) {
                 finalVertices.push({ x: p_next.x, z: p_next.z });
            }
        } else { // Make segment p_curr to p_next curved
            // CatmullRomCurve3 needs at least 4 points: (prev, curr, next, next_next)
            // We are generating a curve for the segment between p_curr and p_next.
            const p_prev_idx = (i - 1 + numPoints) % numPoints;
            const p_prev = controlPoints[p_prev_idx];

            const p_next_next_idx = (i + 2) % numPoints;
            const p_next_next = controlPoints[p_next_next_idx];
            
            const curve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(p_prev.x, 0, p_prev.z),      // Point before the start of the segment
                new THREE.Vector3(p_curr.x, 0, p_curr.z),      // Start of the segment
                new THREE.Vector3(p_next.x, 0, p_next.z),      // End of the segment
                new THREE.Vector3(p_next_next.x, 0, p_next_next.z) // Point after the end of the segment
            ]);

            // getPoints generates points along the curve.
            // The first point (index 0) of this array corresponds to p_curr.
            // The last point corresponds to p_next.
            const pointsOnCurve = curve.getPoints(segmentsPerCurve);

            // Add points from the curve, skipping the first one (p_curr) as it's already in finalVertices.
            for (let j = 1; j < pointsOnCurve.length; j++) {
                const curvePoint = { x: pointsOnCurve[j].x, z: pointsOnCurve[j].z };
                const lastAddedPoint = finalVertices[finalVertices.length - 1];
                // Add if different from the last added point to avoid duplicates
                if (lastAddedPoint.x !== curvePoint.x || lastAddedPoint.z !== curvePoint.z) {
                    finalVertices.push(curvePoint);
                }
            }
        }
    }
    
    // Clean up: Remove last point if it's identical to the first (due to closing the loop)
    // This ensures the polygon is correctly defined for rendering (often expects non-duplicated start/end for closed paths)
    // However, createSmoothClosedShape *does* add an explicit closing point. Let's be consistent.
    const cleanedVertices = [];
    if (finalVertices.length > 0) {
        cleanedVertices.push(finalVertices[0]); // Add the first point
        for (let i = 1; i < finalVertices.length; i++) {
            const prev = cleanedVertices[cleanedVertices.length - 1];
            const curr = finalVertices[i];
            if (prev.x !== curr.x || prev.z !== curr.z) { // Only add if different from previous
                cleanedVertices.push(curr);
            }
        }
    }

    // Ensure the path is explicitly closed if it's not already by the loop logic
    if (cleanedVertices.length > 1) {
        const first = cleanedVertices[0];
        const last = cleanedVertices[cleanedVertices.length - 1];
        if (first.x !== last.x || first.z !== last.z) {
            cleanedVertices.push({ ...first }); // Explicitly close the path
        }
    }
    
    console.log(`createRandomizedFairwayShape: Generated ${cleanedVertices.length} vertices from ${numPoints} control points.`);
    return cleanedVertices;
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
