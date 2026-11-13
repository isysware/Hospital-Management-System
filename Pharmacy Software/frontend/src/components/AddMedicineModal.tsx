import React, { useEffect, useState } from 'react';
import { Loader2, Package, Pill, Plus, X } from 'lucide-react';
import { pharmacyApi, Unit } from '../services/pharmacyApi';
import { useToast } from '../context/ToastContext';
import {
  MedicinePackagingFields,
  PackagingLevelForm,
  validatePackagingState,
  createPackagingPayload,
  computeFlatConversions,
} from './MedicinePackagingFields';

const DOSAGE_FORM_OPTIONS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Cream', 'Ointment', 'Drops', 'Suspension', 'Inhaler', 'Sachet'];

const emptyForm = {
  code: '',
  barcode: '',
  name: '',
  genericName: '',
  strength: '',
  dosageForm: '',
  category: '',
  batchManaged: true,
  reorderLevel: '10',
  saleRate: '',
  taxPercent: '0',
  openingStock: '',
  openingBatchNumber: '',
  openingExpiryDate: '',
  openingCostRate: '',
};

const emptyPackaging = {
  baseUnitId: '',
  defaultPurchaseUnitId: '',
  baseIsSaleUnit: true,
  levels: [] as PackagingLevelForm[],
};

interface Props {
  open: boolean;
  onClose: () => void;
  units: Unit[];
  onUnitCreated: (unit: Unit) => void;
  /** Called with the newly created medicine row after a successful save. */
  onCreated: (medicine: any) => void;
}

/**
 * "Add Medicine to Formulary" — extracted from MedicinesPage so it can also
 * be opened from inside the New Purchase form ("+ Add New Medicine") without
 * duplicating the Medicine Master form. Same fields, same validation, same
 * API call as before the extraction (MedicinesPage's own Edit Medicine modal
 * keeps its own separate form/packaging state, untouched by this file).
 */
export const AddMedicineModal: React.FC<Props> = ({ open, onClose, units, onUnitCreated, onCreated }) => {
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [packaging, setPackaging] = useState(emptyPackaging);
  const [saving, setSaving] = useState(false);
  const [loadingNextCode, setLoadingNextCode] = useState(false);

  const handleAutoGenerateCode = () => {
    setLoadingNextCode(true);
    pharmacyApi
      .getNextMedicineCode()
      .then((code) => setForm((f) => ({ ...f, code })))
      .catch(() => toast.error('Failed to fetch next medicine code.'))
      .finally(() => setLoadingNextCode(false));
  };

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm);
    setPackaging(emptyPackaging);
    handleAutoGenerateCode();
    // Pre-fill Tax % with the shop's configured default — convenience only, fully
    // editable down to 0. The backend saves exactly what's submitted here, it never
    // silently substitutes its own default for an explicit 0 (that was the bug).
    pharmacyApi
      .getPharmacySettings()
      .then((s) => setForm((f) => ({ ...f, taxPercent: String(s.defaultTaxPercent ?? 0) })))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Medicine Name is required.');
      return;
    }
    const packagingError = validatePackagingState(packaging, units);
    if (packagingError) {
      toast.error(packagingError);
      return;
    }
    setSaving(true);
    try {
      const medicine = await pharmacyApi.createMedicine({
        code: form.code.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        name: form.name.trim(),
        genericName: form.genericName.trim() || undefined,
        strength: form.strength.trim() || undefined,
        dosageForm: form.dosageForm.trim() || undefined,
        category: form.category.trim() || undefined,
        batchManaged: form.batchManaged,
        reorderLevel: Number(form.reorderLevel) || 0,
        saleRate: form.saleRate.trim() ? Number(form.saleRate) : 0,
        taxPercent: Number(form.taxPercent) || 0,
        openingStock: form.openingStock.trim() ? Number(form.openingStock) : undefined,
        openingBatchNumber: form.openingBatchNumber.trim() || undefined,
        openingExpiryDate: form.openingExpiryDate || undefined,
        openingCostRate: form.openingCostRate.trim() ? Number(form.openingCostRate) : undefined,
        ...createPackagingPayload(packaging),
      });
      toast.success(`Medicine "${form.name}" added to formulary.`);
      onCreated(medicine);
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create medicine.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-[#08775A] flex items-center justify-center">
              <Pill className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Add Medicine to Formulary</h3>
              <p className="text-[11px] text-slate-400">Register new item in pharmacy catalog</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-1.5 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-slate-700">
                Medicine Code <span className="font-normal text-slate-400">(Optional)</span>
              </label>
              <span className="text-[10.5px] text-slate-400">Auto-assigned if left blank</span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. MED-0010"
                className="flex-1 h-9 px-3 bg-white border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
              />
              <button
                type="button"
                onClick={handleAutoGenerateCode}
                className="h-9 px-3 shrink-0 text-[11px] font-semibold text-[#0e7d5a] border border-dashed border-[#0e7d5a]/50 hover:bg-emerald-50 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                {loadingNextCode ? 'Generating…' : 'Auto-generate'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Medicine Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Augmentin"
                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl font-semibold focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Strength <span className="font-normal text-slate-400">(Optional)</span>
              </label>
              <input
                value={form.strength}
                onChange={(e) => setForm({ ...form, strength: e.target.value })}
                placeholder="e.g. 625mg, 20mg"
                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Generic Name <span className="font-normal text-slate-400">(Optional)</span>
              </label>
              <input
                value={form.genericName}
                onChange={(e) => setForm({ ...form, genericName: e.target.value })}
                placeholder="e.g. Amoxicillin + Clavulanate"
                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Dosage Form <span className="font-normal text-slate-400">(Optional)</span>
              </label>
              <input
                list="dosage-form-options-add-medicine-modal"
                value={form.dosageForm}
                onChange={(e) => setForm({ ...form, dosageForm: e.target.value })}
                placeholder="e.g. Tablet, Syrup, Capsule"
                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
              />
              <datalist id="dosage-form-options-add-medicine-modal">
                {DOSAGE_FORM_OPTIONS.map((d) => <option key={d} value={d} />)}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Therapeutic Category <span className="font-normal text-slate-400">(Optional)</span>
              </label>
              <input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Antibiotics, Analgesics, Cardiac"
                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Barcode <span className="font-normal text-slate-400">(Optional)</span>
              </label>
              <input
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                placeholder="Scan or enter barcode"
                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
              />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-1.5"><Package className="h-3.5 w-3.5 text-[#0e7d5a]" /> Packaging &amp; Units</h4>
            <MedicinePackagingFields
              units={units}
              onUnitCreated={onUnitCreated}
              baseUnitId={packaging.baseUnitId}
              onBaseUnitIdChange={(id) => setPackaging((prev) => ({ ...prev, baseUnitId: id }))}
              baseIsSaleUnit={packaging.baseIsSaleUnit}
              onBaseIsSaleUnitChange={(s) => setPackaging((prev) => ({ ...prev, baseIsSaleUnit: s }))}
              defaultPurchaseUnitId={packaging.defaultPurchaseUnitId}
              onDefaultPurchaseUnitIdChange={(id) => setPackaging((prev) => ({ ...prev, defaultPurchaseUnitId: id }))}
              levels={packaging.levels}
              onLevelsChange={(levels) => setPackaging((prev) => ({ ...prev, levels }))}
            />
          </div>

          <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Default Sale Price (Optional)</label>
              <input
                type="number"
                min={0}
                value={form.saleRate}
                onChange={(e) => setForm({ ...form, saleRate: e.target.value })}
                placeholder="0.00"
                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl font-bold font-mono focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Tax / GST %</label>
              <input
                type="number"
                min={0}
                value={form.taxPercent}
                onChange={(e) => setForm({ ...form, taxPercent: e.target.value })}
                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Reorder Alert Qty {packaging.baseUnitId && <span className="font-normal text-slate-400">({units.find((u) => u.id === packaging.baseUnitId)?.name || '...'})</span>}
              </label>
              <input
                type="number"
                min={0}
                value={form.reorderLevel}
                onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
              />
              {packaging.baseUnitId && Number(form.reorderLevel) > 0 && (() => {
                const baseName = units.find((u) => u.id === packaging.baseUnitId)?.name || 'units';
                const { calculatedLevels } = computeFlatConversions(packaging.levels, packaging.baseUnitId, units);
                const highestPack = calculatedLevels[0];
                const packQty = highestPack && highestPack.conversionToBase > 0 ? (Number(form.reorderLevel) / highestPack.conversionToBase) : null;
                return (
                  <p className="text-[10px] text-slate-400 mt-1 truncate">
                    = {form.reorderLevel} {baseName}
                    {highestPack && packQty ? ` (~${packQty % 1 === 0 ? packQty : packQty.toFixed(1)} ${highestPack.unitName}${packQty > 1 ? 's' : ''})` : ''}
                  </p>
                );
              })()}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5 text-[#0e7d5a]" /> Initial Opening Stock <span className="font-normal text-slate-400 text-xs">(optional)</span>
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Opening Stock {packaging.baseUnitId && <span className="text-slate-400">({units.find((u) => u.id === packaging.baseUnitId)?.name || 'units'})</span>}
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.openingStock}
                  onChange={(e) => setForm({ ...form, openingStock: e.target.value })}
                  placeholder="0"
                  className="w-full h-8 px-2.5 text-xs bg-white border border-slate-200 rounded-lg font-bold font-mono focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Batch / Lot No</label>
                <input
                  type="text"
                  value={form.openingBatchNumber}
                  onChange={(e) => setForm({ ...form, openingBatchNumber: e.target.value })}
                  placeholder="Optional"
                  className="w-full h-8 px-2.5 text-xs bg-white border border-slate-200 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Expiry Date</label>
                <input
                  type="date"
                  value={form.openingExpiryDate}
                  onChange={(e) => setForm({ ...form, openingExpiryDate: e.target.value })}
                  className="w-full h-8 px-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Cost / Purchase Rate</label>
                <input
                  type="number"
                  min={0}
                  value={form.openingCostRate}
                  onChange={(e) => setForm({ ...form, openingCostRate: e.target.value })}
                  placeholder="PKR 0.00"
                  className="w-full h-8 px-2.5 text-xs bg-white border border-slate-200 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
                />
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={form.batchManaged}
              onChange={(e) => setForm({ ...form, batchManaged: e.target.checked })}
              className="rounded text-emerald-600 focus:ring-emerald-500"
            />
            <span>Track batch numbers &amp; expiry dates (FEFO)</span>
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 font-bold text-white bg-[#0e7d5a] hover:bg-[#0c6b50] rounded-xl shadow-xs disabled:opacity-60 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Save Medicine
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
