import { operatingPerformance } from './operatingPerformance';
import { buildOperatingStatement } from './operatingProfitStatement';


import { projectM01Invoice } from './m01InvoiceProjection';
import { invoiceAsOf } from '@/shared/invoiceAsOf';
import { allocateCollection, allocateInvoiceAmount, collectionSelect, collectionInvoiceSelect, invoiceBalance, panelCollectionLedger, signedReceiptWhere } from '@/shared/departmentCollections';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { resolveDateRange } from './dashboard.service';
import { PAYABLE_EQUIVALENT } from '@/modules/attendance/attendance.service';
import { expensesService } from '@/modules/expenses/expenses.service';
import { commissionBalance, commissionPeriodBalance, commissionDepartmentFilter } from '@/modules/commission/commission.calc';
import { salaryBalance } from '@/modules/payroll/payroll.balance';
import { staffFinanceSummary } from './staffFinanceSummary';
import { getPositiveBatchBalances } from '@/shared/inventoryBatchBalances';
import { hospitalClock } from '@/shared/hospitalClock';
import { financialDepartmentSelect, hospitalServiceDepartment, isInternalHospitalEarning } from '@/shared/hospitalRevenueRecognition';
import type {
  ManagementSummaryQuery,
  BillingCollectionQuery,
  OutstandingPanelQuery,
  BalanceSettlementsQuery,
  StaffPayrollQuery,
  InventoryPharmacyQuery,
  IncomeExpenseLedgerQuery,
  OperatingProfitQuery,
} from './managementReports.schemas';

/**
 * Admin / Super Admin management reports (Super Admin_Admin Reporting.pdf,
 * reporting.md §8.3). Read-only views over the same posted tables Front
 * Desk, Admission, Payroll and Inventory already write — no mock rows.
 * Admission & Bed Summary (#4) uses `/reports/admission/summary` directly.
 */

const ZERO = () => new Decimal(0);
const sumOf = <T>(rows: T[], pick: (r: T) => Decimal) =>
  rows.reduce((s, r) => s.plus(pick(r)), ZERO());

const patientSelect = {
  panelPatient: { select: { fullName: true } },
  selfPayEncounter: { select: { fullName: true } },
} as const;
const userSelect = { select: { id: true, displayName: true, username: true, role: true } } as const;

type Named = { fullName: string } | null | undefined;
const patientName = (r: { panelPatient?: Named; selfPayEncounter?: Named }) =>
  r.panelPatient?.fullName || r.selfPayEncounter?.fullName || 'Unknown Patient';
const userName = (u?: { displayName: string | null; username: string } | null) =>
  u ? u.displayName || u.username : null;
const unique = (values: (string | null | undefined)[]) =>
  Array.from(new Set(values.filter(Boolean))) as string[];
const periodOf = (start: Date, end: Date, label: string) => ({
  label,
  start: start.toISOString(),
  end: end.toISOString(),
});
/** Amount still owed on an invoice; an overpaid invoice is a credit, not negative debt. */

/** Settlements that actually moved cash off a user's custody. */
const ACCEPTED_SETTLEMENT = ['ACCEPTED', 'PARTIALLY_ACCEPTED'] as const;
const CASH_ROLES = [
  'FRONT_DESK_BILLING',
  'INVENTORY_MANAGEMENT',
  'PHARMACY_MANAGER',
  'PHARMACY_SALES_DISPENSING',
  'ADMIN',
  'SUPER_ADMIN',
];
const PORTAL_LABEL: Record<string, string> = {
  BILLING: 'Front Desk / Billing',
  INVENTORY: 'Inventory',
  PHARMACY: 'Pharmacy',
};

export const managementReportsService = {
  /** #1 Management Summary — hospital-wide totals (shown as table rows) + one row per department. */
  async getSummary(query: ManagementSummaryQuery, reportingRange?: { start: Date; end: Date; label: string }) {
    const { start, end, label } = reportingRange ?? resolveDateRange(query);
    const dept = query.departmentId;
    const user = query.portalUserId;
    const method = query.method;

    const bedDept = dept
      ? { OR: [{ ward: { departmentId: dept } }, { room: { ward: { departmentId: dept } } }] }
      : {};
    const [
      invoices,
      receipts,
      expenses,
      activeAdmissions,
      occupiedBeds,
      availableBeds,
      pendingSettlements,
      hospitalExpenses,
      staffFinance,
      panelCollections,
      departmentIssues,
    ] = await Promise.all([
      prisma.hospitalInvoice.findMany({
        where: {
          createdAt: { lte: end },
          status: { not: 'VOID' },
          ...(dept
            ? {
              OR: [
                { departmentId: dept },
                { lines: { some: { serviceRate: { departmentId: dept } } } },
                { appointment: { departmentId: dept } },
                { admissionRecord: { departmentId: dept } },
              ],
            }
            : {}),
          ...(user ? { createdById: user } : {}),
        },
        select: {
          id: true,
          createdAt: true,
          status: true,
          paymentReceipts: { where: { ...signedReceiptWhere, collectedAt: { lte: end } }, select: { amount: true } },
          subtotal: true,
          discountTotal: true,
          total: true,
          paidTotal: true,
          panelReceivable: true,
          panelRemittanceAllocations: { where: { panelRemittance: { receivedAt: { lte: end } } }, select: { allocatedAmount: true } },
          departmentId: true,
          department: { select: financialDepartmentSelect },
          appointment: { select: { department: { select: financialDepartmentSelect } } },
          admissionRecord: { select: { department: { select: financialDepartmentSelect } } },
          lines: {
            select: {
              createdAt: true,
              isCompleted: true,
              billingSource: true,
              lineGross: true,
              discountAmount: true,
              lineNet: true,
              patientShare: true,
              panelReceivable: true,
              serviceRate: {
                select: {
                  departmentId: true,
                  providerType: true,
                  department: { select: financialDepartmentSelect },
                },
              },
            },
          },
        },
      }),
      prisma.paymentReceipt.findMany({
        where: {
          collectedAt: { gte: start, lte: end },
          AND: [{ OR: [{ isReversed: false }, { amount: { lt: 0 } }] }],
          ...(method ? { method } : {}),
          ...(user ? { collectedById: user } : {}),
          ...(dept
            ? {
              OR: [
                { hospitalInvoice: { departmentId: dept } },
                { hospitalInvoice: { lines: { some: { serviceRate: { departmentId: dept } } } } },
                { hospitalInvoiceId: null, admissionRecord: { departmentId: dept } },
                { hospitalInvoiceId: null, appointment: { departmentId: dept } },
              ],
            }
            : {}),
        },
        select: collectionSelect,
      }),
      // Operating vouchers only: never also count their cash-ledger mirrors.
      prisma.inventoryExpense.aggregate({
        where: {
          expenseDate: { gte: new Date(start.toLocaleDateString('en-CA')), lte: new Date(end.toLocaleDateString('en-CA')) },
          // Inventory vouchers have no department assignment.
          ...(dept ? { id: { in: [] } } : {}),
          ...(user ? { createdById: user } : {}),
          ...(method ? { paymentMethod: method } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.admissionRecord.groupBy({
        by: ['departmentId'],
        where: { status: 'ACTIVE', ...(dept ? { departmentId: dept } : {}) },
        _count: { _all: true },
      }),
      prisma.bed.count({ where: { status: 'OCCUPIED', ...bedDept } }),
      prisma.bed.count({ where: { status: 'AVAILABLE', ...bedDept } }),
      prisma.accountSettlement.count({
        where: { status: 'SUBMITTED', ...(user ? { portalUserId: user } : {}) },
      }),
      expensesService.totalBetween(start, end, dept, method),
      staffFinanceSummary(start, end, dept, user, method),
      panelCollectionLedger(prisma, end, { start, departmentId: dept, method, userId: user }),
      prisma.departmentRequisition.findMany({
        where: {
          issuedAt: { gte: start, lte: end },
          status: { in: ['ISSUED', 'PARTIALLY_RETURNED', 'CLOSED'] },
          ...(dept ? { departmentId: dept } : {}),
        },
        include: {
          department: { select: { id: true, name: true, departmentType: true } },
          lines: {
            select: {
              quantity: true,
              returnedQuantity: true,
              costRate: true,
            },
          },
        },
      }),
    ]);

    type Row = {
      department: string;
      invoices: number;
      gross: Decimal;
      discount: Decimal;
      net: Decimal;
      collected: Decimal;
      outstanding: Decimal;
      activeAdmissions: number;
    };
    const rows = new Map<string, Row>();
    const rowFor = (name: string) => {
      let r = rows.get(name);
      if (!r) {
        r = {
          department: name,
          invoices: 0,
          gross: ZERO(),
          discount: ZERO(),
          net: ZERO(),
          collected: ZERO(),
          outstanding: ZERO(),
          activeAdmissions: 0,
        };
        rows.set(name, r);
      }
      return r;
    };

    const countedInvoicesPerDept = new Map<string, Set<string>>();
    let netEarnedRevenue = ZERO();

    for (const i of invoices) {
      for (const line of i.lines) {
        if (line.createdAt >= start && line.createdAt <= end && isInternalHospitalEarning(line, i)
          && (!dept || hospitalServiceDepartment(line, i)?.id === dept)) {
          netEarnedRevenue = netEarnedRevenue.plus(line.lineNet);
        }
      }
      if (i.createdAt >= start) {
        if (i.lines && i.lines.length > 0) {
          for (const l of i.lines) {
            const lineDept = hospitalServiceDepartment(l, i);
            const targetDeptId = lineDept?.id ?? null;
            const targetDeptName = lineDept?.name ?? 'General Hospital Services';

            if (dept && targetDeptId !== dept) {
              continue;
            }

            const r = rowFor(targetDeptName);
            let invSet = countedInvoicesPerDept.get(targetDeptName);
            if (!invSet) {
              invSet = new Set<string>();
              countedInvoicesPerDept.set(targetDeptName, invSet);
            }
            if (!invSet.has(i.id)) {
              invSet.add(i.id);
              r.invoices += 1;
            }

            r.gross = r.gross.plus(l.lineGross);
            r.discount = r.discount.plus(l.discountAmount);
            r.net = r.net.plus(l.lineNet);


          }
        } else {
          const targetDeptId = i.departmentId;
          const targetDeptName = i.department?.name ?? 'General Hospital Services';
          if (dept && targetDeptId !== dept) {
            continue;
          }
          const r = rowFor(targetDeptName);
          r.invoices += 1;
          r.gross = r.gross.plus(i.subtotal);
          r.discount = r.discount.plus(i.discountTotal);
          r.net = r.net.plus(i.total);

        }
      }
      // Current paidTotal includes later receipts: reconstruct the cutoff balance.
      const balance = invoiceBalance({ ...i, paidTotal: sumOf(i.paymentReceipts, r => r.amount) });
      for (const allocation of [
        ...allocateInvoiceAmount(balance.patientDue, i, 'patientShare'),
        ...allocateInvoiceAmount(balance.panelDue, i, 'panelReceivable'),
      ]) {
        if (!dept || allocation.departmentId === dept) {
          const row = rowFor(allocation.departmentId === null ? 'General Hospital Services' : allocation.name);
          row.outstanding = row.outstanding.plus(allocation.amount);
        }
      }
    }

    // Collections follow receipt date, method and collector, including old invoices.
    for (const receipt of receipts) {
      for (const allocation of allocateCollection(receipt)) {
        if (!dept || allocation.departmentId === dept) {
          const row = rowFor(allocation.departmentId === null ? 'General Hospital Services' : allocation.name);
          row.collected = row.collected.plus(allocation.amount);
        }
      }
    }
    for (const allocation of panelCollections) {
      if (!dept || allocation.departmentId === dept) {
        const row = rowFor(allocation.departmentId === null ? 'General Hospital Services' : allocation.name);
        row.collected = row.collected.plus(allocation.amount);
      }
    }
    if (activeAdmissions.length) {
      const departments = await prisma.department.findMany({
        where: { id: { in: activeAdmissions.map((a) => a.departmentId) } },
        select: { id: true, name: true },
      });
      const nameById = new Map(departments.map((d) => [d.id, d.name]));
      for (const a of activeAdmissions)
        rowFor(nameById.get(a.departmentId) ?? 'Unassigned').activeAdmissions += a._count._all;
    }

    const table = Array.from(rows.values()).sort((a, b) =>
      a.department.localeCompare(b.department),
    );
    let directServiceCosts = ZERO();
    let hasIncompleteCost = false;
    let missingCostCount = 0;
    for (const req of (departmentIssues as any[] || [])) {
      // Approved consumption rule: only issues to clinical/service departments constitute direct service costs
      const deptType = req.department?.departmentType;
      const isDirectServiceConsumption = !deptType || ['CLINICAL', 'SURGICAL', 'DIAGNOSTIC', 'EMERGENCY'].includes(deptType);
      if (!isDirectServiceConsumption) continue;

      for (const line of req.lines || []) {
        const netQty = line.quantity.minus(line.returnedQuantity);
        if (netQty.greaterThan(0)) {
          if (line.costRate === null || line.costRate === undefined || line.costRate.isZero()) {
            hasIncompleteCost = true;
            missingCostCount++;
          }
          directServiceCosts = directServiceCosts.plus(netQty.times(line.costRate ?? ZERO()));
        }
      }
    }

    const grossBilling = sumOf(table, (r) => r.gross);
    const discounts = sumOf(table, (r) => r.discount);
    const totalBilling = sumOf(table, (r) => r.net);
    const grossProfit = netEarnedRevenue.minus(directServiceCosts);
    const otherOperatingExpenses = hospitalExpenses.plus(expenses._sum.amount ?? ZERO());
    const totalOperatingCosts = directServiceCosts
      .plus(staffFinance.salaryGenerated)
      .plus(staffFinance.commissionGenerated)
      .plus(otherOperatingExpenses);
    const operatingProfit = grossProfit
      .minus(staffFinance.salaryGenerated)
      .minus(staffFinance.commissionGenerated)
      .minus(otherOperatingExpenses);
    const collectedIncome = sumOf(table, (r) => r.collected);
    const operatingMargin = netEarnedRevenue.isZero() ? ZERO() : operatingProfit.dividedBy(netEarnedRevenue).times(100);

    return {
      period: periodOf(start, end, label),
      summary: {
        ...staffFinance,
        grossBilling,
        discounts,
        totalBilling,
        netEarnedRevenue,
        directServiceCosts,
        grossProfit,
        payrollCost: staffFinance.salaryGenerated,
        doctorCommissionCost: staffFinance.commissionGenerated,
        otherOperatingExpenses,
        totalOperatingCosts,
        operatingProfit,
        operatingResult: operatingProfit, // Accrual-based Operating Profit (replaces collectedIncome - costs)
        operatingMargin,
        hasIncompleteCost,
        missingCostCount,
        collections: collectedIncome,
        collectedIncome,
        outstanding: sumOf(table, (r) => r.outstanding),
        hospitalExpenses,
        expenses: expenses._sum.amount ?? ZERO(),
        activeAdmissions: table.reduce((s, r) => s + r.activeAdmissions, 0),
        occupiedBeds,
        availableBeds,
        pendingSettlements,
      },
      rows: table,
    };
  },

  /** #2 Billing & Collection — one row per invoice with how it was paid and who collected it. */
  async getBillingCollection(query: BillingCollectionQuery) {
    const { start, end, label } = resolveDateRange(query);
    const invoices = await prisma.hospitalInvoice.findMany({
      where: {
        createdAt: { lte: end }, status: query.status === 'VOID' ? 'VOID' : { not: 'VOID' },
        ...(query.departmentId ? { OR: [{ departmentId: query.departmentId }, { lines: { some: { serviceRate: { departmentId: query.departmentId } } } }] } : {}),
        ...(query.corporatePanelId ? { corporatePanelId: query.corporatePanelId } : {})
      },
      include: {
        ...patientSelect, department: { select: { id: true, name: true } }, lines: collectionInvoiceSelect.lines,
        corporatePanel: { select: { organizationName: true } },
        paymentReceipts: { where: { ...signedReceiptWhere, collectedAt: { lte: end } }, include: { collectedBy: userSelect } },
        panelRemittanceAllocations: { where: { panelRemittance: { receivedAt: { lte: end } } }, include: { panelRemittance: { include: { receivedByUser: userSelect } } } }
      },
      orderBy: { createdAt: 'desc' },
    });
    const rows = invoices.map(invoiceAsOf).flatMap(i => {
      if (query.status && i.status !== query.status) return [];
      const receipts = i.paymentReceipts.filter(p => p.collectedAt >= start && (!query.method || p.method === query.method) && (!query.collectedById || p.collectedById === query.collectedById));
      const panels = i.panelRemittanceAllocations.filter(a => a.panelRemittance.receivedAt >= start && (!query.method || (query.method === 'BANK' ? ['BANK', 'BANK_TRANSFER', 'BANK TRANSFER'] : [query.method]).includes(a.panelRemittance.method.toUpperCase())) && (!query.collectedById || a.panelRemittance.receivedById === query.collectedById));
      if (!receipts.length && !panels.length && (i.createdAt < start || query.method || query.collectedById)) return [];
      const scoped = (amount: Decimal, basis: 'lineNet' | 'patientShare' | 'panelReceivable') => !query.departmentId ? amount : allocateInvoiceAmount(amount, i, basis).filter(a => a.departmentId === query.departmentId).reduce((sum, a) => sum.plus(a.amount), ZERO());
      return [{
        id: i.id, invoiceNumber: i.invoiceNumber, createdAt: i.createdAt, patient: patientName(i), payer: i.corporatePanel?.organizationName ?? 'Self-Pay',
        department: unique([i.department?.name, ...i.lines.map(l => l.serviceRate?.department?.name)]).join(', '),
        gross: scoped(i.subtotal, 'lineNet'), discount: scoped(i.discountTotal, 'lineNet'), net: scoped(i.total, 'lineNet'),
        periodBilled: i.createdAt >= start ? scoped(i.total, 'lineNet') : ZERO(),
        collected: scoped(sumOf(receipts, p => p.amount), 'patientShare').plus(scoped(sumOf(panels, a => a.allocatedAmount), 'panelReceivable')),
        outstanding: scoped(i.balance.patientDue, 'patientShare').plus(scoped(i.balance.panelDue, 'panelReceivable')),
        methods: unique([...receipts.map(p => p.method), ...panels.map(a => a.panelRemittance.method)]).join(', '),
        collectedBy: unique([...receipts.map(p => userName(p.collectedBy)), ...panels.map(a => userName(a.panelRemittance.receivedByUser))]).join(', '), status: i.status
      }];
    });
    return { period: periodOf(start, end, label), rows };
  },

  /**
   * #3 Outstanding / Panel — every invoice with money still owed. A Panel invoice
   * can be PAID by the patient (their share) while the company still owes its
   * receivable, so rows are chosen by amount due, not by invoice status.
   */
  async getOutstandingPanel(query: OutstandingPanelQuery) {
    const { start, end, label } = resolveDateRange(query);
    const invoices = await prisma.hospitalInvoice.findMany({
      where: {
        createdAt: { lte: end },
        status: { not: 'VOID' },
        ...(query.departmentId ? {
          OR: [
            { departmentId: query.departmentId },
            { lines: { some: { serviceRate: { departmentId: query.departmentId } } } },
          ]
        } : {}),
        ...(query.corporatePanelId ? { corporatePanelId: query.corporatePanelId } : {}),
        ...(query.payerType === 'PANEL' ? { corporatePanelId: { not: null } } : {}),
        ...(query.payerType === 'SELF_PAY' ? { corporatePanelId: null } : {}),
      },
      include: {
        ...patientSelect,
        paymentReceipts: { where: { ...signedReceiptWhere, collectedAt: { lte: end } }, select: { amount: true } },
        panelRemittanceAllocations: { where: { panelRemittance: { receivedAt: { lte: end } } }, select: { allocatedAmount: true } },
        department: { select: { id: true, name: true } },
        lines: collectionInvoiceSelect.lines,
        corporatePanel: { select: { organizationName: true } },
      },
      orderBy: { createdAt: 'asc' },
      // Reports and exports include the entire selected period; never silently truncate.
    });

    return {
      period: periodOf(start, end, label),
      rows: invoices.map(invoiceAsOf).map((i) => {
        const paidAtCutoff = sumOf(i.paymentReceipts, r => r.amount);
        const balance = invoiceBalance({ ...i, paidTotal: paidAtCutoff });
        const scoped = (amount: Decimal, basis: 'lineNet' | 'patientShare' | 'panelReceivable') => !query.departmentId ? amount :
          allocateInvoiceAmount(amount, i, basis).filter(r => r.departmentId === query.departmentId)
            .reduce((sum, r) => sum.plus(r.amount), ZERO());
        const patientDue = scoped(balance.patientDue, 'patientShare');
        const panelDue = scoped(balance.panelDue, 'panelReceivable');
        const due = patientDue.plus(panelDue);
        const collected = scoped(paidAtCutoff, 'patientShare').plus(scoped(balance.panelPaid, 'panelReceivable'));
        const departmentName = query.departmentId
          ? i.lines.find(l => l.serviceRate?.department?.id === query.departmentId)?.serviceRate?.department?.name ?? i.department?.name
          : i.department?.name;
        return {
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          createdAt: i.createdAt,
          patient: patientName(i),
          payerType: i.corporatePanelId ? 'Panel' : 'Self-Pay',
          panel: i.corporatePanel?.organizationName ?? null,
          department: departmentName ?? null,
          net: scoped(i.total, 'lineNet'),
          paid: collected,
          patientDue,
          panelDue,
          due,
          status: i.status,
        };
      }).filter(row => row.due.gt(0) && (!query.status || row.status === query.status)),
    };
  },

  /**
   * #6 Balance Sheet & Account Settlements — one row per user per cash portal.
   * Expected cash = carry-forward before the period + physical cash in − physical
   * cash out. Card/Bank/Online is shown separately and never counted as cash.
   */
  async getBalanceSettlements(query: BalanceSettlementsQuery) {
    const { start, end, label } = resolveDateRange(query);
    const scope = query.portal ? { moduleScope: query.portal } : {};
    const owner = query.portalUserId ? { portalUserId: query.portalUserId } : {};

    const [ledger, settlements] = await Promise.all([
      prisma.userCashBalance.findMany({
        where: { occurredAt: { lte: end }, ...scope, ...owner },
        select: {
          portalUserId: true,
          moduleScope: true,
          occurredAt: true,
          direction: true,
          category: true,
          amount: true,
          isPhysicalCash: true,
          portalUser: userSelect,
        },
      }),
      prisma.accountSettlement.findMany({
        where: { submittedAt: { lte: end }, ...scope, ...owner },
        select: {
          portalUserId: true,
          moduleScope: true,
          physicalCash: true,
          handoverAmount: true,
          variance: true,
          status: true,
          submittedAt: true,
          reviewedAt: true,
          reversedAt: true,
          submittedByUser: userSelect,
        },
        orderBy: { submittedAt: 'asc' },
      }),
    ]);

    type Row = {
      key: string;
      user: string;
      portal: string;
      opening: Decimal;
      pettyCash: Decimal;
      cashCollections: Decimal;
      settlementIn: Decimal;
      settlementOut: Decimal;
      pharmacySettlementOut: Decimal;
      expenses: Decimal;
      refunds: Decimal;
      nonCash: Decimal;
      physicalOut: Decimal;
      submitted: Decimal;
      accepted: Decimal;
      variance: Decimal;
      settlementStatus: string;
    };
    const rows = new Map<string, Row>();
    const rowFor = (
      userId: string,
      portal: string,
      u: { displayName: string | null; username: string },
    ) => {
      const key = `${userId}:${portal}`;
      let r = rows.get(key);
      if (!r) {
        r = {
          key,
          user: userName(u) ?? '—',
          portal: PORTAL_LABEL[portal] ?? portal,
          opening: ZERO(),
          pettyCash: ZERO(),
          cashCollections: ZERO(),
          settlementIn: ZERO(),
          settlementOut: ZERO(),
          pharmacySettlementOut: ZERO(),
          expenses: ZERO(),
          refunds: ZERO(),
          nonCash: ZERO(),
          physicalOut: ZERO(),
          submitted: ZERO(),
          accepted: ZERO(),
          variance: ZERO(),
          settlementStatus: 'NONE',
        };
        rows.set(key, r);
      }
      return r;
    };

    for (const e of ledger) {
      const r = rowFor(e.portalUserId, e.moduleScope, e.portalUser);
      if (e.occurredAt < start) {
        if (e.isPhysicalCash) r.opening = r.opening.plus(e.direction === 'IN' ? e.amount : e.amount.negated());
        continue;
      }
      if (!e.isPhysicalCash) {
        r.nonCash = r.nonCash.plus(e.direction === 'IN' ? e.amount : e.amount.negated());
        continue;
      }
      if (e.direction === 'IN') {
        if (e.category === 'SALARY_PAYMENT' || e.category === 'COMMISSION_PAYMENT') {
          r.physicalOut = r.physicalOut.minus(e.amount);
          r.expenses = r.expenses.minus(e.amount);
          continue;
        }
        if (e.category === 'PETTY_CASH_ISSUE') r.pettyCash = r.pettyCash.plus(e.amount);
        else if (e.category === 'RECOVERY') r.settlementIn = r.settlementIn.plus(e.amount);
        else r.cashCollections = r.cashCollections.plus(e.amount);
      } else {
        if (e.category === 'PHARMACY_SETTLEMENT') {
          r.pharmacySettlementOut = r.pharmacySettlementOut.plus(e.amount);
          r.physicalOut = r.physicalOut.plus(e.amount);
        } else if (e.category === 'RECOVERY') {
          // Accepted settlement handover OUT — pure custody transfer, NOT an operating expense
          r.settlementOut = r.settlementOut.plus(e.amount);
        } else if (e.category === 'REFUND') {
          r.physicalOut = r.physicalOut.plus(e.amount);
          r.refunds = r.refunds.plus(e.amount);
        } else {
          r.physicalOut = r.physicalOut.plus(e.amount);
          r.expenses = r.expenses.plus(e.amount);
        }
      }
    }

    for (const s of settlements) {
      const r = rowFor(s.portalUserId, s.moduleScope, s.submittedByUser);
      const acceptedAt = s.reviewedAt ?? s.submittedAt;
      const wasAccepted = (ACCEPTED_SETTLEMENT as readonly string[]).includes(s.status) || (s.status === 'REVERSED' && !!s.reversedAt && !!s.reviewedAt);
      if (wasAccepted && acceptedAt && acceptedAt <= end) {
        const amount = s.handoverAmount ?? s.physicalCash;
        if (acceptedAt >= start) r.accepted = r.accepted.plus(amount);
        if (s.reversedAt && s.reversedAt <= end && s.reversedAt >= start) {
          r.accepted = r.accepted.minus(amount);
        }
      }
      if (!s.submittedAt || s.submittedAt < start) continue;
      r.settlementStatus = s.status;
      if (s.status === 'REJECTED' || s.status === 'REVERSED' || s.status === 'RETURNED') continue;
      r.submitted = r.submitted.plus(s.physicalCash);
      r.variance = r.variance.plus(s.variance);
    }

    const result = Array.from(rows.values())
      .filter((r) => !query.settlementStatus || r.settlementStatus === query.settlementStatus)
      .map(({ physicalOut, ...r }) => {
        const acceptedOut = Decimal.max(r.settlementOut, r.accepted);
        const netCashCollections = r.cashCollections.minus(r.refunds);
        // Pre-settlement expected cash in till
        const expectedCash = r.opening
          .plus(r.pettyCash)
          .plus(netCashCollections)
          .plus(r.settlementIn)
          .minus(r.expenses)
          .minus(r.pharmacySettlementOut);
        // Post-settlement remaining cash in custody
        const remaining = expectedCash.minus(acceptedOut);
        return {
          ...r,
          cashCollections: netCashCollections,
          settlementOut: acceptedOut,
          accepted: acceptedOut,
          expectedCash,
          remaining,
        };
      })
      .sort((a, b) => a.user.localeCompare(b.user) || a.portal.localeCompare(b.portal));

    return { period: periodOf(start, end, label), rows: result };
  },

  /** #7 Staff / Payroll / Doctor Commission — one row per staff member for a payroll month. */
  async getStaffPayrollCommission(query: StaffPayrollQuery) {
    const now = new Date();
    const period =
      query.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [year, month] = period.split('-').map(Number) as [number, number];
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const inMonth = { gte: start, lte: end };

    const staff = await prisma.staff.findMany({
      where: {
        ...(query.departmentId ? {
          OR: [
            { staffDepartments: { some: { departmentId: query.departmentId } } },
            { commissionAccruals: { some: { periodStart: { lte: end }, invoiceLineItem: commissionDepartmentFilter(query.departmentId) } } },
          ]
        } : {}),
        ...(query.staffId ? { id: query.staffId } : {}),
      },
      select: {
        id: true,
        employeeId: true,
        fullName: true,
        category: true,
        department: { select: { name: true } },
        salaryProfiles: {
          where: { effectiveFrom: { lte: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }] },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: { salaryBasis: true, baseAmount: true },
        },
        attendanceRecords: { where: { attendanceDate: inMonth, isApproved: true }, select: { status: true } },
        salarySlips: {
          where: { periodStart: { lte: end }, periodEnd: { gte: start } },
          select: { id: true, payrollRunId: true, generatedAmount: true, status: true, payments: true, correctionEntries: true },
        },
        commissionAccruals: {
          where: { periodStart: { lte: end }, ...(query.departmentId ? { invoiceLineItem: commissionDepartmentFilter(query.departmentId) } : {}) }, select: {
            id: true, periodStart: true, collectionEvent: true, commissionRunId: true, commissionAmount: true, ruleSnapshot: true, status: true,
            payouts: { where: { paidAt: { lte: end } } }, reversals: { where: { reversedAt: { lte: end } } }, adjustments: { where: { createdAt: { lte: end } } },
          }
        },
      },
      orderBy: { fullName: 'asc' },
    });

    const rows = staff
      .map((s) => {
        const profile = s.salaryProfiles[0];
        const statuses = s.salarySlips.map(x => x.status);
        const payrollStatus = !statuses.length ? 'NOT_GENERATED'
          : statuses.every(x => x === 'PAID') ? 'PAID'
            : statuses.some(x => x === 'PAID' || x === 'PARTIALLY_PAID') ? 'PARTIALLY_PAID'
              : statuses.some(x => x === 'GENERATED' || x === 'DRAFT') ? 'GENERATED' : 'APPROVED';
        const salaries = s.salarySlips.map(salaryBalance);
        const commissions = s.commissionAccruals.map(row => commissionPeriodBalance(row, start, end));
        return {
          staffId: s.id,
          employeeId: s.employeeId,
          name: s.fullName,
          category: s.category,
          department: s.department?.name ?? null,
          attendanceDays: s.attendanceRecords.reduce(
            (d, a) => d + (PAYABLE_EQUIVALENT[a.status] ?? 0),
            0,
          ),
          salaryBasis: profile ? `${profile.salaryBasis} — ${profile.baseAmount.toFixed(0)}` : null,
          payrollAmount: sumOf(s.salarySlips, (x) => x.generatedAmount),
          commissionAmount: sumOf(commissions, x => x.periodGross),
          salaryAdjustments: sumOf(salaries, x => x.adjustments),
          salaryPayable: sumOf(salaries, x => x.payable),
          salaryPaid: sumOf(salaries, x => x.paid),
          salaryRemaining: sumOf(salaries, x => x.remaining),
          salaryOverpaid: sumOf(salaries, x => x.overpaid),
          commissionTax: sumOf(commissions, x => x.periodTax),
          commissionReversed: sumOf(commissions, x => x.periodReversed),
          commissionAdjustments: sumOf(commissions, x => x.periodAdjustments),
          commissionPayable: sumOf(commissions, x => x.generated),
          commissionPaid: sumOf(commissions, x => x.periodPaid),
          commissionRemaining: sumOf(commissions, x => x.remaining),
          commissionOverpaid: sumOf(commissions, x => x.overpaid),
          salarySlipIds: s.salarySlips.map(x => x.id),
          commissionAccrualIds: s.commissionAccruals.map(x => x.id),
          payrollRunIds: [...new Set(s.salarySlips.map(x => x.payrollRunId).filter(Boolean))],
          commissionRunIds: [...new Set(s.commissionAccruals.map(x => x.commissionRunId).filter(Boolean))],
          salaryStatements: s.salarySlips.map(x => ({ ...x, balance: salaryBalance(x) })),
          commissionStatements: s.commissionAccruals.map(x => ({ ...x, balance: commissionBalance(x) })),
          status: payrollStatus,
        };
      })
      .filter((r) => !query.status || r.status === query.status);

    return { period: { label: period, start: start.toISOString(), end: end.toISOString() }, rows };
  },

  /** #8 Inventory / Pharmacy Summary — purchases, stock movement, low stock / expiry and Pharmacy request totals. */
  async getInventoryPharmacy(query: InventoryPharmacyQuery) {
    const { start, end, label } = resolveDateRange(query);
    const soon = new Date();
    soon.setDate(soon.getDate() + 60);

    const [items, purchases, expiring, expired, requests, inventoryExpiringBatches, inventoryExpiredBatches, supplierLedgerAll] = await Promise.all([
      prisma.stockItem.findMany({
        where: { isActive: true, ...(query.category ? { category: query.category } : {}) },
        select: { id: true, reorderLevel: true },
      }),
      prisma.purchaseOrder.aggregate({
        where: { createdAt: { gte: start, lte: end }, status: { not: 'CANCELLED' } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      prisma.medicineBatch.count({ where: { expiryDate: { gte: new Date(), lte: soon } } }),
      prisma.medicineBatch.count({ where: { expiryDate: { lt: new Date() } } }),
      prisma.pharmacyClearance.groupBy({
        by: ['status'],
        where: { requestedAt: { gte: start, lte: end } },
        _count: { _all: true },
      }),
      // General HMS Inventory's own batch/expiry — deliberately separate from
      // Pharmacy's `medicineBatch` above (Domain F/G never intersect,
      // inventory.md §7.2/§9 step 1).
      getPositiveBatchBalances(soon),
      getPositiveBatchBalances(new Date()),
      prisma.supplierLedger.findMany({ select: { entryType: true, amount: true } }),
    ]);
    const inventoryExpiredCount = inventoryExpiredBatches.length;
    const inventoryNearExpiryOnlyCount = Math.max(0, inventoryExpiringBatches.length - inventoryExpiredCount);
    const inventorySupplierPayable = supplierLedgerAll.reduce(
      (acc, e) => (e.entryType === 'PURCHASE_CREDIT' ? acc.plus(e.amount) : acc.minus(e.amount)),
      ZERO(),
    );

    const ids = items.map((i) => i.id);
    const [balances, movements] = ids.length
      ? await Promise.all([
        prisma.stockLedger.groupBy({
          by: ['stockItemId'],
          where: { stockItemId: { in: ids } },
          _sum: { quantityDelta: true },
        }),
        prisma.stockLedger.findMany({
          where: { stockItemId: { in: ids }, createdAt: { gte: start, lte: end } },
          select: { stockItemId: true, quantityDelta: true },
        }),
      ])
      : [[], []];
    const balanceOf = new Map(balances.map((b) => [b.stockItemId, b._sum.quantityDelta ?? ZERO()]));
    const inOf = new Map<string, Decimal>();
    const outOf = new Map<string, Decimal>();
    for (const m of movements) {
      const target = m.quantityDelta.greaterThan(0) ? inOf : outOf;
      target.set(m.stockItemId, (target.get(m.stockItemId) ?? ZERO()).plus(m.quantityDelta.abs()));
    }

    const lowStockItems = items.filter((i) =>
      (balanceOf.get(i.id) ?? ZERO()).lessThanOrEqualTo(i.reorderLevel),
    ).length;
    const count = (statuses: string[]) =>
      requests.filter((r) => statuses.includes(r.status)).reduce((s, r) => s + r._count._all, 0);

    // Summary only (PDF): one record per figure. `isAlert` rows are what the
    // "Alerts only" status filter keeps — they need management attention.
    const rows: {
      section: string;
      metric: string;
      value: number;
      isAmount: boolean;
      isAlert: boolean;
    }[] = [
        {
          section: 'Purchases',
          metric: 'Purchase Orders',
          value: purchases._count._all,
          isAmount: false,
          isAlert: false,
        },
        {
          section: 'Purchases',
          metric: 'Purchase Amount',
          value: Number(purchases._sum.totalAmount ?? 0),
          isAmount: true,
          isAlert: false,
        },
        {
          section: 'Inventory Stock',
          metric: 'Active Stock Items',
          value: items.length,
          isAmount: false,
          isAlert: false,
        },
        {
          section: 'Inventory Stock',
          metric: 'Stock In (Qty)',
          value: Number(sumOf([...inOf.values()], (v) => v)),
          isAmount: false,
          isAlert: false,
        },
        {
          section: 'Inventory Stock',
          metric: 'Stock Out (Qty)',
          value: Number(sumOf([...outOf.values()], (v) => v)),
          isAmount: false,
          isAlert: false,
        },
        {
          section: 'Inventory Stock',
          metric: 'Low Stock Items (at or below reorder level)',
          value: lowStockItems,
          isAmount: false,
          isAlert: true,
        },
        {
          section: 'Inventory Stock',
          metric: 'Batches Near Expiry (60 Days)',
          value: inventoryNearExpiryOnlyCount,
          isAmount: false,
          isAlert: true,
        },
        {
          section: 'Inventory Stock',
          metric: 'Expired Batches',
          value: inventoryExpiredCount,
          isAmount: false,
          isAlert: true,
        },
        {
          section: 'Inventory Stock',
          metric: 'Supplier Payable',
          value: Number(inventorySupplierPayable),
          isAmount: true,
          isAlert: inventorySupplierPayable.greaterThan(0),
        },
        {
          section: 'Medicine Expiry',
          metric: 'Batches Expiring in 60 Days',
          value: expiring,
          isAmount: false,
          isAlert: true,
        },
        {
          section: 'Medicine Expiry',
          metric: 'Expired Batches',
          value: expired,
          isAmount: false,
          isAlert: true,
        },
        {
          section: 'Pharmacy Requests',
          metric: 'Total Requests',
          value: count(requests.map((r) => r.status)),
          isAmount: false,
          isAlert: false,
        },
        {
          section: 'Pharmacy Requests',
          metric: 'Pending (Requested / Authorization / Dispensing)',
          value: count([
            'REQUESTED',
            'ACCEPTED',
            'PARTIALLY_FULFILLED',
            'DISPENSING',
            'AUTHORIZATION_REQUIRED',
          ]),
          isAmount: false,
          isAlert: true,
        },
        {
          section: 'Pharmacy Requests',
          metric: 'Cleared (Dispensed / Invoiced)',
          value: count(['DISPENSED', 'INVOICED', 'CLEARANCE_SENT']),
          isAmount: false,
          isAlert: false,
        },
        {
          section: 'Pharmacy Requests',
          metric: 'Rejected',
          value: count(['REJECTED']),
          isAmount: false,
          isAlert: false,
        },
      ];

    return {
      period: periodOf(start, end, label),
      rows: query.status === 'ALERTS' ? rows.filter((r) => r.isAlert && r.value > 0) : rows,
    };
  },

  /** One source for every dropdown on the 8 management reports. */
  async getFilterOptions() {
    const [departments, doctors, wards, users, panels, staff, categories] = await Promise.all([
      prisma.department.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.staff.findMany({
        where: { isActive: true, category: { equals: 'Doctor', mode: 'insensitive' } },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      }),
      prisma.ward.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.portalUser.findMany({
        select: { id: true, displayName: true, username: true, role: true },
        orderBy: { username: 'asc' },
      }),
      prisma.corporatePanel.findMany({
        where: { isActive: true },
        select: { id: true, organizationName: true },
        orderBy: { organizationName: 'asc' },
      }),
      prisma.staff.findMany({
        where: { isActive: true },
        select: { id: true, fullName: true, employeeId: true },
        orderBy: { fullName: 'asc' },
      }),
      prisma.stockItem.findMany({
        where: { isActive: true, category: { not: null } },
        distinct: ['category'],
        select: { category: true },
        orderBy: { category: 'asc' },
      }),
    ]);
    const roleLabel = (role: string) =>
      role
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      departments: departments.map((d) => ({ value: d.id, label: d.name })),
      doctors: doctors.map((d) => ({ value: d.id, label: d.fullName })),
      wards: wards.map((w) => ({ value: w.id, label: w.name })),
      users: users.map((u) => ({
        value: u.id,
        label: `${u.displayName || u.username} (${roleLabel(u.role)})`,
      })),
      cashiers: users
        .filter((u) => ['FRONT_DESK_BILLING', 'ADMIN', 'SUPER_ADMIN'].includes(u.role))
        .map((u) => ({ value: u.id, label: u.displayName || u.username })),
      // Users who hold cash custody (own a Balance Sheet / Account Settlement).
      cashUsers: users
        .filter((u) => CASH_ROLES.includes(u.role))
        .sort((a, b) => {
          const ROLE_PRIORITY: Record<string, number> = {
            SUPER_ADMIN: 1,
            ADMIN: 2,
            FRONT_DESK_BILLING: 3,
            INVENTORY_MANAGEMENT: 4,
            PHARMACY_SALES_DISPENSING: 5,
          };
          const pA = ROLE_PRIORITY[a.role] ?? 99;
          const pB = ROLE_PRIORITY[b.role] ?? 99;
          if (pA !== pB) return pA - pB;
          return (a.displayName || a.username).localeCompare(b.displayName || b.username);
        })
        .map((u) => ({
          value: u.id,
          label: `${u.displayName || u.username} (${roleLabel(u.role)})`,
        })),
      panels: panels.map((p) => ({ value: p.id, label: p.organizationName })),
      staff: staff.map((s) => ({ value: s.id, label: `${s.fullName} (${s.employeeId})` })),
      stockCategories: categories.map((c) => ({ value: c.category!, label: c.category! })),
    };
  },
  /** M04 Operating Profit (P&L) — Revenue - Direct Cost - Gross Profit - Payroll - Commission - Opex. */
  async getOperatingProfit(query: ManagementSummaryQuery) {
    const summaryData = await this.getSummary(query);
    const { summary, period, rows } = summaryData;

    return {
      period,
      summary: {
        revenue: summary.netEarnedRevenue,
        grossBilling: summary.grossBilling,
        discounts: summary.discounts,
        directCost: summary.directServiceCosts,
        grossProfit: summary.grossProfit,
        payroll: summary.payrollCost,
        doctorCommission: summary.doctorCommissionCost,
        otherOperatingExpenses: summary.otherOperatingExpenses,
        totalCosts: summary.totalOperatingCosts,
        operatingProfit: summary.operatingProfit,
        marginPercentage: summary.operatingMargin,
        collections: summary.collections,
        outstanding: summary.outstanding,
        hasIncompleteCost: summary.hasIncompleteCost,
        missingCostCount: summary.missingCostCount,
      },
      rows: rows.map((r) => ({
        department: r.department,
        invoices: r.invoices,
        gross: r.gross,
        discount: r.discount,
        revenue: r.net,
        collected: r.collected,
        outstanding: r.outstanding,
      })),
    };
  },

  /** M04 Operating Profit Statement & Detailed Ledger — Complete Professional Financial Statement */
  async getOperatingProfitStatement(query: OperatingProfitQuery) {
    const range = resolveExtendedDateRange(query);
    return buildOperatingStatement(query, range, (q) => this.getIncomeExpenseLedger(q));
  },

  /** M03 Detailed Expense — Itemized hospital expenses, consumables, payroll, and commissions. */
  async getDetailedExpenses(query: ManagementSummaryQuery) {
    const { start, end, label } = resolveDateRange(query);
    const dept = query.departmentId;

    const [
      hospitalExpenseRows,
      deptRequisitions,
      salarySlips,
      commissionAccruals,
      inventoryExpenseRows,
    ] = await Promise.all([
      prisma.expense.findMany({
        where: {
          status: 'ACTIVE',
          pharmacySettlementRelease: { is: null },
          expenseDate: {
            gte: new Date(start.toLocaleDateString('en-CA')),
            lte: new Date(end.toLocaleDateString('en-CA')),
          },
          ...(dept ? { departmentId: dept } : {}),
        },
        include: {
          department: { select: { id: true, name: true } },
          createdByUser: { select: { id: true, displayName: true, username: true, role: true } },
        },
        orderBy: { expenseDate: 'desc' },
      }),
      prisma.departmentRequisition.findMany({
        where: {
          issuedAt: { gte: start, lte: end },
          status: { in: ['ISSUED', 'PARTIALLY_RETURNED', 'CLOSED'] },
          ...(dept ? { departmentId: dept } : {}),
        },
        include: {
          department: { select: { id: true, name: true } },
          issuedBy: { select: { id: true, displayName: true, username: true, role: true } },
          lines: {
            include: {
              stockItem: { select: { id: true, name: true, code: true, unit: true } },
            },
          },
        },
        orderBy: { issuedAt: 'desc' },
      }),
      prisma.salarySlip.findMany({
        where: {
          approvedAt: { gte: start, lte: end },
          status: { in: ['APPROVED', 'PARTIALLY_PAID', 'PAID'] },
          ...(dept
            ? {
              OR: [
                { payrollRun: { departmentId: dept } },
                { staff: { staffDepartments: { some: { departmentId: dept } } } },
              ],
            }
            : {}),
        },
        include: {
          staff: {
            select: {
              id: true,
              fullName: true,
              employeeId: true,
              department: { select: { id: true, name: true } },
            },
          },
          payrollRun: { include: { department: { select: { id: true, name: true } } } },
          payments: { where: { paidAt: { lte: end } } },
          correctionEntries: { where: { createdAt: { lte: end } } },
        },
        orderBy: { approvedAt: 'desc' },
      }),
      prisma.doctorCommissionAccrual.findMany({
        where: {
          OR: [
            { collectionEventId: { not: null }, collectionEvent: { occurredAt: { gte: start, lte: end } } },
            { collectionEventId: null, approvedAt: { gte: start, lte: end }, status: { in: ['APPROVED', 'PARTIALLY_PAID', 'PAID'] } },
          ],
          ...(dept ? { invoiceLineItem: commissionDepartmentFilter(dept) } : {}),
        },
        include: {
          doctor: {
            select: {
              id: true,
              fullName: true,
              employeeId: true,
              staffDepartments: { select: { department: { select: { id: true, name: true } } }, take: 1 },
            },
          },
          collectionEvent: true,
          payouts: { where: { paidAt: { lte: end } } },
          reversals: { where: { reversedAt: { lte: end } } },
          adjustments: { where: { createdAt: { lte: end } } },
          approvedByUser: { select: { id: true, displayName: true, username: true, role: true } },
          commissionRun: true,
          invoiceLineItem: {
            include: {
              serviceRate: { include: { department: { select: { id: true, name: true } } } },
              hospitalInvoice: {
                include: {
                  department: { select: { id: true, name: true } },
                  paymentReceipts: {
                    where: { isReversed: false },
                    include: { collectedBy: { select: { id: true, displayName: true, username: true } } },
                    take: 1,
                    orderBy: { collectedAt: 'desc' },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.inventoryExpense.findMany({
        where: {
          expenseDate: {
            gte: new Date(start.toLocaleDateString('en-CA')),
            lte: new Date(end.toLocaleDateString('en-CA')),
          },
          ...(dept ? { id: { in: [] } } : {}),
        },
        include: {
          createdByUser: { select: { id: true, displayName: true, username: true, role: true } },
        },
        orderBy: { expenseDate: 'desc' },
      }),
    ]);

    const items: Array<{
      id: string;
      date: string;
      source: string;
      category: string;
      voucherRef: string;
      department: string;
      description: string;
      amount: Decimal;
      paidAmount: Decimal;
      outstandingAmount: Decimal;
      costStatus?: 'COMPLETE' | 'INCOMPLETE';
      enteredBy: string;
    }> = [];

    let totalHospitalExpenses = ZERO();
    for (const h of hospitalExpenseRows) {
      totalHospitalExpenses = totalHospitalExpenses.plus(h.amount);
      items.push({
        id: `hosp-${h.id}`,
        date: h.expenseDate.toISOString().slice(0, 10),
        source: 'Hospital Voucher',
        category: h.category,
        voucherRef: h.expenseNumber,
        department: h.department?.name ?? 'Hospital-Wide',
        description: [h.paidTo, h.description].filter(Boolean).join(' — ') || 'Operating Expense',
        amount: h.amount,
        paidAmount: h.amount,
        outstandingAmount: ZERO(),
        costStatus: 'COMPLETE',
        enteredBy: userName(h.createdByUser) || 'System',
      });
    }

    let totalDirectConsumables = ZERO();
    let hasIncompleteCost = false;
    let missingCostCount = 0;

    for (const r of deptRequisitions) {
      for (const l of r.lines) {
        const netQty = l.quantity.minus(l.returnedQuantity);
        if (netQty.greaterThan(0)) {
          const isMissingCost = l.costRate === null || l.costRate === undefined || l.costRate.isZero();
          if (isMissingCost) {
            hasIncompleteCost = true;
            missingCostCount++;
          }
          const cost = netQty.times(l.costRate ?? ZERO());
          totalDirectConsumables = totalDirectConsumables.plus(cost);
          items.push({
            id: `req-${l.id}`,
            date: r.issuedAt.toISOString().slice(0, 10),
            source: 'Inventory Consumption',
            category: 'Clinical Consumables',
            voucherRef: `REQ-${r.id.slice(0, 8).toUpperCase()}`,
            department: r.department?.name ?? 'Clinical Department',
            description: isMissingCost
              ? `${l.stockItem.name} (${netQty.toString()} ${l.stockItem.unit}) [INCOMPLETE COST RATE]`
              : `${l.stockItem.name} (${netQty.toString()} ${l.stockItem.unit})`,
            amount: cost,
            paidAmount: ZERO(),
            outstandingAmount: ZERO(),
            costStatus: isMissingCost ? 'INCOMPLETE' : 'COMPLETE',
            enteredBy: userName(r.issuedBy) || 'System',
          });
        }
      }
    }

    let totalPayroll = ZERO();
    for (const s of salarySlips) {
      const balance = salaryBalance(s);
      const before = (s.approvedAt ?? s.createdAt) < start
        ? salaryBalance({ ...s, correctionEntries: s.correctionEntries.filter((a) => a.createdAt < start) }).payable
        : ZERO();
      const recognized = balance.payable.minus(before);
      if (recognized.greaterThan(0)) {
        totalPayroll = totalPayroll.plus(recognized);
        items.push({
          id: `sal-${s.id}`,
          date: (s.approvedAt ?? s.createdAt).toISOString().slice(0, 10),
          source: 'Staff Payroll',
          category: 'Salaries & Wages',
          voucherRef: `SLIP-${s.id.slice(0, 8).toUpperCase()}`,
          department: s.payrollRun?.department?.name ?? s.staff.department?.name ?? 'Hospital Staff',
          description: `Salary: ${s.staff.fullName} (${s.staff.employeeId})`,
          amount: recognized,
          paidAmount: balance.paid,
          outstandingAmount: balance.remaining,
          enteredBy: 'Payroll System',
        });
      }
    }

    let totalCommission = ZERO();
    let totalCommissionPaid = ZERO();
    let totalCommissionOutstanding = ZERO();
    for (const c of commissionAccruals) {
      const balance = commissionBalance(c);
      const before = (c.collectionEvent?.occurredAt ?? c.approvedAt ?? c.createdAt) < start
        ? commissionBalance({ ...c, reversals: c.reversals.filter((r) => r.reversedAt < start), adjustments: c.adjustments.filter((a) => a.createdAt < start) }).payable
        : ZERO();
      const recognized = balance.payable.minus(before);
      if (recognized.greaterThan(0)) {
        totalCommission = totalCommission.plus(recognized);
        totalCommissionPaid = totalCommissionPaid.plus(balance.paid);
        totalCommissionOutstanding = totalCommissionOutstanding.plus(balance.remaining);

        const deptName =
          c.invoiceLineItem?.serviceRate?.department?.name ??
          c.invoiceLineItem?.hospitalInvoice?.department?.name ??
          c.doctor?.staffDepartments?.[0]?.department?.name ??
          'Unassigned';

        const collectorUser = c.invoiceLineItem?.hospitalInvoice?.paymentReceipts?.[0]?.collectedBy;
        const collectorName = userName(collectorUser);
        const approverName = userName(c.approvedByUser);
        const enteredBy = collectorName || approverName || 'System (Generated)';

        items.push({
          id: `comm-${c.id}`,
          date: (c.collectionEvent?.occurredAt ?? c.approvedAt ?? c.createdAt).toISOString().slice(0, 10),
          source: 'Doctor Commission',
          category: 'Doctor Commissions',
          voucherRef: `COMM-${c.id.slice(0, 8).toUpperCase()}`,
          department: deptName,
          description: `Commission: Dr. ${c.doctor.fullName} (${c.doctor.employeeId})`,
          amount: recognized,
          paidAmount: balance.paid,
          outstandingAmount: balance.remaining,
          enteredBy,
        });
      }
    }

    let totalInventoryOpex = ZERO();
    for (const ie of inventoryExpenseRows) {
      totalInventoryOpex = totalInventoryOpex.plus(ie.amount);
      items.push({
        id: `inve-${ie.id}`,
        date: ie.expenseDate.toISOString().slice(0, 10),
        source: 'Inventory Opex',
        category: ie.category,
        voucherRef: ie.reference || `INV-EXP-${ie.id.slice(0, 8).toUpperCase()}`,
        department: 'Inventory / Stores',
        description: ie.description ?? 'Store Operating Expense',
        amount: ie.amount,
        paidAmount: ie.amount,
        outstandingAmount: ZERO(),
        enteredBy: userName(ie.createdByUser) || 'System',
      });
    }

    const totalOperatingCosts = totalHospitalExpenses
      .plus(totalDirectConsumables)
      .plus(totalPayroll)
      .plus(totalCommission)
      .plus(totalInventoryOpex);

    return {
      period: periodOf(start, end, label),
      summary: {
        totalOperatingCosts,
        totalHospitalExpenses,
        totalDirectConsumables,
        totalPayroll,
        totalCommission,
        totalCommissionPaid,
        totalCommissionOutstanding,
        totalInventoryOpex,
        rowCount: items.length,
        hasIncompleteCost,
        missingCostCount,
      },
      rows: items,
    };
  },

  /** M01 — Detailed Transaction-wise Income & Expense Ledger with Full Dataset Reconciled Totals */
  async getIncomeExpenseLedger(query: IncomeExpenseLedgerQuery) {
    const { start, end, label } = resolveExtendedDateRange(query);
    const dept = query.departmentId;
    const user = query.portalUserId;
    const method = query.method;
    const status = query.status;
    const transactionType = query.transactionType;
    const portal = query.portal;
    const search = query.search?.trim().toLowerCase();
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(500, Number(query.limit) || 25));

    // Parallel fetch of all source event records and full financial summary
    const [
      invoices,
      receipts,
      hospitalExpenseRows,
      inventoryExpenseRows,
      salarySlips,
      commissionAccruals,
      requisitions,
      settlements,
      summaryData,
      pharmacyReleases,
    ] = await Promise.all([
      // 1. Hospital Invoices (Earned Revenue)
      prisma.hospitalInvoice.findMany({
        where: {
          createdAt: { lte: end },
          status: { not: 'VOID' },
        },
        include: {
          doctor: { select: { fullName: true } },
          appointment: { select: { department: { select: financialDepartmentSelect } } },
          paymentReceipts: { where: { ...signedReceiptWhere, collectedAt: { lte: end } }, include: { collectedBy: userSelect } },
          panelRemittanceAllocations: { where: { panelRemittance: { receivedAt: { lte: end } } }, include: { panelRemittance: { include: { receivedByUser: userSelect } } } },
          department: { select: financialDepartmentSelect },
          createdByUser: { select: { id: true, displayName: true, username: true, role: true } },
          selfPayEncounter: { select: { id: true, mrNumber: true, fullName: true } },
          panelPatient: { select: { id: true, fullName: true, corporatePanel: { select: { organizationName: true } } } },
          admissionRecord: {
            select: {
              id: true,
              admissionNumber: true,
              selfPayEncounter: { select: { fullName: true } },
              panelPatient: { select: { fullName: true } },
              department: { select: financialDepartmentSelect },
            },
          },
          lines: {
            include: {
              serviceRate: { select: { id: true, name: true, providerType: true, department: { select: financialDepartmentSelect } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),

      // 2. Patient / Panel Collections & Refunds
      prisma.paymentReceipt.findMany({
        where: {
          hospitalInvoiceId: null,
          AND: [signedReceiptWhere],
          collectedAt: { gte: start, lte: end },
          ...(dept
            ? {
              OR: [
                { hospitalInvoice: { departmentId: dept } },
                { hospitalInvoice: { lines: { some: { serviceRate: { departmentId: dept } } } } },
                { hospitalInvoiceId: null, admissionRecord: { departmentId: dept } },
                { hospitalInvoiceId: null, appointment: { departmentId: dept } },
              ],
            }
            : {}),
        },
        include: {
          appointment: { select: { department: { select: { id: true, name: true } } } },
          collectedBy: { select: { id: true, displayName: true, username: true, role: true } },
          hospitalInvoice: {
            select: {
              id: true,
              invoiceNumber: true,
              department: { select: { id: true, name: true } },
              selfPayEncounter: { select: { fullName: true } },
              panelPatient: { select: { fullName: true } },
              admissionRecord: {
                select: {
                  admissionNumber: true,
                  selfPayEncounter: { select: { fullName: true } },
                  panelPatient: { select: { fullName: true } },
                },
              },
            },
          },
          admissionRecord: {
            select: {
              id: true,
              admissionNumber: true,
              department: { select: { id: true, name: true } },
              selfPayEncounter: { select: { fullName: true } },
              panelPatient: { select: { fullName: true } },
            },
          },
        },
        orderBy: { collectedAt: 'desc' },
      }),

      // 3. Hospital Operating Expenses
      prisma.expense.findMany({
        where: {
          status: 'ACTIVE',
          pharmacySettlementRelease: { is: null },
          expenseDate: {
            gte: new Date(hospitalClock(start).date),
            lte: new Date(hospitalClock(end).date),
          },
          ...(dept ? { departmentId: dept } : {}),
        },
        include: {
          department: { select: { id: true, name: true } },
          createdByUser: { select: { id: true, displayName: true, username: true, role: true } },
        },
        orderBy: { expenseDate: 'desc' },
      }),

      // 4. Inventory Operating Expenses
      prisma.inventoryExpense.findMany({
        where: {
          expenseDate: {
            gte: new Date(hospitalClock(start).date),
            lte: new Date(hospitalClock(end).date),
          },
          ...(dept ? { id: { in: [] } } : {}),
        },
        include: {
          createdByUser: { select: { id: true, displayName: true, username: true, role: true } },
        },
        orderBy: { expenseDate: 'desc' },
      }),

      // 5. Staff Payroll Slips
      prisma.salarySlip.findMany({
        where: {
          OR: [{ approvedAt: { gte: start, lte: end } }, { payments: { some: { paidAt: { gte: start, lte: end } } } }],
          status: { in: ['APPROVED', 'PARTIALLY_PAID', 'PAID'] },
          ...(dept
            ? {
              OR: [
                { payrollRun: { departmentId: dept } },
                { staff: { staffDepartments: { some: { departmentId: dept } } } },
              ],
            }
            : {}),
        },
        include: {
          staff: {
            select: {
              id: true,
              fullName: true,
              employeeId: true,
              department: { select: { id: true, name: true } },
            },
          },
          payrollRun: true,
          approvedByUser: userSelect,
          correctionEntries: { where: { createdAt: { lte: end } } },
          payments: { where: { paidAt: { lte: end } } },
        },
        orderBy: { approvedAt: 'desc' },
      }),

      // 6. Doctor Commissions
      prisma.doctorCommissionAccrual.findMany({
        where: {
          OR: [
            { payouts: { some: { paidAt: { gte: start, lte: end } } } },
            { collectionEventId: { not: null }, collectionEvent: { occurredAt: { gte: start, lte: end } } },
            { collectionEventId: null, approvedAt: { gte: start, lte: end }, status: { in: ['APPROVED', 'PARTIALLY_PAID', 'PAID'] } },
          ],
          ...(dept ? { invoiceLineItem: commissionDepartmentFilter(dept) } : {}),
        },
        include: {
          doctor: {
            select: {
              id: true,
              fullName: true,
              employeeId: true,
              staffDepartments: { select: { department: { select: { id: true, name: true } } }, take: 1 },
            },
          },
          collectionEvent: true,
          reversals: { where: { reversedAt: { lte: end } } },
          adjustments: { where: { createdAt: { lte: end } } },
          payouts: { where: { paidAt: { lte: end } } },
          approvedByUser: { select: { id: true, displayName: true, username: true, role: true } },
          invoiceLineItem: {
            include: {
              serviceRate: { include: { department: { select: { id: true, name: true } } } },
              hospitalInvoice: {
                include: {
                  department: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),

      // 7. Clinical Consumable Stock Issues
      prisma.departmentRequisition.findMany({
        where: {
          issuedAt: { gte: start, lte: end },
          status: { in: ['ISSUED', 'PARTIALLY_RETURNED', 'CLOSED'] },
          ...(dept ? { departmentId: dept } : {}),
        },
        include: {
          department: { select: { id: true, name: true, departmentType: true } },
          issuedBy: { select: { id: true, displayName: true, username: true, role: true } },
          lines: {
            include: {
              stockItem: { select: { id: true, name: true, code: true, unit: true } },
            },
          },
        },
        orderBy: { issuedAt: 'desc' },
      }),

      // 8. Internal Cash Settlements
      prisma.accountSettlement.findMany({
        where: {
          submittedAt: { gte: start, lte: end },
          ...(user ? { OR: [{ portalUserId: user }, { receiverUserId: user }] } : {}),
        },
        include: {
          submittedByUser: { select: { id: true, displayName: true, username: true, role: true } },
          receiverUser: { select: { id: true, displayName: true, username: true, role: true } },
        },
        orderBy: { submittedAt: 'desc' },
      }),

      // 9. Accrual Executive Summary
      this.getSummary({ ...query, portalUserId: undefined, method: undefined } as any, { start, end, label }),
      prisma.hmsPharmacySettlementRelease.findMany({
        where: { releasedAt: { gte: start, lte: end },
          ...(dept ? { settlement: { pharmacyCharge: { admissionRecord: { departmentId: dept } } } } : {}) },
        include: { releasedByUser: { select: { id: true, displayName: true, username: true, role: true } },
          settlement: { select: { settlementNumber: true, pharmacyInvoiceNumber: true,
            pharmacyCharge: { select: { admissionRecord: { select: { department: { select: { id: true, name: true } } } } } } } } },
      }),
    ]);

    const allItems: Array<{
      id: string;
      date: string;
      reference: string;
      transactionType: 'REVENUE' | 'COLLECTION' | 'EXPENSE' | 'CONSUMABLE' | 'PAYROLL' | 'COMMISSION' | 'REFUND' | 'SETTLEMENT';
      typeLabel: string;
      patientPayeeDescription: string;
      encounterInvoiceRef: string;
      departmentId?: string;
      department: string;
      portalUserId?: string;
      portalUser: string;
      portal: string;
      status: string;
      statusLabel: string;
      grossBilling: number;
      discountCredit: number;
      tax: number;
      netRevenue: number;
      collectionsReceived: number;
      recognizedExpense: number;
      expensePaid: number;
      cashIn: number;
      cashOut: number;
      outstandingPayable: number;
      paymentMethod: string;
      details?: Record<string, any>;
    }> = [];

    // Stable invoice projection before filtering, counting and pagination.
    const financialInvoices = invoices.map(inv => projectM01Invoice(inv, start, end, { departmentId: dept }));
    const invoiceProjections = invoices.map(inv => projectM01Invoice(inv, start, end, query));
    for (const projection of invoiceProjections) {
      if (projection.row && (projection.row.transactionType === 'REVENUE' || !projection.collectionRows.length)) allItems.push(projection.row);
      allItems.push(...projection.collectionRows);
    }

    // Map Receipts (Collections & Refunds)
    for (const rec of receipts) {
      const isRefund = rec.amount.lessThan(0);
      const absAmount = Math.abs(Number(rec.amount));
      const pName =
        rec.hospitalInvoice?.selfPayEncounter?.fullName ||
        rec.hospitalInvoice?.panelPatient?.fullName ||
        rec.hospitalInvoice?.admissionRecord?.selfPayEncounter?.fullName ||
        rec.hospitalInvoice?.admissionRecord?.panelPatient?.fullName ||
        rec.admissionRecord?.selfPayEncounter?.fullName ||
        rec.admissionRecord?.panelPatient?.fullName ||
        'Patient Receipt';
      const receiptDepartment = rec.hospitalInvoice?.department ?? rec.admissionRecord?.department ?? rec.appointment?.department;
      const dName = receiptDepartment?.name || 'Unassigned';
      const isCash = rec.method === 'CASH';

      if (isRefund) {
        allItems.push({
          id: `ref-${rec.id}`,
          date: rec.collectedAt.toISOString(),
          reference: rec.receiptNumber,
          transactionType: 'REFUND',
          typeLabel: 'Refund / Reversal',
          patientPayeeDescription: `${pName} (Refund / Credit)`,
          encounterInvoiceRef: rec.hospitalInvoice?.invoiceNumber || rec.admissionRecord?.admissionNumber || '—',
          departmentId: receiptDepartment?.id,
          department: dName,
          portalUserId: rec.collectedById,
          portalUser: userName(rec.collectedBy) || 'Cashier',
          portal: 'Front Desk / Billing',
          status: 'REVERSED',
          statusLabel: 'Refund / Reversed',
          grossBilling: 0,
          discountCredit: 0,
          tax: 0,
          netRevenue: 0,
          collectionsReceived: -absAmount,
          recognizedExpense: 0,
          expensePaid: 0,
          cashIn: 0,
          cashOut: isCash ? absAmount : 0,
          outstandingPayable: 0,
          paymentMethod: rec.method,
        });
      } else {
        allItems.push({
          id: `rec-${rec.id}`,
          date: rec.collectedAt.toISOString(),
          reference: rec.receiptNumber,
          transactionType: 'COLLECTION',
          typeLabel: 'Unapplied Advance Receipt',
          patientPayeeDescription: pName,
          encounterInvoiceRef: rec.hospitalInvoice?.invoiceNumber || rec.admissionRecord?.admissionNumber || '—',
          departmentId: receiptDepartment?.id,
          department: dName,
          portalUserId: rec.collectedById,
          portalUser: userName(rec.collectedBy) || 'Cashier',
          portal: 'Front Desk / Billing',
          status: 'COMPLETED',
          statusLabel: 'Completed',
          grossBilling: 0,
          discountCredit: 0,
          tax: 0,
          netRevenue: 0,
          collectionsReceived: absAmount,
          recognizedExpense: 0,
          expensePaid: 0,
          cashIn: isCash ? absAmount : 0,
          cashOut: 0,
          outstandingPayable: 0,
          paymentMethod: rec.method,
        });
      }
    }

    // Map Hospital Expenses
    for (const exp of hospitalExpenseRows) {
      const amt = Number(exp.amount);
      const isCash = !exp.paymentMethod || exp.paymentMethod === 'CASH';
      allItems.push({
        id: `exp-${exp.id}`,
        date: exp.expenseDate.toISOString(),
        reference: exp.expenseNumber,
        transactionType: 'EXPENSE',
        typeLabel: 'Operating Expense',
        patientPayeeDescription: [exp.paidTo, exp.description, exp.category].filter(Boolean).join(' — ') || 'Hospital Expense',
        encounterInvoiceRef: exp.reference || exp.expenseNumber,
        departmentId: exp.departmentId ?? undefined,
        department: exp.department?.name || 'Unassigned',
        portalUserId: exp.createdById ?? undefined,
        portalUser: userName(exp.createdByUser) || 'Administrator',
        portal: 'Admin',
        status: exp.status,
        statusLabel: 'Posted / Approved',
        grossBilling: 0,
        discountCredit: 0,
        tax: 0,
        netRevenue: 0,
        collectionsReceived: 0,
        recognizedExpense: amt,
        expensePaid: amt,
        cashIn: 0,
        cashOut: isCash ? amt : 0,
        outstandingPayable: 0,
        paymentMethod: exp.paymentMethod || 'Cash',
      });
    }

    // Map Inventory Expenses
    for (const ie of inventoryExpenseRows) {
      const amt = Number(ie.amount);
      const isCash = !ie.paymentMethod || ie.paymentMethod === 'CASH';
      allItems.push({
        id: `iexp-${ie.id}`,
        date: ie.expenseDate.toISOString(),
        reference: ie.reference || `IE-${ie.id.slice(0, 8).toUpperCase()}`,
        transactionType: 'EXPENSE',
        typeLabel: 'Store Expense',
        patientPayeeDescription: [ie.payee, ie.description, ie.category].filter(Boolean).join(' — ') || 'Store Expense',
        encounterInvoiceRef: ie.reference || '—',
        department: 'Unassigned',
        portalUserId: ie.createdById,
        portalUser: userName(ie.createdByUser) || 'Inventory Manager',
        portal: 'Inventory Management',
        status: 'POSTED',
        statusLabel: 'Posted',
        grossBilling: 0,
        discountCredit: 0,
        tax: 0,
        netRevenue: 0,
        collectionsReceived: 0,
        recognizedExpense: amt,
        expensePaid: amt,
        cashIn: 0,
        cashOut: isCash ? amt : 0,
        outstandingPayable: 0,
        paymentMethod: ie.paymentMethod || 'Cash',
      });
    }

    // Map Staff Payroll Slips
    for (const sal of salarySlips) {
      const payable = Number(salaryBalance(sal).payable);
      const allPaid = sal.payments?.reduce((s, p) => s + Number(p.amount), 0) || 0;
      const periodPayments = sal.payments.filter(p => p.paidAt >= start);
      const paid = periodPayments.reduce((s, p) => s + Number(p.amount), 0);
      const remaining = Math.max(0, payable - allPaid);
      const cashPayments = periodPayments.filter((p) => p.method === 'CASH').reduce((s, p) => s + Number(p.amount), 0) || 0;
      const methodLabel = sal.payments?.[0]?.method || 'Bank / Online';

      allItems.push({
        id: `sal-${sal.id}`,
        date: (sal.approvedAt || sal.createdAt).toISOString(),
        reference: `${sal.periodStart.toISOString().slice(0, 7)} Payroll`,
        transactionType: 'PAYROLL',
        typeLabel: 'Staff Payroll',
        patientPayeeDescription: `${sal.staff.fullName} (${sal.staff.employeeId})`,
        encounterInvoiceRef: sal.payrollRunId || '—',
        department: sal.staff.department?.name || 'Unassigned',
        portalUserId: sal.approvedById ?? undefined,
        portalUser: userName(sal.approvedByUser) || 'Unassigned',
        portal: 'Admin',
        status: sal.status,
        statusLabel: sal.status.replace(/_/g, ' '),
        grossBilling: 0,
        discountCredit: 0,
        tax: 0,
        netRevenue: 0,
        collectionsReceived: 0,
        recognizedExpense: sal.approvedAt && sal.approvedAt >= start ? payable : 0,
        expensePaid: paid,
        cashIn: 0,
        cashOut: cashPayments,
        outstandingPayable: remaining,
        paymentMethod: methodLabel,
        details: { actorIds: sal.payments.map(p => p.paidById), approvedAt: sal.approvedAt?.toISOString(), approvedBy: userName(sal.approvedByUser),
          history: sal.payments.map(p => ({ reference: p.reference || p.id, date: p.paidAt.toISOString(), method: p.method, amount: Number(p.amount), actor: p.paidById })),
          adjustments: sal.correctionEntries },
      });
    }

    // Map Doctor Commissions
    for (const com of commissionAccruals) {
      const balance = commissionBalance({ ...com, reversals: com.reversals ?? [] });
      const amt = Number(balance.payable);
      const periodPayouts = com.payouts?.filter((p) => p.paidAt >= start && p.paidAt <= end) || [];
      const paid = periodPayouts.reduce((s, p) => s + Number(p.amount), 0);
      const cashPayouts = periodPayouts.filter((p) => p.method === 'CASH').reduce((s, p) => s + Number(p.amount), 0);
      const totalPaidEver = com.payouts?.reduce((s, p) => s + Number(p.amount), 0) || 0;
      const outstanding = Math.max(0, amt - totalPaidEver);
      const invRef = com.invoiceLineItem?.hospitalInvoice?.invoiceNumber || '—';
      const dName =
        com.invoiceLineItem?.serviceRate?.department?.name ||
        com.doctor.staffDepartments?.[0]?.department?.name ||
        'Unassigned';
      const payoutMethods = unique(periodPayouts.map((p) => p.method));
      const methodLabel = payoutMethods.length > 0 ? payoutMethods.join(', ') : 'Accrued (N/A)';

      allItems.push({
        id: `com-${com.id}`,
        date: (com.collectionEvent?.occurredAt || com.approvedAt || com.createdAt).toISOString(),
        reference: `COM-${com.id.slice(0, 8).toUpperCase()}`,
        transactionType: 'COMMISSION',
        typeLabel: 'Doctor Commission',
        patientPayeeDescription: `Dr. ${com.doctor.fullName} (${com.doctor.employeeId})`,
        encounterInvoiceRef: invRef,
        department: dName,
        portalUserId: com.approvedById ?? undefined,
        portalUser: userName(com.approvedByUser) || 'Finance Control',
        portal: 'Super Admin',
        status: com.status,
        statusLabel: com.status.replace(/_/g, ' '),
        grossBilling: 0,
        discountCredit: 0,
        tax: 0,
        netRevenue: 0,
        collectionsReceived: 0,
        recognizedExpense: (com.collectionEvent?.occurredAt || com.approvedAt || com.createdAt) >= start ? amt : 0,
        expensePaid: paid,
        cashIn: 0,
        cashOut: cashPayouts,
        outstandingPayable: outstanding,
        paymentMethod: methodLabel,
        details: { actorIds: com.payouts.map(p => p.paidById), approvedAt: com.approvedAt?.toISOString(), approvedBy: userName(com.approvedByUser),
          history: com.payouts.map(p => ({ reference: p.reference || p.id, date: p.paidAt.toISOString(), method: p.method, amount: Number(p.amount), actor: p.paidById })),
          adjustments: com.adjustments, reversals: com.reversals },
      });
    }

    // Map Direct Consumable Stock Issues (Clinical)
    for (const req of requisitions) {
      const deptType = req.department?.departmentType;
      const isDirect = !deptType || ['CLINICAL', 'SURGICAL', 'DIAGNOSTIC', 'EMERGENCY'].includes(deptType);
      if (!isDirect) continue;

      let cost = 0;
      for (const line of req.lines || []) {
        const netQty = Number(line.quantity) - Number(line.returnedQuantity);
        if (netQty > 0) {
          cost += netQty * Number(line.costRate || 0);
        }
      }

      allItems.push({
        id: `req-${req.id}`,
        date: req.issuedAt.toISOString(),
        reference: `REQ-${req.id.slice(0, 8).toUpperCase()}`,
        transactionType: 'CONSUMABLE',
        typeLabel: 'Direct Consumable Cost',
        patientPayeeDescription: `Consumable Stock Issue to ${req.department?.name || 'Department'}`,
        encounterInvoiceRef: `REQ-${req.id.slice(0, 8).toUpperCase()}`,
        departmentId: req.departmentId,
        department: req.department?.name || 'Store',
        portalUserId: req.issuedById,
        portalUser: userName(req.issuedBy) || 'Inventory Manager',
        portal: 'Inventory Management',
        status: req.status,
        statusLabel: req.status.replace(/_/g, ' '),
        grossBilling: 0,
        discountCredit: 0,
        tax: 0,
        netRevenue: 0,
        collectionsReceived: 0,
        recognizedExpense: cost,
        expensePaid: 0,
        cashIn: 0,
        cashOut: 0,
        outstandingPayable: 0,
        paymentMethod: 'N/A',
      });
    }

    // Map Internal Cash Settlements
    for (const st of settlements) {
      const acceptedAmt = Number(st.handoverAmount || st.physicalCash || 0);
      const isAccepted = st.status === 'ACCEPTED';
      const senderName = userName(st.submittedByUser) || 'Cashier';
      const receiverName = userName(st.receiverUser) || 'Administrator';

      // Internal custody settlements net to zero at the hospital-wide level.
      // When filtered by a specific user drawer:
      // - Sender: cashOut = acceptedAmt (custody handed over out of drawer)
      // - Receiver: cashIn = acceptedAmt (custody received into drawer)
      let stCashIn = 0;
      let stCashOut = 0;
      if (isAccepted && user) {
        if (st.portalUserId === user) {
          stCashOut = acceptedAmt;
        } else if (st.receiverUserId === user) {
          stCashIn = acceptedAmt;
        }
      }

      allItems.push({
        id: `set-${st.id}`,
        date: (st.submittedAt || st.createdAt).toISOString(),
        reference: `SET-${st.id.slice(0, 8).toUpperCase()}`,
        transactionType: 'SETTLEMENT',
        typeLabel: 'Internal Custody Transfer',
        patientPayeeDescription: `Cash Settlement Handover: ${senderName} → ${receiverName}`,
        encounterInvoiceRef: '—',
        department: 'Unassigned',
        portalUserId: st.portalUserId,
        portalUser: senderName,
        portal: 'Front Desk / Billing',
        status: st.status,
        statusLabel: st.status.replace(/_/g, ' '),
        grossBilling: 0,
        discountCredit: 0,
        tax: 0,
        netRevenue: 0,
        collectionsReceived: 0,
        recognizedExpense: 0,
        expensePaid: 0,
        cashIn: stCashIn,
        cashOut: stCashOut,
        outstandingPayable: 0,
        paymentMethod: 'Cash',
        details: {
          handoverAmount: acceptedAmt,
          sender: senderName,
          receiver: receiverName,
          senderUserId: st.portalUserId,
          receiverUserId: st.receiverUserId,
        },
      });
    }

    // Sort chronologically (most recent first)
    for (const release of pharmacyReleases) {
      const department = release.settlement.pharmacyCharge.admissionRecord.department;
      allItems.push({
        id: 'pharmacy-release-' + release.id, date: release.releasedAt.toISOString(), reference: release.id,
        transactionType: 'SETTLEMENT', typeLabel: 'Pharmacy Settlement',
        patientPayeeDescription: 'Pharmacy settlement ' + release.settlement.settlementNumber + ' / PKR ' + release.amount.toFixed(2),
        encounterInvoiceRef: release.settlement.pharmacyInvoiceNumber,
        departmentId: department.id, department: department.name,
        portalUserId: release.releasedById, portalUser: userName(release.releasedByUser) || 'Admin',
        portal: release.releasedByUser.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin',
        status: 'SETTLED', statusLabel: 'Paid',
        grossBilling: 0, discountCredit: 0, tax: 0, netRevenue: 0, collectionsReceived: 0,
        recognizedExpense: 0, expensePaid: 0, cashIn: 0,
        cashOut: release.paymentMethod === 'CASH' ? Number(release.amount) : 0,
        outstandingPayable: 0, paymentMethod: release.paymentMethod,
        details: { pharmacySettlementOutflow: Number(release.amount), paymentReference: release.paymentReference,
          cashEntryId: release.cashEntryId, bridgeStatus: release.bridgeStatus, legacyExpenseId: release.legacyExpenseId },
      });
    }

    allItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      || Number(Boolean(b.details?.isCollectionEvent)) - Number(Boolean(a.details?.isCollectionEvent))
      || a.id.localeCompare(b.id));

    // Apply Filters
    const filteredItems = allItems.filter((it) => {
      if (transactionType && transactionType !== 'ALL' && it.transactionType !== transactionType && !(transactionType === 'COLLECTION' && it.transactionType === 'REVENUE' && it.collectionsReceived !== 0)) {
        return false;
      }
      if (dept && it.departmentId && it.departmentId !== dept) {
        return false;
      }
      if (user && it.portalUserId !== user && !it.details?.actorIds?.includes(user)) {
        return false;
      }
      if (portal && portal !== 'ALL' && !it.portal.toLowerCase().includes(portal.toLowerCase()) && !it.details?.actorPortals?.includes(portal)) {
        return false;
      }
      if (method && method !== 'ALL' && !it.paymentMethod.toUpperCase().split(', ').includes(method.toUpperCase())) {
        return false;
      }
      if (status && status !== 'ALL' && it.status.toUpperCase() !== status.toUpperCase()) {
        return false;
      }
      if (search) {
        const text = [
          it.details?.receiptReferences || '',
          it.reference,
          it.patientPayeeDescription,
          it.encounterInvoiceRef,
          it.department,
          it.portalUser,
          it.typeLabel,
          it.paymentMethod,
        ]
          .join(' ')
          .toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });

    // Receipt entries are additional views of the same invoice's payment history.
    // Count their money only when the consolidated invoice is not in the filtered result.
    const displayedInvoices = new Set(filteredItems.filter(it => it.details?.invoiceId && !it.details?.isCollectionEvent).map(it => it.details!.invoiceId));
    const totalItems = filteredItems.filter(it => !it.details?.isCollectionEvent || !displayedInvoices.has(it.details.invoiceId));
    const outstandingInvoices = new Set<string>();
    const columnOutstanding = totalItems.reduce((sum, it) => {
      const invoiceId = it.details?.invoiceId;
      if (invoiceId && outstandingInvoices.has(invoiceId)) return sum;
      if (invoiceId) outstandingInvoices.add(invoiceId);
      return sum + it.outstandingPayable;
    }, 0);
    // Totals remain over the full filtered result, before pagination.
    const columnTotals = {
      grossBilling: totalItems.reduce((s, it) => s + it.grossBilling, 0),
      discountCredit: totalItems.reduce((s, it) => s + it.discountCredit, 0),
      tax: totalItems.reduce((s, it) => s + it.tax, 0),
      netRevenue: totalItems.reduce((s, it) => s + it.netRevenue, 0),
      collectionsReceived: totalItems.reduce((s, it) => s + it.collectionsReceived, 0),
      recognizedExpense: totalItems.reduce((s, it) => s + it.recognizedExpense, 0),
      expensePaid: totalItems.reduce((s, it) => s + it.expensePaid, 0),
      cashIn: totalItems.reduce((s, it) => s + it.cashIn, 0),
      cashOut: totalItems.reduce((s, it) => s + it.cashOut, 0),
      outstandingPayable: columnOutstanding,
    };

    // Executive Reconciled Financial Totals
    const sum = summaryData.summary;

    // External Customer Collections:
    // Physical cash collections from receipts (excluding refunds and reversals)
    const actualCashCollections = financialInvoices.reduce((s, p) => s + (p.row?.cashIn ?? 0), 0) + allItems.filter(it => it.id.startsWith('rec-')).reduce((s, it) => s + it.cashIn, 0);

    const totalRefunds = allItems
      .filter((it) => it.transactionType === 'REFUND')
      .reduce((s, it) => s + Math.abs(it.collectionsReceived), 0);

    // Actual Paid Operating Expenses:
    // Recognized paid expenses across all payment channels (Bank, Cash, etc.)
    const totalPaidOperatingExpenses = Number(sum.hospitalExpenses) + Number(sum.expenses) + Number(sum.salaryPaid) + Number(sum.commissionPaid);

    // Physical Cash-Paid Operating Expenses:
    // Operating expenses paid specifically in physical cash (excluding bank transfers/cards)
    const cashPaidExpenses = allItems
      .filter((it) => ['EXPENSE', 'PAYROLL', 'COMMISSION'].includes(it.transactionType))
      .reduce((s, it) => s + it.cashOut, 0);

    const nonCashPaidOperatingExpenses = Math.max(0, totalPaidOperatingExpenses - cashPaidExpenses);

    // Non-Operating Cash Outflows:
    // Internal settlements net to zero at the hospital-wide level.
    // External refunds and Pharmacy payments leave HMS; internal handovers net to zero.
    const nonOperatingOutflows = allItems.filter(it => (it.transactionType === 'REFUND' || it.details?.pharmacySettlementOutflow !== undefined)).reduce((s, it) => s + it.cashOut, 0);

    // Net Physical Cash Movement:
    // External physical cash collections - physical cash paid for expenses - external non-operating cash outflows
    const netPhysicalCashMovement = actualCashCollections - cashPaidExpenses - nonOperatingOutflows;

    const earnedRevenue = financialInvoices.reduce((s, p) => s + (p.row?.netRevenue ?? 0), 0);
    const collections = financialInvoices.reduce((s, p) => s + (p.row?.collectionsReceived ?? 0), 0) + allItems.filter(it => it.id.startsWith('rec-') || it.id.startsWith('ref-')).reduce((s, it) => s + it.collectionsReceived, 0);
    const performance = operatingPerformance(earnedRevenue, Number(sum.directServiceCosts), Number(sum.totalOperatingCosts) - Number(sum.directServiceCosts));
    const operatingProfit = performance.operatingProfit;
    const totals = {
      hospitalRevenue: {
        grossEarnedBilling: financialInvoices.reduce((s, p) => s + (p.row?.details.hospitalGrossBilling ?? 0), 0),
        discounts: financialInvoices.reduce((s, p) => s + (p.row?.details.hospitalDiscounts ?? 0), 0),
        netEarnedRevenue: earnedRevenue,
        taxAmount: filteredItems.reduce((s, it) => s + it.tax, 0),
      },
      collectionsReceivables: {
        totalCollections: collections,
        cashCollections: actualCashCollections,
        cardBankOnlineCollections: Math.max(0, collections - actualCashCollections),
        refunds: totalRefunds,
        netCollections: collections,
        closingOutstanding: financialInvoices.reduce((s, p) => s + p.outstanding, 0),
      },
      hospitalCosts: {
        directConsumables: Number(sum.directServiceCosts),
        staffPayrollRecognized: Number(sum.payrollCost),
        doctorCommissionEarned: Number(sum.doctorCommissionCost),
        approvedHospitalExpenses: Number(sum.hospitalExpenses),
        inventoryOperatingExpenses: Number(sum.expenses),
        totalOperatingCosts: Number(sum.totalOperatingCosts) - Number(sum.directServiceCosts),
        hasIncompleteCost: sum.hasIncompleteCost,
        missingCostCount: sum.missingCostCount,
      },
      profit: {
        grossProfit: performance.grossProfit,
        operatingProfit,
        operatingMargin: performance.operatingMargin,
      },
      cashMovement: {
        totalCustomerCollections: collections,
        cashCollections: actualCashCollections,
        cardBankOnlineCollections: Math.max(0, collections - actualCashCollections),
        actualPaidOperatingExpenses: totalPaidOperatingExpenses,
        cashPaidOperatingExpenses: cashPaidExpenses,
        nonCashPaidOperatingExpenses: nonCashPaidOperatingExpenses,
        nonOperatingCashOutflows: nonOperatingOutflows,
        netPhysicalCashMovement,
        netCashMovement: netPhysicalCashMovement,
        pharmacySettlementOutflows: pharmacyReleases.reduce((sum, r) => sum + Number(r.amount), 0),
        netTotalFundsMovement: collections - totalPaidOperatingExpenses - pharmacyReleases.reduce((sum, r) => sum + Number(r.amount), 0),
        currentRemainingCustomerDues: financialInvoices.reduce((s, p) => s + p.outstanding, 0),
      },
      payables: {
        payrollPaid: Number(sum.salaryPaid),
        payrollOutstanding: Number(sum.salaryOutstanding),
        commissionPaid: Number(sum.commissionPaid),
        commissionOutstanding: Number(sum.commissionOutstanding),
        expensePaid: Number(sum.hospitalExpenses),
        expenseOutstanding: 0,
      },
    };

    const totalRecords = filteredItems.length;
    const totalPages = Math.ceil(totalRecords / limit) || 1;
    const paginatedItems = query.exportAll ? filteredItems : filteredItems.slice((page - 1) * limit, page * limit);

    return {
      period: periodOf(start, end, label),
      totalRecords,
      page,
      limit,
      totalPages,
      items: paginatedItems,
      columnTotals,
      totals,
    };
  },
};

export function resolveExtendedDateRange(query: {
  preset?: string;
  fromDate?: string;
  toDate?: string;
}): { start: Date; end: Date; label: string } {
  const now = new Date();
  const karachiClock = hospitalClock(now);
  const todayStr = karachiClock.date; // e.g. "2026-11-21" in Asia/Karachi

  const parseKarachiStart = (dStr: string) => new Date(`${dStr}T00:00:00.000+05:00`);
  const parseKarachiEnd = (dStr: string) => new Date(`${dStr}T23:59:59.999+05:00`);

  if (query.preset === 'all_time') {
    return {
      start: new Date('2020-01-01T00:00:00.000+05:00'),
      end: parseKarachiEnd(todayStr),
      label: 'All Time',
    };
  }

  if (query.preset === 'custom' && query.fromDate && query.toDate) {
    return {
      start: parseKarachiStart(query.fromDate),
      end: parseKarachiEnd(query.toDate),
      label: `Custom (${query.fromDate} to ${query.toDate})`,
    };
  }

  if (query.preset === 'yesterday') {
    const todayDate = new Date(`${todayStr}T12:00:00+05:00`);
    todayDate.setDate(todayDate.getDate() - 1);
    const yesterdayStr = todayDate.toISOString().slice(0, 10);
    return {
      start: parseKarachiStart(yesterdayStr),
      end: parseKarachiEnd(yesterdayStr),
      label: 'Yesterday',
    };
  }

  if (query.preset === 'this_week') {
    const todayDate = new Date(`${todayStr}T12:00:00+05:00`);
    const day = todayDate.getDay();
    const diff = todayDate.getDate() - day + (day === 0 ? -6 : 1);
    todayDate.setDate(diff);
    const startOfWeekStr = todayDate.toISOString().slice(0, 10);
    return {
      start: parseKarachiStart(startOfWeekStr),
      end: parseKarachiEnd(todayStr),
      label: 'This Week',
    };
  }

  if (query.preset === 'this_month') {
    const [y = '2026', m = '11'] = todayStr.split('-');
    const startOfMonthStr = `${y}-${m}-01`;
    return {
      start: parseKarachiStart(startOfMonthStr),
      end: parseKarachiEnd(todayStr),
      label: 'This Month',
    };
  }

  if (query.preset === 'last_month') {
    const [yNum = 2026, mNum = 11] = todayStr.split('-').map(Number);
    const lastMonthY = mNum === 1 ? yNum - 1 : yNum;
    const lastMonthM = mNum === 1 ? 12 : mNum - 1;
    const mStr = String(lastMonthM).padStart(2, '0');
    const startOfLastMonth = `${lastMonthY}-${mStr}-01`;
    const lastDay = new Date(lastMonthY, lastMonthM, 0).getDate();
    const endOfLastMonth = `${lastMonthY}-${mStr}-${String(lastDay).padStart(2, '0')}`;
    return {
      start: parseKarachiStart(startOfLastMonth),
      end: parseKarachiEnd(endOfLastMonth),
      label: 'Last Month',
    };
  }

  // Default: Today
  return {
    start: parseKarachiStart(todayStr),
    end: parseKarachiEnd(todayStr),
    label: `Today (${todayStr})`,
  };
}
