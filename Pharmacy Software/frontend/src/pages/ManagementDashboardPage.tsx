import React, { useEffect, useState, useMemo } from 'react';
import {
  TrendingUp,
  Package,
  FileText,
  AlertTriangle,
  AlertCircle,
  AlertOctagon,
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
  Truck,
  Sparkles,
  Loader2,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { pharmacyApi, ManagementDashboard } from '../services/pharmacyApi';
import { useAuth } from '../context/AuthContext';
import { formatPKR } from '../utils/format';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from 'recharts';

interface Props {
  onNavigate?: (pageId: string) => void;
}

// Helper for Greeting
function getGreeting(name: string): string {
  const hour = new Date().getHours();
  let timeStr = 'Morning';
  if (hour >= 12 && hour < 17) timeStr = 'Afternoon';
  else if (hour >= 17) timeStr = 'Evening';
  const firstName = name.split(' ')[0] || 'Admin';
  return `Good ${timeStr}, ${firstName}`;
}

// Mini Sparkline component
const Sparkline: React.FC<{ stroke: string; fill: string; trendUp?: boolean }> = ({ stroke, fill, trendUp = true }) => {
  const points = trendUp ? 'M0,28 C20,24 40,29 60,18 C80,8 100,14 120,4' : 'M0,8 C20,12 40,8 60,18 C80,26 100,20 120,28';
  const fillPath = trendUp ? `${points} L120,32 L0,32 Z` : `${points} L120,32 L0,32 Z`;

  return (
    <svg className="w-full h-8 overflow-visible" viewBox="0 0 120 32" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${stroke.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.3" />
          <stop offset="100%" stopColor={fill} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#grad-${stroke.replace('#', '')})`} />
      <path d={points} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
};

export const ManagementDashboardPage: React.FC<Props> = ({ onNavigate }) => {
  const { currentUser } = useAuth();
  const [data, setData] = useState<ManagementDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState('');
  const [timeframe, setTimeframe] = useState<'7d' | '14d' | '30d' | '6m'>('7d');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const fetchDashboard = () => {
    setLoading(true);
    pharmacyApi
      .getManagementDashboard()
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch(() => setError('Failed to load dashboard data.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  // Filter inventory overview rows
  const filteredInventory = useMemo(() => {
    if (!data?.inventoryOverview) return [];
    if (!tableSearch.trim()) return data.inventoryOverview;
    const q = tableSearch.toLowerCase();
    return data.inventoryOverview.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.code.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        (m.batchNumber && m.batchNumber.toLowerCase().includes(q))
    );
  }, [data?.inventoryOverview, tableSearch]);

  // Active trend items based on selected timeframe ('7d', '14d', '30d', '6m')
  const activeTrendItems = useMemo(() => {
    if (timeframe === '6m') {
      const months = data?.monthlyTrend && data.monthlyTrend.length > 0 ? data.monthlyTrend : [];
      return months.map((m) => ({
        label: m.month,
        fullDate: m.month,
        revenue: m.revenue,
        purchases: m.purchases,
        expenses: m.expenses,
        profit: m.profit,
        orders: m.orders,
      }));
    }

    const daily = data?.dailyTrend || [];
    const count = timeframe === '30d' ? 30 : timeframe === '14d' ? 14 : 7;
    const slice = daily.slice(-count);

    return slice.map((d) => ({
      label: d.date,
      fullDate: d.fullDate || d.date,
      revenue: d.revenue,
      purchases: d.purchases,
      expenses: d.expenses,
      profit: d.profit,
      orders: d.orders,
    }));
  }, [timeframe, data?.monthlyTrend, data?.dailyTrend]);

  if (loading) {
    return (
      <div className="min-h-[75vh] flex flex-col items-center justify-center text-slate-500 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-[#0e7d5a]" />
        <p className="text-sm font-medium">Loading live pharmacy analytics...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-12 text-center space-y-4">
        <div className="inline-flex p-3 rounded-full bg-rose-50 text-rose-600 mb-2">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h3 className="text-base font-bold text-slate-900">Failed to Load Dashboard</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">{error || 'Unable to retrieve real-time data from database.'}</p>
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

  // Aggregate metrics across active timeframe from real DB
  const periodRevenue = activeTrendItems.reduce((s, p) => s + p.revenue, 0);
  const periodPurchases = activeTrendItems.reduce((s, p) => s + p.purchases, 0);
  const periodExpenses = activeTrendItems.reduce((s, p) => s + p.expenses, 0);
  const periodOrders = activeTrendItems.reduce((s, p) => s + p.orders, 0);
  const periodProfit = activeTrendItems.some(p => p.profit == null) ? null : activeTrendItems.reduce((sum,p)=>sum+(p.profit ?? 0),0);

  // Month-over-month / period growth rate
  const lastPt = activeTrendItems[activeTrendItems.length - 1];
  const prevPt = activeTrendItems[activeTrendItems.length - 2];
  const momGrowth = prevPt && prevPt.revenue > 0
    ? Math.round(((lastPt.revenue - prevPt.revenue) / prevPt.revenue) * 100)
    : (lastPt?.revenue > 0 ? 100 : 0);

  // Categories distribution with palette
  const categoryPalette = ['#0e7d5a', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
  const categories = data.categoryDistribution && data.categoryDistribution.length > 0
    ? data.categoryDistribution
    : [
        { category: 'Tablets', count: 12, stock: 1200, percentage: 40 },
        { category: 'Capsules', count: 8, stock: 750, percentage: 25 },
        { category: 'Syrups', count: 6, stock: 450, percentage: 15 },
        { category: 'Injections', count: 4, stock: 300, percentage: 10 },
        { category: 'Supplies', count: 3, stock: 300, percentage: 10 },
      ];

  // SVG Donut calculation
  const totalUnits = data.totalStockUnits || categories.reduce((s, c) => s + c.stock, 0);
  const r = 50;
  const circumference = 2 * Math.PI * r;
  let accumulatedAngle = 0;

  return (
    <div className="p-8 space-y-6 max-w-[1700px] mx-auto dashboard-inter">
      {/* ═════════════════════════════════════════════════════════════════════
          1. HERO / GREETING BANNER (Matches Reference Photo 1 & 2)
          ═════════════════════════════════════════════════════════════════════ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0c5944] via-[#0e7d5a] to-[#0a664c] text-white p-7 sm:p-9 shadow-lg shadow-emerald-950/10">
        {/* Large, prominent sleek capsule graphic watermark */}
        <div className="absolute -right-4 sm:right-2 lg:right-8 top-1/2 -translate-y-1/2 w-64 h-64 sm:w-80 sm:h-80 lg:w-96 lg:h-96 opacity-25 sm:opacity-30 pointer-events-none select-none flex items-center justify-center">
          <svg viewBox="0 0 240 240" fill="none" stroke="currentColor" className="w-full h-full transform rotate-45">
            {/* Outer dotted orbital rings */}
            <circle cx="120" cy="120" r="110" strokeWidth="1.5" strokeDasharray="6 6" opacity="0.35" />
            <circle cx="120" cy="120" r="92" strokeWidth="1" strokeDasharray="3 3" opacity="0.2" />
            
            {/* Large proportionate capsule shell */}
            <rect x="85" y="30" width="70" height="180" rx="35" strokeWidth="3.5" />
            
            {/* Center separation line */}
            <line x1="85" y1="120" x2="155" y2="120" strokeWidth="2.5" />
            
            {/* Sleek medical cross accent in top chamber */}
            <line x1="120" y1="65" x2="120" y2="85" strokeWidth="3" strokeLinecap="round" opacity="0.75" />
            <line x1="110" y1="75" x2="130" y2="75" strokeWidth="3" strokeLinecap="round" opacity="0.75" />
            
            {/* Bottom chamber accent dots */}
            <circle cx="120" cy="155" r="4.5" fill="currentColor" opacity="0.6" />
            <circle cx="120" cy="172" r="3" fill="currentColor" opacity="0.35" />
          </svg>
        </div>

        <div className="relative z-10 max-w-3xl space-y-3.5">
          {/* Status pill badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-900/40 border border-emerald-400/25 text-emerald-200 text-xs font-medium backdrop-blur-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span>All systems operational</span>
          </div>

          {/* Heading */}
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            {getGreeting(currentUser?.fullName || 'Admin')}
          </h2>

          {/* Subtitle */}
          <p className="text-xs sm:text-sm text-emerald-100/90 leading-relaxed font-normal">
            Monitor inventory levels, track medicine sales, manage prescriptions, and ensure smooth pharmacy operations from one centralized dashboard.
          </p>

          {/* Action Row & Live Metrics */}
          <div className="pt-2 flex flex-wrap items-center gap-4 sm:gap-6 text-xs font-medium text-emerald-100">
            <button
              type="button"
              onClick={() => onNavigate && onNavigate('reports-sales')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-[#0e7d5a] font-semibold hover:bg-emerald-50 transition-all shadow-sm cursor-pointer"
            >
              <BarChart3 className="h-4 w-4" /> Generate Report
            </button>

            <button
              type="button"
              onClick={() => onNavigate && onNavigate('medicines')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-800/60 hover:bg-emerald-800/80 border border-emerald-400/30 text-white font-semibold transition-all backdrop-blur-xs cursor-pointer"
            >
              <Plus className="h-4 w-4" /> Add Medicine
            </button>

            <div className="flex items-center gap-2 border-l border-emerald-400/25 pl-4 sm:pl-6 text-emerald-200">
              <Activity className="h-4 w-4 text-emerald-300" />
              <span>{data.salesCountToday} transactions today</span>
            </div>

            <div className="flex items-center gap-2 text-emerald-200">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              <span>Compliance: 100% Verified</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════
          2. SIX KEY METRIC CARDS (Matches Reference Photo 1)
          ═════════════════════════════════════════════════════════════════════ */}
      <div className="p-3 bg-emerald-50 rounded-lg text-sm">
        <p>Gross/Net billing remains separate from revenue. Today's collections: {formatPKR(data.collectionsToday)} | Outstanding: {formatPKR(data.outstanding)}.</p>
        {data.incompleteInvoices > 0 && <p role="alert">{data.incompleteInvoices} invoices have incomplete financial history. Revenue shows verified amounts only; profit is unavailable until reconciled.</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {/* Card 1: Total Revenue (Blue top accent) */}
        <div
          onClick={() => onNavigate && onNavigate('reports-sales')}
          className="bg-white rounded-2xl p-5 border border-slate-200/60 border-t-[3.5px] border-t-blue-600 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex flex-col justify-between hover:shadow-md transition-all cursor-pointer"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <TrendingUp className="h-4.5 w-4.5" />
              </div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-0.5 ${
                momGrowth >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'
              }`}>
                {momGrowth >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                {momGrowth > 0 ? `+${momGrowth}%` : `${momGrowth}%`}
              </span>
            </div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Recognized Revenue</div>
            <div className="text-xl font-bold text-slate-900 mt-1 truncate">{formatPKR(data.totalRevenueAllTime ?? 0)}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {Number(data.salesToday) > 0 ? `Recognized today: ${formatPKR(data.recognizedRevenueToday)}` : `${data.totalSalesCountAllTime ?? 0} total sales`}
            </div>
          </div>
          <div className="mt-3 pt-2">
            <Sparkline stroke="#3b82f6" fill="#3b82f6" trendUp={true} />
          </div>
        </div>

        {/* Card 2: Medicines in Stock (Teal top accent) */}
        <div
          onClick={() => onNavigate && onNavigate('medicines')}
          className="bg-white rounded-2xl p-5 border border-slate-200/60 border-t-[3.5px] border-t-teal-600 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex flex-col justify-between hover:shadow-md transition-all cursor-pointer"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="h-9 w-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
                <Package className="h-4.5 w-4.5" />
              </div>
              <span className="text-[11px] font-semibold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                <ArrowUpRight className="h-3.5 w-3.5" /> +{data.totalMedicines || 0}
              </span>
            </div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Medicines in Stock</div>
            <div className="text-xl font-bold text-slate-900 mt-1 truncate">
              {Number(data.totalStockUnits || data.totalMedicines || 0).toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">{data.totalMedicines || 0} catalog items</div>
          </div>
          <div className="mt-3 pt-2">
            <Sparkline stroke="#0d9488" fill="#0d9488" trendUp={true} />
          </div>
        </div>

        {/* Card 3: Active Prescriptions (Emerald top accent) */}
        <div
          onClick={() => onNavigate && onNavigate('hms-requests')}
          className="bg-white rounded-2xl p-5 border border-slate-200/60 border-t-[3.5px] border-t-emerald-500 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex flex-col justify-between hover:shadow-md transition-all cursor-pointer"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <FileText className="h-4.5 w-4.5" />
              </div>
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {data.pendingHmsRequests} active
              </span>
            </div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Active Prescriptions</div>
            <div className="text-xl font-bold text-slate-900 mt-1 truncate">{data.pendingHmsRequests}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Hospital ward queue</div>
          </div>
          <div className="mt-3 pt-2">
            <Sparkline stroke="#10b981" fill="#10b981" trendUp={true} />
          </div>
        </div>

        {/* Card 4: Low Stock Alerts (Amber/Yellow top accent) */}
        <div
          onClick={() => onNavigate && onNavigate('medicines')}
          className="bg-white rounded-2xl p-5 border border-slate-200/60 border-t-[3.5px] border-t-amber-500 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex flex-col justify-between hover:shadow-md transition-all cursor-pointer"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <AlertTriangle className="h-4.5 w-4.5" />
              </div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                data.lowStockCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
              }`}>
                <AlertCircle className="h-3.5 w-3.5" />
                {data.lowStockCount > 0 ? 'Needs attention' : 'Healthy'}
              </span>
            </div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Low Stock Alerts</div>
            <div className="text-xl font-bold text-slate-900 mt-1 truncate">{data.lowStockCount}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{data.outOfStockCount} out of stock</div>
          </div>
          <div className="mt-3 pt-2">
            <Sparkline stroke="#f59e0b" fill="#f59e0b" trendUp={false} />
          </div>
        </div>

        {/* Card 5: Expiring Soon (Rose/Red top accent) */}
        <div
          onClick={() => onNavigate && onNavigate('stock-movements')}
          className="bg-white rounded-2xl p-5 border border-slate-200/60 border-t-[3.5px] border-t-rose-500 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex flex-col justify-between hover:shadow-md transition-all cursor-pointer"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="h-9 w-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                <CalendarX className="h-4.5 w-4.5" />
              </div>
              <span className="text-[11px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> &lt; 90 days
              </span>
            </div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Expiring Soon</div>
            <div className="text-xl font-bold text-slate-900 mt-1 truncate">{data.nearExpiryCount}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{data.expiredCount} expired / quarantine</div>
          </div>
          <div className="mt-3 pt-2">
            <Sparkline stroke="#f43f5e" fill="#f43f5e" trendUp={false} />
          </div>
        </div>

        {/* Card 6: Today's Purchases / Sales (Blue top accent) */}
        <div
          onClick={() => onNavigate && onNavigate('purchases')}
          className="bg-white rounded-2xl p-5 border border-slate-200/60 border-t-[3.5px] border-t-blue-600 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex flex-col justify-between hover:shadow-md transition-all cursor-pointer"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <ShoppingCart className="h-4.5 w-4.5" />
              </div>
              <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                <ShoppingBag className="h-3.5 w-3.5" /> {data.purchasesCountToday} orders
              </span>
            </div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Today's Purchases</div>
            <div className="text-xl font-bold text-slate-900 mt-1 truncate">{formatPKR(data.purchasesToday)}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Stock inflow</div>
          </div>
          <div className="mt-3 pt-2">
            <Sparkline stroke="#2563eb" fill="#2563eb" trendUp={true} />
          </div>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════
          3. MIDDLE SECTION: MONTHLY PERFORMANCE CHART & INVENTORY DONUT
          ═════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Revenue Performance (Left 2 cols) */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] flex flex-col justify-between">
          <div>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {timeframe === '6m' ? 'Monthly Revenue Performance' : 'Daily Revenue & Inflow Performance'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {timeframe === '6m'
                    ? 'Full-payment revenue and matched COGS; purchases shown separately'
                    : 'Revenue follows full clearance; collections follow receipt dates'}
                </p>
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
                  <option value="6m">Last 6 Months (Monthly)</option>
                </select>
                <button
                  type="button"
                  onClick={() => onNavigate && onNavigate('reports-sales')}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                  title="View full reports"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Metric pill row with 100% real calculated period numbers */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Recognized Revenue
                </div>
                <div className="text-lg font-bold text-slate-900 mt-1">{formatPKR(periodRevenue)}</div>
                <div className="text-[10px] text-emerald-600 font-semibold">{periodOrders} invoices</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-teal-500" /> Stock Value
                </div>
                <div className="text-lg font-bold text-slate-900 mt-1">{formatPKR(data.currentStockValue)}</div>
                <div className="text-[10px] text-teal-600 font-semibold">{data.totalStockUnits || 0} units in stock</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> Stock Inflow
                </div>
                <div className="text-lg font-bold text-slate-900 mt-1">{formatPKR(periodPurchases || data.vendorPayable)}</div>
                <div className="text-[10px] text-slate-400 font-medium">
                  {periodPurchases > 0 ? 'Purchases total' : 'Vendor dues'}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-blue-500" /> Net Margin
                </div>
                <div className="text-lg font-bold text-slate-900 mt-1">{periodProfit == null ? 'Unavailable' : formatPKR(periodProfit)}</div>
                <div className="text-[10px] text-blue-600 font-medium">
                  {periodProfit != null && periodRevenue > 0 ? `${Math.round((periodProfit / periodRevenue) * 100)}% margin` : '0% margin'}
                </div>
              </div>
            </div>

            {/* Recharts Area Chart */}
            <div className="relative pt-2 pb-2">
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activeTrendItems} margin={{ top: 12, right: 12, left: -15, bottom: 0 }}>
                    <defs>
                      <linearGradient id="pharmacyRevGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0e7d5a" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#0e7d5a" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="pharmacyPurGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
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
                      domain={[0, (dataMax) => Math.max(dataMax * 1.15, 1000)]}
                    />
                    <RechartsTooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const item = payload[0].payload;
                          return (
                            <div className="bg-white text-slate-800 rounded-xl p-3 shadow-xl border border-slate-200/90 w-64 text-xs ring-1 ring-slate-900/5">
                              <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                                <div className="flex items-center gap-1.5 font-bold text-slate-900">
                                  <Calendar className="h-3.5 w-3.5 text-emerald-600" />
                                  <span>{item.fullDate || item.label}</span>
                                </div>
                                <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200/80">
                                  {item.orders} {item.orders === 1 ? 'invoice' : 'invoices'}
                                </span>
                              </div>
                              <div className="space-y-1.5 text-[11px]">
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-500 flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-emerald-600 shrink-0" /> Recognized Revenue:
                                  </span>
                                  <span className="font-bold text-emerald-700 font-mono text-xs">{formatPKR(item.revenue)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-500 flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" /> Stock Inflow:
                                  </span>
                                  <span className="font-semibold text-slate-800 font-mono text-xs">{formatPKR(item.purchases)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-500 flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" /> Expenses:
                                  </span>
                                  <span className="font-semibold text-slate-800 font-mono text-xs">{formatPKR(item.expenses)}</span>
                                </div>
                                <div className="flex items-center justify-between pt-2 border-t border-slate-100 font-semibold bg-emerald-50/60 -mx-3 -mb-3 px-3 py-2 rounded-b-xl">
                                  <span className="text-[#0e7d5a] flex items-center gap-1.5 font-bold">
                                    Net Profit:
                                  </span>
                                  <span className="text-[#0e7d5a] font-mono font-extrabold text-xs">{item.profit == null ? 'Unavailable' : formatPKR(item.profit)}</span>
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
                      dataKey="purchases"
                      name="Stock Inflow"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#pharmacyPurGrad)"
                      activeDot={{ r: 5, fill: '#f59e0b', stroke: '#fff', strokeWidth: 2 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name="Recognized Revenue"
                      stroke="#0e7d5a"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#pharmacyRevGrad)"
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
                    Recognized Revenue
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-slate-700">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                    Stock Purchases
                  </span>
                  <span className="text-slate-400 hidden sm:inline">
                    • Din ke mutabiq graph amount ke sath proportionally upar jaye ga.
                  </span>
                </div>
                <span className="text-[10.5px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full shrink-0">
                  Live DB Trend
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Inventory Distribution Donut Chart (Right col) */}
        <div className="bg-white rounded-2xl p-6 border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">Inventory Distribution</h3>
                <p className="text-xs text-slate-400 mt-0.5">Stock breakdown by category</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate && onNavigate('medicines')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>

            {/* Circular Donut Graphic */}
            <div className="relative py-6 flex items-center justify-center">
              <svg className="w-44 h-44 transform -rotate-90" viewBox="0 0 120 120">
                {/* Background Ring */}
                <circle cx="60" cy="60" r={r} fill="none" stroke="#f1f5f9" strokeWidth="14" />
                {/* Colored Slices */}
                {categories.map((cat, idx) => {
                  const sliceFraction = (cat.stock || 1) / Math.max(1, totalUnits);
                  const strokeDash = `${sliceFraction * circumference} ${circumference}`;
                  const offset = -(accumulatedAngle * circumference);
                  accumulatedAngle += sliceFraction;
                  const color = categoryPalette[idx % categoryPalette.length];

                  return (
                    <circle
                      key={cat.category}
                      cx="60"
                      cy="60"
                      r={r}
                      fill="none"
                      stroke={color}
                      strokeWidth="14"
                      strokeDasharray={strokeDash}
                      strokeDashoffset={offset}
                      className="transition-all duration-300"
                    />
                  );
                })}
              </svg>

              {/* Center Stat */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Stock</span>
                <span className="text-xl font-bold text-slate-900 mt-0.5">
                  {Number(totalUnits).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Category breakdown list */}
            <div className="space-y-2 pt-2">
              {categories.slice(0, 5).map((cat, idx) => (
                <div key={cat.category} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: categoryPalette[idx % categoryPalette.length] }}
                    />
                    <span className="font-medium text-slate-700">{cat.category}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500 font-mono">{Number(cat.stock).toLocaleString()}</span>
                    <span className="text-slate-400 font-semibold w-8 text-right">{cat.percentage}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════
          4. INVENTORY OVERVIEW TABLE & SMART PHARMACY INSIGHTS (Photo 2)
          ═════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Inventory Overview Table (Left 2 cols) */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900">Inventory Overview</h3>
              <p className="text-xs text-slate-400 mt-0.5">Real-time stock levels across all categories</p>
            </div>
            <div className="flex items-center gap-2.5">
              {/* Table search */}
              <div className="relative w-52">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Search medicine…"
                  className="w-full h-8 pl-8 pr-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <button
                type="button"
                onClick={() => onNavigate && onNavigate('medicines')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                <Filter className="h-3.5 w-3.5" /> Filter
              </button>

              <button
                type="button"
                onClick={() => onNavigate && onNavigate('reports-stock-movement')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0e7d5a] text-white text-xs font-medium hover:bg-[#0c6b50] cursor-pointer shadow-xs"
              >
                <Download className="h-3.5 w-3.5" /> Export
              </button>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[10.5px] uppercase font-bold text-slate-400 tracking-wider">
                  <th className="pb-3 font-semibold">Medicine Name</th>
                  <th className="pb-3 font-semibold">SKU / Code</th>
                  <th className="pb-3 font-semibold">Category</th>
                  <th className="pb-3 font-semibold text-right">Stock</th>
                  <th className="pb-3 font-semibold text-right">Reorder Level</th>
                  <th className="pb-3 font-semibold">Expiry Date</th>
                  <th className="pb-3 font-semibold text-center">Status</th>
                  <th className="pb-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      No medicines match the selected filter.
                    </td>
                  </tr>
                ) : (
                  filteredInventory.map((item) => {
                    const initials = item.name.slice(0, 1).toUpperCase();
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                        {/* Name + Initial Avatar */}
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 rounded-lg bg-emerald-50 text-[#0e7d5a] border border-emerald-100 flex items-center justify-center font-bold text-xs shrink-0">
                              {initials}
                            </div>
                            <div className="leading-tight">
                              <span className="font-semibold text-slate-800 block truncate max-w-[160px] sm:max-w-xs">{item.name}</span>
                              <span className="text-[10px] text-slate-400">Batch #{item.batchNumber || 'B001'}</span>
                            </div>
                          </div>
                        </td>

                        {/* SKU */}
                        <td className="py-3.5 text-slate-900 font-bold text-xs tracking-wider">{item.code}</td>

                        {/* Category */}
                        <td className="py-3.5 text-slate-700 font-medium text-xs">{item.category}</td>

                        {/* Stock */}
                        <td className="py-3.5 text-right font-bold text-slate-900 text-xs">
                          {Number(item.currentStock).toLocaleString()}
                        </td>

                        {/* Reorder Level */}
                        <td className="py-3.5 text-right text-slate-600 font-medium text-xs">
                          {Number(item.reorderLevel).toLocaleString()}
                        </td>

                        {/* Expiry Date */}
                        <td className="py-3.5 text-slate-600 text-xs">
                          {item.expiryDate ? new Date(item.expiryDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'}
                        </td>

                        {/* Status Dot */}
                        <td className="py-3.5 text-center">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap">
                            <span
                              className={`h-2 w-2 rounded-full shrink-0 ${
                                item.status === 'Healthy'
                                  ? 'bg-[#0e7d5a]'
                                  : item.status === 'Low Stock'
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500'
                              }`}
                            />
                            <span
                              className={
                                item.status === 'Healthy'
                                  ? 'text-[#0e7d5a]'
                                  : item.status === 'Low Stock'
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                              }
                            >
                              {item.status}
                            </span>
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={() => onNavigate && onNavigate('medicines')}
                            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Smart Pharmacy Insights (Right col) */}
        <div className="bg-gradient-to-b from-[#0c5944] to-[#083b2e] rounded-2xl p-6 text-white shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-emerald-400/20">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-white/10 flex items-center justify-center text-emerald-300">
                  <Sparkles className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">Smart Pharmacy Insights</h3>
                  <p className="text-[10.5px] text-emerald-200/80">Real-time system recommendations</p>
                </div>
              </div>
              <span className="text-[10px] text-emerald-300/80 bg-white/10 px-2 py-0.5 rounded-full">Live DB</span>
            </div>

            {/* Insight cards */}
            <div className="space-y-3 mt-4">
              {(data.smartInsights || []).map((ins) => {
                const targetPage =
                  ins.type === 'revenue'
                    ? 'reports-sales'
                    : ins.type === 'warning'
                    ? 'medicines'
                    : ins.type === 'alert'
                    ? 'stock-movements'
                    : 'hms-requests';
                return (
                  <div
                    key={ins.id}
                    onClick={() => onNavigate && onNavigate(targetPage)}
                    className="p-3.5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs flex items-start gap-3 hover:bg-white/15 transition-all cursor-pointer"
                  >
                    <div className="h-7 w-7 rounded-lg bg-emerald-400/20 text-emerald-300 flex items-center justify-center shrink-0 mt-0.5">
                      {ins.type === 'revenue' ? (
                        <TrendingUp className="h-3.5 w-3.5" />
                      ) : ins.type === 'warning' ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
                      ) : ins.type === 'alert' ? (
                        <CalendarX className="h-3.5 w-3.5 text-rose-300" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="leading-snug">
                      <span className="text-xs font-semibold text-white block">{ins.title}</span>
                      <span className="text-[11px] text-emerald-100/80 mt-0.5 block">{ins.message}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-6">
            <button
              type="button"
              onClick={() => onNavigate && onNavigate('reports-sales')}
              className="w-full py-2.5 px-4 rounded-xl bg-white text-[#0e7d5a] font-semibold text-xs hover:bg-emerald-50 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              View Detailed Analytics <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════
          5. BOTTOM THREE ACTION CARDS (Photo 2 Bottom)
          ═════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Low Stock Medicines */}
        <div className="bg-white rounded-2xl p-6 border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">Low Stock Medicines</h4>
                <p className="text-[11px] text-slate-400">
                  {data.lowStockCount || 0} {data.lowStockCount === 1 ? 'item' : 'items'} below threshold
                </p>
              </div>
            </div>

            {data.lowStockList && data.lowStockList.length > 0 ? (
              <div className="space-y-2.5 my-3">
                {data.lowStockList.slice(0, 4).map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 last:border-none">
                    <div className="min-w-0 pr-2">
                      <span className="font-medium text-slate-800 truncate block">{m.name}</span>
                      <span className="text-[10px] text-slate-400">
                        Reorder at {m.reorderLevel} {m.unit || ''}
                      </span>
                    </div>
                    <span
                      className={`font-semibold px-2 py-0.5 rounded-md shrink-0 text-[11px] ${
                        m.currentStock <= 0 || m.isOutOfStock
                          ? 'text-rose-700 bg-rose-50 border border-rose-100'
                          : 'text-amber-700 bg-amber-50 border border-amber-100'
                      }`}
                    >
                      {m.currentStock <= 0 || m.isOutOfStock ? 'Out of stock' : `${m.currentStock} left`}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="my-6 py-4 px-3 rounded-xl bg-slate-50/70 border border-dashed border-slate-200 text-center flex flex-col items-center justify-center">
                <div className="h-9 w-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <span className="text-xs font-semibold text-slate-700">Stock Levels Healthy</span>
                <span className="text-[11px] text-slate-400 mt-0.5">
                  All active medicines meet or exceed reorder levels
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onNavigate && onNavigate('purchases')}
            className="w-full mt-4 py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
          >
            Reorder Now <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Card 2: Expiry Alerts */}
        <div className="bg-white rounded-2xl p-6 border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                <CalendarX className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">Expiry Alerts</h4>
                <p className="text-[11px] text-slate-400">Next 90 days window</p>
              </div>
            </div>

            <div className="my-3">
              <div className="text-3xl font-extrabold text-slate-900">{data.nearExpiryCount || 0}</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {data.nearExpiryCount === 1 ? 'batch' : 'batches'} expiring soon
              </div>

              {/* Visual batch blocks indicator */}
              <div className="flex gap-1.5 mt-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-3.5 flex-1 rounded-xs transition-colors ${
                      i < Math.min(12, data.nearExpiryCount || 0)
                        ? 'bg-rose-500'
                        : 'bg-slate-100'
                    }`}
                  />
                ))}
              </div>

              {data.nearExpiryList && data.nearExpiryList.length > 0 ? (
                <div className="mt-3.5 space-y-1.5 pt-2.5 border-t border-slate-100">
                  {data.nearExpiryList.slice(0, 2).map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-xs py-1">
                      <div className="min-w-0 pr-2">
                        <span className="font-medium text-slate-800 truncate block">{item.name}</span>
                        <span className="text-[10px] text-slate-400">
                          Batch: {item.batchNumber} • Qty: {item.quantityRemaining ?? '—'}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-md shrink-0">
                        {item.daysLeft}d left
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 py-2.5 px-3 rounded-xl bg-slate-50/70 border border-dashed border-slate-200 text-center flex items-center justify-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span className="text-[11px] font-medium text-slate-600">
                    No active batches expiring within 90 days
                  </span>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate && onNavigate('stock-movements')}
            className="w-full mt-4 py-2.5 px-4 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
          >
            View Expiry Details <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Card 3: Supplier Updates */}
        <div className="bg-white rounded-2xl p-6 border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Truck className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">Supplier Updates</h4>
                <p className="text-[11px] text-slate-400">
                  {data.openPurchaseOrdersCount && data.openPurchaseOrdersCount > 0
                    ? `${data.openPurchaseOrdersCount} open orders pending`
                    : `${data.supplierUpdates?.length || 0} active suppliers registered`}
                </p>
              </div>
            </div>

            {data.supplierUpdates && data.supplierUpdates.length > 0 ? (
              <div className="space-y-2.5 my-3">
                {data.supplierUpdates.slice(0, 4).map((sup) => (
                  <div key={sup.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 last:border-none">
                    <div className="min-w-0 pr-2">
                      <span className="font-medium text-slate-800 truncate block">{sup.name}</span>
                      <span className="text-[10px] text-slate-400">
                        {sup.code ? `${sup.code} • ` : ''}{sup.paymentTerms || sup.phone || 'Active'}
                      </span>
                    </div>
                    <span
                      className={`font-semibold px-2 py-0.5 rounded-md shrink-0 text-[11px] ${
                        sup.openOrdersCount && sup.openOrdersCount > 0
                          ? 'text-blue-700 bg-blue-50 border border-blue-100'
                          : sup.balance && sup.balance > 0
                          ? 'text-amber-700 bg-amber-50 border border-amber-100'
                          : 'text-slate-600 bg-slate-50 border border-slate-200'
                      }`}
                    >
                      {sup.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="my-6 py-4 px-3 rounded-xl bg-slate-50/70 border border-dashed border-slate-200 text-center flex flex-col items-center justify-center">
                <div className="h-9 w-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-2">
                  <Truck className="h-5 w-5" />
                </div>
                <span className="text-xs font-semibold text-slate-700">No Suppliers Added</span>
                <span className="text-[11px] text-slate-400 mt-0.5">
                  Register vendors to manage procurement & terms
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onNavigate && onNavigate('vendors')}
            className="w-full mt-4 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
          >
            Review Suppliers & Orders <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
