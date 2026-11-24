import assert from 'node:assert/strict';

console.log('--- PHARMACY INCOME & EXPENSE MULTI-COLLECTION REPORTING TEST SUITE ---');

// Simulated Invoice data matching backend operatingProfitReport return with payments & financial events
const sampleInvoice = {
  id: 'inv-uuid-001',
  invoiceNumber: 'INV-2026-0001',
  channel: 'RETAIL',
  customerName: 'Muhammad Ali',
  createdAt: '2026-11-01T10:00:00.000Z',
  netBilling: 100,
  grossSales: 100,
  total: 100,
  outstanding: 0,
  status: 'PAID',
  soldBy: 'Pharmacist Bilal',
  collectedBy: 'Pharmacist Bilal, Cashier Usman',
  payments: [
    {
      id: 'pay-001-initial',
      amount: 50,
      method: 'CASH',
      paidAt: '2026-11-01T10:00:00.000Z',
      isInitial: true,
      collectedByName: 'Pharmacist Bilal',
    },
    {
      id: 'pay-002-second',
      amount: 20,
      method: 'CASH',
      paidAt: '2026-11-06T14:30:00.000Z',
      isInitial: false,
      collectedByName: 'Cashier Usman',
    },
    {
      id: 'pay-003-third',
      amount: 30,
      method: 'BANK',
      paidAt: '2026-11-16T11:15:00.000Z',
      isInitial: false,
      collectedByName: 'Cashier Usman',
    },
  ],
  financialEvents: [],
};

const sampleExpenses = [
  {
    id: 'exp-001',
    expenseNumber: 'EXP-2026-001',
    date: '2026-11-06T16:00:00.000Z',
    category: 'Pharmacy Consumables',
    amount: 15,
    paymentMethod: 'CASH',
    payeeOrVendor: 'Stationery Supplier',
    description: 'Thermal receipt rolls',
    enteredBy: 'Pharmacist Bilal',
    approvedBy: 'Pharmacy Admin',
  },
];

// Helper projection replicating PharmacyIncomeExpenseReportPage logic
function projectIncomeExpenseRows(rawInvoices: any[], rawExpenses: any[]) {
  const rows: any[] = [];
  const toDateKey = (d: string | Date | undefined) => {
    if (!d) return '';
    const dt = new Date(d);
    return new Date(dt.getTime() + 5 * 3600000).toISOString().slice(0, 10);
  };

  rawInvoices.forEach((inv) => {
    const net = Number(inv.netBilling || inv.grossSales || inv.total || 0);
    const invoiceDay = toDateKey(inv.createdAt);

    const rawPayments: any[] = (inv.payments || []).slice().sort((a: any, b: any) =>
      new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime() || String(a.id).localeCompare(String(b.id))
    );

    const rawEvents: any[] = (inv.financialEvents || []).slice().sort((a: any, b: any) =>
      new Date(a.occurredAt || 0).getTime() - new Date(b.occurredAt || 0).getTime() || String(a.id).localeCompare(String(b.id))
    );

    const firstPositivePayment = rawPayments.find((p: any) => Number(p.amount) > 0);
    const isInitialPayment = (p: any) => {
      if (p.isInitial === true) return true;
      if (p.isInitial === false) return false;
      const pDay = toDateKey(p.paidAt);
      if (new Date(p.paidAt).getTime() === new Date(inv.createdAt).getTime()) return true;
      if (p.id === firstPositivePayment?.id && pDay === invoiceDay) return true;
      return false;
    };

    const initialPayments = rawPayments.filter(isInitialPayment);
    const subsequentPayments = rawPayments.filter((p: any) => !isInitialPayment(p));

    const initialCollected = initialPayments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
    const initialReceipt = initialPayments.map((p: any) => p.reference || `PAY-${String(p.id).slice(0, 8).toUpperCase()}`).join(', ') || inv.invoiceNumber;
    const initialMethod = initialPayments.map((p: any) => p.method).join(', ') || 'CASH';
    const initialCollector = initialPayments.map((p: any) => p.collectedByName).join(', ') || inv.soldBy || 'Staff';

    let runningBalance = net - initialCollected;
    const initialOutstanding = Math.max(0, runningBalance);

    // 1. Original Sale Row
    rows.push({
      id: `inv-${inv.invoiceNumber}`,
      date: inv.createdAt,
      reference: inv.invoiceNumber,
      sourceType: 'INVOICE',
      transactionType: 'Original Sale',
      channel: inv.channel,
      description: inv.customerName,
      income: net,
      collections: initialCollected,
      expenses: 0,
      paymentMethod: initialMethod,
      outstanding: initialOutstanding,
      user: inv.soldBy || initialCollector,
      status: initialOutstanding <= 0 ? 'PAID' : (initialCollected > 0 ? 'PARTIALLY_PAID' : 'UNPAID'),
      invoiceRef: inv.invoiceNumber,
      receiptNumber: initialReceipt,
    });

    // 2. Subsequent Collections
    subsequentPayments.forEach((p: any) => {
      const pAmt = Number(p.amount || 0);
      runningBalance = Math.max(0, runningBalance - pAmt);
      const outstandingAfterReceipt = runningBalance;
      const pReceipt = p.reference || `PAY-${String(p.id).slice(0, 8).toUpperCase()}`;

      rows.push({
        id: `pay-${p.id}`,
        date: p.paidAt,
        reference: pReceipt,
        sourceType: 'COLLECTION',
        transactionType: 'Outstanding Invoice Collection',
        channel: inv.channel,
        description: `Outstanding Collection — ${inv.invoiceNumber} (${inv.customerName})`,
        income: 0,
        collections: pAmt,
        expenses: 0,
        paymentMethod: p.method,
        outstanding: outstandingAfterReceipt,
        user: p.collectedByName,
        status: outstandingAfterReceipt <= 0 ? 'PAID' : 'COLLECTED',
        invoiceRef: inv.invoiceNumber,
        receiptNumber: pReceipt,
      });
    });
  });

  // Operating Expenses
  rawExpenses.forEach((exp) => {
    rows.push({
      id: `exp-${exp.id}`,
      date: exp.date,
      reference: exp.expenseNumber,
      sourceType: 'EXPENSE',
      transactionType: 'Operating Expense',
      channel: 'EXPENSE',
      description: exp.description,
      income: 0,
      collections: 0,
      expenses: exp.amount,
      paymentMethod: exp.paymentMethod,
      outstanding: 0,
      user: exp.enteredBy,
      status: 'APPROVED',
    });
  });

  return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// ── Test 1: Full Historical Multi-Collection Row Projection ──
console.log('\n[Test 1] Verify exact 3 rows generated for PKR 100 invoice with PKR 50, 20, 30 payments');
const allRows = projectIncomeExpenseRows([sampleInvoice], sampleExpenses);
const invoiceTransactions = allRows.filter((r) => r.sourceType === 'INVOICE' || r.sourceType === 'COLLECTION');

assert.equal(invoiceTransactions.length, 3, 'Must produce exactly 3 rows: 1 original sale + 2 collections');

// Verify newest first order
assert.equal(invoiceTransactions[0].transactionType, 'Outstanding Invoice Collection', 'Newest row is Third payment');
assert.equal(invoiceTransactions[0].collections, 30, 'Third payment collection = PKR 30');
assert.equal(invoiceTransactions[0].outstanding, 0, 'Third payment remaining balance = PKR 0');
assert.equal(invoiceTransactions[0].income, 0, 'Third payment recognized income = PKR 0');
assert.equal(invoiceTransactions[0].user, 'Cashier Usman', 'Third payment collector = Cashier Usman');

assert.equal(invoiceTransactions[1].transactionType, 'Outstanding Invoice Collection', 'Middle row is Second payment');
assert.equal(invoiceTransactions[1].collections, 20, 'Second payment collection = PKR 20');
assert.equal(invoiceTransactions[1].outstanding, 30, 'Second payment remaining balance = PKR 30');
assert.equal(invoiceTransactions[1].income, 0, 'Second payment recognized income = PKR 0');
assert.equal(invoiceTransactions[1].user, 'Cashier Usman', 'Second payment collector = Cashier Usman');

assert.equal(invoiceTransactions[2].transactionType, 'Original Sale', 'Oldest row is Original Sale');
assert.equal(invoiceTransactions[2].income, 100, 'Original Sale recognized income = PKR 100');
assert.equal(invoiceTransactions[2].collections, 50, 'Original Sale initial collection = PKR 50');
assert.equal(invoiceTransactions[2].outstanding, 50, 'Original Sale historical remaining = PKR 50');
assert.equal(invoiceTransactions[2].user, 'Pharmacist Bilal', 'Original Sale seller/collector = Pharmacist Bilal');

console.log('✓ Test 1 Passed: Exactly 3 rows projected with correct historical running balances (50, 30, 0).');

// ── Test 2: Single-Day Date Filter on Subsequent Collection Date (Nov 6) ──
console.log('\n[Test 2] Date Filter on Day of Second Collection (Nov 6)');
const nov6Rows = allRows.filter((r) => {
  const day = new Date(new Date(r.date).getTime() + 5 * 3600000).toISOString().slice(0, 10);
  return day === '2026-11-06';
});

assert.equal(nov6Rows.length, 2, 'Must include only Nov 6 collection and Nov 6 expense');
const nov6Col = nov6Rows.find((r) => r.sourceType === 'COLLECTION');
const nov6Exp = nov6Rows.find((r) => r.sourceType === 'EXPENSE');

assert.ok(nov6Col, 'Nov 6 collection row present');
assert.equal(nov6Col.collections, 20, 'Nov 6 collected amount = PKR 20');
assert.equal(nov6Col.income, 0, 'Nov 6 recognized income = 0 (original sale not in range)');
assert.equal(nov6Col.outstanding, 30, 'Remaining balance at Nov 6 = PKR 30');

assert.ok(nov6Exp, 'Nov 6 expense present');
assert.equal(nov6Exp.expenses, 15, 'Nov 6 expense amount = PKR 15');

const nov6NetCash = nov6Rows.reduce((s, r) => s + r.collections - r.expenses, 0);
assert.equal(nov6NetCash, 5, 'Nov 6 Net Cash Movement = 20 - 15 = PKR 5');
console.log('✓ Test 2 Passed: Date filter on Nov 6 correctly displays collection on its payment date without original sale.');

// ── Test 3: Revenue Recognition Integrity (Never Double-Counted) ──
console.log('\n[Test 3] Revenue Recognition Integrity across full period');
const totalIncome = allRows.reduce((s, r) => s + r.income, 0);
const totalCollections = allRows.reduce((s, r) => s + r.collections, 0);
const totalExpenses = allRows.reduce((s, r) => s + r.expenses, 0);

assert.equal(totalIncome, 100, 'Total Gross Recognized Revenue is strictly PKR 100 (never 100 + 20 + 30 = 150)');
assert.equal(totalCollections, 100, 'Total Collections Received = PKR 50 + 20 + 30 = PKR 100');
assert.equal(totalExpenses, 15, 'Total Operating Expenses = PKR 15');
assert.equal(totalCollections - totalExpenses, 85, 'Net Cash Flow = PKR 85');

console.log('✓ Test 3 Passed: Gross revenue recognized only once at PKR 100; total collections = PKR 100.');

console.log('\n>>> ALL MULTI-COLLECTION REPORTING TESTS PASSED PERFECTLY! <<<');
