export type ServiceCategory =
  | 'Consultation'
  | 'Emergency'
  | 'Observation'
  | 'Admission'
  | 'Room / Bed'
  | 'Procedure'
  | 'Surgery'
  | 'Diagnostic'
  | 'Laboratory'
  | 'Radiology'
  | 'Nursing'
  | 'Miscellaneous'
  | 'Other';

export type BillingUnit =
  | 'Per Visit'
  | 'Per Consultation'
  | 'Per Procedure'
  | 'Per Test'
  | 'Per Day'
  | 'Per Hour'
  | 'Per Session'
  | 'Per Unit'
  | 'One-Time'
  | 'Other';

export type ServiceStatus = 'Active' | 'Inactive';

export type ProviderType = 'INTERNAL' | 'OUTSOURCED';
export interface HospitalService {
  providerType?: ProviderType;
  billingSource?: string;
  selectable?: boolean;
  outsourcedProviderId?: string;

  id: string;
  code: string;
  name: string;
  description?: string;

  departmentId: string | null;
  departmentName: string;

  category: ServiceCategory;

  standardRate: number;
  currency: string;

  billingUnit: BillingUnit;
  panelEligible: boolean;

  manualRateOverrideAllowed: boolean;
  discountAllowed: boolean;

  status: ServiceStatus;

  // Encounter Type Mapping (V7.2)
  encounterType?: 'NONE' | 'OPD' | 'OBSERVATION' | 'EMERGENCY';
  isDefaultEncounterService?: boolean;

  // Stream Architecture (Hospital Services vs Laboratory & Diagnostics)
  serviceStream?: 'HOSPITAL' | 'LAB';

  // Mock linked usage counts for deletion safeguards
  linkedInvoiceCount?: number;
  linkedPanelRuleCount?: number;

  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;

  statusChangedBy?: string;
  statusChangedAt?: string;
}

export interface ServiceFilterState {
  providerType?: ProviderType;
  searchTerm: string;
  departmentId: string;
  category: string;
  panelEligible: string; // 'All' | 'Yes' | 'No'
  status: string; // 'All' | 'Active' | 'Inactive'
  serviceStream?: string; // 'All' | 'HOSPITAL' | 'LAB'
}

export interface ServiceFormValues {
  providerType?: ProviderType;
  code: string;
  name: string;
  description: string;
  departmentId: string;
  category?: ServiceCategory;
  standardRate: number;
  billingUnit: BillingUnit;
  panelEligible: boolean;
  manualRateOverrideAllowed: boolean;
  discountAllowed: boolean;
  status?: ServiceStatus;
  encounterType?: 'NONE' | 'OPD' | 'OBSERVATION' | 'EMERGENCY';
  isDefaultEncounterService?: boolean;
  serviceStream?: 'HOSPITAL' | 'LAB';
}

export interface ServiceImportRow {
  rowNumber: number;
  serviceCode: string;
  serviceName: string;
  departmentCode: string;
  category: string;
  description?: string;
  billingUnit: string;
  standardRate: number;
  panelEligible: boolean;
  discountAllowed: boolean;
  manualRateOverrideAllowed: boolean;
  status: ServiceStatus;
  isValid: boolean;
  errors: string[];
}

export interface ServiceImportValidationResult {
  totalRows: number;
  validRows: ServiceImportRow[];
  invalidRows: ServiceImportRow[];
}
