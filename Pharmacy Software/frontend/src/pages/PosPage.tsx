import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  Loader2,
  Printer,
  X,
  Pill,
  Check,
  CreditCard,
  RotateCcw,
  User,
  Tag,
  Package,
} from 'lucide-react';
import { pharmacyApi, MedicineRow, Unit } from '../services/pharmacyApi';
import { HMS_BASE_URL } from '../services/apiClient';
import { formatPKR, formatNumber } from '../utils/format';
import { useToast } from '../context/ToastContext';
import { PharmacyInvoiceModal } from '../components/PharmacyInvoiceModal';
import {
  buildPharmacyThermalReceiptData,
  printPharmacyThermalReceipt,
} from '../components/PharmacyThermalReceipt';

interface CartLine {
  medicine: MedicineRow;
  /// Which configured unit this line is being sold as (medicine-packaging-plan) — defaults to the medicine's base unit.
  saleUnitId: string;
  /// Quantity in `saleUnitId` terms (e.g. 2 Strips) — NOT necessarily base units.
  quantity: number;
  discountAmount: number;
  discountType?: 'PKR' | 'PERCENT';
  discountValue?: number;
}

interface PaymentRow {
  method: 'CASH' | 'CARD' | 'ONLINE';
  amount: string;
}

/** Sale-allowed packaging levels for a medicine, smallest (base) first — medicine-packaging-plan. */
function saleUnitsFor(med: MedicineRow) {
  if (!med.packagingLevels) return [];
  return [...med.packagingLevels].filter((l) => l.isSaleUnit).sort((a, b) => Number(a.conversionToBase) - Number(b.conversionToBase));
}
function conversionFor(med: MedicineRow, unitId: string): number {
  const lvl = med.packagingLevels?.find((l) => l.unitId === unitId);
  return lvl ? Number(lvl.conversionToBase) : 1;
}
/** Per-BASE-unit rate to charge — an override pack price is reduced to its base-unit equivalent so FEFO/tax math never needs to know which unit was sold. */
function effectiveBaseRateFor(med: MedicineRow, unitId: string): number {
  const lvl = med.packagingLevels?.find((l) => l.unitId === unitId);
  if (lvl?.overrideSaleRate) return Number(lvl.overrideSaleRate) / Number(lvl.conversionToBase);
  return Number(med.saleRate);
}

const PAYMENT_METHODS: { value: PaymentRow['method']; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'ONLINE', label: 'Online' },
];

export const PosPage: React.FC = () => {
  const toast = useToast();

  // All catalog medicines & units
  const [allMedicines, setAllMedicines] = useState<MedicineRow[]>([]);
  const [unitCatalog, setUnitCatalog] = useState<Unit[]>([]);
  const [loadingMedicines, setLoadingMedicines] = useState(true);

  // Search & category filters
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Cart & checkout
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [invoiceDiscount, setInvoiceDiscount] = useState('0');
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<'PKR' | 'PERCENT'>('PKR');
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: 'CASH', amount: '' }]);
  const [paymentManuallyEdited, setPaymentManuallyEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<any | null>(null);
  const [pharmacySettings, setPharmacySettings] = useState<any>(null);
  const [hospitalProfile, setHospitalProfile] = useState<any>(null);

  // Quick Add Medicine Modal state
  const [showAddMedicineModal, setShowAddMedicineModal] = useState(false);
  const [newMedForm, setNewMedForm] = useState({
    code: '',
    name: '',
    category: '',
    baseUnitId: '',
    saleRate: '',
    reorderLevel: '10',
    taxPercent: '0',
  });
  const [addingMedicine, setAddingMedicine] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load medicines & units on mount
  const loadMedicines = () => {
    setLoadingMedicines(true);
    pharmacyApi
      .listMedicines()
      .then((rows) => {
        setAllMedicines(rows.filter((r) => r.isActive));
      })
      .catch(() => toast.error('Failed to load medicines for POS.'))
      .finally(() => setLoadingMedicines(false));
  };

  useEffect(() => {
    loadMedicines();
    pharmacyApi.listUnits().then(setUnitCatalog).catch(() => {});
    pharmacyApi.getPharmacySettings().then(setPharmacySettings).catch(() => {});
    fetch(`${HMS_BASE_URL}/public/hospital-profile`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.data) setHospitalProfile(d.data);
      })
      .catch(() => {});
  }, []);

  // Keyboard shortcut: '/' to focus search, Ctrl+Enter to complete sale
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (cart.length > 0 && !submitting) {
          e.preventDefault();
          handleSubmit();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, submitting]);

  // Unique categories for filter chips
  const categories = useMemo(() => {
    const set = new Set<string>();
    allMedicines.forEach((m) => {
      if (m.category) set.add(m.category);
    });
    return Array.from(set).sort();
  }, [allMedicines]);

  // Filtered medicines displayed in the POS product catalog
  const filteredMedicines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allMedicines.filter((m) => {
      if (selectedCategory !== 'ALL' && m.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.code.toLowerCase().includes(q) ||
        (m.category && m.category.toLowerCase().includes(q))
      );
    });
  }, [allMedicines, selectedCategory, search]);

  // Cart quantity map for quick lookup on product cards
  const cartQtyByMedicineId = useMemo(() => {
    const map = new Map<string, number>();
    cart.forEach((line) => {
      map.set(line.medicine.id, line.quantity);
    });
    return map;
  }, [cart]);

  // Add product to cart or increment
  const handleProductClick = (m: MedicineRow) => {
    if (m.isOutOfStock) {
      toast.error(`"${m.name}" is currently out of stock.`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((l) => l.medicine.id === m.id);
      if (existing) {
        return prev.map((l) =>
          l.medicine.id === m.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...prev, { medicine: m, saleUnitId: m.baseUnitId || '', quantity: 1, discountAmount: 0 }];
    });
  };

  const updateLine = (medicineId: string, patch: Partial<CartLine>) => {
    setCart((prev) => prev.map((l) => (l.medicine.id === medicineId ? { ...l, ...patch } : l)));
  };

  const removeLine = (medicineId: string) =>
    setCart((prev) => prev.filter((l) => l.medicine.id !== medicineId));

  const clearCart = () => {
    setCart([]);
    setCustomerName('');
    setInvoiceDiscount('0');
    setInvoiceDiscountType('PKR');
    setPaymentManuallyEdited(false);
    setPayments([{ method: 'CASH', amount: '' }]);
  };

  // Financial totals
  const totals = useMemo(() => {
    let subtotal = 0;
    let lineDiscounts = 0;
    let tax = 0;
    for (const l of cart) {
      const baseQty = l.quantity * conversionFor(l.medicine, l.saleUnitId);
      const gross = baseQty * effectiveBaseRateFor(l.medicine, l.saleUnitId);
      const disc = Math.min(l.discountAmount, gross);
      const taxable = gross - disc;
      const lineTax = (taxable * Number(l.medicine.taxPercent)) / 100;
      subtotal += gross;
      lineDiscounts += disc;
      tax += lineTax;
    }
    const enteredInvDiscount = Math.max(0, Number(invoiceDiscount) || 0);
    const postLineSubtotal = Math.max(0, subtotal - lineDiscounts);
    const calculatedInvDiscount =
      invoiceDiscountType === 'PERCENT'
        ? Math.min(postLineSubtotal, (postLineSubtotal * Math.min(100, enteredInvDiscount)) / 100)
        : Math.min(postLineSubtotal, enteredInvDiscount);

    const total = Math.max(0, subtotal - lineDiscounts + tax - calculatedInvDiscount);
    const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const outstanding = Math.max(0, total - paid);
    return { subtotal, lineDiscounts, tax, invDiscount: calculatedInvDiscount, rawInvDiscountInput: enteredInvDiscount, total, paid, outstanding };
  }, [cart, invoiceDiscount, invoiceDiscountType, payments]);

  const addPaymentRow = () => {
    setPaymentManuallyEdited(true);
    setPayments((prev) => [...prev, { method: 'CASH', amount: '' }]);
  };

  const removePaymentRow = (idx: number) => {
    setPayments((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length <= 1) {
        setPaymentManuallyEdited(false);
      }
      return next;
    });
  };

  const payInFull = () => {
    setPaymentManuallyEdited(false);
    const formatted = totals.total > 0 ? String(Math.round(totals.total * 100) / 100) : '';
    setPayments((prev) => {
      const method = prev[0]?.method || 'CASH';
      return [{ method, amount: formatted }];
    });
  };

  // Auto-sync full payment by default as items or quantities are updated in the cart
  useEffect(() => {
    if (!paymentManuallyEdited) {
      if (cart.length > 0 && totals.total > 0) {
        const formatted = String(Math.round(totals.total * 100) / 100);
        setPayments((prev) => {
          if (prev.length <= 1) {
            const method = prev[0]?.method || 'CASH';
            if (prev[0]?.amount === formatted && prev[0]?.method === method) return prev;
            return [{ method, amount: formatted }];
          }
          return prev;
        });
      } else if (cart.length === 0) {
        setPayments((prev) => {
          if (prev.length <= 1 && prev[0]?.amount === '') return prev;
          if (prev.length <= 1) return [{ method: prev[0]?.method || 'CASH', amount: '' }];
          return prev;
        });
      }
    }
  }, [totals.total, cart.length, paymentManuallyEdited]);

  const handleSubmit = async () => {
    if (cart.length === 0) {
      toast.error('Your POS cart is empty. Click on medicines to add them.');
      return;
    }
    const validPayments = payments.filter((p) => Number(p.amount) > 0);
    setSubmitting(true);
    try {
      const invoice = await pharmacyApi.dispenseRetail({
        customerName: customerName.trim() || undefined,
        lines: cart.map((l) => ({
          medicineId: l.medicine.id,
          saleUnitId: l.saleUnitId || undefined,
          saleUnitQuantity: l.quantity,
          discountAmount: l.discountAmount,
        })),
        invoiceDiscount: totals.invDiscount,
        payments: validPayments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
      });
      // Fetch full invoice with complete batch and relation data
      const fullInvoice = await pharmacyApi.getInvoiceById(invoice.id).catch(() => invoice);
      toast.success(`Sale completed successfully — Invoice ${invoice.invoiceNumber}`);
      clearCart();
      loadMedicines();
      setReceipt(fullInvoice);

      // Auto-trigger authentic 80mm thermal receipt printing via isolated iframe
      try {
        const receiptData = buildPharmacyThermalReceiptData(fullInvoice, pharmacySettings, hospitalProfile);
        printPharmacyThermalReceipt(receiptData);
      } catch (printErr) {
        console.error('Thermal receipt print error:', printErr);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to complete sale.');
    } finally {
      setSubmitting(false);
    }
  };

  // Quick Add Medicine submission
  const handleCreateQuickMedicine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMedForm.name.trim() || !newMedForm.code.trim()) {
      toast.error('Medicine code and name are required.');
      return;
    }
    const baseUnitId = newMedForm.baseUnitId || unitCatalog[0]?.id;
    if (!baseUnitId) {
      toast.error('Please configure at least one unit in Settings first.');
      return;
    }
    setAddingMedicine(true);
    try {
      const created = await pharmacyApi.createMedicine({
        code: newMedForm.code.trim(),
        name: newMedForm.name.trim(),
        category: newMedForm.category.trim() || undefined,
        baseUnitId,
        baseIsPurchaseUnit: true,
        baseIsSaleUnit: true,
        packagingLevels: [],
        batchManaged: true,
        reorderLevel: Number(newMedForm.reorderLevel) || 10,
        saleRate: Number(newMedForm.saleRate) || 0,
        taxPercent: Number(newMedForm.taxPercent) || 0,
      });
      toast.success(`Medicine "${created.name}" added to catalogue.`);
      setShowAddMedicineModal(false);
      setNewMedForm({
        code: '',
        name: '',
        category: '',
        baseUnitId: unitCatalog[0]?.id || '',
        saleRate: '',
        reorderLevel: '10',
        taxPercent: '0',
      });
      loadMedicines();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to add medicine.');
    } finally {
      setAddingMedicine(false);
    }
  };

  return (
    <div className="p-3 sm:p-4 max-w-[1600px] mx-auto space-y-3 font-sans">
      {/* Top Header bar with Add Medicine button */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white px-4 py-3 rounded-xl border border-slate-200/90 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-emerald-50 text-[#0e7d5a] flex items-center justify-center font-bold">
            <ShoppingCart className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-extrabold text-slate-900 tracking-tight">
                Point of Sale (POS)
              </h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-[#0e7d5a] border border-emerald-200/70">
                Live Counter
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Click any medicine card to add to card • Shortcut: <kbd className="px-1 py-0.2 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono font-semibold text-slate-600">/</kbd> to search
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick Add Medicine Button */}
          <button
            type="button"
            onClick={() => {
              setNewMedForm({
                code: `MED-${Math.floor(100 + Math.random() * 900)}`,
                name: '',
                category: selectedCategory !== 'ALL' ? selectedCategory : '',
                baseUnitId: unitCatalog[0]?.id || '',
                saleRate: '',
                reorderLevel: '10',
                taxPercent: '0',
              });
              setShowAddMedicineModal(true);
            }}
            className="px-3 py-1.5 text-xs font-bold text-white bg-[#0e7d5a] hover:bg-[#0c6b50] rounded-lg transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 stroke-[3]" /> Add New Item
          </button>

          {cart.length > 0 && (
            <button
              type="button"
              onClick={clearCart}
              className="px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100/70 border border-rose-200/80 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear Card
            </button>
          )}

          <button
            type="button"
            onClick={loadMedicines}
            className="p-1.5 text-slate-500 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            title="Refresh Formulary Catalogue"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main 2-Column POS Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
        {/* ═════════════════════════════════════════════════════════════
            LEFT: ALL PRODUCTS CATALOGUE & QUICK-SELECT CARDS (7 Cols)
            ═════════════════════════════════════════════════════════════ */}
        <div className="lg:col-span-7 space-y-3">
          {/* Search & Category Filter Toolbar */}
          <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-2xs space-y-2.5">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search medicine name, code, category, or generic… (Press '/' to focus)"
                className="w-full h-9 pl-9 pr-8 text-xs font-medium bg-slate-50 hover:bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1.5 focus:ring-[#0e7d5a]/25 focus:border-[#0e7d5a] text-slate-900 transition-colors placeholder:text-slate-400"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Clean Professional Category Filter Tabs (Refined per User Request) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-thin">
              <button
                type="button"
                onClick={() => setSelectedCategory('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                  selectedCategory === 'ALL'
                    ? 'bg-emerald-50 text-[#0e7d5a] border border-emerald-300 shadow-2xs font-bold'
                    : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200/80 hover:text-slate-900'
                }`}
              >
                <span>All Products</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold tabular-nums ${
                    selectedCategory === 'ALL'
                      ? 'bg-emerald-200/70 text-[#0e7d5a]'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {allMedicines.length}
                </span>
              </button>

              {categories.map((cat) => {
                const count = allMedicines.filter((m) => m.category === cat).length;
                const isSelected = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-emerald-50 text-[#0e7d5a] border border-emerald-300 shadow-2xs font-bold'
                        : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200/80 hover:text-slate-900'
                    }`}
                  >
                    <span>{cat}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold tabular-nums ${
                        isSelected
                          ? 'bg-emerald-200/70 text-[#0e7d5a]'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Product Cards Grid */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs">
            <div className="flex items-center justify-between mb-2.5 text-xs">
              <span className="font-bold text-slate-800">
                Available Formulary Items ({filteredMedicines.length})
              </span>
              <span className="text-[11px] text-slate-400">
                Click card to add directly
              </span>
            </div>

            {loadingMedicines ? (
              <div className="py-16 flex flex-col items-center justify-center text-slate-500 gap-2">
                <div className="h-6 w-6 border-2 border-[#0e7d5a] border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-semibold">Loading product catalogue…</span>
              </div>
            ) : filteredMedicines.length === 0 ? (
              <div className="py-12 text-center text-slate-400 space-y-2">
                <Pill className="h-7 w-7 mx-auto text-slate-300" />
                <div className="font-bold text-slate-700 text-xs">No products found</div>
                <p className="text-[11px] text-slate-500">
                  Try searching with another keyword or click "+ Add New Item" above.
                </p>
                <button
                  type="button"
                  onClick={() => setShowAddMedicineModal(true)}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[#0e7d5a] rounded-lg hover:bg-[#0c6b50] transition-colors cursor-pointer"
                >
                  <Plus className="h-3 w-3 stroke-[3]" /> Add Item Now
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[calc(100vh-270px)] overflow-y-auto pr-1">
                {filteredMedicines.map((m) => {
                  const inCartQty = cartQtyByMedicineId.get(m.id) ?? 0;
                  const stock = Number(m.currentStock || 0);

                  return (
                    <div
                      key={m.id}
                      onClick={() => handleProductClick(m)}
                      className={`relative p-3 rounded-xl border transition-all text-left flex flex-col justify-between select-none cursor-pointer group bg-white ${
                        m.isOutOfStock
                          ? 'border-slate-200 opacity-60 cursor-not-allowed bg-slate-50/70'
                          : inCartQty > 0
                          ? 'border-[#0e7d5a] shadow-xs ring-1 ring-[#0e7d5a]/30 bg-emerald-50/15'
                          : 'border-slate-200/90 hover:border-[#0e7d5a]/60 hover:shadow-xs hover:translate-y-[-1px]'
                      }`}
                    >
                      {/* In-Cart Quantity Badge */}
                      {inCartQty > 0 && (
                        <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-[#0e7d5a] text-white font-bold text-[10px] rounded-md shadow-xs flex items-center gap-1">
                          <Check className="h-3 w-3 stroke-[3]" />
                          <span>{inCartQty} in card</span>
                        </div>
                      )}

                      {/* Out of Stock Ribbon */}
                      {m.isOutOfStock && (
                        <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-rose-600 text-white font-bold text-[9px] rounded uppercase tracking-wider">
                          Out of stock
                        </div>
                      )}

                      <div className="space-y-1">
                        <div className="font-bold text-xs text-slate-900 group-hover:text-[#0e7d5a] line-clamp-2 leading-tight pr-6 min-h-[30px]">
                          {m.name}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                          <span className="font-mono font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                            {m.code}
                          </span>
                          {m.category && (
                            <span className="truncate max-w-[110px] text-slate-400">
                              {m.category}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="pt-2 mt-2 border-t border-slate-100 flex items-center justify-between">
                        <div>
                          <div className="text-[9.5px] text-slate-400 leading-tight">Retail Rate</div>
                          <div className="font-extrabold text-xs text-slate-900 tabular-nums">
                            {formatPKR(m.saleRate)}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <div className="text-right">
                            <div className="text-[10px] font-bold text-slate-800 flex items-center justify-end gap-1">
                              <span
                                className={`inline-block h-1.5 w-1.5 rounded-full ${
                                  m.isOutOfStock
                                    ? 'bg-rose-500'
                                    : m.isLowStock
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500'
                                }`}
                              />
                              <span className="tabular-nums">{formatNumber(stock)}</span>{' '}
                              <span className="font-normal text-[9.5px] text-slate-400">{m.unit}</span>
                            </div>
                            <div className="text-[9px] text-slate-400">in stock</div>
                          </div>

                          <div className="h-6 w-6 rounded-md bg-slate-100 group-hover:bg-[#0e7d5a] group-hover:text-white text-slate-500 flex items-center justify-center transition-colors">
                            <Plus className="h-3.5 w-3.5" />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ═════════════════════════════════════════════════════════════
            RIGHT: ACTIVE POS CARD / CART & CHECKOUT (5 Cols)
            ═════════════════════════════════════════════════════════════ */}
        <div className="lg:col-span-5 sticky top-20">
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5 space-y-2.5">
            {/* Cart Header */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-emerald-50 text-[#0e7d5a] flex items-center justify-center font-bold">
                  <ShoppingCart className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900 leading-tight">Current Sale</h2>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {cart.length} {cart.length === 1 ? 'item' : 'items'} in sale card
                  </span>
                </div>
              </div>

              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={clearCart}
                  className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 transition-colors cursor-pointer"
                >
                  Clear All
                </button>
              )}
            </div>

            {/* Cart Items List — Redesigned with Green Accent & Modern Card Layout */}
            <div className="space-y-2 max-h-[230px] overflow-y-auto pr-1 scrollbar-thin">
              {cart.length === 0 ? (
                <div className="py-5 text-center text-slate-400 space-y-1">
                  <div className="h-9 w-9 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto text-slate-400">
                    <ShoppingCart className="h-4 w-4" />
                  </div>
                  <div className="font-bold text-slate-700 text-xs">Sale Card is Empty</div>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    Click any product card from the catalogue on the left to add items automatically.
                  </p>
                </div>
              ) : (
                cart.map((line) => {
                  const unitOptions = saleUnitsFor(line.medicine);
                  const baseQty = line.quantity * conversionFor(line.medicine, line.saleUnitId);
                  const gross = baseQty * effectiveBaseRateFor(line.medicine, line.saleUnitId);
                  const disc = Math.min(line.discountAmount, gross);
                  const taxable = gross - disc;
                  const lineTax = (taxable * Number(line.medicine.taxPercent)) / 100;
                  const lineNet = taxable + lineTax;
                  const selectedUnitName =
                    unitOptions.find((u) => u.unitId === line.saleUnitId)?.unit?.name ||
                    line.medicine.baseUnit?.name ||
                    line.medicine.unit;

                  return (
                    <div
                      key={line.medicine.id}
                      className="p-2.5 bg-white hover:bg-emerald-50/20 rounded-xl border border-slate-200/80 border-l-[3.5px] border-l-[#0e7d5a] space-y-2 shadow-2xs transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-xs text-slate-900 truncate flex items-center gap-1.5">
                            <span>{line.medicine.name}</span>
                            {line.medicine.category && (
                              <span className="text-[9.5px] font-medium px-1.5 py-0.2 rounded bg-slate-100 text-slate-500">
                                {line.medicine.category}
                              </span>
                            )}
                          </div>
                          <div className="text-[10.5px] text-slate-500 font-mono mt-0.5">
                            <span className="text-slate-700 font-semibold">
                              {formatPKR(gross / Math.max(1, line.quantity))}
                            </span>
                            <span className="text-slate-400">
                              {' '}× {line.quantity} {selectedUnitName}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <div className="font-extrabold text-sm text-[#0e7d5a] tabular-nums">
                              {formatPKR(lineNet)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLine(line.medicine.id)}
                            className="p-1 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Remove item"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Stepper, Unit selection, & Line Discount row */}
                      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-xs">
                        {unitOptions.length > 1 ? (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-400">Unit:</span>
                            <select
                              value={line.saleUnitId}
                              onChange={(e) =>
                                updateLine(line.medicine.id, {
                                  saleUnitId: e.target.value,
                                  quantity: 1,
                                })
                              }
                              className="h-6.5 px-2 text-[10.5px] font-semibold bg-slate-50 border border-slate-200 rounded-md text-slate-800"
                            >
                              {unitOptions.map((o) => {
                                const uName =
                                  o.unit?.name ||
                                  unitCatalog.find((u) => u.id === o.unitId)?.name ||
                                  'Unit';
                                const conv = Number(o.conversionToBase) || 1;
                                const baseName = line.medicine.unit || line.medicine.baseUnit?.name || 'unit';
                                return (
                                  <option key={o.unitId} value={o.unitId}>
                                    {uName} {conv > 1 ? `(${conv} ${baseName}s)` : `(1 ${baseName})`}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        ) : (
                          <span className="text-[10.5px] text-slate-500 font-medium bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                            {selectedUnitName}
                          </span>
                        )}

                        <div className="flex items-center gap-2 ml-auto">
                          {/* Line Discount Input with PKR / % Toggle */}
                          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-md px-1 py-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                const newType = (line.discountType || 'PKR') === 'PKR' ? 'PERCENT' : 'PKR';
                                const lineGross = line.quantity * conversionFor(line.medicine, line.saleUnitId) * effectiveBaseRateFor(line.medicine, line.saleUnitId);
                                const currAmt = line.discountAmount || 0;
                                let newAmt = currAmt;
                                let newVal = line.discountValue || 0;

                                if (newType === 'PERCENT') {
                                  newVal = lineGross > 0 ? Math.min(100, Math.round((currAmt / lineGross) * 100)) : 0;
                                  newAmt = Math.min(lineGross, (lineGross * newVal) / 100);
                                } else {
                                  newVal = currAmt;
                                  newAmt = Math.min(lineGross, newVal);
                                }

                                updateLine(line.medicine.id, {
                                  discountType: newType,
                                  discountValue: newVal,
                                  discountAmount: newAmt,
                                });
                              }}
                              className="px-1 py-0.5 text-[9px] font-bold rounded bg-white text-slate-700 shadow-2xs hover:bg-[#0e7d5a] hover:text-white transition-all cursor-pointer"
                              title="Click to toggle between PKR & %"
                            >
                              {(line.discountType || 'PKR') === 'PERCENT' ? '%' : 'Rs'}
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={(line.discountType || 'PKR') === 'PERCENT' ? 100 : undefined}
                              value={
                                (line.discountType || 'PKR') === 'PERCENT'
                                  ? (line.discountValue ?? '')
                                  : (line.discountAmount || '')
                              }
                              onChange={(e) => {
                                const inputVal = Math.max(0, Number(e.target.value) || 0);
                                const lineGross = line.quantity * conversionFor(line.medicine, line.saleUnitId) * effectiveBaseRateFor(line.medicine, line.saleUnitId);
                                if ((line.discountType || 'PKR') === 'PERCENT') {
                                  const clampedPct = Math.min(100, inputVal);
                                  const calcAmount = Math.min(lineGross, (lineGross * clampedPct) / 100);
                                  updateLine(line.medicine.id, {
                                    discountType: 'PERCENT',
                                    discountValue: clampedPct,
                                    discountAmount: calcAmount,
                                  });
                                } else {
                                  updateLine(line.medicine.id, {
                                    discountType: 'PKR',
                                    discountValue: inputVal,
                                    discountAmount: Math.min(lineGross, inputVal),
                                  });
                                }
                              }}
                              placeholder="0"
                              className="w-12 h-5.5 text-right text-[11px] bg-transparent text-slate-900 focus:outline-none"
                            />
                          </div>

                          {/* Stepper */}
                          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                updateLine(line.medicine.id, {
                                  quantity: Math.max(1, line.quantity - 1),
                                })
                              }
                              className="h-5.5 w-5.5 rounded flex items-center justify-center hover:bg-white hover:shadow-2xs text-slate-700 transition-all cursor-pointer"
                            >
                              <Minus className="h-2.5 w-2.5" />
                            </button>
                            <span className="w-7 text-center font-bold text-xs tabular-nums text-slate-900">
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateLine(line.medicine.id, {
                                  quantity: line.quantity + 1,
                                })
                              }
                              className="h-5.5 w-5.5 rounded flex items-center justify-center hover:bg-white hover:shadow-2xs text-slate-700 transition-all cursor-pointer"
                            >
                              <Plus className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Customer & Overall Discount Inputs — Compact 2-Column Grid */}
            <div className="border-t border-slate-100 pt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-[10px] font-semibold text-slate-600 mb-1 flex items-center gap-1">
                  <User className="h-3 w-3 text-slate-400" />
                  Patient / Customer
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Walk-in Patient"
                  className="w-full h-7.5 px-2.5 text-xs bg-slate-50 hover:bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0e7d5a] focus:border-[#0e7d5a] transition-colors"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-semibold text-slate-600 flex items-center gap-1">
                    <Tag className="h-3 w-3 text-slate-400" />
                    Overall Discount
                  </label>
                  <div className="flex items-center bg-slate-100 p-0.5 rounded border border-slate-200">
                    <button
                      type="button"
                      onClick={() => {
                        if (invoiceDiscountType !== 'PKR') {
                          setInvoiceDiscountType('PKR');
                          setInvoiceDiscount(totals.invDiscount > 0 ? String(Math.round(totals.invDiscount)) : '0');
                        }
                      }}
                      className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                        invoiceDiscountType === 'PKR' ? 'bg-[#0e7d5a] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      PKR
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (invoiceDiscountType !== 'PERCENT') {
                          const baseSub = Math.max(0, totals.subtotal - totals.lineDiscounts);
                          const pct = baseSub > 0 ? Math.min(100, Math.round((totals.invDiscount / baseSub) * 100)) : 0;
                          setInvoiceDiscountType('PERCENT');
                          setInvoiceDiscount(String(pct));
                        }
                      }}
                      className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                        invoiceDiscountType === 'PERCENT' ? 'bg-[#0e7d5a] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      %
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={invoiceDiscountType === 'PERCENT' ? 100 : undefined}
                    value={invoiceDiscount}
                    onChange={(e) => setInvoiceDiscount(e.target.value)}
                    placeholder="0"
                    className="w-full h-7.5 pl-2.5 pr-8 text-xs bg-slate-50 hover:bg-white border border-slate-200 rounded-lg text-right font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0e7d5a] focus:border-[#0e7d5a] transition-colors"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">
                    {invoiceDiscountType === 'PERCENT' ? '%' : 'Rs'}
                  </span>
                </div>
              </div>
            </div>

            {/* Financial Breakdown Summary */}
            <div className="border-t border-slate-100 pt-2 space-y-1 text-xs">
              <div className="flex justify-between text-[11px] text-slate-600">
                <span>Gross Subtotal:</span>
                <span className="font-semibold text-slate-900 tabular-nums">
                  {formatPKR(totals.subtotal)}
                </span>
              </div>
              {(totals.lineDiscounts > 0 || totals.invDiscount > 0) && (
                <div className="flex justify-between text-[11px] text-emerald-700">
                  <span>Total Discounts:</span>
                  <span className="font-semibold tabular-nums">
                    - {formatPKR(totals.lineDiscounts + totals.invDiscount)}
                  </span>
                </div>
              )}
              {totals.tax > 0 && (
                <div className="flex justify-between text-[11px] text-slate-600">
                  <span>GST / Tax:</span>
                  <span className="font-semibold tabular-nums">+ {formatPKR(totals.tax)}</span>
                </div>
              )}

              {/* Net Payable: Clean, High-Contrast White Theme with Emerald Accent (No Black Bar) */}
              <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/90 flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-emerald-950 block leading-tight">Net Payable</span>
                  <span className="text-[9.5px] text-emerald-700/90 font-medium">Final invoice total</span>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black tabular-nums text-[#0e7d5a] tracking-tight">
                    {formatPKR(totals.total)}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Section */}
            <div className="border-t border-slate-100 pt-2 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 text-[10.5px] flex items-center gap-1">
                  <CreditCard className="h-3 w-3 text-slate-500" />
                  Payment Collection
                </span>
                <button
                  type="button"
                  onClick={payInFull}
                  className="text-[10.5px] font-bold text-[#0e7d5a] hover:underline cursor-pointer"
                >
                  Pay Full ({formatPKR(totals.total)})
                </button>
              </div>

              {payments.map((p, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <select
                    value={p.method}
                    onChange={(e) =>
                      setPayments((prev) =>
                        prev.map((row, i) =>
                          i === idx
                            ? { ...row, method: e.target.value as PaymentRow['method'] }
                            : row
                        )
                      )
                    }
                    className="h-7.5 px-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 font-semibold"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    step="any"
                    min={0}
                    value={p.amount}
                    onChange={(e) => {
                      setPaymentManuallyEdited(true);
                      setPayments((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, amount: e.target.value } : row))
                      );
                    }}
                    placeholder="Amount (PKR)"
                    className="flex-1 h-7.5 px-2 text-xs border border-slate-200 rounded-lg text-right font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
                  />

                  {payments.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePaymentRow(idx)}
                      className="p-1 text-rose-500 hover:text-rose-700 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}

              <div className="flex items-center justify-between text-[10.5px] pt-0.5">
                <button
                  type="button"
                  onClick={addPaymentRow}
                  className="text-slate-500 hover:text-[#0e7d5a] font-medium flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="h-3 w-3" /> Add Split Payment
                </button>
                <div className="font-semibold text-slate-600">
                  Balance:{' '}
                  <span
                    className={`tabular-nums ${
                      totals.outstanding > 0 ? 'text-rose-600 font-bold' : 'text-slate-700'
                    }`}
                  >
                    {formatPKR(totals.outstanding)}
                  </span>
                </div>
              </div>
            </div>

            {/* Complete Sale Button */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || cart.length === 0}
                className="w-full h-9.5 flex items-center justify-center gap-2 rounded-xl bg-[#0e7d5a] hover:bg-[#0c6b50] text-white text-xs font-bold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Printer className="h-3.5 w-3.5" />
                )}
                Complete Sale &amp; Print Receipt
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Add Medicine Modal */}
      {showAddMedicineModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-emerald-100 text-[#0e7d5a] flex items-center justify-center font-bold">
                  <Package className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Quick Add Item to Formulary</h3>
                  <p className="text-[10.5px] text-slate-500">Register new medicine on the fly for POS counter</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddMedicineModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreateQuickMedicine} className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Item Code <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newMedForm.code}
                    onChange={(e) => setNewMedForm({ ...newMedForm, code: e.target.value })}
                    placeholder="e.g. MED-105"
                    className="w-full h-8 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1.5 focus:ring-[#0e7d5a]/25 focus:border-[#0e7d5a] text-slate-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    list="category-suggestions"
                    value={newMedForm.category}
                    onChange={(e) => setNewMedForm({ ...newMedForm, category: e.target.value })}
                    placeholder="e.g. Antibiotic"
                    className="w-full h-8 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1.5 focus:ring-[#0e7d5a]/25 focus:border-[#0e7d5a] text-slate-900"
                  />
                  <datalist id="category-suggestions">
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Medicine Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newMedForm.name}
                  onChange={(e) => setNewMedForm({ ...newMedForm, name: e.target.value })}
                  placeholder="e.g. Amoxicillin 500mg Capsule"
                  className="w-full h-8 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1.5 focus:ring-[#0e7d5a]/25 focus:border-[#0e7d5a] text-slate-900 font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Base Unit <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={newMedForm.baseUnitId}
                    onChange={(e) => setNewMedForm({ ...newMedForm, baseUnitId: e.target.value })}
                    className="w-full h-8 px-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1.5 focus:ring-[#0e7d5a]/25 focus:border-[#0e7d5a] text-slate-900 font-medium"
                  >
                    {unitCatalog.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} {u.shortCode ? `(${u.shortCode})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Retail Rate (PKR) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    step="0.01"
                    value={newMedForm.saleRate}
                    onChange={(e) => setNewMedForm({ ...newMedForm, saleRate: e.target.value })}
                    placeholder="0.00"
                    className="w-full h-8 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-right font-bold text-slate-900 focus:outline-none focus:ring-1.5 focus:ring-[#0e7d5a]/25 focus:border-[#0e7d5a]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Reorder Alert Level
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={newMedForm.reorderLevel}
                    onChange={(e) => setNewMedForm({ ...newMedForm, reorderLevel: e.target.value })}
                    placeholder="10"
                    className="w-full h-8 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-right font-semibold text-slate-900 focus:outline-none focus:ring-1.5 focus:ring-[#0e7d5a]/25 focus:border-[#0e7d5a]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    GST / Tax %
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={newMedForm.taxPercent}
                    onChange={(e) => setNewMedForm({ ...newMedForm, taxPercent: e.target.value })}
                    placeholder="0"
                    className="w-full h-8 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-right font-semibold text-slate-900 focus:outline-none focus:ring-1.5 focus:ring-[#0e7d5a]/25 focus:border-[#0e7d5a]"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddMedicineModal(false)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingMedicine}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-[#0e7d5a] hover:bg-[#0c6b50] transition-colors flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {addingMedicine && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save &amp; Add to Catalogue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invoice & Thermal Slip Print Modal */}
      {receipt && (
        <PharmacyInvoiceModal
          invoice={receipt}
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
};
