import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAppData } from '../src/data.js';
import { parseImportedData } from '../src/storage.js';

test('normalizes legacy data and fills safe defaults', () => {
    const result = normalizeAppData({
        homes: [{ id: 4, name: 'Test Home', scenarios: [{ id: 9, name: 'Loan', type: 'fixed', termYears: 0 }] }]
    });

    assert.equal(result.version, 2);
    assert.equal(result.activeHomeId, 4);
    assert.deepEqual(result.scenarioGroups, []);
    assert.equal(result.homes[0].scenarios[0].termYears, 30);
});

test('replaces an empty home list with a usable default property', () => {
    const result = normalizeAppData({ homes: [] });
    assert.equal(result.homes.length, 1);
    assert.equal(result.homes[0].name, 'Lake Elsinore Build');
});

test('rejects imported data without a homes array', () => {
    assert.throws(() => parseImportedData(JSON.stringify({ scenarioGroups: [] })), /Invalid mortgage analyzer data/);
});
