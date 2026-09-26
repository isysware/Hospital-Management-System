import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { resolveDateRange } from './dashboard.service';
import type {
  EncounterRegisterQuery,
  InvoiceRegisterQuery,
  CollectionReportQuery,
  OutstandingInvoicesQuery,
  DiscountReportQuery,
  RefundVoidReportQuery,
  DepartmentRevenueQuery,
  AdmissionPaymentCollectionQuery,
  PanelPayerReportQuery,
  ReceiptExceptionLogQuery,
  CashierPerformanceQuery,
  FinancialExceptionsQuery,
} from './frontdeskReports.schemas';

/**
 * Front Desk / Billing reporting (Front Desk + Admission Reporting Guide
 * v7.5 §3.2–3.6, §4.1–4.4). Every report here reads the same posted source
 * tables Front Desk's live billing flow already writes to — no separate
 * reporting table, no mock rows. See `reporting.md`.
 */

const userSummarySelect = { id: true, displayName: true, username: true, role: true } as const;
const patientNameSelect = {
  panelPatient: { select: { id: true, fullName: true, mrNumber: true } },
  selfPayEncounter: { select: { id: true, fullName: true, phone: true } },
} as const;

function patientDisplayName(row: { panelPatient?: { fullName: string } | null; selfPayEncounter?: { fullName: string } | null }) {
  return row.panelPatient?.fullName || row.selfPayEncounter?.fullName || 'Unknown Patient';
}

export const frontdeskReportsService = {
  /** Guide §3.2 — planned/arrived visits and OPD/Observation/Emergency encounters. Every non-Admission invoice IS the encounter record (v7.2: invoices post on check-in/first service). */
  async getEncounterRegister(query: EncounterRegisterQuery) {
    const { start, end, label } = resolveDateRange(query);
    const where: Prisma.HospitalInvoiceWhereInput = {
      sourceType: { not: 'ADMISSION' },
      createdAt: { gte: start, lte: end },
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.encounterType ? { encounterType: query.encounterType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.doctorStaffId ? { appointment: { doctorStaffId: query.doctorStaffId } } : {}),
    };

    const rows = await prisma.hospitalInvoice.findMany({
      where,
      include: {
        ...patientNameSelect,
        department: { select: { id: true, name: true } },
        appointment: { select: { doctor: { select: { id: true, fullName: true } } } },
        createdByUser: { select: userSummarySelect },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      totalVisits: rows.length,
      rows: rows.map((r) => ({
        invoiceNumber: r.invoiceNumber,
        occurredAt: r.createdAt,
        patient: patientDisplayName(r),
        payer: r.panelPatient ? 'Panel' : 'Self-Pay',
        department: r.department?.name ?? null,
        doctor: r.appointment?.doctor?.fullName ?? null,
        visitType: r.sourceType,
        encounterType: r.encounterType,
        status: r.status,
        createdBy: r.createdByUser?.displayName || r.createdByUser?.username || null,
      })),
    };
  },

  /** Guide §3.3 — primary billing register across all Hospital-side invoices (visit + Admission bills). */
  async getInvoiceRegister(query: InvoiceRegisterQuery) {
    const { start, end, label } = resolveDateRange(query);
    const where: Prisma.HospitalInvoiceWhereInput = {
      createdAt: { gte: start, lte: end },
      ...(query.createdById ? { createdById: query.createdById } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.corporatePanelId ? { corporatePanelId: query.corporatePanelId } : {}),
      ...(query.payerType === 'PANEL' ? { corporatePanelId: { not: null } } : {}),
      ...(query.payerType === 'SELF_PAY' ? { corporatePanelId: null } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const rows = await prisma.hospitalInvoice.findMany({
      where,
      include: {
        ...patientNameSelect,
        department: { select: { id: true, name: true } },
        createdByUser: { select: userSummarySelect },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    let gross = new Decimal(0);
    let discount = new Decimal(0);
    let net = new Decimal(0);
    let paid = new Decimal(0);
    for (const r of rows) {
      gross = gross.plus(r.subtotal);
      discount = discount.plus(r.discountTotal);
      net = net.plus(r.total);
      paid = paid.plus(r.paidTotal);
    }

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: { grossBilled: gross, discount, netBilled: net, paid, outstanding: net.minus(paid), invoiceCount: rows.length },
      rows: rows.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        createdAt: r.createdAt,
        patient: patientDisplayName(r),
        sourceType: r.sourceType,
        department: r.department?.name ?? null,
        gross: r.subtotal,
        discount: r.discountTotal,
        net: r.total,
        paid: r.paidTotal,
        balance: r.total.minus(r.paidTotal),
        createdBy: r.createdByUser?.displayName || r.createdByUser?.username || null,
        status: r.status,
      })),
    };
  },

  /** Guide §3.4 — cashier/user-wise collection across Hospital receipts, including active Admission partial payments. */
  async getCollectionReport(query: CollectionReportQuery) {
    const { start, end, label } = resolveDateRange(query);
    const where: Prisma.PaymentReceiptWhereInput = {
      collectedAt: { gte: start, lte: end },
      isReversed: query.receiptStatus === 'REVERSED',
      ...(query.collectedById ? { collectedById: query.collectedById } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.source === 'ADMISSION' ? { admissionRecordId: { not: null } } : {}),
      ...(query.source === 'VISIT' ? { admissionRecordId: null } : {}),
    };

    const rows = await prisma.paymentReceipt.findMany({
      where,
      include: {
        collectedBy: { select: userSummarySelect },
        hospitalInvoice: { select: { invoiceNumber: true, ...patientNameSelect } },
        admissionRecord: { select: { admissionNumber: true, ...patientNameSelect } },
      },
      orderBy: { collectedAt: 'desc' },
      take: 500,
    });

    const byMethod: Record<'CASH' | 'CARD' | 'BANK' | 'ONLINE', Decimal> = { CASH: new Decimal(0), CARD: new Decimal(0), BANK: new Decimal(0), ONLINE: new Decimal(0) };
    let total = new Decimal(0);
    for (const r of rows) {
      byMethod[r.method] = byMethod[r.method].plus(r.amount);
      total = total.plus(r.amount);
    }

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: { total, byMethod, receiptCount: rows.length },
      rows: rows.map((r) => ({
        receiptNumber: r.receiptNumber,
        reference: r.hospitalInvoice?.invoiceNumber || r.admissionRecord?.admissionNumber || '—',
        patient: r.hospitalInvoice ? patientDisplayName(r.hospitalInvoice) : r.admissionRecord ? patientDisplayName(r.admissionRecord) : '—',
        amount: r.amount,
        method: r.method,
        occurredAt: r.collectedAt,
        collectedBy: r.collectedBy.displayName || r.collectedBy.username,
        status: r.isReversed ? 'REVERSED' : 'ACTIVE',
      })),
    };
  },

  /** Guide §4.1 — open receivable list. */
  async getOutstandingInvoices(query: OutstandingInvoicesQuery) {
    const { start, end, label } = resolveDateRange(query);
    const where: Prisma.HospitalInvoiceWhereInput = {
      createdAt: { gte: start, lte: end },
      status: query.status ? query.status : { in: ['UNPAID', 'PARTIALLY_PAID'] },
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.payerType === 'PANEL' ? { corporatePanelId: { not: null } } : {}),
      ...(query.payerType === 'SELF_PAY' ? { corporatePanelId: null } : {}),
    };

    const rows = await prisma.hospitalInvoice.findMany({
      where,
      include: {
        ...patientNameSelect,
        department: { select: { id: true, name: true } },
        createdByUser: { select: userSummarySelect },
        paymentReceipts: { where: { isReversed: false }, select: { collectedAt: true }, orderBy: { collectedAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const filtered = rows.filter((r) => (query.minOutstanding == null ? true : r.total.minus(r.paidTotal).toNumber() >= query.minOutstanding));
    const totalOutstanding = filtered.reduce((s, r) => s.plus(r.total.minus(r.paidTotal)), new Decimal(0));

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: { totalOutstanding, invoiceCount: filtered.length },
      rows: filtered.map((r) => ({
        invoiceNumber: r.invoiceNumber,
        patient: patientDisplayName(r),
        department: r.department?.name ?? null,
        net: r.total,
        paid: r.paidTotal,
        outstanding: r.total.minus(r.paidTotal),
        lastPaymentAt: r.paymentReceipts[0]?.collectedAt ?? null,
        payer: r.corporatePanelId ? 'Panel' : 'Self-Pay',
        createdBy: r.createdByUser?.displayName || r.createdByUser?.username || null,
        status: r.status,
      })),
    };
  },

  /** Guide §4.2 — manual + panel discounts with approval trail. */
  async getDiscountReport(query: DiscountReportQuery) {
    const { start, end, label } = resolveDateRange(query);
    const rows = await prisma.invoiceLineItem.findMany({
      where: {
        discountAmount: { gt: 0 },
        createdAt: { gte: start, lte: end },
        ...(query.corporatePanelId ? { hospitalInvoice: { corporatePanelId: query.corporatePanelId } } : {}),
        ...(query.departmentId ? { hospitalInvoice: { departmentId: query.departmentId } } : {}),
      },
      include: {
        serviceRate: { select: { name: true } },
        hospitalInvoice: { select: { invoiceNumber: true, ...patientNameSelect, corporatePanel: { select: { organizationName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const totalStandard = rows.reduce((s, r) => s.plus(r.lineGross), new Decimal(0));
    const totalDiscount = rows.reduce((s, r) => s.plus(r.discountAmount), new Decimal(0));

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: { grossBeforeDiscount: totalStandard, discountAmount: totalDiscount, netAfterDiscount: totalStandard.minus(totalDiscount) },
      rows: rows.map((r) => ({
        invoiceNumber: r.hospitalInvoice.invoiceNumber,
        patientOrPanel: r.hospitalInvoice.corporatePanel?.organizationName || patientDisplayName(r.hospitalInvoice),
        service: r.serviceRate.name,
        standardAmount: r.lineGross,
        discountAmount: r.discountAmount,
        net: r.lineNet,
        reason: r.discountReason,
      })),
    };
  },

  /** Guide §4.3 — refunds (UserCashBalance REFUND entries) and voided receipts, as compensating entries only. */
  async getRefundVoidReport(query: RefundVoidReportQuery) {
    const { start, end, label } = resolveDateRange(query);

    const refunds =
      query.type === 'VOID'
        ? []
        : await prisma.userCashBalance.findMany({
            where: { category: 'REFUND', occurredAt: { gte: start, lte: end }, ...(query.portalUserId ? { portalUserId: query.portalUserId } : {}) },
            include: { portalUser: { select: userSummarySelect }, paymentReceipt: { select: { receiptNumber: true, hospitalInvoice: { select: { id: true, invoiceNumber: true } } } } },
            orderBy: { occurredAt: 'desc' },
          });

    const refundReceiptIds = new Set(
      refunds.map((r) => r.paymentReceiptId).filter((id): id is string => Boolean(id))
    );

    const voids =
      query.type === 'REFUND'
        ? []
        : await prisma.paymentReceipt.findMany({
            where: { isReversed: true, collectedAt: { gte: start, lte: end }, ...(query.portalUserId ? { collectedById: query.portalUserId } : {}) },
            include: { collectedBy: { select: userSummarySelect }, hospitalInvoice: { select: { id: true, invoiceNumber: true } } },
            orderBy: { collectedAt: 'desc' },
          });

    // Exclude payment receipts that were created as reversal receipts for cash refunds (which are already in refunds)
    const distinctVoids = voids.filter((v) => !refundReceiptIds.has(v.id));

    const totalRefund = refunds.reduce((s, r) => s.plus(r.amount), new Decimal(0));

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: { refundAmount: totalRefund, refundCount: refunds.length, voidCount: distinctVoids.length },
      rows: [
        ...refunds.map((r) => ({
          reference: r.paymentReceipt?.receiptNumber || r.id,
          originalInvoice: r.paymentReceipt?.hospitalInvoice?.invoiceNumber || null,
          invoiceId: r.paymentReceipt?.hospitalInvoice?.id || null,
          type: 'REFUND' as const,
          amount: r.amount,
          performedBy: r.portalUser.displayName || r.portalUser.username,
          occurredAt: r.occurredAt,
        })),
        ...distinctVoids.map((v) => ({
          reference: v.receiptNumber,
          originalInvoice: v.hospitalInvoice?.invoiceNumber || null,
          invoiceId: v.hospitalInvoice?.id || null,
          type: 'VOID' as const,
          amount: v.amount.abs(),
          performedBy: v.collectedBy.displayName || v.collectedBy.username,
          occurredAt: v.collectedAt,
        })),
      ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
    };
  },

  /** Guide §4.4 — billing/collections by department and service, reconciled to invoice lines. */
  async getDepartmentRevenueReport(query: DepartmentRevenueQuery) {
    const { start, end, label } = resolveDateRange(query);
    const rows = await prisma.invoiceLineItem.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        ...(query.departmentId ? { hospitalInvoice: { departmentId: query.departmentId } } : {}),
      },
      include: { serviceRate: { select: { name: true } }, hospitalInvoice: { select: { departmentId: true, department: { select: { name: true } }, paidTotal: true, total: true } } },
      take: 2000,
    });

    type Bucket = { department: string; service: string; qty: Decimal; gross: Decimal; discount: Decimal; net: Decimal };
    const byKey = new Map<string, Bucket>();
    for (const r of rows) {
      const dept = r.hospitalInvoice.department?.name || 'Unassigned';
      const key = `${dept}::${r.serviceRate.name}`;
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = { department: dept, service: r.serviceRate.name, qty: new Decimal(0), gross: new Decimal(0), discount: new Decimal(0), net: new Decimal(0) };
        byKey.set(key, bucket);
      }
      bucket.qty = bucket.qty.plus(r.quantity);
      bucket.gross = bucket.gross.plus(r.lineGross);
      bucket.discount = bucket.discount.plus(r.discountAmount);
      bucket.net = bucket.net.plus(r.lineNet);
    }

    const list = Array.from(byKey.values()).sort((a, b) => b.net.comparedTo(a.net));
    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: {
        gross: list.reduce((s, b) => s.plus(b.gross), new Decimal(0)),
        discount: list.reduce((s, b) => s.plus(b.discount), new Decimal(0)),
        net: list.reduce((s, b) => s.plus(b.net), new Decimal(0)),
      },
      rows: list,
    };
  },

  /** Guide §3.6 — Hospital payments collected by Front Desk for active/discharge-stage admissions. Admission's own view of this is read-only (see `admissionReports.service.ts`). */
  async getAdmissionPaymentCollectionReport(query: AdmissionPaymentCollectionQuery) {
    const { start, end, label } = resolveDateRange(query);
    const rows = await prisma.admissionPaymentRequest.findMany({
      where: {
        requestedAt: { gte: start, lte: end },
        ...(query.admissionRecordId ? { admissionRecordId: query.admissionRecordId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.admissionNumber || query.departmentId
          ? {
              admissionRecord: {
                ...(query.admissionNumber ? { admissionNumber: { contains: query.admissionNumber, mode: 'insensitive' as const } } : {}),
                ...(query.departmentId ? { departmentId: query.departmentId } : {}),
              },
            }
          : {}),
      },
      include: {
        admissionRecord: { select: { admissionNumber: true, department: { select: { name: true } }, ...patientNameSelect } },
        requestedBy: { select: userSummarySelect },
        paymentReceipts: {
          where: { isReversed: false, ...(query.collectedById ? { collectedById: query.collectedById } : {}), ...(query.method ? { method: query.method } : {}) },
          include: { collectedBy: { select: userSummarySelect } },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: 500,
    });

    let requested = new Decimal(0);
    let collected = new Decimal(0);
    for (const r of rows) {
      requested = requested.plus(r.requestedAmount);
      for (const p of r.paymentReceipts) collected = collected.plus(p.amount);
    }

    type CollectionRow = {
      admissionNumber: string;
      patient: string;
      department: string | null;
      requestedAmount: Decimal;
      receiptNo: string | null;
      collectedAmount: Decimal;
      remainingDue: Decimal;
      method: string | null;
      collectedBy: string | null;
      status: string;
    };

    // A Method/Collected By filter is a question about receipts, so requests
    // with no matching receipt drop out instead of showing as empty rows.
    const receiptFilterActive = Boolean(query.method || query.collectedById);

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: { requestedAmount: requested, collectedAmount: collected, remainingHospitalDue: requested.minus(collected), receiptCount: rows.reduce((s, r) => s + r.paymentReceipts.length, 0) },
      rows: rows.flatMap((r): CollectionRow[] => {
        const base = {
          admissionNumber: r.admissionRecord.admissionNumber,
          patient: patientDisplayName(r.admissionRecord),
          department: r.admissionRecord.department?.name ?? null,
          requestedAmount: r.requestedAmount,
          remainingDue: Decimal.max(r.requestedAmount.minus(r.paymentReceipts.reduce((s, p) => s.plus(p.amount), new Decimal(0))), 0),
          status: r.status,
        };
        if (r.paymentReceipts.length === 0) {
          return receiptFilterActive ? [] : [{ ...base, receiptNo: null, collectedAmount: new Decimal(0), method: null, collectedBy: null }];
        }
        return r.paymentReceipts.map((p) => ({
          ...base,
          receiptNo: p.receiptNumber,
          collectedAmount: p.amount,
          method: p.method,
          collectedBy: p.collectedBy.displayName || p.collectedBy.username,
        }));
      }),
    };
  },

  /** Guide §3.5 — transaction-level ledger for one invoice: charges, payments, refunds and running balance. */
  async getInvoiceLedger(invoiceId: string) {
    const invoice = await prisma.hospitalInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        ...patientNameSelect,
        lines: { include: { serviceRate: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        paymentReceipts: { include: { collectedBy: { select: userSummarySelect } }, orderBy: { collectedAt: 'asc' } },
      },
    });
    if (!invoice) return null;

    type LedgerRow = { occurredAt: Date; reference: string; type: string; description: string; debit: Decimal; credit: Decimal; performedBy: string };
    const entries: LedgerRow[] = [];
    for (const l of invoice.lines) {
      entries.push({ occurredAt: l.createdAt, reference: invoice.invoiceNumber, type: 'CHARGE', description: l.serviceRate.name, debit: l.lineNet, credit: new Decimal(0), performedBy: '—' });
    }
    for (const p of invoice.paymentReceipts) {
      entries.push({
        occurredAt: p.collectedAt,
        reference: p.receiptNumber,
        type: p.isReversed ? 'VOID' : 'PAYMENT',
        description: `${p.method} payment`,
        debit: new Decimal(0),
        credit: p.isReversed ? new Decimal(0) : p.amount,
        performedBy: p.collectedBy.displayName || p.collectedBy.username,
      });
    }
    entries.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    let running = new Decimal(0);
    const withBalance = entries.map((e) => {
      running = running.plus(e.debit).minus(e.credit);
      return { ...e, runningBalance: running };
    });

    return {
      invoiceNumber: invoice.invoiceNumber,
      patient: patientDisplayName(invoice),
      entries: withBalance,
    };
  },

  /** Guide §9 menu — billing/collections grouped by Panel (payer), plus a Self-Pay bucket. */
  async getPanelPayerReport(query: PanelPayerReportQuery) {
    const { start, end, label } = resolveDateRange(query);
    const rows = await prisma.hospitalInvoice.findMany({
      where: { createdAt: { gte: start, lte: end }, ...(query.corporatePanelId ? { corporatePanelId: query.corporatePanelId } : {}) },
      include: { corporatePanel: { select: { organizationName: true } } },
      take: 2000,
    });

    type Bucket = { payer: string; invoiceCount: number; gross: Decimal; discount: Decimal; net: Decimal; paid: Decimal; outstanding: Decimal };
    const byPayer = new Map<string, Bucket>();
    for (const r of rows) {
      const payer = r.corporatePanel?.organizationName || 'Self-Pay';
      let bucket = byPayer.get(payer);
      if (!bucket) {
        bucket = { payer, invoiceCount: 0, gross: new Decimal(0), discount: new Decimal(0), net: new Decimal(0), paid: new Decimal(0), outstanding: new Decimal(0) };
        byPayer.set(payer, bucket);
      }
      bucket.invoiceCount += 1;
      bucket.gross = bucket.gross.plus(r.subtotal);
      bucket.discount = bucket.discount.plus(r.discountTotal);
      bucket.net = bucket.net.plus(r.total);
      bucket.paid = bucket.paid.plus(r.paidTotal);
      bucket.outstanding = bucket.outstanding.plus(r.total.minus(r.paidTotal));
    }

    return { period: { label, start: start.toISOString(), end: end.toISOString() }, rows: Array.from(byPayer.values()).sort((a, b) => b.net.comparedTo(a.net)) };
  },

  /**
   * Guide §9 menu — "Receipt Reprint / Exception Log". `PaymentReceipt` only
   * tracks whether a receipt was EVER printed (`printedAt`), not a count of
   * individual reprints — there is no separate reprint-event log in the
   * schema. This report is honestly scoped to what's actually tracked:
   * printed receipts plus voided ones, not a reprint counter.
   */
  async getReceiptExceptionLog(query: ReceiptExceptionLogQuery) {
    const { start, end, label } = resolveDateRange(query);
    const rows = await prisma.paymentReceipt.findMany({
      where: {
        collectedAt: { gte: start, lte: end },
        OR: [{ printedAt: { not: null } }, { isReversed: true }],
        ...(query.collectedById ? { collectedById: query.collectedById } : {}),
      },
      include: { collectedBy: { select: userSummarySelect }, hospitalInvoice: { select: { invoiceNumber: true } } },
      orderBy: { collectedAt: 'desc' },
      take: 500,
    });

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: { printedCount: rows.filter((r) => r.printedAt).length, voidedCount: rows.filter((r) => r.isReversed).length },
      rows: rows.map((r) => ({
        receiptNumber: r.receiptNumber,
        invoiceNumber: r.hospitalInvoice?.invoiceNumber ?? null,
        amount: r.amount,
        printed: !!r.printedAt,
        printedAt: r.printedAt,
        voided: r.isReversed,
        collectedBy: r.collectedBy.displayName || r.collectedBy.username,
        occurredAt: r.collectedAt,
      })),
    };
  },

  /** Guide §9 menu — "User/Cashier Performance": per-cashier collection totals and activity. */
  async getCashierPerformanceReport(query: CashierPerformanceQuery) {
    const { start, end, label } = resolveDateRange(query);
    const rows = await prisma.paymentReceipt.findMany({
      where: { collectedAt: { gte: start, lte: end }, isReversed: false },
      include: { collectedBy: { select: userSummarySelect } },
      take: 5000,
    });

    type Bucket = { cashier: string; receiptCount: number; totalCollected: Decimal };
    const byCashier = new Map<string, Bucket>();
    for (const r of rows) {
      const key = r.collectedBy.displayName || r.collectedBy.username;
      let bucket = byCashier.get(key);
      if (!bucket) {
        bucket = { cashier: key, receiptCount: 0, totalCollected: new Decimal(0) };
        byCashier.set(key, bucket);
      }
      bucket.receiptCount += 1;
      bucket.totalCollected = bucket.totalCollected.plus(r.amount);
    }

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      rows: Array.from(byCashier.values())
        .map((b) => ({ ...b, averageTransaction: b.receiptCount === 0 ? new Decimal(0) : b.totalCollected.div(b.receiptCount) }))
        .sort((a, b) => b.totalCollected.comparedTo(a.totalCollected)),
    };
  },

  /**
   * reporting.md §2 #7 — ONE combined exception report (Discounts / Refunds /
   * Voids) with a Type filter, replacing the separate Discount and
   * Refund/Void menu items. Reuses the two existing queries so figures stay
   * identical to what those reports showed. There is no discount-approval
   * record in the schema, so "Performed By" is the invoice creator for
   * discounts and the cashier for refunds/voids.
   */
  async getFinancialExceptions(query: FinancialExceptionsQuery) {
    const { start, end, label } = resolveDateRange(query);
    const wantDiscount = !query.type || query.type === 'DISCOUNT';
    const wantRefundOrVoid = !query.type || query.type === 'REFUND' || query.type === 'VOID';

    const discountLines = wantDiscount
      ? await prisma.invoiceLineItem.findMany({
          where: {
            discountAmount: { gt: 0 },
            createdAt: { gte: start, lte: end },
            ...(query.performedById ? { hospitalInvoice: { createdById: query.performedById } } : {}),
          },
          include: {
            serviceRate: { select: { name: true } },
            hospitalInvoice: {
              select: { id: true, invoiceNumber: true, ...patientNameSelect, corporatePanel: { select: { organizationName: true } }, createdByUser: { select: userSummarySelect } },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 500,
        })
      : [];

    const refundVoid = wantRefundOrVoid
      ? await this.getRefundVoidReport({
          preset: query.preset,
          fromDate: query.fromDate,
          toDate: query.toDate,
          portalUserId: query.performedById,
          type: query.type === 'REFUND' || query.type === 'VOID' ? query.type : undefined,
        })
      : null;

    type ExceptionRow = {
      type: 'DISCOUNT' | 'REFUND' | 'VOID';
      reference: string;
      invoiceNumber: string | null;
      invoiceId: string | null;
      patient: string | null;
      amount: Decimal;
      reason: string | null;
      performedBy: string;
      occurredAt: Date;
    };

    const rows: ExceptionRow[] = [
      ...discountLines.map((l) => ({
        type: 'DISCOUNT' as const,
        reference: l.serviceRate.name,
        invoiceNumber: l.hospitalInvoice.invoiceNumber,
        invoiceId: l.hospitalInvoice.id,
        patient: l.hospitalInvoice.corporatePanel?.organizationName || patientDisplayName(l.hospitalInvoice),
        amount: l.discountAmount,
        reason: l.discountReason,
        performedBy: l.hospitalInvoice.createdByUser?.displayName || l.hospitalInvoice.createdByUser?.username || '—',
        occurredAt: l.createdAt,
      })),
      ...(refundVoid?.rows ?? []).map((r) => ({
        type: r.type,
        reference: r.reference,
        invoiceNumber: r.originalInvoice,
        invoiceId: r.invoiceId,
        patient: null,
        amount: r.amount,
        reason: null,
        performedBy: r.performedBy,
        occurredAt: r.occurredAt,
      })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

    const sumOf = (t: ExceptionRow['type']) => rows.filter((r) => r.type === t).reduce((s, r) => s.plus(r.amount), new Decimal(0));
    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: { discountAmount: sumOf('DISCOUNT'), refundAmount: sumOf('REFUND'), voidAmount: sumOf('VOID'), count: rows.length },
      rows,
    };
  },

  /** Dropdown sources for every Front Desk report filter row — one call, readable under the same `reports:view` permission as the reports themselves. */
  async getFilterOptions() {
    const [departments, doctors, cashiers, panels] = await Promise.all([
      prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.staff.findMany({ where: { isActive: true, category: { equals: 'Doctor', mode: 'insensitive' } }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
      prisma.portalUser.findMany({
        where: { role: { in: ['FRONT_DESK_BILLING', 'ADMIN', 'SUPER_ADMIN'] } },
        select: { id: true, displayName: true, username: true },
        orderBy: { username: 'asc' },
      }),
      prisma.corporatePanel.findMany({ where: { isActive: true }, select: { id: true, organizationName: true }, orderBy: { organizationName: 'asc' } }),
    ]);
    return {
      departments: departments.map((d) => ({ value: d.id, label: d.name })),
      doctors: doctors.map((d) => ({ value: d.id, label: d.fullName })),
      cashiers: cashiers.map((u) => ({ value: u.id, label: u.displayName || u.username })),
      panels: panels.map((p) => ({ value: p.id, label: p.organizationName })),
    };
  },
};
