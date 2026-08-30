import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAmortization, calculateLoanInputs, calculateScenario, monthlyPayment } from '../src/calculations.js';

const home = {
    price: 300000,
    downType: 'amount',
    downValue: 60000,
    closingCosts: 2,
    tax: 1.2,
    hoa: 100,
    ins: 150,
    appreciation: 3
};

const fixed = { type: 'fixed', termYears: 30, rate: 6, bdY1: 0, bdY2: 0, armRate: 5, armFee: 5000 };

test('calculates a standard monthly payment', () => {
    assert.ok(Math.abs(monthlyPayment(240000, 6, 360) - 1438.92) < 0.01);
});

test('calculates loan inputs from a dollar down payment', () => {
    assert.deepEqual(calculateLoanInputs(home), {
        downPayment: 60000,
        principal: 240000,
        closingCosts: 4800,
        cashToClose: 64800
    });
});

test('supports a fixed-dollar closing-cost estimate', () => {
    const result = calculateLoanInputs({
        ...home,
        closingCostEstimateMode: 'fixed',
        closingCostEstimateAmount: 9000
    });

    assert.equal(result.closingCosts, 9000);
    assert.equal(result.cashToClose, 69000);
});

test('applies incentive allocations to the final scenario without double-counting points', () => {
    const incentiveHome = {
        ...home,
        price: 600000,
        downType: 'percent',
        downValue: 20,
        closingCostEstimateMode: 'fixed',
        closingCostEstimateAmount: 12000,
        incentivePool: 30000,
        tax: 0,
        hoa: 0,
        ins: 0
    };
    const scenario = {
        ...fixed,
        rate: 6.5,
        incentiveAllocation: {
            rateBuydown: 15000,
            closingCosts: 5000,
            priceReduction: 10000,
            designUpgrades: 0
        }
    };

    const result = calculateScenario(incentiveHome, scenario);

    assert.equal(result.finalPrice, 590000);
    assert.equal(result.loanAmount, 472000);
    assert.ok(Math.abs(result.pointsPurchased - 3.1779661) < 0.0001);
    assert.ok(Math.abs(result.finalRate - 5.7055085) < 0.0001);
    assert.equal(result.estimatedClosingCosts, 12000);
    assert.equal(result.closingCredit, 5000);
    assert.equal(result.cashToClose, 125000);
    assert.equal(result.incentiveUsed, 30000);
});

test('caps closing-cost and upgrade credits at their eligible costs', () => {
    const result = calculateScenario({
        ...home,
        incentivePool: 20000,
        closingCostEstimateMode: 'fixed',
        closingCostEstimateAmount: 4000
    }, {
        ...fixed,
        designCost: 3000,
        incentiveAllocation: {
            rateBuydown: 0,
            closingCosts: 10000,
            priceReduction: 0,
            designUpgrades: 10000
        }
    });

    assert.equal(result.closingCredit, 4000);
    assert.equal(result.designCredit, 3000);
    assert.equal(result.incentiveUsed, 7000);
    assert.equal(result.incentiveRemaining, 13000);
    assert.equal(result.cashToClose, 60000);
});

test('includes taxes, HOA, and insurance in the total monthly payment', () => {
    const result = calculateAmortization(home, fixed, 240000);
    const expectedFixedCosts = 300000 * 0.012 / 12 + 100 + 150;
    assert.ok(Math.abs(result[0].totalMonthly - (monthlyPayment(240000, 6, 360) + expectedFixedCosts)) < 0.01);
});

test('temporary buydown lowers out-of-pocket payment but keeps contractual amortization', () => {
    const buydown = { ...fixed, type: 'buydown', rate: 6, bdY1: 2, bdY2: 1 };
    const result = calculateAmortization(home, buydown, 240000);
    const standard = calculateAmortization(home, fixed, 240000);

    assert.ok(result[0].pi < standard[0].pi);
    assert.equal(result[2].pi, standard[2].pi);
    assert.ok(Math.abs(result[0].balance - standard[0].balance) < 0.01);
    assert.ok(Math.abs(result[0].cumulativeInterest - standard[0].cumulativeInterest) < 0.01);
    assert.ok(result[0].cumulativeOutOfPocketInterest < result[0].cumulativeInterest);
});

test('models the simplified ARM reset and rolled-in refinance fee', () => {
    const arm = { ...fixed, type: 'arm', rate: 6, armRate: 4, armFee: 5000 };
    const result = calculateAmortization(home, arm, 240000);

    assert.equal(result[6].rate, '6.000');
    assert.equal(result[7].rate, '4.000');
    assert.ok(result[7].balance > 0);
    assert.ok(result[7].pi < result[6].pi);
});

test('generates enough rows to report the full loan term', () => {
    const fortyYearLoan = { ...fixed, termYears: 40 };
    const result = calculateAmortization(home, fortyYearLoan, 240000);

    assert.equal(result.length, 40);
    assert.ok(result.at(-1).balance < 0.01);
    assert.ok(result.at(-1).cumulativeInterest > result[29].cumulativeInterest);
});
