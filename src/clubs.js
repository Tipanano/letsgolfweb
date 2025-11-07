// Expanded club set with estimated properties - Added optimalSpin and defaultBallPositionIndex
export const clubs = {
    // Driver / Mini Driver - Added liftFactor and type
    'DR': { name: 'Driver',         type: 'driver', loft: 10.5, lengthFactor: 1.0,  baseSmash: 1.50, baseAoA: 2,    spinRateFactor: 0.6, basePotentialSpeed: 125.0, optimalSpin: 2500, defaultBallPositionIndex: 7, liftFactor: 20.0, clBackspinEff: 0.032 }, // Forward+
    'MD': { name: 'Mini Driver',    type: 'driver', loft: 13,   lengthFactor: 0.97, baseSmash: 1.49, baseAoA: 1,    spinRateFactor: 0.65, basePotentialSpeed: 122.1, optimalSpin: 2800, defaultBallPositionIndex: 7, liftFactor: 15.0, clBackspinEff: 0.027 }, // Forward
    // Woods - Added liftFactor and type
    'W3': { name: '3 Wood',         type: 'wood', loft: 15,   lengthFactor: 0.95, baseSmash: 1.48, baseAoA: 0,    spinRateFactor: 0.7, basePotentialSpeed: 116.8, optimalSpin: 3200, defaultBallPositionIndex: 7, liftFactor: 12.0, clBackspinEff: 0.024 }, // Forward
    'W5': { name: '5 Wood',         type: 'wood', loft: 18,   lengthFactor: 0.93, baseSmash: 1.47, baseAoA: -1,   spinRateFactor: 0.75, basePotentialSpeed: 112.3, optimalSpin: 3700, defaultBallPositionIndex: 7, liftFactor: 11.0, clBackspinEff: 0.023 }, // Forward
    'W7': { name: '7 Wood',         type: 'wood', loft: 20,   lengthFactor: 0.91, baseSmash: 1.47, baseAoA: -1.5, spinRateFactor: 0.8, basePotentialSpeed: 109.7, optimalSpin: 4200, defaultBallPositionIndex: 6, liftFactor: 9.0, clBackspinEff: 0.021 }, // Forward
    // Hybrids - Added liftFactor and type
    'H3': { name: '3 Hybrid',       type: 'hybrid', loft: 20,   lengthFactor: 0.89, baseSmash: 1.46, baseAoA: -2,   spinRateFactor: 0.85, basePotentialSpeed: 107.1, optimalSpin: 4000, defaultBallPositionIndex: 6, liftFactor: 8.0, clBackspinEff: 0.021 }, // Center-Forward
    'H4': { name: '4 Hybrid',       type: 'hybrid', loft: 22,   lengthFactor: 0.87, baseSmash: 1.46, baseAoA: -2.5, spinRateFactor: 0.9, basePotentialSpeed: 106.6, optimalSpin: 4500, defaultBallPositionIndex: 6, liftFactor: 8.0, clBackspinEff: 0.020 }, // Center-Forward
    // Irons - Added liftFactor and type
    'I3': { name: '3 Iron',         type: 'iron', loft: 20,   lengthFactor: 0.88, baseSmash: 1.46, baseAoA: -2.5, spinRateFactor: 0.88, basePotentialSpeed: 105.3, optimalSpin: 4300, defaultBallPositionIndex: 6, liftFactor: 7.5, clBackspinEff: 0.019 }, // Center-Forward
    'I4': { name: '4 Iron',         type: 'iron', loft: 22,   lengthFactor: 0.86, baseSmash: 1.44, baseAoA: -3,   spinRateFactor: 0.92, basePotentialSpeed: 103.3, optimalSpin: 4800, defaultBallPositionIndex: 6, liftFactor: 6.0, clBackspinEff: 0.017 }, // Center-Forward
    'I5': { name: '5 Iron',         type: 'iron', loft: 25,   lengthFactor: 0.84, baseSmash: 1.41, baseAoA: -3.5, spinRateFactor: 0.96, basePotentialSpeed: 100.2, optimalSpin: 5300, defaultBallPositionIndex: 6, liftFactor: 4.5, clBackspinEff: 0.016}, // Center-Forward
    'I6': { name: '6 Iron',         type: 'iron', loft: 28, lengthFactor: 0.82, baseSmash: 1.38, baseAoA: -4,   spinRateFactor: 1.0, basePotentialSpeed: 97.1, optimalSpin: 6000, defaultBallPositionIndex: 5, liftFactor: 2.0, clBackspinEff: 0.0155}, // Center-Fwd
    'I7': { name: '7 Iron',         type: 'iron', loft: 32,   lengthFactor: 0.8,  baseSmash: 1.34, baseAoA: -4.5, spinRateFactor: 1.05, basePotentialSpeed: 94.5, optimalSpin: 7000, defaultBallPositionIndex: 5, liftFactor: 1.0, clBackspinEff: 0.013 }, // Center-Fwd
    'I8': { name: '8 Iron',         type: 'iron', loft: 36,   lengthFactor: 0.78, baseSmash: 1.30, baseAoA: -5,   spinRateFactor: 1.1, basePotentialSpeed: 91.9, optimalSpin: 7800, defaultBallPositionIndex: 5, liftFactor: 1.0, clBackspinEff: 0.012 }, // Center-Fwd
    'I9': { name: '9 Iron',         type: 'iron', loft: 40,   lengthFactor: 0.76, baseSmash: 1.26, baseAoA: -5.5, spinRateFactor: 1.15, basePotentialSpeed: 89.3, optimalSpin: 8600, defaultBallPositionIndex: 4, liftFactor: 1.0, clBackspinEff: 0.011 }, // Center-Back
    // Wedges - Added liftFactor and type
    'PW': { name: 'Pitching Wedge', type: 'wedge', loft: 45,   lengthFactor: 0.74, baseSmash: 1.23, baseAoA: -5.8, spinRateFactor: 1.2, basePotentialSpeed: 86.1, optimalSpin: 9200, defaultBallPositionIndex: 4, liftFactor: 0.9, clBackspinEff: 0.009 }, // Center-Back
    'AW50': { name: 'Gap Wedge (50)', type: 'wedge', loft: 50, lengthFactor: 0.73, baseSmash: 1.17, baseAoA: -6,   spinRateFactor: 1.25, basePotentialSpeed: 80.5, optimalSpin: 9600, defaultBallPositionIndex: 4, liftFactor: 0.8, clBackspinEff: 0.008}, // Center-Back
    'GW54': { name: 'Gap Wedge (54)', type: 'wedge', loft: 54, lengthFactor: 0.72, baseSmash: 1.12, baseAoA: -6.2, spinRateFactor: 1.3, basePotentialSpeed: 75.4, optimalSpin: 10000, defaultBallPositionIndex: 4, liftFactor: 0.8, clBackspinEff: 0.008 }, // Center-Back
    'SW58': { name: 'Sand Wedge (58)', type: 'wedge', loft: 58, lengthFactor: 0.71, baseSmash: 1.08, baseAoA: -6.5, spinRateFactor: 1.35, basePotentialSpeed: 73.3, optimalSpin: 10500, defaultBallPositionIndex: 4, liftFactor: 0.7, clBackspinEff: 0.007 }, // Center-Back
    'LW60': { name: 'Lob Wedge (60)', type: 'wedge', loft: 60, lengthFactor: 0.70, baseSmash: 1.05, baseAoA: -6.8, spinRateFactor: 1.4, basePotentialSpeed: 71.2, optimalSpin: 10800, defaultBallPositionIndex: 4, liftFactor: 0.5, clBackspinEff: 0.005 }, // Center-Back
    // Putter
    'PT': { name: 'Putter',         type: 'putter', loft: 3,    lengthFactor: 0.70, baseSmash: 1.0,  baseAoA: 0,    spinRateFactor: 0.1, basePotentialSpeed: 20.0, optimalSpin: 100, defaultBallPositionIndex: 5, liftFactor: 0.0, clBackspinEff: 0.0 }, // Center-Fwd (Ball position less critical for putt, but set a default)
};

export const defaultPlayerBag = [
    'DR', 'W3', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'PW', 'AW50', 'GW54', 'LW60', 'PT'
];
