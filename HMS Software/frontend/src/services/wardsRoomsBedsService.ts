import apiClient from './apiClient';
import {
  Ward,
  Room,
  Bed,
  WardType,
  RoomType,
  BedType,
  GenderPolicy,
  BedOccupancyStatus,
  BedOperationalStatus,
  WardFilterState,
  RoomFilterState,
  BedFilterState,
  WardFormValues,
  RoomFormValues,
  BedFormValues,
  WardImportRow,
  RoomImportRow,
  BedImportRow,
} from '../types/wardsRoomsBeds';
import { User } from '../types';
import { DepartmentService } from './departmentService';
import { formatDisplayDate } from '../utils/dateConstants';

/**
 * Live Wards/Rooms/Beds service — a single `GET /setup/wards-rooms-beds`
 * call returns the full Department→Ward→Room→Bed hierarchy (with computed
 * counts and resolved actor labels from `setup.service.ts`), which is then
 * flattened here into the three separate cached arrays the existing
 * flat-list UI (`Ward[]`, `Room[]`, `Bed[]`) expects. Same in-memory-cache
 * pattern as Departments/Services — never localStorage.
 */

export const VALID_WARD_TYPES: WardType[] = ['General', 'Private', 'Semi-Private', 'Other'];

export const VALID_GENDER_POLICIES: GenderPolicy[] = ['Male', 'Female', 'Mixed', 'Pediatric', 'Not Applicable'];

export const VALID_ROOM_TYPES: RoomType[] = ['General', 'Private', 'Semi-Private'];

export const VALID_BED_TYPES: BedType[] = [
  'Standard',
  'Private',
  'Semi-Private',
  'ICU',
  'NICU',
  'PICU',
  'Pediatric',
  'Isolation',
  'Emergency',
  'Other',
];

const OCCUPANCY_FROM_BACKEND: Record<string, BedOccupancyStatus> = {
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  OCCUPIED: 'Occupied',
  OUT_OF_SERVICE: 'Maintenance',
};
const OCCUPANCY_TO_BACKEND: Record<BedOccupancyStatus, string> = {
  Available: 'AVAILABLE',
  Reserved: 'RESERVED',
  Occupied: 'OCCUPIED',
  Maintenance: 'OUT_OF_SERVICE',
};
const OPERATIONAL_FROM_BACKEND: Record<string, BedOperationalStatus> = {
  ACTIVE: 'Active',
  CLEANING: 'Cleaning',
  MAINTENANCE: 'Maintenance',
  OUT_OF_SERVICE: 'Out of Service',
  DECOMMISSIONED: 'Decommissioned',
};
const OPERATIONAL_TO_BACKEND: Record<BedOperationalStatus, string> = {
  Active: 'ACTIVE',
  Cleaning: 'CLEANING',
  Maintenance: 'MAINTENANCE',
  'Out of Service': 'OUT_OF_SERVICE',
  Decommissioned: 'DECOMMISSIONED',
};

export function getNextBedNumbers(existingBeds: Bed[], count: number, prefix: string = 'Bed '): string[] {
  let maxNum = 0;
  for (const b of existingBeds) {
    const match = b.bedNumber.match(/(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  const existingSet = new Set(existingBeds.map((b) => b.bedNumber.trim().toLowerCase()));
  const results: string[] = [];
  let candidate = maxNum + 1;
  while (results.length < count) {
    const name = `${prefix}${candidate}`;
    if (!existingSet.has(name.toLowerCase())) {
      results.push(name);
      existingSet.add(name.toLowerCase());
    }
    candidate++;
  }
  return results;
}

function formatTimestamp(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dateStr = formatDisplayDate(d);
  const timeStr = d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
}

function toWard(raw: Record<string, any>): Ward {
  return {
    id: raw.id,
    code: raw.code || '',
    name: raw.name,
    departmentId: raw.departmentId,
    departmentName: raw.department?.name || '',
    wardType: (raw.wardType as WardType) || 'Other',
    genderPolicy: (raw.genderPolicy as GenderPolicy) || undefined,
    floor: raw.floor || undefined,
    location: raw.location || undefined,
    description: raw.description || undefined,
    headStaffId: raw.headStaffId || undefined,
    headStaffName: raw.headStaffName || raw.headStaff?.fullName || undefined,
    fixedPrice: raw.fixedPrice != null ? Number(raw.fixedPrice) : null,
    roomCount: raw.roomCount ?? 0,
    bedCount: raw.bedCount ?? 0,
    availableBeds: raw.availableBeds ?? 0,
    status: raw.isActive ? 'Active' : 'Inactive',
    historicalAdmissionCount: 0,
    createdBy: raw.createdByLabel || 'System',
    createdAt: formatTimestamp(raw.createdAt),
    updatedBy: raw.updatedByLabel || 'System',
    updatedAt: formatTimestamp(raw.updatedAt),
    statusChangedBy: raw.statusChangedBy || undefined,
    statusChangedAt: raw.statusChangedAt ? formatTimestamp(raw.statusChangedAt) : undefined,
  };
}

/** `ward` is omitted for a standalone Room (Room -> Bed structure, no parent Ward). */
function toRoom(
  raw: Record<string, any>,
  ward?: { id: string; name: string; departmentId: string; departmentName: string }
): Room {
  return {
    id: raw.id,
    code: raw.code || '',
    roomNumber: raw.roomNumber || '',
    name: raw.name,
    wardId: ward?.id || raw.wardId || '',
    wardName: ward?.name || '',
    departmentId: ward?.departmentId || '',
    departmentName: ward?.departmentName || '',
    roomType: (raw.roomType as RoomType) || 'General',
    floor: raw.floor || undefined,
    capacity: raw.capacity ?? 0,
    bedsConfigured: raw.bedsConfigured ?? 0,
    dailyRoomRate: Number(raw.dailyRoomRate ?? 0),
    status: raw.isActive ? 'Active' : 'Inactive',
    admissionLinkageCount: 0,
    createdBy: raw.createdByLabel || 'System',
    createdAt: formatTimestamp(raw.createdAt),
    updatedBy: raw.updatedByLabel || 'System',
    updatedAt: formatTimestamp(raw.updatedAt),
    statusChangedBy: raw.statusChangedBy || undefined,
    statusChangedAt: raw.statusChangedAt ? formatTimestamp(raw.statusChangedAt) : undefined,
  };
}

/**
 * `room` is omitted for a direct Ward -> Bed (no Room in between); `ward` is
 * omitted for a standalone Room -> Bed (no parent Ward). At least one of the
 * two is always given — a Bed with neither is never persisted (see
 * createBedSchema's refine on the backend).
 */
function toBed(
  raw: Record<string, any>,
  room?: { name: string; roomNumber: string },
  ward?: { id: string; name: string; departmentId: string; departmentName: string }
): Bed {
  return {
    id: raw.id,
    code: raw.code || '',
    bedNumber: raw.bedNumber,
    roomId: raw.roomId || '',
    roomNumber: room?.roomNumber || '',
    roomName: room?.name || '',
    wardId: ward?.id || raw.wardId || '',
    wardName: ward?.name || '',
    departmentId: ward?.departmentId || '',
    departmentName: ward?.departmentName || '',
    bedType: (raw.bedType as BedType) || 'Other',
    occupancyStatus: OCCUPANCY_FROM_BACKEND[raw.status] || 'Available',
    operationalStatus: OPERATIONAL_FROM_BACKEND[raw.operationalStatus] || 'Active',
    currentPatientId: raw.currentPatientId || undefined,
    currentPatientName: raw.currentPatientName || undefined,
    currentPatientMrn: raw.currentPatientMrn || undefined,
    admissionId: raw.admissionId || undefined,
    admissionDate: raw.admissionDate ? formatTimestamp(raw.admissionDate) : undefined,
    admittingDoctorName: raw.admittingDoctorName || undefined,
    historicalAdmissionCount: 0,
    createdBy: raw.createdByLabel || 'System',
    createdAt: formatTimestamp(raw.createdAt),
    updatedBy: raw.updatedByLabel || 'System',
    updatedAt: formatTimestamp(raw.updatedAt),
    statusChangedBy: raw.statusChangedBy || undefined,
    statusChangedAt: raw.statusChangedAt ? formatTimestamp(raw.statusChangedAt) : undefined,
  };
}

let cachedWards: Ward[] = [];
let cachedRooms: Room[] = [];
let cachedBeds: Bed[] = [];

/**
 * Backend returns `{ wards, standaloneRooms }` — three structures are
 * flattened here into the three flat arrays (`Ward[]`, `Room[]`, `Bed[]`)
 * the existing UI expects:
 *   - Ward -> Room -> Bed:  rawWard.rooms[].beds[]
 *   - Ward -> Bed (direct): rawWard.beds[]
 *   - Room -> Bed (standalone, no Ward): res.data.data.standaloneRooms[].beds[]
 */
export async function fetchWardHierarchy(): Promise<{ wards: Ward[]; rooms: Room[]; beds: Bed[] }> {
  const res = await apiClient.get<{ data: { wards: Record<string, any>[]; standaloneRooms: Record<string, any>[] } }>(
    '/setup/wards-rooms-beds'
  );
  const wards: Ward[] = [];
  const rooms: Room[] = [];
  const beds: Bed[] = [];

  for (const rawWard of res.data.data.wards || []) {
    const wardInfo = {
      id: rawWard.id,
      name: rawWard.name,
      departmentId: rawWard.departmentId,
      departmentName: rawWard.department?.name || '',
    };
    wards.push(toWard(rawWard));

    for (const rawRoom of rawWard.rooms || []) {
      rooms.push(toRoom(rawRoom, wardInfo));
      const roomInfo = { name: rawRoom.name, roomNumber: rawRoom.roomNumber || '' };
      for (const rawBed of rawRoom.beds || []) {
        beds.push(toBed(rawBed, roomInfo, wardInfo));
      }
    }

    // Direct Ward -> Bed (no Room in between)
    for (const rawBed of rawWard.beds || []) {
      beds.push(toBed(rawBed, undefined, wardInfo));
    }
  }

  // Standalone Room -> Bed (no parent Ward)
  for (const rawRoom of res.data.data.standaloneRooms || []) {
    rooms.push(toRoom(rawRoom));
    const roomInfo = { name: rawRoom.name, roomNumber: rawRoom.roomNumber || '' };
    for (const rawBed of rawRoom.beds || []) {
      beds.push(toBed(rawBed, roomInfo));
    }
  }

  cachedWards = wards;
  cachedRooms = rooms;
  cachedBeds = beds;
  return { wards, rooms, beds };
}

/** Async warm-up — call once at app startup so sync readers below have real data. */
export async function primeWardsRoomsBedsCache(): Promise<void> {
  try {
    await fetchWardHierarchy();
  } catch {
    // Leave cache empty; the Wards/Rooms/Beds page itself will surface the real error on its own fetch.
  }
}

export class WardsRoomsBedsService {
  static getWards(): Ward[] {
    return cachedWards;
  }
  static getRooms(): Room[] {
    return cachedRooms;
  }
  static getBeds(): Bed[] {
    return cachedBeds;
  }

  static getWardById(id: string): Ward | undefined {
    return cachedWards.find((w) => w.id === id);
  }
  static getRoomById(id: string): Room | undefined {
    return cachedRooms.find((r) => r.id === id);
  }
  static getBedById(id: string): Bed | undefined {
    return cachedBeds.find((b) => b.id === id);
  }

  static validateWardCode(code: string, currentId?: string): { isValid: boolean; message?: string } {
    const trimmed = code.trim().toUpperCase();
    // Optional — left blank, the backend auto-generates a unique code.
    if (!trimmed) return { isValid: true };
    if (!/^[A-Z0-9-]+$/.test(trimmed)) return { isValid: false, message: 'Code must be uppercase letters, numbers, and hyphens only.' };
    if (cachedWards.some((w) => w.code.toUpperCase() === trimmed && w.id !== currentId)) {
      return { isValid: false, message: `Ward code "${trimmed}" already exists.` };
    }
    return { isValid: true };
  }

  static validateRoomCode(code: string, currentId?: string): { isValid: boolean; message?: string } {
    const trimmed = code.trim().toUpperCase();
    // Optional — left blank, the backend auto-generates a unique code.
    if (!trimmed) return { isValid: true };
    if (!/^[A-Z0-9-]+$/.test(trimmed)) return { isValid: false, message: 'Code must be uppercase letters, numbers, and hyphens only.' };
    if (cachedRooms.some((r) => r.code.toUpperCase() === trimmed && r.id !== currentId)) {
      return { isValid: false, message: `Room code "${trimmed}" already exists.` };
    }
    return { isValid: true };
  }

  static validateBedCode(code: string, currentId?: string): { isValid: boolean; message?: string } {
    const trimmed = code.trim().toUpperCase();
    // Optional — left blank, the backend auto-generates a unique code.
    if (!trimmed) return { isValid: true };
    if (!/^[A-Z0-9-]+$/.test(trimmed)) return { isValid: false, message: 'Code must be uppercase letters, numbers, and hyphens only.' };
    if (cachedBeds.some((b) => b.code.toUpperCase() === trimmed && b.id !== currentId)) {
      return { isValid: false, message: `Bed code "${trimmed}" already exists.` };
    }
    return { isValid: true };
  }

  // ── Wards ──────────────────────────────────────────────────────────
  static async createWard(values: WardFormValues, _currentUser?: User | null): Promise<Ward> {
    const res = await apiClient.post<{ data: { id: string } }>('/setup/wards-rooms-beds/wards', {
      code: values.code?.trim() || undefined,
      departmentId: values.departmentId,
      name: values.name.trim(),
      wardType: values.wardType,
      genderPolicy: values.genderPolicy,
      floor: values.floor?.trim() || undefined,
      location: values.location?.trim() || undefined,
      description: values.description?.trim() || undefined,
      headStaffId: values.headStaffId?.trim() || undefined,
      fixedPrice: values.fixedPrice !== undefined && values.fixedPrice !== '' && values.fixedPrice !== null ? Number(values.fixedPrice) : undefined,
      isActive: values.status === 'Active',
    });
    await fetchWardHierarchy();
    return cachedWards.find((w) => w.id === res.data.data.id)!;
  }

  static async updateWard(id: string, values: WardFormValues, _currentUser?: User | null): Promise<Ward> {
    await apiClient.patch(`/setup/wards-rooms-beds/wards/${id}`, {
      code: values.code?.trim() || undefined,
      departmentId: values.departmentId,
      name: values.name.trim(),
      wardType: values.wardType,
      genderPolicy: values.genderPolicy,
      floor: values.floor?.trim() || undefined,
      location: values.location?.trim() || undefined,
      description: values.description?.trim() || undefined,
      headStaffId: values.headStaffId !== undefined ? (values.headStaffId.trim() ? values.headStaffId.trim() : null) : undefined,
      fixedPrice: values.fixedPrice !== undefined && values.fixedPrice !== '' && values.fixedPrice !== null ? Number(values.fixedPrice) : null,
      isActive: values.status === 'Active',
    });
    await fetchWardHierarchy();
    return cachedWards.find((w) => w.id === id)!;
  }

  static async changeWardStatus(id: string, newStatus: 'Active' | 'Inactive', _currentUser?: User | null): Promise<Ward> {
    await apiClient.patch(`/setup/wards-rooms-beds/wards/${id}`, { isActive: newStatus === 'Active' });
    await fetchWardHierarchy();
    return cachedWards.find((w) => w.id === id)!;
  }

  static async deleteWard(id: string): Promise<{ success: boolean; message?: string }> {
    try {
      await apiClient.delete(`/setup/wards-rooms-beds/wards/${id}`);
      await fetchWardHierarchy();
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Failed to delete ward.' };
    }
  }

  // ── Rooms ──────────────────────────────────────────────────────────
  static async createRoom(values: RoomFormValues, _currentUser?: User | null): Promise<Room> {
    const res = await apiClient.post<{ data: { id: string } }>('/setup/wards-rooms-beds/rooms', {
      code: values.code?.trim() || undefined,
      wardId: values.wardId || undefined,
      roomNumber: values.roomNumber?.trim() || undefined,
      name: values.name.trim(),
      roomType: values.roomType,
      capacity: values.capacity,
      dailyRoomRate: values.dailyRoomRate,
      isActive: values.status === 'Active',
    });
    await fetchWardHierarchy();
    return cachedRooms.find((r) => r.id === res.data.data.id)!;
  }

  static async updateRoom(id: string, values: RoomFormValues, _currentUser?: User | null): Promise<Room> {
    await apiClient.patch(`/setup/wards-rooms-beds/rooms/${id}`, {
      code: values.code?.trim() || undefined,
      wardId: values.wardId || null,
      roomNumber: values.roomNumber?.trim() || undefined,
      name: values.name.trim(),
      roomType: values.roomType,
      capacity: values.capacity,
      dailyRoomRate: values.dailyRoomRate,
      isActive: values.status === 'Active',
    });
    await fetchWardHierarchy();
    return cachedRooms.find((r) => r.id === id)!;
  }

  static async changeRoomStatus(id: string, newStatus: 'Active' | 'Inactive', _currentUser?: User | null): Promise<Room> {
    await apiClient.patch(`/setup/wards-rooms-beds/rooms/${id}`, { isActive: newStatus === 'Active' });
    await fetchWardHierarchy();
    return cachedRooms.find((r) => r.id === id)!;
  }

  static async deleteRoom(id: string): Promise<{ success: boolean; message?: string }> {
    try {
      await apiClient.delete(`/setup/wards-rooms-beds/rooms/${id}`);
      await fetchWardHierarchy();
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Failed to delete room.' };
    }
  }

  static async createBedsBatch(bedsToCreate: BedFormValues[], _currentUser?: User | null): Promise<void> {
    for (const values of bedsToCreate) {
      await apiClient.post('/setup/wards-rooms-beds/beds', {
        code: values.code?.trim() || undefined,
        roomId: values.roomId || undefined,
        wardId: values.wardId || undefined,
        bedNumber: values.bedNumber.trim(),
        bedType: values.bedType,
        operationalStatus: OPERATIONAL_TO_BACKEND[values.operationalStatus || 'Active'],
      });
    }
    await fetchWardHierarchy();
  }

  static async createBed(values: BedFormValues, _currentUser?: User | null): Promise<Bed> {
    const res = await apiClient.post<{ data: { id: string } }>('/setup/wards-rooms-beds/beds', {
      code: values.code?.trim() || undefined,
      roomId: values.roomId || undefined,
      wardId: values.wardId || undefined,
      bedNumber: values.bedNumber.trim(),
      bedType: values.bedType,
      operationalStatus: OPERATIONAL_TO_BACKEND[values.operationalStatus],
    });
    await fetchWardHierarchy();
    return cachedBeds.find((b) => b.id === res.data.data.id)!;
  }

  static async updateBed(id: string, values: BedFormValues, _currentUser?: User | null): Promise<Bed> {
    await apiClient.patch(`/setup/wards-rooms-beds/beds/${id}`, {
      code: values.code?.trim() || undefined,
      bedNumber: values.bedNumber.trim(),
      bedType: values.bedType,
      status: OCCUPANCY_TO_BACKEND[values.occupancyStatus],
      operationalStatus: OPERATIONAL_TO_BACKEND[values.operationalStatus],
    });
    await fetchWardHierarchy();
    return cachedBeds.find((b) => b.id === id)!;
  }

  static async changeBedOperationalStatus(id: string, newStatus: BedOperationalStatus, _currentUser?: User | null): Promise<Bed> {
    await apiClient.patch(`/setup/wards-rooms-beds/beds/${id}`, { operationalStatus: OPERATIONAL_TO_BACKEND[newStatus] });
    await fetchWardHierarchy();
    return cachedBeds.find((b) => b.id === id)!;
  }

  static async deleteBed(id: string): Promise<{ success: boolean; message?: string }> {
    try {
      await apiClient.delete(`/setup/wards-rooms-beds/beds/${id}`);
      await fetchWardHierarchy();
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Failed to delete bed.' };
    }
  }

  // ── Aggregates ─────────────────────────────────────────────────────
  static getTopSummary() {
    const wards = this.getWards();
    const rooms = this.getRooms();
    const beds = this.getBeds();

    const totalWards = wards.length;
    const totalRooms = rooms.length;
    const totalBeds = beds.length;
    const availableBeds = beds.filter((b) => b.occupancyStatus === 'Available' && b.operationalStatus === 'Active').length;
    const occupiedBeds = beds.filter((b) => b.occupancyStatus === 'Occupied').length;
    const outOfServiceBeds = beds.filter((b) => b.operationalStatus !== 'Active' || b.occupancyStatus === 'Reserved').length;

    return { totalWards, totalRooms, totalBeds, availableBeds, occupiedBeds, outOfServiceBeds };
  }

  // ── Bulk Import ────────────────────────────────────────────────────
  static validateWardImportRows(
    rows: any[],
    existingWards: Ward[] = this.getWards()
  ): { totalRows: number; validRows: WardImportRow[]; invalidRows: WardImportRow[] } {
    const validRows: WardImportRow[] = [];
    const invalidRows: WardImportRow[] = [];
    const existingCodes = new Set(existingWards.map((w) => w.code.toUpperCase()));
    const batchCodes = new Set<string>();
    const departments = DepartmentService.getDepartments();

    const resolveDepartment = (rawDept: string) => {
      if (!rawDept) return departments[0];
      const upper = rawDept.trim().toUpperCase();
      const direct = departments.find((d) => d.code.toUpperCase() === upper || d.name.toUpperCase() === upper);
      if (direct) return direct;
      const fuzzy = departments.find((d) => d.name.toUpperCase().includes(upper) || upper.includes(d.name.toUpperCase()));
      return fuzzy || departments[0];
    };

    rows.forEach((r, idx) => {
      const rowNumber = idx + 2;
      const errors: string[] = [];

      const rawCode = String(
        r['Ward Code'] || r.ward_code || r.wardcode || r.code || r['Code'] || ''
      ).trim().toUpperCase();

      const wardName = String(
        r['Ward Name *'] || r['Ward Name'] || r.ward_name || r.wardname || r.name || r['Name'] || ''
      ).trim();

      const rawDept = String(
        r['Department *'] || r['Department'] || r.department || r['Department Code'] || r.department_code || r.departmentcode || ''
      ).trim();

      const wardType = String(
        r['Ward Type *'] || r['Ward Type'] || r.ward_type || r.wardtype || 'General'
      ).trim();

      const genderPolicy = String(
        r['Gender Policy'] || r.gender_policy || r.genderpolicy || 'Mixed'
      ).trim();

      const floor = String(r['Floor'] || r.floor || '').trim();
      const location = String(r['Location / Wing'] || r['Location'] || r.location || '').trim();
      const description = String(r['Description'] || r.description || '').trim();
      const status = String(r['Status (Active/Inactive)'] || r['Status'] || r.status || 'Active').trim();
      const rawWardFee =
        r['Ward Fee (Per Day PKR)'] ??
        r['Ward Fee (PKR)'] ??
        r['Ward Fee'] ??
        r['Fixed Price (PKR)'] ??
        r.fixed_price ??
        r.fixedPrice ??
        r.ward_fee;
      const parsedWardFee =
        rawWardFee !== undefined && rawWardFee !== null && String(rawWardFee).trim() !== ''
          ? parseFloat(String(rawWardFee).replace(/[^0-9.-]+/g, ''))
          : null;
      const fixedPrice = parsedWardFee !== null && !isNaN(parsedWardFee) && parsedWardFee >= 0 ? parsedWardFee : null;

      let wardCode = rawCode;
      if (wardCode) {
        if (!/^[A-Z0-9-]+$/.test(wardCode)) {
          errors.push('Ward Code must contain uppercase alphanumeric and hyphens only.');
        } else if (existingCodes.has(wardCode)) {
          errors.push(`Ward Code "${wardCode}" already exists.`);
        } else if (batchCodes.has(wardCode)) {
          errors.push(`Duplicate Ward Code "${wardCode}" within import file.`);
        } else {
          batchCodes.add(wardCode);
        }
      } else {
        wardCode = `WRD-${String(idx + 1).padStart(3, '0')}`;
        let counter = idx + 1;
        while (existingCodes.has(wardCode) || batchCodes.has(wardCode)) {
          counter++;
          wardCode = `WRD-${String(counter).padStart(3, '0')}`;
        }
        batchCodes.add(wardCode);
      }

      if (!wardName) errors.push('Ward Name is required.');

      const matchedDept = resolveDepartment(rawDept);
      if (!matchedDept && departments.length === 0) {
        errors.push('No active hospital departments found.');
      }

      const item: WardImportRow = {
        rowNumber,
        wardCode,
        wardName,
        departmentCode: matchedDept ? matchedDept.code : (rawDept || 'DEP-GEN'),
        wardType,
        genderPolicy,
        floor,
        location,
        fixedPrice,
        status: status.toLowerCase() === 'inactive' ? 'Inactive' : 'Active',
        isValid: errors.length === 0,
        errors,
      };

      if (item.isValid) validRows.push(item);
      else invalidRows.push(item);
    });

    return { totalRows: rows.length, validRows, invalidRows };
  }

  /** Persists each validated row via a real `POST /setup/wards-rooms-beds/wards`, one at a time. */
  static async importWards(validRows: WardImportRow[]): Promise<{ imported: number; failures: string[] }> {
    const departments = DepartmentService.getDepartments();
    const deptMap = new Map(departments.map((d) => [d.code.toUpperCase(), d]));
    const failures: string[] = [];
    let imported = 0;

    for (const r of validRows) {
      const dept = deptMap.get(r.departmentCode.toUpperCase()) || departments[0];
      if (!dept) {
        failures.push(`${r.wardCode}: department "${r.departmentCode}" not found`);
        continue;
      }
      try {
        await WardsRoomsBedsService.createWard({
          code: r.wardCode,
          name: r.wardName,
          departmentId: dept.id,
          wardType: r.wardType as WardType,
          genderPolicy: r.genderPolicy as GenderPolicy,
          floor: r.floor,
          location: r.location,
          fixedPrice: r.fixedPrice ?? undefined,
          description: '',
          status: r.status as 'Active' | 'Inactive',
        });
        imported += 1;
      } catch (err: any) {
        failures.push(`${r.wardCode}: ${err?.message || 'Failed to import'}`);
      }
    }
    return { imported, failures };
  }

  static validateRoomImportRows(
    rows: any[],
    existingRooms: Room[] = this.getRooms(),
    existingWards: Ward[] = this.getWards()
  ): { totalRows: number; validRows: RoomImportRow[]; invalidRows: RoomImportRow[] } {
    const validRows: RoomImportRow[] = [];
    const invalidRows: RoomImportRow[] = [];
    const existingCodes = new Set(existingRooms.map((r) => r.code.toUpperCase()));
    const batchCodes = new Set<string>();

    const resolveWard = (rawWard: string) => {
      if (!rawWard) return existingWards[0];
      const upper = rawWard.trim().toUpperCase();
      const direct = existingWards.find((w) => w.code.toUpperCase() === upper || w.name.toUpperCase() === upper);
      if (direct) return direct;
      const fuzzy = existingWards.find((w) => w.name.toUpperCase().includes(upper) || upper.includes(w.name.toUpperCase()));
      return fuzzy || existingWards[0];
    };

    rows.forEach((r, idx) => {
      const rowNumber = idx + 2;
      const errors: string[] = [];

      const rawCode = String(
        r['Room Code'] || r.room_code || r.roomcode || r.code || r['Code'] || ''
      ).trim().toUpperCase();

      const roomNumber = String(
        r['Room Number *'] || r['Room Number'] || r.room_number || r.roomnumber || r.number || ''
      ).trim();

      const rawWard = String(
        r['Ward *'] || r['Ward'] || r.ward || r['Ward Code'] || r.ward_code || r.wardcode || ''
      ).trim();

      const roomName = String(
        r['Room Name'] || r.room_name || r.roomname || r.name || (roomNumber ? `Room ${roomNumber}` : '')
      ).trim();

      const roomType = String(
        r['Room Type *'] || r['Room Type'] || r.room_type || r.roomtype || 'General'
      ).trim();

      const capacity = parseInt(
        String(r['Capacity'] || r.capacity || '2'),
        10
      );

      const dailyRateVal =
        r['Room Fee (Per Day PKR) *'] ??
        r['Room Fee (Per Day PKR)'] ??
        r['Room Fee (PKR)'] ??
        r['Room Fee'] ??
        r['Room / Ward Fee (Per Day PKR) *'] ??
        r['Room / Ward Fee (Per Day PKR)'] ??
        r['Ward Fee (Per Day PKR)'] ??
        r.ward_fee ??
        r['Daily Room Rate (PKR) *'] ??
        r['Daily Room Rate (PKR)'] ??
        r['Daily Room Rate'] ??
        r.daily_room_rate ??
        r.dailyroomrate ??
        r.rate ??
        0;
      const dailyRoomRate = parseFloat(String(dailyRateVal).replace(/[^0-9.-]+/g, '')) || 0;

      const floor = String(r['Floor'] || r.floor || '').trim();
      const status = String(r['Status (Active/Inactive)'] || r['Status'] || r.status || 'Active').trim();

      let roomCode = rawCode;
      if (roomCode) {
        if (!/^[A-Z0-9-]+$/.test(roomCode)) {
          errors.push('Room Code must contain uppercase alphanumeric and hyphens only.');
        } else if (existingCodes.has(roomCode)) {
          errors.push(`Room Code "${roomCode}" already exists.`);
        } else if (batchCodes.has(roomCode)) {
          errors.push(`Duplicate Room Code "${roomCode}" in import.`);
        } else {
          batchCodes.add(roomCode);
        }
      } else {
        roomCode = `RM-${String(idx + 1).padStart(3, '0')}`;
        let counter = idx + 1;
        while (existingCodes.has(roomCode) || batchCodes.has(roomCode)) {
          counter++;
          roomCode = `RM-${String(counter).padStart(3, '0')}`;
        }
        batchCodes.add(roomCode);
      }

      if (!roomNumber) errors.push('Room Number is required.');

      const matchedWard = resolveWard(rawWard);
      if (!matchedWard && existingWards.length === 0) {
        errors.push('No parent wards found. Please register or import wards first.');
      }

      if (isNaN(capacity) || capacity < 1) errors.push('Capacity must be >= 1.');
      if (isNaN(dailyRoomRate) || dailyRoomRate < 0) errors.push('Daily rate must be >= 0.');

      const item: RoomImportRow = {
        rowNumber,
        roomCode,
        roomNumber,
        roomName: roomName || `Room ${roomNumber}`,
        wardCode: matchedWard ? matchedWard.code : (rawWard || 'WRD-GEN'),
        roomType,
        capacity: isNaN(capacity) ? 2 : capacity,
        dailyRoomRate: isNaN(dailyRoomRate) ? 0 : dailyRoomRate,
        status: status.toLowerCase() === 'inactive' ? 'Inactive' : 'Active',
        isValid: errors.length === 0,
        errors,
      };

      if (item.isValid) validRows.push(item);
      else invalidRows.push(item);
    });

    return { totalRows: rows.length, validRows, invalidRows };
  }

  static async importRooms(validRows: RoomImportRow[]): Promise<{ imported: number; failures: string[] }> {
    const wards = this.getWards();
    const wardMap = new Map(wards.map((w) => [w.code.toUpperCase(), w]));
    const failures: string[] = [];
    let imported = 0;

    for (const r of validRows) {
      const ward = wardMap.get(r.wardCode.toUpperCase()) || wards[0];
      if (!ward) {
        failures.push(`${r.roomCode}: ward "${r.wardCode}" not found`);
        continue;
      }
      try {
        await WardsRoomsBedsService.createRoom({
          code: r.roomCode,
          roomNumber: r.roomNumber,
          name: r.roomName,
          wardId: ward.id,
          roomType: r.roomType as RoomType,
          floor: ward.floor || '',
          capacity: r.capacity,
          dailyRoomRate: r.dailyRoomRate,
          status: r.status as 'Active' | 'Inactive',
        });
        imported += 1;
      } catch (err: any) {
        failures.push(`${r.roomCode}: ${err?.message || 'Failed to import'}`);
      }
    }
    return { imported, failures };
  }

  static validateBedImportRows(
    rows: any[],
    existingBeds: Bed[] = this.getBeds(),
    existingRooms: Room[] = this.getRooms(),
    _existingWards: Ward[] = this.getWards()
  ): { totalRows: number; validRows: BedImportRow[]; invalidRows: BedImportRow[] } {
    const validRows: BedImportRow[] = [];
    const invalidRows: BedImportRow[] = [];
    const existingCodes = new Set(existingBeds.map((b) => b.code.toUpperCase()));
    const batchCodes = new Set<string>();

    const resolveRoom = (rawRoom: string) => {
      if (!rawRoom) return existingRooms[0];
      const upper = rawRoom.trim().toUpperCase();
      const direct = existingRooms.find((rm) => rm.roomNumber.toUpperCase() === upper || rm.code.toUpperCase() === upper);
      if (direct) return direct;
      const fuzzy = existingRooms.find((rm) => rm.name.toUpperCase().includes(upper) || upper.includes(rm.name.toUpperCase()));
      return fuzzy || existingRooms[0];
    };

    rows.forEach((r, idx) => {
      const rowNumber = idx + 2;
      const errors: string[] = [];

      const rawCode = String(
        r['Bed Code'] || r.bed_code || r.bedcode || r.code || r['Code'] || ''
      ).trim().toUpperCase();

      const bedNumber = String(
        r['Bed Number *'] || r['Bed Number'] || r.bed_number || r.bednumber || r.number || ''
      ).trim();

      const rawRoom = String(
        r['Room *'] || r['Room'] || r.room || r['Room Number'] || r.room_number || r['Room Code'] || r.room_code || ''
      ).trim();

      const bedType = String(
        r['Bed Type'] || r.bed_type || r.bedtype || 'Standard'
      ).trim();

      const operationalStatus = String(
        r['Operational Status (Active/Out of Service)'] || r['Operational Status'] || r.operational_status || r.operationalstatus || r.status || 'Active'
      ).trim();

      let bedCode = rawCode;
      if (bedCode) {
        if (!/^[A-Z0-9-]+$/.test(bedCode)) {
          errors.push('Bed Code must contain uppercase alphanumeric and hyphens only.');
        } else if (existingCodes.has(bedCode)) {
          errors.push(`Bed Code "${bedCode}" already exists.`);
        } else if (batchCodes.has(bedCode)) {
          errors.push(`Duplicate Bed Code "${bedCode}" in import.`);
        } else {
          batchCodes.add(bedCode);
        }
      } else {
        bedCode = `BED-${String(idx + 1).padStart(3, '0')}`;
        let counter = idx + 1;
        while (existingCodes.has(bedCode) || batchCodes.has(bedCode)) {
          counter++;
          bedCode = `BED-${String(counter).padStart(3, '0')}`;
        }
        batchCodes.add(bedCode);
      }

      if (!bedNumber) errors.push('Bed Number is required.');

      const matchedRoom = resolveRoom(rawRoom);
      if (!matchedRoom && existingRooms.length === 0) {
        errors.push('No parent rooms found. Please register or import rooms first.');
      }

      const item: BedImportRow = {
        rowNumber,
        bedCode,
        bedNumber,
        roomCode: matchedRoom ? matchedRoom.code : (rawRoom || 'RM-GEN'),
        bedType,
        occupancyStatus: 'Available',
        operationalStatus: operationalStatus.toLowerCase().includes('out') ? 'Out of Service' : 'Active',
        isValid: errors.length === 0,
        errors,
      };

      if (item.isValid) validRows.push(item);
      else invalidRows.push(item);
    });

    return { totalRows: rows.length, validRows, invalidRows };
  }

  static async importBeds(validRows: BedImportRow[]): Promise<{ imported: number; failures: string[] }> {
    const rooms = this.getRooms();
    const roomMap = new Map(rooms.map((r) => [r.code.toUpperCase(), r]));
    const failures: string[] = [];
    let imported = 0;

    for (const r of validRows) {
      const room = roomMap.get(r.roomCode.toUpperCase()) || rooms[0];
      if (!room) {
        failures.push(`${r.bedCode}: room "${r.roomCode}" not found`);
        continue;
      }
      try {
        await WardsRoomsBedsService.createBed({
          code: r.bedCode,
          bedNumber: r.bedNumber,
          roomId: room.id,
          wardId: '',
          bedType: r.bedType as BedType,
          occupancyStatus: 'Available',
          operationalStatus: (r.operationalStatus as BedOperationalStatus) || 'Active',
        });
        imported += 1;
      } catch (err: any) {
        failures.push(`${r.bedCode}: ${err?.message || 'Failed to import'}`);
      }
    }
    return { imported, failures };
  }

  // ── Combined All-in-One Validation & Import ────────────────────────
  static validateAllInOneSetup(
    data: { wardsRows: any[]; roomsRows: any[]; bedsRows: any[] }
  ): {
    wardsResult: { totalRows: number; validRows: WardImportRow[]; invalidRows: WardImportRow[] };
    roomsResult: { totalRows: number; validRows: RoomImportRow[]; invalidRows: RoomImportRow[] };
    bedsResult: { totalRows: number; validRows: BedImportRow[]; invalidRows: BedImportRow[] };
  } {
    const existingWards = this.getWards();
    const existingRooms = this.getRooms();
    const existingBeds = this.getBeds();

    // 1. Validate Wards
    const wardsResult = this.validateWardImportRows(data.wardsRows, existingWards);

    // 2. Synthesize available wards (existing + pending valid)
    const combinedWards: Ward[] = [
      ...existingWards,
      ...wardsResult.validRows.map((w, i) => ({
        id: `pending-ward-${i}`,
        code: w.wardCode,
        name: w.wardName,
        departmentId: 'pending',
        departmentName: w.departmentCode,
        wardType: w.wardType as any,
        genderPolicy: w.genderPolicy as any,
        floor: w.floor,
        location: w.location,
        description: '',
        roomCount: 0,
        bedCount: 0,
        occupiedBeds: 0,
        availableBeds: 0,
        maintenanceBeds: 0,
        status: w.status as any,
        createdBy: 'Import',
        createdAt: new Date().toISOString(),
        updatedBy: 'Import',
        updatedAt: new Date().toISOString(),
      })),
    ];

    // 3. Validate Rooms against combined wards
    const roomsResult = this.validateRoomImportRows(data.roomsRows, existingRooms, combinedWards);

    // 4. Synthesize available rooms (existing + pending valid)
    const combinedRooms: Room[] = [
      ...existingRooms,
      ...roomsResult.validRows.map((r, i) => ({
        id: `pending-room-${i}`,
        code: r.roomCode,
        roomNumber: r.roomNumber,
        name: r.roomName,
        wardId: 'pending',
        wardName: r.wardCode,
        departmentId: 'pending',
        departmentName: '',
        roomType: r.roomType as any,
        floor: '',
        capacity: r.capacity,
        bedsConfigured: 0,
        currentOccupancy: 0,
        dailyRoomRate: r.dailyRoomRate,
        bedCount: 0,
        status: r.status as any,
        createdBy: 'Import',
        createdAt: new Date().toISOString(),
        updatedBy: 'Import',
        updatedAt: new Date().toISOString(),
      })),
    ];

    // 5. Validate Beds against combined rooms
    const bedsResult = this.validateBedImportRows(data.bedsRows, existingBeds, combinedRooms, combinedWards);

    return { wardsResult, roomsResult, bedsResult };
  }

  static async importAllInOneSetup(payload: {
    wards: WardImportRow[];
    rooms: RoomImportRow[];
    beds: BedImportRow[];
  }): Promise<{
    importedWards: number;
    importedRooms: number;
    importedBeds: number;
    failures: string[];
  }> {
    const allFailures: string[] = [];

    // Step 1: Import Wards
    const wardRes = await this.importWards(payload.wards);
    if (wardRes.failures.length > 0) allFailures.push(...wardRes.failures);

    // Step 2: Import Rooms
    const roomRes = await this.importRooms(payload.rooms);
    if (roomRes.failures.length > 0) allFailures.push(...roomRes.failures);

    // Step 3: Import Beds
    const bedRes = await this.importBeds(payload.beds);
    if (bedRes.failures.length > 0) allFailures.push(...bedRes.failures);

    return {
      importedWards: wardRes.imported,
      importedRooms: roomRes.imported,
      importedBeds: bedRes.imported,
      failures: allFailures,
    };
  }

  // ── Filtering ──────────────────────────────────────────────────────
  static filterWards(wards: Ward[], filters: WardFilterState): Ward[] {
    return wards.filter((w) => {
      if (filters.searchTerm.trim()) {
        const q = filters.searchTerm.toLowerCase().trim();
        if (!w.code.toLowerCase().includes(q) && !w.name.toLowerCase().includes(q) && !w.departmentName.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (filters.departmentId !== 'All' && w.departmentId !== filters.departmentId) return false;
      if (filters.wardType !== 'All' && w.wardType !== filters.wardType) return false;
      if (filters.status !== 'All' && w.status !== filters.status) return false;
      return true;
    });
  }

  static filterRooms(rooms: Room[], filters: RoomFilterState): Room[] {
    return rooms.filter((r) => {
      if (filters.searchTerm.trim()) {
        const q = filters.searchTerm.toLowerCase().trim();
        if (
          !r.code.toLowerCase().includes(q) &&
          !r.roomNumber.toLowerCase().includes(q) &&
          !r.name.toLowerCase().includes(q) &&
          !r.wardName.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      if (filters.wardId !== 'All' && r.wardId !== filters.wardId) return false;
      if (filters.roomType !== 'All' && r.roomType !== filters.roomType) return false;
      if (filters.status !== 'All' && r.status !== filters.status) return false;
      return true;
    });
  }

  static filterBeds(beds: Bed[], filters: BedFilterState): Bed[] {
    return beds.filter((b) => {
      if (filters.searchTerm.trim()) {
        const q = filters.searchTerm.toLowerCase().trim();
        if (
          !b.code.toLowerCase().includes(q) &&
          !b.bedNumber.toLowerCase().includes(q) &&
          !b.roomName.toLowerCase().includes(q) &&
          !b.wardName.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      if (filters.wardId !== 'All' && b.wardId !== filters.wardId) return false;
      if (filters.roomId !== 'All' && b.roomId !== filters.roomId) return false;
      if (filters.bedType !== 'All' && b.bedType !== filters.bedType) return false;
      if (filters.occupancyStatus !== 'All' && b.occupancyStatus !== filters.occupancyStatus) return false;
      if (filters.operationalStatus !== 'All' && b.operationalStatus !== filters.operationalStatus) return false;
      return true;
    });
  }
}
