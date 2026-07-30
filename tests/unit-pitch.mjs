// Unit tests for the pitch power profile in the rhythm short game.
// Run: node tests/unit-pitch.mjs
import assert from 'node:assert/strict';
import { CHIP_PROFILES, estimateRhythmChipCarry, calculateRhythmChipImpact } from '../src/chipPhysics.js';
import { clubs } from '../src/clubs.js';
// Tempo endpoints (rhythmPutt keeps these private; values per its constants)
const FAST = 200;
const SLOW = 1400;

assert.ok(CHIP_PROFILES.chip && CHIP_PROFILES.pitch);
assert.ok(CHIP_PROFILES.pitch.speedFraction > CHIP_PROFILES.chip.speedFraction);
assert.ok(CHIP_PROFILES.pitch.contactThreshold < CHIP_PROFILES.chip.contactThreshold); // riskier

// Pitch flies farther than chip at the same tempo, for every wedge
for (const key of ['PW', 'AW50', 'SW58', 'LW60', 'I8']) {
    const club = clubs[key];
    const chip = estimateRhythmChipCarry(FAST, club, 0, 'FAIRWAY', CHIP_PROFILES.chip);
    const pitch = estimateRhythmChipCarry(FAST, club, 0, 'FAIRWAY', CHIP_PROFILES.pitch);
    assert.ok(pitch > chip * 1.3, `${key}: pitch ${pitch.toFixed(1)} vs chip ${chip.toFixed(1)}`);
}

// The pitch band covers the 30-60 m gap with a PW
const pwMax = estimateRhythmChipCarry(FAST, clubs.PW, 0, 'FAIRWAY', CHIP_PROFILES.pitch);
const pwMin = estimateRhythmChipCarry(SLOW, clubs.PW, 0, 'FAIRWAY', CHIP_PROFILES.pitch);
assert.ok(pwMax > 42 && pwMax < 65, `PW pitch max ${pwMax.toFixed(1)}`);
assert.ok(pwMin < 12, `PW pitch min ${pwMin.toFixed(1)}`); // overlaps the chip band, no dead zone

// Default profile stays the chip band (backwards compatible)
const dflt = estimateRhythmChipCarry(FAST, clubs.PW, 0, 'FAIRWAY');
const chip = estimateRhythmChipCarry(FAST, clubs.PW, 0, 'FAIRWAY', CHIP_PROFILES.chip);
assert.equal(dflt, chip);

// Impact calculation accepts the profile and scales ball speed accordingly
const strike = { tempoMs: 300, cv: 0.0, beatDeviationMs: 0, shapeDevFrac: null };
const chipImpact = calculateRhythmChipImpact(strike, clubs.PW, 0, 'FAIRWAY', CHIP_PROFILES.chip);
const pitchImpact = calculateRhythmChipImpact(strike, clubs.PW, 0, 'FAIRWAY', CHIP_PROFILES.pitch);
assert.ok(pitchImpact.ballSpeed > chipImpact.ballSpeed * 1.2,
    `impact speeds: pitch ${pitchImpact.ballSpeed} vs chip ${chipImpact.ballSpeed}`);

console.log('unit-pitch: all assertions passed');
