import { DEFAULT_LOAN_TERM_YEARS } from './data.js';

export function monthlyPayment(principal, annualRate, numberOfMonths) {
    if (numberOfMonths <= 0) return 0;
    const monthlyRate = (Number(annualRate) / 100) / 12;
    if (monthlyRate === 0) return principal / numberOfMonths;
    return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -numberOfMonths));
}

function downPaymentAmount(home) {
    return home.downType === 'percent'
        ? home.price * (home.downValue / 100)
        : home.downValue;
}

export function calculateLoanInputs(home) {
    const downPayment = downPaymentAmount(home);
    const principal = Math.max(0, home.price - downPayment);
    const closingCosts = principal * (home.closingCosts / 100);
    return {
        downPayment,
        principal,
        closingCosts,
        cashToClose: downPayment + closingCosts
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
