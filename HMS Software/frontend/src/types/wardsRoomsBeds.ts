export type WardType =
  | 'General'
  | 'Private'
  | 'Semi-Private'
  | 'Other';

// Backend stores this as a free-form string with no enum validation — this
// type is the frontend's own single source of truth, matching
// `VALID_GENDER_POLICIES`, the CSV import default, and every display check
// (BedBoardView, AdmissionDashboard) elsewhere in the app.
export type GenderPolicy =
  | 'Male'
  | 'Female'
  | 'Mixed'
  | 'Pediatric'
  | 'Not Applicable';

export type RoomType =
  | 'General'
  | 'Private'
  | 'Semi-Private';

export type BedType =
  | 'Standard'
  | 'Private'
  | 'Semi-Private'
  | 'ICU'
  | 'NICU'
  | 'PICU'
  | 'Pediatric'
  | 'Isolation'
  | 'Emergency'
  | 'Other';

export type BedOccupancyStatus = 'Available' | 'Occupied' | 'Reserved' | 'Maintenance';

export type BedOperationalStatus = 'Active' | 'Cleaning' | 'Maintenance' | 'Out of Service' | 'Decommissioned';

export interface Ward {
  id: string;
  code: string;
  name: string;

  departmentId: string;
  departmentName: string;

  wardType: WardType;
  genderPolicy?: GenderPolicy;

  floor?: string;
  location?: string;
  description?: string;

  headStaffId?: string | null;
  headStaffName?: string | null;
  fixedPrice?: number | null;

  roomCount: number;
  bedCount: number;
  availableBeds?: number;

  status: 'Active' | 'Inactive';

  // Safeguard linkages
  historicalAdmissionCount?: number;

  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;

  statusChangedBy?: string;
  statusChangedAt?: string;
}

export interface Room {
  id: string;
  code: string;
  roomNumber: string;
  name: string;

  // Empty string means this Room is standalone (Room -> Bed structure, no
  // parent Ward) — not every Room belongs to a Ward.
  wardId: string;
  wardName: string;

  departmentId: string;
  departmentName: string;

  roomType: RoomType;
  floor?: string;
  capacity: number;
  bedsConfigured: number;

  dailyRoomRate: number; // PKR

  status: 'Active' | 'Inactive';

  // Safeguard linkages
  admissionLinkageCount?: number;

  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;

  statusChangedBy?: string;
  statusChangedAt?: string;
}

export interface Bed {
  id: string;
  code: string;
  bedNumber: string;

  // A Bed always has at least one of roomId/wardId set — empty string means
  // "not set" for that one (direct Ward -> Bed has no room; standalone
  // Room -> Bed has no ward).
  roomId: string;
  roomNumber: string;
  roomName: string;

  wardId: string;
  wardName: string;

  departmentId: string;
  departmentName: string;

  bedType: BedType;

  occupancyStatus: BedOccupancyStatus;
  operationalStatus: BedOperationalStatus;

  currentPatientId?: string;
  currentPatientName?: string;
  // Self-pay encounters have no permanent MRN by design — stays undefined
  // for those admissions (panel.md §4.6/§17).
  currentPatientMrn?: string;
  admissionId?: string;
  admissionDate?: string;
  admittingDoctorName?: string;

  // Safeguard linkages
  historicalAdmissionCount?: number;

  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;

  statusChangedBy?: string;
  statusChangedAt?: string;
}

export interface WardFilterState {
  searchTerm: string;
  departmentId: string;
  wardType: string;
  status: string;
}

export interface RoomFilterState {
  searchTerm: string;
  wardId: string;
  roomType: string;
  status: string;
}

export interface BedFilterState {
  searchTerm: string;
  wardId: string;
  roomId: string;
  bedType: string;
  occupancyStatus: string;
  operationalStatus: string;
}

export interface WardFormValues {
  code: string;
  name: string;
  departmentId: string;
  wardType: WardType;
  genderPolicy: GenderPolicy;
  floor: string;
  location: string;
  // WardModal never collects this today; service layer already treats it
  // as optional (`values.description?.trim() || undefined`).
  description?: string;
  headStaffId?: string;
  fixedPrice?: number | string;
  status: 'Active' | 'Inactive';
}

export interface RoomFormValues {
  code: string;
  roomNumber: string;
  name: string;
  // Empty string = standalone Room (no parent Ward).
  wardId: string;
  roomType: RoomType;
  // RoomModal never collects this today (Ward already carries floor for the
  // building) — kept optional to match Room.floor and how the service layer
  // already treats it (`values.floor?.trim() || undefined`).
  floor?: string;
  capacity: number;
  dailyRoomRate: number;
  status: 'Active' | 'Inactive';
  autoGenerateBeds?: boolean;
}

export interface BedFormValues {
  code: string;
  bedNumber: string;
  // At least one of roomId/wardId must be non-empty; the other is ''.
  roomId: string;
  wardId: string;
  bedType: BedType;
  occupancyStatus: BedOccupancyStatus;
  operationalStatus: BedOperationalStatus;
  quantity?: number;
  additionalBeds?: number;
  numberingPrefix?: string;
}

export interface WardImportRow {
  rowNumber: number;
  wardCode: string;
  wardName: string;
  departmentCode: string;
  wardType: string;
  genderPolicy?: string;
  floor?: string;
  location?: string;
  fixedPrice?: number | null;
  status: string;
  isValid: boolean;
  errors: string[];
}

export interface RoomImportRow {
  rowNumber: number;
  roomCode: string;
  roomNumber: string;
  roomName: string;
  wardCode: string;
  roomType: string;
  capacity: number;
  dailyRoomRate: number;
  status: string;
  isValid: boolean;
  errors: string[];
}

export interface BedImportRow {
  rowNumber: number;
  bedCode: string;
  bedNumber: string;
  roomCode: string;
  bedType: string;
  occupancyStatus?: string;
  operationalStatus: string;
  isValid: boolean;
  errors: string[];
}
