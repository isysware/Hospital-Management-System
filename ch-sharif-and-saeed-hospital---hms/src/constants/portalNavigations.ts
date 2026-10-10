import { NavGroup, PortalConfig, PortalKey } from '../types';

export const PORTAL_CONFIGS: Record<PortalKey, PortalConfig> = {
  'super-admin': {
    id: 'super-admin',
    key: 'super-admin',
    name: 'Super Admin Portal',
    portalCode: 'SUPER ADMIN PORTAL',
    shortName: 'Super Admin',
    routePrefix: '/super-admin',
    defaultRoute: '/super-admin/dashboard',
    loginRoute: '/login/super-admin',
    role: 'Super Admin',
    description: 'Central hospital governance, security controls, financial auditing & user management',
    badgeBg: 'bg-slate-900 border-slate-700',
    badgeText: 'text-slate-100',
    accentColor: '#0f172a',
    allowedRoles: ['Super Admin'],
  },
  'admin': {
    id: 'admin',
    key: 'admin',
    name: 'Admin Portal',
    portalCode: 'ADMIN PORTAL',
    shortName: 'Admin',
    routePrefix: '/admin',
    defaultRoute: '/admin/dashboard',
    loginRoute: '/login/admin',
    role: 'Admin',
    description: 'Hospital operational management across doctors, services, inpatient wards & operational revenue',
    badgeBg: 'bg-[#effaf5] border-[#c2e7db]',
    badgeText: 'text-[#08775A]',
    accentColor: '#08775A',
    allowedRoles: ['Admin'],
  },
  'front-desk': {
    id: 'front-desk',
    key: 'front-desk',
    name: 'Front Desk & Billing Portal',
    portalCode: 'FRONT DESK & BILLING',
    shortName: 'Front Desk',
    routePrefix: '/front-desk',
    defaultRoute: '/front-desk/dashboard',
    loginRoute: '/login/front-desk',
    role: 'Front Desk & Billing',
    description: 'Patient reception, OPD registration tokens, billing cashiering & payments',
    badgeBg: 'bg-[#effaf5] border-[#c2e7db]',
    badgeText: 'text-[#08775A]',
    accentColor: '#149E75',
    allowedRoles: ['Billing Officer', 'Front Desk & Billing'],
  },
  'admission': {
    id: 'admission',
    key: 'admission',
    name: 'Admission Portal',
    portalCode: 'ADMISSION PORTAL',
    shortName: 'Admission',
    routePrefix: '/admission',
    defaultRoute: '/admission/dashboard',
    loginRoute: '/login/admission',
    role: 'Admission',
    description: 'Inpatient admission desk, ward bed allocations, doctor orders & IPD discharge clearance',
    badgeBg: 'bg-[#effaf5] border-[#c2e7db]',
    badgeText: 'text-[#08775A]',
    accentColor: '#0f766e',
    allowedRoles: ['Admission Officer', 'Admission'],
  },
  'inventory': {
    id: 'inventory',
    key: 'inventory',
    name: 'Inventory Management Portal',
    portalCode: 'INVENTORY MANAGEMENT',
    shortName: 'Inventory',
    routePrefix: '/inventory',
    defaultRoute: '/inventory/dashboard',
    loginRoute: '/login/inventory',
    role: 'Inventory Management',
    description: 'Central store, procurement GRN, stock movements & hospital general supply management',
    badgeBg: 'bg-amber-900 border-amber-700',
    badgeText: 'text-amber-100',
    accentColor: '#78350f',
    allowedRoles: ['Store Manager', 'Inventory Management'],
  },
};

// 1. CANONICAL HOSPITAL MANAGEMENT NAVIGATION (Shared between Super Admin and Admin)
export const CANONICAL_HOSPITAL_MANAGEMENT_NAV_GROUPS: NavGroup[] = [
  {
    id: 'hm_overview',
    title: 'OVERVIEW',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    ],
  },
  {
    id: 'hm_patient_management',
    title: 'PATIENT MANAGEMENT',
    items: [
      { id: 'patient_registry', label: 'Patient Registry', icon: 'UserCheck' },
    ],
  },
  {
    id: 'hm_hospital_management',
    title: 'HOSPITAL MANAGEMENT',
    items: [
      { id: 'hospital_overview', label: 'Hospital Overview', icon: 'Building2' },
      { id: 'departments', label: 'Departments', icon: 'Building' },
      { id: 'services_rates', label: 'Services & Rates', icon: 'Stethoscope' },
      { id: 'wards_rooms_beds', label: 'Wards / Rooms / Beds', icon: 'Bed' },
      { id: 'outsourced_providers', label: 'Outsourced Providers', icon: 'Truck' },
      { id: 'high_cost_medicine_policy', label: 'High-Cost Medicine Policy', icon: 'ShieldAlert' },
    ],
  },
  {
    id: 'hm_users_workforce',
    title: 'USERS & WORKFORCE',
    items: [
      { id: 'admin_users', label: 'Admin Users', icon: 'ShieldCheck' },
      { id: 'staff_users', label: 'Staff Users', icon: 'Users' },
      { id: 'shift_management', label: 'Shift Management', icon: 'Clock' },
      { id: 'attendance', label: 'Attendance', icon: 'CalendarCheck' },
    ],
  },
  {
    id: 'hm_payroll',
    title: 'PAYROLL',
    items: [
      { id: 'salary_payroll', label: 'Salary Payroll', icon: 'Wallet' },
      { id: 'doctor_commission', label: 'Doctor Commission', icon: 'Coins' },
    ],
  },
  {
    id: 'hm_panel_management',
    title: 'PANEL MANAGEMENT',
    items: [
      { id: 'corporate_panels', label: 'Corporate Panels', icon: 'Briefcase' },
      { id: 'panel_discounts', label: 'Panel Discounts', icon: 'Tag' },
      { id: 'panel_billing', label: 'Panel Billing', icon: 'Receipt' },
    ],
  },
  {
    id: 'hm_financial_control',
    title: 'FINANCIAL CONTROL',
    items: [
      { id: 'billing_overview', label: 'Billing Overview', icon: 'Receipt' },
      { id: 'collections', label: 'Collections', icon: 'CreditCard' },
      { id: 'discounts', label: 'Discounts', icon: 'BadgePercent' },
      { id: 'refunds', label: 'Refunds', icon: 'RotateCcw' },
      { id: 'outstanding_balances', label: 'Outstanding Balances', icon: 'AlertCircle' },
      { id: 'expenses', label: 'Expenses', icon: 'TrendingDown' },
      { id: 'main_cash_fund', label: 'Main Cash Fund', icon: 'Landmark' },
      { id: 'petty_cash_advances', label: 'Petty Cash Issuance', icon: 'Wallet' },
      { id: 'provider_settlements', label: 'Department Payables / Provider Settlements', icon: 'Landmark' },
      { id: 'balance_sheets', label: 'Balance Sheets', icon: 'FileSpreadsheet' },
      { id: 'account_settlements', label: 'Account Settlements', icon: 'CheckSquare' },
    ],
  },
  {
    id: 'hm_operations_overview',
    title: 'OPERATIONS OVERVIEW',
    items: [
      { id: 'appointments_operations_overview', label: 'Appointments / Operations Overview', icon: 'Activity' },
      { id: 'opd_overview', label: 'OPD Overview', icon: 'Stethoscope' },
      { id: 'observation_overview', label: 'Observation Overview', icon: 'Eye' },
      { id: 'emergency_overview', label: 'Emergency Overview', icon: 'AlertTriangle' },
      { id: 'admission_overview', label: 'Admission Overview', icon: 'Bed' },
      { id: 'inventory_overview', label: 'Inventory Overview', icon: 'Boxes' },
      { id: 'pharmacy_integration', label: 'Pharmacy Settlements', icon: 'Landmark' },
    ],
  },
  {
    // Super Admin_Admin Reporting.pdf — ONE management report menu, shared by
    // Admin and Super Admin. Front Desk / Admission operational reports are
    // NOT duplicated here; their data is reached through these 8 reports'
    // filters and row drill-down (reporting.md §8.3).
    id: 'hm_reports',
    title: 'REPORTS',
    items: [
      { id: 'sa_management_summary', label: 'Management Summary', icon: 'BarChart2' },
      { id: 'sa_billing_collection', label: 'Billing & Collection', icon: 'Receipt' },
      { id: 'sa_outstanding_panel', label: 'Outstanding / Panel', icon: 'AlertCircle' },
      { id: 'sa_admission_bed', label: 'Admission & Bed Summary', icon: 'Bed' },
      { id: 'sa_expense', label: 'Expense Report', icon: 'TrendingDown' },
      { id: 'sa_balance_settlements', label: 'Balance Sheet & Settlements', icon: 'FileSpreadsheet' },
      { id: 'sa_staff_payroll_commission', label: 'Staff / Payroll / Commission', icon: 'Users' },
      { id: 'sa_inventory_pharmacy', label: 'Inventory / Pharmacy Summary', icon: 'Boxes' },
    ],
  },
  {
    id: 'hm_logout_section',
    title: 'LOGOUT',
    items: [
      { id: 'logout', label: 'Logout', icon: 'LogOut' },
    ],
  },
];

export const SUPER_ADMIN_NAV_GROUPS: NavGroup[] = CANONICAL_HOSPITAL_MANAGEMENT_NAV_GROUPS;
export const ADMIN_NAV_GROUPS: NavGroup[] = CANONICAL_HOSPITAL_MANAGEMENT_NAV_GROUPS;

// 3. FRONT DESK & BILLING FINAL NAVIGATION
export const FRONT_DESK_NAV_GROUPS: NavGroup[] = [
  {
    id: 'fd_main',
    title: 'OVERVIEW',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    ],
  },
  {
    id: 'fd_patient_flow',
    title: 'PATIENT FLOW',
    items: [
      { id: 'new_admission', label: 'New Admission', icon: 'BedDouble' },
      { id: 'appointments', label: 'Appointments', icon: 'Clock' },
      { id: 'walk_in_intake', label: 'Walk-In / Encounter Intake', icon: 'Users' },
    ],
  },
  {
    id: 'fd_billing',
    title: 'BILLING',
    items: [
      { id: 'admission_patient_records', label: 'Admission Patient Records', icon: 'ClipboardList' },
      { id: 'discharged_patients', label: 'Discharged Patients', icon: 'UserCheck' },
      { id: 'hospital_invoices', label: 'Hospital Invoices', icon: 'FileSpreadsheet' },
      { id: 'billing_pending_discharges', label: 'Billing Pending Discharges', icon: 'ClipboardCheck' },
      { id: 'admission_payment_requests', label: 'Admission Payment Requests', icon: 'CreditCard' },
      { id: 'payments_receipts', label: 'Payments / Receipts', icon: 'Receipt' },
      { id: 'discounts', label: 'Discounts', icon: 'Tag' },
      { id: 'refunds', label: 'Refunds', icon: 'RotateCcw' },
      { id: 'outstanding_balances', label: 'Outstanding Balances', icon: 'AlertCircle' },
      { id: 'panel_billing', label: 'Panel Billing', icon: 'Building2' },
    ],
  },
  {
    id: 'fd_cash_control',
    title: 'CASH CONTROL',
    items: [
      { id: 'my_balance_sheet', label: 'My Balance Sheet', icon: 'Coins' },
      { id: 'my_account_settlement', label: 'My Account Settlement', icon: 'UserCheck' },
    ],
  },
  {
    id: 'fd_reports',
    title: 'REPORTS',
    items: [
      { id: 'front_desk_billing_reports', label: 'Daily Billing Summary', icon: 'BarChart2' },
      { id: 'fd_encounter_register', label: 'Encounter Register', icon: 'ClipboardList' },
      { id: 'fd_invoice_register', label: 'Invoice Register', icon: 'FileSpreadsheet' },
      { id: 'fd_collection_report', label: 'Collection & Receipt Report', icon: 'Wallet' },
      { id: 'fd_outstanding_invoices', label: 'Outstanding / Partial Invoices', icon: 'AlertCircle' },
      { id: 'fd_admission_payment_collections', label: 'Admission Payment Collections', icon: 'CreditCard' },
      { id: 'fd_discount_report', label: 'Discounts / Refunds / Voids', icon: 'Tag' },
    ],
  },
  {
    id: 'fd_logout_section',
    title: 'LOGOUT',
    items: [
      { id: 'logout', label: 'Logout', icon: 'LogOut' },
    ],
  },
];

// 4. ADMISSION FINAL NAVIGATION (NO cash collection, NO balance sheet, NO account settlement)
export const ADMISSION_NAV_GROUPS: NavGroup[] = [
  {
    id: 'adm_ipd_main',
    title: 'OVERVIEW',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    ],
  },
  {
    id: 'adm_admissions',
    title: 'ADMISSION',
    items: [
      { id: 'planned_admissions', label: 'Planned Admissions', icon: 'Clock' },
      { id: 'admission_check_in', label: 'Admission Check-In', icon: 'Bed' },
      { id: 'active_admissions', label: 'Active Admissions', icon: 'Users' },
      { id: 'bed_board_transfers', label: 'Bed Board / Transfers', icon: 'ArrowLeftRight' },
    ],
  },
  {
    id: 'adm_patient_stay',
    title: 'PATIENT STAY',
    items: [
      { id: 'hospital_services_procedures', label: 'Hospital Services / Procedures', icon: 'FileText' },
      { id: 'medication_fulfillment_mode', label: 'Medication Fulfillment Mode', icon: 'Layers' },
      { id: 'pharmacy_requests', label: 'Pharmacy Requests', icon: 'ClipboardList' },
      { id: 'hospital_payment_requests', label: 'Hospital Payment Requests', icon: 'CreditCard' },
    ],
  },
  {
    id: 'adm_discharge',
    title: 'DISCHARGE',
    items: [
      { id: 'discharge_clearances', label: 'Clearances', icon: 'ShieldCheck' },
      { id: 'final_discharge', label: 'Final Discharge', icon: 'CheckCircle2' },
      { id: 'discharged_patients', label: 'Discharged Patients', icon: 'UserCheck' },
    ],
  },
  {
    id: 'adm_reports',
    title: 'REPORTS',
    items: [
      { id: 'admission_reports', label: 'Admission Summary', icon: 'LineChart' },
      { id: 'adm_register_report', label: 'Admission Register', icon: 'ClipboardList' },
      { id: 'adm_census', label: 'Inpatient Census / Bed Report', icon: 'Bed' },
      { id: 'adm_transfer_los', label: 'Transfer / Length of Stay', icon: 'ArrowLeftRight' },
      { id: 'adm_outstanding_balance', label: 'Running Hospital Bill / Payment Status', icon: 'Receipt' },
      { id: 'adm_pharmacy_requests', label: 'Pharmacy Request & Fulfillment', icon: 'Pill' },
      { id: 'adm_discharge_clearance_report', label: 'Discharge Clearance Report', icon: 'ShieldCheck' },
    ],
  },
  {
    id: 'adm_logout_section',
    title: 'LOGOUT',
    items: [
      { id: 'logout', label: 'Logout', icon: 'LogOut' },
    ],
  },
];

// 5. INVENTORY MANAGEMENT FINAL NAVIGATION — inventory.md §2 "Final Sidebar /
// Navigation Structure": exactly 5 groups, 9 screens. Do NOT re-expand this
// into one sidebar item per transaction type (that was the pre-v-final
// structure this replaced) — related stock transactions live together in
// the Stock Movement Center (tabs), Category/Unit CRUD lives in modal/drawer
// actions off Stock Overview, not their own sidebar items.
export const INVENTORY_NAV_GROUPS: NavGroup[] = [
  {
    id: 'inv_main',
    title: 'OVERVIEW',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    ],
  },
  {
    id: 'inv_inventory',
    title: 'INVENTORY',
    items: [
      { id: 'stock_overview', label: 'Stock Overview', icon: 'Package' },
      { id: 'stock_in', label: 'Stock In / Purchase', icon: 'Truck' },
      { id: 'department_issue', label: 'Department Issue', icon: 'Layers' },
      { id: 'department_return', label: 'Department Return', icon: 'RotateCcw' },
      { id: 'supplier_return', label: 'Supplier Return', icon: 'CornerDownLeft' },
      { id: 'adjustment', label: 'Adjustment', icon: 'SlidersHorizontal' },
    ],
  },
  {
    id: 'inv_suppliers',
    title: 'SUPPLIERS',
    items: [
      { id: 'supplier_directory', label: 'Supplier Directory', icon: 'Building' },
      { id: 'supplier_ledger', label: 'Supplier Ledger', icon: 'Building2' },
    ],
  },
  {
    id: 'inv_cash_expenses',
    title: 'CASH & EXPENSES',
    items: [
      { id: 'petty_cash_expenses', label: 'Petty Cash & Expenses', icon: 'DollarSign' },
      { id: 'my_balance_sheet', label: 'My Balance Sheet', icon: 'Coins' },
      { id: 'my_account_settlement', label: 'My Account Settlement', icon: 'UserCheck' },
    ],
  },
  {
    id: 'inv_reports',
    title: 'REPORTS',
    items: [
      { id: 'inventory_summary', label: 'Inventory Summary', icon: 'FileBarChart' },
      { id: 'stock_movement_report', label: 'Stock Movement', icon: 'ArrowLeftRight' },
      { id: 'purchase_report', label: 'Purchase / Stock In', icon: 'Truck' },
      { id: 'department_issue_return_report', label: 'Department Issue & Return', icon: 'ClipboardList' },
      { id: 'supplier_report', label: 'Supplier Report', icon: 'Building2' },
      { id: 'expense_report', label: 'Expense Report', icon: 'Wallet' },
      { id: 'stock_status_report', label: 'Stock Status', icon: 'Layers' },
      { id: 'cash_settlement_report', label: 'Cash & Settlement', icon: 'Coins' },
    ],
  },
  {
    id: 'inv_logout_section',
    title: 'LOGOUT',
    items: [
      { id: 'logout', label: 'Logout', icon: 'LogOut' },
    ],
  },
];

// Preserved standalone pharmacy navigation (isolated for future standalone pharmacy project)
export const PHARMACY_NAV_GROUPS: NavGroup[] = [
  {
    id: 'ph_main',
    title: 'OVERVIEW',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    ],
  },
  {
    id: 'ph_sales',
    title: 'SALES',
    items: [
      { id: 'new_pharmacy_sale', label: 'New Pharmacy Sale', icon: 'ShoppingCart' },
      { id: 'sales_history', label: 'Sales History', icon: 'Clock' },
      { id: 'pharmacy_invoices', label: 'Pharmacy Invoices', icon: 'Receipt' },
      { id: 'returns', label: 'Returns', icon: 'CornerDownLeft' },
    ],
  },
  {
    id: 'ph_patient_medicines',
    title: 'PATIENT MEDICINES',
    items: [
      { id: 'prescription_requests', label: 'Prescription Requests', icon: 'Pill' },
      { id: 'inpatient_medicine_requests', label: 'Inpatient Medicine Requests', icon: 'Bed' },
      { id: 'pending_requests', label: 'Pending Requests', icon: 'ClipboardList' },
      { id: 'approved_requests', label: 'Approved Requests', icon: 'CheckCircle2' },
      { id: 'dispensed_medicines', label: 'Dispensed Medicines', icon: 'Check' },
    ],
  },
  {
    id: 'ph_reports',
    title: 'REPORTS',
    items: [
      { id: 'daily_sales', label: 'Daily Sales', icon: 'Coins' },
      { id: 'user_wise_sales', label: 'User-wise Sales', icon: 'Users' },
      { id: 'medicine_sales', label: 'Medicine Sales', icon: 'BarChart' },
      { id: 'patient_medicine_report', label: 'Patient Medicine Report', icon: 'FileText' },
      { id: 'returns_report', label: 'Returns Report', icon: 'RotateCcw' },
      { id: 'expiry_report', label: 'Expiry Report', icon: 'CalendarX' },
      { id: 'stock_report', label: 'Stock Report', icon: 'FileSpreadsheet' },
    ],
  },
];

// Helper to look up nav groups by portal key (EXACTLY 5 HMS PORTALS)
export const PORTAL_NAVIGATION_MAP: Record<PortalKey, NavGroup[]> = {
  'super-admin': SUPER_ADMIN_NAV_GROUPS,
  'admin': ADMIN_NAV_GROUPS,
  'front-desk': FRONT_DESK_NAV_GROUPS,
  'admission': ADMISSION_NAV_GROUPS,
  'inventory': INVENTORY_NAV_GROUPS,
};
