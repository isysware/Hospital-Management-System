import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, AlertCircle, History, Check, Receipt } from 'lucide-react';
import { Modal } from '../../../components/common/Modal';
import { GenericReportView } from '../../../components/reports/GenericReportView';
import { useReportFilters, FilterSelect, opts } from '../../../components/reports/reportFilters';
import { formatPKR } from '../../../utils/formatters';
import { useToast } from '../../../context/ToastContext';
import { useRouter } from '../../../context/RouterContext';
import { frontdeskApiService } from '../../../services/frontdeskApiService';
import { fetchMySettlements, submitSettlement, SettlementRecord, SettlementStatus } from '../../../services/settlementService';

const STATUS_LABEL: Record<SettlementStatus, string> = {
  PREPARED: 'Prepared',
  SUBMITTED: 'Awaiting Review',
  ACCEPTED: 'Accepted',
  PARTIALLY_ACCEPTED: 'Partially Accepted',
  RETURNED: 'Returned',
  REJECTED: 'Rejected',
  REVERSED: 'Reversed',
};

const STATUS_BADGE: Record<SettlementStatus, string> = {
  PREPARED: 'bg-slate-100 text-slate-700 border-slate-200',
  SUBMITTED: 'bg-blue-50 text-blue-700 border-blue-200',
  ACCEPTED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  PARTIALLY_ACCEPTED: 'bg-amber-50 text-amber-800 border-amber-200',
  RETURNED: 'bg-orange-50 text-orange-800 border-orange-200',
  REJECTED: 'bg-rose-50 text-rose-800 border-rose-200',
  REVERSED: 'bg-slate-100 text-slate-700 border-slate-300',
};

const signed = (n: number) => (n > 0 ? `+${formatPKR(n)}` : formatPKR(n));

/** One label/value row of the settle table. */
const Row: React.FC<{ label: React.ReactNode; children: React.ReactNode; strong?: boolean }> = ({ label, children, strong }) => (
  <tr className="border-b border-slate-200 last:border-b-0">
    <td className={`py-2.5 px-4 w-1/2 ${strong ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{label}</td>
    <td className={`py-2.5 px-4 text-right font-mono border-l border-slate-200 ${strong ? 'font-bold text-slate-900' : 'text-slate-800'}`}>{children}</td>
  </tr>
);

/**
 * My Account Settlement (reporting.md §2 #9) — deliberately simple:
 * 1. Settle Current Shift: one table, ONE amount to type (cash counted in the
 *    drawer). The difference is computed; a reason is asked only when there
 *    is a difference. The counted cash is recorded as handed over in full.
 * 2. Settlement History: the same filtered report table every other report uses.
 */
export const MyAccountSettlementView: React.FC = () => {
  const toast = useToast();
  const { navigate } = useRouter();

  const [expectedCash, setExpectedCash] = useState(0);
  const [carriedForward, setCarriedForward] = useState(0);
  const [unsettledCount, setUnsettledCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const { filters, bind, reset } = useReportFilters({ status: '' });

  const loadShift = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const balance = await frontdeskApiService.getCashBalance();
      setExpectedCash(Number(balance.summary?.expectedPhysicalCash ?? 0));
      setCarriedForward(Number(balance.summary?.carriedForwardAmount ?? 0));
      setUnsettledCount(Number(balance.summary?.unsettledCount ?? 0));
    } catch (err: any) {
      setLoadError(err?.response?.data?.error?.message || err?.message || 'Failed to load your current shift.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShift();
  }, [loadShift]);

  const hasCount = counted.trim() !== '';
  const countedAmount = hasCount ? Number(counted) : 0;
  const difference = hasCount ? countedAmount - expectedCash : 0;
  const nothingToSettle = unsettledCount === 0 && carriedForward === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasCount || Number.isNaN(countedAmount) || countedAmount < 0) {
      setFormError('Enter the cash you counted in your drawer.');
      return;
    }
    if (difference !== 0 && !reason.trim()) {
      setFormError('Counted cash does not match expected cash — please write a reason.');
      return;
    }
    setFormError(null);
    setIsConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setIsSaving(true);
    try {
      await submitSettlement({
        physicalCash: countedAmount,
        varianceReason: difference !== 0 ? reason.trim() : undefined,
        // The cashier hands over everything counted — no second amount to type.
        handoverAmount: countedAmount,
      });
      toast.success('Settlement submitted for review.');
      setCounted('');
      setReason('');
      setIsConfirmOpen(false);
      loadShift();
      setHistoryKey((k) => k + 1);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to submit settlement.');
      setIsConfirmOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">My Account Settlement</h1>
          <p className="text-xs text-slate-500 mt-0.5">Count the cash in your drawer, enter it once, and submit.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/front-desk/my_balance_sheet')}
          className="h-8 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Receipt className="h-3.5 w-3.5" />
          View Balance Sheet
        </button>
      </div>

      {/* 1. Settle current shift — one table, one input */}
      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden max-w-2xl">
        <div className="px-4 py-2.5 bg-[#f1f5f9] border-b border-slate-300 text-xs font-bold uppercase tracking-wider text-slate-800">
          Settle Current Shift
        </div>

        {loadError ? (
          <div className="p-6 flex flex-col items-center gap-2 text-center">
            <AlertCircle className="h-6 w-6 text-rose-500" />
            <p className="text-xs text-rose-700 font-medium">{loadError}</p>
            <button type="button" onClick={loadShift} className="text-xs font-semibold text-[#08775A] hover:underline">
              Retry
            </button>
          </div>
        ) : isLoading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-slate-400 text-xs">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : nothingToSettle ? (
          <div className="p-8 text-center text-xs text-slate-500">Nothing to settle — you have no unsettled cash right now.</div>
        ) : (
          <>
            <table className="w-full text-xs border-collapse">
              <tbody>
                <Row label="Unsettled transactions">{unsettledCount}</Row>
                {carriedForward > 0 && <Row label="Previous shortfall (carried forward)">{formatPKR(carriedForward)}</Row>}
                <Row label="Expected cash in drawer" strong>
                  {formatPKR(expectedCash)}
                </Row>
                <Row
                  label={
                    <label htmlFor="settle-counted" className="font-bold text-slate-900">
                      Cash counted in drawer <span className="text-rose-500">*</span>
                    </label>
                  }
                >
                  <input
                    id="settle-counted"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    onWheel={(e) => e.currentTarget.blur()}
                    value={counted}
                    onChange={(e) => {
                      setCounted(e.target.value);
                      if (formError) setFormError(null);
                    }}
                    placeholder="0"
                    className="w-full max-w-44 ml-auto block rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-right text-sm font-bold font-mono text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#08775A] focus:border-[#08775A]"
                  />
                </Row>
                <Row label="Difference">
                  {!hasCount ? (
                    <span className="text-slate-400">—</span>
                  ) : difference === 0 ? (
                    <span className="text-emerald-700 font-bold">Balanced</span>
                  ) : (
                    <span className={`font-bold ${difference < 0 ? 'text-rose-700' : 'text-amber-700'}`}>
                      {signed(difference)} {difference < 0 ? '(short)' : '(extra)'}
                    </span>
                  )}
                </Row>
                {hasCount && difference !== 0 && (
                  <Row
                    label={
                      <label htmlFor="settle-reason" className="text-slate-900 font-semibold">
                        Reason for difference <span className="text-rose-500">*</span>
                      </label>
                    }
                  >
                    <input
                      id="settle-reason"
                      type="text"
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value);
                        if (formError) setFormError(null);
                      }}
                      placeholder="e.g. change shortage"
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-left font-sans text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#08775A]"
                    />
                  </Row>
                )}
              </tbody>
            </table>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-300 flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-500">
                {hasCount && difference < 0 ? 'The shortfall carries forward to your next settlement.' : 'Card / online payments are not counted as drawer cash.'}
              </span>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs transition-colors shrink-0"
              >
                <Check className="h-3.5 w-3.5" />
                Submit Settlement
              </button>
            </div>
            {formError && (
              <div className="px-4 py-2.5 bg-rose-50 border-t border-rose-200 text-xs text-rose-700 font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {formError}
              </div>
            )}
          </>
        )}
      </form>

      {/* 2. Settlement history — same report table as every other report */}
      <GenericReportView<SettlementRecord>
        key={historyKey}
        title="Settlement History"
        subtitle="Your submitted settlements and their review status."
        icon={History}
        filenamePrefix="Settlement_History"
        allTimeOption
        fetchReport={async (range) => ({
          periodLabel: range.preset === 'all' ? 'All Time' : undefined,
          rows: await fetchMySettlements({ ...range, ...(filters.status ? { status: filters.status } : {}) }),
        })}
        onResetExtraFilters={reset}
        extraFilters={<FilterSelect label="Status" options={opts(...(Object.entries(STATUS_LABEL) as [string, string][]))} {...bind('status')} />}
        rowKey={(r) => r.id}
        noTotalColumns={['Expected Cash', 'Counted Cash', 'Difference', 'Carried Forward']}
        emptyMessage="No settlements yet."
        columns={[
          { header: 'Submitted At', cell: (s) => s.submittedAt },
          { header: 'Status', cell: (s) => STATUS_LABEL[s.status] || s.status },
          { header: 'Expected Cash', align: 'right', cell: (s) => formatPKR(s.expectedCash), excelValue: (s) => s.expectedCash },
          { header: 'Counted Cash', align: 'right', cell: (s) => formatPKR(s.physicalCash), excelValue: (s) => s.physicalCash },
          { header: 'Difference', align: 'right', cell: (s) => signed(s.variance), excelValue: (s) => s.variance },
          { header: 'Carried Forward', align: 'right', cell: (s) => (s.carryForwardAmount > 0 ? formatPKR(s.carryForwardAmount) : '—'), excelValue: (s) => s.carryForwardAmount },
          { header: 'Reason', cell: (s) => s.varianceReason || '—' },
          { header: 'Shift Period', cell: (s) => `${s.periodStart} → ${s.periodEnd}` },
        ]}
        renderCell={(col, s) =>
          col.header === 'Status' ? (
            <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_BADGE[s.status] || ''}`}>{STATUS_LABEL[s.status] || s.status}</span>
          ) : col.header === 'Difference' ? (
            <span className={s.variance < 0 ? 'text-rose-700 font-semibold' : s.variance > 0 ? 'text-amber-700 font-semibold' : 'text-slate-500'}>{col.cell(s)}</span>
          ) : (
            col.cell(s)
          )
        }
      />

      <Modal
        isOpen={isConfirmOpen}
        onClose={() => !isSaving && setIsConfirmOpen(false)}
        title="Submit settlement?"
        maxWidth="sm"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              onClick={() => setIsConfirmOpen(false)}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-semibold rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {isSaving ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        }
      >
        <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
          <tbody>
            <Row label="Expected cash">{formatPKR(expectedCash)}</Row>
            <Row label="Cash counted" strong>
              {formatPKR(countedAmount)}
            </Row>
            <Row label="Difference">{difference === 0 ? 'Balanced' : signed(difference)}</Row>
            {difference !== 0 && <Row label="Reason">{reason.trim()}</Row>}
          </tbody>
        </table>
      </Modal>
    </div>
  );
};
