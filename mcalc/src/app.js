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
import { decodeShareHash, encodeShareState } from './url-state.js';

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

const initialShareState = await loadInitialShareState();
let appData = initialShareState?.appData || loadAppData();
if (initialShareState?.ui) Object.assign(state, initialShareState.ui);
let chart = null;
let resultsData = [];
let shareUpdateTimer = null;
let shareUpdateSequence = 0;

const $ = selector => document.querySelector(selector);

function destroyChart() {
    if (chart) {
        chart.destroy();
        chart = null;
    }
}

function persist() {
    try {
        saveAppData(appData);
    } finally {
        scheduleShareUrlUpdate();
    }
}

async function loadInitialShareState() {
    if (!window.location.hash.startsWith('#s=')) return null;
    try {
        return await decodeShareHash(window.location.hash);
    } catch (error) {
        console.warn('Could not load shared mortgage data; using local data.', error);
        alert('This share link is invalid or unsupported. Your local calculator data was kept.');
        return null;
    }
}

function shareUiState() {
    return {
        activeResultTab: state.activeResultTab,
        activeChartMetric: state.activeChartMetric,
        activeView: state.activeView,
        compareChartMetric: state.compareChartMetric,
        compareChartYears: state.compareChartYears,
        compareScenarioIds: state.compareScenarioIds,
        compareHomeIds: state.compareHomeIds,
        compareChartVisibility: state.compareChartVisibility,
        activeComparisonId: state.activeComparisonId,
        newComparison: state.newComparison
    };
}

async function updateShareUrlNow() {
    if (shareUpdateTimer) {
        clearTimeout(shareUpdateTimer);
        shareUpdateTimer = null;
    }
    const sequence = ++shareUpdateSequence;
    const hash = await encodeShareState(appData, shareUiState());
    if (sequence !== shareUpdateSequence) return window.location.href;
    const url = new URL(window.location.href);
    url.hash = hash.slice(1);
    window.history.replaceState(null, '', url.href);
    return url.href;
}

async function copyTextToClipboard(value) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }

    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('Clipboard access is unavailable.');
}

function scheduleShareUrlUpdate() {
    if (shareUpdateTimer) clearTimeout(shareUpdateTimer);
    shareUpdateTimer = setTimeout(() => {
        shareUpdateTimer = null;
        updateShareUrlNow().catch(error => console.warn('Could not update share URL.', error));
    }, 300);
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

const helpTopics = {
    purchasePrice: {
        title: 'Purchase price',
        body: 'The negotiated price of the home before any incentive-based price reduction.',
        formula: 'Final price = purchase price − price reduction',
        recommendation: 'Use the builder or seller’s contract price.'
    },
    downPayment: {
        title: 'Down payment',
        body: 'The money paid toward the home up front. The rest is financed as the loan amount.',
        formula: 'Loan amount = purchase price − down payment',
        recommendation: 'Choose dollars when you know the planned cash contribution; choose percent when the lender quoted a percentage.'
    },
    loanType: {
        title: 'Loan type',
        body: 'The mortgage structure being compared. Standard Fixed keeps the note rate level; Custom Buydown models temporary payment reductions; 7/1 ARM models a fixed period followed by a reset.',
        formula: 'Loan type changes the rate and payment schedule over time',
        recommendation: 'Compare the same loan type, term, and lender assumptions when evaluating properties.'
    },
    loanTerm: {
        title: 'Loan term',
        body: 'The planned number of years used to amortize the loan. A longer term usually lowers the payment but increases total interest.',
        formula: 'Number of payments = loan term × 12',
        recommendation: 'Use the term from the lender’s quote, commonly 30 years.'
    },
    loanAmount: {
        title: 'Loan amount',
        body: 'The principal amount financed after the down payment and any price reduction in the selected scenario.',
        formula: 'Loan amount = final purchase price − down payment',
        recommendation: 'Check that this matches the lender’s proposed loan amount.'
    },
    incentivePool: {
        title: 'Builder incentive pool',
        body: 'The total credit offered by the builder that can be assigned to eligible uses in a scenario.',
        formula: 'Total allocation cannot exceed the incentive pool',
        recommendation: 'Use the amount in the builder’s written offer and confirm eligible uses with the lender.'
    },
    closingCosts: {
        title: 'Estimated closing costs',
        body: 'A planning estimate for lender, title, recording, prepaid tax/insurance, and similar upfront charges. Discount points are modeled separately as rate-buydown incentives.',
        formula: 'Estimated closing costs = loan amount × closing-cost percentage',
        recommendation: 'For a serious comparison, enter the lender’s Loan Estimate as a fixed dollar amount.'
    },
    rate: {
        title: 'Base / note rate',
        body: 'The contractual interest rate before this scenario’s permanent or temporary buydown adjustments.',
        formula: 'Monthly principal & interest uses the selected note rate',
        recommendation: 'Use the rate from the lender’s quote for the same loan type and term.'
    },
    temporaryBuydown: {
        title: 'Temporary buydown',
        body: 'A subsidy that lowers the borrower’s out-of-pocket payment for the first one or two years. The underlying loan still amortizes using the contractual note rate.',
        formula: 'Temporary payment rate = note rate − year-specific rate drop',
        recommendation: 'Ask the lender for the subsidy cost and confirm who funds it.'
    },
    armReset: {
        title: 'ARM reset / refinance assumption',
        body: 'A simplified projection for the rate and fee after the initial ARM period. Actual ARM adjustments follow the loan’s index, margin, caps, and reset dates.',
        formula: 'Projected post-reset payment uses the entered refinance rate',
        recommendation: 'Use the lender’s ARM disclosure for a real decision; treat this field as a scenario assumption.'
    },
    armFee: {
        title: 'Refinance fee rolled in',
        body: 'A hypothetical fee added to the balance at the modeled ARM reset. It is not a prediction of future refinance costs.',
        formula: 'Post-reset balance = scheduled balance + modeled fee',
        recommendation: 'Leave this at zero unless you have a specific fee assumption to test.'
    },
    rateBuydown: {
        title: 'Rate buydown',
        body: 'Builder dollars used to buy permanent discount points. One point costs 1% of the loan amount, but the rate reduction per point varies by lender and product.',
        formula: 'Point cost = loan amount × 1%; final rate = base rate − points × rate reduction per point',
        recommendation: 'Enter the lender’s actual points-to-rate quote. Do not assume every point reduces the rate by the same amount.'
    },
    rateReductionPerPoint: {
        title: 'Rate reduction per point',
        body: 'The assumed permanent rate reduction for each discount point in this scenario. This is a lender/product assumption, not a universal rule.',
        formula: 'Rate reduction = points purchased × reduction per point',
        recommendation: 'Get this value from the lender’s rate sheet or Loan Estimate.'
    },
    maxRateBuydownPoints: {
        title: 'Maximum rate-buydown points',
        body: 'A planning cap on permanent points for this scenario. Actual limits can depend on the lender, loan program, occupancy, loan-to-value, and builder-concession rules.',
        formula: 'Max rate allocation = loan amount × 1% × max points',
        recommendation: 'Confirm the cap with the lender. The Max button uses this cap and whatever incentive pool remains.'
    },
    designCost: {
        title: 'Design / lot upgrade cost',
        body: 'The eligible cost of the selected design options, lot premium, or upgrades that this scenario can credit.',
        formula: 'Upgrade credit = min(allocation, eligible upgrade cost)',
        recommendation: 'Enter only the amount the builder confirms can be paid with incentives.'
    },
    cashToClose: {
        title: 'Cash needed to close',
        body: 'The estimated cash required after applying the selected incentive allocation. It includes the down payment and eligible costs not covered by credits.',
        formula: 'Cash to close = down payment + remaining closing costs + remaining upgrade cost',
        recommendation: 'Use the lender’s Loan Estimate and Closing Disclosure for the final number.'
    },
    monthlyPayment: {
        title: 'Monthly payment',
        body: 'This app’s estimate of principal and interest plus the property tax, HOA, and insurance values entered above. It does not include every possible escrow or loan fee.',
        formula: 'Total monthly = principal & interest + taxes + HOA + insurance',
        recommendation: 'Compare against the lender’s projected payment, including mortgage insurance and any other applicable charges.'
    },
    propertyTax: {
        title: 'Property tax',
        body: 'The annual property-tax assumption used to estimate the monthly payment.',
        formula: 'Monthly tax = purchase price × annual tax rate ÷ 12',
        recommendation: 'Use the local assessor’s estimate or the lender’s escrow estimate when available.'
    },
    appreciation: {
        title: 'Annual appreciation',
        body: 'A hypothetical annual home-value growth rate used only for the equity projections and charts.',
        formula: 'Estimated value = purchase price × (1 + appreciation)ʸᵉᵃʳ',
        recommendation: 'Treat this as a sensitivity assumption, not a forecast.'
    }
};

function renderHelp(id, topic) {
    const content = helpTopics[topic];
    if (!content) return '';
    return `<span class="help-term">
        <button class="help-trigger" type="button" aria-label="Learn about ${escapeHtml(content.title)}" aria-expanded="false" aria-controls="${id}" data-action="toggle-help" data-help-id="${id}">?</button>
        <span class="help-popover" id="${id}" role="tooltip">
            <strong>${escapeHtml(content.title)}</strong>
            <span>${escapeHtml(content.body)}</span>
            <span class="help-formula">${escapeHtml(content.formula)}</span>
            <span class="help-recommendation"><b>Recommendation:</b> ${escapeHtml(content.recommendation)}</span>
        </span>
    </span>`;
}

function renderFieldLabel(label, topic, id) {
    return `<label class="field-label">${escapeHtml(label)} ${renderHelp(id, topic)}</label>`;
}

function renderMetricLabel(label, topic, id) {
    return `<span class="metric-label">${escapeHtml(label)} ${renderHelp(id, topic)}</span>`;
}

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
            <div class="allocation-label"><label for="allocation-${scenario.id}-${bucket}">${incentiveBucketLabels[bucket]} ${renderHelp(`help-allocation-${scenario.id}-${bucket}`, bucket === 'rateBuydown' ? 'rateBuydown' : bucket === 'closingCosts' ? 'closingCosts' : bucket === 'priceReduction' ? 'purchasePrice' : 'designCost')}</label><output>${formatCurrency(allocation[bucket])}</output></div>
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
            ${renderFieldLabel('Loan Type', 'loanType', `help-scenario-${scenario.id}-loan-type`)}
            <select data-scenario-id="${scenario.id}" data-scenario-field="type">
                <option value="fixed" ${scenario.type === 'fixed' ? 'selected' : ''}>Standard Fixed</option>
                <option value="buydown" ${scenario.type === 'buydown' ? 'selected' : ''}>Custom Buydown</option>
                <option value="arm" ${scenario.type === 'arm' ? 'selected' : ''}>7/1 ARM</option>
            </select>
            ${renderFieldLabel('Loan Term (years)', 'loanTerm', `help-scenario-${scenario.id}-term`)}
            <input type="number" min="1" max="50" step="1" value="${scenario.termYears}"
                data-scenario-id="${scenario.id}" data-scenario-field="termYears">
            ${renderFieldLabel('Base / Note Rate (%)', 'rate', `help-scenario-${scenario.id}-rate`)}
            <input type="number" step="0.1" value="${scenario.rate}"
                data-scenario-id="${scenario.id}" data-scenario-field="rate">

            ${home.incentivePool > 0 ? `<div class="rate-buydown-settings">
                ${renderFieldLabel('Rate Reduction per Point (%)', 'rateReductionPerPoint', `help-scenario-${scenario.id}-rate-reduction`)}
                <input type="number" min="0" step="0.05" value="${scenario.rateReductionPerPoint}"
                    data-scenario-id="${scenario.id}" data-scenario-field="rateReductionPerPoint">
                ${renderFieldLabel('Maximum Rate-Buydown Points', 'maxRateBuydownPoints', `help-scenario-${scenario.id}-max-points`)}
                <input type="number" min="0" step="0.25" value="${scenario.maxRateBuydownPoints}"
                    data-scenario-id="${scenario.id}" data-scenario-field="maxRateBuydownPoints">
                <p class="muted field-help">These are lender/product assumptions, not universal limits.</p>
            </div>` : ''}

            ${renderFieldLabel('Design / Lot Upgrade Cost ($)', 'designCost', `help-scenario-${scenario.id}-design-cost`)}
            <input type="number" min="0" step="100" value="${scenario.designCost}"
                data-scenario-id="${scenario.id}" data-scenario-field="designCost">

            <div class="dynamic-fields" style="display:${scenario.type === 'buydown' ? 'block' : 'none'}">
                ${renderFieldLabel('Year 1 Rate Drop (%)', 'temporaryBuydown', `help-scenario-${scenario.id}-year-1-drop`)}
                <input type="number" step="0.5" value="${scenario.bdY1}"
                    data-scenario-id="${scenario.id}" data-scenario-field="bdY1">
                ${renderFieldLabel('Year 2 Rate Drop (%)', 'temporaryBuydown', `help-scenario-${scenario.id}-year-2-drop`)}
                <input type="number" step="0.5" value="${scenario.bdY2}"
                    data-scenario-id="${scenario.id}" data-scenario-field="bdY2">
            </div>

            <div class="dynamic-fields" style="display:${scenario.type === 'arm' ? 'block' : 'none'}">
                ${renderFieldLabel('Year 8+ Refi Rate (%)', 'armReset', `help-scenario-${scenario.id}-arm-rate`)}
                <input type="number" step="0.1" value="${scenario.armRate}"
                    data-scenario-id="${scenario.id}" data-scenario-field="armRate">
                ${renderFieldLabel('Year 7 Refi Fee Rolled In ($)', 'armFee', `help-scenario-${scenario.id}-arm-fee`)}
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
                <div>${renderFieldLabel('Purchase Price ($)', 'purchasePrice', `help-home-${home.id}-price`)}<input type="number" value="${home.price}" data-home-id="${home.id}" data-home-field="price"></div>
                <div>${renderFieldLabel('Down Payment', 'downPayment', `help-home-${home.id}-down-payment`)}<div class="input-group">
                    <select data-home-id="${home.id}" data-home-field="downType">
                        <option value="amount" ${home.downType === 'amount' ? 'selected' : ''}>$</option>
                        <option value="percent" ${home.downType === 'percent' ? 'selected' : ''}>%</option>
                    </select>
                    <input type="number" step="0.1" value="${home.downValue}" data-home-id="${home.id}" data-home-field="downValue">
                </div></div>
                <div>${renderFieldLabel('Builder Incentive Pool ($)', 'incentivePool', `help-home-${home.id}-incentive-pool`)}<input type="number" min="0" step="100" value="${home.incentivePool}" data-home-id="${home.id}" data-home-field="incentivePool"></div>
                <div>${renderFieldLabel('Closing Cost Estimate', 'closingCosts', `help-home-${home.id}-closing-costs`)}<div class="input-group">
                    <select data-home-id="${home.id}" data-home-field="closingCostEstimateMode">
                        <option value="percentOfLoan" ${home.closingCostEstimateMode === 'percentOfLoan' ? 'selected' : ''}>% of loan</option>
                        <option value="fixed" ${home.closingCostEstimateMode === 'fixed' ? 'selected' : ''}>$ amount</option>
                    </select>
                    <input type="number" min="0" step="0.1" value="${home.closingCostEstimateMode === 'fixed' ? home.closingCostEstimateAmount : home.closingCostEstimatePercent}"
                        data-home-id="${home.id}" data-home-field="${home.closingCostEstimateMode === 'fixed' ? 'closingCostEstimateAmount' : 'closingCostEstimatePercent'}">
                </div><p class="muted field-help">Excludes discount points; those use the rate-buydown allocation.</p></div>
                <div>${renderFieldLabel('Property Tax (%/yr)', 'propertyTax', `help-home-${home.id}-tax`)}<input type="number" step="0.01" value="${home.tax}" data-home-id="${home.id}" data-home-field="tax"></div>
                <div>${renderFieldLabel('Monthly HOA ($)', 'monthlyPayment', `help-home-${home.id}-hoa`)}<input type="number" value="${home.hoa}" data-home-id="${home.id}" data-home-field="hoa"></div>
                <div>${renderFieldLabel('Monthly Ins. ($)', 'monthlyPayment', `help-home-${home.id}-insurance`)}<input type="number" value="${home.ins}" data-home-id="${home.id}" data-home-field="ins"></div>
                <div>${renderFieldLabel('Annual Appreciation (%)', 'appreciation', `help-home-${home.id}-appreciation`)}<input type="number" step="0.1" value="${home.appreciation}" data-home-id="${home.id}" data-home-field="appreciation"></div>
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
        ['Incentive used', item => formatCurrency(item.incentiveUsed), 'incentivePool'],
        ['Incentive remaining', item => formatCurrency(item.incentiveRemaining), 'incentivePool'],
        ['Estimated closing costs', item => formatCurrency(item.estimatedClosingCosts), 'closingCosts'],
        ['Closing-cost credit', item => formatCurrency(item.closingCredit), 'closingCosts'],
        ['Remaining closing costs', item => formatCurrency(item.remainingClosingCosts), 'closingCosts'],
        ['Design/lot credit', item => formatCurrency(item.designCredit), 'designCost'],
        ['Remaining upgrade cost', item => formatCurrency(item.remainingDesignCost), 'designCost']
    ] : [];
    const rows = [
        ['Purchase price', item => formatCurrency(item.finalPrice), 'purchasePrice'],
        ['Down payment', item => formatCurrency(item.downPayment), 'downPayment'],
        ['Loan amount', item => formatCurrency(item.loanAmount), 'loanAmount'],
        ['Interest rate', item => `${item.finalRate.toFixed(3)}%`, 'rate'],
        ['Rate-buydown points', item => item.pointsPurchased.toFixed(2), 'rateBuydown'],
        ...incentiveRows,
        ['Cash needed to close', item => formatCurrency(item.cashToClose), 'cashToClose'],
        ['Purchase scenario', item => escapeHtml(getScenarioDisplayName(item.scenario))],
        ['Loan term', item => `${item.scenario.termYears} years`],
        ['Year 1 monthly payment', item => formatCurrency(item.data[0].totalMonthly), 'monthlyPayment'],
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
    const table = `<div class="comparison-scroll"><table class="comparison-table"><thead><tr><th>Metric</th>${comparisonData.map(item => `<th>${escapeHtml(item.home.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, value, topic], index) => `<tr><td>${topic ? renderMetricLabel(label, topic, `help-comparison-${topic}-${index}`) : label}</td>${comparisonData.map(item => `<td>${value(item)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
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
                scheduleShareUrlUpdate();
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
        <tr><td><b>${renderMetricLabel('Builder Incentive Used', 'incentivePool', 'help-summary-incentive-used')}</b></td>${resultsData.map(result => `<td>${formatCurrency(result.incentiveUsed)}</td>`).join('')}</tr>
        <tr><td><b>${renderMetricLabel('Rate-Buydown Points', 'rateBuydown', 'help-summary-rate-points')}</b></td>${resultsData.map(result => `<td>${result.pointsPurchased.toFixed(2)}</td>`).join('')}</tr>
        <tr><td><b>${renderMetricLabel('Estimated Closing Costs', 'closingCosts', 'help-summary-closing-costs')}</b></td>${resultsData.map(result => `<td>${formatCurrency(result.estimatedClosingCosts)}</td>`).join('')}</tr>
        <tr><td><b>${renderMetricLabel('Closing-Cost Credit', 'closingCosts', 'help-summary-closing-credit')}</b></td>${resultsData.map(result => `<td>${formatCurrency(result.closingCredit)}</td>`).join('')}</tr>
        <tr><td><b>${renderMetricLabel('Remaining Closing Costs', 'closingCosts', 'help-summary-remaining-closing-costs')}</b></td>${resultsData.map(result => `<td>${formatCurrency(result.remainingClosingCosts)}</td>`).join('')}</tr>
        <tr><td><b>${renderMetricLabel('Design/Lot Credit', 'designCost', 'help-summary-design-credit')}</b></td>${resultsData.map(result => `<td>${formatCurrency(result.designCredit)}</td>`).join('')}</tr>
        <tr><td><b>${renderMetricLabel('Remaining Upgrade Cost', 'designCost', 'help-summary-remaining-upgrade-cost')}</b></td>${resultsData.map(result => `<td>${formatCurrency(result.remainingDesignCost)}</td>`).join('')}</tr>` : '';
    const summary = `<table class="summary-table"><thead><tr><th>Metric</th>${resultsData.map(result => `<th>${escapeHtml(getScenarioDisplayName(result.scenario))}</th>`).join('')}</tr></thead><tbody>
        <tr><td><b>${renderMetricLabel('Final Purchase Price', 'purchasePrice', 'help-summary-price')}</b></td>${resultsData.map(result => `<td>${formatCurrency(result.finalPrice)}</td>`).join('')}</tr>
        <tr><td><b>${renderMetricLabel('Down Payment', 'downPayment', 'help-summary-down-payment')}</b></td>${resultsData.map(result => `<td>${formatCurrency(result.downPayment)}</td>`).join('')}</tr>
        <tr><td><b>${renderMetricLabel('Loan Amount', 'loanAmount', 'help-summary-loan-amount')}</b></td>${resultsData.map(result => `<td>${formatCurrency(result.loanAmount)}</td>`).join('')}</tr>
        <tr><td><b>${renderMetricLabel('Final Interest Rate', 'rate', 'help-summary-final-rate')}</b></td>${resultsData.map(result => `<td>${result.finalRate.toFixed(3)}%</td>`).join('')}</tr>
        ${incentiveSummaryRows}
        <tr><td><b>${renderMetricLabel('Cash Needed to Close', 'cashToClose', 'help-summary-cash-to-close')}</b></td>${resultsData.map(result => `<td>${formatCurrency(result.cashToClose)}</td>`).join('')}</tr>
        <tr><td><b>${renderMetricLabel('Year 1 Monthly Payment', 'monthlyPayment', 'help-summary-monthly-payment')}</b></td>${resultsData.map(result => `<td>${formatCurrency(result.data[0].totalMonthly)}</td>`).join('')}</tr>
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

function closeOpenHelp() {
    document.querySelectorAll('.help-term.is-open').forEach(term => {
        term.classList.remove('is-open');
        term.querySelector('.help-trigger')?.setAttribute('aria-expanded', 'false');
    });
}

function toggleHelp(button) {
    const term = button.closest('.help-term');
    if (!term) return;
    const wasOpen = term.classList.contains('is-open');
    closeOpenHelp();
    if (!wasOpen) {
        term.classList.add('is-open');
        button.setAttribute('aria-expanded', 'true');
    }
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
        scheduleShareUrlUpdate();
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
        scheduleShareUrlUpdate();
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
        scheduleShareUrlUpdate();
    }
    if (target.dataset.chartContext === 'comparison') {
        state.compareChartMetric = target.value;
        renderComparison();
        scheduleShareUrlUpdate();
    }
}

function handleClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) {
        if (!event.target.closest('.help-term')) closeOpenHelp();
        return;
    }
    const action = target.dataset.action;
    if (action === 'toggle-help') {
        event.preventDefault();
        toggleHelp(target);
        return;
    }
    closeOpenHelp();
    if (action === 'switch-home') {
        appData.activeHomeId = Number(target.dataset.homeId);
        state.activeView = 'home';
        persist();
        renderApp();
    } else if (action === 'show-comparison') {
        state.activeView = 'compare';
        renderApp();
        scheduleShareUrlUpdate();
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
        scheduleShareUrlUpdate();
    }
}

document.addEventListener('input', handleInput);
document.addEventListener('change', handleChange);
document.addEventListener('click', handleClick);
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeOpenHelp();
});
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
if (savedActiveComparison && !initialShareState) {
    const applied = applyComparisonHomeConfigs(savedActiveComparison.homeConfigs);
    state.compareHomeIds = applied.compareHomeIds;
    state.compareScenarioIds = applied.compareScenarioIds;
    state.activeComparisonId = savedActiveComparison.id;
}

renderApp();

$('#shareButton').addEventListener('click', async () => {
    const button = $('#shareButton');
    try {
        const shareUrl = await updateShareUrlNow();
        await copyTextToClipboard(shareUrl);
        button.textContent = 'Copied!';
        setTimeout(() => { button.textContent = 'Copy Share Link'; }, 1500);
    } catch (error) {
        alert('The share link could not be copied. You can copy the current URL from the address bar.');
    }
});
