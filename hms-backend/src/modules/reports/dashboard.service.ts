import { prisma } from '@/db/client';
import type { GetSuperAdminDashboardQuery } from './dashboard.schemas';

export interface SuperAdminDashboardData {
  period: {
    preset: string;
    startDate: string;
    endDate: string;
    label: string;
  };
  infrastructure: {
    activeDepartmentsCount: number;
    totalStaffCount: number;
    doctorsCount: number;
    activePanelsCount: number;
    activePanelPatientsCount: number;
    activeAdminsCount: number;
  };
  bedMetrics: {
    totalBeds: number;
    occupiedBeds: number;
    availableBeds: number;
    occupancyPercent: number;
    totalWards: number;
    totalRooms: number;
    wards: Array<{
      wardName: string;
      type: string;
      totalBeds: number;
      occupiedBeds: number;
      availableBeds: number;
      occupancyPercent: number;
    }>;
  };
  billingSummary: {
    totalInvoices: number;
    grossBilling: number;
    discounts: number;
    netBilling: number;
    paidAmount: number;
    partiallyPaidAmount: number;
    partiallyPaidInvoicesCount: number;
    outstandingAmount: number;
    refundsAmount: number;
  };
  revenueChannels: {
    cash: number;
    onlineBank: number;
    panelCorporate: number;
    outstanding: number;
  };
  paymentMethods: Array<{
    method: string;
    amount: number;
    percentage: number;
    icon: string;
  }>;
  patientFlow: Array<{
    category: 'OPD' | 'Observation' | 'Emergency' | 'Admission';
    total: number;
    waiting: number;
    completed: number;
    active: number;
    peakHour: string;
    accentColor: string;
  }>;
  inventorySummary: {
    totalItemsCount: number;
    lowStockItemsCount: number;
    outOfStockItemsCount: number;
    pendingStockRequestsCount: number;
    /** Real flagged central-store items (out-of-stock first), for dashboard alert tiles — never fabricated names. */
    flaggedItems: Array<{
      id: string;
      name: string;
      unit: string;
      currentStock: number;
      reorderLevel: number;
      status: 'OUT_OF_STOCK' | 'LOW_STOCK';
    }>;
  };
  pharmacySummary: {
    salesAmount: number;
    invoicesCount: number;
    medicinesDispensedCount: number;
    pendingRequestsCount: number;
    returnsCount: number;
    returnsAmount: number;
    nearExpiryAlertsCount: number;
  };
  corporatePanels: {
    activePanelsCount: number;
    panelPatientsCount: number;
    panelBillingAmount: number;
    panelOutstandingAmount: number;
    topPanels: Array<{
      id: string;
      name: string;
      code: string;
      patients: number;
      billing: number;
    }>;
  };
  departmentActivity: Array<{
    id: string;
    name: string;
    type: string;
    patients: number;
    billing: number;
    status: 'Normal Flow' | 'High Volume' | 'Surge' | 'Optimal';
    statusColor: string;
  }>;
  /** Real doctor roster — current department/designation (Staff), current shift (StaffEmploymentHistory), and this period's booked Appointment count. */
  doctorsOnDuty: Array<{
    id: string;
    name: string;
    department: string;
    designation: string;
    shiftLabel: string;
    patientsBooked: number;
    status: 'On Duty' | 'On Roster';
  }>;
  attentionAlerts: Array<{
    id: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    description: string;
    metric: string;
    actionLabel: string;
    navModule: string;
  }>;
  recentActivity: Array<{
    id: string;
    timestamp: string;
    user: string;
    role: string;
    action: string;
    module: string;
    reference: string;
  }>;
  recentTransactions: Array<{
    reference: string;
    patientName: string;
    transactionType: 'Invoice' | 'Payment' | 'Refund' | 'Pharmacy Sale';
    amount: number;
    paymentStatus: 'Paid' | 'Partially Paid' | 'Refunded' | 'Pending Settlement';
    user: string;
    userRole: string;
    timestamp: string;
  }>;
  kpis: Array<{
    id: string;
    title: string;
    value: string;
    numericValue: number;
    iconName: string;
    contextText: string;
    changeText?: string;
    isPositive?: boolean;
    colorClass: string;
    accentBg: string;
    navModule?: string;
  }>;
}

export function resolveDateRange(query: GetSuperAdminDashboardQuery): {
  start: Date;
  end: Date;
  label: string;
} {
  const now = new Date();
  const startOfDay = (d: Date) => {
    const res = new Date(d);
    res.setHours(0, 0, 0, 0);
    return res;
  };
  const endOfDay = (d: Date) => {
    const res = new Date(d);
    res.setHours(23, 59, 59, 999);
    return res;
  };

  if (query.preset === 'custom' && query.fromDate && query.toDate) {
    const s = startOfDay(new Date(query.fromDate));
    const e = endOfDay(new Date(query.toDate));
    return {
      start: s,
      end: e,
      label: `Custom (${query.fromDate} to ${query.toDate})`,
    };
  }

  if (query.preset === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return {
      start: startOfDay(y),
      end: endOfDay(y),
      label: 'Yesterday',
    };
  }

  if (query.preset === 'this_week') {
    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    startOfWeek.setDate(diff);
    return {
      start: startOfDay(startOfWeek),
      end: endOfDay(now),
      label: 'This Week',
    };
  }

  if (query.preset === 'this_month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      start: startOfDay(startOfMonth),
      end: endOfDay(now),
      label: 'This Month',
    };
  }

  // Default: today
  return {
    start: startOfDay(now),
    end: endOfDay(now),
    label: 'Today',
  };
}

export const dashboardService = {
  async getSuperAdminDashboard(query: GetSuperAdminDashboardQuery): Promise<SuperAdminDashboardData> {
    const { start: periodStart, end: periodEnd, label: periodLabel } = resolveDateRange(query);

    // 1. Master Infrastructure counts
    const [
      activeDepartmentsCount,
      totalStaffCount,
      doctorsCount,
      activePanelsCount,
      activePanelPatientsCount,
      activeAdminsCount,
    ] = await Promise.all([
      prisma.department.count({ where: { isActive: true } }),
      prisma.staff.count({ where: { isActive: true, employmentStatus: 'ACTIVE' } }),
      prisma.staff.count({
        where: {
          isActive: true,
          employmentStatus: 'ACTIVE',
          category: { contains: 'Doctor', mode: 'insensitive' },
        },
      }),
      prisma.corporatePanel.count({ where: { isActive: true } }),
      prisma.panelPatient.count({ where: { isActive: true } }),
      prisma.portalUser.count({ where: { status: 'ACTIVE', role: { in: ['SUPER_ADMIN', 'ADMIN'] } } }),
    ]);

    // 2. Bed & Ward Metrics
    const [wards, activeAdmissions] = await Promise.all([
      prisma.ward.findMany({
        where: { isActive: true },
        include: {
          rooms: {
            where: { isActive: true },
            include: {
              beds: true,
            },
          },
        },
      }),
      prisma.admissionRecord.findMany({
        where: { status: 'ACTIVE' },
        select: { bedId: true },
      }),
    ]);

    const activeOccupiedBedIds = new Set(activeAdmissions.map((a) => a.bedId));

    let totalBeds = 0;
    let occupiedBeds = 0;
    let totalRooms = 0;

    const wardSummaries = wards.map((w) => {
      let wardTotalBeds = 0;
      let wardOccupiedBeds = 0;

      for (const room of w.rooms) {
        totalRooms += 1;
        for (const bed of room.beds) {
          wardTotalBeds += 1;
          totalBeds += 1;
          const isOccupied = activeOccupiedBedIds.has(bed.id) || bed.status === 'OCCUPIED';
          if (isOccupied) {
            wardOccupiedBeds += 1;
            occupiedBeds += 1;
          }
        }
      }

      const wardAvailableBeds = Math.max(0, wardTotalBeds - wardOccupiedBeds);
      const wardOccupancyPercent = wardTotalBeds > 0 ? Math.round((wardOccupiedBeds / wardTotalBeds) * 100) : 0;

      return {
        wardName: w.name,
        type: w.genderPolicy || 'General',
        totalBeds: wardTotalBeds,
        occupiedBeds: wardOccupiedBeds,
        availableBeds: wardAvailableBeds,
        occupancyPercent: wardOccupancyPercent,
      };
    });

    const availableBeds = Math.max(0, totalBeds - occupiedBeds);
    const overallOccupancyPercent = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

    // 3. Billing & Invoices within period
    const [invoices, receipts] = await Promise.all([
      prisma.hospitalInvoice.findMany({
        where: {
          createdAt: { gte: periodStart, lte: periodEnd },
        },
        select: {
          id: true,
          subtotal: true,
          discountTotal: true,
          total: true,
          paidTotal: true,
          status: true,
          panelPatientId: true,
          encounterType: true,
          createdAt: true,
        },
      }),
      prisma.paymentReceipt.findMany({
        where: {
          collectedAt: { gte: periodStart, lte: periodEnd },
        },
        select: {
          method: true,
          amount: true,
          isReversed: true,
        },
      }),
    ]);

    let grossBilling = 0;
    let discounts = 0;
    let netBilling = 0;
    let paidAmount = 0;
    let outstandingAmount = 0;
    let partiallyPaidAmount = 0;
    let partiallyPaidInvoicesCount = 0;
    let panelBillingAmount = 0;

    let emergencyInvoicesCount = 0;
    let observationInvoicesCount = 0;

    for (const inv of invoices) {
      const sub = Number(inv.subtotal || 0);
      const disc = Number(inv.discountTotal || 0);
      const tot = Number(inv.total || 0);
      const pd = Number(inv.paidTotal || 0);
      const bal = Math.max(0, tot - pd);

      grossBilling += sub;
      discounts += disc;
      netBilling += tot;
      paidAmount += pd;
      outstandingAmount += bal;

      if (inv.status === 'PARTIALLY_PAID') {
        partiallyPaidInvoicesCount += 1;
        partiallyPaidAmount += pd;
      }

      if (inv.panelPatientId) {
        panelBillingAmount += tot;
      }

      if (inv.encounterType === 'EMERGENCY') {
        emergencyInvoicesCount += 1;
      } else if (inv.encounterType === 'OBSERVATION') {
        observationInvoicesCount += 1;
      }
    }

    let refundsAmount = 0;
    let cashAmount = 0;
    let cardAmount = 0;
    let bankAmount = 0;
    let onlineAmount = 0;

    for (const rec of receipts) {
      const amt = Number(rec.amount || 0);
      if (rec.isReversed) {
        refundsAmount += amt;
      } else {
        if (rec.method === 'CASH') cashAmount += amt;
        else if (rec.method === 'CARD') cardAmount += amt;
        else if (rec.method === 'BANK') bankAmount += amt;
        else if (rec.method === 'ONLINE') onlineAmount += amt;
        else cashAmount += amt;
      }
    }

    const bankOnlineAmount = bankAmount + onlineAmount;
    const totalReceiptsAmount = cashAmount + cardAmount + bankOnlineAmount;

    const paymentMethods = [
      {
        method: 'Cash Payment',
        amount: cashAmount,
        percentage: totalReceiptsAmount > 0 ? Math.round((cashAmount / totalReceiptsAmount) * 100) : 0,
        icon: 'Banknote',
      },
      {
        method: 'Card / POS Terminal',
        amount: cardAmount,
        percentage: totalReceiptsAmount > 0 ? Math.round((cardAmount / totalReceiptsAmount) * 100) : 0,
        icon: 'CreditCard',
      },
      {
        method: 'Bank Transfer / Online',
        amount: bankOnlineAmount,
        percentage: totalReceiptsAmount > 0 ? Math.round((bankOnlineAmount / totalReceiptsAmount) * 100) : 0,
        icon: 'Layers',
      },
      {
        method: 'Corporate Panel Credit',
        amount: panelBillingAmount,
        percentage: 0,
        icon: 'Shield',
      },
    ];

    const revenueChannels = {
      cash: cashAmount,
      onlineBank: bankOnlineAmount + cardAmount,
      panelCorporate: panelBillingAmount,
      outstanding: outstandingAmount,
    };

    // 4. Patient Flow
    const [appointments, admissionsInPeriod] = await Promise.all([
      prisma.appointment.findMany({
        where: { slotAt: { gte: periodStart, lte: periodEnd } },
        select: { status: true },
      }),
      prisma.admissionRecord.findMany({
        where: { admittedAt: { gte: periodStart, lte: periodEnd } },
        select: { status: true },
      }),
    ]);

    const opdAppointmentsCount = appointments.length;
    const opdWaiting = appointments.filter((a) => a.status === 'CONFIRMED' || a.status === 'CHECKED_IN').length;
    const opdCompleted = appointments.filter((a) => a.status === 'COMPLETED').length;
    const admissionsCount = admissionsInPeriod.length;

    const patientFlow: SuperAdminDashboardData['patientFlow'] = [
      {
        category: 'OPD',
        total: opdAppointmentsCount,
        waiting: opdWaiting,
        completed: opdCompleted,
        active: opdWaiting,
        peakHour: '10:00 AM - 1:00 PM',
        accentColor: '#08775A',
      },
      {
        category: 'Emergency',
        total: emergencyInvoicesCount,
        waiting: 0,
        completed: emergencyInvoicesCount,
        active: 0,
        peakHour: '24/7 Continuous',
        accentColor: '#dc2626',
      },
      {
        category: 'Observation',
        total: observationInvoicesCount,
        waiting: 0,
        completed: observationInvoicesCount,
        active: 0,
        peakHour: '12:00 PM - 6:00 PM',
        accentColor: '#d97706',
      },
      {
        category: 'Admission',
        total: admissionsCount,
        waiting: 0,
        completed: admissionsInPeriod.filter((a) => a.status === 'DISCHARGED').length,
        active: activeAdmissions.length,
        peakHour: 'Admission Desk',
        accentColor: '#2563eb',
      },
    ];

    // 5. Inventory & Pharmacy
    const [stockItems, stockLedgerAggregates, pharmacyDispenses] = await Promise.all([
      prisma.stockItem.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          unit: true,
          reorderLevel: true,
        },
      }),
      prisma.stockLedger.groupBy({
        by: ['stockItemId'],
        _sum: {
          quantityDelta: true,
        },
      }),
      prisma.pharmacyDispense.findMany({
        where: { createdAt: { gte: periodStart, lte: periodEnd } },
        select: { id: true, total: true, status: true },
      }),
    ]);

    const stockBalances = new Map<string, number>();
    for (const agg of stockLedgerAggregates) {
      stockBalances.set(agg.stockItemId, Number(agg._sum.quantityDelta || 0));
    }

    let lowStockCount = 0;
    let outOfStockCount = 0;
    const flaggedStockItems: SuperAdminDashboardData['inventorySummary']['flaggedItems'] = [];

    for (const item of stockItems) {
      const currentStock = stockBalances.get(item.id) ?? 0;
      const reorder = Number(item.reorderLevel || 0);
      if (currentStock <= 0) {
        outOfStockCount += 1;
        flaggedStockItems.push({
          id: item.id,
          name: item.name,
          unit: item.unit,
          currentStock,
          reorderLevel: reorder,
          status: 'OUT_OF_STOCK',
        });
      } else if (currentStock <= reorder) {
        lowStockCount += 1;
        flaggedStockItems.push({
          id: item.id,
          name: item.name,
          unit: item.unit,
          currentStock,
          reorderLevel: reorder,
          status: 'LOW_STOCK',
        });
      }
    }
    // Out-of-stock items surface first — most urgent — then cap to a dashboard-tile-sized slice.
    flaggedStockItems.sort((a, b) => (a.status === b.status ? 0 : a.status === 'OUT_OF_STOCK' ? -1 : 1));
    const topFlaggedStockItems = flaggedStockItems.slice(0, 6);

    const pharmacySalesAmount = pharmacyDispenses.reduce((sum, d) => sum + Number(d.total || 0), 0);
    const pharmacyInvoicesCount = pharmacyDispenses.length;

    // 6. Corporate Panels
    const panelsWithCounts = await prisma.corporatePanel.findMany({
      where: { isActive: true },
      select: {
        id: true,
        organizationName: true,
        code: true,
        _count: { select: { panelPatients: true } },
      },
      take: 5,
    });

    const topPanels = panelsWithCounts.map((p) => ({
      id: p.id,
      name: p.organizationName,
      code: p.code || p.id.slice(0, 8),
      patients: p._count.panelPatients,
      billing: 0,
    }));

    // 7. Department Activity
    const departments = await prisma.department.findMany({
      where: { isActive: true },
      select: { id: true, name: true, departmentType: true },
      take: 6,
    });

    const departmentActivity = departments.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.departmentType,
      patients: 0,
      billing: 0,
      status: 'Normal Flow' as const,
      statusColor: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    }));

    // 7.1 Doctors on Duty — real roster: Staff (name/department/designation),
    // current shift from StaffEmploymentHistory (effectiveTo: null = current
    // row), and this period's booked Appointment count grouped by doctor.
    const doctorStaff = await prisma.staff.findMany({
      where: {
        isActive: true,
        employmentStatus: 'ACTIVE',
        category: { contains: 'Doctor', mode: 'insensitive' },
      },
      select: {
        id: true,
        fullName: true,
        designation: true,
        department: { select: { name: true } },
      },
      orderBy: { fullName: 'asc' },
      take: 10,
    });

    const doctorStaffIds = doctorStaff.map((d) => d.id);

    const [currentShiftAssignments, doctorAppointmentCounts] = await Promise.all([
      doctorStaffIds.length === 0
        ? Promise.resolve([])
        : prisma.staffEmploymentHistory.findMany({
            where: { staffId: { in: doctorStaffIds }, effectiveTo: null },
            select: { staffId: true, shiftName: true, shiftStart: true, shiftEnd: true },
          }),
      doctorStaffIds.length === 0
        ? Promise.resolve([])
        : prisma.appointment.groupBy({
            by: ['doctorStaffId'],
            where: { doctorStaffId: { in: doctorStaffIds }, slotAt: { gte: periodStart, lte: periodEnd } },
            _count: { _all: true },
          }),
    ]);

    const shiftByStaffId = new Map(currentShiftAssignments.map((a) => [a.staffId, a]));
    const appointmentCountByStaffId = new Map(doctorAppointmentCounts.map((a) => [a.doctorStaffId, a._count._all]));

    const formatShiftTime = (d: Date | null) =>
      d ? d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }) : null;

    const doctorsOnDuty: SuperAdminDashboardData['doctorsOnDuty'] = doctorStaff.map((d) => {
      const shift = shiftByStaffId.get(d.id);
      const patientsBooked = appointmentCountByStaffId.get(d.id) ?? 0;
      const shiftLabel =
        shift?.shiftStart && shift?.shiftEnd
          ? `${formatShiftTime(shift.shiftStart)} - ${formatShiftTime(shift.shiftEnd)}`
          : shift?.shiftName || 'Not Scheduled';

      return {
        id: d.id,
        name: d.fullName,
        department: d.department?.name || 'Unassigned',
        designation: d.designation || 'Doctor',
        shiftLabel,
        patientsBooked,
        status: patientsBooked > 0 ? 'On Duty' : 'On Roster',
      };
    });

    // 8. Recent Activity (from AuditLog)
    const recentAuditLogs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: {
        actor: {
          select: { displayName: true, username: true, role: true },
        },
      },
    });

    const recentActivity = recentAuditLogs.map((log) => {
      const userLabel = log.actor?.displayName || log.actor?.username || 'System Administrator';
      const roleLabel = log.actor?.role || 'SYSTEM';
      const dateStr = log.createdAt.toLocaleTimeString('en-PK', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return {
        id: log.id,
        timestamp: dateStr,
        user: userLabel,
        role: roleLabel,
        action: log.action,
        module: log.entityType,
        reference: log.entityId ? log.entityId.slice(0, 8).toUpperCase() : 'SYS',
      };
    });

    // 8.1 Recent Transactions (from real HospitalInvoice table)
    const recentInvoices = await prisma.hospitalInvoice.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        panelPatient: { select: { fullName: true } },
        selfPayEncounter: { select: { fullName: true } },
        createdByUser: { select: { displayName: true, username: true, role: true } },
      },
    });

    const recentTransactions: SuperAdminDashboardData['recentTransactions'] = recentInvoices.map((inv) => {
      const patientName = inv.panelPatient?.fullName || inv.selfPayEncounter?.fullName || 'Walk-in Patient';
      const status: 'Paid' | 'Partially Paid' | 'Refunded' | 'Pending Settlement' =
        inv.status === 'PAID'
          ? 'Paid'
          : inv.status === 'PARTIALLY_PAID'
          ? 'Partially Paid'
          : inv.status === 'VOID'
          ? 'Refunded'
          : 'Pending Settlement';

      const timeStr = inv.createdAt.toLocaleTimeString('en-PK', {
        hour: '2-digit',
        minute: '2-digit',
      });

      return {
        reference: inv.invoiceNumber,
        patientName,
        transactionType: 'Invoice' as const,
        amount: Number(inv.total || 0),
        paymentStatus: status,
        user: inv.createdByUser?.displayName || inv.createdByUser?.username || 'Billing Staff',
        userRole: inv.createdByUser?.role || 'Staff',
        timestamp: timeStr,
      };
    });

    // 9. Attention Required Alerts
    const attentionAlerts: SuperAdminDashboardData['attentionAlerts'] = [];

    if (outOfStockCount > 0) {
      attentionAlerts.push({
        id: 'alert_out_of_stock',
        severity: 'critical',
        title: 'Out of Stock Items in Store',
        description: `${outOfStockCount} inventory items currently have zero remaining balance in the central store.`,
        metric: `${outOfStockCount} Items`,
        actionLabel: 'Inspect Inventory',
        navModule: 'inventory_overview',
      });
    }

    if (lowStockCount > 0) {
      attentionAlerts.push({
        id: 'alert_low_stock',
        severity: 'warning',
        title: 'Reorder Level Threshold Warning',
        description: `${lowStockCount} medical/surgical items have hit minimum safety reorder thresholds.`,
        metric: `${lowStockCount} Items`,
        actionLabel: 'View Inventory',
        navModule: 'inventory_overview',
      });
    }

    if (overallOccupancyPercent >= 90) {
      attentionAlerts.push({
        id: 'alert_bed_critical',
        severity: 'critical',
        title: 'Hospital Inpatient Capacity Alert',
        description: `Total bed occupancy has reached ${overallOccupancyPercent}%. Inpatient wards are near capacity.`,
        metric: `${overallOccupancyPercent}% Capacity`,
        actionLabel: 'View Wards / Beds',
        navModule: 'wards_rooms_beds',
      });
    }

    if (outstandingAmount > 50000) {
      attentionAlerts.push({
        id: 'alert_high_outstanding',
        severity: 'warning',
        title: 'High Cumulative Patient Outstanding',
        description: `Total pending invoice balance for the selected period stands at PKR ${outstandingAmount.toLocaleString()}.`,
        metric: `PKR ${outstandingAmount.toLocaleString()}`,
        actionLabel: 'View Invoices',
        navModule: 'billing_overview',
      });
    }

    // 10. Construct Top KPI Cards
    const totalPatientsInPeriod = opdAppointmentsCount + emergencyInvoicesCount + observationInvoicesCount + admissionsCount;

    const kpis: SuperAdminDashboardData['kpis'] = [
      {
        id: 'kpi_today_patients',
        title: `${periodLabel}'s Patients`,
        value: totalPatientsInPeriod.toLocaleString(),
        numericValue: totalPatientsInPeriod,
        iconName: 'Users',
        contextText: `${opdAppointmentsCount} OPD, ${emergencyInvoicesCount} ER, ${admissionsCount} IPD`,
        colorClass: 'text-[#08775A]',
        accentBg: 'bg-emerald-50',
        navModule: 'today_patients',
      },
      {
        id: 'kpi_today_billing',
        title: `${periodLabel}'s Billing`,
        value: `PKR ${netBilling.toLocaleString()}`,
        numericValue: netBilling,
        iconName: 'Receipt',
        contextText: `${invoices.length} invoices generated`,
        colorClass: 'text-[#08775A]',
        accentBg: 'bg-emerald-50',
        navModule: 'billing_overview',
      },
      {
        id: 'kpi_today_collections',
        title: `${periodLabel}'s Collections`,
        value: `PKR ${paidAmount.toLocaleString()}`,
        numericValue: paidAmount,
        iconName: 'CreditCard',
        contextText: `PKR ${outstandingAmount.toLocaleString()} outstanding`,
        colorClass: 'text-emerald-700',
        accentBg: 'bg-emerald-50',
        navModule: 'collections',
      },
      {
        id: 'kpi_active_staff',
        title: 'Active Hospital Staff',
        value: totalStaffCount.toString(),
        numericValue: totalStaffCount,
        iconName: 'Users',
        contextText: `${doctorsCount} registered doctors`,
        colorClass: 'text-indigo-600',
        accentBg: 'bg-indigo-50',
        navModule: 'staff_users',
      },
      {
        id: 'kpi_bed_occupancy',
        title: 'Bed Occupancy Rate',
        value: `${overallOccupancyPercent}%`,
        numericValue: overallOccupancyPercent,
        iconName: 'Bed',
        contextText: `${occupiedBeds} occupied / ${totalBeds} total beds`,
        colorClass: overallOccupancyPercent > 80 ? 'text-rose-600' : 'text-blue-600',
        accentBg: overallOccupancyPercent > 80 ? 'bg-rose-50' : 'bg-blue-50',
        navModule: 'wards_rooms_beds',
      },
      {
        id: 'kpi_active_panels',
        title: 'Corporate Panels',
        value: activePanelsCount.toString(),
        numericValue: activePanelsCount,
        iconName: 'Building2',
        contextText: `${activePanelPatientsCount} registered panel patients`,
        colorClass: 'text-purple-600',
        accentBg: 'bg-purple-50',
        navModule: 'corporate_panels',
      },
      {
        id: 'kpi_departments',
        title: 'Active Departments',
        value: activeDepartmentsCount.toString(),
        numericValue: activeDepartmentsCount,
        iconName: 'Layers',
        contextText: 'Clinical, Admin & Emergency',
        colorClass: 'text-teal-600',
        accentBg: 'bg-teal-50',
        navModule: 'departments',
      },
      {
        id: 'kpi_stock_alerts',
        title: 'Inventory Stock Alerts',
        value: (lowStockCount + outOfStockCount).toString(),
        numericValue: lowStockCount + outOfStockCount,
        iconName: 'Package',
        contextText: `${outOfStockCount} out of stock, ${lowStockCount} low`,
        colorClass: outOfStockCount > 0 ? 'text-amber-600' : 'text-slate-600',
        accentBg: outOfStockCount > 0 ? 'bg-amber-50' : 'bg-slate-50',
        navModule: 'inventory_overview',
      },
    ];

    return {
      period: {
        preset: query.preset || 'today',
        startDate: periodStart.toISOString(),
        endDate: periodEnd.toISOString(),
        label: periodLabel,
      },
      infrastructure: {
        activeDepartmentsCount,
        totalStaffCount,
        doctorsCount,
        activePanelsCount,
        activePanelPatientsCount,
        activeAdminsCount,
      },
      bedMetrics: {
        totalBeds,
        occupiedBeds,
        availableBeds,
        occupancyPercent: overallOccupancyPercent,
        totalWards: wards.length,
        totalRooms,
        wards: wardSummaries,
      },
      billingSummary: {
        totalInvoices: invoices.length,
        grossBilling,
        discounts,
        netBilling,
        paidAmount,
        partiallyPaidAmount,
        partiallyPaidInvoicesCount,
        outstandingAmount,
        refundsAmount,
      },
      revenueChannels,
      paymentMethods,
      patientFlow,
      inventorySummary: {
        totalItemsCount: stockItems.length,
        lowStockItemsCount: lowStockCount,
        outOfStockItemsCount: outOfStockCount,
        pendingStockRequestsCount: 0,
        flaggedItems: topFlaggedStockItems,
      },
      pharmacySummary: {
        salesAmount: pharmacySalesAmount,
        invoicesCount: pharmacyInvoicesCount,
        medicinesDispensedCount: 0,
        pendingRequestsCount: 0,
        returnsCount: 0,
        returnsAmount: 0,
        nearExpiryAlertsCount: 0,
      },
      corporatePanels: {
        activePanelsCount,
        panelPatientsCount: activePanelPatientsCount,
        panelBillingAmount,
        panelOutstandingAmount: 0,
        topPanels,
      },
      departmentActivity,
      doctorsOnDuty,
      attentionAlerts,
      recentActivity,
      recentTransactions,
      kpis,
    };
  },
};
