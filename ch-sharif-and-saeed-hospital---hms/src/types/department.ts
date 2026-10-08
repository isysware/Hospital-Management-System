export type DepartmentType =
  | 'Clinical'
  | 'Surgical'
  | 'Diagnostic'
  | 'Emergency'
  | 'Pharmacy'
  | 'Administrative'
  | 'Support Service'
  | 'Other';

export type OperationalCapability =
  | 'OPD'
  | 'Observation'
  | 'Emergency'
  | 'Admission'
  | 'Pharmacy Related';

export interface HospitalFloor {
  id: string;
  floorNumber: number;
  name: string;
  building?: string | null;
  description?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Department {
  isDefaultPharmacy?: boolean;
  id: string;
  code: string;
  name: string;
  type: DepartmentType;
  description: string;

  headUserId: string; // e.g., 'DOC-001' or ''
  headName: string;   // e.g., 'Prof. Dr. Tariq Saeed' or 'Not Assigned'

  contactExtension?: string;
  location?: string;
  floor?: string;
  fixedPrice?: number | null; // Optional fixed rate / consultation fee (PKR), not per-day

  opdEnabled: boolean;
  observationEnabled: boolean;
  emergencyEnabled: boolean;
  admissionEnabled: boolean;
  pharmacyRelated: boolean;

  // v7.2 department billing config (HMS_V7.2_NEW_REQUIREMENTS.md §2.1) —
  // optional so pre-v7.2 mock/legacy fixtures don't need updating; absent = Internal.
  fulfillmentOwnership?: 'Internal' | 'Outsourced';
  outsourcedProviderId?: string;
  outsourcedProviderName?: string;

  doctorCount: number;
  staffCount: number;
  serviceCount: number;
  wardCount: number;

  status: 'Active' | 'Inactive';

  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  statusChangedBy: string;
  statusChangedAt: string;
}

export interface DepartmentHeadOption {
  userId: string;
  name: string;
  designation: string;
  department: string;
  role: 'Doctor' | 'Staff' | 'Admin';
}

export interface DepartmentFilterState {
  searchTerm: string;
  type: string; // 'All' | DepartmentType
  status: string; // 'All' | 'Active' | 'Inactive'
  capability: string; // 'All' | 'OPD' | 'Observation' | 'Emergency' | 'Admission' | 'Pharmacy Related' | 'None'
}

export interface DepartmentFormValues {
  code: string;
  name: string;
  type: DepartmentType;
  description: string;
  headUserId: string;
  headName: string;
  contactExtension?: string;
  location?: string;
  floor?: string;
  fixedPrice?: number | null;
  opdEnabled: boolean;
  observationEnabled: boolean;
  emergencyEnabled: boolean;
  admissionEnabled: boolean;
  pharmacyRelated: boolean;
  fulfillmentOwnership: 'Internal' | 'Outsourced';
  outsourcedProviderId: string;
  status: 'Active' | 'Inactive';
}

export interface DepartmentImportRow {
  department_code: string;
  department_name: string;
  department_type: string;
  description?: string;
  head_identifier?: string;
  contact_extension?: string;
  location?: string;
  opd_enabled?: string | boolean;
  observation_enabled?: string | boolean;
  emergency_enabled?: string | boolean;
  admission_enabled?: string | boolean;
  pharmacy_related?: string | boolean;
  status?: string;
}

export interface DepartmentImportValidationResult {
  rowNumber: number;
  data: DepartmentImportRow;
  status: 'Valid' | 'Invalid' | 'Duplicate';
  errorMessage?: string;
  convertedDepartment?: Department;
}
