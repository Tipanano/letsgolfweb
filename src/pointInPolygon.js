// Ray-casting point-in-polygon on the XZ plane.
//
// Its own module purely so it carries no dependencies: shapeUtils.js imports
// THREE for spline work, which made every consumer of this one pure function
// unloadable outside a browser.

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
