import assert from 'node:assert/strict';
import test from 'node:test';
import { applyComparisonHomeConfigs, buildComparisonHomeConfigs, CREATE_NEW_COMPARISON } from '../src/comparisons.js';

const homes = [
    { id: 2, scenarios: [{ id: 20 }, { id: 21 }] },
    { id: 1, scenarios: [{ id: 10 }] }
];

test('builds saved comparison configs from current selections', () => {
    const configs = buildComparisonHomeConfigs(homes, { 2: 21 }, { 1: false });
    assert.deepEqual(configs, [
        { homeId: 2, scenarioId: 21, isIncluded: true },
        { homeId: 1, scenarioId: 10, isIncluded: false }
    ]);
});

test('applies saved comparison configs back into selection maps', () => {
    const applied = applyComparisonHomeConfigs([
        { homeId: 2, scenarioId: 21, isIncluded: true },
        { homeId: 1, scenarioId: 10, isIncluded: false }
    ]);
    assert.deepEqual(applied, {
        compareHomeIds: { 2: true, 1: false },
        compareScenarioIds: { 2: 21, 1: 10 }
    });
});

test('uses a dedicated value for the create-new comparison option', () => {
    assert.equal(CREATE_NEW_COMPARISON, '__new__');
});
