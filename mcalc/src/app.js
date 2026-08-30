import {
    DEFAULT_BUYDOWN_YEAR_1,
    DEFAULT_BUYDOWN_YEAR_2,
    DEFAULT_MAX_RATE_BUYDOWN_POINTS,
    DEFAULT_LOAN_TERM_YEARS,
    DEFAULT_RATE_REDUCTION_PER_POINT,
    INCENTIVE_BUCKETS,
    clone,
    compareChartCalloutValues,
    escapeHtml,
    generateId,
    getScenarioDisplayName,
    getScenarioLabel,
    normalizeAppData,
    sortHomesForDisplay
} from './data.js';
import { calculateScenario } from './calculations.js';
import {
    applyComparisonHomeConfigs,
    buildComparisonHomeConfigs,
    CREATE_NEW_COMPARISON
} from './comparisons.js';
import { loadAppData, parseImportedData, saveAppData } from './storage.js';

const state = {
    activeResultTab: 'summary',
    activeChartMetric: 'balance',
    activeView: 'home',
    compareChartMetric: 'monthlyPayment',
    compareChartYears: 30,
    compareScenarioIds: {},
    compareHomeIds: {},
    compareChartVisibility: {},
    activeComparisonId: null,
    newComparison: { name: '', description: '' }
};

let appData = loadAppData();
let chart = null;
let resultsData = [];

const $ = selector => document.querySelector(selector);

function destroyChart() {
    if (chart) {
        chart.destroy();
        chart = null;
    }
}

function persist() {
    saveAppData(appData);
}

function getActiveHome() {
    return appData.homes.find(home => home.id === appData.activeHomeId) || appData.homes[0];
}

function formatCurrency(value) {
    return `$${Math.round(Number(value) || 0).toLocaleString()}`;
}

function homeById(homeId) {
    return appData.homes.find(home => home.id === Number(homeId));
}

function scenarioById(home, scenarioId) {
    return home?.scenarios.find(scenario => scenario.id === Number(scenarioId));
}

function renderApp() {
    if (appData.homes.length < 2 && state.activeView === 'compare') state.activeView = 'home';
    renderTabsAndControls();
    if (state.activeView === 'compare') {
        renderComparison();
        return;
    }

    renderActiveHome();
    runCalculations();
}

function renderTabsAndControls() {
    const tabs = sortHomesForDisplay(appData.homes).map(home => {
        const active = state.activeView === 'home' && home.id === appData.activeHomeId ? 'active' : '';
        return `<button class="home-tab ${active}" data-action="switch-home" data-home-id="${home.id}">${escapeHtml(home.name)}</button>`;
    }).join('');

    $('#homeTabsContainer').innerHTML = `<div class="home-tab-list">${tabs}<button class="btn-success" data-action="add-home">+ Add Home</button></div>
        ${appData.homes.length > 1 ? `<div class="home-action-list"><button class="home-tab compare-home-tab ${state.activeView === 'compare' ? 'active' : ''}" data-action="show-comparison">Compare Homes</button></div>` : ''}`;
}

function getActiveComparison() {
    return appData.scenarioGroups.find(group => group.id === state.activeComparisonId) || null;
}

function renderComparisonManager() {
    const comparison = getActiveComparison();
    const name = comparison?.name ?? state.newComparison.name;
    const description = comparison?.description ?? state.newComparison.description;
    const selectedValue = comparison ? String(comparison.id) : CREATE_NEW_COMPARISON;
    const options = appData.scenarioGroups.map(group => `<option value="${group.id}" ${String(group.id) === selectedValue ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('');

    const actions = comparison
        ? '<button class="btn-danger" data-action="delete-comparison">Delete Comparison</button>'
        : '<button class="btn-success" data-action="save-comparison">Save New Comparison</button>';

    return `<div class="comparison-controls comparison-card-controls">
            <div class="comparison-control"><label for="comparisonSelector">Comparison</label><select id="comparisonSelector" data-action="select-comparison"><option value="${CREATE_NEW_COMPARISON}" ${selectedValue === CREATE_NEW_COMPARISON ? 'selected' : ''}>Create new</option>${options}</select></div>
            <div class="comparison-control comparison-title-control"><label for="comparisonName">Title</label><input id="comparisonName" value="${escapeHtml(name)}" placeholder="Comparison title" data-comparison-field="name"></div>
            <div class="comparison-control comparison-description-control"><label for="comparisonDescription">Description / Notes</label><textarea id="comparisonDescription" placeholder="Add notes about this comparison..." data-comparison-field="description">${escapeHtml(description)}</textarea></div>
        </div>
        <div class="button-row comparison-card-actions">${actions}</div>`;
}

const incentiveBucketLabels = {
    rateBuydown: 'Rate buydown',
    closingCosts: 'Closing costs',
    priceReduction: 'Price reduction',
    designUpgrades: 'Design / lot upgrades'
};

function scenarioAllocation(scenario) {
    return INCENTIVE_BUCKETS.reduce((result, bucket) => {
        result[bucket] = Math.max(0, Number(scenario.incentiveAllocation?.[bucket]) || 0);
        return result;
    }, {});
}

function renderIncentiveAllocation(home, scenario) {
    const allocation = scenarioAllocation(scenario);
    const total = INCENTIVE_BUCKETS.reduce((sum, bucket) => sum + allocation[bucket], 0);
    const pool = Math.max(0, Number(home.incentivePool) || 0);
    if (pool === 0) return '';
    const scenarioResult = calculateScenario(home, scenario);
    const allocationCaps = scenarioResult.allocationCaps;
    const remaining = pool - total;
    const status = remaining >= 0
        ? `${formatCurrency(remaining)} unallocated`
        : `${formatCurrency(Math.abs(remaining))} over the incentive pool`;
    const rows = INCENTIVE_BUCKETS.map(bucket => `<div class="allocation-row">
            <div class="allocation-label"><label for="allocation-${scenario.id}-${bucket}">${incentiveBucketLabels[bucket]}</label><output>${formatCurrency(allocation[bucket])}</output></div>
            <input id="allocation-${scenario.id}-${bucket}" type="range" min="0" max="${pool}" step="100" value="${allocation[bucket]}"
                data-home-id="${home.id}" data-scenario-id="${scenario.id}" data-allocation-field="${bucket}">
            <input type="number" min="0" max="${pool}" step="100" value="${allocation[bucket]}" aria-label="${incentiveBucketLabels[bucket]} amount"
                data-home-id="${home.id}" data-scenario-id="${scenario.id}" data-allocation-field="${bucket}">
            <button class="btn-secondary allocation-max" type="button" title="Maximum eligible: ${formatCurrency(allocationCaps[bucket])}" data-action="max-allocation" data-home-id="${home.id}" data-scenario-id="${scenario.id}" data-allocation-field="${bucket}">Max</button>
        </div>`).join('');
    return `<div class="incentive-allocation">
        <div class="allocation-heading"><strong>Builder incentive allocation</strong><span>${formatCurrency(pool)} available</span></div>
        <p class="muted">Allocate the pool across the four options. Rate points are separate from closing-cost credits.</p>
        <p class="muted field-help">Rate cap: ${scenario.maxRateBuydownPoints} points × ${scenario.rateReductionPerPoint.toFixed(2)}% per point. Confirm these values with the lender.</p>
        ${rows}
        <div class="allocation-total"><span>Total allocated</span><strong>${formatCurrency(total)}</strong><span class="allocation-status ${remaining < 0 ? 'allocation-over' : ''}">${status}</span></div>
    </div>`;
}

function renderActiveHome() {
    const home = getActiveHome();
    if (!home) return;

    const scenarios = home.scenarios.map(scenario => `
        <div class="scenario-box" data-home-id="${home.id}">
            <div class="scenario-header">
                <input class="scenario-name-input" type="text" value="${escapeHtml(getScenarioDisplayName(scenario))}"
                    data-home-id="${home.id}" data-scenario-id="${scenario.id}" data-scenario-field="name" aria-label="Scenario name">
                <button class="btn-danger" data-action="delete-scenario"
                    data-home-id="${home.id}" data-scenario-id="${scenario.id}">Delete</button>
            </div>
            <label>Loan Type</label>
            <select data-scenario-id="${scenario.id}" data-scenario-field="type">
                <option value="fixed" ${scenario.type === 'fixed' ? 'selected' : ''}>Standard Fixed</option>
                <option value="buydown" ${scenario.type === 'buydown' ? 'selected' : ''}>Custom Buydown</option>
                <option value="arm" ${scenario.type === 'arm' ? 'selected' : ''}>7/1 ARM</option>
            </select>
            <label>Loan Term (years)</label>
            <input type="number" min="1" max="50" step="1" value="${scenario.termYears}"
                data-scenario-id="${scenario.id}" data-scenario-field="termYears">
            <label>Base / Note Rate (%)</label>
            <input type="number" step="0.1" value="${scenario.rate}"
                data-scenario-id="${scenario.id}" data-scenario-field="rate">

            ${home.incentivePool > 0 ? `<div class="rate-buydown-settings">
                <label>Rate Reduction per Point (%)</label>
                <input type="number" min="0" step="0.05" value="${scenario.rateReductionPerPoint}"
                    data-scenario-id="${scenario.id}" data-scenario-field="rateReductionPerPoint">
                <label>Maximum Rate-Buydown Points</label>
                <input type="number" min="0" step="0.25" value="${scenario.maxRateBuydownPoints}"
                    data-scenario-id="${scenario.id}" data-scenario-field="maxRateBuydownPoints">
                <p class="muted field-help">These are lender/product assumptions, not universal limits.</p>
            </div>` : ''}

            <label>Design / Lot Upgrade Cost ($)</label>
            <input type="number" min="0" step="100" value="${scenario.designCost}"
                data-scenario-id="${scenario.id}" data-scenario-field="designCost">

            <div class="dynamic-fields" style="display:${scenario.type === 'buydown' ? 'block' : 'none'}">
                <label>Year 1 Rate Drop (%)</label>
                <input type="number" step="0.5" value="${scenario.bdY1}"
                    data-scenario-id="${scenario.id}" data-scenario-field="bdY1">
                <label>Year 2 Rate Drop (%)</label>
                <input type="number" step="0.5" value="${scenario.bdY2}"
                    data-scenario-id="${scenario.id}" data-scenario-field="bdY2">
            </div>

            <div class="dynamic-fields" style="display:${scenario.type === 'arm' ? 'block' : 'none'}">
                <label>Year 8+ Refi Rate (%)</label>
                <input type="number" step="0.1" value="${scenario.armRate}"
                    data-scenario-id="${scenario.id}" data-scenario-field="armRate">
                <label>Year 7 Refi Fee Rolled In ($)</label>
                <input type="number" value="${scenario.armFee}"
                    data-scenario-id="${scenario.id}" data-scenario-field="armFee">
            </div>
            ${renderIncentiveAllocation(home, scenario)}
        </div>`).join('');

    $('#appContent').innerHTML = `
        <div class="card">
            <div class="flex-between property-header">
                <input type="text" class="property-name" value="${escapeHtml(home.name)}"
                    data-home-id="${home.id}" data-home-field="name">
                <div class="button-row">
                    <button class="btn-secondary" data-action="duplicate-home" data-home-id="${home.id}">Duplicate Property</button>
                    <button class="btn-danger" data-action="delete-home" data-home-id="${home.id}">Delete Property</button>
                </div>
            </div>

            <div class="grid-globals">
                <div><label>Purchase Price ($)</label><input type="number" value="${home.price}" data-home-id="${home.id}" data-home-field="price"></div>
                <div><label>Down Payment</label><div class="input-group">
                    <select data-home-id="${home.id}" data-home-field="downType">
                        <option value="amount" ${home.downType === 'amount' ? 'selected' : ''}>$</option>
                        <option value="percent" ${home.downType === 'percent' ? 'selected' : ''}>%</option>
                    </select>
                    <input type="number" step="0.1" value="${home.downValue}" data-home-id="${home.id}" data-home-field="downValue">
                </div></div>
                <div><label>Builder Incentive Pool ($)</label><input type="number" min="0" step="100" value="${home.incentivePool}" data-home-id="${home.id}" data-home-field="incentivePool"></div>
                <div><label>Closing Cost Estimate</label><div class="input-group">
                    <select data-home-id="${home.id}" data-home-field="closingCostEstimateMode">
                        <option value="percentOfLoan" ${home.closingCostEstimateMode === 'percentOfLoan' ? 'selected' : ''}>% of loan</option>
                        <option value="fixed" ${home.closingCostEstimateMode === 'fixed' ? 'selected' : ''}>$ amount</option>
                    </select>
                    <input type="number" min="0" step="0.1" value="${home.closingCostEstimateMode === 'fixed' ? home.closingCostEstimateAmount : home.closingCostEstimatePercent}"
                        data-home-id="${home.id}" data-home-field="${home.closingCostEstimateMode === 'fixed' ? 'closingCostEstimateAmount' : 'closingCostEstimatePercent'}">
                </div><p class="muted field-help">Excludes discount points; those use the rate-buydown allocation.</p></div>
                <div><label>Property Tax (%/yr)</label><input type="number" step="0.01" value="${home.tax}" data-home-id="${home.id}" data-home-field="tax"></div>
                <div><label>Monthly HOA ($)</label><input type="number" value="${home.hoa}" data-home-id="${home.id}" data-home-field="hoa"></div>
                <div><label>Monthly Ins. ($)</label><input type="number" value="${home.ins}" data-home-id="${home.id}" data-home-field="ins"></div>
                <div><label>Annual Appreciation (%)</label><input type="number" step="0.1" value="${home.appreciation}" data-home-id="${home.id}" data-home-field="appreciation"></div>
            </div>

            <label>Property Notes & Thoughts:</label>
            <textarea data-home-id="${home.id}" data-home-field="notes">${escapeHtml(home.notes)}</textarea>
        </div>

        <div class="card">
            <div class="flex-between"><h2>Purchase Scenarios</h2>
                <button class="btn-success" data-action="add-scenario" data-home-id="${home.id}">+ Add Scenario</button>
            </div>
            <p class="muted">Save a complete loan and builder-incentive strategy for this property.</p>
            <div class="grid-scenarios">${scenarios || '<p>No scenarios yet. Add one to see results.</p>'}</div>
        </div>`;
}

function updateHome(homeId, field, value) {
    const home = homeById(homeId);
    if (!home) return;
    home[field] = ['name', 'notes', 'downType', 'closingCostEstimateMode'].includes(field)
        ? value
        : Number.parseFloat(value) || 0;
    persist();

    if (field === 'name') {
        renderTabsAndControls();
    }
    if (field === 'downType' || field === 'closingCostEstimateMode' || field === 'incentivePool') {
        renderApp();
    } else {
        runCalculations();
    }
}

function updateScenario(homeId, scenarioId, field, value) {
    const scenario = scenarioById(homeById(homeId), scenarioId);
    if (!scenario) return;
    scenario[field] = ['name', 'type'].includes(field) ? value : Number.parseFloat(value) || 0;
    persist();

    if (field === 'type') {
        renderApp();
    } else {
        runCalculations();
    }
}

function updateScenarioAllocation(homeId, scenarioId, field, value, inputElement) {
    const home = homeById(homeId);
    const scenario = scenarioById(home, scenarioId);
    if (!home || !scenario || !INCENTIVE_BUCKETS.includes(field)) return;
    const allocation = scenarioAllocation(scenario);
    const nextValue = Math.max(0, Number.parseFloat(value) || 0);
    const otherTotal = INCENTIVE_BUCKETS
        .filter(bucket => bucket !== field)
        .reduce((sum, bucket) => sum + allocation[bucket], 0);
    const pool = Math.max(0, Number(home.incentivePool) || 0);
    const appliedValue = Math.min(nextValue, Math.max(0, pool - otherTotal));
    scenario.incentiveAllocation[field] = appliedValue;
    if (inputElement) {
        const row = inputElement.closest('.allocation-row');
        row?.querySelectorAll('input').forEach(input => { input.value = appliedValue; });
        const output = row?.querySelector('output');
        if (output) output.textContent = formatCurrency(appliedValue);
        const allocationBox = inputElement.closest('.incentive-allocation');
        const total = INCENTIVE_BUCKETS.reduce((sum, bucket) => sum + scenarioAllocation(scenario)[bucket], 0);
        const remaining = pool - total;
        const totalValue = allocationBox?.querySelector('.allocation-total strong');
        const status = allocationBox?.querySelector('.allocation-status');
        if (totalValue) totalValue.textContent = formatCurrency(total);
        if (status) {
            status.textContent = remaining >= 0
                ? `${formatCurrency(remaining)} unallocated`
                : `${formatCurrency(Math.abs(remaining))} over the incentive pool`;
            status.classList.toggle('allocation-over', remaining < 0);
        }
    }
    persist();
    runCalculations();
}

function maxScenarioAllocation(homeId, scenarioId, field) {
    const home = homeById(homeId);
    const scenario = scenarioById(home, scenarioId);
    if (!home || !scenario || !INCENTIVE_BUCKETS.includes(field)) return;
    const allocation = scenarioAllocation(scenario);
    const otherTotal = INCENTIVE_BUCKETS
        .filter(bucket => bucket !== field)
        .reduce((sum, bucket) => sum + allocation[bucket], 0);
    const availablePool = Math.max(0, (Number(home.incentivePool) || 0) - otherTotal);
    const cap = calculateScenario(home, scenario).allocationCaps[field];
    scenario.incentiveAllocation[field] = Math.min(availablePool, Number.isFinite(cap) ? cap : availablePool);
    persist();
    renderApp();
}

function addHome() {
    const source = appData.homes[0];
    const newHome = clone(source);
    newHome.id = generateId(appData.homes.map(home => home.id));
    newHome.name = 'New Property';
    newHome.notes = '';
    newHome.incentivePool = 0;
    newHome.scenarios = newHome.scenarios.map((scenario, index) => ({
        ...scenario,
        id: generateId(appData.homes.flatMap(home => home.scenarios.map(item => item.id)).concat(index))
    }));
    appData.homes.push(newHome);
    appData.activeHomeId = newHome.id;
    persist();
    renderApp();
}

function duplicateHome(homeId) {
    const source = homeById(homeId);
    if (!source) return;
    const usedHomeIds = appData.homes.map(home => home.id);
    const usedScenarioIds = appData.homes.flatMap(home => home.scenarios.map(scenario => scenario.id));
    const duplicate = clone(source);
    duplicate.id = generateId(usedHomeIds);
    duplicate.name = `${source.name} Copy`;
    duplicate.scenarios = duplicate.scenarios.map(scenario => ({
        ...scenario,
        id: generateId(usedScenarioIds)
    }));
    appData.homes.push(duplicate);
    appData.activeHomeId = duplicate.id;
    persist();
    renderApp();
}

function deleteHome(homeId) {
    if (appData.homes.length === 1) {
        alert('You must have at least one home profile.');
        return;
    }
    if (!confirm('Are you sure you want to delete this home?')) return;
    appData.homes = appData.homes.filter(home => home.id !== Number(homeId));
    appData.scenarioGroups.forEach(group => {
        group.homeConfigs = group.homeConfigs.filter(config => config.homeId !== Number(homeId));
    });
    appData.activeHomeId = appData.homes[0].id;
    persist();
    renderApp();
}

function addScenario(homeId) {
    const home = homeById(homeId);
    if (!home) return;
    const usedIds = appData.homes.flatMap(item => item.scenarios.map(scenario => scenario.id));
    home.scenarios.push({
        id: generateId(usedIds),
        name: getScenarioLabel({ type: 'fixed', rate: 5, bdY1: DEFAULT_BUYDOWN_YEAR_1, bdY2: DEFAULT_BUYDOWN_YEAR_2 }),
        type: 'fixed',
        termYears: DEFAULT_LOAN_TERM_YEARS,
        rate: 5,
        bdY1: DEFAULT_BUYDOWN_YEAR_1,
        bdY2: DEFAULT_BUYDOWN_YEAR_2,
        armRate: 5,
        armFee: 5000,
        name: 'New Scenario',
        rateReductionPerPoint: DEFAULT_RATE_REDUCTION_PER_POINT,
        maxRateBuydownPoints: DEFAULT_MAX_RATE_BUYDOWN_POINTS,
        designCost: 0,
        incentiveAllocation: {
            rateBuydown: 0,
            closingCosts: 0,
            priceReduction: 0,
            designUpgrades: 0
        }
    });
    persist();
    renderApp();
}

function deleteScenario(homeId, scenarioId) {
    const home = homeById(homeId);
    if (!home) return;
    home.scenarios = home.scenarios.filter(scenario => scenario.id !== Number(scenarioId));
    appData.scenarioGroups.forEach(group => group.homeConfigs.forEach(config => {
        if (Number(config.homeId) === Number(homeId) && Number(config.scenarioId) === Number(scenarioId)) {
            config.scenarioId = home.scenarios[0]?.id || null;
        }
    }));
    persist();
    renderApp();
}

function runCalculations() {
    const home = getActiveHome();
    if (!home || home.scenarios.length === 0) {
        resultsData = [];
        $('#resultsContainer').innerHTML = '';
        destroyChart();
        return;
    }

    resultsData = home.scenarios.map(scenario => {
        const result = calculateScenario(home, scenario);
        return { ...result, scenario, data: result.amortization };
    });
    renderResults(home);
}

function getComparisonData(home) {
    const selectedId = state.compareScenarioIds[home.id];
    const scenario = scenarioById(home, selectedId) || home.scenarios[0];
    if (!scenario) return null;
    state.compareScenarioIds[home.id] = scenario.id;
    const result = calculateScenario(home, scenario);
    return { ...result, home, scenario, data: result.amortization };
}

function isHomeIncluded(homeId) {
    return state.compareHomeIds[homeId] !== false;
}

function renderComparison() {
    const homes = sortHomesForDisplay(appData.homes);
    const included = homes.filter(home => isHomeIncluded(home.id));
    const comparisonData = included.map(getComparisonData).filter(Boolean);
    const homeSelection = homes.map(home => `
        <label class="checkbox-label"><input type="checkbox" data-compare-home-id="${home.id}" ${isHomeIncluded(home.id) ? 'checked' : ''}> ${escapeHtml(home.name)}</label>
    `).join('');
    const comparisonManager = renderComparisonManager();

    if (!comparisonData.length) {
        $('#appContent').innerHTML = `<div class="card comparison-results-card"><h2>Compare Homes</h2><p>Select at least one home to compare.</p>${comparisonManager}<div class="comparison-controls">${homeSelection}</div></div>`;
        $('#resultsContainer').innerHTML = '';
        destroyChart();
        return;
    }

    const controls = comparisonData.map(item => `
        <div class="comparison-control"><label>${escapeHtml(item.home.name)}</label>
            <select data-compare-scenario-home-id="${item.home.id}">
                ${item.home.scenarios.map(scenario => `<option value="${scenario.id}" ${scenario.id === item.scenario.id ? 'selected' : ''}>${escapeHtml(getScenarioDisplayName(scenario))}</option>`).join('')}
            </select>
        </div>`).join('');

    const incentiveRows = comparisonData.some(item => item.incentivePool > 0) ? [
        ['Incentive used', item => formatCurrency(item.incentiveUsed)],
        ['Incentive remaining', item => formatCurrency(item.incentiveRemaining)],
        ['Estimated closing costs', item => formatCurrency(item.estimatedClosingCosts)],
        ['Closing-cost credit', item => formatCurrency(item.closingCredit)],
        ['Remaining closing costs', item => formatCurrency(item.remainingClosingCosts)],
        ['Design/lot credit', item => formatCurrency(item.designCredit)],
        ['Remaining upgrade cost', item => formatCurrency(item.remainingDesignCost)]
    ] : [];
    const rows = [
        ['Purchase price', item => formatCurrency(item.finalPrice)],
        ['Down payment', item => formatCurrency(item.downPayment)],
        ['Loan amount', item => formatCurrency(item.loanAmount)],
        ['Interest rate', item => `${item.finalRate.toFixed(3)}%`],
        ['Rate-buydown points', item => item.pointsPurchased.toFixed(2)],
        ...incentiveRows,
        ['Cash needed to close', item => formatCurrency(item.cashToClose)],
        ['Purchase scenario', item => escapeHtml(getScenarioDisplayName(item.scenario))],
        ['Loan term', item => `${item.scenario.termYears} years`],
        ['Year 1 monthly payment', item => formatCurrency(item.data[0].totalMonthly)],
        ['Remaining balance after 3 years', item => formatCurrency(item.data[2].balance)],
        ['Remaining balance after 5 years', item => formatCurrency(item.data[4].balance)],
        ['Remaining balance after 10 years', item => formatCurrency(item.data[9].balance)],
        ['Net equity after 3 years', item => formatCurrency(item.data[2].equity)],
        ['Net equity after 5 years', item => formatCurrency(item.data[4].equity)],
        ['Net equity after 10 years', item => formatCurrency(item.data[9].equity)],
        ['Interest paid after 3 years', item => formatCurrency(item.data[2].cumulativeInterest)],
        ['Interest paid after 5 years', item => formatCurrency(item.data[4].cumulativeInterest)],
        ['Interest paid after 10 years', item => formatCurrency(item.data[9].cumulativeInterest)],
        ['Total interest over loan term', item => formatCurrency(item.data[item.data.length - 1].cumulativeInterest)]
    ];
    const table = `<div class="comparison-scroll"><table class="comparison-table"><thead><tr><th>Metric</th>${comparisonData.map(item => `<th>${escapeHtml(item.home.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, value]) => `<tr><td>${label}</td>${comparisonData.map(item => `<td>${value(item)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    $('#appContent').innerHTML = `<div class="card comparison-results-card">
        <h2>Compare Homes</h2><p class="muted">Choose one complete purchase scenario for each property.</p>
        ${comparisonManager}
        <div class="comparison-controls">${homeSelection}</div>
        <div class="comparison-controls comparison-scenarios">${controls}</div>
        ${table}
    </div>`;
    renderComparisonChart(comparisonData);
}

function metricLabel(metric) {
    return {
        monthlyPayment: 'Monthly Payment',
        balance: 'Remaining Loan Balance',
        cumulativeInterest: 'Cumulative Interest Paid',
        equity: 'Net Equity'
    }[metric] || 'Mortgage Metric';
}

function metricValue(row, metric) {
    return metric === 'monthlyPayment' ? row.totalMonthly : row[metric];
}

function renderComparisonChart(comparisonData) {
    $('#resultsContainer').innerHTML = `<div class="card"><div class="chart-controls"><h3>${metricLabel(state.compareChartMetric)}</h3>
        <select class="chart-select" data-chart-context="comparison"><option value="monthlyPayment" ${state.compareChartMetric === 'monthlyPayment' ? 'selected' : ''}>Monthly Payment</option><option value="balance" ${state.compareChartMetric === 'balance' ? 'selected' : ''}>Remaining Loan Balance</option><option value="cumulativeInterest" ${state.compareChartMetric === 'cumulativeInterest' ? 'selected' : ''}>Cumulative Interest Paid</option><option value="equity" ${state.compareChartMetric === 'equity' ? 'selected' : ''}>Net Equity</option></select>
        <div class="chart-range"><label for="comparisonYears">Years 1-${state.compareChartYears}</label><input id="comparisonYears" type="range" min="1" max="30" value="${state.compareChartYears}" data-comparison-years></div>
    </div><div class="chart-container"><canvas id="comparisonChart"></canvas></div></div>`;

    destroyChart();
    if (typeof Chart === 'undefined') return;
    const colors = ['#1a73e8', '#ea4335', '#34a853', '#fbbc04', '#673ab7'];
    chart = new Chart($('#comparisonChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: Array.from({ length: state.compareChartYears }, (_, index) => `Yr ${index + 1}`),
            datasets: comparisonData.map((item, index) => ({
                label: `${item.home.name} - ${getScenarioDisplayName(item.scenario)}`,
                homeId: item.home.id,
                hidden: state.compareChartVisibility[item.home.id] === false,
                data: item.data.slice(0, state.compareChartYears).map(row => metricValue(row, state.compareChartMetric)),
                borderColor: colors[index % colors.length],
                backgroundColor: 'transparent'
            }))
        },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: {
            legend: { position: 'top', onClick: (event, legendItem, legend) => {
                const datasetIndex = legendItem.datasetIndex;
                const current = legend.chart.isDatasetVisible(datasetIndex);
                legend.chart[current ? 'hide' : 'show'](datasetIndex);
                state.compareChartVisibility[legend.chart.data.datasets[datasetIndex].homeId] = !current;
            }},
            title: { display: true, text: `${metricLabel(state.compareChartMetric)} Across Homes (Years 1-${state.compareChartYears})` },
            tooltip: {
                itemSort: compareChartCalloutValues,
                callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.raw)}` }
            }
        }, scales: { y: { beginAtZero: true, ticks: { callback: value => `$${value.toLocaleString()}` } } } }
    });
}

function renderResults(home) {
    if (state.activeResultTab.startsWith('data-') && Number.parseInt(state.activeResultTab.split('-')[1], 10) >= resultsData.length) {
        state.activeResultTab = 'summary';
    }

    const tabs = `<div class="result-tabs"><button id="tab-summary" class="result-tab ${state.activeResultTab === 'summary' ? 'active' : ''}" data-action="result-tab" data-result-tab="summary">Summary & Graphs</button>${resultsData.map((result, index) => `<button id="tab-data-${index}" class="result-tab ${state.activeResultTab === 'data-' + index ? 'active' : ''}" data-action="result-tab" data-result-tab="data-${index}">${escapeHtml(getScenarioDisplayName(result.scenario))}</button>`).join('')}</div>`;
    const milestone = (result, field, color = '') => `<div class="milestone-box"><div class="milestone-row"><span class="milestone-label">Year 3</span><span class="milestone-val">${formatCurrency(result.data[2][field])}</span></div><hr><div class="milestone-row"><span class="milestone-label">Year 5</span><span class="milestone-val">${formatCurrency(result.data[4][field])}</span></div><hr><div class="milestone-row"><span class="milestone-label">Year 10</span><span class="milestone-val" style="${color ? `color:${color};` : ''}font-weight:bold;">${formatCurrency(result.data[9][field])}</span></div></div>`;
    const finalInterest = result => formatCurrency(result.data[result.data.length - 1].cumulativeInterest);
    const incentiveSummaryRows = home.incentivePool > 0 ? `
        <tr><td><b>Builder Incentive Used</b></td>${resultsData.map(result => `<td>${formatCurrency(result.incentiveUsed)}</td>`).join('')}</tr>
        <tr><td><b>Rate-Buydown Points</b></td>${resultsData.map(result => `<td>${result.pointsPurchased.toFixed(2)}</td>`).join('')}</tr>
        <tr><td><b>Estimated Closing Costs</b></td>${resultsData.map(result => `<td>${formatCurrency(result.estimatedClosingCosts)}</td>`).join('')}</tr>
        <tr><td><b>Closing-Cost Credit</b></td>${resultsData.map(result => `<td>${formatCurrency(result.closingCredit)}</td>`).join('')}</tr>
        <tr><td><b>Remaining Closing Costs</b></td>${resultsData.map(result => `<td>${formatCurrency(result.remainingClosingCosts)}</td>`).join('')}</tr>
        <tr><td><b>Design/Lot Credit</b></td>${resultsData.map(result => `<td>${formatCurrency(result.designCredit)}</td>`).join('')}</tr>
        <tr><td><b>Remaining Upgrade Cost</b></td>${resultsData.map(result => `<td>${formatCurrency(result.remainingDesignCost)}</td>`).join('')}</tr>` : '';
    const summary = `<table class="summary-table"><thead><tr><th>Metric</th>${resultsData.map(result => `<th>${escapeHtml(getScenarioDisplayName(result.scenario))}</th>`).join('')}</tr></thead><tbody>
        <tr><td><b>Final Purchase Price</b></td>${resultsData.map(result => `<td>${formatCurrency(result.finalPrice)}</td>`).join('')}</tr>
        <tr><td><b>Down Payment</b></td>${resultsData.map(result => `<td>${formatCurrency(result.downPayment)}</td>`).join('')}</tr>
        <tr><td><b>Loan Amount</b></td>${resultsData.map(result => `<td>${formatCurrency(result.loanAmount)}</td>`).join('')}</tr>
        <tr><td><b>Final Interest Rate</b></td>${resultsData.map(result => `<td>${result.finalRate.toFixed(3)}%</td>`).join('')}</tr>
        ${incentiveSummaryRows}
        <tr><td><b>Cash Needed to Close</b></td>${resultsData.map(result => `<td>${formatCurrency(result.cashToClose)}</td>`).join('')}</tr>
        <tr><td><b>Year 1 Monthly Payment</b></td>${resultsData.map(result => `<td>${formatCurrency(result.data[0].totalMonthly)}</td>`).join('')}</tr>
        <tr><td><b>Remaining Balance</b></td>${resultsData.map(result => `<td>${milestone(result, 'balance')}</td>`).join('')}</tr>
        <tr><td><b>Net Equity (Value - Balance)</b></td>${resultsData.map(result => `<td>${milestone(result, 'equity', '#137333')}</td>`).join('')}</tr>
        <tr><td><b>Contractual Interest</b></td>${resultsData.map(result => `<td>${milestone(result, 'cumulativeInterest', '#c5221f')}</td>`).join('')}</tr>
        <tr><td><b>Total Interest (Loan Term)</b></td>${resultsData.map(result => `<td>${finalInterest(result)}</td>`).join('')}</tr>
    </tbody></table>`;
    const summaryPane = `<div id="res-summary" class="card result-pane" style="display:${state.activeResultTab === 'summary' ? 'block' : 'none'}"><div class="table-scroll">${summary}</div><div class="chart-controls"><h3 id="chartTitle">${chartTitle(state.activeChartMetric)}</h3><select id="chartMetricSelect" class="chart-select" data-chart-context="home"><option value="balance" ${state.activeChartMetric === 'balance' ? 'selected' : ''}>Remaining Balance</option><option value="cumulativeInterest" ${state.activeChartMetric === 'cumulativeInterest' ? 'selected' : ''}>Contractual Interest Paid</option><option value="equity" ${state.activeChartMetric === 'equity' ? 'selected' : ''}>Net Equity (Value - Balance)</option><option value="monthlyPayment" ${state.activeChartMetric === 'monthlyPayment' ? 'selected' : ''}>Monthly Payment (P&I + Fixed)</option></select></div><div class="chart-container"><canvas id="balanceChart"></canvas></div></div>`;
    const dataPanes = resultsData.map((result, index) => `<div id="res-data-${index}" class="card result-pane" style="display:${state.activeResultTab === 'data-' + index ? 'block' : 'none'}"><div class="table-scroll"><table><thead><tr><th>Year</th><th>Rate</th><th>Monthly P&I</th><th>Total Monthly</th><th>Principal (Yr)</th><th>Interest (Yr)</th><th>Cum. Principal</th><th>Cum. Interest</th><th>Remaining Balance</th><th>Est. Value</th><th>Net Equity</th></tr></thead><tbody>${result.data.map(row => `<tr><td>${row.year}</td><td>${row.rate}%</td><td>${formatCurrency(row.pi)}</td><td>${formatCurrency(row.totalMonthly)}</td><td>${formatCurrency(row.yearlyPrincipal)}</td><td>${formatCurrency(row.yearlyInterest)}</td><td>${formatCurrency(row.cumulativePrincipal)}</td><td>${formatCurrency(row.cumulativeInterest)}</td><td>${formatCurrency(row.balance)}</td><td>${formatCurrency(row.homeValue)}</td><td>${formatCurrency(row.equity)}</td></tr>`).join('')}</tbody></table></div></div>`).join('');

    $('#resultsContainer').innerHTML = tabs + summaryPane + dataPanes;
    renderHomeChart();
}

function chartTitle(metric) {
    return { balance: 'Remaining Loan Balance Over Time', cumulativeInterest: 'Contractual Interest Paid Over Time', equity: 'Net Equity Over Time', monthlyPayment: 'Monthly Payment Over Time' }[metric];
}

function renderHomeChart() {
    destroyChart();
    if (typeof Chart === 'undefined') return;
    const colors = ['#1a73e8', '#ea4335', '#34a853', '#fbbc04', '#673ab7'];
    chart = new Chart($('#balanceChart').getContext('2d'), {
        type: 'line',
        data: { labels: Array.from({ length: 30 }, (_, index) => `Yr ${index + 1}`), datasets: resultsData.map((result, index) => ({ label: getScenarioDisplayName(result.scenario), data: result.data.slice(0, 30).map(row => metricValue(row, state.activeChartMetric)), borderColor: colors[index % colors.length], backgroundColor: 'transparent' })) },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { itemSort: compareChartCalloutValues, callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.raw)}` } } }, scales: { y: { beginAtZero: true, ticks: { callback: value => `$${value.toLocaleString()}` } } } }
    });
}

function currentComparisonConfigs() {
    return buildComparisonHomeConfigs(appData.homes, state.compareScenarioIds, state.compareHomeIds);
}

function saveCurrentComparison() {
    const name = $('#comparisonName')?.value.trim() || '';
    const description = $('#comparisonDescription')?.value || '';
    if (!name) {
        alert('Add a title before saving this comparison.');
        $('#comparisonName')?.focus();
        return;
    }

    const comparison = getActiveComparison();
    if (comparison) {
        comparison.name = name;
        comparison.description = description;
        comparison.homeConfigs = currentComparisonConfigs();
    } else {
        const newComparison = {
            id: generateId(appData.scenarioGroups.map(group => group.id)),
            name,
            description,
            homeConfigs: currentComparisonConfigs(),
            createdDate: new Date().toISOString()
        };
        appData.scenarioGroups.push(newComparison);
        state.activeComparisonId = newComparison.id;
    }
    appData.activeGroupId = state.activeComparisonId;
    persist();
    renderApp();
}

function startNewComparison() {
    state.activeComparisonId = null;
    state.newComparison = { name: '', description: '' };
    appData.activeGroupId = null;
    persist();
    renderApp();
}

function loadComparisonFromGroup(groupId) {
    const group = appData.scenarioGroups.find(item => item.id === Number(groupId));
    if (!group) return;
    const applied = applyComparisonHomeConfigs(group.homeConfigs);
    state.compareHomeIds = applied.compareHomeIds;
    state.compareScenarioIds = applied.compareScenarioIds;
    state.activeComparisonId = group.id;
    appData.activeGroupId = group.id;
    persist();
    renderApp();
}

function deleteCurrentComparison() {
    const comparison = getActiveComparison();
    if (!comparison || !confirm(`Delete comparison "${comparison.name}"?`)) return;
    appData.scenarioGroups = appData.scenarioGroups.filter(group => group.id !== comparison.id);
    state.activeComparisonId = null;
    state.newComparison = { name: '', description: '' };
    appData.activeGroupId = null;
    persist();
    renderApp();
}

function updateCurrentComparisonSelection() {
    const comparison = getActiveComparison();
    if (!comparison) return;
    comparison.homeConfigs = currentComparisonConfigs();
    persist();
}

function exportJSON() {
    const now = new Date();
    const fileName = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-mortgage_analyzer_backup.json`;
    const link = document.createElement('a');
    link.href = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(normalizeAppData(appData), null, 2))}`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function handleInput(event) {
    const target = event.target;
    if (target.dataset.homeField) updateHome(target.dataset.homeId, target.dataset.homeField, target.value);
    if (target.dataset.scenarioField) updateScenario(target.closest('.scenario-box')?.dataset.homeId || getActiveHome().id, target.dataset.scenarioId, target.dataset.scenarioField, target.value);
    if (target.dataset.allocationField) updateScenarioAllocation(target.dataset.homeId, target.dataset.scenarioId, target.dataset.allocationField, target.value, target);
    if (target.dataset.comparisonField) {
        const comparison = getActiveComparison();
        if (comparison) {
            comparison[target.dataset.comparisonField] = target.value;
            persist();
            if (target.dataset.comparisonField === 'name') {
                const option = $('#comparisonSelector option:checked');
                if (option) option.textContent = target.value;
            }
        } else {
            state.newComparison[target.dataset.comparisonField] = target.value;
        }
    }
    if (target.dataset.comparisonYears) {
        state.compareChartYears = Number(target.value);
        const label = target.closest('.chart-range')?.querySelector('label');
        if (label) label.textContent = `Years 1-${state.compareChartYears}`;
        if (chart) {
            chart.data.labels = Array.from({ length: state.compareChartYears }, (_, index) => `Yr ${index + 1}`);
            chart.data.datasets.forEach(dataset => {
                const item = getComparisonData(homeById(dataset.homeId));
                if (item) dataset.data = item.data.slice(0, state.compareChartYears).map(row => metricValue(row, state.compareChartMetric));
            });
            chart.options.plugins.title.text = `${metricLabel(state.compareChartMetric)} Across Homes (Years 1-${state.compareChartYears})`;
            chart.update();
        }
    }
}

function handleChange(event) {
    const target = event.target;
    if (target.dataset.compareHomeId) {
        state.compareHomeIds[target.dataset.compareHomeId] = target.checked;
        updateCurrentComparisonSelection();
        renderComparison();
    }
    if (target.dataset.compareScenarioHomeId) {
        state.compareScenarioIds[target.dataset.compareScenarioHomeId] = Number(target.value);
        updateCurrentComparisonSelection();
        renderComparison();
    }
    if (target.dataset.action === 'select-comparison') {
        if (target.value === CREATE_NEW_COMPARISON) startNewComparison();
        else loadComparisonFromGroup(target.value);
    }
    if (target.dataset.chartContext === 'home') {
        state.activeChartMetric = target.value;
        $('#chartTitle').textContent = chartTitle(target.value);
        renderHomeChart();
    }
    if (target.dataset.chartContext === 'comparison') {
        state.compareChartMetric = target.value;
        renderComparison();
    }
}

function handleClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'switch-home') {
        appData.activeHomeId = Number(target.dataset.homeId);
        state.activeView = 'home';
        persist();
        renderApp();
    } else if (action === 'show-comparison') {
        state.activeView = 'compare';
        renderApp();
    } else if (action === 'add-home') addHome();
    else if (action === 'duplicate-home') duplicateHome(target.dataset.homeId);
    else if (action === 'delete-home') deleteHome(target.dataset.homeId);
    else if (action === 'add-scenario') addScenario(target.dataset.homeId);
    else if (action === 'delete-scenario') deleteScenario(target.dataset.homeId, target.dataset.scenarioId);
    else if (action === 'max-allocation') maxScenarioAllocation(target.dataset.homeId, target.dataset.scenarioId, target.dataset.allocationField);
    else if (action === 'save-comparison') saveCurrentComparison();
    else if (action === 'delete-comparison') deleteCurrentComparison();
    else if (action === 'result-tab') {
        state.activeResultTab = target.dataset.resultTab;
        document.querySelectorAll('.result-pane').forEach(pane => { pane.style.display = 'none'; });
        document.querySelectorAll('.result-tab').forEach(tab => tab.classList.remove('active'));
        $(`#res-${state.activeResultTab}`).style.display = 'block';
        target.classList.add('active');
    }
}

document.addEventListener('input', handleInput);
document.addEventListener('change', handleChange);
document.addEventListener('click', handleClick);
$('#importFile').addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            appData = parseImportedData(reader.result);
            state.activeComparisonId = null;
            state.newComparison = { name: '', description: '' };
            state.compareHomeIds = {};
            state.compareScenarioIds = {};
            const importedComparison = appData.scenarioGroups.find(group => group.id === Number(appData.activeGroupId));
            if (importedComparison) {
                const applied = applyComparisonHomeConfigs(importedComparison.homeConfigs);
                state.compareHomeIds = applied.compareHomeIds;
                state.compareScenarioIds = applied.compareScenarioIds;
                state.activeComparisonId = importedComparison.id;
            }
            persist();
            renderApp();
            alert('Data imported successfully!');
        } catch (error) {
            alert('Invalid mortgage analyzer JSON file.');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
});

$('#exportButton').addEventListener('click', exportJSON);
$('#importButton').addEventListener('click', () => $('#importFile').click());

const savedActiveComparison = appData.scenarioGroups.find(group => group.id === Number(appData.activeGroupId));
if (savedActiveComparison) {
    const applied = applyComparisonHomeConfigs(savedActiveComparison.homeConfigs);
    state.compareHomeIds = applied.compareHomeIds;
    state.compareScenarioIds = applied.compareScenarioIds;
    state.activeComparisonId = savedActiveComparison.id;
}

renderApp();
