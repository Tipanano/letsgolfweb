// src/career/drillHoles.js
//
// Generated layouts for the Green Card full-swing drills, in the hole-maker
// export format (same schema as practiceGreen.generatePracticeGreenLayout).
// Deliberately friendly: wide fairway, big green, minimal trouble — these
// holes teach mechanics, they don't punish.

function circleVertices(cx, cz, radius, segments = 24, wobble = 0) {
    const verts = [];
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const r = radius * (1 + wobble * Math.sin(angle * 3 + radius));
        verts.push({
            x: +(cx + Math.cos(angle) * r).toFixed(2),
            z: +(cz + Math.sin(angle) * r).toFixed(2),
        });
    }
    return verts;
}

/** Driving drill: a straight, wide par 4. Success = finishing on the fairway. */
export function drivingDrillLayout() {
    return {
        name: 'Driving Drill',
        par: 4,
        lengthMeters: 300,
        hasElevation: false,
        tee: { center: { x: 0, y: 0, z: 0 }, width: 6, depth: 4, surface: 'TEE' },
        fairways: [{
            // ~30 m wide with a slight mid-hole belly
            controlPoints: [
                { x: -15, z: 35 }, { x: 15, z: 35 },
                { x: 18, z: 150 }, { x: 15, z: 265 },
                { x: -15, z: 265 }, { x: -18, z: 150 },
            ],
            surface: 'FAIRWAY',
        }],
        greens: [{
            controlPoints: circleVertices(0, 288, 13, 26, 0.04),
            surface: 'GREEN',
        }],
        bunkers: [],
        lightRough: [{
            vertices: [
                { x: -48, z: -8 }, { x: 48, z: -8 },
                { x: 48, z: 315 }, { x: -48, z: 315 },
            ],
            surface: 'LIGHT_ROUGH',
        }],
        nativeAreas: [
            { controlPoints: circleVertices(-38, 90, 8, 16, 0.18), surface: 'NATIVE_AREA' },
            { controlPoints: circleVertices(38, 200, 9, 16, 0.18), surface: 'NATIVE_AREA' },
        ],
        flagPositions: [{ number: 1, x: 0, y: 0, z: 288 }],
    };
}

/** Approach drill: a short par 3 with a big green. Success = finding the green. */
export function approachDrillLayout() {
    return {
        name: 'Approach Drill',
        par: 3,
        lengthMeters: 130,
        hasElevation: false,
        tee: { center: { x: 0, y: 0, z: 0 }, width: 5, depth: 3, surface: 'TEE' },
        greens: [{
            controlPoints: circleVertices(0, 130, 12, 26, 0.04),
            surface: 'GREEN',
        }],
        fairways: [{
            // Front apron for the just-short miss
            controlPoints: [
                { x: -7, z: 98 }, { x: 7, z: 98 },
                { x: 9, z: 118 }, { x: -9, z: 118 },
            ],
            surface: 'FAIRWAY',
        }],
        bunkers: [
            { controlPoints: circleVertices(-14, 126, 4, 18, 0.08), surface: 'BUNKER' },
        ],
        lightRough: [{
            vertices: [
                { x: -38, z: -8 }, { x: 38, z: -8 },
                { x: 38, z: 158 }, { x: -38, z: 158 },
            ],
            surface: 'LIGHT_ROUGH',
        }],
        nativeAreas: [
            { controlPoints: circleVertices(30, 45, 7, 16, 0.18), surface: 'NATIVE_AREA' },
        ],
        flagPositions: [{ number: 1, x: 1, y: 0, z: 131 }],
    };
}
