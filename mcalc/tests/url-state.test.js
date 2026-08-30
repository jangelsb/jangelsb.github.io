import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultAppData } from '../src/data.js';
import { decodeShareHash, encodeShareState } from '../src/url-state.js';

test('encodes and decodes calculator data and UI state', async () => {
    const appData = createDefaultAppData();
    appData.homes[0].name = 'Café Home';
    appData.homes[0].notes = 'Keep this note: 20% down & closing costs.';
    const uiState = {
        activeView: 'compare',
        activeChartMetric: 'equity',
        compareChartYears: 12,
        compareHomeIds: { 1: true }
    };

    const hash = await encodeShareState(appData, uiState);
    const result = await decodeShareHash(hash);

    assert.match(hash, /^#s=1\.[gj]\./);
    assert.equal(result.appData.homes[0].name, 'Café Home');
    assert.equal(result.appData.homes[0].notes, 'Keep this note: 20% down & closing costs.');
    assert.equal(result.ui.activeView, 'compare');
    assert.equal(result.ui.activeChartMetric, 'equity');
    assert.equal(result.ui.compareChartYears, 12);
});

test('rejects malformed share URLs', async () => {
    await assert.rejects(() => decodeShareHash('#s=1.g.not-valid-json'), /invalid|unsupported/i);
    assert.equal(await decodeShareHash('#other=value'), null);
});

test('normalizes unsafe UI values from a share URL', async () => {
    const appData = createDefaultAppData();
    const hash = await encodeShareState(appData, {
        activeView: 'not-a-view',
        activeChartMetric: 'not-a-metric',
        compareChartYears: 999
    });
    const result = await decodeShareHash(hash);

    assert.equal(result.ui.activeView, 'home');
    assert.equal(result.ui.activeChartMetric, 'balance');
    assert.equal(result.ui.compareChartYears, 30);
});
