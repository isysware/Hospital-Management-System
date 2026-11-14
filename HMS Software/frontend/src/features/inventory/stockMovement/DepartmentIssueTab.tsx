import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Lock, Layers } from 'lucide-react';
import { DataTable } from '../../../components/tables/DataTable';
import { TableColumn } from '../../../types';
import { Modal } from '../../../components/common/Modal';
import { TextInput, NumberInput, Select } from '../../../components/forms/FormControls';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { inventoryApiService, BackendStockItem } from '../../../services/inventoryApiService';
import { inventoryReportsApiService } from '../../../services/inventoryReportsApiService';
import { setupApiService, BackendDepartment } from '../../../services/setupApiService';
import { useToast } from '../../../context/ToastContext';
import { toErrorMessage } from '../../../utils/apiErrors';
import { formatDateTimeDDMMYYYY, formatDateDDMMYYYY, formatShortRef, formatPKR } from '../../../utils/formatters';

interface IssueLine {
  stockItemId: string;
  quantity: string;
}

export interface ItemAllocationPreview {
  batchNo: string | null;
  expiryDate: string | null;
  quantity: number;
  rate: number;
  gross: number;
}

export function computeItemAllocations(
  item: BackendStockItem | undefined,
  requestedQty: number,
): { totalCost: number; allocations: ItemAllocationPreview[] } {
  if (!item || requestedQty <= 0) {
    return { totalCost: 0, allocations: [] };
  }

  const batches = (item.activeBatches || []).filter((b) => Number(b.available) > 0);

  if (batches.length === 0) {
    return {
      totalCost: 0,
      allocations: [
        {
          batchNo: null,
          expiryDate: null,
          quantity: requestedQty,
          rate: 0,
          gross: 0,
        },
      ],
    };
  }

  let remaining = requestedQty;
  const allocations: ItemAllocationPreview[] = [];
  let totalCost = 0;

  for (const b of batches) {
    if (remaining <= 0) break;
    const avail = Number(b.available);
    const take = Math.min(remaining, avail);
    if (take > 0) {
      const rate = Number(b.costRate) || 0;
      const lineCost = take * rate;
      allocations.push({
        batchNo: b.batchNo,
        expiryDate: b.expiryDate,
        quantity: take,
        rate,
        gross: lineCost,
      });
      totalCost += lineCost;
      remaining -= take;
    }
  }

  if (remaining > 0) {
    const fallbackRate = Number(batches[batches.length - 1]?.costRate) || 0;
    const lineCost = remaining * fallbackRate;
    allocations.push({
      batchNo: null,
      expiryDate: null,
      quantity: remaining,
      rate: fallbackRate,
      gross: lineCost,
    });
    totalCost += lineCost;
  }

  return { totalCost, allocations };
}

export const DepartmentIssueTab: React.FC = () => {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [departments, setDepartments] = useState<BackendDepartment[]>([]);
  const [items, setItems] = useState<BackendStockItem[]>([]);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [departmentId, setDepartmentId] = useState('');
  const [receivedByName, setReceivedByName] = useState('');
  const [lines, setLines] = useState<IssueLine[]>([{ stockItemId: '', quantity: '' }]);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    inventoryReportsApiService
      .getDepartmentIssueReturn()
      .then((res) => setRows(res.rows))
      .catch((e) => setError(toErrorMessage(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    setupApiService.getDepartments().then(setDepartments).catch(() => {});
    inventoryApiService.getStockItems().then(setItems).catch(() => {});
  }, []);

  const columns: TableColumn<any>[] = [
    {
      key: 'voucherNo',
      header: 'Voucher No.',
      render: (r) => (
        <span className="font-mono font-bold text-xs text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
          {formatShortRef(r.voucherNo, r.id, 'ISS')}
        </span>
      ),
    },
    { key: 'department', header: 'Department', render: (r) => <span className="font-semibold text-slate-800">{r.department}</span> },
    {
      key: 'lines',
      header: 'Issued Items & Qty (FEFO Batches)',
      render: (r) => (
        <div className="space-y-1.5 py-0.5">
          {r.lines?.map((l: any, idx: number) => (
            <div key={idx} className="text-xs text-slate-800 flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-slate-900">{l.item || l.stockItem?.name || 'Item'}</span>
              <span className="text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded font-mono text-[11px] font-semibold border border-blue-200">
                {l.issuedQty ?? l.quantity} {l.unit || l.stockItem?.unit || ''}
              </span>
              {l.batchNo && (
                <span className="text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded font-mono text-[10px] font-medium border border-amber-200">
                  Batch: {l.batchNo}
                </span>
              )}
              {l.expiryDate && (
                <span className="text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded font-mono text-[10px] border border-slate-200">
                  Exp: {formatDateDDMMYYYY(l.expiryDate)}
                </span>
              )}
              {Number(l.costRate) > 0 && (
                <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-mono text-[10px] font-medium border border-emerald-200">
                  @ {formatPKR(l.costRate)}
                </span>
              )}
            </div>
          ))}
        </div>
      ),
    },
    { key: 'issuedAt', header: 'Date', render: (r) => formatDateTimeDDMMYYYY(r.issuedAt) },
    { key: 'receivedByName', header: 'Received By', render: (r) => r.receivedByName || '—' },
    { key: 'issuedBy', header: 'Issued By' },
    { key: 'status', header: 'Status', align: 'center', render: (r) => <StatusBadge status={r.status} size="sm" /> },
  ];

  const openForm = () => {
    setDepartmentId('');
    setReceivedByName('');
    setLines([{ stockItemId: '', quantity: '' }]);
    setIsFormOpen(true);
    inventoryApiService.getStockItems().then(setItems).catch(() => {});
  };

  const stockOf = (id: string) => items.find((i) => i.id === id);

  const handleSave = async () => {
    if (!departmentId) return toast.error('Select a department.', 'Missing Field');
    const validLines = lines.filter((l) => l.stockItemId && Number(l.quantity) > 0);
    if (validLines.length === 0) return toast.error('Add at least one item to issue.', 'Missing Lines');

    for (const l of validLines) {
      const it = stockOf(l.stockItemId);
      if (it && Number(l.quantity) > Number(it.currentStock)) {
        return toast.error(
          `Cannot issue ${l.quantity} of ${it.name}. Only ${it.currentStock} ${it.unit} available on-hand.`,
          'Insufficient Stock'
        );
      }
    }

    setSaving(true);
    try {
      await inventoryApiService.issueToDepartment({
        departmentId,
        receivedByName: receivedByName.trim() || undefined,
        lines: validLines.map((l) => ({ stockItemId: l.stockItemId, quantity: Number(l.quantity) })),
      });
      toast.success('Stock issued to department with FEFO batch allocation.', 'Department Issue Posted');
      setIsFormOpen(false);
      load();
    } catch (e) {
      toast.error(toErrorMessage(e), 'Issue Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <DataTable
        data={rows}
        columns={columns}
        keyExtractor={(r) => r.id}
        title="Department Issues (Record Log)"
        description="Audit record of all stock items issued to hospital departments against requisitions with automated FEFO/FIFO batch allocation."
        isLoading={loading}
        isError={!!error}
        errorMessage={error || undefined}
        onRefresh={load}
        onAddNew={openForm}
        addNewLabel="+ Issue Stock"
        enableSelection={false}
        enableImport={false}
        dateFilterEnabled={false}
      />

      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title="Issue Stock to Department (FEFO / FIFO Batch Allocation)"
        maxWidth="3xl"
        footer={
          <>
            <button type="button" onClick={() => setIsFormOpen(false)} className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#129b70] text-white hover:bg-[#0e7d5a] disabled:opacity-50">
              {saving ? 'Issuing…' : 'Issue Stock'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Issue Voucher No.
                </label>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  <Lock className="h-2.5 w-2.5" /> Auto-Generated
                </span>
              </div>
              <input
                type="text"
                value={`ISS-${String(((rows.length + 1) % 100) || 1).padStart(2, '0')}`}
                readOnly
                disabled
                className="w-full px-2.5 py-2 bg-slate-100 border border-slate-300 rounded text-xs font-mono font-bold text-slate-700 cursor-not-allowed select-none"
              />
            </div>
            <Select
              label="Department"
              required
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
            />
            <TextInput label="Received By (name)" value={receivedByName} onChange={(e) => setReceivedByName(e.target.value)} />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-emerald-600" />
                <span className="text-xs font-bold text-slate-700 uppercase">Item Grid (Automated FEFO / FIFO Split)</span>
              </div>
              <button
                type="button"
                onClick={() => setLines((ls) => [...ls, { stockItemId: '', quantity: '' }])}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#0e7d5a] hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> Add Line
              </button>
            </div>
            {lines.map((line, idx) => {
              const item = stockOf(line.stockItemId);
              const reqQty = Number(line.quantity) || 0;
              const allocInfo = computeItemAllocations(item, reqQty);

              return (
                <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-6">
                      <Select
                        label={idx === 0 ? 'Item' : undefined}
                        value={line.stockItemId}
                        onChange={(e) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, stockItemId: e.target.value } : l)))}
                        options={items.map((it) => ({ value: it.id, label: `${it.code} — ${it.name}` }))}
                      />
                    </div>
                    <div className="col-span-3 text-xs text-slate-600 pb-2">
                      {item ? (
                        <div>
                          <span className="font-semibold text-slate-800">Available:</span>{' '}
                          <span className={Number(item.currentStock) > 0 ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}>
                            {item.currentStock} {item.unit}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">Select an item</span>
                      )}
                    </div>
                    <div className="col-span-2">
                      <NumberInput
                        label={idx === 0 ? 'Issue Qty' : undefined}
                        value={line.quantity}
                        onChange={(e) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, quantity: e.target.value } : l)))}
                      />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Active Batches in Stock */}
                  {item && item.activeBatches && item.activeBatches.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px] pt-1">
                      <span className="text-slate-500 font-medium">In-Stock Batches (FEFO):</span>
                      {item.activeBatches.map((b, bi) => (
                        <span key={bi} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700 font-mono text-[10px]">
                          <span className="font-semibold text-slate-900">{b.batchNo ? `Batch ${b.batchNo}` : 'Batch 1'}</span>
                          <span>• {b.available} {item.unit}</span>
                          {b.expiryDate && <span className="text-amber-700">({formatDateDDMMYYYY(b.expiryDate)})</span>}
                          {Number(b.costRate) > 0 && <span className="text-emerald-700">@ {formatPKR(b.costRate)}</span>}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Live FEFO Allocation Breakdown */}
                  {reqQty > 0 && item && (
                    <div className="pt-1">
                      {allocInfo.allocations.length > 1 ? (
                        <div className="p-2 bg-amber-50/80 border border-amber-200/90 rounded-md text-[11px] font-mono space-y-1">
                          <div className="font-bold text-amber-900 flex items-center justify-between">
                            <span>⚡ FEFO Multi-Batch Split ({reqQty} {item.unit}):</span>
                            <span>Est. Total Cost: {formatPKR(allocInfo.totalCost)}</span>
                          </div>
                          {allocInfo.allocations.map((a, i) => (
                            <div key={i} className="flex items-center justify-between text-slate-700 pl-2 border-l-2 border-amber-400">
                              <span>
                                • {a.quantity} {item.unit} {a.batchNo ? `[Batch: ${a.batchNo}]` : '[Batch 1]'} {a.expiryDate ? `(Exp: ${formatDateDDMMYYYY(a.expiryDate)})` : ''} @ {formatPKR(a.rate)}
                              </span>
                              <span className="font-semibold text-slate-900">{formatPKR(a.gross)}</span>
                            </div>
                          ))}
                        </div>
                      ) : allocInfo.allocations.length === 1 && allocInfo.allocations[0] ? (
                        <div className="p-1.5 bg-blue-50/70 border border-blue-200 rounded text-[11px] font-mono flex items-center justify-between text-blue-900">
                          <span>
                            Allocated: {allocInfo.allocations[0].batchNo ? `Batch ${allocInfo.allocations[0].batchNo}` : 'Batch 1'} {allocInfo.allocations[0].expiryDate ? `(Exp: ${formatDateDDMMYYYY(allocInfo.allocations[0].expiryDate)})` : ''} • {reqQty} {item.unit} @ {formatPKR(allocInfo.allocations[0].rate)}
                          </span>
                          <span className="font-bold">{formatPKR(allocInfo.totalCost)}</span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    </div>
  );
};
