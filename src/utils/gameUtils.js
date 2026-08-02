import {
    getCurrentShotType, getBackswingDuration, getRotationInitiationTime,
    getRotationStartTime, getArmsStartTime, getWristsStartTime,
    getHipInitiationTime, getBackswingEndTime
    // Removed incorrect import of getCurrentHoleLayout
} from '../gameLogic/state.js';
import { isPointInPolygon } from '../shapeUtils.js'; // Import the point-in-polygon checker
import { YARDS_TO_METERS } from './unitConversions.js'; // Import conversion factor

/**
 * Clamps a value between a minimum and maximum.
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Generates a random floating-point number between min (inclusive) and max (exclusive).
 */
export function getRandomInRange(min, max) {
    return Math.random() * (max - min) + min;
}

/**
 * Helper to get current timing data for debug display.
 */
export function getDebugTimingData() {
    const shotType = getCurrentShotType();
    const backswingDuration = getBackswingDuration(); // Get from state

    if (shotType !== 'full') {
        // Return default/empty values for non-full swings
        return {
            backswingDuration: backswingDuration, // Still relevant maybe?
            rotationStartOffset: null,
            rotationInitiatedEarly: false,
            armsStartOffset: null,
            wristsStartOffset: null,
            hipInitiationOffset: null,
        };
    }

    const rotationInitiationTime = getRotationInitiationTime();
    const rotationStartTime = getRotationStartTime();
    const armsStartTime = getArmsStartTime();
    const wristsStartTime = getWristsStartTime();
    const hipInitiationTime = getHipInitiationTime();
    const backswingEndTime = getBackswingEndTime(); // Get from state

    let rotationOffset = null;
    let rotationInitiatedEarly = false;
    if (rotationInitiationTime && backswingEndTime) {
        rotationOffset = rotationInitiationTime - backswingEndTime;
        rotationInitiatedEarly = true;
    } else if (rotationStartTime && backswingEndTime) {
        rotationOffset = rotationStartTime - backswingEndTime;
    }

    return {
        backswingDuration: backswingDuration,
        rotationStartOffset: rotationOffset,
        rotationInitiatedEarly: rotationInitiatedEarly,
        armsStartOffset: (armsStartTime && backswingEndTime) ? armsStartTime - backswingEndTime : null,
        wristsStartOffset: (wristsStartTime && backswingEndTime) ? wristsStartTime - backswingEndTime : null,
        hipInitiationOffset: (hipInitiationTime && backswingEndTime) ? hipInitiationTime - backswingEndTime : null,
    };
}

// The surface lookup lives in ../surfaceLookup.js so it can be imported
// without dragging in THREE, the UI and the whole visuals tree through
// state.js. Re-exported here because most of the codebase asks gameUtils.
export { getSurfaceTypeAtPoint } from '../surfaceLookup.js';

