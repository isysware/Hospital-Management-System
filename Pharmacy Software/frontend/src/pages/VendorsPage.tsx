import { PaymentAccountSelect } from '../components/PaymentAccountSelect';
import React, { useEffect, useState, useMemo } from 'react';
import {
  Loader2,
  Plus,
  X,
  BookOpen,
  Banknote,
  Search,
  Building2,
  Phone,
  User,
  CreditCard,
  Printer,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Receipt,
  FileSpreadsheet,
} from 'lucide-react';
import apiClient from '../services/apiClient';
import { pharmacyApi, MedicineRow } from '../services/pharmacyApi';
import { formatPKR, formatNumber, formatDateTime, formatDate } from '../utils/format';
import { useToast } from '../context/ToastContext';
import { PharmacyKpiHeader, KpiItem } from '../components/PharmacyKpiHeader';
import { PharmacyDataTable, Column } from '../components/PharmacyDataTable';
import { AddVendorModal } from '../components/AddVendorModal';

export const VendorsPage: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Ledger state
  const [ledgerVendor, setLedgerVendor] = useState<any | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState('');
  const [ledgerSearch, setLedgerSearch] = useState('');

  // Payment state
  const [refundOf, setRefundOf] = useState('');
  const [refundCredits, setRefundCredits] = useState<any[]>([]);
  const [returnRequestKey, setReturnRequestKey] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [paymentRequestKey, setPaymentRequestKey] = useState('');
  const [payVendor, setPayVendor] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD' | 'ONLINE' | 'BANK'>('CASH');
  const [payReference, setPayReference] = useState('');
  const [paying, setPaying] = useState(false);

  // Purchase Return state (purchase-costing-plan — always against a specific batch, uses its frozen snapshot)
  const [returnVendor, setReturnVendor] = useState<any | null>(null);
  const [returnMedicines, setReturnMedicines] = useState<MedicineRow[]>([]);
  const [returnMedicineId, setReturnMedicineId] = useState('');
  const [returnBatches, setReturnBatches] = useState<any[]>([]);
  const [returnBatchId, setReturnBatchId] = useState('');
  const [returnQty, setReturnQty] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [loadingReturnBatches, setLoadingReturnBatches] = useState(false);
  const [returning, setReturning] = useState(false);

  // Filter state for main list
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DUE' | 'SETTLED'>('ALL');

  const load = () => {
    setLoading(true);
    apiClient
      .get('/vendors')
      .then((r) => setRows(r.data.data))
      .catch(() => toast.error('Failed to load vendors directory.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Top KPI calculations
  const totalVendors = rows.length;
  const totalPayable = rows.reduce((s, v) => s + Number(v.currentPayable || 0), 0);
  const vendorsWithDue = rows.filter((v) => Number(v.currentPayable) > 0).length;
  const fullySettled = rows.filter((v) => Number(v.currentPayable) <= 0).length;

  const kpis: KpiItem[] = [
    {
      label: 'Total Vendors',
      value: totalVendors,
      icon: Building2,
      subtitle: `${vendorsWithDue} with outstanding balance`,
      tone: 'info',
    },
    {
      label: 'Total Payable Due',
      value: formatPKR(totalPayable),
      icon: Banknote,
      subtitle: 'Net supplier liabilities',
      tone: totalPayable > 0 ? 'danger' : 'success',
    },
    {
      label: 'Accounts with Due',
      value: vendorsWithDue,
      icon: AlertCircle,
      subtitle: 'Requiring disbursement',
      tone: 'warning',
    },
    {
      label: 'Settled Accounts',
      value: fullySettled,
      icon: CheckCircle2,
      subtitle: 'Zero outstanding balance',
      tone: 'success',
    },
  ];

  const openAddVendor = () => setShowAdd(true);

  const openLedger = async (vendor: any) => {
    setLoadingLedger(true);
    setLedgerVendor({ vendor, entries: [], currentPayable: vendor.currentPayable });
    try {
      const res = await apiClient.get(`/vendors/${vendor.id}/ledger`);
      setLedgerVendor(res.data.data);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to fetch vendor ledger.');
    } finally {
      setLoadingLedger(false);
    }
  };

  const openPayModal = (vendor: any) => {
    const due = Number(vendor.currentPayable || 0);
    setRefundOf('');
    apiClient.get('/vendors/' + vendor.id + '/ledger').then(r => setRefundCredits(r.data.data.entries.filter((e: any) => Number(e.amount) < 0 && ['PAYMENT','RETURN_CREDIT'].includes(e.entryType)))).catch(() => setRefundCredits([]));
    setPayVendor(vendor);
    setPaymentAccountId('');
    setPaymentRequestKey(crypto.randomUUID());
    setPayAmount(String(Math.max(due, 0)));
    setPayReference(`VND-PAY-${String(Date.now()).slice(-4)}`);
    setPayMethod('CASH');
  };

  const handlePay = async () => {
    if (!payVendor) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid payment amount.');
      return;
    }
    setPaying(true);
    try {
      await apiClient.post(`/vendors/${payVendor.id}/pay`, {
        amount,
        method: payMethod,
        requestKey: paymentRequestKey,
        refundOf: refundOf || undefined,
        reference: payReference || undefined,
        paymentAccountId: payMethod === 'CASH' ? undefined : paymentAccountId || undefined,
      });
      toast.success(`Payment of ${formatPKR(amount)} recorded for ${payVendor.name}.`);
      setPayVendor(null);
      setPayAmount('');
      load();
      // If ledger is open for this vendor, refresh it
      if (ledgerVendor && ledgerVendor.vendor.id === payVendor.id) {
        openLedger(payVendor);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to record vendor payment.');
    } finally {
      setPaying(false);
    }
  };

  // ── Purchase Return (purchase-costing-plan) ─────────────────────────────
  const openReturnModal = (vendor: any) => {
    setReturnVendor(vendor);
    setReturnRequestKey(crypto.randomUUID());
    setReturnMedicineId('');
    setReturnBatches([]);
    setReturnBatchId('');
    setReturnQty('');
    setReturnReason('');
    if (returnMedicines.length === 0) pharmacyApi.listMedicines().then(setReturnMedicines).catch(() => {});
  };

  const selectReturnMedicine = async (medicineId: string) => {
    setReturnMedicineId(medicineId);
    setReturnBatchId('');
    setReturnBatches([]);
    if (!medicineId) return;
    setLoadingReturnBatches(true);
    try {
      const batches = await pharmacyApi.getMedicineBatches(medicineId);
      setReturnBatches(batches.filter((b: any) => Number(b.currentStock) > 0));
    } catch {
      toast.error('Failed to load batches for this medicine.');
    } finally {
      setLoadingReturnBatches(false);
    }
  };

  const selectedReturnBatch = returnBatches.find((b) => b.id === returnBatchId);
  const returnBaseQty = selectedReturnBatch ? (Number(returnQty) || 0) * Number(selectedReturnBatch.purchaseUnitConversionToBase || 1) : 0;
  const returnValue = selectedReturnBatch ? returnBaseQty * Number(selectedReturnBatch.costRate || 0) : 0;

  const handlePurchaseReturn = async () => {
    if (!returnVendor || !selectedReturnBatch) return;
    const qty = Number(returnQty);
    if (!qty || qty <= 0) return toast.error('Enter a valid return quantity.');
    if (returnBaseQty > Number(selectedReturnBatch.currentStock)) return toast.error(`Cannot return more than currently in stock for this batch (${formatNumber(selectedReturnBatch.currentStock)}).`);
    if (!returnReason.trim()) return toast.error('A reason is required for the vendor debit note.');
    setReturning(true);
    try {
      await apiClient.post('/vendors/purchase-returns', {
        vendorId: returnVendor.id,
        requestKey: returnRequestKey,
        lines: [{ medicineId: returnMedicineId, batchId: returnBatchId, returnUnitId: selectedReturnBatch.purchaseUnitId, returnUnitQuantity: qty }],
        reason: returnReason.trim(),
      });
      toast.success(`Return of ${formatPKR(Math.abs(returnValue))} posted against batch "${selectedReturnBatch.batchNumber}".`);
      setReturnVendor(null);
      load();
      if (ledgerVendor && ledgerVendor.vendor.id === returnVendor.id) openLedger(returnVendor);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to post purchase return.');
    } finally {
      setReturning(false);
    }
  };

  // Filtered rows for main table
  const filteredVendors = useMemo(() => {
    return rows.filter((v) => {
      const due = Number(v.currentPayable || 0);
      if (statusFilter === 'DUE') return due > 0;
      if (statusFilter === 'SETTLED') return due <= 0;
      return true;
    });
  }, [rows, statusFilter]);

  // Main Vendor Columns
  const columns: Column<any>[] = [
    {
      key: 'code',
      header: 'Vendor Code',
      width: '140px',
      render: (v) => (
        <span className="font-bold text-slate-900 text-xs tracking-wider whitespace-nowrap">
          {v.code}
        </span>
      ),
    },
    {
      key: 'name',
      header: 'Vendor Name',
      render: (v) => (
        <span className="font-bold text-slate-900 text-xs whitespace-nowrap">{v.name}</span>
      ),
    },
    {
      key: 'contactPerson',
      header: 'Contact Person',
      width: '160px',
      render: (v) => (
        <span className="text-xs text-slate-700 whitespace-nowrap">
          {v.contactPerson || <span className="text-slate-400 font-sans">—</span>}
        </span>
      ),
    },
    {
      key: 'contact',
      header: 'Phone / Email',
      render: (v) => (
        <div className="flex items-center gap-2 whitespace-nowrap text-xs text-slate-700">
          {v.phone ? (
            <div className="flex items-center gap-1">
              <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span>{v.phone}</span>
            </div>
          ) : (
            <span className="text-slate-400 font-sans">—</span>
          )}
          {v.email && (
            <span className="text-slate-500 font-sans">
              ({v.email})
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'paymentTermsDays',
      header: 'Credit Terms',
      width: '140px',
      render: (v) => (
        <span className="text-xs text-slate-700 font-medium whitespace-nowrap">
          {v.paymentTermsDays > 0 ? `Net ${v.paymentTermsDays} Days` : 'Immediate / COD'}
        </span>
      ),
    },
    {
      key: 'currentPayable',
      header: 'Current Payable (PKR)',
      align: 'right',
      render: (v) => {
        const amt = Number(v.currentPayable || 0);
        return (
          <span
            className={`font-bold text-xs whitespace-nowrap ${
              amt > 0 ? 'text-rose-600' : 'text-slate-900'
            }`}
          >
            {formatPKR(amt)}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      width: '130px',
      render: (v) => {
        const amt = Number(v.currentPayable || 0);
        return amt > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 whitespace-nowrap">
            <span className="h-2 w-2 rounded-full bg-rose-600 shrink-0" /> Payable Due
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0e7d5a] whitespace-nowrap">
            <span className="h-2 w-2 rounded-full bg-[#0e7d5a] shrink-0" /> Settled
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      width: '140px',
      render: (v) => (
        <div className="flex items-center justify-center gap-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => openLedger(v)}
            title="Inspect Vendor Ledger Statement"
            className="px-2 py-0.5 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
          >
            <BookOpen className="h-3 w-3" /> Ledger
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => openPayModal(v)}
              title="Record Disbursement Payment"
              className="px-2 py-0.5 text-[11px] font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Banknote className="h-3 w-3 text-emerald-600" /> Pay
            </button>
          )}
        </div>
      ),
    },
  ];

  // Ledger Modal Calculations
  const ledgerEntries: any[] = ledgerVendor?.entries || [];
  const chronological = [...ledgerEntries].reverse();
  let running = 0;
  const withRunningBalance = chronological.map((e) => {
    const signed =
      e.entryType === 'PURCHASE_CREDIT' || (e.entryType === 'ADJUSTMENT' && Number(e.amount) >= 0)
        ? Number(e.amount)
        : -Math.abs(Number(e.amount));
    running += signed;
    return { ...e, computedRunningBalance: running };
  });

  const displayLedgerEntries = [...withRunningBalance]
    .reverse()
    .filter((e) => !ledgerTypeFilter || e.entryType === ledgerTypeFilter)
    .filter((e) => {
      if (!ledgerSearch.trim()) return true;
      const s = ledgerSearch.toLowerCase();
      const ref = (e.referenceId || e.description || '').toLowerCase();
      return ref.includes(s);
    });

  const ledgerTotalBilled = ledgerEntries
    .filter((e) => e.entryType === 'PURCHASE_CREDIT' || (e.entryType === 'ADJUSTMENT' && Number(e.amount) >= 0))
    .reduce((s, e) => s + Number(e.amount), 0);

  const ledgerTotalPaid = ledgerEntries
    .filter((e) => e.entryType === 'PAYMENT')
    .reduce((s, e) => s + Number(e.amount), 0);

  const ledgerTotalReturns = ledgerEntries
    .filter((e) => e.entryType === 'RETURN_CREDIT' || (e.entryType === 'ADJUSTMENT' && Number(e.amount) < 0))
    .reduce((s, e) => s + Math.abs(Number(e.amount)), 0);

  const ledgerNetClosing = Number(ledgerVendor?.currentPayable ?? running);

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-[1700px] mx-auto">
      {/* Page Title & Add Button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Vendor Directory &amp; Ledger
            </h1>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80">
              Pharmacy Store
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Complete vendor master, double-entry statement ledger, disbursements, and credit terms.
          </p>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={openAddVendor}
            className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-[#0e7d5a] hover:bg-[#0c6b50] rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" /> Add New Vendor
          </button>
        )}
      </div>

      {/* Top Summary Metric Cards */}
      <PharmacyKpiHeader items={kpis} />

      {/* Main Vendor Directory Table */}
      <PharmacyDataTable
        columns={columns}
        data={filteredVendors}
        loading={loading}
        title="Vendor Accounts & Payables Register"
        badge="Active Vendors"
        exportFileName="vendor_accounts"
        searchPlaceholder="Search vendor by code, name, phone, or contact…"
        searchFilter={(v, q) =>
          v.code.toLowerCase().includes(q) ||
          v.name.toLowerCase().includes(q) ||
          (v.contactPerson && v.contactPerson.toLowerCase().includes(q)) ||
          (v.phone && v.phone.toLowerCase().includes(q))
        }
        onRefresh={load}
        onApplyFilters={load}
        onResetFilters={() => {
          setStatusFilter('ALL');
          load();
        }}
        filterControls={
          <div className="w-44">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full h-8.5 px-2.5 text-xs bg-slate-50 hover:bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0e7d5a] cursor-pointer"
            >
              <option value="ALL">All Vendor Accounts</option>
              <option value="DUE">With Due Balance</option>
              <option value="SETTLED">Fully Settled</option>
            </select>
          </div>
        }
        emptyTitle="No Vendors Found"
        emptyDescription="No vendor matches your search criteria. Click 'Add New Vendor' to create one."
      />

      {/* ═════════════════════════════════════════════════════════════
          VENDOR LEDGER DRAWER / MODAL
          ═════════════════════════════════════════════════════════════ */}
      {ledgerVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs overflow-y-auto print:p-0 print:bg-white print:static">
          <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden print:max-h-none print:shadow-none print:border-none print:w-full print:max-w-none">
            {/* Modal Body — Directly starts with clean hospital-green card (No top black box) */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5 bg-slate-50/50 print:p-0 print:bg-white print:overflow-visible">
              {/* Distinctive Hospital Theme Card with Integrated Actions */}
              <div className="bg-gradient-to-r from-[#0a4636] to-[#08775A] text-white p-4 sm:p-5 rounded-2xl shadow-xs space-y-3">
                {/* Header Action Row */}
                <div className="flex items-center justify-between gap-3 border-b border-white/15 pb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-white/15 flex items-center justify-center text-emerald-300">
                      <BookOpen className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-white tracking-wide uppercase">
                        Vendor Ledger &amp; Running Statement
                      </span>
                      <span className="text-[10px] text-emerald-200/80 hidden sm:inline ml-1.5">
                        · CH Sharif &amp; Saeed Hospital Pharmacy
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 print:hidden">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="px-2.5 py-1.5 text-xs font-semibold text-white bg-white/15 hover:bg-white/25 border border-white/20 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Printer className="h-3.5 w-3.5" /> Print Statement
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => openReturnModal(ledgerVendor.vendor)}
                        className="px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-white hover:bg-emerald-50 rounded-lg shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <ArrowDownLeft className="h-3.5 w-3.5 text-amber-600" /> Purchase Return
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => openPayModal({ ...ledgerVendor.vendor, currentPayable: ledgerVendor.currentPayable })}
                        className="px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-white hover:bg-emerald-50 rounded-lg shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Banknote className="h-3.5 w-3.5 text-[#0e7d5a]" /> Pay Vendor
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setLedgerVendor(null)}
                      className="p-1.5 text-white/70 hover:text-white rounded-lg hover:bg-white/20 transition-colors cursor-pointer ml-1"
                      title="Close"
                    >
                      <X className="h-4.5 w-4.5" />
                    </button>
                  </div>
                </div>

                {/* Vendor Details & Outstanding Balance Row */}
                <div className="flex flex-wrap items-center justify-between gap-4 pt-0.5">
                  <div className="flex items-center gap-3.5">
                    <div className="h-11 w-11 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-emerald-300 shrink-0">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-extrabold tracking-tight text-white">
                          {ledgerVendor.vendor?.name}
                        </h2>
                        <span className="font-mono text-xs bg-white/20 px-2 py-0.5 rounded font-bold">
                          {ledgerVendor.vendor?.code}
                        </span>
                      </div>
                      <div className="text-xs text-emerald-100/90 flex flex-wrap items-center gap-3 mt-1">
                        {ledgerVendor.vendor?.contactPerson && (
                          <span>Contact: <strong>{ledgerVendor.vendor.contactPerson}</strong></span>
                        )}
                        {ledgerVendor.vendor?.phone && (
                          <span>Phone: <strong className="font-mono">{ledgerVendor.vendor.phone}</strong></span>
                        )}
                        <span>
                          Terms: <strong>{ledgerVendor.vendor?.paymentTermsDays > 0 ? `Net ${ledgerVendor.vendor.paymentTermsDays} Days` : 'COD'}</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right bg-white/10 px-4 py-2 rounded-xl border border-white/15">
                    <div className="text-[10px] uppercase font-bold tracking-wider text-emerald-200">
                      Net Outstanding Balance
                    </div>
                    <div className="text-xl font-black tabular-nums mt-0.5 text-white">
                      {formatPKR(ledgerNetClosing)}
                    </div>
                  </div>
                </div>
              </div>

              {/* 4 Ledger Metric Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:grid-cols-4">
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Total Invoiced (Cr)
                  </div>
                  <div className="text-base font-extrabold text-slate-900 tabular-nums mt-0.5">
                    {formatPKR(ledgerTotalBilled)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Purchases billed</div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    Total Paid (Dr)
                  </div>
                  <div className="text-base font-extrabold text-emerald-700 tabular-nums mt-0.5">
                    {formatPKR(ledgerTotalPaid)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Payments disbursed</div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Returns &amp; Credits
                  </div>
                  <div className="text-base font-extrabold text-slate-700 tabular-nums mt-0.5">
                    {formatPKR(ledgerTotalReturns)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Debit notes / returns</div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Closing Balance
                  </div>
                  <div
                    className={`text-base font-extrabold tabular-nums mt-0.5 ${
                      ledgerNetClosing > 0 ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    {formatPKR(ledgerNetClosing)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {ledgerNetClosing > 0 ? 'Payable liability' : 'Account settled'}
                  </div>
                </div>
              </div>

              {/* Ledger Filter Toolbar (Hidden on print) */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 print:hidden text-xs">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <Search className="h-4 w-4 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={ledgerSearch}
                    onChange={(e) => setLedgerSearch(e.target.value)}
                    placeholder="Search voucher ref, notes, description…"
                    className="flex-1 h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08775A]"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={ledgerTypeFilter}
                    onChange={(e) => setLedgerTypeFilter(e.target.value)}
                    className="h-8 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium"
                  >
                    <option value="">All Voucher Types</option>
                    <option value="PURCHASE_CREDIT">Purchases / Bills (Cr)</option>
                    <option value="PAYMENT">Disbursements / Payments (Dr)</option>
                    <option value="RETURN_CREDIT">Returns (Debit Notes)</option>
                    <option value="ADJUSTMENT">Adjustments</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => openLedger(ledgerVendor.vendor)}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
                    title="Refresh Ledger"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Double-Entry Ledger Table */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-[#f1f5f9] select-none sticky top-0 z-10 border-b border-slate-300 text-[11px] font-bold text-slate-800 uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3 text-center w-12 border-r border-slate-300">#</th>
                        <th className="py-2.5 px-3 w-40 border-r border-slate-300">Date &amp; Time</th>
                        <th className="py-2.5 px-3 w-36 border-r border-slate-300">Voucher / Ref #</th>
                        <th className="py-2.5 px-3.5 border-r border-slate-300">Particulars / Details</th>
                        <th className="py-2.5 px-3.5 text-right w-36 border-r border-slate-300 text-emerald-800">
                          Debit (Dr - Paid)
                        </th>
                        <th className="py-2.5 px-3.5 text-right w-36 border-r border-slate-300 text-rose-800">
                          Credit (Cr - Billed)
                        </th>
                        <th className="py-2.5 px-3.5 text-right w-44 font-black text-slate-900">
                          Running Balance (PKR)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loadingLedger ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-slate-500">
                            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-emerald-600" />
                            Loading vendor ledger transactions…
                          </td>
                        </tr>
                      ) : displayLedgerEntries.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-slate-400">
                            No ledger transactions recorded yet for this vendor.
                          </td>
                        </tr>
                      ) : (
                        displayLedgerEntries.map((entry, idx) => {
                          const isCredit =
                            entry.entryType === 'PURCHASE_CREDIT' ||
                            (entry.entryType === 'ADJUSTMENT' && Number(entry.amount) >= 0);
                          const isDebit =
                            entry.entryType === 'PAYMENT' ||
                            entry.entryType === 'RETURN_CREDIT' ||
                            (entry.entryType === 'ADJUSTMENT' && Number(entry.amount) < 0);
                          const amt = Math.abs(Number(entry.amount));

                          // Extract clean human-readable voucher code
                          const voucher =
                            entry.voucherNo ||
                            (entry.referenceNo && !entry.referenceNo.includes('-4') && entry.referenceNo.length < 20 ? entry.referenceNo : null) ||
                            entry.description?.match(/PO-\d+/)?.[0] ||
                            entry.description?.match(/(VPAY|RET|ADJ|PREQ)-\d+/)?.[0] ||
                            `PO-${entry.id.slice(0, 4).toUpperCase()}`;

                          // Clean title for Particulars
                          const typeTitle =
                            entry.entryType === 'PURCHASE_CREDIT'
                              ? 'Stock Inward (Purchase)'
                              : entry.entryType === 'PAYMENT'
                              ? 'Payment Disbursement'
                              : entry.entryType === 'RETURN_CREDIT'
                              ? 'Purchase Return (Debit Note)'
                              : 'Ledger Adjustment';

                          // Check if description has extra non-redundant info
                          const isGenericPurchase = entry.description && /^Purchase\s+PO-\d+/i.test(entry.description.trim());
                          const isGenericPayment = entry.description && /^Paid on purchase\s+PO-\d+/i.test(entry.description.trim());
                          const extraNote = !isGenericPurchase && !isGenericPayment ? entry.description : null;

                          return (
                            <tr key={entry.id || idx} className="hover:bg-emerald-50/30 transition-colors">
                              <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px] bg-slate-50/50 border-r border-slate-200">
                                {idx + 1}
                              </td>
                              <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap border-r border-slate-200 text-xs">
                                {formatDateTime(entry.createdAt)}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap border-r border-slate-200">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-900 font-mono font-bold text-[11px] border border-slate-200/80">
                                  {voucher}
                                </span>
                              </td>
                              <td className="py-2.5 px-3.5 text-slate-800 border-r border-slate-200">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-slate-900 text-xs">
                                    {typeTitle}
                                  </span>
                                  {entry.vendorInvoiceNo && (
                                    <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                      Inv #{entry.vendorInvoiceNo}
                                    </span>
                                  )}
                                </div>
                                {extraNote && (
                                  <div className="text-[11px] text-slate-500 mt-0.5 truncate max-w-sm">
                                    {extraNote}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-bold tabular-nums text-emerald-700 border-r border-slate-200 text-xs whitespace-nowrap">
                                {isDebit ? formatPKR(amt) : '—'}
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-bold tabular-nums text-rose-700 border-r border-slate-200 text-xs whitespace-nowrap">
                                {isCredit ? formatPKR(amt) : '—'}
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-black tabular-nums text-slate-950 text-xs whitespace-nowrap">
                                {formatPKR(entry.computedRunningBalance ?? entry.runningBalance)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    <tfoot className="bg-[#f8fafc] border-t-2 border-slate-300 font-bold text-xs text-slate-900">
                      <tr>
                        <td colSpan={4} className="py-3 px-4 text-right uppercase tracking-wider text-[11px] text-slate-600">
                          Total Summary Movements:
                        </td>
                        <td className="py-3 px-3.5 text-right text-emerald-800 tabular-nums">
                          {formatPKR(ledgerTotalPaid)}
                        </td>
                        <td className="py-3 px-3.5 text-right text-rose-800 tabular-nums">
                          {formatPKR(ledgerTotalBilled)}
                        </td>
                        <td className="py-3 px-3.5 text-right font-black tabular-nums text-sm text-slate-950">
                          {formatPKR(ledgerNetClosing)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Print Footer Stamp (Only shown when printing) */}
              <div className="hidden print:grid grid-cols-3 gap-6 pt-12 text-center text-xs text-slate-700">
                <div className="border-t border-slate-400 pt-1">Prepared by Accountant</div>
                <div className="border-t border-slate-400 pt-1">Verified by Pharmacy Manager</div>
                <div className="border-t border-slate-400 pt-1">Authorized Vendor Signatory</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <AddVendorModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => load()}
      />

      {/* ═════════════════════════════════════════════════════════════
          RECORD PAYMENT MODAL
          ═════════════════════════════════════════════════════════════ */}
      {payVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 bg-white border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Banknote className="h-4 w-4 text-[#0e7d5a]" />
                Pay Vendor — {payVendor.name}
              </h3>
              <button
                type="button"
                onClick={() => setPayVendor(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-[11px] text-slate-500 font-medium">Total Current Due:</div>
                <div className="text-lg font-extrabold text-rose-700 tabular-nums">
                  {formatPKR(payVendor.currentPayable)}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Payment Amount (PKR) *
                </label>
                <input
                  type="number"
                  min={1}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="Enter amount"
                  className="w-full h-9 px-3 bg-white border border-slate-200 rounded-lg font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#08775A]"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Payment Method
                </label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as any)}
                  className="w-full h-9 px-3 bg-white border border-slate-200 rounded-lg font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#08775A]"
                >
                  <option value="CASH">Cash Disbursement</option>
                  <option value="CARD">Bank / POS Card</option>
                  <option value="ONLINE">Online Bank Transfer</option><option value="BANK">Bank Transfer</option>
                </select>
              </div>

              <label className="block font-semibold text-slate-700">Transaction
                <select value={refundOf} onChange={e => setRefundOf(e.target.value)} className="w-full p-2 border rounded-lg">
                  <option value="">Pay supplier / Supplier advance</option>
                  {refundCredits.map(c => <option key={c.id} value={c.id}>Receive refund against {c.referenceNo} ({formatPKR(Math.abs(Number(c.amount)))})</option>)}
                </select>
              </label>
              {payMethod !== "CASH" && <PaymentAccountSelect value={paymentAccountId} onChange={setPaymentAccountId} />}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Voucher / Cheque Reference (Optional)
                </label>
                <input
                  type="text"
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                  placeholder="e.g. CHQ-92819"
                  className="w-full h-9 px-3 bg-white border border-slate-200 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-[#08775A]"
                />
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handlePay}
                  disabled={paying}
                  className="w-full h-10 font-bold text-white bg-[#08775A] hover:bg-[#065f46] rounded-xl shadow-xs disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                >
                  {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                  Confirm Vendor Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════
          PURCHASE RETURN MODAL (purchase-costing-plan — always against
          a specific batch, using ITS frozen packaging + cost snapshot)
          ═════════════════════════════════════════════════════════════ */}
      {returnVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 bg-white border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ArrowDownLeft className="h-4 w-4 text-amber-600" />
                Purchase Return — {returnVendor.name}
              </h3>
              <button
                type="button"
                onClick={() => setReturnVendor(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Medicine *</label>
                <select
                  value={returnMedicineId}
                  onChange={(e) => selectReturnMedicine(e.target.value)}
                  className="w-full h-9 px-3 bg-white border border-slate-200 rounded-lg font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#08775A]"
                >
                  <option value="">Select medicine…</option>
                  {returnMedicines.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.code})</option>)}
                </select>
              </div>

              {returnMedicineId && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Batch *</label>
                  {loadingReturnBatches ? (
                    <div className="flex items-center gap-2 text-slate-400 py-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading batches…</div>
                  ) : returnBatches.length === 0 ? (
                    <p className="text-[11px] text-rose-600">No in-stock batches purchased from this vendor for this medicine.</p>
                  ) : (
                    <select
                      value={returnBatchId}
                      onChange={(e) => { setReturnBatchId(e.target.value); setReturnQty(''); }}
                      className="w-full h-9 px-3 bg-white border border-slate-200 rounded-lg font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#08775A]"
                    >
                      <option value="">Select batch…</option>
                      {returnBatches.map((b) => (
                        <option key={b.id} value={b.id}>{b.batchNumber} — {formatNumber(b.currentStock)} in stock (exp {formatDate(b.expiryDate)})</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {selectedReturnBatch && (
                <>
                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600">
                    This batch's purchase unit: <strong className="text-slate-800">{selectedReturnBatch.purchaseUnit?.name ?? '—'}</strong> (1 = {Number(selectedReturnBatch.purchaseUnitConversionToBase)} base units, frozen at purchase time — never today's live packaging)
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Return Quantity ({selectedReturnBatch.purchaseUnit?.name ?? 'unit'}) *
                    </label>
                    <input
                      type="number" min={1}
                      value={returnQty}
                      onChange={(e) => setReturnQty(e.target.value)}
                      placeholder="0"
                      className="w-full h-9 px-3 bg-white border border-slate-200 rounded-lg font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#08775A]"
                    />
                  </div>
                  {Number(returnQty) > 0 && (
                    <div className="flex items-center justify-between p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px]">
                      <span className="text-amber-800">= {formatNumber(returnBaseQty)} base units</span>
                      <span className="font-bold text-amber-800">Vendor Credit: {formatPKR(returnValue)}</span>
                    </div>
                  )}
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Reason *</label>
                    <input
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      placeholder="e.g. Damaged in transit, wrong item shipped"
                      className="w-full h-9 px-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08775A]"
                    />
                  </div>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handlePurchaseReturn}
                      disabled={returning}
                      className="w-full h-10 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                    >
                      {returning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownLeft className="h-4 w-4" />}
                      Post Return &amp; Vendor Credit
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
