export const STORAGE_KEY = 'mortgageAnalyzerData';
export const DEFAULT_BUYDOWN_YEAR_1 = 2;
export const DEFAULT_BUYDOWN_YEAR_2 = 1;
export const DEFAULT_LOAN_TERM_YEARS = 30;
export const DEFAULT_CLOSING_COST_PERCENT = 2;
export const DEFAULT_RATE_REDUCTION_PER_POINT = 0.25;
export const DEFAULT_MAX_RATE_BUYDOWN_POINTS = 4;
export const INCENTIVE_BUCKETS = ['rateBuydown', 'closingCosts', 'priceReduction', 'designUpgrades'];

const DEFAULT_SCENARIO = {
    id: 1,
    name: 'Builder 2-1 Buydown',
    type: 'buydown',
    termYears: DEFAULT_LOAN_TERM_YEARS,
    rate: 5.5,
    bdY1: DEFAULT_BUYDOWN_YEAR_1,
    bdY2: DEFAULT_BUYDOWN_YEAR_2,
    armRate: 5,
    armFee: 5000,
    rateReductionPerPoint: DEFAULT_RATE_REDUCTION_PER_POINT,
    maxRateBuydownPoints: DEFAULT_MAX_RATE_BUYDOWN_POINTS,
    designCost: 0,
    incentiveAllocation: {
        rateBuydown: 0,
        closingCosts: 0,
        priceReduction: 0,
        designUpgrades: 0
    }
};

const DEFAULT_FIXED_SCENARIO = {
    id: 2,
    name: 'Standard 30Yr Fixed',
    type: 'fixed',
    termYears: DEFAULT_LOAN_TERM_YEARS,
    rate: 5,
    bdY1: 0,
    bdY2: 0,
    armRate: 5,
    armFee: 5000,
    rateReductionPerPoint: DEFAULT_RATE_REDUCTION_PER_POINT,
    maxRateBuydownPoints: DEFAULT_MAX_RATE_BUYDOWN_POINTS,
    designCost: 0,
    incentiveAllocation: {
        rateBuydown: 0,
        closingCosts: 0,
        priceReduction: 0,
        designUpgrades: 0
    }
};

function formatScenarioNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

export function getScenarioLabel(scenario) {
    const rate = formatScenarioNumber(scenario.rate);
    if (scenario.type === 'buydown') {
        return `${formatScenarioNumber(scenario.bdY1)}:${formatScenarioNumber(scenario.bdY2)} @ ${rate}`;
    }
    if (scenario.type === 'arm') {
        return `7/1 ARM @ ${rate}`;
    }
    return `fixed @ ${rate}`;
}

export function getScenarioDisplayName(scenario) {
    return typeof scenario?.name === 'string' && scenario.name.trim()
        ? scenario.name.trim()
        : getScenarioLabel(scenario);
}

export function createDefaultAppData() {
    return {
        version: 3,
        activeHomeId: 1,
        activeGroupId: null,
        homes: [{
            id: 1,
            name: 'Lake Elsinore Build',
            price: 750000,
            downType: 'amount',
            downValue: 225000,
            closingCostEstimateMode: 'percentOfLoan',
            closingCostEstimatePercent: DEFAULT_CLOSING_COST_PERCENT,
            closingCostEstimateAmount: 0,
            incentivePool: 0,
            tax: 1.8,
            hoa: 120,
            ins: 230,
            appreciation: 3,
            notes: '',
            scenarios: [clone(DEFAULT_SCENARIO), clone(DEFAULT_FIXED_SCENARIO)]
        }],
        scenarioGroups: []
    };
}

function numberOr(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeAllocation(source) {
    const allocation = source?.incentiveAllocation || source?.allocation || {};
    return INCENTIVE_BUCKETS.reduce((result, bucket) => {
        result[bucket] = Math.max(0, numberOr(allocation[bucket]));
        return result;
    }, {});
}

function normalizeScenario(scenario, index) {
    const source = scenario && typeof scenario === 'object' ? scenario : {};
    return {
        id: source.id ?? index + 1,
        name: typeof source.name === 'string' && source.name.trim()
            ? source.name.trim()
            : getScenarioLabel(source),
        type: ['fixed', 'buydown', 'arm'].includes(source.type) ? source.type : 'fixed',
        termYears: numberOr(source.termYears, DEFAULT_LOAN_TERM_YEARS) > 0
            ? numberOr(source.termYears, DEFAULT_LOAN_TERM_YEARS)
            : DEFAULT_LOAN_TERM_YEARS,
        rate: numberOr(source.rate),
        bdY1: numberOr(source.bdY1),
        bdY2: numberOr(source.bdY2),
        armRate: numberOr(source.armRate),
        armFee: numberOr(source.armFee),
        rateReductionPerPoint: Math.max(0, numberOr(source.rateReductionPerPoint, DEFAULT_RATE_REDUCTION_PER_POINT)),
        maxRateBuydownPoints: Math.max(0, numberOr(source.maxRateBuydownPoints, DEFAULT_MAX_RATE_BUYDOWN_POINTS)),
        designCost: Math.max(0, numberOr(source.designCost ?? source.upgrades?.selectedCost)),
        incentiveAllocation: normalizeAllocation(source)
    };
}

function normalizeHome(home, index) {
    const source = home && typeof home === 'object' ? home : {};
    const scenarios = Array.isArray(source.scenarios)
        ? source.scenarios.map(normalizeScenario)
        : [];
    const closingCostEstimateMode = source.closingCostEstimateMode === 'fixed'
        ? 'fixed'
        : source.closingCostEstimateMode === 'percentOfLoan'
            ? 'percentOfLoan'
            : source.closingCostEstimateAmount !== undefined && source.closingCosts === undefined
                ? 'fixed'
                : 'percentOfLoan';

    return {
        id: source.id ?? index + 1,
        name: typeof source.name === 'string' ? source.name : `Property ${index + 1}`,
        price: numberOr(source.price),
        downType: source.downType === 'percent' ? 'percent' : 'amount',
        downValue: numberOr(source.downValue),
        closingCostEstimateMode,
        closingCostEstimatePercent: numberOr(
            source.closingCostEstimatePercent ?? source.closingCosts,
            DEFAULT_CLOSING_COST_PERCENT
        ),
        closingCostEstimateAmount: Math.max(0, numberOr(source.closingCostEstimateAmount)),
        incentivePool: Math.max(0, numberOr(source.incentivePool ?? source.builderIncentive)),
        tax: numberOr(source.tax),
        hoa: numberOr(source.hoa),
        ins: numberOr(source.ins),
        appreciation: numberOr(source.appreciation),
        notes: typeof source.notes === 'string' ? source.notes : '',
        scenarios
    };
}

export function normalizeAppData(data) {
    const source = data && typeof data === 'object' ? data : {};
    const homes = Array.isArray(source.homes) ? source.homes.map(normalizeHome) : [];
    const safeHomes = homes.length ? homes : createDefaultAppData().homes;
    const activeHomeId = safeHomes.some(home => home.id === source.activeHomeId)
        ? source.activeHomeId
        : safeHomes[0].id;

    return {
        ...source,
        version: 3,
        activeHomeId,
        activeGroupId: source.activeGroupId ?? null,
        homes: safeHomes,
        scenarioGroups: Array.isArray(source.scenarioGroups) ? source.scenarioGroups : []
    };
}

export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export function generateId(usedIds = []) {
    let id;
    do {
        id = Math.floor(Math.random() * 1000000);
    } while (usedIds.includes(id));
    return id;
}

export function sortHomesForDisplay(homes) {
    return [...homes].sort((left, right) => {
        const byName = String(left.name ?? '').localeCompare(String(right.name ?? ''), undefined, { sensitivity: 'base' });
        return byName || String(left.id).localeCompare(String(right.id));
    });
}

export function compareChartCalloutValues(left, right) {
    const leftValue = Number.isFinite(Number(left?.parsed?.y)) ? Number(left.parsed.y) : Number(left?.raw ?? 0);
    const rightValue = Number.isFinite(Number(right?.parsed?.y)) ? Number(right.parsed.y) : Number(right?.raw ?? 0);
    const byValue = rightValue - leftValue;
    if (byValue !== 0) return byValue;

    const leftLabel = String(left?.dataset?.label ?? '');
    const rightLabel = String(right?.dataset?.label ?? '');
    return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: 'base' }) || String(left?.dataset?.dataIndex ?? 0).localeCompare(String(right?.dataset?.dataIndex ?? 0));
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
