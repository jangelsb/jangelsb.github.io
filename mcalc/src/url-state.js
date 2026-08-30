import { normalizeAppData } from './data.js';

const SHARE_PREFIX = '#s=1.';
const MAX_SHARE_PAYLOAD_LENGTH = 100000;
const HOME_CHART_METRICS = ['balance', 'cumulativeInterest', 'equity', 'monthlyPayment'];
const COMPARISON_CHART_METRICS = ['monthlyPayment', 'balance', 'cumulativeInterest', 'equity'];

function bytesToBase64Url(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(value) {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function gzip(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new CompressionStream('gzip');
    const writer = stream.writable.getWriter();
    await writer.write(bytes);
    await writer.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function gunzip(bytes) {
    if (typeof DecompressionStream === 'undefined') return null;
    const stream = new DecompressionStream('gzip');
    const writer = stream.writable.getWriter();
    await writer.write(bytes);
    await writer.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

function validString(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}

function validMap(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeShareUiState(ui = {}) {
    const source = ui && typeof ui === 'object' ? ui : {};
    const activeResultTab = source.activeResultTab === 'summary' || /^data-\d+$/.test(source.activeResultTab)
        ? source.activeResultTab
        : 'summary';
    const activeChartMetric = HOME_CHART_METRICS.includes(source.activeChartMetric)
        ? source.activeChartMetric
        : 'balance';
    const compareChartMetric = COMPARISON_CHART_METRICS.includes(source.compareChartMetric)
        ? source.compareChartMetric
        : 'monthlyPayment';
    const compareChartYears = Number(source.compareChartYears);
    const activeComparisonId = source.activeComparisonId == null ? null : Number(source.activeComparisonId);

    return {
        activeResultTab,
        activeChartMetric,
        activeView: source.activeView === 'compare' ? 'compare' : 'home',
        compareChartMetric,
        compareChartYears: Number.isFinite(compareChartYears)
            ? Math.min(30, Math.max(1, Math.round(compareChartYears)))
            : 30,
        compareScenarioIds: validMap(source.compareScenarioIds),
        compareHomeIds: validMap(source.compareHomeIds),
        compareChartVisibility: validMap(source.compareChartVisibility),
        activeComparisonId: Number.isFinite(activeComparisonId) ? activeComparisonId : null,
        newComparison: {
            name: validString(source.newComparison?.name),
            description: validString(source.newComparison?.description)
        }
    };
}

export function buildShareState(appData, uiState) {
    return {
        version: 1,
        appData: normalizeAppData(appData),
        ui: normalizeShareUiState(uiState)
    };
}

export async function encodeShareState(appData, uiState) {
    const json = JSON.stringify(buildShareState(appData, uiState));
    const rawBytes = new TextEncoder().encode(json);
    const compressedBytes = await gzip(rawBytes);
    const encoding = compressedBytes ? 'g' : 'j';
    const bytes = compressedBytes || rawBytes;
    return `${SHARE_PREFIX}${encoding}.${bytesToBase64Url(bytes)}`;
}

export async function decodeShareHash(hash) {
    if (typeof hash !== 'string' || !hash.startsWith(SHARE_PREFIX)) return null;

    const encoded = hash.slice(SHARE_PREFIX.length);
    const separatorIndex = encoded.indexOf('.');
    if (separatorIndex < 1 || encoded.length > MAX_SHARE_PAYLOAD_LENGTH) {
        throw new Error('The share URL is invalid or too large.');
    }

    const encoding = encoded.slice(0, separatorIndex);
    const payload = encoded.slice(separatorIndex + 1);
    if (!payload || !['g', 'j'].includes(encoding)) {
        throw new Error('The share URL is invalid.');
    }

    let parsed;
    try {
        const encodedBytes = base64UrlToBytes(payload);
        const bytes = encoding === 'g' ? await gunzip(encodedBytes) : encodedBytes;
        if (!bytes) throw new Error('This browser cannot open compressed share URLs.');
        parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
        if (error.message === 'This browser cannot open compressed share URLs.') throw error;
        throw new Error('The share URL is invalid.');
    }
    if (!parsed || parsed.version !== 1 || !parsed.appData || !Array.isArray(parsed.appData.homes)) {
        throw new Error('The share URL contains unsupported calculator data.');
    }

    return {
        appData: normalizeAppData(parsed.appData),
        ui: normalizeShareUiState(parsed.ui)
    };
}
