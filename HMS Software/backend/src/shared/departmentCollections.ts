import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const department = { select: { id: true, name: true } } as const;
export const collectionInvoiceSelect = {
  departmentId: true, department,
  lines: { select: { lineNet: true, patientShare: true, panelReceivable: true, serviceRate: { select: { department } } } },
} satisfies Prisma.HospitalInvoiceSelect;
export const collectionSelect = {
  amount: true, collectedAt: true,
  hospitalInvoice: { select: collectionInvoiceSelect },
  admissionRecord: { select: { department } },
  appointment: { select: { department } },
} satisfies Prisma.PaymentReceiptSelect;

type Receipt = Prisma.PaymentReceiptGetPayload<{ select: typeof collectionSelect }>;
type Invoice = Prisma.HospitalInvoiceGetPayload<{ select: typeof collectionInvoiceSelect }>;
type Basis = 'lineNet' | 'patientShare' | 'panelReceivable';

/** Shared cent allocation for department totals and their service-line children. */
export function allocateWeightedAmount<T extends { weight: Decimal }>(amount: Decimal, rows: T[]) {
  const total = rows.reduce((sum, row) => sum.plus(row.weight), new Decimal(0));
  let allocated = new Decimal(0), cumulative = new Decimal(0);
  return rows.map((row, index) => {
    cumulative = cumulative.plus(row.weight);
    const next = !total.gt(0) ? new Decimal(0) : index === rows.length - 1
      ? amount : amount.times(cumulative).div(total).toDecimalPlaces(2);
    const share = next.minus(allocated); allocated = next;
    return { ...row, amount: share };
  });
}

/** Split each canonical department allocation among its service lines. */
export function allocateInvoiceLines(amount: Decimal, invoice: Omit<Invoice, 'lines'> & { lines: (Invoice['lines'][number] & { id: string })[] }, basis: Basis) {
  const hasCoverage = invoice.lines.some(line => new Decimal(line[basis] ?? 0).gt(0))
    && (basis !== 'patientShare' || invoice.lines.some(line => new Decimal(line.panelReceivable ?? 0).gt(0)));
  return allocateInvoiceAmount(amount, invoice, basis).flatMap(dept => {
    const lines = invoice.lines.filter(line => (line.serviceRate?.department?.id ?? invoice.department?.id ?? null) === dept.departmentId)
      .map(line => ({ id: line.id, weight: Decimal.max(hasCoverage ? line[basis] : line.lineNet, 0) }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return allocateWeightedAmount(dept.amount, lines);
  });
}

/** Signed receipt amounts, apportioned in cents; totals always reconcile. */
export function allocateCollection(receipt: Receipt) {
  const invoice = receipt.hospitalInvoice;
  if (invoice) return allocateInvoiceAmount(receipt.amount, invoice, 'patientShare');
  const d = receipt.admissionRecord?.department ?? receipt.appointment?.department;
  return [{ departmentId: d?.id ?? null, name: d?.name ?? 'Unassigned', amount: receipt.amount }];
}

export function allocateInvoiceAmount(amount: Decimal, invoice: Invoice, basis: Basis) {
  const weights = new Map<string, { departmentId: string | null; name: string; weight: Decimal }>();
  // Older invoices may predate coverage snapshots. Preserve their net-value allocation.
  const hasCoverage = (invoice.lines ?? []).some(line => new Decimal(line[basis] ?? 0).gt(0))
    && (basis !== 'patientShare' || invoice.lines.some(line => new Decimal(line.panelReceivable ?? 0).gt(0)));
  for (const line of invoice?.lines ?? []) {
    const d = line.serviceRate?.department ?? invoice?.department;
    const key = d?.id ?? '';
    const row = weights.get(key) ?? { departmentId: d?.id ?? null, name: d?.name ?? 'Unassigned', weight: new Decimal(0) };
    row.weight = row.weight.plus(Decimal.max(hasCoverage ? line[basis] : line.lineNet, 0));
    weights.set(key, row);
  }
  const rows = [...weights.values()].filter(r => r.weight.gt(0)).sort((a, b) => (a.departmentId ?? '').localeCompare(b.departmentId ?? ''));
  const total = rows.reduce((s, r) => s.plus(r.weight), new Decimal(0));
  if (!total.gt(0)) {
    const d = invoice.department;
    return [{ departmentId: d?.id ?? invoice.departmentId ?? null, name: d?.name ?? 'Unassigned', amount }];
  }
  return allocateWeightedAmount(amount, rows).map(({ departmentId, name, amount }) => ({ departmentId, name, amount }));
}

export function invoiceBalance(invoice: {
  total: Decimal; paidTotal: Decimal; panelReceivable?: Decimal;
  panelRemittanceAllocations?: { allocatedAmount: Decimal }[];
}) {
  const panelBilled = invoice.panelReceivable ?? new Decimal(0);
  const panelPaid = (invoice.panelRemittanceAllocations ?? []).reduce((sum, a) => sum.plus(a.allocatedAmount), new Decimal(0));
  const patientDue = Decimal.max(invoice.total.minus(panelBilled).minus(invoice.paidTotal), 0);
  const panelDue = Decimal.max(panelBilled.minus(panelPaid), 0);
  return { patientDue, panelDue, due: patientDue.plus(panelDue), panelPaid, collected: invoice.paidTotal.plus(panelPaid) };
}

export function panelPaymentFilter(method?: string, receivedById?: string): Prisma.PanelRemittanceWhereInput {
  const aliases: Record<string, string[]> = {
    BANK: ['BANK', 'BANK_TRANSFER', 'Bank Transfer'], BANK_TRANSFER: ['BANK', 'BANK_TRANSFER', 'Bank Transfer'],
    CASH: ['CASH'], ONLINE: ['ONLINE'], CARD: ['CARD'], CHEQUE: ['CHEQUE'],
  };
  return {
    ...(receivedById ? { receivedById } : {}),
    ...(method ? { OR: (aliases[method] ?? [method]).map(value => ({ method: { equals: value, mode: 'insensitive' as const } })) } : {}),
  };
}
const panelCollectionSelect = {
  allocatedAmount: true,
  hospitalInvoice: { select: collectionInvoiceSelect },
  panelRemittance: { select: { receivedAt: true } },
} satisfies Prisma.PanelRemittanceAllocationSelect;
type PanelAllocation = Prisma.PanelRemittanceAllocationGetPayload<{ select: typeof panelCollectionSelect }>;
type PanelReader = { panelRemittanceAllocation: {
  findMany(args: { where: Prisma.PanelRemittanceAllocationWhereInput; select: typeof panelCollectionSelect }): PromiseLike<PanelAllocation[]>;
} };

export async function panelCollectionLedger(db: PanelReader, end: Date, filters: {
  start?: Date; departmentId?: string; method?: string; userId?: string;
} = {}) {
  const allocations = await db.panelRemittanceAllocation.findMany({
    where: {
      panelRemittance: { receivedAt: { lte: end, ...(filters.start ? { gte: filters.start } : {}) },
        ...panelPaymentFilter(filters.method, filters.userId) },
      ...(filters.departmentId ? { hospitalInvoice: { OR: [
        { departmentId: filters.departmentId },
        { lines: { some: { serviceRate: { departmentId: filters.departmentId } } } },
      ] } } : {}),
    },
    select: panelCollectionSelect,
  });
  return allocations.flatMap(a => allocateInvoiceAmount(a.allocatedAmount, a.hospitalInvoice, 'panelReceivable')
    .map(row => ({ ...row, collectedAt: a.panelRemittance.receivedAt })));
}
export const signedReceiptWhere: Prisma.PaymentReceiptWhereInput = {
  OR: [{ isReversed: false }, { amount: { lt: 0 } }],
};

type CollectionReader = PanelReader & {
  paymentReceipt: {
    findMany(args: { where: Prisma.PaymentReceiptWhereInput; select: typeof collectionSelect }): PromiseLike<Receipt[]>;
  };
};
export async function departmentCollectionLedger(db: CollectionReader, end: Date, departmentId?: string) {
  const receipts = await db.paymentReceipt.findMany({
    where: {
      ...signedReceiptWhere, collectedAt: { lte: end },
      ...(departmentId ? { AND: [{ OR: [
        { hospitalInvoice: { departmentId } },
        { hospitalInvoice: { lines: { some: { serviceRate: { departmentId } } } } },
        { hospitalInvoiceId: null, admissionRecord: { departmentId } },
        { hospitalInvoiceId: null, appointment: { departmentId } },
      ] }] } : {}),
    },
    select: collectionSelect,
  });
  return receipts.flatMap(receipt =>
    allocateCollection(receipt).map(row => ({ ...row, collectedAt: receipt.collectedAt })),
  ).concat(await panelCollectionLedger(db, end, { departmentId }));
}
