import apiClient from './apiClient';
import {
  Department,
  DepartmentFilterState,
  DepartmentFormValues,
  DepartmentHeadOption,
  DepartmentImportRow,
  DepartmentImportValidationResult,
  DepartmentType,
} from '../types/department';
import { User } from '../types';
import { formatDisplayDate } from '../utils/dateConstants';

/**
 * Live Departments service — every read/write round-trips through
 * `/api/v1/setup/departments*`. `cachedDepartments` is an in-memory-only
 * mirror of the last real fetch (never localStorage) so the many other
 * screens that need a synchronous department list for dropdowns (Services
 * & Rates, Wards/Rooms/Beds, Staff Users, Shift Management) keep working
 * without every one of them becoming async — call `primeDepartmentsCache()`
 * once per session (see `AuthContext`) to warm it.
 */

/**
 * Helper to build standard audit user string e.g. "Prof. Dr. Tariq Saeed (Super Admin)"
 * Kept for callers that still pass a `currentUser` — the backend now resolves
 * and returns the authoritative actor label itself, so this is only used as
 * a last-resort local fallback before a create/update response arrives.
 */
export const formatAuditUser = (user?: User | null): string => {
  if (!user) return 'System';
  return `${user.name} (${user.role})`;
};

export const formatAuditTimestamp = (): string => {
  const d = new Date();
  const dateStr = formatDisplayDate(d);
  const timeStr = d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
};

/**
 * OPD and Observation are care encounter services (managed under Services & Rates),
 * not departments. Departments are clinical, surgical, diagnostic, and administrative units.
 */
export function isProtectedCoreDepartment(_dept?: { code?: string | null; name?: string | null; isDefaultPharmacy?: boolean } | null): boolean {
  return _dept?.isDefaultPharmacy === true;
}

/** Valid department types list */
export const VALID_DEPARTMENT_TYPES: DepartmentType[] = [
  'Clinical',
  'Surgical',
  'Diagnostic',
  'Emergency',
  'Pharmacy',
  'Administrative',
  'Support Service',
  'Other',
];

const TYPE_TO_BACKEND: Record<DepartmentType, string> = {
  Clinical: 'CLINICAL',
  Surgical: 'SURGICAL',
  Diagnostic: 'DIAGNOSTIC',
  Emergency: 'EMERGENCY',
  Pharmacy: 'PHARMACY',
  Administrative: 'ADMINISTRATIVE',
  'Support Service': 'SUPPORT_SERVICE',
  Other: 'OTHER',
};
const TYPE_FROM_BACKEND: Record<string, DepartmentType> = Object.fromEntries(
  Object.entries(TYPE_TO_BACKEND).map(([fe, be]) => [be, fe as DepartmentType])
);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v?: string | null): v is string => !!v && UUID_REGEX.test(v);

function formatTimestamp(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dateStr = formatDisplayDate(d);
  const timeStr = d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
}

/** Maps a backend department row (as returned by `setup.service.ts`) onto the frontend `Department` shape. */
function toDepartment(raw: Record<string, any>): Department {
  return {
    id: raw.id,
    code: raw.code,
    name: raw.name,
    type: TYPE_FROM_BACKEND[raw.departmentType] || 'Other',
    description: raw.description || '',
    headUserId: raw.headStaffId || '',
    headName: raw.headName || 'Not Assigned',
    contactExtension: raw.contactExtension || '',
    location: raw.location || '',
    floor: raw.floor || raw.location || '',
    fixedPrice: raw.fixedPrice != null ? Number(raw.fixedPrice) : null,
    opdEnabled: !!raw.supportsOpd,
    observationEnabled: !!raw.supportsObservation,
    emergencyEnabled: !!raw.supportsEmergency,
    admissionEnabled: !!raw.supportsAdmission,
    pharmacyRelated: !!raw.pharmacyRelated,
    isDefaultPharmacy: !!raw.isDefaultPharmacy,
    fulfillmentOwnership: raw.fulfillmentOwnership === 'OUTSOURCED' ? 'Outsourced' : 'Internal',
    outsourcedProviderId: raw.outsourcedProviderId || '',
    outsourcedProviderName: raw.outsourcedProvider?.name || '',
    doctorCount: raw.doctorCount ?? 0,
    staffCount: raw.staffCount ?? 0,
    serviceCount: raw.serviceCount ?? 0,
    wardCount: raw.wardCount ?? 0,
    status: raw.isActive ? 'Active' : 'Inactive',
    createdBy: raw.createdByLabel || 'System',
    createdAt: formatTimestamp(raw.createdAt),
    updatedBy: raw.updatedByLabel || 'System',
    updatedAt: formatTimestamp(raw.updatedAt),
    statusChangedBy: raw.statusChangedBy || '',
    statusChangedAt: raw.statusChangedAt ? formatTimestamp(raw.statusChangedAt) : '',
  };
}

/**
 * Maps the frontend form shape onto the backend request body.
 * NOTE: `headUserId` is only forwarded when it is a real Staff UUID — the
 * "Head / In-charge" picker still sources its options from
 * `departmentMockData.ts`'s placeholder `DOC-xxx` ids until Staff Users
 * (Phase 2.8 of `SUPERADMIN_COMPLETION_PLAN.md`) is wired to real Staff
 * records, so a placeholder id is intentionally left unset rather than
 * sent to a foreign key that doesn't exist.
 */
function toBackendPayload(payload: DepartmentFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    // Left blank, the backend auto-generates a unique code.
    code: payload.code.trim() ? payload.code.trim().toUpperCase() : undefined,
    name: payload.name.trim(),
    description: payload.description?.trim() || undefined,
    departmentType: TYPE_TO_BACKEND[payload.type] || 'OTHER',
    contactExtension: payload.contactExtension?.trim() || undefined,
    location: payload.location?.trim() || payload.floor?.trim() || undefined,
    floor: payload.floor?.trim() || undefined,
    fixedPrice: payload.fixedPrice != null && !isNaN(Number(payload.fixedPrice)) ? Number(payload.fixedPrice) : null,
    supportsOpd: payload.opdEnabled,
    supportsObservation: payload.observationEnabled,
    supportsEmergency: payload.emergencyEnabled,
    supportsAdmission: payload.admissionEnabled,
    pharmacyRelated: payload.pharmacyRelated,
    fulfillmentOwnership: payload.fulfillmentOwnership === 'Outsourced' ? 'OUTSOURCED' : 'INTERNAL',
    outsourcedProviderId: payload.fulfillmentOwnership === 'Outsourced' && payload.outsourcedProviderId ? payload.outsourcedProviderId : null,
    isActive: payload.status === 'Active',
    headStaffId: isUuid(payload.headUserId) ? payload.headUserId : null,
  };
  return body;
}

let cachedDepartments: Department[] = [];

export async function fetchDepartments(): Promise<Department[]> {
  const res = await apiClient.get<{ data: Record<string, any>[] }>('/setup/departments');
  cachedDepartments = res.data.data.map(toDepartment);
  return cachedDepartments;
}

/** Async warm-up — call once at app startup (post-login) so sync readers below have real data. */
export async function primeDepartmentsCache(): Promise<void> {
  try {
    await fetchDepartments();
  } catch {
    // Leave cache empty; the Departments page itself will surface the real error on its own fetch.
  }
}

/**
 * Client service layer for Departments module — backed by the live API.
 */
export class DepartmentService {
  /**
   * Legacy entry point kept for existing call sites: returns the real,
   * backend-sourced cache rather than reading/seeding localStorage.
   */
  static loadDepartmentsFromStorage(_initialData: Department[]): Department[] {
    return cachedDepartments;
  }

  /** No-op: persistence now happens per-mutation against the real backend, never as a client-side snapshot. */
  static saveDepartmentsToStorage(_departments: Department[]): void {
    // Intentionally empty.
  }

  /**
   * Canonical helper to resolve a department reference (id, code, or exact
   * name) into a standardized { id, name, code }. With real UUID-backed
   * departments, an id/code/name lookup against the live list is always
   * sufficient — there is no longer a fixed 'DEP-01'..'DEP-12' id space to
   * guess at, so no fabricated fallback mapping is applied here.
   */
  static resolveCanonicalDepartment(
    rawId?: string | null,
    rawName?: string | null,
    departmentsList?: Department[]
  ): { id: string; name: string; code: string } {
    const departments = departmentsList && departmentsList.length > 0 ? departmentsList : cachedDepartments;

    const cleanId = (rawId || '').trim();
    const cleanName = (rawName || '').trim();

    if (cleanId) {
      const matchId = departments.find((d) => d.id.toLowerCase() === cleanId.toLowerCase());
      if (matchId) return { id: matchId.id, name: matchId.name, code: matchId.code };

      const matchCode = departments.find((d) => d.code.toLowerCase() === cleanId.toLowerCase());
      if (matchCode) return { id: matchCode.id, name: matchCode.name, code: matchCode.code };
    }

    const nameToMatch = cleanName || cleanId;
    if (nameToMatch) {
      const exact = departments.find((d) => d.name.toLowerCase() === nameToMatch.toLowerCase());
      if (exact) return { id: exact.id, name: exact.name, code: exact.code };
    }

    const firstActive = departments.find((d) => d.status === 'Active') || departments[0];
    return {
      id: cleanId || firstActive?.id || '',
      name: cleanName || firstActive?.name || 'Unassigned',
      code: firstActive?.code || '',
    };
  }

  /** Retrieve departments — accepts optional array (for local-state filtering) and filter parameters. */
  static getDepartments(allDepartments?: Department[], filters?: DepartmentFilterState): Department[] {
    const list = allDepartments && allDepartments.length > 0 ? allDepartments : cachedDepartments;

    if (!filters) return list;

    return list.filter((dept) => {
      if (filters.searchTerm?.trim()) {
        const query = filters.searchTerm.toLowerCase().trim();
        const matchCode = dept.code.toLowerCase().includes(query);
        const matchName = dept.name.toLowerCase().includes(query);
        const matchHead = dept.headName.toLowerCase().includes(query);
        if (!matchCode && !matchName && !matchHead) return false;
      }
      if (filters.type && filters.type !== 'All' && dept.type !== filters.type) return false;
      if (filters.status && filters.status !== 'All' && dept.status !== filters.status) return false;
      if (filters.capability && filters.capability !== 'All') {
        switch (filters.capability) {
          case 'OPD':
            if (!dept.opdEnabled) return false;
            break;
          case 'Observation':
            if (!dept.observationEnabled) return false;
            break;
          case 'Emergency':
            if (!dept.emergencyEnabled) return false;
            break;
          case 'Admission':
            if (!dept.admissionEnabled) return false;
            break;
          case 'Pharmacy Related':
            if (!dept.pharmacyRelated) return false;
            break;
          case 'None':
            if (dept.opdEnabled || dept.observationEnabled || dept.emergencyEnabled || dept.admissionEnabled || dept.pharmacyRelated) {
              return false;
            }
            break;
        }
      }
      return true;
    });
  }

  /** Retrieve department by ID — accepts (departments, id) or just (id). */
  static getDepartmentById(allDepartmentsOrId: Department[] | string, idOrUndefined?: string): Department | undefined {
    let list: Department[];
    let targetId: string;
    if (typeof allDepartmentsOrId === 'string') {
      targetId = allDepartmentsOrId;
      list = cachedDepartments;
    } else {
      list = allDepartmentsOrId;
      targetId = idOrUndefined || '';
    }
    return list.find((d) => d.id === targetId || d.code === targetId);
  }

  /** `POST /setup/departments` */
  static async createDepartment(payload: DepartmentFormValues, _currentUser?: User | null, _existing?: Department[]): Promise<Department> {
    const res = await apiClient.post<{ data: Record<string, any> }>('/setup/departments', toBackendPayload(payload));
    const created = toDepartment(res.data.data);
    cachedDepartments = [created, ...cachedDepartments];
    return created;
  }

  /** `PATCH /setup/departments/:id` */
  static async updateDepartment(id: string, payload: DepartmentFormValues, _currentUser?: User | null, _existing?: Department[]): Promise<Department> {
    const res = await apiClient.patch<{ data: Record<string, any> }>(`/setup/departments/${id}`, toBackendPayload(payload));
    const updated = toDepartment(res.data.data);
    cachedDepartments = cachedDepartments.map((d) => (d.id === id ? updated : d));
    return updated;
  }

  /** `PATCH /setup/departments/:id` (isActive:true) or `POST /setup/departments/:id/deactivate` */
  static async updateDepartmentStatus(id: string, newStatus: 'Active' | 'Inactive', _currentUser?: User | null, _existing?: Department[]): Promise<Department> {
    const res =
      newStatus === 'Inactive'
        ? await apiClient.post<{ data: Record<string, any> }>(`/setup/departments/${id}/deactivate`)
        : await apiClient.patch<{ data: Record<string, any> }>(`/setup/departments/${id}`, { isActive: true });
    const updated = toDepartment(res.data.data);
    cachedDepartments = cachedDepartments.map((d) => (d.id === id ? updated : d));
    return updated;
  }

  /** `DELETE /setup/departments/:id` */
  static async deleteDepartment(id: string, existingDepartments?: Department[]): Promise<void> {
    const dept = (existingDepartments || cachedDepartments).find((d) => d.id === id);
    if (dept && isProtectedCoreDepartment(dept)) {
      throw new Error(`Core hospital care department "${dept.name}" (${dept.code}) is protected by the hospital system and cannot be deleted.`);
    }
    await apiClient.delete(`/setup/departments/${id}`);
    cachedDepartments = cachedDepartments.filter((d) => d.id !== id);
  }

  /** Persists one already-validated import row against the real backend. */
  static async createDepartmentFromImportRow(draft: Department): Promise<Department> {
    return DepartmentService.createDepartment({
      code: draft.code,
      name: draft.name,
      type: draft.type,
      description: draft.description,
      headUserId: draft.headUserId,
      headName: draft.headName,
      contactExtension: draft.contactExtension,
      location: draft.location,
      opdEnabled: draft.opdEnabled,
      observationEnabled: draft.observationEnabled,
      emergencyEnabled: draft.emergencyEnabled,
      admissionEnabled: draft.admissionEnabled,
      pharmacyRelated: draft.pharmacyRelated,
      fulfillmentOwnership: draft.fulfillmentOwnership || 'Internal',
      outsourcedProviderId: draft.outsourcedProviderId || '',
      status: draft.status,
    });
  }

  /**
   * Future API endpoint: POST /departments/import
   * Validate uploaded Excel / CSV rows against schema and existing data
   */
  static validateImportRows(
    rows: DepartmentImportRow[],
    existingDepartments: Department[],
    headOptions: DepartmentHeadOption[]
  ): DepartmentImportValidationResult[] {
    const existingCodes = new Set(existingDepartments.map((d) => d.code.toUpperCase()));
    const seenFileCodes = new Set<string>();

    return rows.map((row, idx) => {
      const rowNumber = idx + 2; // Row 1 is header
      const rawCode = (row.department_code || '').trim().toUpperCase();
      const rawName = (row.department_name || '').trim();
      const rawType = (row.department_type || '').trim();
      const rawHead = (row.head_identifier || '').trim();
      const rawStatus = (row.status || 'Active').trim();

      // Code is optional — left blank, the backend auto-generates a unique one.
      if (rawCode) {
        const codeRegex = /^[A-Z0-9-]+$/;
        if (!codeRegex.test(rawCode)) {
          return {
            rowNumber,
            data: row,
            status: 'Invalid',
            errorMessage: 'Department Code must contain uppercase letters, numbers, and hyphens only',
          };
        }

        if (existingCodes.has(rawCode) || seenFileCodes.has(rawCode)) {
          return {
            rowNumber,
            data: row,
            status: 'Duplicate',
            errorMessage: `Duplicate code "${rawCode}" already registered in hospital system`,
          };
        }
        seenFileCodes.add(rawCode);
      }

      if (!rawName) {
        return { rowNumber, data: row, status: 'Invalid', errorMessage: 'Missing required Department Name' };
      }

      const matchedType = VALID_DEPARTMENT_TYPES.find((t) => t.toLowerCase() === rawType.toLowerCase());
      if (!matchedType) {
        return {
          rowNumber,
          data: row,
          status: 'Invalid',
          errorMessage: `Invalid Department Type "${rawType}". Allowed: ${VALID_DEPARTMENT_TYPES.join(', ')}`,
        };
      }

      const normalizedStatus = rawStatus.toLowerCase() === 'inactive' ? 'Inactive' : 'Active';

      let resolvedHeadUserId = '';
      let resolvedHeadName = 'Not Assigned';
      if (rawHead && rawHead.toLowerCase() !== 'not assigned' && rawHead !== '—') {
        const foundHead = headOptions.find(
          (h) => h.userId.toLowerCase() === rawHead.toLowerCase() || h.name.toLowerCase() === rawHead.toLowerCase()
        );
        if (!foundHead) {
          return { rowNumber, data: row, status: 'Invalid', errorMessage: `Unknown Head / In-charge identifier "${rawHead}"` };
        }
        resolvedHeadUserId = foundHead.userId;
        resolvedHeadName = foundHead.name;
      }

      const parseBool = (val: any): boolean => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
          const lower = val.trim().toLowerCase();
          return lower === 'true' || lower === '1' || lower === 'yes';
        }
        return false;
      };

      const convertedDept: Department = {
        id: `DEP-IMP-${Date.now().toString().slice(-4)}-${idx}`, // replaced with the real id once createDepartmentFromImportRow() persists it
        code: rawCode,
        name: rawName,
        type: matchedType,
        description: (row.description || '').trim(),
        headUserId: resolvedHeadUserId,
        headName: resolvedHeadName,
        contactExtension: (row.contact_extension || '').trim(),
        location: (row.location || '').trim(),
        opdEnabled: parseBool(row.opd_enabled),
        observationEnabled: parseBool(row.observation_enabled),
        emergencyEnabled: parseBool(row.emergency_enabled),
        admissionEnabled: parseBool(row.admission_enabled),
        pharmacyRelated: parseBool(row.pharmacy_related),
        doctorCount: 0,
        staffCount: 0,
        serviceCount: 0,
        wardCount: 0,
        status: normalizedStatus,
        createdBy: 'Excel Batch Import',
        createdAt: formatAuditTimestamp(),
        updatedBy: 'Excel Batch Import',
        updatedAt: formatAuditTimestamp(),
        statusChangedBy: 'Excel Batch Import',
        statusChangedAt: formatAuditTimestamp(),
      };

      return { rowNumber, data: row, status: 'Valid', convertedDepartment: convertedDept };
    });
  }

  /** Helper to trigger download of sample CSV template */
  static downloadTemplate(): void {
    const headers = [
      'department_code',
      'department_name',
      'department_type',
      'description',
      'head_identifier',
      'contact_extension',
      'location',
      'opd_enabled',
      'observation_enabled',
      'emergency_enabled',
      'admission_enabled',
      'pharmacy_related',
      'status',
    ].join(',');

    const sampleRow1 = [
      'DEP-ENT',
      'Otolaryngology (ENT)',
      'Surgical',
      'Ear Nose and Throat clinic and audiology',
      'DOC-008',
      'Ext. 314',
      'Third Floor Block B',
      'TRUE',
      'FALSE',
      'FALSE',
      'TRUE',
      'FALSE',
      'Active',
    ].join(',');

    const sampleRow2 = [
      'DEP-DERM',
      'Dermatology',
      'Clinical',
      'Skin disease outpatient care',
      'DOC-004',
      'Ext. 318',
      'Third Floor Block A',
      'TRUE',
      'FALSE',
      'FALSE',
      'FALSE',
      'FALSE',
      'Active',
    ].join(',');

    const csvContent = `${headers}\n${sampleRow1}\n${sampleRow2}\n`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'CHSS_Department_Import_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /** Export CSV utility respecting active filters */
  static exportToCSV(departments: Department[], filename = 'CHSS_Department_Directory.csv'): void {
    const headers = [
      'Department Code',
      'Department Name',
      'Department Type',
      'Head / In-charge',
      'Location / Floor',
      'Contact Extension',
      'OPD Enabled',
      'Observation Enabled',
      'Emergency Enabled',
      'Admission Enabled',
      'Pharmacy Related',
      'Doctors Count',
      'Staff Count',
      'Services Count',
      'Wards Count',
      'Status',
      'Updated By',
      'Updated Date',
    ].join(',');

    const rows = departments.map((d) => {
      const escape = (str: string) => `"${(str || '').replace(/"/g, '""')}"`;
      return [
        escape(d.code),
        escape(d.name),
        escape(d.type),
        escape(d.headName),
        escape(d.location),
        escape(d.contactExtension),
        d.opdEnabled ? 'YES' : 'NO',
        d.observationEnabled ? 'YES' : 'NO',
        d.emergencyEnabled ? 'YES' : 'NO',
        d.admissionEnabled ? 'YES' : 'NO',
        d.pharmacyRelated ? 'YES' : 'NO',
        d.doctorCount,
        d.staffCount,
        d.serviceCount,
        d.wardCount,
        escape(d.status),
        escape(d.updatedBy),
        escape(d.updatedAt),
      ].join(',');
    });

    const csvContent = `${headers}\n${rows.join('\n')}\n`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
