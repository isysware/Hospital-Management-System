import React from 'react';
import { Trash2, Sparkles, RotateCcw, ShieldAlert, Layers, Package, TrendingUp } from 'lucide-react';
import { MedicineRow, Unit } from '../services/pharmacyApi';
import { formatPKR, formatNumber } from '../utils/format';
import { calcPurchaseLine, markupPercentOf, marginPercentOf } from '../utils/purchaseCosting';

export interface PurchaseLineState {
  medicineId: string;
  batchNumber: string;
  expiryDate: string;
  purchaseUnitId: string;
  quantity: string;
  unitCost: string;
  discountType: 'FLAT' | 'PERCENTAGE';
  discountValue: string;
  taxAmount: string;
  freightAmount: string;
  finalSaleRate: string;
  priceManuallyAdjusted: boolean;
  overridePackaging: boolean;
  overrideConversion: string;
  applyOverrideToDefault: boolean;
}

export function emptyPurchaseLine(): PurchaseLineState {
  return {
    medicineId: '',
    batchNumber: '',
    expiryDate: '',
    purchaseUnitId: '',
    quantity: '',
    unitCost: '',
    discountType: 'FLAT',
    discountValue: '0',
    taxAmount: '0',
    freightAmount: '0',
    finalSaleRate: '',
    priceManuallyAdjusted: false,
    overridePackaging: false,
    overrideConversion: '',
    applyOverrideToDefault: false,
  };
}

/** Purchase-allowed packaging levels for a medicine — includes all configured packaging levels (Box, Strip, etc.) and Base Unit (Tablet). */
export function purchaseUnitsFor(med: MedicineRow | undefined) {
  if (!med) return [];
  const options: Array<{
    unitId: string;
    unit?: { id: string; name: string };
    conversionToBase: number | string;
    isPurchaseUnit?: boolean;
    isBaseUnit?: boolean;
  }> = [];

  // 1. All configured packaging levels (Box, Strip, Pack...) sorted from highest to lowest conversion
  if (med.packagingLevels && med.packagingLevels.length > 0) {
    const sorted = [...med.packagingLevels]
      .filter((l) => l.unitId)
      .sort((a, b) => Number(b.conversionToBase) - Number(a.conversionToBase));
    for (const lvl of sorted) {
      options.push({
        unitId: lvl.unitId,
        unit: lvl.unit || { id: lvl.unitId, name: 'Unit' },
        conversionToBase: lvl.conversionToBase,
        isPurchaseUnit: lvl.isPurchaseUnit,
      });
    }
  }

  // 2. Base unit (e.g. Tablet, Piece, Bottle) with conversionToBase = 1
  const baseUnitId = med.baseUnitId || med.baseUnit?.id;
  const baseUnitName = med.baseUnit?.name || med.unit || 'Base Unit';
  if (baseUnitId && !options.some((o) => o.unitId === baseUnitId)) {
    options.push({
      unitId: baseUnitId,
      unit: med.baseUnit || { id: baseUnitId, name: baseUnitName },
      conversionToBase: 1,
      isBaseUnit: true,
    });
  }

  return options;
}

function resolveMarkupPercent(
  med: MedicineRow | undefined,
  markupRules: { category: string; markupPercent: number | string; isActive: boolean }[],
  defaultMarkupPercent: number
) {
  if (med?.category) {
    const rule = markupRules.find((r) => r.category === med.category && r.isActive);
    if (rule) return { percent: Number(rule.markupPercent), source: `"${med.category}" category rule` };
  }
  return { percent: defaultMarkupPercent, source: 'global default' };
}

interface Props {
  index: number;
  line: PurchaseLineState;
  onChange: (patch: Partial<PurchaseLineState>) => void;
  onRemove: () => void;
  canRemove: boolean;
  medicines: MedicineRow[];
  units: Unit[];
  markupRules: { category: string; markupPercent: number | string; isActive: boolean }[];
  defaultMarkupPercent: number;
  /** Opens the "Add New Medicine" modal for this line (medicine quick-add from inside the Purchase form). */
  onRequestAddMedicine?: () => void;
}

export const PurchaseLineCard: React.FC<Props> = ({
  index,
  line,
  onChange,
  onRemove,
  canRemove,
  medicines,
  units,
  markupRules,
  defaultMarkupPercent,
  onRequestAddMedicine,
}) => {
  const med = medicines.find((m) => m.id === line.medicineId);
  const purchaseOptions = purchaseUnitsFor(med);
  const selectedLevel = purchaseOptions.find((o) => o.unitId === line.purchaseUnitId) || purchaseOptions[0];
  const selectedUnitName =
    selectedLevel?.unit?.name || (units || []).find((u) => u.id === line.purchaseUnitId)?.name || 'Unit';
  const baseUnitName = med?.baseUnit?.name || med?.unit || 'unit';

  const otherCatalogUnits = (units || []).filter(
    (u) => u.isActive && !purchaseOptions.some((o) => o.unitId === u.id)
  );

  const conversionToBase =
    line.overridePackaging && line.overrideConversion
      ? Number(line.overrideConversion)
      : Number(selectedLevel?.conversionToBase ?? 1);

  const { percent: markupPercent, source: markupSource } = resolveMarkupPercent(
    med,
    markupRules,
    defaultMarkupPercent
  );

  const calc = calcPurchaseLine({
    purchaseUnitQuantity: Number(line.quantity) || 0,
    unitCost: Number(line.unitCost) || 0,
    discountType: line.discountType,
    discountValue: Number(line.discountValue) || 0,
    taxAmount: Number(line.taxAmount) || 0,
    freightAmount: Number(line.freightAmount) || 0,
    conversionToBase: conversionToBase || 1,
    markupPercent,
  });

  const finalSaleRate =
    line.priceManuallyAdjusted && line.finalSaleRate ? Number(line.finalSaleRate) : calc.suggestedSaleRate;
  const profitPerUnit = finalSaleRate - calc.effectiveCostPerBaseUnit;
  const markupOnCost = markupPercentOf(calc.effectiveCostPerBaseUnit, finalSaleRate);
  const marginPct = marginPercentOf(calc.effectiveCostPerBaseUnit, finalSaleRate);

  const innerLevels = (med?.packagingLevels ?? [])
    .filter((l) => l.level > 0 && l.unitId !== line.purchaseUnitId && Number(l.conversionToBase) < conversionToBase && Number(l.conversionToBase) > 0)
    .sort((a, b) => Number(b.conversionToBase) - Number(a.conversionToBase));

  const selectMedicine = (medicineId: string) => {
    const m = medicines.find((x) => x.id === medicineId);
    const options = purchaseUnitsFor(m);
    const defaultUnit = options.find((o) => o.isPurchaseUnit) || options[0];
    onChange({
      medicineId,
      purchaseUnitId: defaultUnit?.unitId ?? '',
      overridePackaging: false,
      overrideConversion: '',
      priceManuallyAdjusted: false,
      finalSaleRate: '',
    });
  };

  const inputCls =
    'w-full h-8 px-2.5 text-xs bg-slate-50 hover:bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#0e7d5a] focus:border-[#0e7d5a] transition-colors';
  const labelCls = 'block text-[10.5px] font-semibold text-slate-600 mb-1';

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-3.5 space-y-3 font-sans transition-all hover:border-slate-300">
      {/* ── Row 1: Header (Index, Medicine Selector, Batch No, Expiry, Delete) ── */}
      <div className="flex items-start gap-2.5">
        <span className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg bg-emerald-50 text-[#0e7d5a] border border-emerald-200/70 text-xs font-extrabold mt-0.5">
          #{index + 1}
        </span>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 flex-1">
          {/* Medicine Selection (5 cols) */}
          <div className="sm:col-span-5">
            <label className={labelCls}>Medicine Item *</label>
            <select
              value={line.medicineId}
              onChange={(e) => (e.target.value === '__add__' ? onRequestAddMedicine?.() : selectMedicine(e.target.value))}
              className={`${inputCls} font-bold text-slate-900 cursor-pointer`}
            >
              <option value="">Select medicine from formulary…</option>
              {medicines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.code})
                </option>
              ))}
              {onRequestAddMedicine && <option value="__add__">+ Add New Medicine…</option>}
            </select>
            {med?.category && (
              <p className="text-[10px] text-slate-400 mt-0.5 truncate flex items-center gap-1">
                <span>Category:</span>
                <span className="font-semibold text-slate-600">{med.category}</span>
                {med.currentStock != null && (
                  <span className="text-slate-400 ml-1">
                    (Current Stock: {formatNumber(Number(med.currentStock))} {med.unit})
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Batch Number (4 cols) - Optional */}
          <div className="sm:col-span-4">
            <label className={labelCls}>Batch / Lot No <span className="font-normal text-slate-400 lowercase">(optional)</span></label>
            <input
              value={line.batchNumber}
              onChange={(e) => onChange({ batchNumber: e.target.value })}
              placeholder="e.g. B-99420 (or blank)"
              className={`${inputCls} font-mono font-medium`}
            />
          </div>

          {/* Expiry Date (3 cols) */}
          <div className="sm:col-span-3">
            <label className={labelCls}>Expiry Date *</label>
            <input
              type="date"
              value={line.expiryDate}
              onChange={(e) => onChange({ expiryDate: e.target.value })}
              className={`${inputCls} font-medium`}
            />
          </div>
        </div>

        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="h-8 w-8 shrink-0 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer mt-5"
            title="Remove item line"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {!line.medicineId ? (
        <div className="pl-9 py-1 text-[11px] text-slate-400 italic">
          Select a medicine from the dropdown above to load its packaging, cost, and pricing calculator.
        </div>
      ) : purchaseOptions.length === 0 && otherCatalogUnits.length === 0 ? (
        <div className="pl-9 py-1 text-[11px] text-rose-600 font-medium">
          This medicine has no unit configured — please edit it in Inventory &amp; Catalog first.
        </div>
      ) : (
        <div className="pl-9 space-y-2.5">
          {/* ── Row 2: Quantity & Costing Inputs ── */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 pt-1 border-t border-slate-100">
            {/* Purchase Unit */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10.5px] font-semibold text-slate-600">Unit</label>
                {selectedLevel?.conversionToBase && Number(selectedLevel.conversionToBase) > 1 && (
                  <span className="text-[9.5px] text-slate-400 font-mono">
                    1={Number(selectedLevel.conversionToBase)}{baseUnitName}
                  </span>
                )}
              </div>
              <select
                value={line.purchaseUnitId || selectedLevel?.unitId || ''}
                onChange={(e) => {
                  const newUnitId = e.target.value;
                  const targetOpt = purchaseOptions.find((o) => o.unitId === newUnitId);
                  const isCatalogUnit = !targetOpt;
                  onChange({
                    purchaseUnitId: newUnitId,
                    overridePackaging: isCatalogUnit,
                    overrideConversion: isCatalogUnit ? '' : '',
                  });
                }}
                className={`${inputCls} font-semibold cursor-pointer`}
              >
                {purchaseOptions.length > 0 && (
                  <optgroup label="Medicine Packaging">
                    {purchaseOptions.map((o) => (
                      <option key={o.unitId} value={o.unitId}>
                        {o.unit?.name} {Number(o.conversionToBase) > 1 ? `(= ${o.conversionToBase} ${baseUnitName})` : `(${baseUnitName})`}
                      </option>
                    ))}
                  </optgroup>
                )}
                {otherCatalogUnits.length > 0 && (
                  <optgroup label="Other Available Units">
                    {otherCatalogUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} (Custom conversion)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Quantity */}
            <div>
              <label className={labelCls}>Quantity *</label>
              <input
                type="number"
                min={1}
                value={line.quantity}
                onChange={(e) => onChange({ quantity: e.target.value })}
                placeholder="0"
                className={`${inputCls} text-right font-bold font-mono text-slate-900`}
              />
            </div>

            {/* Unit Purchase Rate */}
            <div>
              <label className={labelCls}>Cost / {selectedUnitName} (PKR) *</label>
              <input
                type="number"
                min={0}
                value={line.unitCost}
                onChange={(e) => onChange({ unitCost: e.target.value })}
                placeholder="0.00"
                className={`${inputCls} text-right font-mono font-bold text-slate-900`}
              />
            </div>

            {/* Discount */}
            <div>
              <label className={labelCls}>Discount</label>
              <div className="flex gap-1">
                <select
                  value={line.discountType}
                  onChange={(e) => onChange({ discountType: e.target.value as 'FLAT' | 'PERCENTAGE' })}
                  className="h-8 px-1.5 text-[10.5px] bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-semibold cursor-pointer"
                >
                  <option value="FLAT">PKR</option>
                  <option value="PERCENTAGE">%</option>
                </select>
                <input
                  type="number"
                  min={0}
                  value={line.discountValue}
                  onChange={(e) => onChange({ discountValue: e.target.value })}
                  placeholder="0"
                  className={`${inputCls} text-right font-mono`}
                />
              </div>
            </div>

            {/* Tax */}
            <div>
              <label className={labelCls}>Tax / GST (PKR)</label>
              <input
                type="number"
                min={0}
                value={line.taxAmount}
                onChange={(e) => onChange({ taxAmount: e.target.value })}
                placeholder="0"
                className={`${inputCls} text-right font-mono`}
              />
            </div>

            {/* Freight / Landed Cost */}
            <div>
              <label className={labelCls}>Freight (PKR)</label>
              <input
                type="number"
                min={0}
                value={line.freightAmount}
                onChange={(e) => onChange({ freightAmount: e.target.value })}
                placeholder="0"
                className={`${inputCls} text-right font-mono`}
              />
            </div>
          </div>

          {/* ── Packaging Breakdown Strip ── */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-slate-50/80 rounded-lg border border-slate-200/80 text-[11px]">
            <div className="flex items-center gap-2 text-slate-600">
              <Layers className="h-3.5 w-3.5 text-[#0e7d5a]" />
              {Number(line.quantity) > 0 ? (
                <span>
                  Total Stock Received:{' '}
                  <strong className="text-slate-900 font-bold">{formatNumber(calc.baseQty)}</strong>{' '}
                  <span className="text-slate-500">{baseUnitName}</span>
                  {innerLevels.length > 0 && (
                    <span className="text-slate-400 ml-1.5">
                      ({innerLevels.map((l) => `${formatNumber((Number(line.quantity) * conversionToBase) / Number(l.conversionToBase))} ${l.unit?.name ?? ''}`).join(', ')})
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-slate-400">Enter quantity to see total stock breakdown</span>
              )}
            </div>

            {/* Packaging override toggle */}
            <label className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={line.overridePackaging}
                onChange={(e) =>
                  onChange({
                    overridePackaging: e.target.checked,
                    overrideConversion: e.target.checked ? String(selectedLevel?.conversionToBase ?? '') : '',
                  })
                }
                className="rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span>Custom packaging override</span>
            </label>
          </div>

          {line.overridePackaging && (
            <div className="bg-amber-50/70 border border-amber-200/80 rounded-lg p-2.5 space-y-1.5 text-xs animate-in fade-in-50">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-700" />
                This consignment's packaging differs from formulary default
              </div>
              <div className="flex items-center gap-2 text-xs text-amber-900">
                <span>1 {selectedUnitName} =</span>
                <input
                  type="number"
                  min={1}
                  value={line.overrideConversion}
                  onChange={(e) => onChange({ overrideConversion: e.target.value })}
                  className="w-20 h-7 px-2 text-xs text-right font-bold bg-white border border-amber-300 rounded-md focus:outline-none"
                />
                <span className="font-semibold">{baseUnitName}</span>
                <span className="text-[10.5px] text-slate-400">
                  (Default: {Number(selectedLevel?.conversionToBase ?? 1)})
                </span>
              </div>
            </div>
          )}

          {/* ── Row 3: Landed Cost & Selling Price Suggestion (Consolidated Strip) ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 bg-emerald-50/40 border border-emerald-100 rounded-xl">
            {/* Net Landed Cost */}
            <div>
              <span className="text-[10px] font-semibold text-slate-500 block">Net Landed Cost</span>
              <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                {formatPKR(calc.netPurchaseCost)}
              </span>
              <span className="text-[9.5px] text-slate-400 block mt-0.5">
                {formatPKR(calc.effectiveCostPerPurchaseUnit)} / {selectedUnitName}
              </span>
            </div>

            {/* Effective Cost per Base Unit */}
            <div>
              <span className="text-[10px] font-semibold text-slate-500 block">
                Cost / {baseUnitName}
              </span>
              <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                {formatPKR(calc.effectiveCostPerBaseUnit)}
              </span>
              <span className="text-[9.5px] text-slate-400 block mt-0.5">
                Markup rule: {markupPercent}%
              </span>
            </div>

            {/* Suggested Selling Price */}
            <div>
              <span className="text-[10px] font-semibold text-slate-500 block flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-emerald-600" />
                Suggested Price
              </span>
              <span className="text-sm font-bold text-emerald-800 tabular-nums">
                {formatPKR(calc.suggestedSaleRate)}
              </span>
              <span className="text-[9.5px] text-slate-400 block mt-0.5 truncate" title={markupSource}>
                {markupSource}
              </span>
            </div>

            {/* Final Selling Price Input */}
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-bold text-slate-700">
                  Final Retail Price *
                </span>
                {line.priceManuallyAdjusted && (
                  <button
                    type="button"
                    onClick={() => onChange({ priceManuallyAdjusted: false, finalSaleRate: '' })}
                    title="Reset to Suggested Price"
                    className="text-[9.5px] text-[#0e7d5a] hover:underline flex items-center gap-0.5 cursor-pointer"
                  >
                    <RotateCcw className="h-2.5 w-2.5" /> Reset
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.priceManuallyAdjusted ? line.finalSaleRate : calc.suggestedSaleRate.toFixed(2)}
                  onChange={(e) => onChange({ finalSaleRate: e.target.value, priceManuallyAdjusted: true })}
                  className="w-full h-8 px-2 text-right font-extrabold text-xs bg-white border border-emerald-300 rounded-lg text-emerald-900 focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
                />
              </div>
              <div className="flex items-center justify-end gap-1 text-[9.5px] mt-0.5">
                <span className="text-slate-500">Margin:</span>
                <span className={`font-bold tabular-nums ${profitPerUnit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {marginPct.toFixed(1)}% ({formatPKR(profitPerUnit)}/unit)
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
