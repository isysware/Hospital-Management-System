import { TableColumn } from '../../types';
import { formatDisplayDate, getHospitalCurrentDate } from '../../utils/dateConstants';

const CURRENT_OPERATIONAL_DATE = formatDisplayDate(getHospitalCurrentDate());

// Departments schema & data
export interface DepartmentRecord {
  id: string;
  code: string;
  name: string;
  type: 'Clinical' | 'Diagnostic' | 'Surgical' | 'Administrative' | 'Support';
  head: string;
  doctorsCount: number;
  staffCount: number;
  status: 'Active' | 'Inactive';
  createdDate: string;
}

export const MOCK_DEPARTMENTS: DepartmentRecord[] = [
  {
    id: 'DEP-01',
    code: 'DEP-CRD',
    name: 'Cardiology & Cath Lab',
    type: 'Clinical',
    head: 'Prof. Dr. Tariq Saeed',
    doctorsCount: 8,
    staffCount: 26,
    status: 'Active',
    createdDate: '15 Jan 2024',
  },
  {
    id: 'DEP-02',
    code: 'DEP-ORT',
    name: 'Orthopedics & Spine Surgery',
    type: 'Surgical',
    head: 'Dr. M. Sharif Chaudhary',
    doctorsCount: 6,
    staffCount: 18,
    status: 'Active',
    createdDate: '15 Jan 2024',
  },
  {
    id: 'DEP-03',
    code: 'DEP-PED',
    name: 'Pediatrics & Neonatal ICU (NICU)',
    type: 'Clinical',
    head: 'Dr. Ayesha Malik',
    doctorsCount: 7,
    staffCount: 22,
    status: 'Active',
    createdDate: '20 Jan 2024',
  },
  {
    id: 'DEP-04',
    code: 'DEP-RAD',
    name: 'Radiology & Advanced Imaging',
    type: 'Diagnostic',
    head: 'Dr. Farhana Yasmeen',
    doctorsCount: 5,
    staffCount: 16,
    status: 'Active',
    createdDate: '10 Feb 2024',
  },
  {
    id: 'DEP-05',
    code: 'DEP-PAT',
    name: 'Pathology & Central Blood Bank',
    type: 'Diagnostic',
    head: 'Dr. Kamran Javed',
    doctorsCount: 4,
    staffCount: 20,
    status: 'Active',
    createdDate: '10 Feb 2024',
  },
  {
    id: 'DEP-06',
    code: 'DEP-EME',
    name: 'Emergency & Trauma Centre',
    type: 'Clinical',
    head: 'Dr. Hamza Rafique',
    doctorsCount: 12,
    staffCount: 34,
    status: 'Active',
    createdDate: '01 Jan 2024',
  },
  {
    id: 'DEP-07',
    code: 'DEP-ICU',
    name: 'Intensive Care Unit (ICU / CCU)',
    type: 'Clinical',
    head: 'Dr. Bilal Qureshi',
    doctorsCount: 6,
    staffCount: 28,
    status: 'Active',
    createdDate: '15 Jan 2024',
  },
  {
    id: 'DEP-08',
    code: 'DEP-OBS',
    name: 'Obstetrics & Gynecology (OB/GYN)',
    type: 'Surgical',
    head: 'Dr. Shazia Parveen',
    doctorsCount: 6,
    staffCount: 24,
    status: 'Active',
    createdDate: '01 Feb 2024',
  },
  {
    id: 'DEP-09',
    code: 'DEP-NEP',
    name: 'Nephrology & Dialysis Unit',
    type: 'Clinical',
    head: 'Dr. Zulfiqar Haider',
    doctorsCount: 4,
    staffCount: 14,
    status: 'Active',
    createdDate: '15 Feb 2024',
  },
  {
    id: 'DEP-10',
    code: 'DEP-SUR',
    name: 'General & Laparoscopic Surgery',
    type: 'Surgical',
    head: 'Prof. Dr. Irfan Bashir',
    doctorsCount: 9,
    staffCount: 30,
    status: 'Active',
    createdDate: '15 Jan 2024',
  },
  {
    id: 'DEP-11',
    code: 'DEP-PHA',
    name: 'Hospital Pharmacy & Therapeutics',
    type: 'Support',
    head: 'PharmD. Usman Ali',
    doctorsCount: 2,
    staffCount: 18,
    status: 'Active',
    createdDate: '01 Jan 2024',
  },
  {
    id: 'DEP-12',
    code: 'DEP-ADM',
    name: 'Executive Administration & Finance',
    type: 'Administrative',
    head: 'Engr. Bilal Ahmed',
    doctorsCount: 0,
    staffCount: 22,
    status: 'Active',
    createdDate: '01 Jan 2024',
  },
];

// Services & rates schema & data
export interface ServiceRateRecord {
  id: string;
  code: string;
  name: string;
  department: string;
  category: 'Consultation' | 'Intervention' | 'Radiology' | 'Diagnostic Lab' | 'OT Procedure' | 'Emergency' | 'Dialysis' | 'Bed Care';
  standardRate: number; // PKR
  panelEligible: boolean;
  status: 'Active' | 'Inactive';
  updatedBy: string;
  updatedDate: string;
}

export const MOCK_SERVICES_RATES: ServiceRateRecord[] = [
  {
    id: 'SRV-01',
    code: 'SRV-CON-001',
    name: 'Senior Consultant OPD Clinical Review',
    department: 'Cardiology & Cath Lab',
    category: 'Consultation',
    standardRate: 3500,
    panelEligible: true,
    status: 'Active',
    updatedBy: 'Prof. Dr. Tariq Saeed',
    updatedDate: '04 Sep 2026',
  },
  {
    id: 'SRV-02',
    code: 'SRV-CATH-004',
    name: 'Coronary Angiography (Radial/Femoral Route)',
    department: 'Cardiology & Cath Lab',
    category: 'Intervention',
    standardRate: 45000,
    panelEligible: true,
    status: 'Active',
    updatedBy: 'Prof. Dr. Tariq Saeed',
    updatedDate: '04 Sep 2026',
  },
  {
    id: 'SRV-03',
    code: 'SRV-RAD-012',
    name: 'MRI Brain with Contrast 1.5 Tesla Protocol',
    department: 'Radiology & Advanced Imaging',
    category: 'Radiology',
    standardRate: 18500,
    panelEligible: true,
    status: 'Active',
    updatedBy: 'Dr. Farhana Yasmeen',
    updatedDate: '01 Sep 2026',
  },
  {
    id: 'SRV-04',
    code: 'SRV-RAD-004',
    name: 'High-Resolution Computed Tomography (HRCT) Chest',
    department: 'Radiology & Advanced Imaging',
    category: 'Radiology',
    standardRate: 12500,
    panelEligible: true,
    status: 'Active',
    updatedBy: 'Dr. Farhana Yasmeen',
    updatedDate: '01 Sep 2026',
  },
  {
    id: 'SRV-05',
    code: 'SRV-LAB-045',
    name: 'Complete Blood Count (CBC) Automated 5-Part Differential',
    department: 'Pathology & Central Blood Bank',
    category: 'Diagnostic Lab',
    standardRate: 1200,
    panelEligible: true,
    status: 'Active',
    updatedBy: 'Dr. Farhana Yasmeen',
    updatedDate: '03 Sep 2026',
  },
  {
    id: 'SRV-06',
    code: 'SRV-LAB-098',
    name: 'Troponin-I High Sensitivity Quantitative (Cardiac Marker)',
    department: 'Pathology & Central Blood Bank',
    category: 'Diagnostic Lab',
    standardRate: 2800,
    panelEligible: true,
    status: 'Active',
    updatedBy: 'Dr. Kamran Javed',
    updatedDate: '02 Sep 2026',
  },
  {
    id: 'SRV-07',
    code: 'SRV-OT-102',
    name: 'Laparoscopic Cholecystectomy Comprehensive Package',
    department: 'General & Laparoscopic Surgery',
    category: 'OT Procedure',
    standardRate: 95000,
    panelEligible: true,
    status: 'Active',
    updatedBy: 'Prof. Dr. Irfan Bashir',
    updatedDate: '28 Aug 2026',
  },
  {
    id: 'SRV-08',
    code: 'SRV-ER-003',
    name: 'Emergency Resuscitation & Acute Trauma Triage',
    department: 'Emergency & Trauma Centre',
    category: 'Emergency',
    standardRate: 4500,
    panelEligible: true,
    status: 'Active',
    updatedBy: 'Dr. Hamza Rafique',
    updatedDate: '02 Sep 2026',
  },
  {
    id: 'SRV-09',
    code: 'SRV-DIAL-007',
    name: 'Hemodialysis Standard Session with Dialyzer Kit',
    department: 'Nephrology & Dialysis Unit',
    category: 'Dialysis',
    standardRate: 6500,
    panelEligible: true,
    status: 'Active',
    updatedBy: 'Dr. Zulfiqar Haider',
    updatedDate: '05 Sep 2026',
  },
  {
    id: 'SRV-10',
    code: 'SRV-ECHO-002',
    name: '2D Transthoracic Color Doppler Echocardiography',
    department: 'Cardiology & Cath Lab',
    category: 'Diagnostic Lab',
    standardRate: 7500,
    panelEligible: true,
    status: 'Active',
    updatedBy: 'Prof. Dr. Tariq Saeed',
    updatedDate: '04 Sep 2026',
  },
  {
    id: 'SRV-11',
    code: 'SRV-BED-ICU',
    name: 'ICU Ventilator Bed with 24h Critical Monitoring (Per Day)',
    department: 'Intensive Care Unit (ICU / CCU)',
    category: 'Bed Care',
    standardRate: 15000,
    panelEligible: true,
    status: 'Active',
    updatedBy: 'Prof. Dr. Tariq Saeed',
    updatedDate: '01 Sep 2026',
  },
  {
    id: 'SRV-12',
    code: 'SRV-BED-PVT',
    name: 'Executive Deluxe Private Room (Per Day Tariff)',
    department: 'Executive Administration & Finance',
    category: 'Bed Care',
    standardRate: 8500,
    panelEligible: true,
    status: 'Active',
    updatedBy: 'Engr. Bilal Ahmed',
    updatedDate: '01 Sep 2026',
  },
];

// Wards, rooms & beds schema & data
export interface BedRecord {
  id: string;
  bedNumber: string;
  room: string;
  ward: string;
  department: string;
  bedType: 'ICU Ventilator' | 'Private Deluxe' | 'Semi-Private' | 'General Ward' | 'Dialysis Chair' | 'Day Care Bay';
  ratePerDay: number; // PKR
  occupancyStatus: 'Occupied' | 'Available' | 'Sanitizing' | 'Maintenance';
  currentPatient: string;
  status: 'Active' | 'Under Repair';
}

export const MOCK_BEDS: BedRecord[] = [
  {
    id: 'BED-01',
    bedNumber: 'BED-ICU-01',
    room: 'ICU Isolation Suite 1',
    ward: 'Critical Care Unit',
    department: 'Intensive Care Unit',
    bedType: 'ICU Ventilator',
    ratePerDay: 15000,
    occupancyStatus: 'Occupied',
    currentPatient: 'Muhammad Tariq Khan (MRN-2026-0842)',
    status: 'Active',
  },
  {
    id: 'BED-02',
    bedNumber: 'BED-ICU-04',
    room: 'ICU Bay A',
    ward: 'Critical Care Unit',
    department: 'Intensive Care Unit',
    bedType: 'ICU Ventilator',
    ratePerDay: 15000,
    occupancyStatus: 'Occupied',
    currentPatient: 'Shahnaz Begum (MRN-2026-0791)',
    status: 'Active',
  },
  {
    id: 'BED-03',
    bedNumber: 'BED-ICU-07',
    room: 'ICU Bay B',
    ward: 'Critical Care Unit',
    department: 'Intensive Care Unit',
    bedType: 'ICU Ventilator',
    ratePerDay: 15000,
    occupancyStatus: 'Available',
    currentPatient: 'Vacant',
    status: 'Active',
  },
  {
    id: 'BED-04',
    bedNumber: 'BED-PVT-201',
    room: 'Room 201 (VIP Presidential)',
    ward: 'Executive Private Ward',
    department: 'Inpatient Medicine',
    bedType: 'Private Deluxe',
    ratePerDay: 12000,
    occupancyStatus: 'Occupied',
    currentPatient: 'Capt. (R) Imran Farooq (MRN-2026-0812)',
    status: 'Active',
  },
  {
    id: 'BED-05',
    bedNumber: 'BED-PVT-204',
    room: 'Room 204 (Deluxe)',
    ward: 'Executive Private Ward',
    department: 'Inpatient Medicine',
    bedType: 'Private Deluxe',
    ratePerDay: 8500,
    occupancyStatus: 'Available',
    currentPatient: 'Vacant',
    status: 'Active',
  },
  {
    id: 'BED-06',
    bedNumber: 'BED-GEN-102',
    room: 'Male Surgical Bay 2',
    ward: 'General Surgical Ward',
    department: 'General Surgery',
    bedType: 'General Ward',
    ratePerDay: 2500,
    occupancyStatus: 'Occupied',
    currentPatient: 'Abdul Rehman (MRN-2026-0734)',
    status: 'Active',
  },
  {
    id: 'BED-07',
    bedNumber: 'BED-GEN-105',
    room: 'Male Surgical Bay 3',
    ward: 'General Surgical Ward',
    department: 'General Surgery',
    bedType: 'General Ward',
    ratePerDay: 2500,
    occupancyStatus: 'Sanitizing',
    currentPatient: 'Vacant (Cleaning Post-Discharge)',
    status: 'Active',
  },
  {
    id: 'BED-08',
    bedNumber: 'BED-CCU-02',
    room: 'Coronary Bay 2',
    ward: 'Cardiology CCU Ward',
    department: 'Cardiology',
    bedType: 'ICU Ventilator',
    ratePerDay: 12000,
    occupancyStatus: 'Occupied',
    currentPatient: 'Naseem Akhtar (MRN-2026-0855)',
    status: 'Active',
  },
  {
    id: 'BED-09',
    bedNumber: 'BED-DAY-03',
    room: 'Observation Room 1',
    ward: 'Daycare & Observation',
    department: 'Emergency & Trauma',
    bedType: 'Day Care Bay',
    ratePerDay: 3000,
    occupancyStatus: 'Available',
    currentPatient: 'Vacant',
    status: 'Active',
  },
];

export interface RoomRecord {
  id: string;
  roomNumber: string;
  ward: string;
  category: 'VIP Suite' | 'Deluxe Private' | 'Semi-Private' | 'General Bay';
  totalBeds: number;
  dailyRate: number; // PKR
  airConditioned: boolean;
  status: 'Active' | 'Maintenance';
}

export const MOCK_ROOMS: RoomRecord[] = [
  { id: 'RM-201', roomNumber: 'Room 201', ward: 'Executive Private Ward', category: 'VIP Suite', totalBeds: 1, dailyRate: 12000, airConditioned: true, status: 'Active' },
  { id: 'RM-204', roomNumber: 'Room 204', ward: 'Executive Private Ward', category: 'Deluxe Private', totalBeds: 1, dailyRate: 8500, airConditioned: true, status: 'Active' },
  { id: 'RM-ICU-A', roomNumber: 'ICU Bay A', ward: 'Critical Care Unit', category: 'VIP Suite', totalBeds: 6, dailyRate: 15000, airConditioned: true, status: 'Active' },
  { id: 'RM-GEN-M1', roomNumber: 'Male Surgical 1', ward: 'General Surgical Ward', category: 'General Bay', totalBeds: 12, dailyRate: 2500, airConditioned: true, status: 'Active' },
  { id: 'RM-GEN-F1', roomNumber: 'Female Medical 1', ward: 'General Medical Ward', category: 'General Bay', totalBeds: 12, dailyRate: 2500, airConditioned: true, status: 'Active' },
];

export interface WardRecord {
  id: string;
  code: string;
  name: string;
  floor: string;
  totalBeds: number;
  occupiedBeds: number;
  inchargeNurse: string;
  dailyCharge: number; // PKR
  status: 'Active' | 'Full';
}

export const MOCK_WARDS: WardRecord[] = [
  { id: 'WD-01', code: 'WD-CCU', name: 'Critical Care Unit (ICU / CCU)', floor: '1st Floor, Wing A', totalBeds: 24, occupiedBeds: 20, inchargeNurse: 'Sister Rehana Kausar', dailyCharge: 15000, status: 'Active' },
  { id: 'WD-02', code: 'WD-PVT', name: 'Executive Private Ward', floor: '3rd Floor, Executive Wing', totalBeds: 36, occupiedBeds: 28, inchargeNurse: 'Sister Maria John', dailyCharge: 8500, status: 'Active' },
  { id: 'WD-03', code: 'WD-SUR-M', name: 'Male General Surgical Ward', floor: '2nd Floor, Wing B', totalBeds: 40, occupiedBeds: 34, inchargeNurse: 'Staff Nurse Asim', dailyCharge: 2500, status: 'Active' },
  { id: 'WD-04', code: 'WD-MED-F', name: 'Female General Medical Ward', floor: '2nd Floor, Wing C', totalBeds: 40, occupiedBeds: 31, inchargeNurse: 'Sister Saira Bano', dailyCharge: 2500, status: 'Active' },
  { id: 'WD-05', code: 'WD-PED', name: 'Pediatrics & NICU Ward', floor: '1st Floor, Wing B', totalBeds: 30, occupiedBeds: 22, inchargeNurse: 'Sister Parveen Bibi', dailyCharge: 5000, status: 'Active' },
];

// Admin users schema & data
export interface AdminUserRecord {
  id: string;
  name: string;
  username: string;
  phone: string;
  email: string;
  role: 'Super Admin' | 'Hospital Administrator' | 'Director Operations' | 'Clinical Director';
  status: 'Active' | 'Inactive';
  lastLogin: string;
  createdDate: string;
  isSuperAdminProtected: boolean;
}

export const MOCK_ADMIN_USERS: AdminUserRecord[] = [
  {
    id: 'USR-ADM-001',
    name: 'Prof. Dr. Tariq Saeed',
    username: 'superadmin',
    phone: '0300 1234567',
    email: 'superadmin@sharif-saeed.hospital',
    role: 'Super Admin',
    status: 'Active',
    lastLogin: 'Today, 08:30 AM',
    createdDate: '01 Jan 2024',
    isSuperAdminProtected: true, // CANNOT BE DELETED OR DEACTIVATED
  },
  {
    id: 'USR-ADM-002',
    name: 'Dr. Farhana Yasmeen',
    username: 'admin',
    phone: '0321 9876543',
    email: 'farhana.yasmeen@sharif-saeed.hospital',
    role: 'Hospital Administrator',
    status: 'Active',
    lastLogin: 'Today, 08:10 AM',
    createdDate: '15 Jan 2024',
    isSuperAdminProtected: false,
  },
  {
    id: 'USR-ADM-003',
    name: 'Engr. Bilal Ahmed',
    username: 'bilal.operations',
    phone: '0333 5551234',
    email: 'bilal.ahmed@sharif-saeed.hospital',
    role: 'Director Operations',
    status: 'Active',
    lastLogin: 'Yesterday, 04:45 PM',
    createdDate: '01 Feb 2024',
    isSuperAdminProtected: false,
  },
  {
    id: 'USR-ADM-004',
    name: 'Dr. M. Sharif Chaudhary',
    username: 'sharif.clinical',
    phone: '0300 8887654',
    email: 'sharif.chaudhary@sharif-saeed.hospital',
    role: 'Clinical Director',
    status: 'Active',
    lastLogin: 'Yesterday, 02:30 PM',
    createdDate: '01 Jan 2024',
    isSuperAdminProtected: false,
  },
];

// Staff users schema & data
export interface StaffUserRecord {
  id: string;
  staffId: string;
  name: string;
  username: string;
  department: string;
  designation: string;
  phone: string;
  assignedPortal: 'Front Desk' | 'Pharmacy' | 'Admission' | 'Inventory';
  shift: 'Morning (08:00 - 16:00)' | 'Evening (16:00 - 00:00)' | 'Night (00:00 - 08:00)';
  status: 'Active' | 'On Leave' | 'Suspended';
}

export const MOCK_STAFF_USERS: StaffUserRecord[] = [
  {
    id: 'STF-01',
    staffId: 'STF-2026-081',
    name: 'Fatima Noor',
    username: 'billing',
    department: 'Front Desk & Billing Cashiering',
    designation: 'Senior Billing Officer',
    phone: '0333 4567890',
    assignedPortal: 'Front Desk',
    shift: 'Morning (08:00 - 16:00)',
    status: 'Active',
  },
  {
    id: 'STF-02',
    staffId: 'STF-2026-045',
    name: 'Usman Ali',
    username: 'inventory',
    department: 'Central Store & Goods Inward',
    designation: 'Store Manager',
    phone: '0322 7654321',
    assignedPortal: 'Inventory',
    shift: 'Morning (08:00 - 16:00)',
    status: 'Active',
  },
  {
    id: 'STF-03',
    staffId: 'STF-2026-092',
    name: 'Zainab Bibi',
    username: 'admission',
    department: 'Inpatient Admissions & Bed Allocation',
    designation: 'Admission Officer',
    phone: '0345 1122334',
    assignedPortal: 'Admission',
    shift: 'Morning (08:00 - 16:00)',
    status: 'Active',
  },
  {
    id: 'STF-04',
    staffId: 'STF-2026-014',
    name: 'Dr. Hamza Rafique',
    username: 'pharmacy',
    department: 'Hospital Central Dispensary',
    designation: 'Chief Pharmacist',
    phone: '0313 9988776',
    assignedPortal: 'Pharmacy',
    shift: 'Morning (08:00 - 16:00)',
    status: 'Active',
  },
  {
    id: 'STF-05',
    staffId: 'STF-2026-118',
    name: 'Asim Mehmood',
    username: 'asim.billing',
    department: 'Front Desk & Counter 2',
    designation: 'Counter Cashier',
    phone: '0301 4433221',
    assignedPortal: 'Front Desk',
    shift: 'Evening (16:00 - 00:00)',
    status: 'Active',
  },
  {
    id: 'STF-06',
    staffId: 'STF-2026-073',
    name: 'Saira Bano',
    username: 'saira.pharmacy',
    department: 'OPD Dispensary Counter B',
    designation: 'Staff Pharmacist',
    phone: '0321 6655443',
    assignedPortal: 'Pharmacy',
    shift: 'Night (00:00 - 08:00)',
    status: 'Active',
  },
];

// Roles & permissions schema & data
export interface RoleRecord {
  id: string;
  roleCode: string;
  roleName: string;
  assignedPortal: string;
  activeUsersCount: number;
  securityTier: 'Tier 0 - Root' | 'Tier 1 - Executive' | 'Tier 2 - Departmental' | 'Tier 3 - Counter';
  permissions: string[];
  lastUpdatedBy: string;
}

export const MOCK_ROLES: RoleRecord[] = [
  {
    id: 'ROL-01',
    roleCode: 'ROL-ROOT-00',
    roleName: 'Super Administrator',
    assignedPortal: 'All Portals (Root)',
    activeUsersCount: 1,
    securityTier: 'Tier 0 - Root',
    permissions: ['Master System Config', 'Rate Changes', 'User Management', 'Financial Governance', 'Audit Traces'],
    lastUpdatedBy: 'System Bootstrap',
  },
  {
    id: 'ROL-02',
    roleCode: 'ROL-ADM-01',
    roleName: 'Hospital Administrator',
    assignedPortal: 'Admin & Operations',
    activeUsersCount: 3,
    securityTier: 'Tier 1 - Executive',
    permissions: ['Doctor Scheduling', 'Clinical Protocols', 'Department Management', 'Reports'],
    lastUpdatedBy: 'Prof. Dr. Tariq Saeed',
  },
  {
    id: 'ROL-03',
    roleCode: 'ROL-BILL-02',
    roleName: 'Cashier & Billing Officer',
    assignedPortal: 'Front Desk',
    activeUsersCount: 8,
    securityTier: 'Tier 3 - Counter',
    permissions: ['OPD Registration', 'Invoice Generation', 'Cash Collections', 'POS Slips'],
    lastUpdatedBy: 'Prof. Dr. Tariq Saeed',
  },
  {
    id: 'ROL-04',
    roleCode: 'ROL-PHARM-03',
    roleName: 'Pharmacist & Dispenser',
    assignedPortal: 'Pharmacy',
    activeUsersCount: 6,
    securityTier: 'Tier 2 - Departmental',
    permissions: ['Prescription Dispensing', 'Batch Tracking', 'Drug Inventory POS', 'Returns'],
    lastUpdatedBy: 'Dr. Farhana Yasmeen',
  },
  {
    id: 'ROL-05',
    roleCode: 'ROL-ADMIT-04',
    roleName: 'Inpatient Admission Officer',
    assignedPortal: 'Admission',
    activeUsersCount: 4,
    securityTier: 'Tier 2 - Departmental',
    permissions: ['Bed Allocation', 'Inpatient Census', 'Advance Deposit', 'Discharge Slips'],
    lastUpdatedBy: 'Dr. Farhana Yasmeen',
  },
  {
    id: 'ROL-06',
    roleCode: 'ROL-INV-05',
    roleName: 'Store & Procurement Manager',
    assignedPortal: 'Inventory',
    activeUsersCount: 3,
    securityTier: 'Tier 2 - Departmental',
    permissions: ['Purchase Orders', 'GRN Inward', 'Stock Reorder', 'Department Transfers'],
    lastUpdatedBy: 'Engr. Bilal Ahmed',
  },
];

// Login activity schema & data
export interface LoginActivityRecord {
  id: string;
  sessionId: string;
  staffName: string;
  role: string;
  portalAccessed: string;
  ipAddress: string;
  device: string;
  loginTime: string;
  duration: string;
  status: 'Successful' | 'Failed Password' | 'Denied Portal';
}

export const MOCK_LOGIN_ACTIVITY: LoginActivityRecord[] = [
  {
    id: 'LOG-01',
    sessionId: 'SES-99214',
    staffName: 'Prof. Dr. Tariq Saeed',
    role: 'Super Admin',
    portalAccessed: 'Super Admin Portal',
    ipAddress: '192.168.10.45 (LAN Executive)',
    device: 'Chrome 122 / Windows 11 Enterprise',
    loginTime: `${CURRENT_OPERATIONAL_DATE}, 08:30:15 AM`,
    duration: 'Active (Current Session)',
    status: 'Successful',
  },
  {
    id: 'LOG-02',
    sessionId: 'SES-99213',
    staffName: 'Fatima Noor',
    role: 'Billing Officer',
    portalAccessed: 'Front Desk Portal',
    ipAddress: '192.168.10.12 (Counter 1)',
    device: 'Edge 121 / Windows 10 Workstation',
    loginTime: `${CURRENT_OPERATIONAL_DATE}, 08:00:22 AM`,
    duration: '32m 45s (Active)',
    status: 'Successful',
  },
  {
    id: 'LOG-03',
    sessionId: 'SES-99210',
    staffName: 'Usman Ali',
    role: 'Store Manager',
    portalAccessed: 'Inventory Portal',
    ipAddress: '192.168.10.88 (Central Store)',
    device: 'Chrome 122 / Windows 10 Workstation',
    loginTime: `${CURRENT_OPERATIONAL_DATE}, 08:05:10 AM`,
    duration: '27m 50s (Active)',
    status: 'Successful',
  },
  {
    id: 'LOG-04',
    sessionId: 'SES-99208',
    staffName: 'Zainab Bibi',
    role: 'Admission Officer',
    portalAccessed: 'Admission Portal',
    ipAddress: '192.168.10.34 (Admission Desk)',
    device: 'Firefox 123 / Windows 11',
    loginTime: `${CURRENT_OPERATIONAL_DATE}, 07:55:40 AM`,
    duration: '37m 20s (Active)',
    status: 'Successful',
  },
  {
    id: 'LOG-05',
    sessionId: 'SES-99201',
    staffName: 'Unknown Attempt (billing)',
    role: 'Unauthenticated',
    portalAccessed: 'Front Desk Portal',
    ipAddress: '192.168.10.14 (Counter 2)',
    device: 'Chrome 122 / Windows 10',
    loginTime: `${CURRENT_OPERATIONAL_DATE}, 07:50:11 AM`,
    duration: '0s (Terminated)',
    status: 'Failed Password',
  },
  {
    id: 'LOG-06',
    sessionId: 'SES-99195',
    staffName: 'Usman Ali',
    role: 'Store Manager',
    portalAccessed: 'Super Admin Portal',
    ipAddress: '192.168.10.88 (Central Store)',
    device: 'Chrome 122 / Windows 10',
    loginTime: `${CURRENT_OPERATIONAL_DATE}, 07:14:02 AM`,
    duration: '0s (Blocked by Guard)',
    status: 'Denied Portal',
  },
];

// Audit logs schema & data
export interface AuditLogRecord {
  id: string;
  auditId: string;
  timestamp: string;
  user: string;
  action: 'Rate Modified' | 'Discount Approved' | 'Bed Reassigned' | 'Patient Registered' | 'Privilege Escalated' | 'Refund Approved';
  module: string;
  recordId: string;
  ipAddress: string;
  details: string;
}

export const MOCK_AUDIT_LOGS: AuditLogRecord[] = [
  {
    id: 'AUD-01',
    auditId: 'AUD-2026-4401',
    timestamp: `${CURRENT_OPERATIONAL_DATE}, 08:42 AM`,
    user: 'Prof. Dr. Tariq Saeed (Super Admin)',
    action: 'Rate Modified',
    module: 'Services & Rates',
    recordId: 'SRV-CATH-004',
    ipAddress: '192.168.10.45',
    details: 'Standard tariff for Coronary Angiography updated from Rs. 40,000 to Rs. 45,000 following PMDC tariff index revision.',
  },
  {
    id: 'AUD-02',
    auditId: 'AUD-2026-4402',
    timestamp: `${CURRENT_OPERATIONAL_DATE}, 08:20 AM`,
    user: 'Dr. Farhana Yasmeen (Admin)',
    action: 'Discount Approved',
    module: 'Billing & Concessions',
    recordId: 'INV-2026-0819',
    ipAddress: '192.168.10.18',
    details: 'Approved 15% welfare concession (Rs. 4,500) for non-affording patient under Zakat Hospital Welfare Committee.',
  },
  {
    id: 'AUD-03',
    auditId: 'AUD-2026-4403',
    timestamp: `${CURRENT_OPERATIONAL_DATE}, 08:12 AM`,
    user: 'Zainab Bibi (Admission)',
    action: 'Bed Reassigned',
    module: 'Wards / Rooms / Beds',
    recordId: 'BED-ICU-04',
    ipAddress: '192.168.10.34',
    details: 'Transferred patient Shahnaz Begum (MRN-0791) from Emergency Bay 2 to ICU Ventilator Bed 4 per Dr. Tariq admitting order.',
  },
  {
    id: 'AUD-04',
    auditId: 'AUD-2026-4404',
    timestamp: `${CURRENT_OPERATIONAL_DATE}, 08:08 AM`,
    user: 'Fatima Noor (Front Desk)',
    action: 'Patient Registered',
    module: 'Patient Registry',
    recordId: 'MRN-2026-0842',
    ipAddress: '192.168.10.12',
    details: 'Issued new Master Patient Index file for Muhammad Tariq Khan affiliated with State Life Insurance Panel.',
  },
  {
    id: 'AUD-05',
    auditId: 'AUD-2026-4405',
    timestamp: `${CURRENT_OPERATIONAL_DATE}, 07:30 AM`,
    user: 'Prof. Dr. Tariq Saeed (Super Admin)',
    action: 'Refund Approved',
    module: 'Financial Control',
    recordId: 'REF-2026-012',
    ipAddress: '192.168.10.45',
    details: 'Approved billing refund of Rs. 3,500 for canceled ultrasound due to equipment calibration schedule.',
  },
];

// Corporate panels schema & data
export interface CorporatePanelRecord {
  id: string;
  code: string;
  name: string;
  category: 'Govt Health Insurance' | 'Private Insurance' | 'Armed Forces Welfare' | 'Corporate Enterprise';
  discountAgreement: string;
  creditLimit: number; // PKR
  activePatientsCount: number;
  focalPerson: string;
  status: 'Active' | 'Expired';
}

export const MOCK_CORPORATE_PANELS: CorporatePanelRecord[] = [
  {
    id: 'PNL-01',
    code: 'PNL-SLI',
    name: 'State Life Insurance Corporation (Sehat Card Plus)',
    category: 'Govt Health Insurance',
    discountAgreement: 'Pre-agreed Package Tariff - 15% Institutional Concession',
    creditLimit: 25000000,
    activePatientsCount: 42,
    focalPerson: 'Mr. Kamran Javed (0300 5551234)',
    status: 'Active',
  },
  {
    id: 'PNL-02',
    code: 'PNL-EFU',
    name: 'EFU Life Health Assurance',
    category: 'Private Insurance',
    discountAgreement: '20% Concession on Diagnostics & Labs, Standard Tariff on Rooms',
    creditLimit: 15000000,
    activePatientsCount: 18,
    focalPerson: 'Ms. Rubina Malik (0321 4443322)',
    status: 'Active',
  },
  {
    id: 'PNL-03',
    code: 'PNL-JUB',
    name: 'Jubilee Life Insurance Health Care',
    category: 'Private Insurance',
    discountAgreement: '15% Tariff Concession across All Inpatient Services',
    creditLimit: 12000000,
    activePatientsCount: 14,
    focalPerson: 'Dr. Noman Tariq (0333 7778899)',
    status: 'Active',
  },
  {
    id: 'PNL-04',
    code: 'PNL-FFO',
    name: 'Fauji Foundation Healthcare Directorate',
    category: 'Armed Forces Welfare',
    discountAgreement: 'Full Cashless Credit Billing per GHQ Schedule of Rates',
    creditLimit: 20000000,
    activePatientsCount: 29,
    focalPerson: 'Maj. (R) Khalid Mahmood (0301 9988112)',
    status: 'Active',
  },
  {
    id: 'PNL-05',
    code: 'PNL-OGD',
    name: 'Oil & Gas Development Company Ltd (OGDCL)',
    category: 'Corporate Enterprise',
    discountAgreement: '10% Discount on Pharmacy, Credit Billing with 30-Day Settlement',
    creditLimit: 10000000,
    activePatientsCount: 11,
    focalPerson: 'Engr. Shahbaz Akhtar (0345 8877665)',
    status: 'Active',
  },
];

// Panel patients schema & data
export interface PanelPatientRecord {
  id: string;
  mrn: string;
  name: string;
  corporatePanel: string;
  cardId: string;
  preAuthCode: string;
  entitlementLimit: number; // PKR
  availableCredit: number; // PKR
  status: 'Approved' | 'Under Review' | 'Cap Exhausted';
}

export const MOCK_PANEL_PATIENTS: PanelPatientRecord[] = [
  {
    id: 'PP-01',
    mrn: 'MRN-2026-0842',
    name: 'Muhammad Tariq Khan',
    corporatePanel: 'State Life Insurance Corporation',
    cardId: 'CNIC-35201-1234567-1',
    preAuthCode: 'AUTH-SLI-2026-0891',
    entitlementLimit: 500000,
    availableCredit: 385000,
    status: 'Approved',
  },
  {
    id: 'PP-02',
    mrn: 'MRN-2026-0791',
    name: 'Shahnaz Begum',
    corporatePanel: 'Jubilee Life Insurance',
    cardId: 'POL-JUB-44912',
    preAuthCode: 'AUTH-JUB-2026-0442',
    entitlementLimit: 350000,
    availableCredit: 210000,
    status: 'Approved',
  },
  {
    id: 'PP-03',
    mrn: 'MRN-2026-0812',
    name: 'Capt. (R) Imran Farooq',
    corporatePanel: 'Fauji Foundation Healthcare',
    cardId: 'FF-MIL-88129',
    preAuthCode: 'AUTH-FF-2026-0711',
    entitlementLimit: 1000000,
    availableCredit: 840000,
    status: 'Approved',
  },
  {
    id: 'PP-04',
    mrn: 'MRN-2026-0734',
    name: 'Abdul Rehman',
    corporatePanel: 'Oil & Gas Development Company',
    cardId: 'OGD-EMP-9918',
    preAuthCode: 'AUTH-OGD-2026-0112',
    entitlementLimit: 250000,
    availableCredit: 15000,
    status: 'Cap Exhausted',
  },
];
