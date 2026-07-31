// Unit tests for the career sync merge (pure function, no storage).
// Run: node tests/unit-careersync.mjs
import assert from 'node:assert/strict';
import { mergeCareerRecords } from '../src/career/careerStore.js';

const round = (id, date, total = 90, courseName = 'Sauda Golfklubb') => ({
    id, date, courseName, par: 70, rating: 68, slope: 120,
    holeCount: 18, total, differential: 12.0, holes: [],
});

// Union by id: server-only rounds are added, shared ids are not duplicated
{
    const local = { rounds: [round('a', '2026-07-01'), round('b', '2026-07-10')] };
    const server = { rounds: [round('b', '2026-07-10'), round('c', '2026-07-05')] };
    const { merged, added } = mergeCareerRecords(local, server);
    assert.equal(added, 1);
    assert.deepEqual(merged.rounds.map(r => r.id), ['a', 'c', 'b']); // date-sorted
}

// Fingerprint fallback: legacy rounds without ids dedupe by date+course+total
{
    const legacy = { date: '2026-06-01T10:00:00Z', courseName: 'Byneset', total: 95 };
    const local = { rounds: [legacy] };
    const server = { rounds: [{ ...legacy }, round('x', '2026-06-20')] };
    const { merged, added } = mergeCareerRecords(local, server);
    assert.equal(added, 1);
    assert.equal(merged.rounds.length, 2);
}

// Profile: newest updatedAt wins; missing side loses
{
    const lp = { name: 'Local', emoji: '⛳', updatedAt: '2026-07-01T00:00:00Z' };
    const sp = { name: 'Server', emoji: '🦅', updatedAt: '2026-07-15T00:00:00Z' };
    const a = mergeCareerRecords({ rounds: [], profile: lp }, { rounds: [], profile: sp });
    assert.equal(a.merged.profile.name, 'Server');
    assert.equal(a.profileFromServer, true);

    const b = mergeCareerRecords({ rounds: [], profile: sp }, { rounds: [], profile: lp });
    assert.equal(b.merged.profile.name, 'Server');
    assert.equal(b.profileFromServer, false);

    const c = mergeCareerRecords({ rounds: [] }, { rounds: [], profile: sp });
    assert.equal(c.merged.profile.name, 'Server');

    const d = mergeCareerRecords({ rounds: [], profile: lp }, { rounds: [] });
    assert.equal(d.merged.profile.name, 'Local');
    assert.equal(d.profileFromServer, false);
}

// A profile without updatedAt loses to one with it
{
    const { merged } = mergeCareerRecords(
        { rounds: [], profile: { name: 'Old' } },
        { rounds: [], profile: { name: 'New', updatedAt: '2026-01-01T00:00:00Z' } });
    assert.equal(merged.profile.name, 'New');
}

// Merging into an empty local record keeps everything from the server
{
    const { merged, added } = mergeCareerRecords({ rounds: [] },
        { rounds: [round('a', '2026-07-01')], profile: { name: 'S', updatedAt: '2026-01-01' } });
    assert.equal(added, 1);
    assert.equal(merged.profile.name, 'S');
}

// Profile default power: new players start at 60, values persist clamped to
// [30, 100], and non-numeric input leaves the stored value alone.
{
    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
    };
    const { getProfile, updateProfile } = await import('../src/career/careerStore.js');
    assert.equal(getProfile().defaultPower, 60, 'new players start at 60% power');
    updateProfile({ defaultPower: 80 });
    assert.equal(getProfile().defaultPower, 80);
    updateProfile({ defaultPower: 12 });
    assert.equal(getProfile().defaultPower, 30, 'clamped to slider minimum');
    updateProfile({ defaultPower: 250 });
    assert.equal(getProfile().defaultPower, 100, 'clamped to slider maximum');
    updateProfile({ name: 'Only name' });
    assert.equal(getProfile().defaultPower, 100, 'unrelated updates keep power');
    updateProfile({ defaultPower: NaN });
    assert.equal(getProfile().defaultPower, 100, 'NaN ignored');
}

console.log('unit-careersync: all assertions passed');
