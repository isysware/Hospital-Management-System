import React from 'react';
import { Modal } from '../../../components/common/Modal';
import { StaffPayrollRow } from '../../../services/managementReportsService';
import { formatPKR } from '../../../utils/formatters';

export const StaffFinancialSources: React.FC<{ row: StaffPayrollRow; onClose: () => void }> = ({ row, onClose }) => (
  <Modal isOpen onClose={onClose} title={`${row.name} — Salary & Commission Statements`} maxWidth="xl">
    <div className="space-y-5 max-h-[70vh] overflow-y-auto">
      {[{ label: 'Salary', records: row.salaryStatements }, { label: 'Commission', records: row.commissionStatements }].map(group => <section key={group.label}>
        <h3 className="font-bold mb-2">{group.label}</h3>
        {!group.records.length && <p className="text-sm text-slate-500">No statements for this period.</p>}
        {group.records.map(record => <div key={record.id} className="border rounded-lg p-3 mb-2 text-xs space-y-2">
          <p className="font-semibold">{(record.status || '').replaceAll('_', ' ')} · Payable {formatPKR(Number(record.balance?.payable ?? 0))} · Paid {formatPKR(Number(record.balance?.paid ?? 0))} · Remaining {formatPKR(Number(record.balance?.remaining ?? 0))}</p>
          {Number(record.balance?.overpaid ?? 0) > 0 && <p className="text-rose-700">Recoverable: {formatPKR(Number(record.balance?.overpaid ?? 0))}</p>}
          <details><summary>Statement reference</summary><p>{record.id}</p><p>Run: {record.payrollRunId ?? record.commissionRunId ?? 'Individual statement'}</p></details>
          {(record.payments ?? record.payouts ?? []).map((p, i) => <p key={`pay-${i}`}>Payment: {formatPKR(Number(p.amount))} · {p.method} · {p.paidAt?.slice(0, 10)} {p.reference ? `· ${p.reference}` : ''}</p>)}
          {(record.correctionEntries ?? record.adjustments ?? []).map((a, i) => <p key={`adjust-${i}`}>Adjustment: {formatPKR(Number(a.amount))} · {a.reason} · {a.createdAt?.slice(0, 10)}</p>)}
          {(record.reversals ?? []).map((r, i) => <p key={`reverse-${i}`}>Reversal: {formatPKR(Number(r.reversalAmount))} · {r.reason} · {r.reversedAt?.slice(0, 10)}</p>)}
        </div>)}
      </section>)}
    </div>
  </Modal>
);
