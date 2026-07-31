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

// --- Player profile -------------------------------------------------------
// Identity lives with the career record (local-first, like the rounds).
// Server sync for registered users layers on later; until then the name is
// whatever the player types, independent of the multiplayer guest identity.

// defaultPower: the swing-power % each session starts at. New players begin
// at 65 — easy timing, still clears the Green Card driving drill (175 m
// needs ~57%+). The power slider persists its last value here, so it acts
// as "your power" across sessions/devices, adjustable per shot as always.
const DEFAULT_PROFILE = { name: 'Player', emoji: '🏌️', defaultPower: 65, createdAt: null };

export function getProfile() {
    const p = loadCareer().profile;
    return { ...DEFAULT_PROFILE, ...(p || {}) };
}

/** Updates name, emoji and/or default power; stamps createdAt on first save. */
export function updateProfile({ name, emoji, defaultPower } = {}) {
    const career = loadCareer();
    const profile = { ...DEFAULT_PROFILE, ...(career.profile || {}) };
    if (typeof name === 'string' && name.trim()) profile.name = name.trim().slice(0, 20);
    if (typeof emoji === 'string' && emoji) profile.emoji = emoji;
    if (Number.isFinite(defaultPower)) {
        profile.defaultPower = Math.round(Math.min(100, Math.max(30, defaultPower)));
    }
    if (!profile.createdAt) profile.createdAt = new Date().toISOString();
    profile.updatedAt = new Date().toISOString(); // sync conflict resolution
    career.profile = profile;
    saveCareer(career);
    return profile;
}

// --- Server sync support --------------------------------------------------

function newRoundId() {
    return (globalThis.crypto?.randomUUID?.()) ||
        'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Merge identity: client id when present, content fingerprint otherwise. */
function roundKey(r) {
    return r.id || `${r.date}|${r.courseName}|${r.total}`;
}

/**
 * Pure merge of a local and a server career record (either side may be
 * partial). Rounds are append-only and union by id/fingerprint; the profile
 * with the newest updatedAt wins. Exported for unit testing.
 */
export function mergeCareerRecords(local, server) {
    const rounds = [...(local?.rounds || [])];
    const seen = new Set(rounds.map(roundKey));
    let added = 0;
    for (const r of (server?.rounds || [])) {
        if (seen.has(roundKey(r))) continue;
        seen.add(roundKey(r));
        rounds.push(r);
        added++;
    }
    rounds.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const lp = local?.profile || null;
    const sp = server?.profile || null;
    let profile = lp;
    let profileFromServer = false;
    if (sp && (!lp || String(sp.updatedAt || '') > String(lp.updatedAt || ''))) {
        profile = sp;
        profileFromServer = true;
    }

    const merged = { ...(local || {}), rounds };
    if (profile) merged.profile = profile;
    return { merged, added, profileFromServer };
}

/** Applies a pulled server record onto the local store (local-first union). */
export function mergeServerCareer(serverRecord) {
    const career = loadCareer();
    // Backfill ids on legacy local rounds so future merges are stable
    for (const r of career.rounds) if (!r.id) r.id = newRoundId();
    const { merged, added, profileFromServer } = mergeCareerRecords(career, serverRecord);
    saveCareer(merged);
    return { added, profileFromServer };
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
        id: newRoundId(),
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
