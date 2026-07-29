// src/career/careerStore.js
//
// Local-first career record: every completed course round is stored in
// localStorage and the handicap index is derived from it (WHS-lite, see
// handicap.js). Registered-user server sync will layer on top of this store
// in a later phase — the local record stays the source the UI reads.

import { computeRoundDifferential, differentialsFromRounds, handicapIndex } from './handicap.js';

const STORAGE_KEY = 'golfCareerV1';

function loadCareer() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const career = raw ? JSON.parse(raw) : null;
        if (career && Array.isArray(career.rounds)) return career;
    } catch (e) {
        console.error('CareerStore: unreadable career data, starting fresh.', e);
    }
    return { rounds: [] };
}

function saveCareer(career) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(career));
    } catch (e) {
        console.error('CareerStore: failed to save career data.', e);
    }
}

export function getCareer() {
    return loadCareer();
}

/** Current handicap index, or null before any round has posted. */
export function getHandicapIndex() {
    return handicapIndex(differentialsFromRounds(loadCareer().rounds));
}

/**
 * Records a completed round and returns how it moved the handicap.
 * The differential is computed against the index the player held when the
 * round was played and stored immutably on the round, like a real posting.
 * @param {object} round
 * @param {string} round.courseName
 * @param {{rating: number, slope: number, par: number}} round.ratingInfo
 * @param {Array<{hole, par, strokes, lengthMeters?}>} round.holes
 * @returns {{index: number, prevIndex: number|null, differential: number}}
 */
export function recordCompletedRound({ courseName, ratingInfo, holes }) {
    const career = loadCareer();
    const prevIndex = handicapIndex(differentialsFromRounds(career.rounds));
    const differential = computeRoundDifferential(
        { holes, rating: ratingInfo.rating, slope: ratingInfo.slope, par: ratingInfo.par },
        prevIndex);
    career.rounds.push({
        date: new Date().toISOString(),
        courseName,
        par: ratingInfo.par,
        rating: ratingInfo.rating,
        slope: ratingInfo.slope,
        holeCount: holes.length,
        total: holes.reduce((s, h) => s + h.strokes, 0),
        differential,
        holes,
    });
    saveCareer(career);
    return {
        index: handicapIndex(differentialsFromRounds(career.rounds)),
        prevIndex,
        differential,
    };
}
