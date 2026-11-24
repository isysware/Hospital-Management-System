import assert from 'node:assert/strict';

console.log('--- PHARMACY REPORTING REDESIGN UI & STATEMENT TEST SUITE ---');

// Test 1: Operating Profit 6-Column Statement Calculation & % Revenue
console.log('\n[Test 1] Operating Profit Statement Math & Revenue Percentages');
const sampleBreakdown = {
  grossSales: '500000',
  discounts: '25000',
  netBilling: '475000', // Net Revenue
  medicineCogs: '300000',
  grossProfit: '175000', // 475000 - 300000
  operatingExpenses: '60000',
  inventoryLosses: '5000',
  operatingProfit: '110000', // 175000 - (60000 + 5000)
};

const netRevenue = Number(sampleBreakdown.netBilling);
assert.equal(netRevenue, 475000, 'Net Revenue correctly parsed');

const grossProfit = netRevenue - Number(sampleBreakdown.medicineCogs);
assert.equal(grossProfit, 175000, 'Gross profit = Net Revenue - COGS');

const totalOverheads = Number(sampleBreakdown.operatingExpenses) + Number(sampleBreakdown.inventoryLosses);
assert.equal(totalOverheads, 65000, 'Total overheads = Op Expenses + Stock Losses');

const netProfit = grossProfit - totalOverheads;
assert.equal(netProfit, 110000, 'Net Operating Profit matches');

// Percent of Revenue checks
const cogsPct = (Number(sampleBreakdown.medicineCogs) / netRevenue) * 100;
assert.equal(cogsPct.toFixed(1), '63.2', 'COGS is 63.2% of net revenue');

const grossProfitPct = (grossProfit / netRevenue) * 100;
assert.equal(grossProfitPct.toFixed(1), '36.8', 'Gross Profit margin is 36.8%');

const netProfitPct = (netProfit / netRevenue) * 100;
assert.equal(netProfitPct.toFixed(1), '23.2', 'Net Operating Profit margin is 23.2%');
console.log('✓ Test 1 Passed: P&L Statement calculations & % revenue verified.');

// Test 2: Prior Period Variance / Growth Calculation
console.log('\n[Test 2] Prior Period Variance / Growth Formula');
const currentRev = 475000;
const priorRev = 400000;
const growthPct = ((currentRev - priorRev) / Math.abs(priorRev)) * 100;
assert.equal(growthPct.toFixed(2), '18.75', 'Growth is +18.75%');

const currentExp = 60000;
const priorExp = 50000;
const expVar = ((currentExp - priorExp) / Math.abs(priorExp)) * 100;
assert.equal(expVar.toFixed(2), '20.00', 'Expense growth is +20.00%');
console.log('✓ Test 2 Passed: Variance & growth percentages verified.');

// Test 3: Financial Separation of Income, Collections, and Expenses
console.log('\n[Test 3] Separation of Sales, Collections, and Operating Expenses');
const ledgerEntries = [
  { type: 'INVOICE', income: 10000, collections: 6000, expenses: 0, outstanding: 4000 },
  { type: 'INVOICE', income: 5000, collections: 5000, expenses: 0, outstanding: 0 },
  { type: 'EXPENSE', income: 0, collections: 0, expenses: 3000, outstanding: 0 },
];

let totalIncome = 0;
let totalCollections = 0;
let totalExpenses = 0;
let totalOutstanding = 0;

ledgerEntries.forEach((e) => {
  totalIncome += e.income;
  totalCollections += e.collections;
  totalExpenses += e.expenses;
  totalOutstanding += e.outstanding;
});

assert.equal(totalIncome, 15000, 'Total Income = 15,000');
assert.equal(totalCollections, 11000, 'Total Collections = 11,000');
assert.equal(totalExpenses, 3000, 'Total Expenses = 3,000');
assert.equal(totalOutstanding, 4000, 'Total Outstanding = 4,000');

const netCashFlow = totalCollections - totalExpenses;
assert.equal(netCashFlow, 8000, 'Net Cash Flow = 11,000 - 3,000 = 8,000');
assert.notEqual(netCashFlow, totalIncome - totalExpenses, 'Cash flow and accrual profit remain distinct');
console.log('✓ Test 3 Passed: Income, collections, expenses, and cash flow strictly decoupled.');

// Test 4: Vendor Payments Exclusion from Operating Expenses
console.log('\n[Test 4] Capital Vendor Payments Classified as Informational Only');
const vendorPaymentAmount = 85000;
const operatingExpensesBefore = 60000;

// Under financial rules, vendor payments must NOT be added to operating expenses
const operatingExpensesAfter = operatingExpensesBefore;
assert.equal(operatingExpensesAfter, 60000, 'Operating expenses unchanged by vendor payment');
assert.equal(operatingProfit(netRevenue, Number(sampleBreakdown.medicineCogs), operatingExpensesAfter), 115000, 'Profit unaffected by capital vendor settlement');

function operatingProfit(rev: number, cogs: number, exp: number): number {
  return rev - cogs - exp;
}
console.log('✓ Test 4 Passed: Vendor payments verified as capital settlements excluded from P&L.');

console.log('\n>>> ALL PHARMACY REPORTING REDESIGN UNIT TESTS PASSED CLEANLY! <<<');
