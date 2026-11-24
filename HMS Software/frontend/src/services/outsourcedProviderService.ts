import apiClient from './apiClient';
import { formatDisplayDate } from '../utils/dateConstants';

/**
 * Live Outsourced Providers service — backed by `/api/v1/setup/outsourced-providers`
 * (HMS_V7.2_NEW_REQUIREMENTS.md §2.1). Same in-memory-cache pattern as the
 * other Setup services — never localStorage.
 */

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'ONLINE';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  CHEQUE: 'Cheque',
  ONLINE: 'Online / Other',
};

export interface OutsourcedProvider {
  id: string;
  code: string;
  name: string;
  representativeName: string;
  representativeDesignation: string;
  phone: string;
  email: string;
  address: string;
  paymentTermsNotes: string;
  settlementCycle: string;
  allowedPaymentMethods: PaymentMethod[];
  bankName: string;
  bankAccountTitle: string;
  bankAccountNumber: string;
  chequePayeeName: string;
  withholdingTaxPercent: number | null;
  withholdingEffectiveFrom: string;
  isActive: boolean;
  linkedDepartmentCount: number;
  settlementCount: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface OutsourcedProviderFormValues {
  code: string;
  name: string;
  representativeName: string;
  representativeDesignation: string;
  phone: string;
  email: string;
  address: string;
  paymentTermsNotes: string;
  settlementCycle: string;
  allowedPaymentMethods: PaymentMethod[];
  bankName: string;
  bankAccountTitle: string;
  bankAccountNumber: string;
  chequePayeeName: string;
  withholdingTaxPercent: number | '';
  isActive: boolean;
}

function formatTimestamp(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dateStr = formatDisplayDate(d);
  const timeStr = d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
}

function toProvider(raw: Record<string, any>): OutsourcedProvider {
  return {
    id: raw.id,
    code: raw.code || '',
    name: raw.name,
    representativeName: raw.representativeName || '',
    representativeDesignation: raw.representativeDesignation || '',
    phone: raw.phone || '',
    email: raw.email || '',
    address: raw.address || '',
    paymentTermsNotes: raw.paymentTermsNotes || '',
    settlementCycle: raw.settlementCycle || '',
    allowedPaymentMethods: raw.allowedPaymentMethods || [],
    bankName: raw.bankName || '',
    bankAccountTitle: raw.bankAccountTitle || '',
    bankAccountNumber: raw.bankAccountNumber || '',
    chequePayeeName: raw.chequePayeeName || '',
    withholdingTaxPercent: raw.withholdingTaxPercent != null ? Number(raw.withholdingTaxPercent) : null,
    withholdingEffectiveFrom: raw.withholdingEffectiveFrom ? String(raw.withholdingEffectiveFrom).slice(0, 10) : '',
    isActive: !!raw.isActive,
    linkedDepartmentCount: raw.linkedDepartmentCount ?? 0,
    settlementCount: raw.settlementCount ?? 0,
    createdBy: raw.createdByLabel || 'System',
    createdAt: formatTimestamp(raw.createdAt),
    updatedBy: raw.updatedByLabel || 'System',
    updatedAt: formatTimestamp(raw.updatedAt),
  };
}

function toBackendPayload(values: OutsourcedProviderFormValues): Record<string, unknown> {
  return {
    code: values.code.trim() ? values.code.trim().toUpperCase() : undefined,
    name: values.name.trim(),
    representativeName: values.representativeName?.trim() || undefined,
    representativeDesignation: values.representativeDesignation?.trim() || undefined,
    phone: values.phone?.trim() || undefined,
    email: values.email?.trim() || undefined,
    address: values.address?.trim() || undefined,
    paymentTermsNotes: values.paymentTermsNotes?.trim() || undefined,
    settlementCycle: values.settlementCycle?.trim() || undefined,
    allowedPaymentMethods: values.allowedPaymentMethods,
    bankName: values.bankName?.trim() || undefined,
    bankAccountTitle: values.bankAccountTitle?.trim() || undefined,
    bankAccountNumber: values.bankAccountNumber?.trim() || undefined,
    chequePayeeName: values.chequePayeeName?.trim() || undefined,
    withholdingTaxPercent: values.withholdingTaxPercent === '' ? undefined : Number(values.withholdingTaxPercent),
    isActive: values.isActive,
  };
}

let cachedProviders: OutsourcedProvider[] = [];

export async function fetchOutsourcedProviders(): Promise<OutsourcedProvider[]> {
  const res = await apiClient.get<{ data: Record<string, any>[] }>('/setup/outsourced-providers');
  cachedProviders = res.data.data.map(toProvider);
  return cachedProviders;
}

export async function primeOutsourcedProvidersCache(): Promise<void> {
  try {
    await fetchOutsourcedProviders();
  } catch {
    // Leave cache empty; the Outsourced Providers page and Department form surface the real error on their own fetch.
  }
}

export function getActiveOutsourcedProviders(): OutsourcedProvider[] {
  return cachedProviders.filter((p) => p.isActive);
}

export function getCachedOutsourcedProviders(): OutsourcedProvider[] {
  return cachedProviders;
}

export const OutsourcedProviderService = {
  async createProvider(values: OutsourcedProviderFormValues): Promise<OutsourcedProvider> {
    const res = await apiClient.post<{ data: Record<string, any> }>('/setup/outsourced-providers', toBackendPayload(values));
    const created = toProvider(res.data.data);
    cachedProviders = [created, ...cachedProviders];
    return created;
  },

  async updateProvider(id: string, values: OutsourcedProviderFormValues): Promise<OutsourcedProvider> {
    const res = await apiClient.patch<{ data: Record<string, any> }>(`/setup/outsourced-providers/${id}`, toBackendPayload(values));
    const updated = toProvider(res.data.data);
    cachedProviders = cachedProviders.map((p) => (p.id === id ? updated : p));
    return updated;
  },

  async deactivateProvider(id: string): Promise<OutsourcedProvider> {
    const res = await apiClient.post<{ data: Record<string, any> }>(`/setup/outsourced-providers/${id}/deactivate`);
    const updated = toProvider(res.data.data);
    cachedProviders = cachedProviders.map((p) => (p.id === id ? updated : p));
    return updated;
  },

  async deleteProvider(id: string): Promise<void> {
    await apiClient.delete(`/setup/outsourced-providers/${id}`);
    cachedProviders = cachedProviders.filter((p) => p.id !== id);
  },
};
