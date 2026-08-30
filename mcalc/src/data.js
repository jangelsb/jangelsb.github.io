export const STORAGE_KEY = 'mortgageAnalyzerData';
export const DEFAULT_BUYDOWN_YEAR_1 = 2;
export const DEFAULT_BUYDOWN_YEAR_2 = 1;
export const DEFAULT_LOAN_TERM_YEARS = 30;

const DEFAULT_SCENARIO = {
    id: 1,
    name: 'Builder 2-1 Buydown',
    type: 'buydown',
    termYears: DEFAULT_LOAN_TERM_YEARS,
    rate: 5.5,
    bdY1: DEFAULT_BUYDOWN_YEAR_1,
    bdY2: DEFAULT_BUYDOWN_YEAR_2,
    armRate: 5,
    armFee: 5000
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
    armFee: 5000
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

export function createDefaultAppData() {
    return {
        version: 2,
        activeHomeId: 1,
        activeGroupId: null,
        homes: [{
            id: 1,
            name: 'Lake Elsinore Build',
            price: 750000,
            downType: 'amount',
            downValue: 225000,
            closingCosts: 2,
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

function normalizeScenario(scenario, index) {
    const source = scenario && typeof scenario === 'object' ? scenario : {};
    return {
        id: source.id ?? index + 1,
        name: getScenarioLabel(source),
        type: ['fixed', 'buydown', 'arm'].includes(source.type) ? source.type : 'fixed',
        termYears: numberOr(source.termYears, DEFAULT_LOAN_TERM_YEARS) > 0
            ? numberOr(source.termYears, DEFAULT_LOAN_TERM_YEARS)
            : DEFAULT_LOAN_TERM_YEARS,
        rate: numberOr(source.rate),
        bdY1: numberOr(source.bdY1),
        bdY2: numberOr(source.bdY2),
        armRate: numberOr(source.armRate),
        armFee: numberOr(source.armFee)
    };
}

function normalizeHome(home, index) {
    const source = home && typeof home === 'object' ? home : {};
    const scenarios = Array.isArray(source.scenarios)
        ? source.scenarios.map(normalizeScenario)
        : [];

    return {
        id: source.id ?? index + 1,
        name: typeof source.name === 'string' ? source.name : `Property ${index + 1}`,
        price: numberOr(source.price),
        downType: source.downType === 'percent' ? 'percent' : 'amount',
        downValue: numberOr(source.downValue),
        closingCosts: numberOr(source.closingCosts),
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
        version: 2,
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

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
