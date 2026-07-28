// src/greenContours.js
//
// Analytic heightfield for green elevation ("break").
//
// The contour is a sum of smooth Gaussian bumps plus an optional plane tilt,
// multiplied by a smootherstep feather that takes everything to exactly zero
// at the collar's outer edge — so the contoured green always meets the flat
// surroundings seamlessly. Because the field is analytic (C∞), both the
// rendered surface and the ball physics are perfectly smooth: physics queries
// the function directly instead of interpolating triangles.
//
// Module doubles as a singleton holding the currently active contour so the
// renderer, physics, and visuals can all read the same field without import
// cycles.
//
// Config shape (stored on a hole layout as `greenContour`):
// {
//   center: { x, z },        // Feather center (usually the green center)
//   innerRadius: 15,         // Full contour strength inside this radius
//   outerRadius: 20,         // Field is exactly 0 beyond this radius
//   tilt: { dx: 0, dz: 0.01 },        // Plane slope (m per m), applied inside feather
//   bumps: [ { x, z, height, radius }, ... ]  // Gaussian features; height<0 = hollow
// }

let active = null; // { config, ...precomputed }

/** Smootherstep: 0→1 with zero 1st and 2nd derivatives at both ends. */
function smootherstep(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * t * (t * (t * 6 - 15) + 10);
}

export function setActiveContour(config) {
    if (!config || !config.center || !(config.outerRadius > 0)) {
        active = null;
        return;
    }
    active = {
        cx: config.center.x,
        cz: config.center.z,
        inner: Math.min(config.innerRadius ?? config.outerRadius * 0.75, config.outerRadius - 0.01),
        outer: config.outerRadius,
        tiltX: config.tilt?.dx ?? 0,
        tiltZ: config.tilt?.dz ?? 0,
        bumps: (config.bumps || []).map(b => ({
            x: b.x, z: b.z,
            height: b.height,
            // Gaussian sigma from the feature radius: ~1% of peak left at r
            sigma: Math.max(0.5, (b.radius ?? 5) / 2),
        })),
    };
}

export function hasContour() {
    return active !== null;
}

/** Height (m) of the contour field at a world XZ position. 0 outside. */
export function heightAt(x, z) {
    if (!active) return 0;

    const dxc = x - active.cx;
    const dzc = z - active.cz;
    const distFromCenter = Math.sqrt(dxc * dxc + dzc * dzc);
    if (distFromCenter >= active.outer) return 0;

    // Collar feather: 1 inside innerRadius, 0 at outerRadius
    const feather = smootherstep((active.outer - distFromCenter) / (active.outer - active.inner));
    if (feather === 0) return 0;

    let h = active.tiltX * dxc + active.tiltZ * dzc;
    for (const b of active.bumps) {
        const dx = x - b.x;
        const dz = z - b.z;
        h += b.height * Math.exp(-(dx * dx + dz * dz) / (2 * b.sigma * b.sigma));
    }
    return h * feather;
}

/** Slope gradient {x, z} (dh/dx, dh/dz) via central differences. */
export function gradientAt(x, z) {
    if (!active) return null;
    const EPS = 0.05;
    return {
        x: (heightAt(x + EPS, z) - heightAt(x - EPS, z)) / (2 * EPS),
        z: (heightAt(x, z + EPS) - heightAt(x, z - EPS)) / (2 * EPS),
    };
}

/**
 * True if a point (with an optional margin around it) is close enough to the
 * contour to be influenced — used by the renderer to decide which triangles
 * need subdividing.
 */
export function isNearContour(x, z, margin = 0) {
    if (!active) return false;
    const dx = x - active.cx;
    const dz = z - active.cz;
    return Math.sqrt(dx * dx + dz * dz) <= active.outer + margin;
}
