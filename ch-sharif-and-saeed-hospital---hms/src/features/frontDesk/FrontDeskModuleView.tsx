import { DischargedPatientsView } from '../shared/DischargedPatientsView';
import React from 'react';
import { NewAdmissionView } from './newAdmission/NewAdmissionView';
import { AppointmentsView } from './appointments/AppointmentsView';
import { AdmissionPaymentRequestsView } from './paymentRequests/AdmissionPaymentRequestsView';
import { FrontDeskBillingReportsView } from './reports/FrontDeskBillingReportsView';
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
} from './reports/FrontDeskExtraReports';
import { MyAccountSettlementView } from './settlement/MyAccountSettlementView';
import { HospitalInvoicesView } from './billing/HospitalInvoicesView';
import { AdmissionPatientRecordsView } from './admissionRecords/AdmissionPatientRecordsView';
import { BillingPendingDischargesView } from './billing/BillingPendingDischargesView';
import { MyBalanceSheetView } from './billing/MyBalanceSheetView';
import { WalkInIntakeView } from './encounterIntake/WalkInIntakeView';
import { PanelBillingView } from './panelBilling/PanelBillingView';
import { ModulePlaceholderView } from '../shared/ModulePlaceholderView';

interface FrontDeskModuleViewProps {
  moduleId: string;
  moduleName: string;
  groupTitle: string;
}

/**
 * Front Desk portal dispatcher — mirrors `SuperAdminModuleView`'s pattern:
 * real, DB-backed pages first, falling back to `ModulePlaceholderView`
 * (100% hardcoded mock data) for modules not yet wired.
 *
 * `payments_receipts` / `discounts` / `refunds` all point at the same
 * `HospitalInvoicesView` + its `InvoiceDetailModal` — a deliberate
 * consolidation (those actions live per-invoice, not as separate global
 * lists) rather than four near-duplicate pages. Each passes its own
 * `recordFilter` so the list itself only shows invoices that actually have
 * a payment / discount / refund on them (server-side, via `GET /invoices?
 * hasPayment|hasDiscount|hasRefund=true` — see `invoices.service.ts`), not
 * every invoice in the ledger. `panel_billing` follows the
 * same idea: Panel Verification, Contract Resolution, Interim Statement and
 * Remittance all live as tabs on one `PanelBillingView`. Every Front Desk
 * nav item is now real — see HMS_V7.2_NEW_REQUIREMENTS.md's progress log
 * for the build history.
 */
export const FrontDeskModuleView: React.FC<FrontDeskModuleViewProps> = ({ moduleId, moduleName, groupTitle }) => {
  switch (moduleId) {
    case 'discharged_patients':
      return <DischargedPatientsView />;
    case 'new_admission':
      return <NewAdmissionView />;
    case 'appointments':
      return <AppointmentsView />;
    case 'walk_in_intake':
      return <WalkInIntakeView />;
    case 'admission_patient_records':
      return <AdmissionPatientRecordsView />;
    case 'billing_pending_discharges':
      return <BillingPendingDischargesView />;
    case 'hospital_invoices':
      return <HospitalInvoicesView />;
    case 'payments_receipts':
      return (
        <HospitalInvoicesView
          recordFilter="PAID"
          title="Payments / Receipts"
          subtitle="Only invoices with at least one payment receipt — open one to record another payment, add a service, or view its receipt trail."
        />
      );
    case 'discounts':
      return (
        <HospitalInvoicesView
          recordFilter="DISCOUNTED"
          title="Discounts"
          subtitle="Only invoices a discount has actually been applied to — panel-rule and manual discounts, with the approval threshold enforced by the server."
        />
      );
    case 'refunds':
      return (
        <HospitalInvoicesView
          recordFilter="REFUNDED"
          title="Refunds"
          subtitle="Only invoices with a posted refund — open one to see or extend it, always capped at what was actually collected."
        />
      );
    case 'outstanding_balances':
      return (
        <HospitalInvoicesView
          outstandingOnly
          title="Outstanding Balances"
          subtitle="Every invoice with a remaining balance due — open one to collect payment."
        />
      );
    case 'opd':
      return (
        <HospitalInvoicesView
          initialQueueFilter="OPD"
          title="Hospital Invoices — OPD Queue"
          subtitle="Outpatient encounters — invoices raised via Walk-In Intake or Appointment Check-In."
        />
      );
    case 'observation':
      return (
        <HospitalInvoicesView
          initialQueueFilter="OBS"
          title="Hospital Invoices — Observation Queue"
          subtitle="Observation encounters — invoices raised via Walk-In Intake or Appointment Check-In."
        />
      );
    case 'emergency':
      return (
        <HospitalInvoicesView
          initialQueueFilter="ER"
          title="Hospital Invoices — Emergency Queue"
          subtitle="Emergency encounters — triage & acute care invoices raised via Walk-In Intake or Check-In."
        />
      );
    case 'my_balance_sheet':
    case 'balance_sheets':
    case 'balance_sheet':
      return <MyBalanceSheetView />;
    case 'admission_payment_requests':
      return <AdmissionPaymentRequestsView />;
    case 'front_desk_billing_reports':
      return <FrontDeskBillingReportsView />;
    case 'fd_encounter_register':
      return <EncounterRegisterView />;
    case 'fd_invoice_register':
      return <InvoiceRegisterView />;
    case 'fd_collection_report':
      return <CollectionReportViewPage />;
    case 'fd_outstanding_invoices':
      return <OutstandingInvoicesView />;
    case 'fd_discount_report':
      return <FinancialExceptionsReportView />;
    case 'fd_refund_void_report':
      return <FinancialExceptionsReportView />;
    case 'fd_department_revenue':
      return <DepartmentRevenueReportView />;
    case 'fd_admission_payment_collections':
      return <AdmissionPaymentCollectionsView />;
    case 'fd_panel_payer':
      return <PanelPayerReportView />;
    case 'fd_receipt_exceptions':
      return <ReceiptExceptionLogView />;
    case 'fd_cashier_performance':
      return <CashierPerformanceReportView />;
    case 'my_account_settlement':
      return <MyAccountSettlementView />;
    case 'panel_billing':
      return <PanelBillingView />;
    default:
      return <ModulePlaceholderView moduleId={moduleId} moduleName={moduleName} groupTitle={groupTitle} />;
  }
};
