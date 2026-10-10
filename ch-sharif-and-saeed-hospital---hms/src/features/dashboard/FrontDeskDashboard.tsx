import React, { useEffect, useState, useMemo } from 'react';
import {
  TrendingUp,
  Package,
  FileText,
  AlertTriangle,
  AlertCircle,
  CalendarX,
  ShoppingCart,
  ShoppingBag,
  Plus,
  BarChart3,
  Activity,
  ShieldCheck,
  Search,
  Filter,
  Download,
  MoreVertical,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Clock,
  Sparkles,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Stethoscope,
  Eye,
  BedDouble,
  FlaskConical,
  Coins,
  CreditCard,
  Banknote,
  Users,
  Receipt,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  Monitor,
  Printer,
  X,
  ClipboardList,
  CheckSquare,
  ExternalLink,
} from 'lucide-react';
import { formatPKR } from '../../utils/formatters';
import { useRouter } from '../../context/RouterContext';
import { useAuth } from '../../context/AuthContext';
import { frontdeskApiService, appointmentsApiService } from '../../services/frontdeskApiService';
import { fetchAdmissions } from '../../services/admissionService';
import { getAllPatients, primePatientRegistryCache } from '../../services/patientRegistryService';
import { getHospitalCurrentDate, formatDateISO } from '../../utils/dateConstants';
import { InvoiceDetailModal, InvoiceModalAction } from '../frontDesk/billing/InvoiceDetailModal';

// Shadcn UI components
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';

// Recharts for live day-wise & shift trend analytics
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from 'recharts';

interface DashboardState {
  todayAppointmentsCount: number;
  todayAdmissionsCount: number;
  opdCount: number;
  observationCount: number;
  emergencyCount: number;
  customBillingCount: number;
  todayInvoicesCount: number;
  outstandingBalance: number;
  cashCollected: number;
  onlineCollected: number;
  unsettledCount: number;
  recentPatients: Array<{ id: string; name: string; mrn: string; payerType: string; registeredAt: string }>;
  recentInvoices: Array<{ id: string; invoiceNumber: string; patient: string; encounterType: string; net: number; paid: number; due: number; status: string; createdAt: string }>;
  recentAdmissions: Array<{ id: string; admissionNumber: string; patient: string; mrn: string; department: string; doctor: string; bed: string; status: string; admittedAt: string }>;
  recentTransactions: Array<{ id: string; receiptNumber: string | null; invoiceNumber: string | null; amount: number; method: string; occurredAt: string }>;
}

const EMPTY_STATE: DashboardState = {
  todayAppointmentsCount: 0,
  todayAdmissionsCount: 0,
  opdCount: 0,
  observationCount: 0,
  emergencyCount: 0,
  customBillingCount: 0,
  todayInvoicesCount: 0,
  outstandingBalance: 0,
  cashCollected: 0,
  onlineCollected: 0,
  unsettledCount: 0,
  recentPatients: [],
  recentInvoices: [],
  recentAdmissions: [],
  recentTransactions: [],
};

// Dynamic greeting matching PharmaCare ERP
function getGreeting(name: string): string {
  const hour = new Date().getHours();
  let timeStr = 'Morning';
  if (hour >= 12 && hour < 17) timeStr = 'Afternoon';
  else if (hour >= 17) timeStr = 'Evening';
  const firstName = name.split(' ')[0] || 'Front Desk';
  return `Good ${timeStr}, ${firstName}`;
}

// Mini Sparkline component with SVG gradient fill (matching PharmaCare reference)
const Sparkline: React.FC<{ stroke: string; fill: string; trendUp?: boolean }> = ({ stroke, fill, trendUp = true }) => {
  const points = trendUp
    ? 'M0,28 C20,24 40,29 60,18 C80,8 100,14 120,4'
    : 'M0,8 C20,12 40,8 60,18 C80,26 100,20 120,28';
  const fillPath = `${points} L120,32 L0,32 Z`;
  const gradId = `spark-${stroke.replace('#', '')}-${trendUp ? 'up' : 'down'}`;

  return (
    <svg className="w-full h-8 overflow-visible" viewBox="0 0 120 32" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.28" />
          <stop offset="100%" stopColor={fill} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradId})`} />
      <path d={points} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
};

export const FrontDeskDashboard: React.FC = () => {
  const { navigate } = useRouter();
  const { currentUser } = useAuth();

  const [data, setData] = useState<DashboardState>(EMPTY_STATE);
  const [rawInvoices, setRawInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab & Filter states
  const [activeTab, setActiveTab] = useState<'invoices' | 'admissions' | 'transactions'>('invoices');
  const [tableSearch, setTableSearch] = useState('');
  const [timeframe, setTimeframe] = useState<'7d' | '14d' | '30d' | 'today'>('7d');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tableFilter, setTableFilter] = useState<'ALL' | 'OPD' | 'OBSERVATION' | 'EMERGENCY' | 'CUSTOM'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PAID' | 'PARTIALLY_PAID' | 'UNPAID'>('ALL');

  // Modal interactive state
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [modalInitialAction, setModalInitialAction] = useState<InvoiceModalAction | undefined>(undefined);

  const fetchDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const today = formatDateISO(getHospitalCurrentDate());
      await primePatientRegistryCache();

      const [appointmentsRes, invoicesRes, cashRes, admissionsRes] = await Promise.all([
        appointmentsApiService.getAppointments({ date: today }).catch(() => []),
        frontdeskApiService.getInvoices().catch(() => []),
        frontdeskApiService.getCashBalance().catch(() => null),
        fetchAdmissions().catch(() => []),
      ]);

      const allInvoices = invoicesRes as any[];
      setRawInvoices(allInvoices);

      const todayInvoices = allInvoices.filter((inv) => String(inv.createdAt).slice(0, 10) === today);
      const opdCount = todayInvoices.filter((inv) => inv.encounterType === 'OPD').length;
      const observationCount = todayInvoices.filter((inv) => inv.encounterType === 'OBSERVATION').length;
      const emergencyCount = todayInvoices.filter((inv) => inv.encounterType === 'EMERGENCY').length;
      const customBillingCount = todayInvoices.filter((inv) => inv.encounterType === 'CUSTOM').length;

      const outstandingBalance = allInvoices.reduce((sum, inv) => {
        const net = Number(inv.total ?? 0);
        const paid = Number(inv.paidTotal ?? 0);
        const patientShare = inv.panelPatientId ? Number(inv.patientShare ?? 0) : net;
        const due = inv.balanceDue !== undefined && inv.balanceDue !== null
          ? Number(inv.balanceDue)
          : Math.max(0, patientShare - paid);
        return sum + (Number.isFinite(due) ? due : 0);
      }, 0);

      const recentInvoices = allInvoices.slice(0, 15).map((inv) => {
        const net = Number(inv.total ?? 0);
        const paid = Number(inv.paidTotal ?? 0);
        const patientShare = inv.panelPatientId ? Number(inv.patientShare ?? 0) : net;
        const due = inv.balanceDue !== undefined && inv.balanceDue !== null
          ? Number(inv.balanceDue)
          : Math.max(0, patientShare - paid);
        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          patient: inv.panelPatient?.fullName || inv.selfPayEncounter?.fullName || 'Walk-in Patient',
          encounterType: inv.encounterType || 'OPD',
          net,
          paid,
          due,
          status: inv.status,
          createdAt: inv.createdAt,
        };
      });

      const patients = getAllPatients();
      const recentPatients = [...patients]
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, 8)
        .map((p) => ({ id: p.id, name: p.fullName, mrn: p.mrNumber, payerType: p.payerType, registeredAt: p.registrationDate }));

      const allAdmissions = admissionsRes as any[];
      const todayAdmissionsCount = allAdmissions.filter((a) => (a.createdAtIso || a.createdAt || '').slice(0, 10) === today).length;

      const recentAdmissions = allAdmissions.slice(0, 12).map((a: any) => ({
        id: a.id,
        admissionNumber: a.admissionNumber || 'ADM',
        patient: a.patientName || 'Inpatient',
        mrn: a.patientMrNumber || '—',
        department: a.departmentName || 'General Ward',
        doctor: a.doctorName || 'Attending Physician',
        bed: a.bedLabel || 'Pending Bed',
        status: a.status || 'ACTIVE',
        admittedAt: a.admittedAt || a.createdAt || '',
      }));

      const recentTransactions = cashRes?.transactions
        ? cashRes.transactions.slice(0, 12).map((t: any) => ({
            id: t.id,
            receiptNumber: t.receiptNumber,
            invoiceNumber: t.invoiceNumber,
            amount: Number(t.amount ?? 0),
            method: t.paymentMethod,
            occurredAt: t.occurredAt,
          }))
        : [];

      setData({
        todayAppointmentsCount: (appointmentsRes as any[]).length,
        todayAdmissionsCount,
        opdCount,
        observationCount,
        emergencyCount,
        customBillingCount,
        todayInvoicesCount: todayInvoices.length,
        outstandingBalance,
        cashCollected: cashRes ? Number(cashRes.summary?.physicalCashIn ?? 0) : 0,
        onlineCollected: cashRes ? Number(cashRes.summary?.nonPhysicalTotal ?? 0) : 0,
        unsettledCount: cashRes ? Number(cashRes.summary?.unsettledCount ?? 0) : 0,
        recentPatients,
        recentInvoices,
        recentAdmissions,
        recentTransactions,
      });
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err?.message || 'Failed to load Front Desk dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const totalShiftRevenue = useMemo(() => {
    return data.cashCollected + data.onlineCollected;
  }, [data.cashCollected, data.onlineCollected]);

  const totalEncounters = useMemo(() => {
    return data.opdCount + data.observationCount + data.emergencyCount + data.todayAdmissionsCount + data.customBillingCount;
  }, [data.opdCount, data.observationCount, data.emergencyCount, data.todayAdmissionsCount, data.customBillingCount]);

  // Real day-wise or hourly trend items computed dynamically from live database records
  const trendItems = useMemo(() => {
    const todayIso = formatDateISO(getHospitalCurrentDate());

    if (timeframe === 'today') {
      // Real hourly shift breakdown for today: 2-hour operational buckets
      const slots = [
        { label: '08:00', startH: 8, endH: 10 },
        { label: '10:00', startH: 10, endH: 12 },
        { label: '12:00', startH: 12, endH: 14 },
        { label: '14:00', startH: 14, endH: 16 },
        { label: '16:00', startH: 16, endH: 18 },
        { label: '18:00', startH: 18, endH: 20 },
        { label: '20:00+', startH: 20, endH: 24 },
      ];

      const todayInvoices = rawInvoices.filter((inv) => {
        if (!inv.createdAt) return false;
        return formatDateISO(new Date(inv.createdAt)) === todayIso;
      });

      const todayTx = (data.recentTransactions || []).filter((tx: any) => {
        if (!tx.occurredAt) return false;
        return formatDateISO(new Date(tx.occurredAt)) === todayIso;
      });

      return slots.map((slot) => {
        const slotInvs = todayInvoices.filter((inv) => {
          const h = new Date(inv.createdAt).getHours();
          return h >= slot.startH && h < slot.endH;
        });
        const slotTx = todayTx.filter((tx: any) => {
          const h = new Date(tx.occurredAt).getHours();
          return h >= slot.startH && h < slot.endH;
        });

        const billed = slotInvs.reduce((s, inv) => s + Number(inv.total ?? 0), 0);
        const txCash = slotTx.filter((t: any) => t.method === 'CASH').reduce((s, t) => s + Number(t.amount ?? 0), 0);
        const txTotal = slotTx.reduce((s, t) => s + Number(t.amount ?? 0), 0);
        const invPaid = slotInvs.reduce((s, inv) => s + Number(inv.paidTotal ?? 0), 0);

        return {
          label: slot.label,
          fullDate: `Today, ${slot.label} Window`,
          billed,
          collections: Math.max(txTotal, invPaid),
          cash: Math.max(txCash, invPaid),
          encounters: slotInvs.length,
        };
      });
    }

    // Day-wise distribution (7d, 14d, 30d)
    const daysCount = timeframe === '30d' ? 30 : timeframe === '14d' ? 14 : 7;
    const days: Array<{
      label: string;
      fullDate: string;
      billed: number;
      collections: number;
      cash: number;
      encounters: number;
    }> = [];
    const now = getHospitalCurrentDate();

    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = formatDateISO(d);
      const dayLabel = i === 0 ? 'Today' : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
      const fullDate = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

      const dayInvoices = rawInvoices.filter((inv) => {
        if (!inv.createdAt) return false;
        return formatDateISO(new Date(inv.createdAt)) === dateStr;
      });

      const dayTx = (data.recentTransactions || []).filter((tx: any) => {
        if (!tx.occurredAt) return false;
        return formatDateISO(new Date(tx.occurredAt)) === dateStr;
      });

      const billed = dayInvoices.reduce((s, inv) => s + Number(inv.total ?? 0), 0);
      const txCash = dayTx.filter((t: any) => t.method === 'CASH').reduce((s, t) => s + Number(t.amount ?? 0), 0);
      const txTotal = dayTx.reduce((s, t) => s + Number(t.amount ?? 0), 0);
      const invPaid = dayInvoices.reduce((s, inv) => s + Number(inv.paidTotal ?? 0), 0);

      // If today, incorporate live drawer physical cash & non-physical
      const collections = i === 0
        ? Math.max(txTotal, invPaid, data.cashCollected + data.onlineCollected)
        : Math.max(txTotal, invPaid);

      const cash = i === 0
        ? Math.max(data.cashCollected, txCash, invPaid)
        : txCash;

      const encounters = i === 0
        ? Math.max(dayInvoices.length, data.todayInvoicesCount)
        : dayInvoices.length;

      days.push({
        label: dayLabel,
        fullDate,
        billed: i === 0 && billed === 0 ? collections : billed,
        collections,
        cash,
        encounters,
      });
    }

    return days;
  }, [timeframe, rawInvoices, data]);

  // Aggregate metrics for the selected period
  const periodStats = useMemo(() => {
    const todayIso = formatDateISO(getHospitalCurrentDate());

    if (timeframe === 'today') {
      const todayInvs = rawInvoices.filter((inv) => formatDateISO(new Date(inv.createdAt)) === todayIso);
      const billed = todayInvs.reduce((s, inv) => s + Number(inv.total ?? 0), 0);
      const due = todayInvs.reduce((s, inv) => {
        const d = inv.balanceDue !== undefined && inv.balanceDue !== null
          ? Number(inv.balanceDue)
          : Math.max(0, Number(inv.total ?? 0) - Number(inv.paidTotal ?? 0));
        return s + (d > 0 ? d : 0);
      }, 0);

      return {
        billed: billed > 0 ? billed : (data.cashCollected + data.onlineCollected + data.outstandingBalance),
        invoiceCount: todayInvs.length || data.todayInvoicesCount,
        cash: data.cashCollected,
        digital: data.onlineCollected,
        due,
      };
    }

    const daysCount = timeframe === '30d' ? 30 : timeframe === '14d' ? 14 : 7;
    const cutoff = getHospitalCurrentDate();
    cutoff.setDate(cutoff.getDate() - (daysCount - 1));
    cutoff.setHours(0, 0, 0, 0);
    const cutoffIso = formatDateISO(cutoff);

    const periodInvs = rawInvoices.filter((inv) => {
      if (!inv.createdAt) return false;
      return formatDateISO(new Date(inv.createdAt)) >= cutoffIso;
    });

    const billed = periodInvs.reduce((s, inv) => s + Number(inv.total ?? 0), 0);
    const due = periodInvs.reduce((s, inv) => {
      const d = inv.balanceDue !== undefined && inv.balanceDue !== null
        ? Number(inv.balanceDue)
        : Math.max(0, Number(inv.total ?? 0) - Number(inv.paidTotal ?? 0));
      return s + (d > 0 ? d : 0);
    }, 0);

    const periodTx = (data.recentTransactions || []).filter((tx: any) => {
      if (!tx.occurredAt) return false;
      return formatDateISO(new Date(tx.occurredAt)) >= cutoffIso;
    });

    const cash = Math.max(data.cashCollected, periodTx.filter(t => t.method === 'CASH').reduce((s, t) => s + Number(t.amount ?? 0), 0));
    const digital = Math.max(data.onlineCollected, periodTx.filter(t => t.method !== 'CASH').reduce((s, t) => s + Number(t.amount ?? 0), 0));

    return {
      billed: billed > 0 ? billed : (cash + digital + due),
      invoiceCount: Math.max(periodInvs.length, data.todayInvoicesCount),
      cash,
      digital,
      due,
    };
  }, [timeframe, rawInvoices, data]);

  // Encounter distribution data for Donut Chart
  const distributionData = [
    { label: 'OPD Clinics', dept: 'OPD' as const, count: data.opdCount, color: '#10b981' },
    { label: 'Observation', dept: 'OBSERVATION' as const, count: data.observationCount, color: '#6366f1' },
    { label: 'Emergency', dept: 'EMERGENCY' as const, count: data.emergencyCount, color: '#f43f5e' },
    { label: 'Admissions', dept: 'ALL' as const, count: data.todayAdmissionsCount, color: '#0284c7' },
    { label: 'Diagnostic/Lab', dept: 'CUSTOM' as const, count: data.customBillingCount, color: '#f59e0b' },
  ];

  const totalDistCount = distributionData.reduce((s, d) => s + d.count, 0) || 1;
  const donutR = 52;
  const donutCircumference = 2 * Math.PI * donutR;
  let accumulatedAngle = 0;

  // Filter table rows (Invoices)
  const filteredInvoices = useMemo(() => {
    let rows = data.recentInvoices;
    if (tableFilter !== 'ALL') {
      rows = rows.filter((r) => r.encounterType === tableFilter);
    }
    if (statusFilter !== 'ALL') {
      rows = rows.filter((r) => {
        if (statusFilter === 'PAID') return r.status === 'PAID';
        if (statusFilter === 'PARTIALLY_PAID') return r.status === 'PARTIALLY_PAID';
        if (statusFilter === 'UNPAID') return r.status === 'UNPAID' || r.status === 'PENDING';
        return true;
      });
    }
    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.invoiceNumber.toLowerCase().includes(q) ||
          r.patient.toLowerCase().includes(q) ||
          r.status.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [data.recentInvoices, tableFilter, statusFilter, tableSearch]);

  // Filter admissions rows
  const filteredAdmissions = useMemo(() => {
    let rows = data.recentAdmissions;
    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase();
      rows = rows.filter(
        (a) =>
          a.admissionNumber.toLowerCase().includes(q) ||
          a.patient.toLowerCase().includes(q) ||
          a.mrn.toLowerCase().includes(q) ||
          a.department.toLowerCase().includes(q) ||
          a.bed.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [data.recentAdmissions, tableSearch]);

  // Filter transactions rows
  const filteredTransactions = useMemo(() => {
    let rows = data.recentTransactions;
    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase();
      rows = rows.filter(
        (t) =>
          (t.receiptNumber || '').toLowerCase().includes(q) ||
          (t.invoiceNumber || '').toLowerCase().includes(q) ||
          t.method.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [data.recentTransactions, tableSearch]);

  // Pharmacy-style pagination & export states
  const [pageSize, setPageSize] = useState(15);
  const [currentPage, setCurrentPage] = useState(1);

  const paginatedInvoices = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredInvoices.slice(start, start + pageSize);
  }, [filteredInvoices, currentPage, pageSize]);

  const paginatedAdmissions = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAdmissions.slice(start, start + pageSize);
  }, [filteredAdmissions, currentPage, pageSize]);

  const paginatedTransactions = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTransactions.slice(start, start + pageSize);
  }, [filteredTransactions, currentPage, pageSize]);

  // Export to CSV matching Pharmacy format
  const handleExportCsv = () => {
    if (activeTab === 'invoices') {
      const headers = ['#', 'Invoice Number', 'Patient', 'Care Queue', 'Net Amount', 'Balance Due', 'Status'];
      const rows = filteredInvoices.map((inv, idx) => [
        idx + 1,
        `"${inv.invoiceNumber}"`,
        `"${inv.patient}"`,
        `"${inv.encounterType}"`,
        inv.net,
        inv.due,
        `"${inv.status}"`
      ]);
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `frontdesk_invoices_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
    } else if (activeTab === 'admissions') {
      const headers = ['#', 'Admission Number', 'Patient', 'MRN', 'Department', 'Bed', 'Doctor', 'Status'];
      const rows = filteredAdmissions.map((adm, idx) => [
        idx + 1,
        `"${adm.admissionNumber}"`,
        `"${adm.patient}"`,
        `"${adm.mrn}"`,
        `"${adm.department}"`,
        `"${adm.bed}"`,
        `"${adm.doctor}"`,
        `"${adm.status}"`
      ]);
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `frontdesk_admissions_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
    } else {
      const headers = ['#', 'Receipt Number', 'Invoice Number', 'Payment Method', 'Amount', 'Time'];
      const rows = filteredTransactions.map((tx, idx) => [
        idx + 1,
        `"${tx.receiptNumber || 'RCP-LIVE'}"`,
        `"${tx.invoiceNumber || '—'}"`,
        `"${tx.method}"`,
        tx.amount,
        `"${tx.occurredAt ? String(tx.occurredAt).slice(11, 16) : 'Just Now'}"`
      ]);
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `frontdesk_receipts_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
    }
  };

  // Export to Excel matching Pharmacy format
  const handleExportExcel = () => {
    let titleStr = 'Front Desk Invoices';
    let headers: string[] = [];
    let rowsHtml = '';

    if (activeTab === 'invoices') {
      titleStr = 'Front Desk Invoices & Encounters';
      headers = ['#', 'Invoice Number', 'Patient', 'Care Queue', 'Net Amount', 'Balance Due', 'Status'];
      rowsHtml = filteredInvoices.map((inv, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${inv.invoiceNumber}</td>
          <td>${inv.patient}</td>
          <td>${inv.encounterType}</td>
          <td>${inv.net}</td>
          <td>${inv.due}</td>
          <td>${inv.status}</td>
        </tr>
      `).join('');
    } else if (activeTab === 'admissions') {
      titleStr = 'Front Desk Active Admissions';
      headers = ['#', 'Admission Number', 'Patient', 'MRN', 'Department', 'Bed', 'Doctor', 'Status'];
      rowsHtml = filteredAdmissions.map((adm, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${adm.admissionNumber}</td>
          <td>${adm.patient}</td>
          <td>${adm.mrn}</td>
          <td>${adm.department}</td>
          <td>${adm.bed}</td>
          <td>${adm.doctor}</td>
          <td>${adm.status}</td>
        </tr>
      `).join('');
    } else {
      titleStr = 'Front Desk Cash Drawer Receipts';
      headers = ['#', 'Receipt Number', 'Invoice Number', 'Payment Method', 'Amount', 'Time'];
      rowsHtml = filteredTransactions.map((tx, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${tx.receiptNumber || 'RCP-LIVE'}</td>
          <td>${tx.invoiceNumber || '—'}</td>
          <td>${tx.method}</td>
          <td>${tx.amount}</td>
          <td>${tx.occurredAt ? String(tx.occurredAt).slice(11, 16) : 'Just Now'}</td>
        </tr>
      `).join('');
    }

    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"/></head>
      <body>
        <h2>${titleStr}</h2>
        <table border="1">
          <tr style="background:#0e5944;color:#ffffff;font-weight:bold;">
            ${headers.map(h => `<th>${h}</th>`).join('')}
          </tr>
          ${rowsHtml}
        </table>
      </body>
      </html>
    `;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `frontdesk_${activeTab}_${new Date().toISOString().slice(0, 10)}.xls`;
    link.click();
  };

  if (loading) {
    return (
      <div className="min-h-[75vh] flex flex-col items-center justify-center text-slate-500 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-[#0e7d5a]" />
        <p className="text-sm font-medium">Loading live Front Desk operations...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-12 text-center space-y-4">
        <div className="inline-flex p-3 rounded-full bg-rose-50 text-rose-600 mb-2">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h3 className="text-base font-bold text-slate-900">Failed to Load Dashboard</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">{error}</p>
        <button
          type="button"
          onClick={fetchDashboard}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0e7d5a] text-white text-xs font-semibold hover:bg-[#0c6b50] transition-colors cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* ═════════════════════════════════════════════════════════════════════
          1. HERO / GREETING BANNER (Matches Reference Photo 1 & 2)
          ═════════════════════════════════════════════════════════════════════ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0c5944] via-[#0e7d5a] to-[#0a664c] text-white p-7 sm:p-9 shadow-lg shadow-emerald-950/10">
        {/* Large watermark hospital cross & pulse emblem */}
        <div className="absolute -right-4 sm:right-2 lg:right-6 top-1/2 -translate-y-1/2 w-64 h-64 sm:w-80 sm:h-80 lg:w-96 lg:h-96 opacity-20 sm:opacity-25 pointer-events-none select-none flex items-center justify-center">
          <svg viewBox="0 0 240 240" fill="none" stroke="currentColor" className="w-full h-full">
            <circle cx="120" cy="120" r="110" strokeWidth="1.5" strokeDasharray="6 6" opacity="0.35" />
            <circle cx="120" cy="120" r="90" strokeWidth="1" strokeDasharray="3 3" opacity="0.2" />
            <path
              d="M100 65 H140 V100 H175 V140 H140 V175 H100 V140 H65 V100 H100 Z"
              strokeWidth="3"
              strokeLinejoin="round"
              opacity="0.8"
            />
            <path
              d="M50 120 H90 L102 98 L114 142 L126 108 L138 132 L148 120 H190"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="relative z-10 max-w-3xl space-y-3.5">
          {/* Status pill badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-900/40 border border-emerald-400/25 text-emerald-200 text-xs font-medium backdrop-blur-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span>All systems operational • Live Front Desk Command</span>
          </div>

          {/* Heading */}
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            {getGreeting(currentUser?.name || currentUser?.username || 'Front Desk')}
          </h2>

          {/* Subtitle */}
          <p className="text-xs sm:text-sm text-emerald-100/90 leading-relaxed font-normal">
            Monitor patient admissions, register walk-in encounters, manage consultant appointments, and ensure smooth hospital front desk cashiering from one centralized dashboard.
          </p>

          {/* Action Row & Live Shift Metrics */}
          <div className="pt-2 flex flex-wrap items-center gap-4 sm:gap-6 text-xs font-medium text-emerald-100">
            <button
              type="button"
              onClick={() => navigate('/front-desk/new_admission')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-[#0e7d5a] font-semibold hover:bg-emerald-50 transition-all shadow-sm cursor-pointer"
            >
              <BedDouble className="h-4 w-4" /> + New Admission
            </button>

            <button
              type="button"
              onClick={() => navigate('/front-desk/appointments')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-800/60 hover:bg-emerald-800/80 border border-emerald-400/30 text-white font-semibold transition-all backdrop-blur-xs cursor-pointer"
            >
              <Calendar className="h-4 w-4" /> Book Appointment
            </button>

            <div className="flex items-center gap-2 border-l border-emerald-400/25 pl-4 sm:pl-6 text-emerald-200">
              <Activity className="h-4 w-4 text-emerald-300" />
              <span>{data.todayInvoicesCount} invoices today</span>
            </div>

            <div className="flex items-center gap-2 text-emerald-200">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              <span>Shift: Morning (08:00 - 16:00)</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════
          2. DIRECT ENCOUNTER & INTAKE ACTION BUTTONS (BIG & PROMINENT)
             (Full-sized interactive action tiles with prominent CTA buttons - clearly differentiated from metric cards)
          ═════════════════════════════════════════════════════════════════════ */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 px-0.5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Quick Patient Intake Action Buttons
            </h3>
            <span className="hidden sm:inline text-xs text-slate-400 font-normal">• Click any button to start walk-in token or admission</span>
          </div>
          <Badge variant="success" className="gap-1 py-1 px-3 text-xs font-semibold">
            {totalEncounters} Encounters Active
          </Badge>
        </div>

        {/* 5 Big, Bold, Prominent Quick-Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Button 1: OPD */}
          <button
            type="button"
            onClick={() => navigate('/front-desk/walk_in_intake?type=OPD')}
            className="w-full p-5 rounded-2xl bg-white border-t-[4px] border-t-emerald-600 border-x border-b border-slate-200/90 hover:border-emerald-500 shadow-sm hover:shadow-xl hover:-translate-y-1 active:translate-y-0 active:scale-[0.99] transition-all text-left flex flex-col justify-between cursor-pointer group"
          >
            <div>
              {/* Top Row: Icon & Live Badge */}
              <div className="flex items-center justify-between mb-3.5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-105 group-hover:bg-emerald-600 group-hover:text-white transition-all shadow-xs">
                  <Stethoscope className="h-6 w-6" />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {data.opdCount} Today
                </span>
              </div>

              {/* Title & Subtitles */}
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Outpatient Clinic</div>
              <div className="text-2xl font-black text-slate-900 group-hover:text-emerald-700 tracking-tight mt-0.5 transition-colors">
                OPD
              </div>
              <p className="text-xs text-slate-500 mt-1 font-normal line-clamp-1">
                Doctor & Clinic Consultation Intake
              </p>
            </div>

            {/* Bottom: Solid Action Button CTA */}
            <div className="mt-5 w-full py-2.5 px-4 rounded-xl bg-emerald-600 group-hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-between shadow-xs transition-colors">
              <span className="flex items-center gap-1.5">+ Fast Walk-In</span>
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* Button 2: OBSV */}
          <button
            type="button"
            onClick={() => navigate('/front-desk/walk_in_intake?type=OBSERVATION')}
            className="w-full p-5 rounded-2xl bg-white border-t-[4px] border-t-indigo-600 border-x border-b border-slate-200/90 hover:border-indigo-500 shadow-sm hover:shadow-xl hover:-translate-y-1 active:translate-y-0 active:scale-[0.99] transition-all text-left flex flex-col justify-between cursor-pointer group"
          >
            <div>
              {/* Top Row: Icon & Live Badge */}
              <div className="flex items-center justify-between mb-3.5">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:scale-105 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-xs">
                  <Eye className="h-6 w-6" />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-800 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-200/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                  {data.observationCount} Today
                </span>
              </div>

              {/* Title & Subtitles */}
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Observation Unit</div>
              <div className="text-2xl font-black text-slate-900 group-hover:text-indigo-700 tracking-tight mt-0.5 transition-colors">
                OBSV
              </div>
              <p className="text-xs text-slate-500 mt-1 font-normal line-clamp-1">
                Day-Care, Drips & Short Monitoring
              </p>
            </div>

            {/* Bottom: Solid Action Button CTA */}
            <div className="mt-5 w-full py-2.5 px-4 rounded-xl bg-indigo-600 group-hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-between shadow-xs transition-colors">
              <span className="flex items-center gap-1.5">+ Fast Walk-In</span>
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* Button 3: ER */}
          <button
            type="button"
            onClick={() => navigate('/front-desk/walk_in_intake?type=EMERGENCY')}
            className="w-full p-5 rounded-2xl bg-white border-t-[4px] border-t-rose-600 border-x border-b border-slate-200/90 hover:border-rose-500 shadow-sm hover:shadow-xl hover:-translate-y-1 active:translate-y-0 active:scale-[0.99] transition-all text-left flex flex-col justify-between cursor-pointer group"
          >
            <div>
              {/* Top Row: Icon & Live Badge */}
              <div className="flex items-center justify-between mb-3.5">
                <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center group-hover:scale-105 group-hover:bg-rose-600 group-hover:text-white transition-all shadow-xs">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-800 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                  {data.emergencyCount} Urgent
                </span>
              </div>

              {/* Title & Subtitles */}
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Emergency Care</div>
              <div className="text-2xl font-black text-slate-900 group-hover:text-rose-700 tracking-tight mt-0.5 transition-colors">
                ER
              </div>
              <p className="text-xs text-slate-500 mt-1 font-normal line-clamp-1">
                Triage, Trauma & Urgent Care Intake
              </p>
            </div>

            {/* Bottom: Solid Action Button CTA */}
            <div className="mt-5 w-full py-2.5 px-4 rounded-xl bg-rose-600 group-hover:bg-rose-700 text-white font-bold text-xs flex items-center justify-between shadow-xs transition-colors">
              <span className="flex items-center gap-1.5">+ Emergency Intake</span>
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* Button 4: ADM+ */}
          <button
            type="button"
            onClick={() => navigate('/front-desk/new_admission')}
            className="w-full p-5 rounded-2xl bg-white border-t-[4px] border-t-sky-600 border-x border-b border-slate-200/90 hover:border-sky-500 shadow-sm hover:shadow-xl hover:-translate-y-1 active:translate-y-0 active:scale-[0.99] transition-all text-left flex flex-col justify-between cursor-pointer group"
          >
            <div>
              {/* Top Row: Icon & Live Badge */}
              <div className="flex items-center justify-between mb-3.5">
                <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center group-hover:scale-105 group-hover:bg-sky-600 group-hover:text-white transition-all shadow-xs">
                  <BedDouble className="h-6 w-6" />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-800 bg-sky-50 px-2.5 py-1 rounded-full border border-sky-200/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                  {data.todayAdmissionsCount} In Ward
                </span>
              </div>

              {/* Title & Subtitles */}
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Inpatient Ward</div>
              <div className="text-2xl font-black text-slate-900 group-hover:text-sky-700 tracking-tight mt-0.5 transition-colors">
                ADM+
              </div>
              <p className="text-xs text-slate-500 mt-1 font-normal line-clamp-1">
                Planned Admission & Bed Booking
              </p>
            </div>

            {/* Bottom: Solid Action Button CTA */}
            <div className="mt-5 w-full py-2.5 px-4 rounded-xl bg-sky-600 group-hover:bg-sky-700 text-white font-bold text-xs flex items-center justify-between shadow-xs transition-colors">
              <span className="flex items-center gap-1.5">+ New Admission</span>
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* Button 5: CUSTOM */}
          <button
            type="button"
            onClick={() => navigate('/front-desk/walk_in_intake?type=CUSTOM')}
            className="w-full p-5 rounded-2xl bg-white border-t-[4px] border-t-amber-500 border-x border-b border-slate-200/90 hover:border-amber-500 shadow-sm hover:shadow-xl hover:-translate-y-1 active:translate-y-0 active:scale-[0.99] transition-all text-left flex flex-col justify-between cursor-pointer group"
          >
            <div>
              {/* Top Row: Icon & Live Badge */}
              <div className="flex items-center justify-between mb-3.5">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:scale-105 group-hover:bg-amber-600 group-hover:text-white transition-all shadow-xs">
                  <FlaskConical className="h-6 w-6" />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {data.customBillingCount} Tests
                </span>
              </div>

              {/* Title & Subtitles */}
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Diagnostics & Lab</div>
              <div className="text-2xl font-black text-slate-900 group-hover:text-amber-700 tracking-tight mt-0.5 transition-colors">
                Custom
              </div>
              <p className="text-xs text-slate-500 mt-1 font-normal line-clamp-1">
                Lab, Radiology & Procedures
              </p>
            </div>

            {/* Bottom: Solid Action Button CTA */}
            <div className="mt-5 w-full py-2.5 px-4 rounded-xl bg-amber-600 group-hover:bg-amber-700 text-white font-bold text-xs flex items-center justify-between shadow-xs transition-colors">
              <span className="flex items-center gap-1.5">+ Fast Billing</span>
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════
          3. SIX KEY METRIC CARDS (Shadcn Card Architecture)
             (Analytical KPI statistics cards with top border stripes, bold values & sparkline wave graphs)
          ═════════════════════════════════════════════════════════════════════ */}
      <div>
        <div className="flex items-center justify-between mb-3 px-0.5">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Shift & Financial Performance Cards
            </h3>
            <span className="text-[11px] font-medium text-slate-400">• Real-time shift collections, dues & invoice analytics</span>
          </div>
          <div className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Live Sync
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
          {/* Card 1: Shift Total Revenue (Info / Blue theme) */}
          <div className="bg-white rounded-2xl border border-slate-200/60 border-t-[3.5px] border-t-blue-600 shadow-[0_2px_8px_rgba(0,0,0,0.03)] p-4 sm:p-5 flex flex-col justify-between hover:shadow-md transition-all">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="h-11 w-11 rounded-xl flex items-center justify-center border shrink-0 bg-blue-50 text-blue-700 border-blue-200">
                  <TrendingUp className="h-5 w-5" />
                </div>
                <Badge variant="success" className="gap-0.5 text-[11px] font-semibold py-0.5 px-2">
                  <ArrowUpRight className="h-3.5 w-3.5" /> +100%
                </Badge>
              </div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
                Shift Revenue
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-slate-900 truncate tabular-nums mt-0.5">
                {formatPKR(totalShiftRevenue)}
              </div>
              <div className="text-[10px] text-slate-400 truncate mt-0.5">
                {data.todayInvoicesCount} invoices billed
              </div>
            </div>
            <div className="mt-3 pt-2">
              <Sparkline stroke="#3b82f6" fill="#3b82f6" trendUp={true} />
            </div>
          </div>

          {/* Card 2: Cash In Drawer (Default / Teal theme) */}
          <div className="bg-white rounded-2xl border border-slate-200/60 border-t-[3.5px] border-t-teal-600 shadow-[0_2px_8px_rgba(0,0,0,0.03)] p-4 sm:p-5 flex flex-col justify-between hover:shadow-md transition-all">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="h-11 w-11 rounded-xl flex items-center justify-center border shrink-0 bg-[#effaf5] text-[#0e7d5a] border-[#c2e7db]">
                  <Banknote className="h-5 w-5" />
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="h-3 w-3" /> Drawer
                </span>
              </div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
                Cash Collected
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-slate-900 truncate tabular-nums mt-0.5">
                {formatPKR(data.cashCollected)}
              </div>
              <div className="text-[10px] text-slate-400 truncate mt-0.5">
                {data.unsettledCount} pending shift receipts
              </div>
            </div>
            <div className="mt-3 pt-2">
              <Sparkline stroke="#0d9488" fill="#0d9488" trendUp={true} />
            </div>
          </div>

          {/* Card 3: Digital & POS (Success / Emerald theme) */}
          <div className="bg-white rounded-2xl border border-slate-200/60 border-t-[3.5px] border-t-emerald-600 shadow-[0_2px_8px_rgba(0,0,0,0.03)] p-4 sm:p-5 flex flex-col justify-between hover:shadow-md transition-all">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="h-11 w-11 rounded-xl flex items-center justify-center border shrink-0 bg-emerald-50 text-emerald-700 border-emerald-200">
                  <CreditCard className="h-5 w-5" />
                </div>
                <Badge variant="success" className="gap-1 text-[11px] font-semibold py-0.5 px-2">
                  <Clock className="h-3.5 w-3.5" /> Card / Bank
                </Badge>
              </div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
                Digital & POS
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-slate-900 truncate tabular-nums mt-0.5">
                {formatPKR(data.onlineCollected)}
              </div>
              <div className="text-[10px] text-slate-400 truncate mt-0.5">
                Card, online & bank transfer
              </div>
            </div>
            <div className="mt-3 pt-2">
              <Sparkline stroke="#10b981" fill="#10b981" trendUp={true} />
            </div>
          </div>

          {/* Card 4: Outstanding Receivables (Warning / Amber theme) */}
          <div className="bg-white rounded-2xl border border-slate-200/60 border-t-[3.5px] border-t-amber-500 shadow-[0_2px_8px_rgba(0,0,0,0.03)] p-4 sm:p-5 flex flex-col justify-between hover:shadow-md transition-all">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="h-11 w-11 rounded-xl flex items-center justify-center border shrink-0 bg-amber-50 text-amber-700 border-amber-200">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  data.outstandingBalance > 0
                    ? 'text-amber-800 bg-amber-50 border-amber-200'
                    : 'text-slate-600 bg-slate-100 border-slate-200'
                }`}>
                  {data.outstandingBalance > 0 ? 'Due Pending' : 'Clear'}
                </span>
              </div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
                Pending Dues
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-slate-900 truncate tabular-nums mt-0.5">
                {formatPKR(data.outstandingBalance)}
              </div>
              <div className="text-[10px] text-slate-400 truncate mt-0.5">
                All open patient balances
              </div>
            </div>
            <div className="mt-3 pt-2">
              <Sparkline stroke="#f59e0b" fill="#f59e0b" trendUp={false} />
            </div>
          </div>

          {/* Card 5: Today's Appointments (Indigo theme) */}
          <div className="bg-white rounded-2xl border border-slate-200/60 border-t-[3.5px] border-t-indigo-600 shadow-[0_2px_8px_rgba(0,0,0,0.03)] p-4 sm:p-5 flex flex-col justify-between hover:shadow-md transition-all">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="h-11 w-11 rounded-xl flex items-center justify-center border shrink-0 bg-indigo-50 text-indigo-700 border-indigo-200">
                  <Calendar className="h-5 w-5" />
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                  <Clock className="h-3 w-3" /> Scheduled
                </span>
              </div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
                Appointments
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-slate-900 truncate tabular-nums mt-0.5">
                {data.todayAppointmentsCount}
              </div>
              <div className="text-[10px] text-slate-400 truncate mt-0.5">
                Consultant bookings
              </div>
            </div>
            <div className="mt-3 pt-2">
              <Sparkline stroke="#6366f1" fill="#6366f1" trendUp={true} />
            </div>
          </div>

          {/* Card 6: Total Invoices (Danger / Rose theme) */}
          <div className="bg-white rounded-2xl border border-slate-200/60 border-t-[3.5px] border-t-rose-600 shadow-[0_2px_8px_rgba(0,0,0,0.03)] p-4 sm:p-5 flex flex-col justify-between hover:shadow-md transition-all">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="h-11 w-11 rounded-xl flex items-center justify-center border shrink-0 bg-rose-50 text-rose-700 border-rose-200">
                  <Receipt className="h-5 w-5" />
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="h-3 w-3" /> Generated
                </span>
              </div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
                Total Invoices
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-slate-900 truncate tabular-nums mt-0.5">
                {data.todayInvoicesCount}
              </div>
              <div className="text-[10px] text-slate-400 truncate mt-0.5">
                {data.todayAdmissionsCount} admissions logged
              </div>
            </div>
            <div className="mt-3 pt-2">
              <Sparkline stroke="#f43f5e" fill="#f43f5e" trendUp={true} />
            </div>
          </div>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════
          4. MIDDLE SECTION: SHIFT PERFORMANCE CHART & ENCOUNTER DONUT
             (Shadcn Card Architecture)
          ═════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 cols: Encounter & Revenue Performance */}
        <Card className="lg:col-span-2 p-6 flex flex-col justify-between border-slate-300/80">
          <div>
            {/* Header */}
            <CardHeader className="p-0 pb-4 border-b border-slate-100 flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>
                  {timeframe === 'today' ? "Today's Shift Billing & Revenue" : 'Daily Revenue & Billing Performance'}
                </CardTitle>
                <CardDescription className="mt-0.5">
                  {timeframe === 'today'
                    ? "Patient intake, cash flow and billing volume timeline for today's operational shift"
                    : 'Day-by-day billed services, cash drawer collections, and patient encounters'}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value as any)}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer shadow-sm hover:border-slate-300 transition-colors"
                >
                  <option value="7d">Last 7 Days (Daily Trend)</option>
                  <option value="14d">Last 14 Days (Daily Trend)</option>
                  <option value="30d">Last 30 Days (Daily Trend)</option>
                  <option value="today">Today's Shift Hours</option>
                </select>
                <button
                  type="button"
                  onClick={() => navigate('/front-desk/hospital_invoices')}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                  title="View full invoice records"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>

            {/* Calculated Period Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-blue-500" /> Total Billed
                </div>
                <div className="text-lg font-bold text-slate-900 mt-1">{formatPKR(periodStats.billed)}</div>
                <div className="text-[10px] text-blue-600 font-semibold">{periodStats.invoiceCount} invoices</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Cash Inflow
                </div>
                <div className="text-lg font-bold text-slate-900 mt-1">{formatPKR(periodStats.cash)}</div>
                <div className="text-[10px] text-emerald-600 font-semibold">Physical drawer</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-teal-500" /> Digital / POS
                </div>
                <div className="text-lg font-bold text-slate-900 mt-1">{formatPKR(periodStats.digital)}</div>
                <div className="text-[10px] text-slate-400 font-medium">Card & online</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> Balance Due
                </div>
                <div className="text-lg font-bold text-slate-900 mt-1">{formatPKR(periodStats.due)}</div>
                <div className={`text-[10px] font-medium ${periodStats.due > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                  {periodStats.due > 0 ? 'Pending collection' : 'All cleared'}
                </div>
              </div>
            </div>

            {/* Live Recharts Day-wise / Hourly Chart */}
            <div className="relative pt-2 pb-2">
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendItems} margin={{ top: 12, right: 12, left: -15, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fdCollectionsGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0e7d5a" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#0e7d5a" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="fdBilledGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={{ stroke: '#e2e8f0' }}
                      tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                      tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k` : `${val}`)}
                      domain={[0, (dataMax: number) => Math.max(dataMax * 1.15, 1000)]}
                    />
                    <RechartsTooltip
                      content={({ active, payload }: any) => {
                        if (active && payload && payload.length) {
                          const item = payload[0].payload;
                          return (
                            <div className="bg-white text-slate-800 rounded-xl p-3 shadow-xl border border-slate-200/90 w-64 text-xs ring-1 ring-slate-900/5">
                              <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                                <div className="flex items-center gap-1.5 font-bold text-slate-900">
                                  <Calendar className="h-3.5 w-3.5 text-emerald-600" />
                                  <span>{item.fullDate || item.label}</span>
                                </div>
                                <Badge variant="outline" className="text-[10px] font-semibold py-0.5 px-2 bg-emerald-50 text-emerald-700 border-emerald-200">
                                  {item.encounters} {item.encounters === 1 ? 'encounter' : 'encounters'}
                                </Badge>
                              </div>
                              <div className="space-y-1.5 text-[11px]">
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-500 flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" /> Total Billed:
                                  </span>
                                  <span className="font-bold text-slate-900 font-mono text-xs">{formatPKR(item.billed)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-500 flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-emerald-600 shrink-0" /> Collections Realized:
                                  </span>
                                  <span className="font-bold text-emerald-700 font-mono text-xs">{formatPKR(item.collections)}</span>
                                </div>
                                <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px] text-slate-400">
                                  <span>Physical Cash Drawer:</span>
                                  <span className="font-medium text-slate-600 font-mono">{formatPKR(item.cash)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="billed"
                      name="Total Billed"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#fdBilledGrad)"
                      activeDot={{ r: 5, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="collections"
                      name="Collections Realized"
                      stroke="#0e7d5a"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#fdCollectionsGrad)"
                      activeDot={{ r: 6, fill: '#0e7d5a', stroke: '#fff', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Inspection Bar / Legend */}
              <div className="mt-3 py-2 px-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs text-slate-600">
                <div className="flex items-center gap-3 text-[11px] flex-wrap">
                  <span className="flex items-center gap-1.5 font-medium text-slate-700">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                    Collections Realized
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-slate-700">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                    Total Billed Services
                  </span>
                  <span className="text-slate-400 hidden sm:inline">
                    • Din ke mutabiq graph amount ke sath proportionally upar jaye ga.
                  </span>
                </div>
                <Badge variant="success" className="text-[10px] font-semibold py-0.5 px-2 shrink-0">
                  Live DB Synchronized
                </Badge>
              </div>
            </div>
          </div>
        </Card>

        {/* Right col: Encounter Distribution Donut Chart (Shadcn Card) */}
        <Card className="p-6 flex flex-col justify-between border-slate-300/80">
          <div>
            <CardHeader className="p-0 pb-3 border-b border-slate-100 flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Encounter Distribution</CardTitle>
                <CardDescription className="mt-0.5">Click any category to filter table below</CardDescription>
              </div>
              <button
                type="button"
                onClick={() => navigate('/front-desk/walk_in_intake')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Open Walk-In Intake"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </CardHeader>

            {/* Donut SVG */}
            <div className="py-6 flex items-center justify-center relative">
              <svg className="w-48 h-48 -rotate-90 transform" viewBox="0 0 140 140">
                <circle cx="70" cy="70" r={donutR} fill="none" stroke="#f1f5f9" strokeWidth="14" />
                {(() => {
                  let accAngle = 0;
                  return distributionData.map((cat, idx) => {
                    const pct = totalDistCount > 0 ? cat.count / totalDistCount : 0.2;
                    const dashLength = pct * donutCircumference;
                    const dashOffset = -accAngle;
                    accAngle += dashLength;
                    return (
                      <circle
                        key={idx}
                        cx="70"
                        cy="70"
                        r={donutR}
                        fill="none"
                        stroke={cat.color}
                        strokeWidth="14"
                        strokeDasharray={`${dashLength} ${donutCircumference - dashLength}`}
                        strokeDashoffset={dashOffset}
                        className="transition-all duration-300 hover:opacity-85 cursor-pointer"
                        onClick={() => {
                          if (cat.dept !== 'ALL') {
                            setTableFilter(tableFilter === cat.dept ? 'ALL' : cat.dept);
                            setActiveTab('invoices');
                          } else {
                            setActiveTab('admissions');
                          }
                        }}
                      />
                    );
                  });
                })()}
              </svg>

              {/* Total in Center */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center select-none">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">TOTAL</span>
                <span className="text-3xl font-extrabold text-slate-900 leading-none my-1 tracking-tight">
                  {totalEncounters || data.todayInvoicesCount}
                </span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ENCOUNTERS</span>
              </div>
            </div>

            {/* Legend with interactive buttons */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              {distributionData.map((cat, idx) => {
                const pct = totalDistCount > 0 ? Math.round((cat.count / totalDistCount) * 100) : 0;
                const isSelected = tableFilter === cat.dept;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      if (cat.dept !== 'ALL') {
                        setTableFilter(isSelected ? 'ALL' : cat.dept);
                        setActiveTab('invoices');
                      } else {
                        setActiveTab('admissions');
                      }
                    }}
                    className={`w-full flex items-center justify-between text-xs py-1.5 px-2 rounded-lg transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50 border border-emerald-300 font-bold'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                      <span>{cat.label}</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold text-slate-900 font-mono">{cat.count}</span>
                      <span className="text-slate-400 font-mono w-9 text-right text-[11px]">{pct}%</span>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════
          5. BOTTOM SECTION: MULTI-TAB WORKABLE OPERATIONS & SMART INSIGHTS
             (Fully workable tables with view, pay due, print, and admission actions)
          ═════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 cols: Workable Command Center with Pharmacy Table Theme */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col justify-between">
          <div>
            {/* ── Tab Switcher & Quick Navigation ── */}
            <div className="p-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 p-1 bg-slate-200/70 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('invoices');
                    setCurrentPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    activeTab === 'invoices'
                      ? 'bg-white text-emerald-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>Invoices & Encounters</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700 font-mono">
                    {filteredInvoices.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('admissions');
                    setCurrentPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    activeTab === 'admissions'
                      ? 'bg-white text-sky-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <BedDouble className="h-3.5 w-3.5" />
                  <span>Active Admissions</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700 font-mono">
                    {filteredAdmissions.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('transactions');
                    setCurrentPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    activeTab === 'transactions'
                      ? 'bg-white text-teal-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Banknote className="h-3.5 w-3.5" />
                  <span>Cash Drawer Receipts</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700 font-mono">
                    {filteredTransactions.length}
                  </span>
                </button>
              </div>

              {/* Action Buttons for active tab */}
              <div className="flex items-center gap-2 flex-wrap">
                {activeTab === 'invoices' && (
                  <button
                    type="button"
                    onClick={() => navigate('/front-desk/hospital_invoices')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0e7d5a] text-white text-xs font-semibold hover:bg-[#0c6b50] transition-colors cursor-pointer shadow-xs"
                  >
                    <Download className="h-3.5 w-3.5" /> Full Ledger
                  </button>
                )}
                {activeTab === 'admissions' && (
                  <button
                    type="button"
                    onClick={() => navigate('/front-desk/new_admission')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 transition-colors cursor-pointer shadow-xs"
                  >
                    <Plus className="h-3.5 w-3.5" /> New Admission
                  </button>
                )}
                {activeTab === 'transactions' && (
                  <button
                    type="button"
                    onClick={() => navigate('/front-desk/my_balance_sheet')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition-colors cursor-pointer shadow-xs"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Balance Sheet
                  </button>
                )}
              </div>
            </div>

            {/* ── Pharmacy Dark Emerald Header Strip ── */}
            <div className="bg-[#0e5944] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-emerald-300" />
                <span className="font-bold text-xs sm:text-sm tracking-tight text-white whitespace-nowrap">
                  {activeTab === 'invoices'
                    ? 'Patient Invoices & Care Encounters'
                    : activeTab === 'admissions'
                    ? 'Hospital Inpatient Admissions'
                    : 'Current Shift Cash Drawer Receipts'}
                </span>
                <span className="text-[10px] font-semibold bg-emerald-700/60 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-500/30 whitespace-nowrap">
                  Live Shift Records
                </span>
              </div>

              {/* Pharmacy-style Export Action Buttons */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
                  title="Download Excel Worksheet"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
                  title="Download CSV"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#dc2626] hover:bg-[#b91c1c] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
                  title="Export as PDF via Print"
                >
                  <FileText className="h-3.5 w-3.5" /> PDF
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
                  title="Print Table"
                >
                  <Printer className="h-3.5 w-3.5" /> Print
                </button>
              </div>
            </div>

            {/* ── Pharmacy Search in Results Toolbar ── */}
            <div className="px-3.5 py-2 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 text-xs">
              <div className="flex items-center gap-2.5 flex-1 min-w-[240px]">
                <div className="relative w-56 sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => {
                      setTableSearch(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder={
                      activeTab === 'invoices'
                        ? 'Search in results…'
                        : activeTab === 'admissions'
                        ? 'Search in results…'
                        : 'Search in results…'
                    }
                    className="w-full h-7.5 pl-8 pr-2.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
                  />
                </div>

                {activeTab === 'invoices' && (
                  <>
                    <select
                      value={tableFilter}
                      onChange={(e) => {
                        setTableFilter(e.target.value as any);
                        setCurrentPage(1);
                      }}
                      className="h-7.5 px-2.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
                    >
                      <option value="ALL">All Care Queues</option>
                      <option value="OPD">OPD Clinic</option>
                      <option value="OBSERVATION">Observation</option>
                      <option value="EMERGENCY">Emergency Care</option>
                      <option value="CUSTOM">Custom / Lab</option>
                    </select>

                    <select
                      value={statusFilter}
                      onChange={(e) => {
                        setStatusFilter(e.target.value as any);
                        setCurrentPage(1);
                      }}
                      className="h-7.5 px-2.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
                    >
                      <option value="ALL">All Payment Status</option>
                      <option value="PAID">Paid in Full</option>
                      <option value="PARTIALLY_PAID">Partially Paid</option>
                      <option value="UNPAID">Pending / Due</option>
                    </select>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3 text-slate-500 font-medium text-xs">
                <span className="whitespace-nowrap">
                  Showing <strong className="text-slate-800">
                    {activeTab === 'invoices'
                      ? paginatedInvoices.length
                      : activeTab === 'admissions'
                      ? paginatedAdmissions.length
                      : paginatedTransactions.length}
                  </strong> of{' '}
                  <strong className="text-slate-800">
                    {activeTab === 'invoices'
                      ? filteredInvoices.length
                      : activeTab === 'admissions'
                      ? filteredAdmissions.length
                      : filteredTransactions.length}
                  </strong> records
                </span>
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <span>Per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-white border border-slate-200 rounded-md px-2 py-0.5 text-xs text-slate-700 focus:outline-none"
                  >
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>
            </div>

            {/* TAB 1: INVOICES & ENCOUNTERS */}
            {activeTab === 'invoices' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#f8fafc] text-slate-700 font-bold sticky top-0 z-10 border-b border-slate-200 uppercase tracking-wider select-none text-xs">
                    <tr>
                      <th className="py-3 px-3.5 text-center border-r border-slate-200 w-12 whitespace-nowrap">#</th>
                      <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Invoice #</th>
                      <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Patient Name</th>
                      <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Queue</th>
                      <th className="py-3 px-4 border-r border-slate-200 text-right whitespace-nowrap">Net Total</th>
                      <th className="py-3 px-4 border-r border-slate-200 text-right whitespace-nowrap">Balance Due</th>
                      <th className="py-3 px-4 border-r border-slate-200 text-center whitespace-nowrap">Status</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-400">
                          <div className="flex flex-col items-center justify-center gap-1.5 max-w-sm mx-auto">
                            <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                              <Search className="h-4 w-4" />
                            </div>
                            <div className="font-semibold text-slate-700 text-xs">No Records Found</div>
                            <p className="text-xs text-slate-500">No invoices match your selected search criteria.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      paginatedInvoices.map((inv, idx) => {
                        const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                        return (
                          <tr
                            key={inv.id}
                            className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                            onClick={() => {
                              setSelectedInvoiceId(inv.id);
                              setModalInitialAction(undefined);
                            }}
                          >
                            <td className="py-3.5 px-3.5 text-center border-r border-slate-100 text-slate-500 font-semibold text-xs whitespace-nowrap font-mono">
                              {globalIdx}
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 font-mono font-bold text-slate-900 group-hover:text-[#0e7d5a] whitespace-nowrap">
                              {inv.invoiceNumber}
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 font-semibold text-slate-900 truncate max-w-[180px] whitespace-nowrap">
                              {inv.patient}
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap">
                              <Badge variant="secondary" className="text-[10px] font-bold">
                                {inv.encounterType}
                              </Badge>
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 text-right font-bold text-slate-900 font-mono whitespace-nowrap">
                              {formatPKR(inv.net)}
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 text-right font-mono whitespace-nowrap">
                              {inv.due > 0 ? (
                                <span className="text-rose-700 bg-rose-50 border border-rose-200/80 px-2 py-0.5 rounded-md font-bold text-[11px]">
                                  {formatPKR(inv.due)}
                                </span>
                              ) : (
                                <span className="text-emerald-700 font-medium">Cleared</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 text-center whitespace-nowrap">
                              <Badge
                                variant={
                                  inv.status === 'PAID'
                                    ? 'success'
                                    : inv.status === 'PARTIALLY_PAID'
                                    ? 'warning'
                                    : 'destructive'
                                }
                                className="text-[10px] font-bold"
                              >
                                {inv.status}
                              </Badge>
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedInvoiceId(inv.id);
                                    setModalInitialAction(undefined);
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs inline-flex items-center gap-1 cursor-pointer transition-colors"
                                  title="View invoice breakdown & services"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  <span>View</span>
                                </button>

                                {inv.due > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedInvoiceId(inv.id);
                                      setModalInitialAction('payment');
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs inline-flex items-center gap-1 cursor-pointer shadow-2xs transition-colors"
                                    title="Collect balance payment"
                                  >
                                    <CreditCard className="h-3.5 w-3.5" />
                                    <span>Pay Due</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedInvoiceId(inv.id);
                                    setModalInitialAction(undefined);
                                  }}
                                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors"
                                  title="Print invoice receipt"
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 2: ACTIVE ADMISSIONS */}
            {activeTab === 'admissions' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#f8fafc] text-slate-700 font-bold sticky top-0 z-10 border-b border-slate-200 uppercase tracking-wider select-none text-xs">
                    <tr>
                      <th className="py-3 px-3.5 text-center border-r border-slate-200 w-12 whitespace-nowrap">#</th>
                      <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Admission #</th>
                      <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">MR #</th>
                      <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Patient Name</th>
                      <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Ward & Bed</th>
                      <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Attending Doctor</th>
                      <th className="py-3 px-4 border-r border-slate-200 text-center whitespace-nowrap">Status</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedAdmissions.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-400">
                          <div className="flex flex-col items-center justify-center gap-1.5 max-w-sm mx-auto">
                            <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                              <Search className="h-4 w-4" />
                            </div>
                            <div className="font-semibold text-slate-700 text-xs">No Records Found</div>
                            <p className="text-xs text-slate-500">No active admissions match your search.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      paginatedAdmissions.map((adm, idx) => {
                        const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                        return (
                          <tr key={adm.id} className="hover:bg-slate-50/80 transition-colors group">
                            <td className="py-3.5 px-3.5 text-center border-r border-slate-100 text-slate-500 font-semibold text-xs whitespace-nowrap font-mono">
                              {globalIdx}
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 font-mono font-bold text-sky-800 whitespace-nowrap">
                              {adm.admissionNumber}
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap font-mono text-xs font-semibold text-[#08775A]">
                              {adm.mrn}
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap">
                              <div className="font-semibold text-slate-900">{adm.patient}</div>
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap">
                              <span className="font-semibold text-slate-800">{adm.department}</span>
                              <span className="text-[11px] text-slate-500 block">Bed: {adm.bed}</span>
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 text-slate-700 font-medium whitespace-nowrap">
                              {adm.doctor}
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 text-center whitespace-nowrap">
                              <Badge variant="indigo" className="text-[10px] font-bold">
                                {adm.status}
                              </Badge>
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => navigate('/front-desk/admission_patient_records')}
                                  className="px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100 font-semibold text-xs inline-flex items-center gap-1 cursor-pointer transition-colors"
                                >
                                  <ClipboardList className="h-3.5 w-3.5" />
                                  <span>Records</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => navigate('/front-desk/billing_pending_discharges')}
                                  className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 font-semibold text-xs inline-flex items-center gap-1 cursor-pointer transition-colors"
                                >
                                  <CheckSquare className="h-3.5 w-3.5" />
                                  <span>Clearance</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 3: CASH DRAWER RECEIPTS */}
            {activeTab === 'transactions' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#f8fafc] text-slate-700 font-bold sticky top-0 z-10 border-b border-slate-200 uppercase tracking-wider select-none text-xs">
                    <tr>
                      <th className="py-3 px-3.5 text-center border-r border-slate-200 w-12 whitespace-nowrap">#</th>
                      <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Receipt #</th>
                      <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Invoice #</th>
                      <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Payment Method</th>
                      <th className="py-3 px-4 border-r border-slate-200 text-right whitespace-nowrap">Amount Collected</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-400">
                          <div className="flex flex-col items-center justify-center gap-1.5 max-w-sm mx-auto">
                            <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                              <Search className="h-4 w-4" />
                            </div>
                            <div className="font-semibold text-slate-700 text-xs">No Records Found</div>
                            <p className="text-xs text-slate-500">No transactions recorded in current shift drawer.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      paginatedTransactions.map((tx, idx) => {
                        const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                        return (
                          <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors group">
                            <td className="py-3.5 px-3.5 text-center border-r border-slate-100 text-slate-500 font-semibold text-xs whitespace-nowrap font-mono">
                              {globalIdx}
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 font-mono font-bold text-slate-800 whitespace-nowrap">
                              {tx.receiptNumber || 'RCP-LIVE'}
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 font-mono text-slate-600 whitespace-nowrap">
                              {tx.invoiceNumber || '—'}
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 uppercase">
                                {tx.method}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 border-r border-slate-100 text-right font-bold text-emerald-700 font-mono whitespace-nowrap">
                              {formatPKR(tx.amount)}
                            </td>
                            <td className="py-3.5 px-4 text-right text-slate-400 font-mono text-[11px] whitespace-nowrap">
                              {tx.occurredAt ? String(tx.occurredAt).slice(11, 16) : 'Just Now'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Table Pagination Bar (Matching Pharmacy) ── */}
          <div className="px-4 py-3 bg-slate-50/80 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
            <div>
              Page <strong className="text-slate-800">{currentPage}</strong> of{' '}
              <strong className="text-slate-800">
                {Math.max(
                  1,
                  Math.ceil(
                    (activeTab === 'invoices'
                      ? filteredInvoices.length
                      : activeTab === 'admissions'
                      ? filteredAdmissions.length
                      : filteredTransactions.length) / pageSize
                  )
                )}
              </strong>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </button>
              <button
                type="button"
                disabled={
                  currentPage >=
                  Math.ceil(
                    (activeTab === 'invoices'
                      ? filteredInvoices.length
                      : activeTab === 'admissions'
                      ? filteredAdmissions.length
                      : filteredTransactions.length) / pageSize
                  )
                }
                onClick={() => setCurrentPage((p) => p + 1)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right col: Smart Front Desk Insights (Shadcn Dark Card - Workable) */}
        <Card className="bg-gradient-to-br from-[#0c5944] via-[#094736] to-[#07382a] text-white p-6 border-emerald-800/60 shadow-lg flex flex-col justify-between">
          <div className="space-y-4">
            <CardHeader className="p-0 pb-3 border-b border-emerald-400/20 flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-900/60 border border-emerald-400/30 text-emerald-300">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm text-white">Smart Front Desk Insights</CardTitle>
                  <CardDescription className="text-[11px] text-emerald-200/80">Shift Drawer & Reconciliation</CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] font-semibold bg-emerald-400/20 text-emerald-200 border-emerald-400/30 py-0.5 px-2">
                Live DB
              </Badge>
            </CardHeader>

            <div className="space-y-2.5">
              {/* Cashier card */}
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-400/20 space-y-1">
                <div className="text-[10.5px] text-emerald-200/70 uppercase tracking-wider font-semibold">Active Cashier Officer</div>
                <div className="text-sm font-bold text-white flex items-center justify-between">
                  <span>{currentUser?.name || currentUser?.username || 'Front Desk'}</span>
                  <span className="text-xs text-emerald-300 bg-emerald-900/60 px-2 py-0.5 rounded font-mono border border-emerald-400/20">
                    Shift 1 • Active
                  </span>
                </div>
              </div>

              {/* Physical Cash Drawer Card with Workable Settle Action */}
              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-400/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10.5px] text-emerald-200/70 uppercase tracking-wider font-semibold">Physical Cash Drawer</div>
                  <button
                    type="button"
                    onClick={() => navigate('/front-desk/my_account_settlement')}
                    className="text-[10px] font-bold text-emerald-300 hover:text-white bg-emerald-900/70 hover:bg-emerald-800 px-2 py-0.5 rounded border border-emerald-400/30 transition-colors cursor-pointer"
                  >
                    Settle Shift →
                  </button>
                </div>
                <div className="text-xl font-extrabold text-white font-mono">
                  {formatPKR(data.cashCollected)}
                </div>
                <div className="text-[11px] text-emerald-300/80 flex items-center justify-between">
                  <span>{data.unsettledCount} receipts pending settlement</span>
                  <span className="text-emerald-400 font-semibold">Physical Inflow</span>
                </div>
              </div>

              {/* Digital Collections Card */}
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-400/20 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-[10.5px] text-emerald-200/70 uppercase tracking-wider font-semibold">Digital & POS Intake</div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('transactions')}
                    className="text-[10px] font-bold text-emerald-300 hover:text-white transition-colors cursor-pointer"
                  >
                    View Log
                  </button>
                </div>
                <div className="text-base font-bold text-emerald-200 font-mono">
                  {formatPKR(data.onlineCollected)}
                </div>
                <div className="text-[11px] text-emerald-300/80">
                  Total shift collections: {formatPKR(totalShiftRevenue)}
                </div>
              </div>

              {/* Pending Dues Card */}
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-400/20 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-[10.5px] text-emerald-200/70 uppercase tracking-wider font-semibold">Patient Receivables Due</div>
                  <button
                    type="button"
                    onClick={() => navigate('/front-desk/outstanding_balances')}
                    className="text-[10px] font-bold text-emerald-300 hover:text-white transition-colors cursor-pointer"
                  >
                    View Balances →
                  </button>
                </div>
                <div className="text-base font-bold text-rose-300 font-mono">
                  {formatPKR(data.outstandingBalance)}
                </div>
              </div>
            </div>
          </div>

          {/* Action Links */}
          <div className="pt-4 border-t border-emerald-400/20 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => navigate('/front-desk/my_balance_sheet')}
              className="w-full py-2.5 px-3 rounded-xl bg-white text-[#0e7d5a] text-xs font-bold hover:bg-emerald-50 transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="h-4 w-4" /> Open My Balance Sheet
            </button>
            <button
              type="button"
              onClick={() => navigate('/front-desk/my_account_settlement')}
              className="w-full py-2 px-3 rounded-xl bg-emerald-900/50 hover:bg-emerald-900/80 border border-emerald-400/30 text-white text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Shift Settlement History
            </button>
          </div>
        </Card>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════
          6. INTEGRATED INVOICE DETAIL & PAYMENT MODAL
             (Enables live invoice inspection, adding services, and collecting payment right from the dashboard)
          ═════════════════════════════════════════════════════════════════════ */}
      {selectedInvoiceId && (
        <InvoiceDetailModal
          invoiceId={selectedInvoiceId}
          initialAction={modalInitialAction}
          onClose={() => {
            setSelectedInvoiceId(null);
            setModalInitialAction(undefined);
          }}
          onChanged={() => {
            fetchDashboard();
          }}
        />
      )}
    </div>
  );
};
