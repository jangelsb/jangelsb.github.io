import { DEFAULT_LOAN_TERM_YEARS, INCENTIVE_BUCKETS } from './data.js';

export function monthlyPayment(principal, annualRate, numberOfMonths) {
    if (numberOfMonths <= 0) return 0;
    const monthlyRate = (Number(annualRate) / 100) / 12;
    if (monthlyRate === 0) return principal / numberOfMonths;
    return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -numberOfMonths));
}

function nonNegativeNumber(value) {
    return Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
}

function downPaymentAmount(home, purchasePrice = home.price) {
    return home.downType === 'percent'
        ? Math.min(purchasePrice, purchasePrice * (nonNegativeNumber(home.downValue) / 100))
        : Math.min(purchasePrice, nonNegativeNumber(home.downValue));
}

function closingCostEstimate(home, principal) {
    if (home.closingCostEstimateMode === 'fixed') {
        return nonNegativeNumber(home.closingCostEstimateAmount);
    }
    const percent = home.closingCostEstimatePercent ?? home.closingCosts ?? 0;
    return principal * (nonNegativeNumber(percent) / 100);
}

export function calculateLoanInputs(home, purchasePrice = home.price) {
    const finalPrice = nonNegativeNumber(purchasePrice);
    const downPayment = downPaymentAmount(home, finalPrice);
    const principal = Math.max(0, finalPrice - downPayment);
    const closingCosts = closingCostEstimate(home, principal);
    return {
        downPayment,
        principal,
        closingCosts,
        cashToClose: downPayment + closingCosts
    };
}

function normalizedAllocation(config, incentivePool) {
    const source = config?.incentiveAllocation || config?.allocation || {};
    const requested = INCENTIVE_BUCKETS.reduce((result, bucket) => {
        result[bucket] = nonNegativeNumber(source[bucket]);
        return result;
    }, {});
    const requestedTotal = INCENTIVE_BUCKETS.reduce((total, bucket) => total + requested[bucket], 0);
    const scale = requestedTotal > incentivePool && requestedTotal > 0
        ? incentivePool / requestedTotal
        : 1;
    const allocation = INCENTIVE_BUCKETS.reduce((result, bucket) => {
        result[bucket] = requested[bucket] * scale;
        return result;
    }, {});
    return { requested, allocation, requestedTotal, scale };
}

export function calculateScenario(home, config) {
    const incentivePool = nonNegativeNumber(home.incentivePool);
    const allocationState = normalizedAllocation(config, incentivePool);
    const allocation = allocationState.allocation;
    const basePrice = nonNegativeNumber(home.price);
    const priceReduction = Math.min(basePrice, allocation.priceReduction);
    const finalPrice = basePrice - priceReduction;
    const loanInputs = calculateLoanInputs(home, finalPrice);
    const pointCost = loanInputs.principal * 0.01;
    const pointsPurchased = pointCost > 0 ? allocation.rateBuydown / pointCost : 0;
    const rateReduction = pointsPurchased * 0.25;
    const baseRate = nonNegativeNumber(config.rate);
    const finalRate = Math.max(0, baseRate - rateReduction);
    const closingCredit = Math.min(allocation.closingCosts, loanInputs.closingCosts);
    const designCost = nonNegativeNumber(config.designCost);
    const designCredit = Math.min(allocation.designUpgrades, designCost);
    const remainingClosingCosts = Math.max(0, loanInputs.closingCosts - closingCredit);
    const remainingDesignCost = Math.max(0, designCost - designCredit);
    const effectiveHome = { ...home, price: finalPrice };
    const effectiveConfig = { ...config, rate: finalRate };
    const amortization = calculateAmortization(effectiveHome, effectiveConfig, loanInputs.principal);
    const appliedAllocation = {
        rateBuydown: allocation.rateBuydown,
        closingCosts: closingCredit,
        priceReduction,
        designUpgrades: designCredit
    };
    const incentiveUsed = INCENTIVE_BUCKETS.reduce((total, bucket) => total + appliedAllocation[bucket], 0);
    const incentiveRemaining = Math.max(0, incentivePool - incentiveUsed);

    return {
        home,
        scenario: config,
        incentivePool,
        requestedAllocation: allocationState.requested,
        allocation,
        appliedAllocation,
        incentiveUsed,
        incentiveRemaining,
        basePrice,
        finalPrice,
        downPayment: loanInputs.downPayment,
        loanAmount: loanInputs.principal,
        baseRate,
        finalRate,
        pointsPurchased,
        rateReduction,
        estimatedClosingCosts: loanInputs.closingCosts,
        closingCredit,
        remainingClosingCosts,
        designCost,
        designCredit,
        remainingDesignCost,
        cashToClose: loanInputs.downPayment + remainingClosingCosts + remainingDesignCost,
        amortization
    };
}

export function calculateAmortization(home, config, principalAmount, projectionYears = 30) {
    const monthlyTax = (home.price * (home.tax / 100)) / 12;
    const fixedMonthlyCosts = monthlyTax + home.hoa + home.ins;
    const termYears = Number(config.termYears) > 0 ? Number(config.termYears) : DEFAULT_LOAN_TERM_YEARS;
    const termMonths = Math.max(1, Math.round(termYears * 12));
    const standardPI = monthlyPayment(principalAmount, config.rate, termMonths);
    const yearsToGenerate = Math.max(projectionYears, Math.ceil(termMonths / 12));

    let balance = principalAmount;
    let cumulativeInterest = 0;
    let cumulativeOutOfPocketInterest = 0;
    let cumulativePrincipal = 0;
    let currentMonthlyRate = (config.rate / 100) / 12;
    let currentPI = standardPI;
    let refinanced = false;
    const yearlyData = [];

    for (let year = 1; year <= yearsToGenerate; year += 1) {
        let yearlyPrincipal = 0;
        let yearlyInterest = 0;
        let yearlyOutOfPocketInterest = 0;
        let displayRate = Number(config.rate) || 0;
        let outOfPocketPI = currentPI;

        if (config.type === 'buydown' && year <= 2) {
            const rateDrop = year === 1 ? config.bdY1 : config.bdY2;
            displayRate = Math.max(0, config.rate - rateDrop);
            outOfPocketPI = monthlyPayment(
                principalAmount,
                displayRate,
                termMonths
            );
        } else if (config.type === 'arm' && year === 8 && termMonths > 84) {
            balance += Number(config.armFee) || 0;
            displayRate = Number(config.armRate) || 0;
            currentMonthlyRate = displayRate / 100 / 12;
            const remainingMonths = Math.max(1, termMonths - 84);
            currentPI = monthlyPayment(balance, displayRate, remainingMonths);
            outOfPocketPI = currentPI;
            refinanced = true;
        }

        if (config.type === 'arm' && refinanced) {
            displayRate = Number(config.armRate) || 0;
        }

        const loanIsActive = (year - 1) * 12 < termMonths && balance > 0;
        const displayedPI = loanIsActive ? outOfPocketPI : 0;
        const totalMonthly = displayedPI + fixedMonthlyCosts;

        for (let month = 1; month <= 12; month += 1) {
            const monthNumber = ((year - 1) * 12) + month;
            if (monthNumber > termMonths || balance <= 0) break;

            const trueRate = config.type === 'arm' && refinanced
                ? currentMonthlyRate
                : (config.rate / 100) / 12;
            const truePI = config.type === 'arm' && refinanced ? currentPI : standardPI;
            const trueInterest = balance * trueRate;
            const principalPaid = Math.min(balance, Math.max(0, truePI - trueInterest));
            const outOfPocketInterest = Math.max(0, outOfPocketPI - principalPaid);

            yearlyInterest += trueInterest;
            yearlyOutOfPocketInterest += outOfPocketInterest;
            yearlyPrincipal += principalPaid;
            cumulativeInterest += trueInterest;
            cumulativeOutOfPocketInterest += outOfPocketInterest;
            cumulativePrincipal += principalPaid;
            balance = Math.max(0, balance - principalPaid);
        }

        const homeValue = home.price * Math.pow(1 + (home.appreciation / 100), year);
        const equity = homeValue - balance;
        yearlyData.push({
            year,
            rate: displayRate.toFixed(3),
            pi: displayedPI,
            totalMonthly,
            yearlyPrincipal,
            yearlyInterest,
            yearlyOutOfPocketInterest,
            cumulativePrincipal,
            cumulativeInterest,
            cumulativeOutOfPocketInterest,
            balance,
            homeValue,
            equity
        });
    }

    return yearlyData;
}
