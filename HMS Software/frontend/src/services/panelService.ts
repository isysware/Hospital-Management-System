import apiClient from './apiClient';
import { formatDisplayDate } from '../utils/dateConstants';

/**
 * Live Corporate Panels service — backed by `/api/v1/setup/corporate-panels`.
 * Same in-memory-cache pattern as the other rewired services — never a
 * hardcoded demo list.
 */
export interface PanelDiscountRule {
  id: string;
  serviceRateId?: string | null;
  departmentId?: string | null;
  scope?: 'SERVICE' | 'DEPARTMENT' | 'GLOBAL';
  coverageType?: 'PERCENTAGE' | 'FIXED_PATIENT_SHARE' | 'FULL' | 'NOT_COVERED' | 'LEGACY_DISCOUNT';
  fixedPatientShare?: number;
  contractRate?: number;
  isActive?: boolean;
  notes?: string;
  serviceCode?: string;
  serviceName?: string;
  discountPercent: number;
  // v7.2 Panel Management enhancements (HMS_V7.2_NEW_REQUIREMENTS.md §2.5) —
  // additive/optional; `discountPercent` above stays the legacy simple
  // knock-off. `coveragePercent` is what the panel actually pays — the
  // complement is the patient's co-pay share.
  coveragePercent?: number;
  preauthorizationRequired?: boolean;
  capAmount?: number;
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface CorporatePanel {
  id: string;
  code: string;
  name: string;
  category: string;
  legalBillingName?: string;
  contactPhone?: string;
  contactEmail?: string;
  billingTerms?: string;
  memberIdLabel?: string;
  memberIdRequired?: boolean;
  membershipValidityRequired?: boolean;
  authorizationRequired?: boolean;
  discountAgreement: string;
  contact: string;
  address: string;
  notes: string;
  creditLimit: number;
  activePatientsCount: number;
  discountRules: PanelDiscountRule[];
  status: 'Active' | 'Inactive';
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

function formatTimestamp(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dateStr = formatDisplayDate(d);
  const timeStr = d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
}

function toCorporatePanel(raw: Record<string, any>): CorporatePanel {
  return {
    id: raw.id,
    code: raw.code || raw.id.slice(0, 8).toUpperCase(),
    name: raw.organizationName,
    category: raw.category || '',
    legalBillingName: raw.legalBillingName || '', contactPhone: raw.contactPhone || '',
    contactEmail: raw.contactEmail || '', billingTerms: raw.billingTerms || '',
    memberIdLabel: raw.memberIdLabel || '', memberIdRequired: raw.memberIdRequired ?? false,
    membershipValidityRequired: raw.membershipValidityRequired ?? false,
    authorizationRequired: raw.authorizationRequired ?? false,
    discountAgreement: raw.discountAgreement || '',
    contact: raw.contact || '',
    address: raw.address || '',
    notes: raw.notes || '',
    creditLimit: Number(raw.creditLimit ?? 0),
    activePatientsCount: raw.activePatientsCount ?? 0,
    discountRules: (raw.discountRules || []).map(toPanelRule),
    status: raw.isActive ? 'Active' : 'Inactive',
    createdBy: raw.createdByLabel || 'System',
    createdAt: formatTimestamp(raw.createdAt),
    updatedBy: raw.updatedByLabel || 'System',
    updatedAt: formatTimestamp(raw.updatedAt),
  };
}

let cachedPanels: CorporatePanel[] = [];

export async function fetchCorporatePanels(): Promise<CorporatePanel[]> {
  const res = await apiClient.get<{ data: Record<string, any>[] }>('/setup/corporate-panels');
  cachedPanels = res.data.data.map(toCorporatePanel);
  return cachedPanels;
}

export async function primeCorporatePanelsCache(): Promise<void> {
  try {
    await fetchCorporatePanels();
  } catch {
    // Leave cache empty; consuming pages surface the real error on their own fetch.
  }
}

export function getActiveCorporatePanels(): CorporatePanel[] {
  return cachedPanels.filter((p) => p.status === 'Active');
}

export function getAllCorporatePanels(): CorporatePanel[] {
  return cachedPanels;
}

export function getPanelById(id: string): CorporatePanel | undefined {
  return cachedPanels.find((p) => p.id === id);
}

export function getPanelByCode(code: string): CorporatePanel | undefined {
  const norm = code.trim().toUpperCase();
  return cachedPanels.find((p) => p.code.toUpperCase() === norm || p.id.toUpperCase() === norm);
}

export interface CorporatePanelFormValues {
  code: string;
  organizationName: string;
  category: string;
  legalBillingName?: string;
  contactPhone?: string;
  contactEmail?: string;
  billingTerms?: string;
  memberIdLabel?: string;
  memberIdRequired?: boolean;
  membershipValidityRequired?: boolean;
  authorizationRequired?: boolean;
  discountAgreement: string;
  contact: string;
  address: string;
  notes: string;
  creditLimit: number;
  isActive: boolean;
}

/** `POST /setup/corporate-panels` */
export async function createCorporatePanel(values: CorporatePanelFormValues): Promise<CorporatePanel> {
  const res = await apiClient.post<{ data: Record<string, any> }>('/setup/corporate-panels', {
    code: values.code.trim().toUpperCase() || undefined,
    organizationName: values.organizationName.trim(),
    category: values.category || undefined,
    legalBillingName: values.legalBillingName?.trim() || null,
    contactPhone: values.contactPhone?.trim() || null, contactEmail: values.contactEmail?.trim() || null,
    billingTerms: values.billingTerms?.trim() || null,
    memberIdLabel: values.memberIdLabel?.trim() || null,
    memberIdRequired: values.memberIdRequired ?? false,
    membershipValidityRequired: values.membershipValidityRequired ?? false,
    authorizationRequired: values.authorizationRequired ?? false,
    discountAgreement: values.discountAgreement?.trim() || undefined,
    contact: values.contact?.trim() || undefined,
    address: values.address?.trim() || undefined,
    notes: values.notes?.trim() || undefined,
    creditLimit: values.creditLimit,
    isActive: values.isActive,
  });
  const created = toCorporatePanel(res.data.data);
  cachedPanels = [created, ...cachedPanels];
  return created;
}

/** `PATCH /setup/corporate-panels/:id` */
export async function updateCorporatePanel(id: string, values: CorporatePanelFormValues): Promise<CorporatePanel> {
  const res = await apiClient.patch<{ data: Record<string, any> }>(`/setup/corporate-panels/${id}`, {
    code: values.code.trim().toUpperCase() || undefined,
    organizationName: values.organizationName.trim(),
    category: values.category || undefined,
    legalBillingName: values.legalBillingName?.trim() || null,
    contactPhone: values.contactPhone?.trim() || null, contactEmail: values.contactEmail?.trim() || null,
    billingTerms: values.billingTerms?.trim() || null,
    memberIdLabel: values.memberIdLabel?.trim() || null,
    memberIdRequired: values.memberIdRequired ?? false,
    membershipValidityRequired: values.membershipValidityRequired ?? false,
    authorizationRequired: values.authorizationRequired ?? false,
    discountAgreement: values.discountAgreement?.trim() || undefined,
    contact: values.contact?.trim() || undefined,
    address: values.address?.trim() || undefined,
    notes: values.notes?.trim() || undefined,
    creditLimit: values.creditLimit,
    isActive: values.isActive,
  });
  const updated = toCorporatePanel(res.data.data);
  cachedPanels = cachedPanels.map((p) => (p.id === id ? updated : p));
  return updated;
}

/** `PATCH /setup/corporate-panels/:id` (isActive toggle only) */
export async function toggleCorporatePanelStatus(id: string, isActive: boolean): Promise<CorporatePanel> {
  const res = await apiClient.patch<{ data: Record<string, any> }>(`/setup/corporate-panels/${id}`, { isActive });
  const updated = toCorporatePanel(res.data.data);
  cachedPanels = cachedPanels.map((p) => (p.id === id ? updated : p));
  return updated;
}

/** `PUT /setup/corporate-panels/:id/discount-rules` — replaces the full rule set for the panel. */
export async function replaceDiscountRules(
  id: string,
  rules: Omit<PanelDiscountRule, 'id'>[]
): Promise<PanelDiscountRule[]> {
  const res = await apiClient.put<{ data: Record<string, any>[] }>(`/setup/corporate-panels/${id}/discount-rules`, { rules });
  const discountRules = res.data.data.map(toPanelRule);
  cachedPanels = cachedPanels.map((p) => (p.id === id ? { ...p, discountRules } : p));
  return discountRules;
}

/** `DELETE /setup/corporate-panels/:id` */
export async function deleteCorporatePanel(id: string): Promise<void> {
  await apiClient.delete(`/setup/corporate-panels/${id}`);
  cachedPanels = cachedPanels.filter((p) => p.id !== id);
}

function toPanelRule(r: Record<string, any>): PanelDiscountRule {
  return { ...r, id: r.id, scope: r.scope ?? 'SERVICE', coverageType: r.coverageType ?? (r.coveragePercent != null ? 'PERCENTAGE' : 'LEGACY_DISCOUNT'),
    discountPercent: Number(r.discountPercent), coveragePercent: r.coveragePercent == null ? undefined : Number(r.coveragePercent),
    fixedPatientShare: r.fixedPatientShare == null ? undefined : Number(r.fixedPatientShare),
    contractRate: r.contractRate == null ? undefined : Number(r.contractRate), capAmount: r.capAmount == null ? undefined : Number(r.capAmount),
    effectiveFrom: String(r.effectiveFrom).slice(0,10), effectiveTo: r.effectiveTo ? String(r.effectiveTo).slice(0,10) : undefined,
    isActive: r.isActive !== false, notes: r.notes ?? '' };
}

export async function fetchPanelCategories(): Promise<{ name: string; isActive: boolean }[]> {
  const res = await apiClient.get('/setup/panel-categories');
  return res.data.data;
}

export async function createPanelCategory(name: string): Promise<{ name: string; isActive: boolean }> {
  const res = await apiClient.post('/setup/panel-categories', { name: name.trim() });
  return res.data.data;
}

export type PanelRuleHistory = PanelDiscountRule & { createdAt: string; archivedAt: string | null; createdByLabel: string; targetName: string };
export async function fetchPanelRuleHistory(id: string): Promise<PanelRuleHistory[]> {
  const res = await apiClient.get(`/setup/corporate-panels/${id}/rule-history`);
  return res.data.data.map((r: Record<string, any>) => ({ ...toPanelRule(r), createdAt: r.createdAt,
    archivedAt: r.archivedAt, createdByLabel: r.createdByLabel,
    targetName: r.serviceRate?.name ?? r.department?.name ?? 'All services',
  }));
}
