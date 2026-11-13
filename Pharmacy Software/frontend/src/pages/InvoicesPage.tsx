import React, { useEffect, useState, useMemo } from 'react';
import {
  Loader2,
  Eye,
  X,
  Plus,
  Undo2,
  Printer,
  Receipt,
  Search,
  Filter,
  DollarSign,
  TrendingUp,
  CreditCard,
  AlertCircle,
  CheckCircle2,
  User,
  Calendar,
} from 'lucide-react';
import { pharmacyApi } from '../services/pharmacyApi';
import { formatPKR, formatNumber, formatDateTime } from '../utils/format';
import { useToast } from '../context/ToastContext';
import { PharmacyKpiHeader, KpiItem } from '../components/PharmacyKpiHeader';
import { PharmacyDataTable, Column } from '../components/PharmacyDataTable';
import { PharmacyInvoiceModal } from '../components/PharmacyInvoiceModal';

export const InvoicesPage: React.FC = () => {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [modalInitialAction, setModalInitialAction] = useState<'return' | 'payment' | undefined>(undefined);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [channelFilter, setChannelFilter] = useState<string>('ALL');

  const load = () => {
    setLoading(true);
    pharmacyApi
      .listInvoices()
      .then(setRows)
      .catch(() => toast.error('Failed to load pharmacy invoices.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Top KPI calculations
  const totalSales = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const totalPaid = rows.reduce((s, r) => s + Number(r.paidTotal || 0), 0);
  const totalOutstanding = rows.reduce((s, r) => s + Number(r.outstanding || 0), 0);
  const totalInvoices = rows.length;

  const kpis: KpiItem[] = [
    {
      label: 'Gross Pharmacy Sales',
      value: formatPKR(totalSales),
      icon: TrendingUp,
      subtitle: `${totalInvoices} total transactions`,
      tone: 'default',
    },
    {
      label: 'Total Collected',
      value: formatPKR(totalPaid),
      icon: CheckCircle2,
      subtitle: 'Settled via cash / card / bank',
      tone: 'success',
    },
    {
      label: 'Total Receivables',
      value: formatPKR(totalOutstanding),
      icon: AlertCircle,
      subtitle: 'Pending customer settlement',
      tone: totalOutstanding > 0 ? 'danger' : 'success',
    },
    {
      label: 'Invoices Dispensed',
      value: totalInvoices,
      icon: Receipt,
      subtitle: 'Retail POS & HMS inpatient',
      tone: 'info',
    },
  ];

  // Filtered dataset
  const filteredInvoices = useMemo(() => {
    return rows.filter((inv) => {
      if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;
      if (channelFilter !== 'ALL' && inv.channel !== channelFilter) return false;
      return true;
    });
  }, [rows, statusFilter, channelFilter]);

  const columns: Column<any>[] = [
    {
      key: 'invoiceNumber',
      header: 'Invoice #',
      width: '160px',
      render: (inv) => (
        <span className="font-bold text-slate-900 text-xs tracking-wider whitespace-nowrap">
          {inv.invoiceNumber}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Date & Time',
      width: '160px',
      render: (inv) => (
        <span className="text-xs text-slate-700 whitespace-nowrap">
          {formatDateTime(inv.createdAt)}
        </span>
      ),
    },
    {
      key: 'channel',
      header: 'Channel',
      width: '130px',
      render: (inv) => (
        <span className="text-slate-800 font-medium text-xs whitespace-nowrap">
          {inv.channel === 'HMS_LINKED' ? 'HMS Dispense' : 'Retail POS'}
        </span>
      ),
    },
    {
      key: 'customerName',
      header: 'Customer / Patient',
      render: (inv) => (
        <div className="font-semibold text-slate-900 text-xs whitespace-nowrap">
          {inv.customerName || <span className="text-slate-400 font-normal">Walk-In Customer</span>}
        </div>
      ),
    },
    {
      key: 'dispensedBy',
      header: 'Dispensed By',
      render: (inv) => (
        <div className="text-xs text-slate-700 flex items-center gap-1.5 whitespace-nowrap">
          <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span>{inv.dispensedByUser?.fullName || inv.dispensedByUser?.username || 'Staff'}</span>
        </div>
      ),
    },
    {
      key: 'total',
      header: 'Net Total (PKR)',
      align: 'right',
      render: (inv) => (
        <span className="font-bold text-xs text-slate-900 whitespace-nowrap">
          {formatPKR(inv.total)}
        </span>
      ),
    },
    {
      key: 'paidTotal',
      header: 'Paid (PKR)',
      align: 'right',
      render: (inv) => (
        <span className="font-bold text-xs text-slate-900 whitespace-nowrap">
          {formatPKR(inv.paidTotal)}
        </span>
      ),
    },
    {
      key: 'outstanding',
      header: 'Outstanding',
      align: 'right',
      render: (inv) => {
        const out = Number(inv.outstanding || 0);
        return (
          <span
            className={`font-bold text-xs whitespace-nowrap ${
              out > 0 ? 'text-rose-600' : 'text-slate-400 font-normal'
            }`}
          >
            {out > 0 ? formatPKR(out) : 'PKR 0'}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      width: '130px',
      render: (inv) => (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap">
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${
              inv.status === 'PAID'
                ? 'bg-[#0e7d5a]'
                : inv.status === 'PARTIALLY_PAID'
                ? 'bg-amber-500'
                : 'bg-rose-500'
            }`}
          />
          <span
            className={
              inv.status === 'PAID'
                ? 'text-[#0e7d5a]'
                : inv.status === 'PARTIALLY_PAID'
                ? 'text-amber-700'
                : 'text-rose-700'
            }
          >
            {inv.status.replace('_', ' ')}
          </span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      width: '160px',
      render: (inv) => (
        <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
          <button
            type="button"
            onClick={() => {
              setModalInitialAction(undefined);
              setSelectedInvoice(inv);
            }}
            title="View & Print Pharmacy Invoice"
            className="px-2 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Printer className="h-3 w-3" /> Print
          </button>

          {inv.channel === 'RETAIL' && Number(inv.paidTotal || 0) > 0 && (
            <button
              type="button"
              onClick={() => {
                setModalInitialAction('return');
                setSelectedInvoice(inv);
              }}
              title="Return items & issue refund"
              className="px-2 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Undo2 className="h-3 w-3" /> Refund
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-[1700px] mx-auto">
      {/* Title */}
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Sales &amp; Dispensing Invoices
          </h1>
          <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80">
            Billing Registry
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Every POS retail bill, HMS inpatient dispense, payment settlement, and thermal slip printout.
        </p>
      </div>

      {/* KPI Metric Header */}
      <PharmacyKpiHeader items={kpis} />

      {/* Main Table */}
      <PharmacyDataTable
        columns={columns}
        data={filteredInvoices}
        loading={loading}
        title="Sales Invoices Register"
        badge="Active Invoices"
        exportFileName="pharmacy_sales_invoices"
        searchPlaceholder="Search by invoice #, patient/customer name, or pharmacist…"
        searchFilter={(inv, q) =>
          inv.invoiceNumber.toLowerCase().includes(q) ||
          (inv.customerName && inv.customerName.toLowerCase().includes(q)) ||
          (inv.dispensedByUser?.fullName && inv.dispensedByUser.fullName.toLowerCase().includes(q)) ||
          (inv.dispensedByUser?.username && inv.dispensedByUser.username.toLowerCase().includes(q))
        }
        onRefresh={load}
        onApplyFilters={load}
        onResetFilters={() => {
          setChannelFilter('ALL');
          setStatusFilter('ALL');
          load();
        }}
        filterControls={
          <>
            <div className="w-36">
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="w-full h-8.5 px-2.5 text-xs bg-slate-50 hover:bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0e7d5a] cursor-pointer"
              >
                <option value="ALL">All Channels</option>
                <option value="RETAIL">Retail POS</option>
                <option value="HMS_LINKED">HMS Dispense</option>
              </select>
            </div>

            <div className="w-36">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full h-8.5 px-2.5 text-xs bg-slate-50 hover:bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0e7d5a] cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="PAID">Fully Paid</option>
                <option value="PARTIALLY_PAID">Partially Paid</option>
                <option value="UNPAID">Unpaid Due</option>
              </select>
            </div>
          </>
        }
        emptyTitle="No Invoices Found"
        emptyDescription="No sales or dispense records match your filters."
      />

      {/* Full-featured Pharmacy Invoice & Thermal Slip Modal */}
      {selectedInvoice && (
        <PharmacyInvoiceModal
          invoice={selectedInvoice}
          initialAction={modalInitialAction}
          onClose={() => {
            setSelectedInvoice(null);
            setModalInitialAction(undefined);
          }}
          onUpdated={(updated) => {
            setSelectedInvoice(updated);
            load();
          }}
        />
      )}
    </div>
  );
};
