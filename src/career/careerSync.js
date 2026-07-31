// src/career/careerSync.js
//
// Server sync for the career record (profile + rounds), registered users
// only. Local-first: localStorage stays the source of truth the UI reads;
// sync is a background reconcile — pull the server copy, union it into the
// local record (rounds by id, profile by newest updatedAt), then push the
// merged record back. Guests are untouched; their career lives locally until
// they upgrade, at which point the next sync uploads the whole history.
//
// Endpoints (see golf-game-server-requirements.md → Career Sync):
//   GET /api/career          → { profile, rounds } (404 = nothing stored yet)
//   PUT /api/career          → { success } (server unions rounds by id;
//                               never deletes rounds missing from the push)

import { API_BASE_URL } from '../config.js';
import { playerManager } from '../playerManager.js';
import { getCareer, getProfile, mergeServerCareer } from './careerStore.js';

let syncTimer = null;
let syncing = false;

function sessionToken() {
    const p = playerManager.getPlayerData();
    return (p.playerType === 'registered' && p.sessionToken) ? p.sessionToken : null;
}

async function pullAndMerge(token) {
    const res = await fetch(`${API_BASE_URL}/career`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.status === 404) return { added: 0, profileFromServer: false };
    if (!res.ok) throw new Error(`GET /career ${res.status}`);
    return mergeServerCareer(await res.json());
}

async function push(token) {
    const career = getCareer();
    const res = await fetch(`${API_BASE_URL}/career`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ profile: getProfile(), rounds: career.rounds }),
    });
    if (!res.ok) throw new Error(`PUT /career ${res.status}`);
}

/**
 * Full reconcile now: pull + merge + push. Resolves to a summary, or null
 * when sync doesn't apply (guest) — offline errors are swallowed, the local
 * record is always intact and a later sync catches up.
 */
export async function syncCareerNow() {
    const token = sessionToken();
    if (!token || syncing) return null;
    syncing = true;
    try {
        const pulled = await pullAndMerge(token);
        await push(token);
        if (pulled.added || pulled.profileFromServer) {
            console.log(`CareerSync: merged ${pulled.added} server round(s)` +
                (pulled.profileFromServer ? ', took server profile' : ''));
        }
        return pulled;
    } catch (e) {
        console.warn('CareerSync: skipped (offline or server unavailable):', e.message);
        return null;
    } finally {
        syncing = false;
    }
}

/**
 * Debounced sync — call after anything that changes the career record
 * (round posted, profile edited) and once at startup. Cheap to call.
 */
export function scheduleCareerSync(delayMs = 3000) {
    if (!sessionToken()) return; // guest: nothing to do
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncCareerNow, delayMs);
}
