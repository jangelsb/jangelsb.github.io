import assert from 'node:assert/strict';
import test from 'node:test';
import { getScenarioLabel, normalizeAppData, sortHomesForDisplay } from '../src/data.js';
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

test('generates readable labels for each loan type', () => {
    assert.equal(getScenarioLabel({ type: 'buydown', rate: 5.5, bdY1: 2, bdY2: 1 }), '2:1 @ 5.5');
    assert.equal(getScenarioLabel({ type: 'fixed', rate: 6.5 }), 'fixed @ 6.5');
    assert.equal(getScenarioLabel({ type: 'arm', rate: 6.5 }), '7/1 ARM @ 6.5');
});

test('normalization replaces legacy custom scenario names with generated labels', () => {
    const result = normalizeAppData({
        homes: [{ scenarios: [{ name: 'My Custom Loan', type: 'fixed', rate: 6.5 }] }]
    });
    assert.equal(result.homes[0].scenarios[0].name, 'fixed @ 6.5');
});

test('sorts homes case-insensitively without mutating the stored list', () => {
    const homes = [
        { id: 1, name: 'zillow' },
        { id: 2, name: 'Alpha' },
        { id: 3, name: 'bravo' }
    ];

    const sorted = sortHomesForDisplay(homes);
    assert.deepEqual(sorted.map(home => home.name), ['Alpha', 'bravo', 'zillow']);
    assert.deepEqual(homes.map(home => home.name), ['zillow', 'Alpha', 'bravo']);
});
