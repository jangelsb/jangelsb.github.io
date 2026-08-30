import {
    DEFAULT_BUYDOWN_YEAR_1,
    DEFAULT_BUYDOWN_YEAR_2,
    DEFAULT_LOAN_TERM_YEARS,
    clone,
    escapeHtml,
    generateId,
    getScenarioLabel,
    normalizeAppData
} from './data.js';
import { calculateAmortization, calculateLoanInputs } from './calculations.js';
import { loadAppData, parseImportedData, saveAppData } from './storage.js';

const state = {
    activeResultTab: 'summary',
    activeChartMetric: 'balance',
    activeView: 'home',
    compareChartMetric: 'monthlyPayment',
    compareChartYears: 30,
    compareScenarioIds: {},
    compareHomeIds: {},
    compareChartVisibility: {}
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
    renderTabsAndControls();
    if (state.activeView === 'compare') {
        renderComparison();
        return;
    }

    renderActiveHome();
    runCalculations();
}

function renderTabsAndControls() {
    const tabs = appData.homes.map(home => {
        const active = state.activeView === 'home' && home.id === appData.activeHomeId ? 'active' : '';
        return `<button class="home-tab ${active}" data-action="switch-home" data-home-id="${home.id}">${escapeHtml(home.name)}</button>`;
    }).join('');

    $('#homeTabsContainer').innerHTML = `${tabs}
        <button class="home-tab ${state.activeView === 'compare' ? 'active' : ''}" data-action="show-comparison">Compare Homes</button>
        <button class="btn-success add-home" data-action="add-home">+ Add Home</button>`;
}

function renderActiveHome() {
    const home = getActiveHome();
    if (!home) return;

    const scenarios = home.scenarios.map(scenario => `
        <div class="scenario-box" data-home-id="${home.id}">
            <div class="scenario-header">
                <span class="scenario-name">${escapeHtml(getScenarioLabel(scenario))}</span>
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
                <div><label>Est. Closing Costs (%)</label><input type="number" step="0.1" value="${home.closingCosts}" data-home-id="${home.id}" data-home-field="closingCosts"></div>
                <div><label>Property Tax (%/yr)</label><input type="number" step="0.01" value="${home.tax}" data-home-id="${home.id}" data-home-field="tax"></div>
                <div><label>Monthly HOA ($)</label><input type="number" value="${home.hoa}" data-home-id="${home.id}" data-home-field="hoa"></div>
                <div><label>Monthly Ins. ($)</label><input type="number" value="${home.ins}" data-home-id="${home.id}" data-home-field="ins"></div>
                <div><label>Annual Appreciation (%)</label><input type="number" step="0.1" value="${home.appreciation}" data-home-id="${home.id}" data-home-field="appreciation"></div>
            </div>

            <label>Property Notes & Thoughts:</label>
            <textarea data-home-id="${home.id}" data-home-field="notes">${escapeHtml(home.notes)}</textarea>
        </div>

        <div class="card">
            <div class="flex-between"><h2>Loan Scenarios</h2>
                <button class="btn-success" data-action="add-scenario" data-home-id="${home.id}">+ Add Scenario</button>
            </div>
            <div class="grid-scenarios">${scenarios || '<p>No scenarios yet. Add one to see results.</p>'}</div>
        </div>`;
}

function updateHome(homeId, field, value) {
    const home = homeById(homeId);
    if (!home) return;
    home[field] = ['name', 'notes', 'downType'].includes(field) ? value : Number.parseFloat(value) || 0;
    persist();

    if (field === 'name') {
        renderTabsAndControls();
    }
    if (field === 'downType') {
        renderApp();
    } else {
        runCalculations();
    }
}

function updateScenario(homeId, scenarioId, field, value) {
    const scenario = scenarioById(homeById(homeId), scenarioId);
    if (!scenario) return;
    scenario[field] = ['name', 'type'].includes(field) ? value : Number.parseFloat(value) || 0;
    scenario.name = getScenarioLabel(scenario);
    persist();

    if (field === 'type') {
        renderApp();
    } else {
        runCalculations();
    }
}

function addHome() {
    const source = appData.homes[0];
    const newHome = clone(source);
    newHome.id = generateId(appData.homes.map(home => home.id));
    newHome.name = 'New Property';
    newHome.notes = '';
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
        armFee: 5000
    });
    persist();
    renderApp();
}

function deleteScenario(homeId, scenarioId) {
    const home = homeById(homeId);
    if (!home) return;
    home.scenarios = home.scenarios.filter(scenario => scenario.id !== Number(scenarioId));
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

    const loanInputs = calculateLoanInputs(home);
    resultsData = home.scenarios.map(scenario => ({
        scenario,
        cashToClose: loanInputs.cashToClose,
        data: calculateAmortization(home, scenario, loanInputs.principal)
    }));
    renderResults(home);
}

function getComparisonData(home) {
    const selectedId = state.compareScenarioIds[home.id];
    const scenario = scenarioById(home, selectedId) || home.scenarios[0];
    if (!scenario) return null;
    state.compareScenarioIds[home.id] = scenario.id;
    const loanInputs = calculateLoanInputs(home);
    return { home, scenario, cashToClose: loanInputs.cashToClose, data: calculateAmortization(home, scenario, loanInputs.principal) };
}

function isHomeIncluded(homeId) {
    return state.compareHomeIds[homeId] !== false;
}

function renderComparison() {
    const included = appData.homes.filter(home => isHomeIncluded(home.id));
    const comparisonData = included.map(getComparisonData).filter(Boolean);
    const homeSelection = appData.homes.map(home => `
        <label class="checkbox-label"><input type="checkbox" data-compare-home-id="${home.id}" ${isHomeIncluded(home.id) ? 'checked' : ''}> ${escapeHtml(home.name)}</label>
    `).join('');

    if (!comparisonData.length) {
        $('#appContent').innerHTML = `<div class="card"><h2>Compare Homes</h2><p>Select at least one home to compare.</p><div class="comparison-controls">${homeSelection}</div></div>`;
        $('#resultsContainer').innerHTML = '';
        destroyChart();
        return;
    }

    const controls = comparisonData.map(item => `
        <div class="comparison-control"><label>${escapeHtml(item.home.name)}</label>
            <select data-compare-scenario-home-id="${item.home.id}">
                ${item.home.scenarios.map(scenario => `<option value="${scenario.id}" ${scenario.id === item.scenario.id ? 'selected' : ''}>${escapeHtml(getScenarioLabel(scenario))}</option>`).join('')}
            </select>
        </div>`).join('');

    const rows = [
        ['Purchase price', item => formatCurrency(item.home.price)],
        ['Down payment', item => formatCurrency(calculateLoanInputs(item.home).downPayment)],
        ['Cash needed to close', item => formatCurrency(item.cashToClose)],
        ['Loan scenario', item => escapeHtml(getScenarioLabel(item.scenario))],
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
        ['Total interest over 30 years', item => formatCurrency(item.data[29].cumulativeInterest)]
    ];
    const table = `<div class="comparison-scroll"><table class="comparison-table"><thead><tr><th>Metric</th>${comparisonData.map(item => `<th>${escapeHtml(item.home.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, value]) => `<tr><td>${label}</td>${comparisonData.map(item => `<td>${value(item)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const savedGroups = appData.scenarioGroups.length ? `
        <div class="comparison-control"><label>Load Saved Comparison</label><select data-action="load-group">
            <option value="">-- Choose a saved comparison --</option>
            ${appData.scenarioGroups.map(group => `<option value="${group.id}">${escapeHtml(group.name)}</option>`).join('')}
        </select></div>` : '';

    $('#appContent').innerHTML = `<div class="card">
        <div class="comparison-controls comparison-toolbar">${savedGroups}<button class="btn-secondary" data-action="open-save-modal">Save This Comparison</button></div>
        <h2>Compare Homes</h2><p class="muted">Choose one loan scenario for each property.</p>
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
                label: `${item.home.name} - ${getScenarioLabel(item.scenario)}`,
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
            tooltip: { callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.raw)}` } }
        }, scales: { y: { beginAtZero: true, ticks: { callback: value => `$${value.toLocaleString()}` } } } }
    });
}

function renderResults(home) {
    if (state.activeResultTab.startsWith('data-') && Number.parseInt(state.activeResultTab.split('-')[1], 10) >= resultsData.length) {
        state.activeResultTab = 'summary';
    }

    const tabs = `<div class="result-tabs"><button id="tab-summary" class="result-tab ${state.activeResultTab === 'summary' ? 'active' : ''}" data-action="result-tab" data-result-tab="summary">Summary & Graphs</button>${resultsData.map((result, index) => `<button id="tab-data-${index}" class="result-tab ${state.activeResultTab === 'data-' + index ? 'active' : ''}" data-action="result-tab" data-result-tab="data-${index}">${escapeHtml(getScenarioLabel(result.scenario))}</button>`).join('')}</div>`;
    const downPayment = calculateLoanInputs(home).downPayment;
    const downPercent = home.price ? (downPayment / home.price * 100).toFixed(1).replace(/\.0$/, '') : '0';
    const milestone = (result, field, color = '') => `<div class="milestone-box"><div class="milestone-row"><span class="milestone-label">Year 3</span><span class="milestone-val">${formatCurrency(result.data[2][field])}</span></div><hr><div class="milestone-row"><span class="milestone-label">Year 5</span><span class="milestone-val">${formatCurrency(result.data[4][field])}</span></div><hr><div class="milestone-row"><span class="milestone-label">Year 10</span><span class="milestone-val" style="${color ? `color:${color};` : ''}font-weight:bold;">${formatCurrency(result.data[9][field])}</span></div></div>`;
    const finalInterest = result => formatCurrency(result.data[result.data.length - 1].cumulativeInterest);
    const summary = `<table class="summary-table"><thead><tr><th>Metric</th>${resultsData.map(result => `<th>${escapeHtml(getScenarioLabel(result.scenario))}</th>`).join('')}</tr></thead><tbody>
        <tr><td><b>Down payment @ ${downPercent}%</b></td>${resultsData.map(() => `<td>${formatCurrency(downPayment)}</td>`).join('')}</tr>
        <tr><td><b>Actual Cash Needed to Close</b></td>${resultsData.map(result => `<td>${formatCurrency(result.cashToClose)}</td>`).join('')}</tr>
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
        data: { labels: Array.from({ length: 30 }, (_, index) => `Yr ${index + 1}`), datasets: resultsData.map((result, index) => ({ label: getScenarioLabel(result.scenario), data: result.data.slice(0, 30).map(row => metricValue(row, state.activeChartMetric)), borderColor: colors[index % colors.length], backgroundColor: 'transparent' })) },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.raw)}` } } }, scales: { y: { beginAtZero: true, ticks: { callback: value => `$${value.toLocaleString()}` } } } }
    });
}

function saveCurrentComparison() {
    const name = $('#groupName').value.trim();
    if (!name) return;
    appData.scenarioGroups.push({
        id: generateId(appData.scenarioGroups.map(group => group.id)),
        name,
        description: $('#groupDesc').value,
        homeConfigs: appData.homes.map(home => ({ homeId: home.id, scenarioId: state.compareScenarioIds[home.id] || home.scenarios[0]?.id || null, isIncluded: isHomeIncluded(home.id) })),
        createdDate: new Date().toISOString()
    });
    persist();
    closeGroupModal();
    renderApp();
}

function openSaveComparisonModal() {
    let modal = $('#groupModalContainer');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'groupModalContainer';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `<div class="modal-card"><h2>Save This Comparison</h2><form id="saveComparisonForm"><label>Comparison Name</label><input type="text" id="groupName" required><label>Description (optional)</label><textarea id="groupDesc"></textarea><div class="button-row modal-actions"><button type="button" class="btn-secondary" data-action="close-modal">Cancel</button><button type="submit" class="btn-success">Save Comparison</button></div></form></div>`;
    modal.style.display = 'flex';
    $('#groupName').focus();
}

function closeGroupModal() {
    const modal = $('#groupModalContainer');
    if (modal) modal.style.display = 'none';
}

function loadComparisonFromGroup(groupId) {
    const group = appData.scenarioGroups.find(item => item.id === Number(groupId));
    if (!group) return;
    state.compareHomeIds = {};
    state.compareScenarioIds = {};
    group.homeConfigs.forEach(config => {
        state.compareHomeIds[config.homeId] = config.isIncluded;
        state.compareScenarioIds[config.homeId] = config.scenarioId;
    });
    state.activeView = 'compare';
    renderApp();
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
        renderComparison();
    }
    if (target.dataset.compareScenarioHomeId) {
        state.compareScenarioIds[target.dataset.compareScenarioHomeId] = Number(target.value);
        renderComparison();
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
    if (target.dataset.action === 'load-group') loadComparisonFromGroup(target.value);
}

function handleClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'switch-home') {
        appData.activeHomeId = Number(target.dataset.homeId);
        state.activeView = 'home';
        appData.activeGroupId = null;
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
    else if (action === 'open-save-modal') openSaveComparisonModal();
    else if (action === 'close-modal') closeGroupModal();
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
document.addEventListener('submit', event => {
    if (event.target.id === 'saveComparisonForm') {
        event.preventDefault();
        saveCurrentComparison();
    }
});
$('#importFile').addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            appData = parseImportedData(reader.result);
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
renderApp();
