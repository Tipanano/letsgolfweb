// Expanded club set with estimated properties - Added optimalSpin and defaultBallPositionIndex
export const clubs = {
    // Driver / Mini Driver - Added liftFactor
    'DR': { name: 'Driver',         loft: 10.5, lengthFactor: 1.0,  baseSmash: 1.48, baseAoA: 2,    spinRateFactor: 0.6, basePotentialSpeed: 128, optimalSpin: 2500, defaultBallPositionIndex: 8, liftFactor: 15.0 }, // Forward+
    'MD': { name: 'Mini Driver',    loft: 13,   lengthFactor: 0.97, baseSmash: 1.47, baseAoA: 1,    spinRateFactor: 0.65, basePotentialSpeed: 124, optimalSpin: 2800, defaultBallPositionIndex: 7, liftFactor: 12.0 }, // Forward
    // Woods - Added liftFactor
    'W3': { name: '3 Wood',         loft: 15,   lengthFactor: 0.95, baseSmash: 1.46, baseAoA: 0,    spinRateFactor: 0.7, basePotentialSpeed: 121, optimalSpin: 3200, defaultBallPositionIndex: 7, liftFactor: 8.0 }, // Forward
    'W5': { name: '5 Wood',         loft: 18,   lengthFactor: 0.93, baseSmash: 1.45, baseAoA: -1,   spinRateFactor: 0.75, basePotentialSpeed: 117, optimalSpin: 3700, defaultBallPositionIndex: 7, liftFactor: 8.0 }, // Forward
    'W7': { name: '7 Wood',         loft: 21,   lengthFactor: 0.91, baseSmash: 1.44, baseAoA: -1.5, spinRateFactor: 0.8, basePotentialSpeed: 114, optimalSpin: 4200, defaultBallPositionIndex: 7, liftFactor: 8.0 }, // Forward
    // Hybrids - Added liftFactor
    'H3': { name: '3 Hybrid',       loft: 19,   lengthFactor: 0.89, baseSmash: 1.43, baseAoA: -2,   spinRateFactor: 0.85, basePotentialSpeed: 113, optimalSpin: 4000, defaultBallPositionIndex: 6, liftFactor: 2.0 }, // Center-Forward
    'H4': { name: '4 Hybrid',       loft: 22,   lengthFactor: 0.87, baseSmash: 1.42, baseAoA: -2.5, spinRateFactor: 0.9, basePotentialSpeed: 110, optimalSpin: 4500, defaultBallPositionIndex: 6, liftFactor: 2.0 }, // Center-Forward
    // Irons - Added liftFactor
    'I3': { name: '3 Iron',         loft: 21,   lengthFactor: 0.88, baseSmash: 1.43, baseAoA: -2.5, spinRateFactor: 0.88, basePotentialSpeed: 113, optimalSpin: 4300, defaultBallPositionIndex: 6, liftFactor: 2.0 }, // Center-Forward
    'I4': { name: '4 Iron',         loft: 24,   lengthFactor: 0.86, baseSmash: 1.42, baseAoA: -3,   spinRateFactor: 0.92, basePotentialSpeed: 110, optimalSpin: 4800, defaultBallPositionIndex: 6, liftFactor: 1.5 }, // Center-Forward
    'I5': { name: '5 Iron',         loft: 27,   lengthFactor: 0.84, baseSmash: 1.41, baseAoA: -3.5, spinRateFactor: 0.96, basePotentialSpeed: 106, optimalSpin: 5300, defaultBallPositionIndex: 6, liftFactor: 1.5 }, // Center-Forward
    'I6': { name: '6 Iron',         loft: 30.5, lengthFactor: 0.82, baseSmash: 1.40, baseAoA: -4,   spinRateFactor: 1.0, basePotentialSpeed: 102, optimalSpin: 6000, defaultBallPositionIndex: 5, liftFactor: 1.0 }, // Center-Fwd
    'I7': { name: '7 Iron',         loft: 34,   lengthFactor: 0.8,  baseSmash: 1.39, baseAoA: -4.5, spinRateFactor: 1.05, basePotentialSpeed: 98, optimalSpin: 7000, defaultBallPositionIndex: 5, liftFactor: 1.0 }, // Center-Fwd
    'I8': { name: '8 Iron',         loft: 38,   lengthFactor: 0.78, baseSmash: 1.38, baseAoA: -5,   spinRateFactor: 1.1, basePotentialSpeed: 94, optimalSpin: 7800, defaultBallPositionIndex: 5, liftFactor: 1.0 }, // Center-Fwd
    'I9': { name: '9 Iron',         loft: 42,   lengthFactor: 0.76, baseSmash: 1.37, baseAoA: -5.5, spinRateFactor: 1.15, basePotentialSpeed: 89, optimalSpin: 8600, defaultBallPositionIndex: 4, liftFactor: 1.0 }, // Center-Back
    // Wedges - Added liftFactor
    'PW': { name: 'Pitching Wedge', loft: 46,   lengthFactor: 0.74, baseSmash: 1.36, baseAoA: -5.8, spinRateFactor: 1.2, basePotentialSpeed: 86, optimalSpin: 9200, defaultBallPositionIndex: 4, liftFactor: 0.9 }, // Center-Back
    'AW50': { name: 'Gap Wedge (50)', loft: 50, lengthFactor: 0.73, baseSmash: 1.35, baseAoA: -6,   spinRateFactor: 1.25, basePotentialSpeed: 84, optimalSpin: 9600, defaultBallPositionIndex: 4, liftFactor: 0.8 }, // Center-Back
    'GW54': { name: 'Gap Wedge (54)', loft: 54, lengthFactor: 0.72, baseSmash: 1.34, baseAoA: -6.2, spinRateFactor: 1.3, basePotentialSpeed: 81, optimalSpin: 10000, defaultBallPositionIndex: 4, liftFactor: 0.8 }, // Center-Back
    'SW58': { name: 'Sand Wedge (58)',loft: 58, lengthFactor: 0.71, baseSmash: 1.33, baseAoA: -6.5, spinRateFactor: 1.35, basePotentialSpeed: 79, optimalSpin: 10500, defaultBallPositionIndex: 4, liftFactor: 0.7 }, // Center-Back
    'LW60': { name: 'Lob Wedge (60)', loft: 60, lengthFactor: 0.70, baseSmash: 1.32, baseAoA: -6.8, spinRateFactor: 1.4, basePotentialSpeed: 77, optimalSpin: 10800, defaultBallPositionIndex: 4, liftFactor: 0.7 }, // Center-Back
};
