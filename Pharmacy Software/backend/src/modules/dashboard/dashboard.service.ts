import { financialReport, loadFinancialData } from '../reports/financialRecognition';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { cashService } from '../cash/cash.service';

async function getNearExpiryWindowDays() {
  const settings = await prisma.pharmacySettings.findFirst();
  return settings?.nearExpiryWindowDays ?? 90;
}

function startOfDay(d = new Date()) {
  return new Date(new Date(d.getTime() + 5 * 3600000).toISOString().slice(0,10) + 'T00:00:00+05:00');
}

/** pharmacy.md §5 — every KPI here is a real Prisma query. No hardcoded numbers. */
export const dashboardService = {
  async getManagementSummary(userId: string) {
    const today = startOfDay();
    const tomorrow = new Date(today.getTime() + 86_400_000);

    const financialData = await loadFinancialData();
    const todayFinancial = financialReport(financialData,{gte:today,lte:new Date(tomorrow.getTime()-1)}).totals;
    const lifetimeFinancial = financialReport(financialData,{lte:new Date()}).totals;

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const [
      salesToday,
      purchasesToday,
      medicines,
      vendorLedger,
      pendingSettlements,
      pendingHmsRequests,
      expected,
      nearExpiryWindowDays,
      totalSalesAllTime,
      recentInvoices,
      recentPurchases,
      vendorsList,
      openPurchaseOrdersCount,
    ] = await Promise.all([
      prisma.pharmacyInvoice.aggregate({ where: { createdAt: { gte: today, lt: tomorrow } }, _sum: { total: true }, _count: true }),
      prisma.purchase.aggregate({ where: { createdAt: { gte: today, lt: tomorrow } }, _sum: { total: true }, _count: true }),
      prisma.medicineMaster.findMany({
        where: { isActive: true },
        include: {
          batches: {
            include: { stockEntries: { select: { quantityDelta: true } } },
          },
          stockEntries: { select: { quantityDelta: true } },
          baseUnit: { select: { name: true, shortCode: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.vendorLedgerEntry.aggregate({ _sum: { amount: true } }),
      prisma.accountSettlement.count({ where: { status: 'SUBMITTED' } }),
      prisma.medicineRequest.count({ where: { status: { in: ['REQUESTED', 'PARTIALLY_ACCEPTED'] } } }),
      cashService.expectedCash(userId),
      getNearExpiryWindowDays(),
      prisma.pharmacyInvoice.aggregate({ _sum: { total: true }, _count: true }),
      prisma.pharmacyInvoice.findMany({ where: { createdAt: { gte: sixMonthsAgo } }, select: { total: true, createdAt: true } }),
      prisma.purchase.findMany({ where: { createdAt: { gte: sixMonthsAgo } }, select: { total: true, createdAt: true } }),
      prisma.vendor.findMany({
        where: { isActive: true },
        take: 6,
        orderBy: { name: 'asc' },
        include: {
          purchaseOrders: {
            where: { status: 'OPEN' },
            select: { id: true, orderNumber: true, isUrgent: true },
          },
          ledgerEntries: {
            select: { amount: true },
          },
        },
      }),
      prisma.purchaseOrder.count({ where: { status: 'OPEN' } }),
    ]);

    const now = new Date();
    const nearExpiryCutoff = new Date(now.getTime() + nearExpiryWindowDays * 86_400_000);
    let stockValue = new Decimal(0);
    let totalStockUnits = new Decimal(0);
    let lowStock = 0;
    let outOfStock = 0;
    let nearExpiry = 0;
    let expired = 0;

    const categoryMap: Record<string, { count: number; stock: Decimal }> = {};
    const inventoryOverview: Array<{
      id: string;
      code: string;
      name: string;
      category: string;
      currentStock: number;
      reorderLevel: number;
      expiryDate: string | null;
      status: 'Healthy' | 'Low Stock' | 'Critical';
      batchNumber: string | null;
    }> = [];

    const lowStockList: Array<{
      id: string;
      name: string;
      currentStock: number;
      reorderLevel: number;
      unit: string;
      isOutOfStock: boolean;
    }> = [];
    const nearExpiryList: Array<{
      id: string;
      medicineId: string;
      name: string;
      batchNumber: string;
      expiryDate: string;
      daysLeft: number;
      quantityRemaining: number;
    }> = [];

    for (const m of medicines) {
      const stock = m.stockEntries.reduce((s, e) => s.plus(e.quantityDelta), new Decimal(0));
      totalStockUnits = totalStockUnits.plus(stock);
      stockValue = stockValue.plus(stock.mul(m.purchaseRate ?? m.saleRate));

      const catName = (m.categoryLabel && m.categoryLabel.trim()) || 'General';
      if (!categoryMap[catName]) {
        categoryMap[catName] = { count: 0, stock: new Decimal(0) };
      }
      categoryMap[catName].count += 1;
      categoryMap[catName].stock = categoryMap[catName].stock.plus(stock);

      const isOut = stock.lessThanOrEqualTo(0);
      const isLow = !isOut && stock.lessThanOrEqualTo(m.reorderLevel);
      const unitCode = m.baseUnit?.shortCode || m.baseUnit?.name || m.unit || 'units';

      if (isOut) {
        outOfStock += 1;
        lowStockList.push({
          id: m.id,
          name: m.name,
          currentStock: 0,
          reorderLevel: Number(m.reorderLevel),
          unit: unitCode,
          isOutOfStock: true,
        });
      } else if (isLow) {
        lowStock += 1;
        lowStockList.push({
          id: m.id,
          name: m.name,
          currentStock: stock.toNumber(),
          reorderLevel: Number(m.reorderLevel),
          unit: unitCode,
          isOutOfStock: false,
        });
      }

      // Sort batches by earliest expiry
      const sortedBatches = [...m.batches].sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
      const earliestBatch = sortedBatches[0];

      let hasExpired = false;
      let hasNearExpiry = false;

      for (const b of m.batches) {
        const batchStock = b.stockEntries.reduce((s, e) => s.plus(e.quantityDelta), new Decimal(0)).toNumber();
        if (batchStock <= 0) continue;

        if (b.expiryDate <= now) {
          expired += 1;
          hasExpired = true;
        } else if (b.expiryDate <= nearExpiryCutoff) {
          nearExpiry += 1;
          hasNearExpiry = true;
          nearExpiryList.push({
            id: b.id,
            medicineId: m.id,
            name: m.name,
            batchNumber: b.batchNumber,
            expiryDate: b.expiryDate.toISOString(),
            daysLeft: Math.max(0, Math.ceil((b.expiryDate.getTime() - now.getTime()) / 86_400_000)),
            quantityRemaining: batchStock,
          });
        }
      }

      const itemStatus: 'Healthy' | 'Low Stock' | 'Critical' = isOut || hasExpired ? 'Critical' : isLow || hasNearExpiry ? 'Low Stock' : 'Healthy';

      inventoryOverview.push({
        id: m.id,
        code: m.code,
        name: m.name,
        category: catName,
        currentStock: stock.toNumber(),
        reorderLevel: Number(m.reorderLevel),
        expiryDate: earliestBatch ? earliestBatch.expiryDate.toISOString() : null,
        status: itemStatus,
        batchNumber: earliestBatch ? earliestBatch.batchNumber : null,
      });
    }

    // Sort lowStockList: out of stock items first, then lowest remaining vs reorder
    lowStockList.sort((a, b) => {
      if (a.isOutOfStock && !b.isOutOfStock) return -1;
      if (!a.isOutOfStock && b.isOutOfStock) return 1;
      return (a.currentStock - a.reorderLevel) - (b.currentStock - b.reorderLevel);
    });

    // Sort nearExpiryList: expiring earliest first
    nearExpiryList.sort((a, b) => a.daysLeft - b.daysLeft);

    // Build monthly performance for last 6 months
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const mIdx = d.getMonth();
      const y = d.getFullYear();
      const mStart = new Date(Date.UTC(y, mIdx, 1));
      const mEnd = new Date(Date.UTC(y, mIdx + 1, 1));

      const mInvoices = recentInvoices.filter((inv) => inv.createdAt >= mStart && inv.createdAt < mEnd);
      const mPurchases = recentPurchases.filter((p) => p.createdAt >= mStart && p.createdAt < mEnd);
      const financial = financialReport(financialData,{gte:mStart,lte:new Date(Math.min(mEnd.getTime()-1,now.getTime()))}).totals;

      const rev = Number(financial.recognizedRevenue);
      const pur = mPurchases.reduce((s, p) => s.plus(p.total), new Decimal(0)).toNumber();
      const exp = Number(financial.operatingExpenses);
      const profit = financial.operatingProfit === null ? null : Number(financial.operatingProfit);

      monthlyTrend.push({
        month: `${monthNames[mIdx]} ${String(y).slice(-2)}`,
        revenue: rev,
        grossSales:Number(financial.grossSales), netBilling:Number(financial.netBilling), collections:Number(financial.collections), outstanding:Number(financial.outstanding), cogs:Number(financial.recognizedCogs),
        purchases: pur,
        expenses: exp,
        profit,
        orders: mInvoices.length,
      });
    }

    // Build rolling daily performance for the last 30 days (seamless across month boundaries)
    const dailyTrend = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const y = d.getFullYear();
      const m = d.getMonth();
      const dayNum = d.getDate();
      const dayStart = new Date(Date.UTC(y, m, dayNum, 0, 0, 0));
      const dayEnd = new Date(Date.UTC(y, m, dayNum + 1, 0, 0, 0));

      const dInvoices = recentInvoices.filter((inv) => inv.createdAt >= dayStart && inv.createdAt < dayEnd);
      const dPurchases = recentPurchases.filter((p) => p.createdAt >= dayStart && p.createdAt < dayEnd);
      const financial = financialReport(financialData,{gte:dayStart,lte:new Date(Math.min(dayEnd.getTime()-1,now.getTime()))}).totals;

      const rev = Number(financial.recognizedRevenue);
      const pur = dPurchases.reduce((s, p) => s.plus(p.total), new Decimal(0)).toNumber();
      const exp = Number(financial.operatingExpenses);
      const profit = financial.operatingProfit === null ? null : Number(financial.operatingProfit);

      dailyTrend.push({
        date: i === 0 ? 'Today' : `${dayNum} ${monthNames[m]}`,
        fullDate: d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
        revenue: rev,
        grossSales:Number(financial.grossSales), netBilling:Number(financial.netBilling), collections:Number(financial.collections), outstanding:Number(financial.outstanding), cogs:Number(financial.recognizedCogs),
        purchases: pur,
        expenses: exp,
        profit,
        orders: dInvoices.length,
      });
    }

    // Category distribution array
    const totalStockNum = Math.max(1, totalStockUnits.toNumber());
    const categoryDistribution = Object.entries(categoryMap).map(([category, info]) => {
      const stockNum = Math.max(0, info.stock.toNumber());
      return {
        category,
        count: info.count,
        stock: stockNum,
        percentage: Math.round((stockNum / totalStockNum) * 100),
      };
    }).sort((a, b) => b.stock - a.stock);

    // Smart Insights derived strictly from real DB facts
    const smartInsights = [
      {
        id: 'ins-1',
        title: 'Sales & Transactions',
        message: `${salesToday._count} transactions processed today with ${salesToday._sum.total ? salesToday._sum.total.toFixed(0) : '0'} billed (not recognized revenue).`,
        type: 'revenue',
      },
      {
        id: 'ins-2',
        title: 'Inventory Reorder Status',
        message: (lowStock + outOfStock) > 0 ? `${lowStock + outOfStock} medicines are below reorder threshold or out of stock.` : 'All active catalog items meet or exceed reorder thresholds.',
        type: (lowStock + outOfStock) > 0 ? 'warning' : 'healthy',
      },
      {
        id: 'ins-3',
        title: 'Expiry & FEFO Watch',
        message: nearExpiry > 0 ? `${nearExpiry} batches expire within ${nearExpiryWindowDays} days. Prioritize FEFO dispensing.` : 'No immediate batch expirations in the upcoming 90-day window.',
        type: nearExpiry > 0 ? 'alert' : 'healthy',
      },
      {
        id: 'ins-4',
        title: 'Hospital Request Queue',
        message: pendingHmsRequests > 0 ? `${pendingHmsRequests} medicine requests from hospital wards awaiting approval/fulfillment.` : 'Hospital request queue is clear. No pending requests.',
        type: pendingHmsRequests > 0 ? 'info' : 'healthy',
      },
    ];

    const supplierUpdates = vendorsList.map((v) => {
      const balance = v.ledgerEntries.reduce((s, e) => s.plus(e.amount), new Decimal(0)).toNumber();
      const openOrdersCount = v.purchaseOrders.length;
      const termsLabel = v.paymentTermsDays === 0 ? 'Immediate / COD' : `Net ${v.paymentTermsDays} Days`;
      let statusText = termsLabel;
      if (openOrdersCount > 0) {
        statusText = `${openOrdersCount} Open PO`;
      } else if (balance > 0) {
        statusText = `PKR ${balance.toLocaleString()} payable`;
      }

      return {
        id: v.id,
        name: v.name,
        code: v.code,
        status: statusText,
        phone: v.phone || 'Verified vendor',
        paymentTerms: termsLabel,
        openOrdersCount,
        balance,
      };
    });

    return {
      salesToday: todayFinancial.total,
      salesCountToday: salesToday._count,
      purchasesToday: purchasesToday._sum.total ?? new Decimal(0),
      purchasesCountToday: purchasesToday._count,
      totalRevenueAllTime: lifetimeFinancial.recognizedRevenue,
      recognizedRevenueToday: todayFinancial.recognizedRevenue,
      collectionsToday: todayFinancial.collections,
      outstanding: todayFinancial.outstanding,
      operatingProfitToday: todayFinancial.operatingProfit,
      incompleteInvoices: lifetimeFinancial.incompleteInvoices,
      totalSalesCountAllTime: totalSalesAllTime._count,
      totalMedicines: medicines.length,
      totalStockUnits: totalStockUnits.toNumber(),
      currentStockValue: stockValue,
      lowStockCount: lowStock + outOfStock,
      outOfStockCount: outOfStock,
      nearExpiryCount: nearExpiry,
      expiredCount: expired,
      vendorPayable: vendorLedger._sum.amount ?? new Decimal(0),
      pendingSettlements,
      pendingHmsRequests,
      expectedCash: expected,
      monthlyTrend,
      dailyTrend,
      categoryDistribution,
      inventoryOverview: inventoryOverview.slice(0, 10),
      lowStockList: lowStockList.slice(0, 6),
      nearExpiryList: nearExpiryList.slice(0, 6),
      supplierUpdates,
      openPurchaseOrdersCount,
      smartInsights,
    };
  },

  async getSalesSummary(userId: string) {
    const today = startOfDay();
    const tomorrow = new Date(today.getTime() + 86_400_000);

    const [mySales, pendingHmsRequests, expected] = await Promise.all([
      prisma.pharmacyInvoice.aggregate({ where: { dispensedById: userId, createdAt: { gte: today, lt: tomorrow } }, _sum: { total: true, paidTotal: true }, _count: true }),
      prisma.medicineRequest.count({ where: { status: { in: ['REQUESTED', 'PARTIALLY_ACCEPTED'] } } }),
      cashService.expectedCash(userId),
    ]);

    const data=await loadFinancialData();
    const retailData={...data,invoices:data.invoices.filter(i=>i.channel==='RETAIL')};
    const period={gte:today,lte:new Date(tomorrow.getTime()-1)};
    const cash=financialReport(retailData,period,{cashierId:userId,method:'CASH'}).totals.collections;
    const nonCash=financialReport(retailData,period,{cashierId:userId}).totals.collections.minus(cash);

    return {
      mySalesToday: mySales._sum.total ?? new Decimal(0),
      mySalesCountToday: mySales._count,
      cashCollectionToday: cash,
      cardOnlineCollectionToday: nonCash,
      pendingHmsRequests,
      expectedCash: expected,
    };
  },
};
