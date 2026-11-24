import apiClient from './apiClient';

/**
 * Front Desk / Billing Reports — backed by `GET /reports/frontdesk-billing`,
 * a real aggregation over the existing billing cash ledger and invoices
 * (HMS_V7.2_NEW_REQUIREMENTS.md §3.3). Same date-preset shape as the Super
 * Admin dashboard (`dashboardService.ts`) for a consistent filter bar.
 */

export type DatePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom';

export interface CategoryBillingSummary {
  category: string;
  invoiceCount: number;
  gross: number;
  discounts: number;
  net: number;
  paid: number;
  outstanding: number;
}

export interface FrontDeskBillingReport {
  period: { label: string; start: string; end: string };
  collections: {
    /** Net receipts after refunds, both overall and per payment method. */
    total: number;
    byMethod: Record<'CASH' | 'CARD' | 'BANK' | 'ONLINE', number>;
  };
  refunds: { total: number };
  billing: {
    invoiceCount: number;
    invoiceCountsByStatus: Record<string, number>;
    totalGross: number;
    totalDiscounts: number;
    totalNet: number;
    totalOutstanding: number;
    byCategory?: Record<string, CategoryBillingSummary>;
  };
}

function toNumber(v: any): number {
  return Number(v ?? 0);
}

function normalize(raw: Record<string, any>): FrontDeskBillingReport {
  return {
    period: raw.period,
    collections: {
      total: toNumber(raw.collections?.total),
      byMethod: {
        CASH: toNumber(raw.collections?.byMethod?.CASH),
        CARD: toNumber(raw.collections?.byMethod?.CARD),
        BANK: toNumber(raw.collections?.byMethod?.BANK),
        ONLINE: toNumber(raw.collections?.byMethod?.ONLINE),
      },
    },
    refunds: { total: toNumber(raw.refunds?.total) },
    billing: {
      invoiceCount: raw.billing?.invoiceCount ?? 0,
      invoiceCountsByStatus: raw.billing?.invoiceCountsByStatus ?? {},
      totalGross: toNumber(raw.billing?.totalGross),
      totalDiscounts: toNumber(raw.billing?.totalDiscounts),
      totalNet: toNumber(raw.billing?.totalNet),
      totalOutstanding: toNumber(raw.billing?.totalOutstanding),
      byCategory: raw.billing?.byCategory
        ? Object.fromEntries(
            Object.entries(raw.billing.byCategory).map(([k, v]: [string, any]) => [
              k,
              {
                category: v.category,
                invoiceCount: toNumber(v.invoiceCount),
                gross: toNumber(v.gross),
                discounts: toNumber(v.discounts),
                net: toNumber(v.net),
                paid: toNumber(v.paid),
                outstanding: toNumber(v.outstanding),
              },
            ]),
          )
        : undefined,
    },
  };
}

export async function fetchFrontDeskBillingReport(params: {
  preset: DatePreset;
  fromDate?: string;
  toDate?: string;
  cashierId?: string;
  departmentId?: string;
}): Promise<FrontDeskBillingReport> {
  const res = await apiClient.get<{ data: Record<string, any> }>('/reports/frontdesk-billing', { params });
  return normalize(res.data.data);
}
