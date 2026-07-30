// src/visuals/textures.js
//
// Shared ground-texture and material registry.
//
// Every surface texture is loaded exactly ONCE for the lifetime of the app and
// reused by every polygon that needs it. Previously each polygon called
// textureLoader.load() itself, so four bunkers on one hole meant four separate
// GPU uploads of the same 1024² image — and nothing ever disposed them, so the
// set leaked again on every hole change.
//
// Two things every texture here gets that none of them had before:
//
//   colorSpace = SRGBColorSpace — three r163 defaults a loaded texture to
//     NoColorSpace, i.e. "these bytes are already linear". They aren't; they're
//     sRGB. Without this the renderer skips the decode and the tone mapper
//     receives values that are far too bright, which is what made the grass
//     look milky and desaturated.
//
//   anisotropy — ground is viewed almost entirely at grazing angles, the worst
//     case for trilinear filtering. This is a fixed-function sampler feature;
//     the cost is unmeasurable and the gain in distance legibility is large.
//
// Textures tile in WORLD SPACE (see uvScale in surfaces.js): geometry UVs are
// metres/tile, so repeat stays (1,1) and one texture instance serves polygons
// of any size at a consistent real-world grass scale.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';

const loader = new THREE.TextureLoader();
const textureCache = new Map();  // url -> THREE.Texture
const materialCache = new Map(); // key -> THREE.Material

// Resolved from renderer capabilities at init; 8 is plenty (16 is rarely
// distinguishable and some mobile GPUs take a real hit above 8).
let maxAnisotropy = 8;

/** Call once from initCoreVisuals so we can honour the GPU's real limit. */
export function initTextureCaps(renderer) {
    if (!renderer?.capabilities?.getMaxAnisotropy) return;
    maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    // Anything already cached predates the renderer; bring it up to spec.
    for (const tex of textureCache.values()) {
        tex.anisotropy = maxAnisotropy;
        tex.needsUpdate = true;
    }
}

/**
 * Loads (or returns the cached) texture for a URL. TextureLoader.load returns
 * the Texture synchronously and fills in its image later, so callers can build
 * a finished material immediately — no async callback, and no flash of the
 * default white material while the image is in flight.
 */
export function getSurfaceTexture(url) {
    let tex = textureCache.get(url);
    if (tex) return tex;

    tex = loader.load(url, undefined, undefined, (err) => {
        console.error(`Failed to load surface texture ${url}:`, err);
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = maxAnisotropy;
    tex.userData.shared = true;
    textureCache.set(url, tex);
    return tex;
}

/**
 * Shared ground material for a surface. Keyed by texture/colour plus the flags
 * that change the shader, so a hole's dozen surface polygons collapse onto a
 * handful of material instances instead of one each.
 *
 * These are owned by the cache and live for the app lifetime — hole teardown
 * must NOT dispose them. They're tagged userData.shared so disposal helpers
 * can tell. Never mutate a returned material; ask for a different key instead.
 */
export function getSurfaceMaterial({ texturePath, color, vertexColors = true, side = THREE.FrontSide, roughness = 0.95, metalness = 0.0 }) {
    const key = `${texturePath || color}|${vertexColors}|${side}|${roughness}`;
    let mat = materialCache.get(key);
    if (mat) return mat;

    mat = new THREE.MeshStandardMaterial({
        side,
        vertexColors,
        roughness,
        metalness,
        ...(texturePath
            ? { map: getSurfaceTexture(texturePath), color: 0xffffff }
            : { color: color || '#228b22' }),
    });
    mat.userData.shared = true;
    materialCache.set(key, mat);
    return mat;
}

/** True for assets owned by this registry — disposal helpers must skip these. */
export function isShared(obj) {
    return !!obj?.userData?.shared;
}

/**
 * Disposes an object's geometry, and its material/maps only when they are not
 * cache-owned. Use this everywhere hole or range scenery is torn down.
 */
export function disposeSceneObject(obj) {
    if (!obj) return;
    obj.traverse?.((child) => {
        if (child === obj) return;
        disposeSceneObject(child);
    });
    obj.geometry?.dispose?.();
    const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    for (const m of mats) {
        if (isShared(m)) continue;
        if (m.map && !isShared(m.map)) m.map.dispose();
        if (m.normalMap && !isShared(m.normalMap)) m.normalMap.dispose();
        m.dispose?.();
    }
}
