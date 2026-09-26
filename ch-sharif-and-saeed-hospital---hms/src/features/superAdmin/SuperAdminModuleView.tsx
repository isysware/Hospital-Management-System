import React, { useState, useMemo } from 'react';
import {
  Building2,
  Stethoscope,
  Bed,
  UserCheck,
  Users,
  Shield,
  Clock,
  FileSpreadsheet,
  Building,
  CreditCard,
  Percent,
  Receipt,
  Search,
  Plus,
  Edit2,
  Trash2,
  Eye,
  Lock,
  CheckCircle2,
  AlertTriangle,
  FileText,
  DollarSign,
  Activity,
  Layers,
  Settings,
  HelpCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatPKR } from '../../utils/formatters';
import { Modal } from '../../components/common/Modal';
import { ConfirmModal } from '../../components/common/ConfirmModal';
import { TextInput, NumberInput, Select } from '../../components/forms/FormControls';
import { ImportExcelModal } from '../../components/tables/ImportExcelModal';
import { ExportMenu } from '../../components/tables/ExportMenu';
import { SuperAdminHospitalOverview } from './SuperAdminHospitalOverview';
import { SuperAdminDepartmentsView } from './departments/SuperAdminDepartmentsView';
import { SuperAdminServicesRatesView } from './servicesRates/SuperAdminServicesRatesView';
import { SuperAdminWardsRoomsBedsView } from './wardsRoomsBeds/SuperAdminWardsRoomsBedsView';
import { SuperAdminAdminUsersView } from './adminUsers/SuperAdminAdminUsersView';
import { SuperAdminStaffUsersView } from './staffUsers/SuperAdminStaffUsersView';
import { ShiftManagementView } from './shifts/ShiftManagementView';
import { SuperAdminAttendanceView } from './attendance/SuperAdminAttendanceView';
import { SuperAdminPayrollView } from './payroll/SuperAdminPayrollView';
import { SuperAdminReportsView } from './SuperAdminReportsView';
import { PatientRegistryView } from './patientRegistry/PatientRegistryView';
import { SuperAdminCorporatePanelsView } from './corporatePanels/SuperAdminCorporatePanelsView';
import { SuperAdminOutsourcedProvidersView } from './outsourcedProviders/SuperAdminOutsourcedProvidersView';
import { HighCostMedicinePolicyView } from './highCostMedicine/HighCostMedicinePolicyView';
import { ProviderSettlementsView } from './providerSettlements/ProviderSettlementsView';
import { DoctorCommissionView } from './doctorCommission/DoctorCommissionView';
import { HospitalInvoicesView } from '../frontDesk/billing/HospitalInvoicesView';
import { SuperAdminPanelBillingView } from './corporatePanels/SuperAdminPanelBillingView';
import { AppointmentsView } from '../frontDesk/appointments/AppointmentsView';
import { ActiveAdmissionsView } from '../admission/ActiveAdmissionsView';
import { FinanceControlBalanceSheetsView } from './financeControl/FinanceControlBalanceSheetsView';
import { FinanceControlAccountSettlementsView } from './financeControl/FinanceControlAccountSettlementsView';
import { ReportModuleNotBuilt } from './reports/ReportModuleNotBuilt';
import { FrontDeskBillingReportsView } from '../frontDesk/reports/FrontDeskBillingReportsView';
import {
  EncounterRegisterView,
  InvoiceRegisterView,
  CollectionReportViewPage,
  OutstandingInvoicesView,
  FinancialExceptionsReportView,
  DepartmentRevenueReportView,
  AdmissionPaymentCollectionsView,
  PanelPayerReportView,
  ReceiptExceptionLogView,
  CashierPerformanceReportView,
} from '../frontDesk/reports/FrontDeskExtraReports';
import { AdmissionReportsView } from '../admission/AdmissionReportsView';
import {
  AdmissionDailySummaryView,
  AdmissionRegisterReportView,
  InpatientCensusReportView,
  BedOccupancyReportView,
  BedTransferHistoryReportView,
  LengthOfStayReportView,
  ServiceConsumptionReportView,
  InpatientOutstandingReportView,
  DischargeClearanceReportView,
} from '../admission/AdmissionExtraReports';
import {
  PharmacyMedicineRequestsView,
  MedicineFulfillmentReportView,
  HighValueApprovalReportView,
  PharmacyClearanceStatusView,
  AdmissionPaymentRequestStatusView,
} from '../admission/AdmissionPharmacyReports';
import {
  MOCK_DEPARTMENTS,
  DepartmentRecord,
  MOCK_SERVICES_RATES,
  ServiceRateRecord,
  MOCK_BEDS,
  BedRecord,
  MOCK_ROOMS,
  RoomRecord,
  MOCK_WARDS,
  WardRecord,
  MOCK_ADMIN_USERS,
  AdminUserRecord,
  MOCK_STAFF_USERS,
  StaffUserRecord,
  MOCK_CORPORATE_PANELS,
  CorporatePanelRecord,
  MOCK_PANEL_PATIENTS,
  PanelPatientRecord,
} from './superAdminData';

const LEGACY_MODULE_MAP: Record<string, string> = {
  // Hospital management
  services: 'services_rates',
  'services-rates': 'services_rates',
  wards_beds: 'wards_rooms_beds',
  'wards-beds': 'wards_rooms_beds',
  'wards-rooms-beds': 'wards_rooms_beds',
  wards: 'wards_rooms_beds',
  rooms: 'wards_rooms_beds',
  beds: 'wards_rooms_beds',
  doctor_profiles: 'staff_users',
  doctors_list: 'staff_users',
  lab_radiology: 'services_rates',
  expense_vouchers: 'expenses',
  supplier_management: 'inventory_overview',
  inpatient_clearance: 'admission_overview',

  // Workforce & Payroll
  'admin-users': 'admin_users',
  'staff-users': 'staff_users',
  operational_staff: 'staff_users',
  'operational-staff': 'staff_users',
  'shift-management': 'shift_management',
  shifts: 'shift_management',
  shift_roster: 'shift_management',
  staff_attendance: 'attendance',
  monthly_salary: 'salary_payroll',
  salary_advances: 'petty_cash_advances',

  // Panels
  panel_companies: 'corporate_panels',
  panel_tariffs: 'panel_discounts',
  // Patients
  patient_registries: 'patient_registry',
  'patient-registries': 'patient_registry',
  patient_registry: 'patient_registry',
  'patient-registry': 'patient_registry',
  'panel-patient-registry': 'patient_registry',
  panel_patient_registry: 'patient_registry',
  panel_patients: 'patient_registry',
  'panel-patients': 'patient_registry',
  today_patients: 'today_patients',
  todays_patients: 'today_patients',
  patient_reports: 'patient_panel_reports',

  // Financials
  accounts_daily_register: 'billing_overview',
  daily_closing_summary: 'account_settlements',
  revenue_reports: 'billing_reports',

  // Operations
  live_opd_queue: 'opd_overview',
  inpatient_ward_occupancy: 'admission_overview',
  central_inventory_live_stock: 'inventory_overview',
  pharmacy_reports: 'pharmacy_integration',

  // System
  hospital_configuration: 'general_settings',
  security_governance: 'general_settings',
  roles_permissions: 'general_settings',
  login_activity: 'general_settings',
  audit_logs: 'general_settings',
};

interface SuperAdminModuleViewProps {
  moduleId: string;
  moduleName: string;
  groupTitle: string;
}

export const SuperAdminModuleView: React.FC<SuperAdminModuleViewProps> = ({
  moduleId,
  moduleName,
  groupTitle,
}) => {
  const { currentUser, logout } = useAuth();
  const toast = useToast();

  const activeModuleId = LEGACY_MODULE_MAP[moduleId] || moduleId;

  if (activeModuleId === 'logout') {
    logout();
    return null;
  }

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('All');

  // Wards / Rooms / Beds sub-tab state
  const [activeBedTab, setActiveBedTab] = useState<'beds' | 'rooms' | 'wards'>('beds');

  // Datasets state (allows adds, edits, deletes in current session)
  const [departments, setDepartments] = useState<DepartmentRecord[]>(MOCK_DEPARTMENTS);
  const [services, setServices] = useState<ServiceRateRecord[]>(MOCK_SERVICES_RATES);
  const [beds, setBeds] = useState<BedRecord[]>(MOCK_BEDS);
  const [rooms, setRooms] = useState<RoomRecord[]>(MOCK_ROOMS);
  const [wards, setWards] = useState<WardRecord[]>(MOCK_WARDS);
  const [adminUsers, setAdminUsers] = useState<AdminUserRecord[]>(MOCK_ADMIN_USERS);
  const [staffUsers, setStaffUsers] = useState<StaffUserRecord[]>(MOCK_STAFF_USERS);
  const [panels, setPanels] = useState<CorporatePanelRecord[]>(MOCK_CORPORATE_PANELS);
  const [panelPatients, setPanelPatients] = useState<PanelPatientRecord[]>(MOCK_PANEL_PATIENTS);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<any | null>(null);

  // Form states for adding items
  const [deptForm, setDeptForm] = useState({ code: '', name: '', type: 'Clinical' as const, head: '', doctorsCount: 4, staffCount: 12 });
  const [serviceForm, setServiceForm] = useState({ code: '', name: '', department: 'Cardiology & Cath Lab', category: 'Consultation' as const, standardRate: 3500, panelEligible: true });
  const [bedForm, setBedForm] = useState({ bedNumber: '', room: '', ward: 'Critical Care Unit', department: 'Cardiology', bedType: 'General Ward' as const, ratePerDay: 3000 });
  const [adminForm, setAdminForm] = useState({ name: '', username: '', phone: '', email: '', role: 'Hospital Administrator' as const });
  const [staffForm, setStaffForm] = useState({ staffId: '', name: '', username: '', department: 'Front Desk & Billing', designation: 'Billing Officer', phone: '', assignedPortal: 'Front Desk' as const, shift: 'Morning (08:00 - 16:00)' as const });
  const [panelForm, setPanelForm] = useState({ code: '', name: '', category: 'Private Insurance' as const, discountAgreement: '15% Tariff Concession', creditLimit: 10000000, focalPerson: '' });

  // 1. Check if this is the Hospital Overview Page
  if (activeModuleId === 'hospital_overview') {
    return <SuperAdminHospitalOverview />;
  }

  // 1b. Check if this is the Departments Master Page
  if (activeModuleId === 'departments') {
    return <SuperAdminDepartmentsView />;
  }

  // 1c. Check if this is the Services & Rates Page
  if (activeModuleId === 'services_rates') {
    return <SuperAdminServicesRatesView />;
  }

  // 1d. Check if this is Wards / Rooms / Beds Page
  if (activeModuleId === 'wards_rooms_beds') {
    return <SuperAdminWardsRoomsBedsView initialTab="wards" />;
  }

  // 1e. Check if this is Admin Users Management Page
  if (activeModuleId === 'admin_users') {
    return <SuperAdminAdminUsersView />;
  }

  // 1f. Check if this is Staff Users Management Page
  if (activeModuleId === 'staff_users') {
    return <SuperAdminStaffUsersView />;
  }

  // 1f2. Check if this is Shift Management Page
  if (activeModuleId === 'shift_management') {
    return <ShiftManagementView />;
  }

  // 1f3. Check if this is the Attendance Page
  if (activeModuleId === 'attendance') {
    return <SuperAdminAttendanceView />;
  }

  // 1f4. Check if this is the Salary Payroll Page
  if (activeModuleId === 'salary_payroll') {
    return <SuperAdminPayrollView />;
  }

  // 1g. Check if this is Patient Registry Page
  if (
    activeModuleId === 'patient_registry' ||
    activeModuleId === 'panel_patient_registry' ||
    activeModuleId === 'today_patients'
  ) {
    return (
      <PatientRegistryView
        currentUser={currentUser}
        initialDateFilter={activeModuleId === 'today_patients' ? 'TODAY' : 'ALL'}
      />
    );
  }

  // 1h. Check if this is Corporate Panels Page
  if (activeModuleId === 'corporate_panels') {
    return <SuperAdminCorporatePanelsView />;
  }

  // 1i. v7.2 — Outsourced Providers (HMS_V7.2_NEW_REQUIREMENTS.md §2.1)
  if (activeModuleId === 'outsourced_providers') {
    return <SuperAdminOutsourcedProvidersView />;
  }

  // 1j. v7.2 — High-Cost Medicine Authorization Policy (§2.6)
  if (activeModuleId === 'high_cost_medicine_policy') {
    return <HighCostMedicinePolicyView />;
  }

  // 1k. v7.2 — Department Payables / Provider Settlements (§2.8)
  if (activeModuleId === 'provider_settlements') {
    return <ProviderSettlementsView />;
  }

  // 1l. v7.2 — Doctor Commission (§2.7)
  if (activeModuleId === 'doctor_commission') {
    return <DoctorCommissionView />;
  }

  // 1m. OPERATIONS OVERVIEW — every one of these is the live Front
  // Desk/Admission ledger, not a mock page: whatever amount a Front Desk or
  // Admission user enters for an Appointment, OPD/Observation/Emergency
  // encounter, or Admission flows straight into these same
  // `HospitalInvoice` / `Appointment` / `AdmissionRecord` tables, so Super
  // Admin (and Admin, which shares this nav) sees it here in real time.
  if (activeModuleId === 'appointments_operations_overview') {
    return <AppointmentsView />;
  }

  if (activeModuleId === 'opd_overview') {
    return (
      <HospitalInvoicesView
        initialQueueFilter="OPD"
        title="OPD Overview"
        subtitle="Every OPD encounter billed by Front Desk — live invoice amounts, payment status, and collections."
      />
    );
  }

  if (activeModuleId === 'observation_overview') {
    return (
      <HospitalInvoicesView
        initialQueueFilter="OBS"
        title="Observation Overview"
        subtitle="Every Observation-bed encounter billed by Front Desk — live invoice amounts, payment status, and collections."
      />
    );
  }

  if (activeModuleId === 'emergency_overview') {
    return (
      <HospitalInvoicesView
        initialQueueFilter="ER"
        title="Emergency Overview"
        subtitle="Every Emergency encounter billed by Front Desk — live invoice amounts, payment status, and collections."
      />
    );
  }

  if (activeModuleId === 'admission_overview') {
    return (
      <ActiveAdmissionsView
        title="Admission Overview"
        subtitle="Every admission entered at Front Desk/Admission — planned, active, and discharged — with live billed amounts."
        statusFilter="ALL"
        showAmountColumn
      />
    );
  }

  // 1n. FINANCIAL CONTROL — Live hospital billing, collections, discounts, refunds, and panel billing
  if (activeModuleId === 'billing_overview' || activeModuleId === 'hospital_invoices') {
    return (
      <HospitalInvoicesView
        title="Hospital Billing Overview"
        subtitle="Consolidated hospital billing operations across OPD, Emergency, Inpatient Admissions, and Diagnostics."
      />
    );
  }

  if (activeModuleId === 'collections' || activeModuleId === 'payments_receipts') {
    return (
      <HospitalInvoicesView
        recordFilter="PAID"
        title="Collections & Payment Receipts"
        subtitle="Every invoice with collected payments across Cash, Credit Card, and Bank deposits."
      />
    );
  }

  if (activeModuleId === 'discounts') {
    return (
      <HospitalInvoicesView
        recordFilter="DISCOUNTED"
        title="Discounts & Concessions"
        subtitle="Every invoice where policy-based or administrative discounts have been applied."
      />
    );
  }

  if (activeModuleId === 'refunds') {
    return (
      <HospitalInvoicesView
        recordFilter="REFUNDED"
        title="Refunds & Reversals"
        subtitle="Invoices with processed cash and payment refunds."
      />
    );
  }

  if (activeModuleId === 'outstanding_balances') {
    return (
      <HospitalInvoicesView
        outstandingOnly
        title="Outstanding Balances"
        subtitle="Every invoice with a pending balance due across self-pay and panel patients."
      />
    );
  }

  if (activeModuleId === 'panel_billing') {
    return <SuperAdminPanelBillingView />;
  }

  // 1n2. Finance Control — Balance Sheet & Account Settlement Guide §6.
  // Real oversight over `AccountSettlement`/`UserCashBalance`, replacing the
  // generic mock-table fallback these two module IDs used to fall through to.
  if (activeModuleId === 'balance_sheets' || activeModuleId === 'my_balance_sheet' || activeModuleId === 'balance_sheet') {
    return <FinanceControlBalanceSheetsView />;
  }

  if (activeModuleId === 'account_settlements' || activeModuleId === 'my_account_settlement' || activeModuleId === 'accounts_settlement') {
    return <FinanceControlAccountSettlementsView />;
  }

  // 1n3. Reporting Guide v7.5 — Front Desk/Billing and Admission each own a
  // full real, live report catalog (built this session, see `reporting.md`).
  // Super Admin/Admin's REPORTING nav now lists every one of those reports
  // as its own page — same moduleIds, same components, same left-nav
  // pattern those portals use for themselves — instead of bundling them
  // behind a single tab-switcher page (which read as a second portal's UI
  // pasted inside Super Admin) or `SuperAdminReportsView`'s hardcoded rows.
  if (activeModuleId === 'billing_reports' || activeModuleId === 'front_desk_billing_reports') {
    return <FrontDeskBillingReportsView />;
  }
  if (activeModuleId === 'fd_encounter_register') return <EncounterRegisterView />;
  if (activeModuleId === 'fd_invoice_register') return <InvoiceRegisterView />;
  if (activeModuleId === 'fd_collection_report' || activeModuleId === 'collection_reports') return <CollectionReportViewPage />;
  if (activeModuleId === 'fd_outstanding_invoices') return <OutstandingInvoicesView />;
  if (activeModuleId === 'fd_discount_report') return <FinancialExceptionsReportView />;
  if (activeModuleId === 'fd_refund_void_report') return <FinancialExceptionsReportView />;
  if (activeModuleId === 'fd_department_revenue') return <DepartmentRevenueReportView />;
  if (activeModuleId === 'fd_admission_payment_collections') return <AdmissionPaymentCollectionsView />;
  if (activeModuleId === 'fd_panel_payer' || activeModuleId === 'patient_panel_reports') return <PanelPayerReportView />;
  if (activeModuleId === 'fd_receipt_exceptions') return <ReceiptExceptionLogView />;
  if (activeModuleId === 'fd_cashier_performance') return <CashierPerformanceReportView />;

  if (activeModuleId === 'admission_reports') return <AdmissionReportsView />;
  if (activeModuleId === 'adm_daily_summary') return <AdmissionDailySummaryView />;
  if (activeModuleId === 'adm_register_report') return <AdmissionRegisterReportView />;
  if (activeModuleId === 'adm_census') return <InpatientCensusReportView />;
  if (activeModuleId === 'adm_bed_occupancy') return <BedOccupancyReportView />;
  if (activeModuleId === 'adm_bed_transfers') return <BedTransferHistoryReportView />;
  if (activeModuleId === 'adm_length_of_stay') return <LengthOfStayReportView />;
  if (activeModuleId === 'adm_service_consumption') return <ServiceConsumptionReportView />;
  if (activeModuleId === 'adm_outstanding_balance') return <InpatientOutstandingReportView />;
  if (activeModuleId === 'adm_discharge_clearance_report') return <DischargeClearanceReportView />;
  if (activeModuleId === 'adm_payment_request_status') return <AdmissionPaymentRequestStatusView />;
  if (activeModuleId === 'adm_pharmacy_requests') return <PharmacyMedicineRequestsView />;
  if (activeModuleId === 'adm_medicine_fulfillment') return <MedicineFulfillmentReportView />;
  if (activeModuleId === 'adm_high_value_approvals') return <HighValueApprovalReportView />;
  if (activeModuleId === 'adm_pharmacy_clearance_status') return <PharmacyClearanceStatusView />;

  // 2. Check if this is a Report Page (Global Reporting Standard)
  // `management_reports` (KPI benchmarks) is out of scope for the v7.5
  // reporting guide — separate analytics workstream, left untouched.
  if (activeModuleId === 'management_reports') {
    return (
      <SuperAdminReportsView
        reportType={activeModuleId}
        reportTitle={moduleName}
      />
    );
  }

  // `inventory_reports`/`staff_reports`/`attendance_reports`/
  // `salary_reports`/`commission_reports` are HR/Payroll/Inventory
  // domains — explicitly out of scope for the v7.5 guide, and none has a
  // real backend yet. Show an honest "not built" state rather than
  // `SuperAdminReportsView`'s fabricated rows (reporting.md Step 1).
  if (
    activeModuleId === 'inventory_reports' ||
    activeModuleId === 'staff_reports' ||
    activeModuleId === 'attendance_reports' ||
    activeModuleId === 'salary_reports' ||
    activeModuleId === 'commission_reports'
  ) {
    return <ReportModuleNotBuilt moduleName={moduleName} />;
  }

  // Handlers for Adding Records
  const handleAddDepartment = (e: React.FormEvent) => {
    e.preventDefault();
    const newDept: DepartmentRecord = {
      id: `DEP-${departments.length + 1}`,
      code: deptForm.code.toUpperCase(),
      name: deptForm.name,
      type: deptForm.type,
      head: deptForm.head,
      doctorsCount: Number(deptForm.doctorsCount),
      staffCount: Number(deptForm.staffCount),
      status: 'Active',
      createdDate: 'Today',
    };
    setDepartments([newDept, ...departments]);
    setIsAddModalOpen(false);
    toast.success(`Department "${newDept.name}" created successfully.`, 'Department Added');
  };

  const handleAddService = (e: React.FormEvent) => {
    e.preventDefault();
    const newService: ServiceRateRecord = {
      id: `SRV-${services.length + 1}`,
      code: serviceForm.code.toUpperCase(),
      name: serviceForm.name,
      department: serviceForm.department,
      category: serviceForm.category,
      standardRate: Number(serviceForm.standardRate),
      panelEligible: serviceForm.panelEligible,
      status: 'Active',
      updatedBy: currentUser?.name || 'Prof. Dr. Tariq Saeed',
      updatedDate: '07 Sep 2026',
    };
    setServices([newService, ...services]);
    setIsAddModalOpen(false);
    toast.success(`Service "${newService.name}" tariff registered at ${formatPKR(newService.standardRate)}.`, 'Service Registered');
  };

  const handleAddBed = (e: React.FormEvent) => {
    e.preventDefault();
    const newBed: BedRecord = {
      id: `BED-${beds.length + 1}`,
      bedNumber: bedForm.bedNumber.toUpperCase(),
      room: bedForm.room,
      ward: bedForm.ward,
      department: bedForm.department,
      bedType: bedForm.bedType,
      ratePerDay: Number(bedForm.ratePerDay),
      occupancyStatus: 'Available',
      currentPatient: 'Vacant',
      status: 'Active',
    };
    setBeds([newBed, ...beds]);
    setIsAddModalOpen(false);
    toast.success(`Bed "${newBed.bedNumber}" configured and available for allocation.`, 'Bed Added');
  };

  const handleAddAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    const newAdmin: AdminUserRecord = {
      id: `USR-ADM-00${adminUsers.length + 1}`,
      name: adminForm.name,
      username: adminForm.username.toLowerCase(),
      phone: adminForm.phone,
      email: adminForm.email,
      role: adminForm.role,
      status: 'Active',
      lastLogin: 'Never',
      createdDate: 'Today',
      isSuperAdminProtected: false,
    };
    setAdminUsers([newAdmin, ...adminUsers]);
    setIsAddModalOpen(false);
    toast.success(`Administrator "${newAdmin.name}" provisioned with role ${newAdmin.role}.`, 'Admin Created');
  };

  const handleAddStaff = (e: React.FormEvent) => {
    e.preventDefault();
    const newStaff: StaffUserRecord = {
      id: `STF-0${staffUsers.length + 1}`,
      staffId: staffForm.staffId || `STF-2026-0${staffUsers.length + 10}`,
      name: staffForm.name,
      username: staffForm.username.toLowerCase(),
      department: staffForm.department,
      designation: staffForm.designation,
      phone: staffForm.phone,
      assignedPortal: staffForm.assignedPortal,
      shift: staffForm.shift,
      status: 'Active',
    };
    setStaffUsers([newStaff, ...staffUsers]);
    setIsAddModalOpen(false);
    toast.success(`Staff user "${newStaff.name}" assigned to ${newStaff.assignedPortal} portal.`, 'Staff User Created');
  };

  const handleAddPanel = (e: React.FormEvent) => {
    e.preventDefault();
    const newPanel: CorporatePanelRecord = {
      id: `PNL-0${panels.length + 1}`,
      code: panelForm.code.toUpperCase(),
      name: panelForm.name,
      category: panelForm.category,
      discountAgreement: panelForm.discountAgreement,
      creditLimit: Number(panelForm.creditLimit),
      activePatientsCount: 0,
      focalPerson: panelForm.focalPerson,
      status: 'Active',
    };
    setPanels([newPanel, ...panels]);
    setIsAddModalOpen(false);
    toast.success(`Corporate Panel "${newPanel.name}" registered successfully.`, 'Panel Added');
  };

  // Safe Deletion Handler (Protects root Super Admin)
  const handleDeleteConfirm = () => {
    if (!recordToDelete) return;

    if (moduleId === 'admin_users') {
      if (recordToDelete.isSuperAdminProtected) {
        toast.error('Security Restriction: Root Super Admin account cannot be deleted or deactivated.', 'Action Denied');
        setIsDeleteModalOpen(false);
        return;
      }
      setAdminUsers(adminUsers.filter((u) => u.id !== recordToDelete.id));
      toast.success(`Admin account "${recordToDelete.name}" deleted.`, 'User Removed');
    } else if (moduleId === 'departments') {
      setDepartments(departments.filter((d) => d.id !== recordToDelete.id));
      toast.success(`Department "${recordToDelete.name}" removed.`, 'Department Removed');
    } else if (moduleId === 'services_rates') {
      setServices(services.filter((s) => s.id !== recordToDelete.id));
      toast.success(`Service "${recordToDelete.name}" removed.`, 'Service Removed');
    } else if (moduleId === 'wards_rooms_beds') {
      setBeds(beds.filter((b) => b.id !== recordToDelete.id));
      toast.success(`Bed "${recordToDelete.bedNumber}" removed.`, 'Bed Removed');
    } else if (moduleId === 'staff_users') {
      setStaffUsers(staffUsers.filter((s) => s.id !== recordToDelete.id));
      toast.success(`Staff user "${recordToDelete.name}" removed.`, 'Staff Removed');
    } else if (moduleId === 'corporate_panels') {
      setPanels(panels.filter((p) => p.id !== recordToDelete.id));
      toast.success(`Corporate panel "${recordToDelete.name}" removed.`, 'Panel Removed');
    }

    setIsDeleteModalOpen(false);
    setRecordToDelete(null);
  };

  // Resolve Header and Specific Button Label
  const getModuleConfig = () => {
    switch (activeModuleId) {
      case 'departments':
        return {
          title: 'Hospital Departments',
          desc: 'Manage clinical, diagnostic, and administrative departments, department heads, and staffing quotas.',
          actionLabel: 'Add Department',
          enableImport: true,
          importEntity: 'Departments',
        };
      case 'services_rates':
        return {
          title: 'Services & Rates Master',
          desc: 'Configure chargeable hospital services, standard tariff rates, category codes, and panel eligibility.',
          actionLabel: 'Add Service',
          enableImport: true,
          importEntity: 'Services & Rates',
        };
      case 'wards_rooms_beds':
        return {
          title: 'Wards, Rooms & Beds',
          desc: 'Manage inpatient accommodation infrastructure, room categories, bed occupancy, and daily tariff rates.',
          actionLabel: activeBedTab === 'beds' ? 'Add Bed' : activeBedTab === 'rooms' ? 'Add Room' : 'Add Ward',
          enableImport: false,
          importEntity: 'Beds',
        };
      case 'admin_users':
        return {
          title: 'Hospital Administrator Accounts',
          desc: 'Manage hospital administration accounts, system governance privileges, and authentication status.',
          actionLabel: 'Add Admin',
          enableImport: false,
          importEntity: 'Admin Users',
        };
      case 'staff_users':
        return {
          title: 'Hospital Staff Accounts',
          desc: 'Staff directory, departmental assignments, portal workstations, and access status.',
          actionLabel: 'Add Staff User',
          enableImport: false,
          importEntity: 'Staff Users',
        };
      case 'shift_management':
        return {
          title: 'Shift Management',
          desc: 'Staff duty rosters, timing configurations, rotational schedules, and departmental shift allocations.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Shifts',
        };
      case 'attendance':
        return {
          title: 'Staff Attendance',
          desc: 'Daily biometric attendance logs, clock-in/out records, duty presence, and attendance auditing.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Attendance',
        };
      case 'salary_payroll':
        return {
          title: 'Salary Payroll',
          desc: 'Comprehensive employee payroll engine supporting per-day, monthly, and custom date range calculations.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Payroll',
        };
      case 'doctor_commission':
        return {
          title: 'Doctor Commission',
          desc: 'OPD consultation splits, procedural revenue shares, and doctor payment reconciliations.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Commissions',
        };
      case 'corporate_panels':
        return {
          title: 'Corporate Panels',
          desc: 'Manage corporate agreements, health insurance policies, credit ceilings, and billing terms.',
          actionLabel: 'Add Corporate Panel',
          enableImport: true,
          importEntity: 'Corporate Panels',
        };
      case 'patient_registry':
      case 'panel_patient_registry':
        return {
          title: 'Patient Registry',
          desc: 'Permanent Master Patient Index (MPI), collision-safe MR number allocation, and payer classification.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Patients',
        };
      case 'panel_discounts':
        return {
          title: 'Panel Discounts',
          desc: 'Category-wise discount concessions, tariff exceptions, and corporate agreement rate structures.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Panel Discounts',
        };
      case 'panel_billing':
        return {
          title: 'Panel Billing',
          desc: 'Institutional corporate billing claims, invoice submissions, pre-authorization settlements, and claim status.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Panel Billing',
        };
      case 'billing_overview':
        return {
          title: 'Billing Overview',
          desc: 'Consolidated hospital billing operations, generated invoices, and departmental revenue streams.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Billing',
        };
      case 'collections':
        return {
          title: 'Collections',
          desc: 'Hospital cash, credit card, and digital payment collections across all cashier counters.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Collections',
        };
      case 'discounts':
        return {
          title: 'Discounts',
          desc: 'Authorized concessions, welfare fee waivers, and administrative discount audit records.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Discounts',
        };
      case 'refunds':
        return {
          title: 'Refunds',
          desc: 'Reversed transactions, cancelled service reimbursements, and refund audit vouchers.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Refunds',
        };
      case 'outstanding_balances':
        return {
          title: 'Outstanding Balances',
          desc: 'Patient unpaid dues, pending corporate receivables, and aging credit balances.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Outstanding Balances',
        };
      case 'expenses':
        return {
          title: 'Expenses',
          desc: 'Hospital operational disbursements, vendor payments, and departmental expense vouchers.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Expenses',
        };
      case 'petty_cash_advances':
        return {
          title: 'Petty Cash / Advances',
          desc: 'Counter cash floats, staff operational advances, and daily petty cash tracking.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Petty Cash',
        };
      case 'balance_sheets':
        return {
          title: 'Balance Sheets',
          desc: 'User-level daily cash drawer balance sheets and counter collection reconciliation.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Balance Sheets',
        };
      case 'account_settlements':
        return {
          title: 'Account Settlements',
          desc: 'End-of-shift cashier cash handovers, administrative bank deposits, and verified closures.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Settlements',
        };
      case 'appointments_operations_overview':
        return {
          title: 'Appointments / Operations Overview',
          desc: 'Consolidated clinical operational metrics, patient scheduling, and cross-departmental throughput.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Operations',
        };
      case 'opd_overview':
        return {
          title: 'OPD Overview',
          desc: 'Outpatient department clinic flows, consultant room allocations, and patient visit volumes.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'OPD',
        };
      case 'observation_overview':
        return {
          title: 'Observation Overview',
          desc: 'Day care observation beds, monitoring status, short-stay admissions, and clinical transfers.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Observation',
        };
      case 'emergency_overview':
        return {
          title: 'Emergency Overview',
          desc: '24/7 ER trauma intake, triage categorization, resuscitation bays, and critical stabilization.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Emergency',
        };
      case 'admission_overview':
        return {
          title: 'Admission Overview',
          desc: 'Inpatient bed occupancy, planned admissions, active inpatient stays, and discharge tracking.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Admissions',
        };
      case 'inventory_overview':
        return {
          title: 'Inventory Overview',
          desc: 'General hospital inventory balances, department stock levels, and procurement requirements.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Inventory',
        };
      case 'pharmacy_integration':
        return {
          title: 'Pharmacy Integration',
          desc: 'Integration status, dispensing sync, and requisition linkage with the standalone Pharmacy system.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Pharmacy Integration',
        };
      case 'general_settings':
        return {
          title: 'General Settings',
          desc: 'Hospital metadata, operational timings, institutional policies, and facility parameters.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'General Settings',
        };
      case 'invoice_settings':
        return {
          title: 'Invoice Settings',
          desc: 'Invoice prefix rules, numbering sequences, tax registrations (NTN/PNTN), and billing terms.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Invoice Settings',
        };
      case 'receipt_settings':
        return {
          title: 'Receipt Settings',
          desc: 'Receipt layout formats, thermal printer templates, custom headers, and cashier disclaimers.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Receipt Settings',
        };
      case 'import_export':
        return {
          title: 'Import / Export',
          desc: 'Secure data export, CSV master data imports, and institutional data migration tools.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Import Export',
        };
      case 'backup':
        return {
          title: 'Backup Placeholder',
          desc: 'Scheduled automated database backups, archive restoration points, and data durability controls.',
          actionLabel: undefined,
          enableImport: false,
          importEntity: 'Backup',
        };
      default:
        return {
          title: moduleName,
          desc: `Institutional administration and operational controls for ${moduleName}.`,
          actionLabel: undefined,
          enableImport: false,
          importEntity: moduleName,
        };
    }
  };

  const config = getModuleConfig();

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* 1. Page Header & Standard Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900">{config.title}</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
              {currentUser?.role === 'Admin' ? 'Hospital Administration' : 'Super Admin Control'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">{config.desc}</p>
        </div>

        {/* Header Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <ExportMenu
            reportTitle={config.title}
            dataCount={15}
            currentUserName={currentUser ? `${currentUser.name} (${currentUser.role})` : 'System Automated'}
          />

          {config.enableImport && (
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              <span>Import Excel</span>
            </button>
          )}

          {config.actionLabel && (
            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#149E75] hover:bg-[#08775A] text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{config.actionLabel}</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Top Summary Metrics */}
      {moduleId === 'departments' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[11px] font-medium text-slate-500">Total Departments</span>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{departments.length}</div>
            <span className="text-[10px] text-emerald-600 font-semibold">All Fully Manned</span>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[11px] font-medium text-slate-500">Clinical Specialties</span>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{departments.filter((d) => d.type === 'Clinical').length}</div>
            <span className="text-[10px] text-slate-400">Cardio, Ortho, Peds, ER</span>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[11px] font-medium text-slate-500">Diagnostic Services</span>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{departments.filter((d) => d.type === 'Diagnostic').length}</div>
            <span className="text-[10px] text-slate-400">Radiology & Pathology</span>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[11px] font-medium text-slate-500">Surgical Theatres</span>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{departments.filter((d) => d.type === 'Surgical').length}</div>
            <span className="text-[10px] text-slate-400">6 Modular OTs Active</span>
          </div>
        </div>
      )}

      {moduleId === 'services_rates' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[11px] font-medium text-slate-500">Configured Tariffs</span>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{services.length} Services</div>
            <span className="text-[10px] text-emerald-600 font-semibold">Standard Rates Active</span>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[11px] font-medium text-slate-500">Panel Covered Items</span>
            <div className="text-2xl font-black text-slate-900 mt-0.5">{services.filter((s) => s.panelEligible).length} Eligible</div>
            <span className="text-[10px] text-slate-400">Institutional Tariffs</span>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[11px] font-medium text-slate-500">OT & Cath Packages</span>
            <div className="text-2xl font-black text-slate-900 mt-0.5">Rs. 45k - 95k</div>
            <span className="text-[10px] text-slate-400">Laparoscopic & Angio</span>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[11px] font-medium text-slate-500">Last Rate Audit</span>
            <div className="text-sm font-bold text-slate-900 mt-1">04 Sep 2026</div>
            <span className="text-[10px] text-slate-400">By {currentUser ? `${currentUser.name} (${currentUser.role})` : 'System Automated'}</span>
          </div>
        </div>
      )}

      {moduleId === 'wards_rooms_beds' && (
        <div className="space-y-3">
          {/* Top capacity cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-[11px] font-medium text-slate-500">Total Sanctioned Beds</span>
              <div className="text-2xl font-black text-slate-900 mt-0.5">250 Beds</div>
              <span className="text-[10px] text-slate-400">Sanctioned Capacity</span>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-[11px] font-medium text-slate-500">Occupied Inpatients</span>
              <div className="text-2xl font-black text-slate-900 mt-0.5">189 Beds</div>
              <span className="text-[10px] text-[#08775A] font-semibold">75.6% Bed Occupancy</span>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-[11px] font-medium text-slate-500">Vacant Available</span>
              <div className="text-2xl font-black text-emerald-700 mt-0.5">54 Beds</div>
              <span className="text-[10px] text-emerald-600 font-semibold">Ready for Admission</span>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-[11px] font-medium text-slate-500">Sanitizing / Turnover</span>
              <div className="text-2xl font-black text-slate-900 mt-0.5">7 Beds</div>
              <span className="text-[10px] text-slate-400">Post-discharge Cleaning</span>
            </div>
          </div>

          {/* Sub-tab Switcher: Beds (Default) | Rooms | Wards */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
            <button
              type="button"
              onClick={() => setActiveBedTab('beds')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                activeBedTab === 'beds'
                  ? 'bg-[#149E75] text-white shadow-2xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              Beds Directory ({beds.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveBedTab('rooms')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                activeBedTab === 'rooms'
                  ? 'bg-[#149E75] text-white shadow-2xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              Rooms ({rooms.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveBedTab('wards')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                activeBedTab === 'wards'
                  ? 'bg-[#149E75] text-white shadow-2xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              Wards & Wings ({wards.length})
            </button>
          </div>
        </div>
      )}

      {/* 3. Search & Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder={`Search ${config.title.toLowerCase()}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs pl-8.5 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#149E75] bg-slate-50/50"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          <span className="text-[11px] font-semibold text-slate-500">Filter:</span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-[#149E75]"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active Only</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* 4. Page-Specific Tables (NO PATIENT DATA ON NON-PATIENT PAGES!) */}

      {/* PAGE: DEPARTMENTS */}
      {moduleId === 'departments' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-2.5 px-4">Department Code</th>
                  <th className="py-2.5 px-4">Department Name</th>
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4">Head / In-charge</th>
                  <th className="py-2.5 px-4">Doctors</th>
                  <th className="py-2.5 px-4">Staff</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Created Date</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {departments
                  .filter((d) => d.name.toLowerCase().includes(searchTerm.toLowerCase()) || d.code.toLowerCase().includes(searchTerm.toLowerCase()))
                  .map((dept) => (
                    <tr key={dept.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{dept.code}</td>
                      <td className="py-2.5 px-4 font-bold text-slate-900">{dept.name}</td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          dept.type === 'Clinical' ? 'bg-[#effaf5] text-[#08775A] border border-[#c2e7db]' :
                          dept.type === 'Surgical' ? 'bg-amber-50 text-amber-800' :
                          dept.type === 'Diagnostic' ? 'bg-slate-100 text-slate-800' : 'bg-slate-100 text-slate-800'
                        }`}>
                          {dept.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-800">{dept.head}</td>
                      <td className="py-2.5 px-4"><span className="px-2 py-0.5 rounded bg-[#effaf5] text-[#08775A] border border-[#c2e7db] font-semibold">{dept.doctorsCount} Doctors</span></td>
                      <td className="py-2.5 px-4"><span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-semibold">{dept.staffCount} Staff</span></td>
                      <td className="py-2.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold text-[10px]">
                          {dept.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-500">{dept.createdDate}</td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => { setSelectedRecord(dept); setIsDetailsModalOpen(true); }}
                            className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-[#08775A]"
                            title="View Details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setRecordToDelete(dept); setIsDeleteModalOpen(true); }}
                            className="p-1 hover:bg-rose-50 rounded text-slate-400 hover:text-rose-600"
                            title="Delete Department"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PAGE: SERVICES & RATES */}
      {(moduleId === 'services_rates' || moduleId === 'services') && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-2.5 px-4">Service Code</th>
                  <th className="py-2.5 px-4">Service Description</th>
                  <th className="py-2.5 px-4">Department</th>
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-4 text-right">Standard Tariff (PKR)</th>
                  <th className="py-2.5 px-4 text-center">Panel Covered</th>
                  <th className="py-2.5 px-4">Updated By</th>
                  <th className="py-2.5 px-4">Last Audit</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {services
                  .filter((s) => s.name.toLowerCase().includes(searchTerm.toLowerCase()) || s.code.toLowerCase().includes(searchTerm.toLowerCase()))
                  .map((srv) => (
                    <tr key={srv.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{srv.code}</td>
                      <td className="py-2.5 px-4 font-bold text-slate-900">{srv.name}</td>
                      <td className="py-2.5 px-4 text-slate-600">{srv.department}</td>
                      <td className="py-2.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-medium text-[10px]">
                          {srv.category}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-black text-slate-900">
                        {formatPKR(srv.standardRate)}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          srv.panelEligible ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {srv.panelEligible ? 'Yes (Panel Covered)' : 'Private Only'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">{srv.updatedBy}</td>
                      <td className="py-2.5 px-4 text-slate-500 font-mono text-[11px]">{srv.updatedDate}</td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => { setSelectedRecord(srv); setIsDetailsModalOpen(true); }}
                            className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-[#08775A]"
                            title="View Tariff Details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setRecordToDelete(srv); setIsDeleteModalOpen(true); }}
                            className="p-1 hover:bg-rose-50 rounded text-slate-400 hover:text-rose-600"
                            title="Delete Service"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PAGE: WARDS / ROOMS / BEDS */}
      {moduleId === 'wards_rooms_beds' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          {activeBedTab === 'beds' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <th className="py-2.5 px-4">Bed Number</th>
                    <th className="py-2.5 px-4">Room & Suite</th>
                    <th className="py-2.5 px-4">Ward / Wing</th>
                    <th className="py-2.5 px-4">Department</th>
                    <th className="py-2.5 px-4">Bed Type</th>
                    <th className="py-2.5 px-4 text-right">Daily Tariff</th>
                    <th className="py-2.5 px-4">Occupancy Status</th>
                    <th className="py-2.5 px-4">Admitted Patient</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {beds
                    .filter((b) => b.bedNumber.toLowerCase().includes(searchTerm.toLowerCase()) || b.room.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map((bed) => (
                      <tr key={bed.id} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{bed.bedNumber}</td>
                        <td className="py-2.5 px-4 font-semibold text-slate-900">{bed.room}</td>
                        <td className="py-2.5 px-4 text-slate-600">{bed.ward}</td>
                        <td className="py-2.5 px-4 text-slate-500">{bed.department}</td>
                        <td className="py-2.5 px-4"><span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-medium">{bed.bedType}</span></td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">{formatPKR(bed.ratePerDay)}/day</td>
                        <td className="py-2.5 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            bed.occupancyStatus === 'Occupied' ? 'bg-rose-50 text-rose-800 border border-rose-200' :
                            bed.occupancyStatus === 'Available' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800'
                          }`}>
                            {bed.occupancyStatus}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-medium text-slate-800">{bed.currentPatient}</td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => { setSelectedRecord(bed); setIsDetailsModalOpen(true); }}
                              className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-[#08775A]"
                              title="View Bed Details"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => { setRecordToDelete(bed); setIsDeleteModalOpen(true); }}
                              className="p-1 hover:bg-rose-50 rounded text-slate-400 hover:text-rose-600"
                              title="Delete Bed"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {activeBedTab === 'rooms' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <th className="py-2.5 px-4">Room #</th>
                    <th className="py-2.5 px-4">Ward / Wing</th>
                    <th className="py-2.5 px-4">Room Category</th>
                    <th className="py-2.5 px-4 text-center">Beds Capacity</th>
                    <th className="py-2.5 px-4 text-right">Daily Base Rate</th>
                    <th className="py-2.5 px-4 text-center">HVAC / Air Conditioning</th>
                    <th className="py-2.5 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {rooms.map((rm) => (
                    <tr key={rm.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-4 font-bold text-slate-900">{rm.roomNumber}</td>
                      <td className="py-2.5 px-4 text-slate-600">{rm.ward}</td>
                      <td className="py-2.5 px-4"><span className="px-2 py-0.5 rounded bg-[#effaf5] text-[#08775A] border border-[#c2e7db] font-bold">{rm.category}</span></td>
                      <td className="py-2.5 px-4 text-center font-bold text-slate-900">{rm.totalBeds} Beds</td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">{formatPKR(rm.dailyRate)}</td>
                      <td className="py-2.5 px-4 text-center">
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-medium text-[10px]">
                          Central Climate Control
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold text-[10px]">
                          {rm.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeBedTab === 'wards' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <th className="py-2.5 px-4">Ward Code</th>
                    <th className="py-2.5 px-4">Ward Name</th>
                    <th className="py-2.5 px-4">Floor / Wing</th>
                    <th className="py-2.5 px-4 text-center">Total Beds</th>
                    <th className="py-2.5 px-4 text-center">Occupied Beds</th>
                    <th className="py-2.5 px-4">In-Charge Sister</th>
                    <th className="py-2.5 px-4 text-right">Daily Charge</th>
                    <th className="py-2.5 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {wards.map((wd) => (
                    <tr key={wd.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{wd.code}</td>
                      <td className="py-2.5 px-4 font-bold text-slate-900">{wd.name}</td>
                      <td className="py-2.5 px-4 text-slate-600">{wd.floor}</td>
                      <td className="py-2.5 px-4 text-center font-bold">{wd.totalBeds}</td>
                      <td className="py-2.5 px-4 text-center font-bold text-slate-800">{wd.occupiedBeds}</td>
                      <td className="py-2.5 px-4 text-slate-800 font-medium">{wd.inchargeNurse}</td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold">{formatPKR(wd.dailyCharge)}</td>
                      <td className="py-2.5 px-4 text-right">
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold text-[10px]">
                          {wd.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PAGE: ADMIN USERS */}
      {moduleId === 'admin_users' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-3 bg-amber-50/60 border-b border-amber-200/60 flex items-center gap-2 text-xs text-amber-900 font-medium">
            <Lock className="h-4 w-4 text-amber-700 shrink-0" />
            <span>
              <strong>Security Protocol:</strong> Root Super Admin account is permanently protected and cannot be deactivated or deleted by any administrative session.
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-2.5 px-4">User ID</th>
                  <th className="py-2.5 px-4">Administrator Name</th>
                  <th className="py-2.5 px-4">Username</th>
                  <th className="py-2.5 px-4">Phone</th>
                  <th className="py-2.5 px-4">Institutional Email</th>
                  <th className="py-2.5 px-4">Governance Role</th>
                  <th className="py-2.5 px-4">Last Login</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {adminUsers
                  .filter((u) => u.name.toLowerCase().includes(searchTerm.toLowerCase()) || u.username.toLowerCase().includes(searchTerm.toLowerCase()))
                  .map((admin) => (
                    <tr key={admin.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{admin.id}</td>
                      <td className="py-2.5 px-4">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <span>{admin.name}</span>
                          {admin.isSuperAdminProtected && (
                            <span className="p-0.5 rounded bg-amber-100 text-amber-800" title="Root Super Admin (Protected Account)">
                              <Lock className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-600">{admin.username}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-600">{admin.phone}</td>
                      <td className="py-2.5 px-4 text-slate-600">{admin.email}</td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          admin.role === 'Super Admin' ? 'bg-[#effaf5] text-[#08775A] border border-[#c2e7db]' : 'bg-slate-100 text-slate-800'
                        }`}>
                          {admin.role}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-500 font-mono text-[11px]">{admin.lastLogin}</td>
                      <td className="py-2.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold text-[10px]">
                          {admin.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => { setSelectedRecord(admin); setIsDetailsModalOpen(true); }}
                            className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-[#08775A]"
                            title="View Admin Profile"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {admin.isSuperAdminProtected ? (
                            <button
                              type="button"
                              disabled
                              className="p-1 rounded text-slate-300 cursor-not-allowed"
                              title="Root Super Admin account cannot be deleted or deactivated"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setRecordToDelete(admin); setIsDeleteModalOpen(true); }}
                              className="p-1 hover:bg-rose-50 rounded text-slate-400 hover:text-rose-600"
                              title="Delete Admin Account"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PAGE: STAFF USERS */}
      {moduleId === 'staff_users' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-2.5 px-4">Staff ID</th>
                  <th className="py-2.5 px-4">Staff Name</th>
                  <th className="py-2.5 px-4">Username</th>
                  <th className="py-2.5 px-4">Department</th>
                  <th className="py-2.5 px-4">Role / Designation</th>
                  <th className="py-2.5 px-4">Phone</th>
                  <th className="py-2.5 px-4">Assigned Portal</th>
                  <th className="py-2.5 px-4">Shift Assignment</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {staffUsers
                  .filter((s) => s.name.toLowerCase().includes(searchTerm.toLowerCase()) || s.staffId.toLowerCase().includes(searchTerm.toLowerCase()))
                  .map((staff) => (
                    <tr key={staff.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{staff.staffId}</td>
                      <td className="py-2.5 px-4 font-bold text-slate-900">{staff.name}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-600">{staff.username}</td>
                      <td className="py-2.5 px-4 text-slate-600">{staff.department}</td>
                      <td className="py-2.5 px-4 font-medium text-slate-800">{staff.designation}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-600">{staff.phone}</td>
                      <td className="py-2.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-[#effaf5] text-[#08775A] border border-[#c2e7db] font-bold text-[10px]">
                          {staff.assignedPortal}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">{staff.shift}</td>
                      <td className="py-2.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold text-[10px]">
                          {staff.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => { setSelectedRecord(staff); setIsDetailsModalOpen(true); }}
                            className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-[#08775A]"
                            title="View Staff Profile"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setRecordToDelete(staff); setIsDeleteModalOpen(true); }}
                            className="p-1 hover:bg-rose-50 rounded text-slate-400 hover:text-rose-600"
                            title="Delete Staff Account"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}



      {/* PAGE: CORPORATE PANELS */}
      {activeModuleId === 'corporate_panels' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-2.5 px-4">Panel Code</th>
                  <th className="py-2.5 px-4">Organization / Panel Name</th>
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-4">Discount Agreement</th>
                  <th className="py-2.5 px-4 text-right">Credit Ceiling (PKR)</th>
                  <th className="py-2.5 px-4 text-center">Active Patients</th>
                  <th className="py-2.5 px-4">Focal Person</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {panels.map((pnl) => (
                  <tr key={pnl.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{pnl.code}</td>
                    <td className="py-2.5 px-4 font-bold text-slate-900">{pnl.name}</td>
                    <td className="py-2.5 px-4"><span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-medium">{pnl.category}</span></td>
                    <td className="py-2.5 px-4 text-slate-700">{pnl.discountAgreement}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-black text-slate-900">{formatPKR(pnl.creditLimit)}</td>
                    <td className="py-2.5 px-4 text-center font-bold text-slate-800">{pnl.activePatientsCount}</td>
                    <td className="py-2.5 px-4 text-slate-600">{pnl.focalPerson}</td>
                    <td className="py-2.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold text-[10px]">
                        {pnl.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => { setSelectedRecord(pnl); setIsDetailsModalOpen(true); }}
                          className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-[#08775A]"
                          title="View Agreement Details"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setRecordToDelete(pnl); setIsDeleteModalOpen(true); }}
                          className="p-1 hover:bg-rose-50 rounded text-slate-400 hover:text-rose-600"
                          title="Delete Panel"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PAGE: PANEL PATIENTS */}
      {moduleId === 'panel_patients' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-2.5 px-4">MR Number</th>
                  <th className="py-2.5 px-4">Patient Name</th>
                  <th className="py-2.5 px-4">Affiliated Corporate Panel</th>
                  <th className="py-2.5 px-4">Employee / Card ID</th>
                  <th className="py-2.5 px-4">Pre-Auth / Policy Ref</th>
                  <th className="py-2.5 px-4 text-right">Credit Entitlement</th>
                  <th className="py-2.5 px-4 text-right">Remaining Balance</th>
                  <th className="py-2.5 px-4 text-right">Pre-Auth Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {panelPatients.map((pt) => (
                  <tr key={pt.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{pt.mrn}</td>
                    <td className="py-2.5 px-4 font-bold text-slate-900">{pt.name}</td>
                    <td className="py-2.5 px-4 font-semibold text-slate-800">{pt.corporatePanel}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">{pt.cardId}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-500">{pt.preAuthCode}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-700">{formatPKR(pt.entitlementLimit)}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-800">{formatPKR(pt.availableCredit)}</td>
                    <td className="py-2.5 px-4 text-right">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        pt.status === 'Approved' ? 'bg-emerald-50 text-emerald-800' :
                        pt.status === 'Under Review' ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800'
                      }`}>
                        {pt.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* FALLBACK FOR ANY OTHER APPROVED CANONICAL MODULE */}
      {activeModuleId !== 'corporate_panels' && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-4 shadow-xs">
          <div className="h-12 w-12 rounded-full bg-[#effaf5] text-[#08775A] border border-[#c2e7db] flex items-center justify-center mx-auto">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            {groupTitle && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold tracking-wide uppercase mb-2">
                {groupTitle}
              </span>
            )}
            <h3 className="text-base font-bold text-slate-900">{config.title}</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              {config.desc}
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>Operational Policies Synchronized under Root Authority</span>
          </div>
        </div>
      )}

      {/* 5. Modals for Adding New Records */}

      {/* Add Department Modal */}
      {moduleId === 'departments' && (
        <Modal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          title="Add New Hospital Department"
          maxWidth="md"
        >
          <form onSubmit={handleAddDepartment} className="space-y-4">
            <TextInput
              label="Department Code"
              placeholder="e.g. DEP-NEU"
              value={deptForm.code}
              onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value })}
              required
            />
            <TextInput
              label="Department Name"
              placeholder="e.g. Neurology & Stroke Care"
              value={deptForm.name}
              onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
              required
            />
            <Select
              label="Department Type"
              value={deptForm.type}
              onChange={(e) => setDeptForm({ ...deptForm, type: e.target.value as any })}
              options={[
                { value: 'Clinical', label: 'Clinical OPD/IPD' },
                { value: 'Diagnostic', label: 'Diagnostic / Laboratory' },
                { value: 'Surgical', label: 'Surgical / Theatres' },
                { value: 'Administrative', label: 'Administrative' },
                { value: 'Support', label: 'Support Services' },
              ]}
            />
            <TextInput
              label="Department Head / In-charge"
              placeholder="e.g. Dr. Asad Ullah"
              value={deptForm.head}
              onChange={(e) => setDeptForm({ ...deptForm, head: e.target.value })}
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput
                label="Doctors Quota"
                value={deptForm.doctorsCount}
                onChange={(e) => setDeptForm({ ...deptForm, doctorsCount: Number(e.target.value) })}
                min={1}
                max={50}
              />
              <NumberInput
                label="Staff Quota"
                value={deptForm.staffCount}
                onChange={(e) => setDeptForm({ ...deptForm, staffCount: Number(e.target.value) })}
                min={1}
                max={100}
              />
            </div>
            <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#149E75] hover:bg-[#08775A] text-white text-xs font-semibold rounded-lg shadow-xs"
              >
                Add Department
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add Service Modal */}
      {moduleId === 'services_rates' && (
        <Modal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          title="Register Chargeable Service Tariff"
          maxWidth="md"
        >
          <form onSubmit={handleAddService} className="space-y-4">
            <TextInput
              label="Service Code"
              placeholder="e.g. SRV-RAD-099"
              value={serviceForm.code}
              onChange={(e) => setServiceForm({ ...serviceForm, code: e.target.value })}
              required
            />
            <TextInput
              label="Service Description"
              placeholder="e.g. CT Angiography Coronary"
              value={serviceForm.name}
              onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}
              required
            />
            <Select
              label="Clinical Department"
              value={serviceForm.department}
              onChange={(e) => setServiceForm({ ...serviceForm, department: e.target.value })}
              options={[
                { value: 'Cardiology & Cath Lab', label: 'Cardiology & Cath Lab' },
                { value: 'Radiology & Advanced Imaging', label: 'Radiology & Advanced Imaging' },
                { value: 'Pathology & Central Blood Bank', label: 'Pathology & Central Blood Bank' },
                { value: 'General & Laparoscopic Surgery', label: 'General Surgery' },
                { value: 'Emergency & Trauma Centre', label: 'Emergency & Trauma' },
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Tariff Category"
                value={serviceForm.category}
                onChange={(e) => setServiceForm({ ...serviceForm, category: e.target.value as any })}
                options={[
                  { value: 'Consultation', label: 'Consultation' },
                  { value: 'Intervention', label: 'Intervention' },
                  { value: 'Radiology', label: 'Radiology' },
                  { value: 'Diagnostic Lab', label: 'Diagnostic Lab' },
                  { value: 'OT Procedure', label: 'OT Procedure' },
                  { value: 'Emergency', label: 'Emergency' },
                  { value: 'Dialysis', label: 'Dialysis' },
                ]}
              />
              <NumberInput
                label="Standard Rate (PKR)"
                value={serviceForm.standardRate}
                onChange={(e) => setServiceForm({ ...serviceForm, standardRate: Number(e.target.value) })}
                min={100}
                max={1000000}
              />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="panelEligible"
                checked={serviceForm.panelEligible}
                onChange={(e) => setServiceForm({ ...serviceForm, panelEligible: e.target.checked })}
                className="rounded border-slate-300 text-[#149E75] focus:ring-[#149E75]"
              />
              <label htmlFor="panelEligible" className="text-xs font-medium text-slate-700">
                Eligible for Corporate Panels & Health Insurance
              </label>
            </div>
            <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#149E75] hover:bg-[#08775A] text-white text-xs font-semibold rounded-lg shadow-xs"
              >
                Save Service Tariff
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add Bed Modal */}
      {moduleId === 'wards_rooms_beds' && (
        <Modal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          title="Add New Inpatient Bed"
          maxWidth="md"
        >
          <form onSubmit={handleAddBed} className="space-y-4">
            <TextInput
              label="Bed Number"
              placeholder="e.g. BED-ICU-10"
              value={bedForm.bedNumber}
              onChange={(e) => setBedForm({ ...bedForm, bedNumber: e.target.value })}
              required
            />
            <TextInput
              label="Room / Location"
              placeholder="e.g. ICU Bay C"
              value={bedForm.room}
              onChange={(e) => setBedForm({ ...bedForm, room: e.target.value })}
              required
            />
            <Select
              label="Ward"
              value={bedForm.ward}
              onChange={(e) => setBedForm({ ...bedForm, ward: e.target.value })}
              options={[
                { value: 'Critical Care Unit', label: 'Critical Care Unit' },
                { value: 'Executive Private Ward', label: 'Executive Private Ward' },
                { value: 'General Surgical Ward', label: 'General Surgical Ward' },
                { value: 'General Medical Ward', label: 'General Medical Ward' },
              ]}
            />
            <NumberInput
              label="Daily Rate (PKR)"
              value={bedForm.ratePerDay}
              onChange={(e) => setBedForm({ ...bedForm, ratePerDay: Number(e.target.value) })}
              min={500}
              max={50000}
            />
            <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#149E75] hover:bg-[#08775A] text-white text-xs font-semibold rounded-lg shadow-xs"
              >
                Commission Bed
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add Admin User Modal */}
      {moduleId === 'admin_users' && (
        <Modal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          title="Provision Administrator Account"
          maxWidth="md"
        >
          <form onSubmit={handleAddAdmin} className="space-y-4">
            <TextInput
              label="Full Name"
              placeholder="e.g. Dr. Salman Qureshi"
              value={adminForm.name}
              onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })}
              required
            />
            <TextInput
              label="Username"
              placeholder="e.g. salman.admin"
              value={adminForm.username}
              onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })}
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <TextInput
                label="Mobile Phone"
                placeholder="0300 1234567"
                value={adminForm.phone}
                onChange={(e) => setAdminForm({ ...adminForm, phone: e.target.value })}
                required
              />
              <Select
                label="Administrative Role"
                value={adminForm.role}
                onChange={(e) => setAdminForm({ ...adminForm, role: e.target.value as any })}
                options={[
                  { value: 'Hospital Administrator', label: 'Hospital Administrator' },
                  { value: 'Director Operations', label: 'Director Operations' },
                  { value: 'Clinical Director', label: 'Clinical Director' },
                ]}
              />
            </div>
            <TextInput
              label="Official Email"
              type="email"
              placeholder="salman@sharif-saeed.hospital"
              value={adminForm.email}
              onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
              required
            />
            <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#149E75] hover:bg-[#08775A] text-white text-xs font-semibold rounded-lg shadow-xs"
              >
                Create Administrator
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add Staff User Modal */}
      {moduleId === 'staff_users' && (
        <Modal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          title="Add Hospital Staff Account"
          maxWidth="md"
        >
          <form onSubmit={handleAddStaff} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <TextInput
                label="Staff ID"
                placeholder="STF-2026-102"
                value={staffForm.staffId}
                onChange={(e) => setStaffForm({ ...staffForm, staffId: e.target.value })}
              />
              <TextInput
                label="Staff Name"
                placeholder="e.g. Saira Khan"
                value={staffForm.name}
                onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <TextInput
                label="Username"
                placeholder="saira.billing"
                value={staffForm.username}
                onChange={(e) => setStaffForm({ ...staffForm, username: e.target.value })}
                required
              />
              <TextInput
                label="Contact Phone"
                placeholder="0321 5554433"
                value={staffForm.phone}
                onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Assigned Portal"
                value={staffForm.assignedPortal}
                onChange={(e) => setStaffForm({ ...staffForm, assignedPortal: e.target.value as any })}
                options={[
                  { value: 'Front Desk', label: 'Front Desk & Billing' },
                  { value: 'Pharmacy', label: 'Pharmacy Dispensary' },
                  { value: 'Admission', label: 'Admission & Bed Management' },
                  { value: 'Inventory', label: 'Inventory & Store' },
                ]}
              />
              <Select
                label="Shift"
                value={staffForm.shift}
                onChange={(e) => setStaffForm({ ...staffForm, shift: e.target.value as any })}
                options={[
                  { value: 'Morning (08:00 - 16:00)', label: 'Morning (08:00 - 16:00)' },
                  { value: 'Evening (16:00 - 00:00)', label: 'Evening (16:00 - 00:00)' },
                  { value: 'Night (00:00 - 08:00)', label: 'Night (00:00 - 08:00)' },
                ]}
              />
            </div>
            <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#149E75] hover:bg-[#08775A] text-white text-xs font-semibold rounded-lg shadow-xs"
              >
                Save Staff Account
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add Corporate Panel Modal */}
      {activeModuleId === 'corporate_panels' && (
        <Modal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          title="Register Corporate Panel / Insurance Partner"
          maxWidth="2xl"
        >
          <form onSubmit={handleAddPanel} className="space-y-4">
            <TextInput
              label="Panel Code"
              placeholder="e.g. PNL-ASK"
              value={panelForm.code}
              onChange={(e) => setPanelForm({ ...panelForm, code: e.target.value })}
              required
            />
            <TextInput
              label="Organization Name"
              placeholder="e.g. Askari General Insurance"
              value={panelForm.name}
              onChange={(e) => setPanelForm({ ...panelForm, name: e.target.value })}
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Panel Category"
                value={panelForm.category}
                onChange={(e) => setPanelForm({ ...panelForm, category: e.target.value as any })}
                options={[
                  { value: 'Private Insurance', label: 'Private Insurance' },
                  { value: 'Govt Health Insurance', label: 'Govt Health Insurance' },
                  { value: 'Armed Forces Welfare', label: 'Armed Forces Welfare' },
                  { value: 'Corporate Enterprise', label: 'Corporate Enterprise' },
                ]}
              />
              <NumberInput
                label="Credit Limit (PKR)"
                value={panelForm.creditLimit}
                onChange={(e) => setPanelForm({ ...panelForm, creditLimit: Number(e.target.value) })}
                min={1000000}
                max={100000000}
              />
            </div>
            <TextInput
              label="Discount & Tariff Agreement"
              placeholder="e.g. 15% Tariff Concession on Inpatient"
              value={panelForm.discountAgreement}
              onChange={(e) => setPanelForm({ ...panelForm, discountAgreement: e.target.value })}
              required
            />
            <TextInput
              label="Focal Person & Phone"
              placeholder="e.g. Mr. Zahid Khan (0300 9988776)"
              value={panelForm.focalPerson}
              onChange={(e) => setPanelForm({ ...panelForm, focalPerson: e.target.value })}
              required
            />
            <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#149E75] hover:bg-[#08775A] text-white text-xs font-semibold rounded-lg shadow-xs"
              >
                Register Panel Partner
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Details View Modal */}
      {selectedRecord && (
        <Modal
          isOpen={isDetailsModalOpen}
          onClose={() => { setIsDetailsModalOpen(false); setSelectedRecord(null); }}
          title={`Institutional Record Details: ${selectedRecord.name || selectedRecord.bedNumber || selectedRecord.roleName || selectedRecord.code}`}
          maxWidth="md"
        >
          <div className="space-y-3 text-xs">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
              {Object.entries(selectedRecord).map(([key, value]) => {
                if (key === 'id') return null;
                return (
                  <div key={key} className="flex items-center justify-between border-b border-slate-100 pb-1.5 last:border-b-0">
                    <span className="text-slate-500 capitalize font-medium">{key.replace(/([A-Z])/g, ' $1')}</span>
                    <span className="font-semibold text-slate-900 font-mono text-right max-w-xs truncate">
                      {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => { setIsDetailsModalOpen(false); setSelectedRecord(null); }}
                className="px-4 py-2 bg-[#149E75] text-white rounded-lg font-semibold hover:bg-[#08775A]"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => { setIsDeleteModalOpen(false); setRecordToDelete(null); }}
        onConfirm={handleDeleteConfirm}
        title="Confirm Administrative Removal"
        message={`Are you sure you want to delete ${recordToDelete?.name || recordToDelete?.bedNumber || 'this record'} from the institution database?`}
        confirmLabel="Yes, Delete Record"
        variant="danger"
      />

      {/* Import Excel Modal */}
      <ImportExcelModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        entityName={config.importEntity}
        templateFileName={`${moduleId}_template.xlsx`}
        onImportComplete={(count) => {
          setIsImportModalOpen(false);
          toast.success(`Successfully imported ${count} records into ${config.title}.`, 'Import Successful');
        }}
      />
    </div>
  );
};
