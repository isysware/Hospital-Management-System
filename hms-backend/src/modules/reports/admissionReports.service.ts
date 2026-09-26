import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { resolveDateRange } from './dashboard.service';
import type {
  AdmissionDailySummaryQuery,
  AdmissionRegisterQuery,
  InpatientCensusQuery,
  BedOccupancyQuery,
  BedTransferHistoryQuery,
  LengthOfStayQuery,
  ServiceConsumptionQuery,
  InpatientOutstandingQuery,
  DischargeClearanceQuery,
} from './admissionReports.schemas';

/**
 * Admission reporting (Front Desk + Admission Reporting Guide v7.5 §5).
 * Admission has no cashier Balance Sheet / Account Settlement — these
 * reports are case lifecycle, bed, length-of-stay and read-only financial
 * status only. See `reporting.md`.
 */

const patientNameSelect = {
  panelPatient: { select: { id: true, fullName: true, mrNumber: true } },
  selfPayEncounter: { select: { id: true, fullName: true, phone: true } },
} as const;

function patientDisplayName(row: { panelPatient?: { fullName: string } | null; selfPayEncounter?: { fullName: string } | null }) {
  return row.panelPatient?.fullName || row.selfPayEncounter?.fullName || 'Unknown Patient';
}

const bedInclude = {
  select: {
    id: true,
    bedNumber: true,
    status: true,
    ward: { select: { id: true, name: true } },
    room: { select: { id: true, name: true, ward: { select: { id: true, name: true } } } },
  },
} as const;

function wardName(bed: { ward?: { name: string } | null; room?: { ward?: { name: string } | null } | null } | null | undefined) {
  return bed?.ward?.name || bed?.room?.ward?.name || null;
}

export const admissionReportsService = {
  /** Guide §5.1 — daily operational snapshot. */
  async getAdmissionDailySummary(query: AdmissionDailySummaryQuery) {
    const { start, end, label } = resolveDateRange(query);
    const deptFilter = query.departmentId ? { departmentId: query.departmentId } : {};

    const [admissionsToday, activeCount, pendingCount, dischargesToday, pendingDischargeClearance, beds, outstandingInvoices] = await Promise.all([
      prisma.admissionRecord.count({ where: { createdAt: { gte: start, lte: end }, ...deptFilter } }),
      prisma.admissionRecord.count({ where: { status: 'ACTIVE', ...deptFilter } }),
      prisma.admissionRecord.count({ where: { status: { in: ['PLANNED', 'CONFIRMED'] }, ...deptFilter } }),
      prisma.admissionRecord.count({ where: { dischargedAt: { gte: start, lte: end }, ...deptFilter } }),
      prisma.admissionRecord.count({ where: { status: 'DISCHARGE_PENDING', ...deptFilter } }),
      prisma.bed.findMany({ select: { status: true } }),
      prisma.hospitalInvoice.findMany({
        where: { admissionRecordId: { not: null }, status: { in: ['UNPAID', 'PARTIALLY_PAID'] }, ...(query.departmentId ? { departmentId: query.departmentId } : {}) },
        select: { total: true, paidTotal: true },
      }),
    ]);

    const occupied = beds.filter((b) => b.status === 'OCCUPIED').length;
    const outstanding = outstandingInvoices.reduce((s, i) => s.plus(i.total.minus(i.paidTotal)), new Decimal(0));

    const dischargedWithStay = await prisma.admissionRecord.findMany({
      where: { dischargedAt: { not: null }, admittedAt: { not: null }, ...deptFilter },
      select: { admittedAt: true, dischargedAt: true },
      take: 500,
      orderBy: { dischargedAt: 'desc' },
    });
    const avgLosDays =
      dischargedWithStay.length === 0
        ? 0
        : dischargedWithStay.reduce((s, a) => s + (a.dischargedAt!.getTime() - a.admittedAt!.getTime()) / 86400000, 0) / dischargedWithStay.length;

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      admissionsToday,
      activeAdmissions: activeCount,
      pendingAdmissions: pendingCount,
      dischargesToday,
      pendingDischargeClearance,
      bedsOccupied: occupied,
      bedsAvailable: beds.length - occupied,
      totalBeds: beds.length,
      averageLengthOfStayDays: Math.round(avgLosDays * 10) / 10,
      outstandingInpatientBalance: outstanding,
    };
  },

  /** Guide §5.2 — master admission register, date-filterable (extends the existing plain `fetchAdmissions` with the reporting shell's date/payer filters). */
  async getAdmissionRegister(query: AdmissionRegisterQuery) {
    const { start, end, label } = resolveDateRange(query);
    const where: Prisma.AdmissionRecordWhereInput = {
      createdAt: { gte: start, lte: end },
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.doctorStaffId ? { doctorStaffId: query.doctorStaffId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.payerType === 'PANEL' ? { panelPatientId: { not: null } } : {}),
      ...(query.payerType === 'SELF_PAY' ? { panelPatientId: null } : {}),
      ...(query.wardId ? { bed: { OR: [{ wardId: query.wardId }, { room: { wardId: query.wardId } }] } } : {}),
    };

    const rows = await prisma.admissionRecord.findMany({
      where,
      include: {
        ...patientNameSelect,
        department: { select: { id: true, name: true } },
        doctor: { select: { id: true, fullName: true } },
        bed: bedInclude,
        createdByUser: { select: { id: true, displayName: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: {
        admissionsCount: rows.length,
        active: rows.filter((r) => r.status === 'ACTIVE').length,
        discharged: rows.filter((r) => r.status === 'DISCHARGED').length,
        panel: rows.filter((r) => r.panelPatientId).length,
        selfPay: rows.filter((r) => !r.panelPatientId).length,
      },
      rows: rows.map((r) => ({
        id: r.id,
        admissionNumber: r.admissionNumber,
        patient: patientDisplayName(r),
        payer: r.panelPatientId ? 'Panel' : 'Self-Pay',
        doctor: r.doctor?.fullName ?? null,
        department: r.department.name,
        ward: wardName(r.bed),
        bed: r.bed?.bedNumber ?? null,
        admittedAt: r.admittedAt,
        dischargedAt: r.dischargedAt,
        status: r.status,
        createdBy: r.createdByUser?.displayName || r.createdByUser?.username || null,
      })),
    };
  },

  /** Guide §5.3 — point-in-time census of active inpatients. */
  async getInpatientCensus(query: InpatientCensusQuery) {
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    const where: Prisma.AdmissionRecordWhereInput = {
      status: { in: ['ACTIVE', 'DISCHARGE_PENDING'] },
      admittedAt: { lte: asOf },
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.wardId ? { bed: { OR: [{ wardId: query.wardId }, { room: { wardId: query.wardId } }] } } : {}),
    };

    const rows = await prisma.admissionRecord.findMany({
      where,
      include: {
        ...patientNameSelect,
        doctor: { select: { fullName: true } },
        department: { select: { name: true } },
        bed: bedInclude,
        hospitalInvoices: { select: { total: true, paidTotal: true } },
        pharmacyClearances: { select: { status: true }, take: 1, orderBy: { requestedAt: 'desc' } },
      },
      orderBy: { admittedAt: 'asc' },
      take: 500,
    });

    return {
      asOf: asOf.toISOString(),
      activeCensus: rows.length,
      rows: rows.map((r) => {
        const hospitalDue = r.hospitalInvoices.reduce((s, i) => s.plus(i.total.minus(i.paidTotal)), new Decimal(0));
        return {
          admissionNumber: r.admissionNumber,
          patient: patientDisplayName(r),
          doctor: r.doctor?.fullName ?? null,
          department: r.department.name,
          ward: wardName(r.bed),
          room: r.bed?.room?.name ?? null,
          bed: r.bed?.bedNumber ?? null,
          admittedAt: r.admittedAt,
          hospitalDue,
          pharmacyClearance: r.pharmacyClearances[0]?.status ?? 'NOT_APPLICABLE',
          dischargeReady: r.status === 'DISCHARGE_PENDING',
        };
      }),
    };
  },

  /** Guide §5.4 — occupancy snapshot by ward (current point-in-time; full bed-time integration over a range is a follow-up). */
  async getBedOccupancyReport(query: BedOccupancyQuery) {
    const beds = await prisma.bed.findMany({
      where: {
        ...(query.wardId ? { OR: [{ wardId: query.wardId }, { room: { wardId: query.wardId } }] } : {}),
        ...(query.departmentId ? { OR: [{ ward: { departmentId: query.departmentId } }, { room: { ward: { departmentId: query.departmentId } } }] } : {}),
      },
      select: { id: true, bedNumber: true, status: true, ward: { select: { name: true } }, room: { select: { name: true, ward: { select: { name: true } } } } },
    });

    type Bucket = { ward: string; capacity: number; occupied: number };
    const byWard = new Map<string, Bucket>();
    for (const b of beds) {
      const ward = wardName(b) || 'Unassigned';
      let bucket = byWard.get(ward);
      if (!bucket) {
        bucket = { ward, capacity: 0, occupied: 0 };
        byWard.set(ward, bucket);
      }
      bucket.capacity += 1;
      if (b.status === 'OCCUPIED') bucket.occupied += 1;
    }

    const rows = Array.from(byWard.values()).map((b) => ({ ...b, available: b.capacity - b.occupied, occupancyPercent: b.capacity === 0 ? 0 : Math.round((b.occupied / b.capacity) * 1000) / 10 }));
    const totalCapacity = rows.reduce((s, r) => s + r.capacity, 0);
    const totalOccupied = rows.reduce((s, r) => s + r.occupied, 0);

    return {
      summary: { bedsOccupied: totalOccupied, bedsAvailable: totalCapacity - totalOccupied, occupancyPercent: totalCapacity === 0 ? 0 : Math.round((totalOccupied / totalCapacity) * 1000) / 10 },
      rows,
    };
  },

  /** Guide §5.5 — bed/ward/room transfer history. */
  async getBedTransferHistory(query: BedTransferHistoryQuery) {
    const { start, end, label } = resolveDateRange(query);
    const rows = await prisma.bedTransferHistory.findMany({
      where: {
        transferredAt: { gte: start, lte: end },
        ...(query.admissionRecordId ? { admissionRecordId: query.admissionRecordId } : {}),
      },
      include: {
        admissionRecord: { select: { admissionNumber: true, ...patientNameSelect } },
        fromBed: bedInclude,
        toBed: bedInclude,
        transferredBy: { select: { id: true, displayName: true, username: true } },
      },
      orderBy: { transferredAt: 'desc' },
      take: 500,
    });

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      transferCount: rows.length,
      rows: rows.map((r) => ({
        admissionNumber: r.admissionRecord.admissionNumber,
        patient: patientDisplayName(r.admissionRecord),
        fromWard: wardName(r.fromBed),
        fromBed: r.fromBed?.bedNumber ?? null,
        toWard: wardName(r.toBed),
        toBed: r.toBed.bedNumber,
        transferredAt: r.transferredAt,
        reason: r.reason,
        changedBy: r.transferredBy.displayName || r.transferredBy.username,
      })),
    };
  },

  /** Guide §5.6 — LOS for active and discharged cases. */
  async getLengthOfStayReport(query: LengthOfStayQuery) {
    const { start, end, label } = resolveDateRange(query);
    const now = new Date();
    const rows = await prisma.admissionRecord.findMany({
      where: {
        admittedAt: { not: null, gte: start, lte: end },
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.doctorStaffId ? { doctorStaffId: query.doctorStaffId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: { ...patientNameSelect, department: { select: { name: true } } },
      orderBy: { admittedAt: 'desc' },
      take: 500,
    });

    const withLos = rows.map((r) => {
      const end2 = r.dischargedAt ?? now;
      const los = (end2.getTime() - r.admittedAt!.getTime()) / 86400000;
      return {
        admissionNumber: r.admissionNumber,
        patient: patientDisplayName(r),
        department: r.department.name,
        admittedAt: r.admittedAt,
        dischargedAt: r.dischargedAt,
        lengthOfStayDays: Math.round(los * 10) / 10,
        status: r.status,
      };
    });

    const discharged = withLos.filter((r) => r.dischargedAt);
    const avgLos = withLos.length === 0 ? 0 : withLos.reduce((s, r) => s + r.lengthOfStayDays, 0) / withLos.length;
    const longestCurrent = withLos.filter((r) => !r.dischargedAt).reduce((max, r) => Math.max(max, r.lengthOfStayDays), 0);

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: { averageLosDays: Math.round(avgLos * 10) / 10, longestCurrentStayDays: longestCurrent, dischargedCount: discharged.length },
      rows: withLos,
    };
  },

  /** Guide §5.7 — running Hospital-side charges for one admission, excluding Pharmacy. */
  async getRunningHospitalBill(admissionRecordId: string) {
    const admission = await prisma.admissionRecord.findUnique({
      where: { id: admissionRecordId },
      include: {
        ...patientNameSelect,
        hospitalInvoices: {
          include: {
            lines: { include: { serviceRate: { select: { name: true, category: true } } }, orderBy: { createdAt: 'asc' } },
            paymentReceipts: { where: { isReversed: false } },
          },
        },
      },
    });
    if (!admission) return null;

    let running = new Decimal(0);
    const rows: any[] = [];
    for (const inv of admission.hospitalInvoices) {
      for (const l of inv.lines) {
        running = running.plus(l.lineNet);
        rows.push({ occurredAt: l.createdAt, chargeRef: inv.invoiceNumber, category: l.serviceRate.category, service: l.serviceRate.name, qty: l.quantity, rate: l.rateSnapshot, gross: l.lineGross, discount: l.discountAmount, net: l.lineNet, runningBalance: running });
      }
    }
    const hospitalPaid = admission.hospitalInvoices.reduce((s, inv) => s.plus(inv.paidTotal), new Decimal(0));
    const hospitalSubtotal = admission.hospitalInvoices.reduce((s, inv) => s.plus(inv.subtotal), new Decimal(0));
    const hospitalDiscount = admission.hospitalInvoices.reduce((s, inv) => s.plus(inv.discountTotal), new Decimal(0));
    const hospitalNet = admission.hospitalInvoices.reduce((s, inv) => s.plus(inv.total), new Decimal(0));

    return {
      admissionNumber: admission.admissionNumber,
      patient: patientDisplayName(admission),
      summary: { hospitalSubtotal, hospitalDiscount, hospitalPaymentsReceived: hospitalPaid, hospitalOutstanding: hospitalNet.minus(hospitalPaid) },
      rows,
    };
  },

  /** Guide §5.14 — department/ward/service consumption for admission-sourced charges only. */
  async getServiceConsumptionReport(query: ServiceConsumptionQuery) {
    const { start, end, label } = resolveDateRange(query);
    const lines = await prisma.invoiceLineItem.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        hospitalInvoice: { admissionRecordId: { not: null }, ...(query.departmentId ? { departmentId: query.departmentId } : {}) },
      },
      include: { serviceRate: { select: { name: true } }, hospitalInvoice: { select: { department: { select: { name: true } }, admissionRecordId: true } } },
      take: 2000,
    });

    type Bucket = { department: string; service: string; qty: Decimal; gross: Decimal; discount: Decimal; net: Decimal; admissions: Set<string> };
    const byKey = new Map<string, Bucket>();
    for (const l of lines) {
      const dept = l.hospitalInvoice.department?.name || 'Unassigned';
      const key = `${dept}::${l.serviceRate.name}`;
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = { department: dept, service: l.serviceRate.name, qty: new Decimal(0), gross: new Decimal(0), discount: new Decimal(0), net: new Decimal(0), admissions: new Set() };
        byKey.set(key, bucket);
      }
      bucket.qty = bucket.qty.plus(l.quantity);
      bucket.gross = bucket.gross.plus(l.lineGross);
      bucket.discount = bucket.discount.plus(l.discountAmount);
      bucket.net = bucket.net.plus(l.lineNet);
      if (l.hospitalInvoice.admissionRecordId) bucket.admissions.add(l.hospitalInvoice.admissionRecordId);
    }

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      rows: Array.from(byKey.values())
        .map((b) => ({ department: b.department, service: b.service, qty: b.qty, gross: b.gross, discount: b.discount, net: b.net, admissionCount: b.admissions.size }))
        .sort((a, b) => b.net.comparedTo(a.net)),
    };
  },

  /** Guide §5.15 — active/discharged admissions with Hospital balances still outstanding (never includes standalone Pharmacy due). */
  async getInpatientOutstandingBalance(query: InpatientOutstandingQuery) {
    const { start, end, label } = resolveDateRange(query);
    const rows = await prisma.hospitalInvoice.findMany({
      where: {
        admissionRecordId: { not: null },
        createdAt: { gte: start, lte: end },
        status: { in: ['UNPAID', 'PARTIALLY_PAID'] },
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.payerType === 'PANEL' ? { corporatePanelId: { not: null } } : {}),
        ...(query.payerType === 'SELF_PAY' ? { corporatePanelId: null } : {}),
        ...(query.status ? { admissionRecord: { status: query.status } } : {}),
      },
      include: { ...patientNameSelect, admissionRecord: { select: { admissionNumber: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const totalOutstanding = rows.reduce((s, r) => s.plus(r.total.minus(r.paidTotal)), new Decimal(0));
    const activeOutstanding = rows.filter((r) => r.admissionRecord?.status !== 'DISCHARGED').reduce((s, r) => s.plus(r.total.minus(r.paidTotal)), new Decimal(0));

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: { totalHospitalOutstanding: totalOutstanding, activeOutstanding, dischargedOutstanding: totalOutstanding.minus(activeOutstanding) },
      rows: rows.map((r) => ({
        admissionNumber: r.admissionRecord!.admissionNumber,
        patient: patientDisplayName(r),
        hospitalNet: r.total,
        hospitalPaid: r.paidTotal,
        hospitalOutstanding: r.total.minus(r.paidTotal),
        admissionStatus: r.admissionRecord!.status,
        invoiceStatus: r.status,
      })),
    };
  },

  /** Guide §5.13 — clinical + Hospital + Pharmacy clearance queue for discharge readiness. */
  async getDischargeClearanceReport(query: DischargeClearanceQuery) {
    const { start, end, label } = resolveDateRange(query);
    const rows = await prisma.admissionRecord.findMany({
      where: {
        status: { in: ['ACTIVE', 'DISCHARGE_PENDING', 'DISCHARGED'] },
        updatedAt: { gte: start, lte: end },
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.wardId ? { bed: { OR: [{ wardId: query.wardId }, { room: { wardId: query.wardId } }] } } : {}),
        ...(query.doctorStaffId ? { doctorStaffId: query.doctorStaffId } : {}),
      },
      include: {
        ...patientNameSelect,
        doctor: { select: { fullName: true } },
        department: { select: { name: true } },
        dischargeClearances: true,
        hospitalInvoices: { select: { total: true, paidTotal: true } },
        dischargeSummary: { select: { authorizedAt: true, initiatedByUser: { select: { displayName: true, username: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });

    const rowsAll = rows.map((r) => {
      const clinical = r.dischargeClearances.find((c) => c.clearanceType === 'CLINICAL')?.status ?? (r.dischargeSummary ? 'CLEARED' : 'PENDING');
      const hospital = r.dischargeClearances.find((c) => c.clearanceType === 'HOSPITAL_BILLING')?.status ?? 'PENDING';
      const pharmacy = r.dischargeClearances.find((c) => c.clearanceType === 'PHARMACY')?.status ?? 'PENDING';
      const hospitalDue = r.hospitalInvoices.reduce((s, i) => s.plus(i.total.minus(i.paidTotal)), new Decimal(0));
      return {
        admissionNumber: r.admissionNumber,
        patient: patientDisplayName(r),
        department: r.department.name,
        doctor: r.doctor?.fullName ?? null,
        admissionStatus: r.status,
        clinicalReady: clinical === 'CLEARED',
        hospitalClearance: hospital,
        hospitalDue,
        // Negative due = patient has credit (paid more than billed).
        balanceStatus: hospitalDue.isZero() ? 'SETTLED' : hospitalDue.isNegative() ? 'CREDIT' : 'OUTSTANDING',
        pharmacyClearance: pharmacy,
        dischargeReady: clinical === 'CLEARED' && (hospital === 'CLEARED' || hospital === 'NOT_APPLICABLE') && (pharmacy === 'CLEARED' || pharmacy === 'NOT_APPLICABLE'),
        completedBy: r.dischargeSummary?.initiatedByUser?.displayName || r.dischargeSummary?.initiatedByUser?.username || null,
        dischargeDate: r.dischargedAt,
      };
    });

    // Clearance filters are derived per row (clinical falls back to the
    // discharge summary), so they apply after the query.
    const rowsOut = rowsAll.filter(
      (r) =>
        (!query.clinicalStatus || (query.clinicalStatus === 'READY') === r.clinicalReady) &&
        (!query.hospitalClearance || r.hospitalClearance === query.hospitalClearance) &&
        (!query.pharmacyClearance || r.pharmacyClearance === query.pharmacyClearance),
    );

    return {
      period: { label, start: start.toISOString(), end: end.toISOString() },
      summary: {
        clinicalReady: rowsOut.filter((r) => r.clinicalReady).length,
        hospitalCleared: rowsOut.filter((r) => r.hospitalClearance === 'CLEARED').length,
        pharmacyCleared: rowsOut.filter((r) => r.pharmacyClearance === 'CLEARED').length,
        fullyDischargeReady: rowsOut.filter((r) => r.dischargeReady).length,
      },
      rows: rowsOut,
    };
  },
};
