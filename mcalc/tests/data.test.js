import assert from 'node:assert/strict';
import test from 'node:test';
import { compareChartCalloutValues, getScenarioLabel, normalizeAppData, sortHomesForDisplay } from '../src/data.js';
import { parseImportedData } from '../src/storage.js';

test('normalizes legacy data and fills safe defaults', () => {
    const result = normalizeAppData({
        homes: [{ id: 4, name: 'Test Home', scenarios: [{ id: 9, name: 'Loan', type: 'fixed', termYears: 0 }] }]
    });

    assert.equal(result.version, 3);
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

test('normalization preserves saved scenario names', () => {
    const result = normalizeAppData({
        homes: [{ scenarios: [{ name: 'My Custom Loan', type: 'fixed', rate: 6.5 }] }]
    });
    assert.equal(result.homes[0].scenarios[0].name, 'My Custom Loan');
});

test('migrates the legacy closing-cost percentage and adds incentive defaults', () => {
    const result = normalizeAppData({
        homes: [{ closingCosts: 3, scenarios: [{ type: 'fixed', rate: 6 }] }]
    });

    assert.equal(result.homes[0].closingCostEstimateMode, 'percentOfLoan');
    assert.equal(result.homes[0].closingCostEstimatePercent, 3);
    assert.equal(result.homes[0].incentivePool, 0);
    assert.deepEqual(result.homes[0].scenarios[0].incentiveAllocation, {
        rateBuydown: 0,
        closingCosts: 0,
        priceReduction: 0,
        designUpgrades: 0
    });
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

test('sorts chart callout items by their displayed value instead of home order', () => {
    const a = { dataset: { label: 'Lower' }, parsed: { y: 100 }, raw: 100 };
    const b = { dataset: { label: 'Higher' }, parsed: { y: 500 }, raw: 500 };
    const c = { dataset: { label: 'Middle' }, parsed: { y: 250 }, raw: 250 };

    assert.ok(compareChartCalloutValues(a, b) > 0);
    assert.ok(compareChartCalloutValues(b, a) < 0);
    assert.ok(compareChartCalloutValues(c, b) > 0);
    assert.deepEqual([a, c, b].sort(compareChartCalloutValues), [b, c, a]);
});
