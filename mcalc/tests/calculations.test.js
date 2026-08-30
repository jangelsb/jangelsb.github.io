import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAmortization, calculateLoanInputs, monthlyPayment } from '../src/calculations.js';

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
    assert.ok(Math.abs(monthlyPayment(240000, 6, 360) - 1438.89) < 0.01);
});

test('calculates loan inputs from a dollar down payment', () => {
    assert.deepEqual(calculateLoanInputs(home), {
        downPayment: 60000,
        principal: 240000,
        closingCosts: 4800,
        cashToClose: 64800
    });
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
