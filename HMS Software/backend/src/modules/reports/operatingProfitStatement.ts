import { prisma } from '@/db/client';
import { hospitalClock } from '@/shared/hospitalClock';
import { staffFinanceSummary } from './staffFinanceSummary';
import { operatingPerformance } from './operatingPerformance';
import { setupService } from '@/modules/setup/setup.service';
import { hospitalServiceDepartment, isOutsourcedService, isInternalHospitalEarning } from '@/shared/hospitalRevenueRecognition';
import type { IncomeExpenseLedgerQuery, OperatingProfitQuery } from './managementReports.schemas';
import type { managementReportsService } from './managementReports.service';

type Ledger = Awaited<ReturnType<typeof managementReportsService.getIncomeExpenseLedger>>;
type Range = { start: Date; end: Date; label: string };
export type StatementEntry = {
  id: string;
  date: string;
  reference: string;
  category: string;
  department: string;
  description: string;
  actor: string;
  revenue: number;
  cost: number;
  status: string;
  details: Record<string, unknown>;
};

export const hospitalStatementCategories = [
  ['opd', '1. HOSPITAL OPERATING REVENUE', 'OPD Services Revenue', 'REVENUE'],
  ['emergency', '1. HOSPITAL OPERATING REVENUE', 'Emergency Services Revenue', 'REVENUE'],
  ['observation', '1. HOSPITAL OPERATING REVENUE', 'Observation Services Revenue', 'REVENUE'],
  ['admission', '1. HOSPITAL OPERATING REVENUE', 'Admission / Inpatient Hospital Services Revenue', 'REVENUE'],
  ['otherRevenue', '1. HOSPITAL OPERATING REVENUE', 'Other Valid Hospital Services Revenue', 'REVENUE'],
  ['discounts', '1. HOSPITAL OPERATING REVENUE', 'Less: Approved Discounts', 'REVENUE'],
  ['serviceCredits', '1. HOSPITAL OPERATING REVENUE', 'Less: Valid Service Credits / Reversals', 'REVENUE'],
  ['netRevenue', '1. HOSPITAL OPERATING REVENUE', 'TOTAL NET EARNED HOSPITAL REVENUE', 'SUBTOTAL'],
  ['consumables', '2. DIRECT SERVICE COSTS', 'Clinical Consumables / Materials Used', 'COST'],
  ['procedure', '2. DIRECT SERVICE COSTS', 'Procedure / Treatment Direct Consumable Costs', 'COST'],
  ['otherDirect', '2. DIRECT SERVICE COSTS', 'Other Valid Direct Service Costs', 'COST'],
  ['directReturns', '2. DIRECT SERVICE COSTS', 'Less: Valid Direct Cost Reversals / Returns', 'COST'],
  ['directTotal', '2. DIRECT SERVICE COSTS', 'TOTAL DIRECT SERVICE COSTS', 'SUBTOTAL'],
  ['grossProfit', '3. GROSS PROFIT (GROSS MARGIN)', 'GROSS PROFIT (GROSS MARGIN)', 'SUBTOTAL'],
  ['payroll', '4. OPERATING OVERHEADS & EXPENSES', 'Staff Salaries / Payroll Recognized', 'EXPENSE'],
  ['commission', '4. OPERATING OVERHEADS & EXPENSES', 'Doctor Commission Earned / Recognized', 'EXPENSE'],
  ['hospitalOpex', '4. OPERATING OVERHEADS & EXPENSES', 'Hospital Operating Expenses', 'EXPENSE'],
  ['inventoryOpex', '4. OPERATING OVERHEADS & EXPENSES', 'Inventory Operating Expenses', 'EXPENSE'],
  ['otherOpex', '4. OPERATING OVERHEADS & EXPENSES', 'Other Valid Operating Overheads', 'EXPENSE'],
  ['expenseCredits', '4. OPERATING OVERHEADS & EXPENSES', 'Less: Valid Expense Reversals / Credits', 'EXPENSE'],
  ['opexTotal', '4. OPERATING OVERHEADS & EXPENSES', 'TOTAL OPERATING EXPENSES', 'SUBTOTAL'],
  ['operatingProfit', '5. NET OPERATING PROFIT / (LOSS)', 'NET OPERATING PROFIT / (LOSS)', 'NET RESULT'],
] as const;

export const statementCategories = hospitalStatementCategories;

const revenueKeys = ['opd', 'emergency', 'observation', 'admission', 'otherRevenue', 'discounts', 'serviceCredits'];
const directKeys = ['consumables', 'procedure', 'otherDirect', 'directReturns'];
const expenseKeys = ['payroll', 'commission', 'hospitalOpex', 'inventoryOpex', 'otherOpex', 'expenseCredits'];

export function categoryKeys(category?: string): string[] | undefined {
  if (!category) return undefined;
  if (category === 'netRevenue') return revenueKeys;
  if (category === 'directTotal') return directKeys;
  if (category === 'opexTotal') return expenseKeys;
  if (category === 'grossProfit' || category === 'grossMargin') return [...revenueKeys, ...directKeys];
  if (category === 'operatingProfit' || category === 'operatingMargin') return [...revenueKeys, ...directKeys, ...expenseKeys];
  if (category.startsWith('outsourced-billing-') || category.startsWith('outsourced-payable-')) {
    const deptId = category.replace(/^outsourced-(billing|payable)-/, '');
    return [`outsourced-${deptId}`, 'outsourced'];
  }
  return [category];
}

export function previousEquivalent(range: Range): Range {
  const duration = range.end.getTime() - range.start.getTime() + 1;
  return { start: new Date(range.start.getTime() - duration), end: new Date(range.start.getTime() - 1), label: 'Previous Equivalent Period' };
}

export const growth = (current: number | null, prior: number | null) =>
  current === null || prior === null || prior === 0 ? null : (current - prior) / Math.abs(prior) * 100;

const sum = (entries: StatementEntry[], keys: string[], field: 'revenue' | 'cost') =>
  entries.filter(e => keys.includes(e.category)).reduce((s, e) => s + e[field], 0);

/** Uses the same invoice snapshots, staff recognition and P&L arithmetic as the existing reports. */
export function summarizeStatement(entries: StatementEntry[], incomplete: boolean) {
  const amounts: Record<string, number | null> = {};
  for (const [key] of hospitalStatementCategories) amounts[key] = sum(entries, [key], revenueKeys.includes(key) ? 'revenue' : 'cost');
  const net = sum(entries, revenueKeys, 'revenue'), direct = sum(entries, directKeys, 'cost'), opex = sum(entries, expenseKeys, 'cost');
  const performance = operatingPerformance(net, direct, opex);
  Object.assign(amounts, {
    netRevenue: net,
    directTotal: direct,
    opexTotal: opex,
    grossProfit: incomplete ? null : performance.grossProfit,
    grossMargin: incomplete || !net ? null : performance.grossProfit / net * 100,
    operatingProfit: incomplete ? null : performance.operatingProfit,
    operatingMargin: incomplete || !net ? null : performance.operatingMargin,
  });
  return amounts;
}

async function readPeriod(range: Range, departmentId: string | undefined, readLedger: (q: IncomeExpenseLedgerQuery) => Promise<Ledger>) {
  const [ledger, staff, lines, payables, pharmacyCharges] = await Promise.all([
    readLedger({ preset: 'custom', fromDate: hospitalClock(range.start).date, toDate: hospitalClock(range.end).date, departmentId, page: 1, limit: 500, exportAll: true }),
    staffFinanceSummary(range.start, range.end, departmentId),
    prisma.invoiceLineItem.findMany({
      where: {
        createdAt: { gte: range.start, lte: range.end },
        isCompleted: true,
        billingSource: { not: 'PHARMACY' },
        hospitalInvoice: { status: { not: 'VOID' } },
      },
      include: {
        serviceRate: { include: { department: { include: { outsourcedProvider: true } } } },
        hospitalInvoice: {
          include: {
            department: { include: { outsourcedProvider: true } },
            appointment: { include: { department: { include: { outsourcedProvider: true } } } },
            admissionRecord: { include: { department: { include: { outsourcedProvider: true } } } },
            createdByUser: { select: { displayName: true, username: true } },
            selfPayEncounter: { select: { fullName: true } },
            panelPatient: { select: { fullName: true } },
          },
        },
      },
    }),
    setupService.getDepartmentPayablesSummary({
      preset: 'custom',
      fromDate: hospitalClock(range.start).date,
      toDate: hospitalClock(range.end).date,
    }),
    prisma.hmsPharmacyCharge.findMany({
      where: { createdAt: { gte: range.start, lte: range.end } },
      select: { totalAmount: true },
    }),
  ]);

  const entries: StatementEntry[] = [];
  const outsourcedBillingByDept = new Map<string, number>();
  let totalOutsourcedBilling = 0;

  for (const line of lines) {
    const inv = line.hospitalInvoice;
    const department = hospitalServiceDepartment(line, inv);
    if (departmentId && department?.id !== departmentId) continue;

    const base = {
      date: line.createdAt.toISOString(),
      reference: inv.invoiceNumber,
      department: department?.name || 'Unassigned',
      description: line.descriptionSnapshot || line.serviceRate?.name || 'Hospital service',
      actor: inv.createdByUser?.displayName || inv.createdByUser?.username || inv.createdById || 'Unassigned',
      status: inv.status,
      details: {
        invoiceId: inv.id,
        lineId: line.id,
        patient: inv.selfPayEncounter?.fullName || inv.panelPatient?.fullName,
        quantity: Number(line.quantity),
        historicalRate: Number(line.rateSnapshot),
        billingSource: line.billingSource,
        gross: Number(line.lineGross),
        discount: Number(line.discountAmount),
        net: Number(line.lineNet),
      },
    };

    // Dynamic classification based on actual configured department ownership and provider type
    const isOutsourced = isOutsourcedService(line, inv);

    if (isOutsourced) {
      const net = Number(line.lineNet);
      totalOutsourcedBilling += net;
      const deptId = department?.id || 'unassigned-outsourced';
      outsourcedBillingByDept.set(deptId, (outsourcedBillingByDept.get(deptId) || 0) + net);
      entries.push({
        ...base,
        id: line.id,
        category: `outsourced-${deptId}`,
        revenue: net,
        cost: 0,
      });
      // Excluded from Hospital Operating Revenue according to strict reporting separation
      continue;
    }

    // Internal Hospital Service:
    if (!isInternalHospitalEarning(line, inv)) continue;
    const type = inv.encounterType || inv.sourceType;
    const category = inv.admissionRecordId ? 'admission' : ({ OPD: 'opd', EMERGENCY: 'emergency', ER: 'emergency', OBSERVATION: 'observation', OBSV: 'observation', ADMISSION: 'admission' } as Record<string, string>)[type] || 'otherRevenue';
    entries.push({ ...base, id: line.id, category, revenue: Number(line.lineGross), cost: 0 });
    if (Number(line.discountAmount)) {
      entries.push({ ...base, id: `discount-${line.id}`, category: 'discounts', revenue: -Number(line.discountAmount), cost: 0 });
    }
  }

  // Hospital Expenses & Consumables
  for (const row of ledger.items) {
    if (!['EXPENSE', 'CONSUMABLE'].includes(row.transactionType) || row.recognizedExpense === 0) continue;
    const category = row.recognizedExpense < 0
      ? row.transactionType === 'CONSUMABLE' ? 'directReturns' : 'expenseCredits'
      : row.transactionType === 'CONSUMABLE' ? 'consumables' : row.id.startsWith('iexp-') ? 'inventoryOpex' : 'hospitalOpex';
    entries.push({
      id: row.id,
      date: row.date,
      reference: row.reference,
      category,
      department: row.department,
      description: row.patientPayeeDescription,
      actor: row.portalUser,
      status: row.status,
      revenue: 0,
      cost: row.recognizedExpense,
      details: row.details || { sourceId: row.id, paymentMethod: row.paymentMethod, recognizedExpense: row.recognizedExpense, paid: row.expensePaid },
    });
  }

  // Staff Payroll & Commissions
  for (const row of staff.sources) {
    entries.push({
      id: `${row.category}-${row.id}`,
      date: row.date,
      reference: row.reference,
      category: row.amount < 0 ? 'expenseCredits' : row.category,
      department: departmentId || 'See source allocation',
      description: row.category === 'payroll' ? 'Approved payroll recognition' : 'Eligible collection commission recognition',
      actor: row.actor,
      status: row.status,
      revenue: 0,
      cost: row.amount,
      details: row.details,
    });
  }

  // Dynamic Outsourced Department Records from existing Department Payables calculation
  const outsourcedDeptsMap = new Map<string, {
    departmentId: string;
    departmentName: string;
    departmentCode: string;
    providerName: string | null;
    billing: number;
    providerPayable: number;
  }>();

  for (const d of (payables?.departments || [])) {
    if (d.fulfillmentOwnership !== 'OUTSOURCED') continue;
    if (departmentId && d.departmentId !== departmentId) continue;

    const billed = outsourcedBillingByDept.get(d.departmentId) ?? Number(d.periodBilled ?? 0);
    const payable = Number(d.remainingPayable ?? d.closingBalance ?? 0);

    outsourcedDeptsMap.set(d.departmentId, {
      departmentId: d.departmentId,
      departmentName: d.departmentName,
      departmentCode: d.departmentCode,
      providerName: d.outsourcedProvider?.name ?? null,
      billing: billed,
      providerPayable: payable,
    });
  }

  // Include any outsourced departments present in invoice lines
  for (const [deptId, billed] of outsourcedBillingByDept.entries()) {
    if (!outsourcedDeptsMap.has(deptId)) {
      const matchLine = lines.find(l => {
        const d = l.serviceRate?.department ?? l.hospitalInvoice.department ?? l.hospitalInvoice.appointment?.department ?? l.hospitalInvoice.admissionRecord?.department;
        return d?.id === deptId;
      });
      const d = matchLine?.serviceRate?.department ?? matchLine?.hospitalInvoice.department;
      outsourcedDeptsMap.set(deptId, {
        departmentId: deptId,
        departmentName: d?.name || 'Outsourced Department',
        departmentCode: d?.code || 'OUT',
        providerName: d?.outsourcedProvider?.name ?? null,
        billing: billed,
        providerPayable: 0,
      });
    }
  }

  const outsourcedDepts = Array.from(outsourcedDeptsMap.values()).sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  const totalOutsourcedPayable = outsourcedDepts.reduce((s, d) => s + d.providerPayable, 0);

  const pharmacyBilling = pharmacyCharges && pharmacyCharges.length > 0
    ? pharmacyCharges.reduce((s, c) => s + Number(c.totalAmount), 0)
    : null;

  const warnings: string[] = [];
  let incomplete = ledger.totals.hospitalCosts.hasIncompleteCost;
  if (incomplete) warnings.push(`${ledger.totals.hospitalCosts.missingCostCount} consumption records have incomplete historical costs. Profit is unavailable.`);
  const expectedCosts = ledger.totals.hospitalCosts;
  const observedDirect = sum(entries, directKeys, 'cost');
  const observedOpex = sum(entries, expenseKeys, 'cost');
  const expectedOpex = expectedCosts.staffPayrollRecognized + expectedCosts.doctorCommissionEarned + expectedCosts.approvedHospitalExpenses + expectedCosts.inventoryOperatingExpenses;
  if (Math.abs(observedDirect - expectedCosts.directConsumables) > 0.01 || Math.abs(observedOpex - expectedOpex) > 0.01) {
    incomplete = true; warnings.push('Source costs do not fully reconcile with the canonical financial summary. Profit is unavailable; no balancing records were invented.');
  }

  const net = sum(entries, revenueKeys, 'revenue');
  const expectedHospitalRevenue = ledger.totals.hospitalRevenue.netEarnedRevenue;
  if (Math.abs(net - expectedHospitalRevenue) > 0.01) {
    warnings.push('Hospital revenue includes completed internal hospital service lines only; outsourced services and pharmacy are excluded.');
  }

  return {
    entries,
    amounts: summarizeStatement(entries, incomplete),
    incomplete,
    warnings,
    outsourcedDepts,
    totalOutsourcedBilling,
    totalOutsourcedPayable,
    pharmacyBilling,
  };
}

export async function buildOperatingStatement(query: OperatingProfitQuery, range: Range, readLedger: (q: IncomeExpenseLedgerQuery) => Promise<Ledger>) {
  const priorRange = query.comparison === 'previous' && query.preset !== 'all_time' ? previousEquivalent(range) : null;
  const [current, prior] = await Promise.all([
    readPeriod(range, query.departmentId, readLedger),
    priorRange ? readPeriod(priorRange, query.departmentId, readLedger) : Promise.resolve(null),
  ]);

  // 1. Core 5-Section Hospital Statement Rows (Preserved strictly as 5 approved sections)
  const rows: Array<{
    key: string;
    section: string;
    label: string;
    type: string;
    unit: 'percent' | 'currency';
    current: number | null;
    prior: number | null;
    percentOfRevenue: number | null;
    variance: number | null;
    sourceCount: number;
    departmentId?: string;
    providerName?: string | null;
  }> = hospitalStatementCategories.map(([key, section, label, type]) => {
    const amount = current.amounts[key] ?? null;
    const previous = prior?.amounts[key] ?? null;
    const margin = key.endsWith('Margin');
    return {
      key,
      section,
      label,
      type,
      unit: margin ? 'percent' : 'currency',
      current: amount,
      prior: previous,
      percentOfRevenue: margin ? null : amount === null || !current.amounts.netRevenue ? null : amount / current.amounts.netRevenue * 100,
      variance: growth(amount, previous),
      sourceCount: current.entries.filter(e => categoryKeys(key)?.includes(e.category)).length,
    };
  });

  // Dynamic Outsourced Department Streams (1 row per outsourced department / provider)
  const allDeptIds = Array.from(new Set([
    ...current.outsourcedDepts.map(d => d.departmentId),
    ...(prior?.outsourcedDepts.map(d => d.departmentId) || []),
  ]));

  const outsourcedStreams = allDeptIds.map(deptId => {
    const cur = current.outsourcedDepts.find(d => d.departmentId === deptId);
    const prev = prior?.outsourcedDepts.find(d => d.departmentId === deptId);
    return {
      departmentId: deptId,
      departmentName: cur?.departmentName || prev?.departmentName || 'Outsourced Department',
      departmentCode: cur?.departmentCode || prev?.departmentCode || 'OUT',
      providerName: cur?.providerName || prev?.providerName || null,
      currentBilling: cur ? cur.billing : 0,
      currentPayable: cur ? cur.providerPayable : 0,
      priorBilling: prev ? prev.billing : null,
      priorPayable: prev ? prev.providerPayable : null,
      billingVariance: growth(cur ? cur.billing : 0, prev ? prev.billing : null),
      payableVariance: growth(cur ? cur.providerPayable : 0, prev ? prev.providerPayable : null),
    };
  }).sort((a, b) => a.departmentName.localeCompare(b.departmentName));

  const pharmacyStream = {
    currentBilling: current.pharmacyBilling,
    priorBilling: prior?.pharmacyBilling ?? null,
    available: current.pharmacyBilling !== null,
  };

  const keys = categoryKeys(query.category);
  const matching = current.entries.filter(e => !keys || keys.includes(e.category)).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const page = query.page || 1, limit = query.limit || 25;
  const warnings = [...current.warnings, ...(prior?.warnings.map(w => `Prior period: ${w}`) || [])];
  if (query.preset === 'all_time' && query.comparison === 'previous') warnings.push('Comparison is disabled for All Time.');

  return {
    period: { start: range.start.toISOString(), end: range.end.toISOString(), label: range.label },
    priorPeriod: priorRange ? { start: priorRange.start.toISOString(), end: priorRange.end.toISOString(), label: `${hospitalClock(priorRange.start).date} to ${hospitalClock(priorRange.end).date}` } : null,
    rows,
    warnings,
    incomplete: current.incomplete,
    ledger: {
      items: query.exportAll ? matching : matching.slice((page - 1) * limit, page * limit),
      page,
      limit,
      totalRecords: matching.length,
      totalPages: Math.max(1, Math.ceil(matching.length / limit)),
      recognizedRevenue: matching.reduce((s, e) => s + e.revenue, 0),
      recognizedCost: matching.reduce((s, e) => s + e.cost, 0),
    },
    summary: {
      revenue: current.amounts.netRevenue ?? 0,
      grossBilling: current.amounts.netRevenue ?? 0,
      discounts: current.amounts.discounts ?? 0,
      directCost: current.amounts.directTotal ?? 0,
      grossProfit: current.amounts.grossProfit ?? 0,
      payroll: current.amounts.payroll ?? 0,
      doctorCommission: current.amounts.commission ?? 0,
      otherOperatingExpenses: current.amounts.opexTotal ?? 0,
      totalCosts: (current.amounts.directTotal ?? 0) + (current.amounts.opexTotal ?? 0),
      operatingProfit: current.amounts.operatingProfit ?? 0,
      marginPercentage: current.amounts.operatingMargin ?? 0,
      hasIncompleteCost: current.incomplete,
      totalOutsourcedBilling: current.totalOutsourcedBilling,
      totalOutsourcedPayable: current.totalOutsourcedPayable,
      pharmacyBilling: current.pharmacyBilling,
    },
    outsourcedStreams,
    pharmacyStream,
  };
}
