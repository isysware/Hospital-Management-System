import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { resolveDateRange } from './dashboard.service';
import type {
  AdmissionSummaryQuery,
  CensusBedQuery,
  TransferLosQuery,
  HospitalBillStatusQuery,
  PharmacyRequestFulfillmentQuery,
} from './admissionReports.schemas';

/**
 * reporting.md §3 — the simplified 7-report Admission set (Admission
 * Reporting.pdf). Register and Discharge Clearance stay in
 * `admissionReports.service.ts`; this file holds the reports that were
 * combined or re-shaped for the new menu. Admission never collects cash —
 * every money figure here is read-only Hospital billing status.
 */

const patientNameSelect = {
  panelPatient: { select: { id: true, fullName: true, mrNumber: true } },
  selfPayEncounter: { select: { id: true, fullName: true, phone: true } },
} as const;

function patientDisplayName(row: { panelPatient?: { fullName: string } | null; selfPayEncounter?: { fullName: string } | null }) {
  return row.panelPatient?.fullName || row.selfPayEncounter?.fullName || 'Unknown Patient';
}

const bedSelect = {
  select: {
    id: true,
    bedNumber: true,
    status: true,
    ward: { select: { id: true, name: true } },
    room: { select: { id: true, name: true, ward: { select: { id: true, name: true } } } },
  },
} as const;

type BedLike = { bedNumber?: string; ward?: { name: string } | null; room?: { name: string; ward?: { name: string } | null } | null } | null | undefined;
const wardOf = (b: BedLike) => b?.ward?.name || b?.room?.ward?.name || null;
const locationOf = (b: BedLike) => (b ? [wardOf(b), b.room?.name, b.bedNumber].filter(Boolean).join(' / ') : null);

const wardWhere = (wardId: string): Prisma.AdmissionRecordWhereInput => ({ bed: { OR: [{ wardId }, { room: { wardId } }] } });
const userName = (u?: { displayName: string | null; username: string } | null) => (u ? u.displayName || u.username : null);

/** An admission's stay overlaps [start, end]: admitted (or planned) by `end` and not discharged before `start`. */
function stayOverlaps(start: Date, end: Date): Prisma.AdmissionRecordWhereInput {
  return {
    OR: [{ admittedAt: { lte: end } }, { admittedAt: null, createdAt: { lte: end } }],
    AND: [{ OR: [{ dischargedAt: null }, { dischargedAt: { gte: start } }] }],
  };
}

export const admissionSimpleReportsService = {
  /** #1 Admission Summary — period totals + a per-department breakdown table. */
  async getAdmissionSummary(query: AdmissionSummaryQuery) {
    const { start, end, label } = resolveDateRange(query);
    const base: Prisma.AdmissionRecordWhereInput = {
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.doctorStaffId ? { doctorStaffId: query.doctorStaffId } : {}),
      ...(query.wardId ? wardWhere(query.wardId) : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [admissions, beds] = await Promise.all([
      prisma.admissionRecord.findMany({
        where: { ...base, ...stayOverlaps(start, end), status: query.status ?? { not: 'CANCELLED' } },
        select: {
          createdAt: true,
          dischargedAt: true,
          status: true,
          department: { select: { name: true } },
          hospitalInvoices: { select: { total: true, paidTotal: true } },
        },
        take: 5000,
      }),
      prisma.bed.findMany({
        where: {
          ...(query.wardId ? { OR: [{ wardId: query.wardId }, { room: { wardId: query.wardId } }] } : {}),
          ...(query.departmentId ? { OR: [{ ward: { departmentId: query.departmentId } }, { room: { ward: { departmentId: query.departmentId } } }] } : {}),
        },
        select: { status: true },
      }),
    ]);

    type Bucket = { department: string; admissions: number; discharges: number; active: number; pendingDischarge: number; hospitalOutstanding: Decimal };
    const byDept = new Map<string, Bucket>();
    for (const a of admissions) {
      const dept = a.department.name;
      let b = byDept.get(dept);
      if (!b) {
        b = { department: dept, admissions: 0, discharges: 0, active: 0, pendingDischarge: 0, hospitalOutstanding: new Decimal(0) };
        byDept.set(dept, b);
      }
      if (a.createdAt >= start && a.createdAt <= end) b.admissions += 1;
      if (a.dischargedAt && a.dischargedAt >= start && a.dischargedAt <= end) b.discharges += 1;
      if (a.status === 'ACTIVE') b.active += 1;
      if (a.status === 'DISCHARGE_PENDING') b.pendingDischarge += 1;
      const due = a.hospitalInvoices.reduce((s, i) => s.plus(i.total.minus(i.paidTotal)), new Decimal(0));
      if (due.greaterThan(0)) b.hospitalOutstanding = b.hospitalOutstanding.plus(due);
    }
    const rows = Array.from(byDept.values()).sort((x, y) => x.department.localeCompare(y.department));
    const sum = (k: 'admissions' | 'discharges' | 'active' | 'pendingDischarge') => rows.reduce((s, r) => s + r[k], 0);
    const occupied = beds.filter((b) => b.status === 'OCCUPIED').length;

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: {
        admissions: sum('admissions'),
        discharges: sum('discharges'),
        activePatients: sum('active'),
        pendingDischarge: sum('pendingDischarge'),
        occupiedBeds: occupied,
        availableBeds: beds.filter((b) => b.status === 'AVAILABLE').length,
        totalBeds: beds.length,
        hospitalOutstanding: rows.reduce((s, r) => s.plus(r.hospitalOutstanding), new Decimal(0)),
      },
      rows,
    };
  },

  /**
   * #3 Inpatient Census / Bed — one combined screen, one row per bed, with
   * the patient occupying it as of `asOf`. Past dates use each admission's
   * admit/discharge times; the bed is the admission's current bed (earlier
   * beds are in the Transfer report).
   */
  async getCensusBedReport(query: CensusBedQuery) {
    const asOf = query.asOf ? new Date(`${query.asOf}T23:59:59.999`) : new Date();
    const isNow = !query.asOf;
    const roomBed = query.roomBed?.trim();

    const beds = await prisma.bed.findMany({
      where: {
        ...(query.wardId ? { OR: [{ wardId: query.wardId }, { room: { wardId: query.wardId } }] } : {}),
        ...(query.departmentId ? { AND: [{ OR: [{ ward: { departmentId: query.departmentId } }, { room: { ward: { departmentId: query.departmentId } } }] }] } : {}),
        ...(roomBed
          ? { AND: [{ OR: [{ bedNumber: { contains: roomBed, mode: 'insensitive' as const } }, { room: { name: { contains: roomBed, mode: 'insensitive' as const } } }] }] }
          : {}),
      },
      select: {
        ...bedSelect.select,
        admissions: {
          where: {
            admittedAt: { not: null, lte: asOf },
            OR: [{ dischargedAt: null }, { dischargedAt: { gt: asOf } }],
            status: { notIn: ['CANCELLED', 'PLANNED'] },
          },
          include: {
            ...patientNameSelect,
            doctor: { select: { fullName: true } },
            department: { select: { name: true } },
            hospitalInvoices: { select: { total: true, paidTotal: true } },
          },
          take: 1,
          orderBy: { admittedAt: 'desc' },
        },
      },
      orderBy: [{ bedNumber: 'asc' }],
    });

    const rows = beds
      .map((b) => {
        const a = b.admissions[0];
        // Today: the bed's own live status (covers RESERVED/OUT_OF_SERVICE).
        // Past date: occupied iff an admission covered that moment.
        const bedStatus = isNow ? b.status : a ? 'OCCUPIED' : 'AVAILABLE';
        return {
          ward: wardOf(b) || 'Unassigned',
          room: b.room?.name ?? null,
          bed: b.bedNumber,
          bedStatus,
          admissionNumber: a?.admissionNumber ?? null,
          patient: a ? patientDisplayName(a) : null,
          department: a?.department.name ?? null,
          doctor: a?.doctor?.fullName ?? null,
          admittedAt: a?.admittedAt ?? null,
          hospitalDue: a ? a.hospitalInvoices.reduce((s, i) => s.plus(i.total.minus(i.paidTotal)), new Decimal(0)) : new Decimal(0),
        };
      })
      .filter((r) => !query.bedStatus || r.bedStatus === query.bedStatus)
      .sort((x, y) => x.ward.localeCompare(y.ward) || (x.room ?? '').localeCompare(y.room ?? '') || x.bed.localeCompare(y.bed, undefined, { numeric: true }));

    return {
      asOf: asOf.toISOString(),
      periodLabel: isNow ? 'As of now' : `As of ${query.asOf}`,
      summary: {
        occupied: rows.filter((r) => r.bedStatus === 'OCCUPIED').length,
        available: rows.filter((r) => r.bedStatus === 'AVAILABLE').length,
        totalBeds: rows.length,
      },
      rows,
    };
  },

  /** #4 Transfer / Length of Stay — one row per transfer; admissions with no transfer show one row with LOS only. */
  async getTransferLosReport(query: TransferLosQuery) {
    const { start, end, label } = resolveDateRange(query);
    const now = new Date();
    const admissions = await prisma.admissionRecord.findMany({
      where: {
        status: { notIn: ['CANCELLED', 'PLANNED'] },
        admittedAt: { not: null },
        // In range = the stay overlaps the period, or a transfer happened in it.
        OR: [
          { admittedAt: { lte: end }, AND: [{ OR: [{ dischargedAt: null }, { dischargedAt: { gte: start } }] }] },
          { bedTransfers: { some: { transferredAt: { gte: start, lte: end } } } },
        ],
        ...(query.admissionNumber ? { admissionNumber: { contains: query.admissionNumber, mode: 'insensitive' as const } } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.doctorStaffId ? { doctorStaffId: query.doctorStaffId } : {}),
        ...(query.wardId
          ? {
              AND: [
                {
                  OR: [
                    wardWhere(query.wardId),
                    { bedTransfers: { some: { OR: [{ toBed: { OR: [{ wardId: query.wardId }, { room: { wardId: query.wardId } }] } }, { fromBed: { OR: [{ wardId: query.wardId }, { room: { wardId: query.wardId } }] } }] } } },
                  ],
                },
              ],
            }
          : {}),
      },
      include: {
        ...patientNameSelect,
        department: { select: { name: true } },
        doctor: { select: { fullName: true } },
        bed: bedSelect,
        bedTransfers: {
          include: { fromBed: bedSelect, toBed: bedSelect, transferredBy: { select: { displayName: true, username: true } } },
          orderBy: { transferredAt: 'asc' },
        },
      },
      orderBy: { admittedAt: 'desc' },
      take: 500,
    });

    type TransferLosRow = {
      admissionNumber: string;
      patient: string;
      department: string;
      doctor: string | null;
      admittedAt: Date | null;
      dischargedAt: Date | null;
      losDays: number;
      status: string;
      from: string | null;
      to: string | null;
      transferredAt: Date | null;
      reason: string | null;
      transferredBy: string | null;
    };

    const rows = admissions.flatMap((a): TransferLosRow[] => {
      const losDays = Math.round((((a.dischargedAt ?? now).getTime() - a.admittedAt!.getTime()) / 86400000) * 10) / 10;
      const base = {
        admissionNumber: a.admissionNumber,
        patient: patientDisplayName(a),
        department: a.department.name,
        doctor: a.doctor?.fullName ?? null,
        admittedAt: a.admittedAt,
        dischargedAt: a.dischargedAt,
        losDays,
        status: a.status,
      };
      if (a.bedTransfers.length === 0) {
        return [{ ...base, from: null, to: locationOf(a.bed), transferredAt: null, reason: null, transferredBy: null }];
      }
      return a.bedTransfers.map((t) => ({
        ...base,
        from: locationOf(t.fromBed),
        to: locationOf(t.toBed),
        transferredAt: t.transferredAt,
        reason: t.reason,
        transferredBy: userName(t.transferredBy),
      }));
    });

    return { period: { label, start: start.toISOString(), end: end.toISOString() }, rows };
  },

  /** #5 Running Hospital Bill / Payment Status — read-only, one row per admission; Pharmacy bill is never included. */
  async getHospitalBillStatus(query: HospitalBillStatusQuery) {
    const { start, end, label } = resolveDateRange(query);
    const admissions = await prisma.admissionRecord.findMany({
      where: {
        status: { not: 'CANCELLED' },
        ...stayOverlaps(start, end),
        ...(query.admissionNumber ? { admissionNumber: { contains: query.admissionNumber, mode: 'insensitive' as const } } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      },
      include: {
        ...patientNameSelect,
        department: { select: { name: true } },
        hospitalInvoices: { select: { total: true, paidTotal: true } },
        paymentReceipts: { where: { isReversed: false }, select: { receiptNumber: true, collectedAt: true }, orderBy: { collectedAt: 'desc' }, take: 1 },
        paymentRequests: { select: { status: true, requestedAt: true }, orderBy: { requestedAt: 'desc' }, take: 1 },
        dischargeClearances: { where: { clearanceType: 'HOSPITAL_BILLING' }, select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    // Advance/admission receipts can be linked straight to the admission, so
    // the latest receipt is the newer of those and any invoice receipt.
    const ids = admissions.map((a) => a.id);
    const invoiceReceipts = ids.length
      ? await prisma.paymentReceipt.findMany({
          where: { isReversed: false, hospitalInvoice: { admissionRecordId: { in: ids } } },
          select: { receiptNumber: true, collectedAt: true, hospitalInvoice: { select: { admissionRecordId: true } } },
          orderBy: { collectedAt: 'desc' },
        })
      : [];
    const latestInvoiceReceipt = new Map<string, { receiptNumber: string; collectedAt: Date }>();
    for (const r of invoiceReceipts) {
      const id = r.hospitalInvoice!.admissionRecordId!;
      if (!latestInvoiceReceipt.has(id)) latestInvoiceReceipt.set(id, r);
    }

    const rows = admissions
      .map((a) => {
        const charges = a.hospitalInvoices.reduce((s, i) => s.plus(i.total), new Decimal(0));
        const paid = a.hospitalInvoices.reduce((s, i) => s.plus(i.paidTotal), new Decimal(0));
        const outstanding = charges.minus(paid);
        const paymentStatus = charges.isZero() ? 'NO_CHARGES' : outstanding.lessThanOrEqualTo(0) ? 'PAID' : paid.isZero() ? 'UNPAID' : 'PARTIALLY_PAID';
        const direct = a.paymentReceipts[0];
        const viaInvoice = latestInvoiceReceipt.get(a.id);
        const latest = [direct, viaInvoice].filter(Boolean).sort((x, y) => y!.collectedAt.getTime() - x!.collectedAt.getTime())[0];
        return {
          id: a.id,
          admissionNumber: a.admissionNumber,
          patient: patientDisplayName(a),
          payer: a.panelPatientId ? 'Panel' : 'Self-Pay',
          department: a.department.name,
          admissionStatus: a.status,
          hospitalCharges: charges,
          paymentsCollected: paid,
          hospitalOutstanding: outstanding,
          paymentStatus,
          latestReceipt: latest?.receiptNumber ?? null,
          latestReceiptAt: latest?.collectedAt ?? null,
          latestRequestStatus: a.paymentRequests[0]?.status ?? null,
          hospitalClearance: a.dischargeClearances[0]?.status ?? 'PENDING',
        };
      })
      .filter((r) => (!query.paymentStatus || r.paymentStatus === query.paymentStatus) && (!query.clearanceStatus || r.hospitalClearance === query.clearanceStatus));

    return { period: { label, start: start.toISOString(), end: end.toISOString() }, rows };
  },

  /** #6 Pharmacy Request & Fulfillment — one row per requested medicine line, with Pharmacy invoice and high-cost approval. */
  async getPharmacyRequestFulfillment(query: PharmacyRequestFulfillmentQuery) {
    const { start, end, label } = resolveDateRange(query);
    const approvalWhere: Prisma.PharmacyClearanceWhereInput =
      query.approvalStatus === 'NOT_REQUIRED'
        ? { highCostAuthorization: { is: null } }
        : query.approvalStatus
          ? { highCostAuthorization: { is: { status: query.approvalStatus } } }
          : {};

    const lines = await prisma.pharmacyClearanceLine.findMany({
      where: {
        pharmacyClearance: {
          requestedAt: { gte: start, lte: end },
          ...(query.status ? { status: query.status } : {}),
          ...(query.admissionNumber ? { admissionRecord: { admissionNumber: { contains: query.admissionNumber, mode: 'insensitive' as const } } } : {}),
          ...approvalWhere,
        },
        ...(query.medicine ? { medicine: { name: { contains: query.medicine, mode: 'insensitive' as const } } } : {}),
      },
      include: {
        medicine: { select: { name: true } },
        pharmacyClearance: {
          select: {
            medicineRequestNumber: true,
            status: true,
            requestedAt: true,
            notes: true,
            admissionRecord: { select: { admissionNumber: true, ...patientNameSelect } },
            highCostAuthorization: { select: { status: true } },
            pharmacyDispenses: { select: { invoiceNumber: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { pharmacyClearance: { requestedAt: 'desc' } },
      take: 1000,
    });

    const clearanceOf = (status: string) => (['DISPENSED', 'INVOICED', 'CLEARANCE_SENT'].includes(status) ? 'CLEARED' : status === 'REJECTED' ? 'OUTSTANDING' : 'PENDING');

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      rows: lines.map((l) => {
        const c = l.pharmacyClearance;
        const dispense = c.pharmacyDispenses[0];
        return {
          requestRef: c.medicineRequestNumber,
          requestedAt: c.requestedAt,
          admissionNumber: c.admissionRecord.admissionNumber,
          patient: patientDisplayName(c.admissionRecord),
          medicine: l.medicine.name,
          requestedQty: l.requestedQuantity,
          dispensedQty: l.dispensedQuantity,
          requestStatus: c.status,
          notes: l.notes || c.notes || null,
          pharmacyInvoice: dispense?.invoiceNumber ?? null,
          pharmacyClearance: clearanceOf(c.status),
          approvalStatus: c.highCostAuthorization?.status ?? 'NOT_REQUIRED',
        };
      }),
    };
  },

  /** Dropdown sources for every Admission report filter row. */
  async getFilterOptions() {
    const [departments, doctors, wards] = await Promise.all([
      prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.staff.findMany({ where: { isActive: true, category: { equals: 'Doctor', mode: 'insensitive' } }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
      prisma.ward.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return {
      departments: departments.map((d) => ({ value: d.id, label: d.name })),
      doctors: doctors.map((d) => ({ value: d.id, label: d.fullName })),
      wards: wards.map((w) => ({ value: w.id, label: w.name })),
    };
  },
};
