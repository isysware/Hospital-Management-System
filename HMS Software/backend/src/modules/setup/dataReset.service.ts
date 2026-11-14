import { prisma } from '@/db/client';
import { AuthorizationError } from '@/shared/errors/AppError';

export interface ResetSummary {
  appointments: number;
  invoices: number;
  invoiceLines: number;
  paymentReceipts: number;
  userCashBalances: number;
  accountSettlements: number;
  providerSettlements: number;
  admissions: number;
  selfPayEncounters: number;
  panelPatients: number;
  corporatePanels: number;
  pharmacyClearances: number;
  pharmacyCharges: number;
  pharmacyDispenses: number;
  pharmacyDispenseLines: number;
  resetBeds: number;
  mainCashFundEntries: number;
  staff: number;
  departments: number;
  shifts: number;
  wards: number;
  rooms: number;
}

export const dataResetService = {
  /**
   * Resets all runtime transactional data (appointments, invoices, receipts,
   * cashier ledgers, admissions, patient encounters, panel patients, corporate
   * panels, the Main Cash Fund) AND the Staff / Department / Ward-Room-Bed
   * master directories — while preserving Portal User login accounts
   * (Super Admin, Admin, and every operational role's username/password),
   * Services & Rates, and the Hospital Profile itself.
   *
   * Staff/Department/Ward carry deep RESTRICT foreign keys across HR,
   * attendance, payroll, and requisition tables — each must be cleared in
   * dependency order (children before parents) or the whole transaction
   * fails atomically with no partial deletion.
   */
  resetTransactionalData: async (actorId: string, actorRole?: string): Promise<{ success: boolean; summary: ResetSummary }> => {
    if (actorRole && actorRole !== 'SUPER_ADMIN') {
      throw new AuthorizationError('Only Super Admin can reset transactional data.');
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Panel remittances & allocations
      await tx.panelRemittanceAllocation.deleteMany();
      await tx.panelRemittance.deleteMany();

      // 2. Doctor commissions linked to invoices
      await tx.commissionPayout.deleteMany();
      await tx.commissionReversal.deleteMany();
      await tx.doctorCommissionAccrual.deleteMany();
      await tx.commissionCollectionEvent.deleteMany();

      // 3. Cashier shifts, settlements & payments
      await tx.settlementTransaction.deleteMany();
      const deletedAccountSettlements = await tx.accountSettlement.deleteMany();
      const deletedUserCashBalances = await tx.userCashBalance.deleteMany();
      const deletedPaymentReceipts = await tx.paymentReceipt.deleteMany();

      // 4. Provider settlements
      const deletedProviderSettlements = await tx.providerSettlement.deleteMany();

      // 5. Pharmacy dispenses & clearances linked to admissions/patients
      await tx.highCostMedicineAuthorization.deleteMany();
      await tx.pharmacyClearanceLine.deleteMany();
      const deletedPharmacyDispenseLines = await tx.pharmacyDispenseLine.deleteMany();
      const deletedPharmacyDispenses = await tx.pharmacyDispense.deleteMany();
      const deletedPharmacyClearances = await tx.pharmacyClearance.deleteMany();
      await tx.medicineStockLedger.deleteMany();

      // 5a. HMS↔Pharmacy inter-entity settlement tracking (pharmacy-bridge
      // module) — settlements reference charges (RESTRICT), charges
      // reference the admission record itself (RESTRICT), so both must go
      // before admissions are deleted in step 8.
      await tx.hmsPharmacySettlement.deleteMany();
      const deletedPharmacyCharges = await tx.hmsPharmacyCharge.deleteMany();

      // 5b. Admission room charge logs (references both admission records and invoice line items)
      await tx.admissionRoomChargeLog.deleteMany();
      await tx.hospitalDayClose.deleteMany();
      await tx.hospitalNotification.deleteMany();

      // 6. Invoices & line items
      const deletedInvoiceLines = await tx.invoiceLineItem.deleteMany();
      const deletedInvoices = await tx.hospitalInvoice.deleteMany();

      // 7. Appointments
      const deletedAppointments = await tx.appointment.deleteMany();

      // 8. Admissions and clinical discharge
      await tx.dischargeSummary.deleteMany();
      await tx.dualDischargeClearance.deleteMany();
      await tx.admissionPaymentRequest.deleteMany();
      await tx.bedTransferHistory.deleteMany();
      await tx.medicationModeHistory.deleteMany();
      const deletedAdmissions = await tx.admissionRecord.deleteMany();

      // 9. Self-pay encounters & Panel patients (with membership history)
      const deletedSelfPayEncounters = await tx.selfPayEncounter.deleteMany();
      await tx.panelMembershipHistory.deleteMany();
      const deletedPanelPatients = await tx.panelPatient.deleteMany();

      // 10. Corporate Panels & Discount Rules
      await tx.panelDiscountRule.deleteMany();
      const deletedCorporatePanels = await tx.corporatePanel.deleteMany();

      // 11. Main Cash Fund ledger (hospital's central physical cash reserve)
      const deletedMainCashFundEntries = await tx.mainCashFundEntry.deleteMany();

      // 1b. Newer expense, commission, and payroll runs
      await tx.expense.deleteMany();
      await tx.inventoryExpense.deleteMany();
      await tx.commissionAdjustment.deleteMany();
      await tx.commissionRun.deleteMany();
      await tx.payrollRun.deleteMany();

      // 1c. Department requisitions (must be deleted before StockItem and Department)
      await tx.departmentRequisitionLine.deleteMany();
      await tx.departmentRequisition.deleteMany();

      // 1d. Inventory stock, purchase orders & supplier ledger
      await tx.stockAdjustment.deleteMany();
      await tx.stockLedger.deleteMany();
      await tx.purchaseOrderLine.deleteMany();
      await tx.purchaseOrder.deleteMany();
      await tx.supplierLedger.deleteMany();
      await tx.stockItem.deleteMany();

      // 12. Staff HR data — attendance, payroll, and commission rows that
      // RESTRICT-block deleting the Staff row itself. Portal User login
      // accounts are deliberately left untouched (§16 Q-02: a login need not
      // outlive its Staff record, but this reset never removes credentials).
      await tx.attendanceCorrectionLog.deleteMany();
      await tx.attendanceRecord.deleteMany();
      await tx.salaryAdjustment.deleteMany();
      await tx.salaryPayment.deleteMany();
      await tx.salarySlip.deleteMany();
      await tx.staffEmploymentHistory.deleteMany();
      await tx.staffSalaryProfile.deleteMany();
      await tx.biometricRawPunch.deleteMany();
      await tx.doctorCommissionRule.deleteMany();
      await tx.staffService.deleteMany();
      await tx.staffDepartment.deleteMany();
      await tx.staffWeeklySchedule.deleteMany();
      await tx.staffBankAccount.deleteMany();

      // Disconnect all references to Staff before deleting Staff rows
      await tx.department.updateMany({ where: { headStaffId: { not: null } }, data: { headStaffId: null } });
      await tx.ward.updateMany({ where: { headStaffId: { not: null } }, data: { headStaffId: null } });
      await tx.portalUser.updateMany({ where: { staffId: { not: null } }, data: { staffId: null } });
      await tx.staff.updateMany({ where: { clinicalAuthUpdatedById: { not: null } }, data: { clinicalAuthUpdatedById: null } });

      // staffDepartments / staffServices / staffWeeklySchedule /
      // staffBankAccounts all CASCADE from Staff — no explicit delete needed.
      const deletedStaff = await tx.staff.deleteMany();

      // 13. Ward / Room / Bed hierarchy (must be deleted BEFORE Department because Ward references Department)
      const deletedBeds = await tx.bed.deleteMany();
      const deletedRooms = await tx.room.deleteMany();
      const deletedWards = await tx.ward.deleteMany();

      // 14. Department — unlink Services & Rates (kept, not deleted) then
      // clear the shifts that RESTRICT-block the department row.
      await tx.serviceRate.updateMany({ where: { departmentId: { not: null } }, data: { departmentId: null } });
      const deletedShifts = await tx.shift.deleteMany();
      const deletedDepartments = await tx.department.deleteMany();

      // 15. Record Audit Log entry (if actor exists as a PortalUser)
      const actorUser = actorId ? await tx.portalUser.findUnique({ where: { id: actorId } }) : null;
      if (actorUser) {
        await tx.auditLog.create({
          data: {
            actorId: actorUser.id,
            action: 'RESET_TRANSACTIONAL_DATA',
            entityType: 'SYSTEM',
            entityId: 'ALL',
            afterState: {
              deletedAppointments: deletedAppointments.count,
              deletedInvoices: deletedInvoices.count,
              deletedPaymentReceipts: deletedPaymentReceipts.count,
              deletedAdmissions: deletedAdmissions.count,
              deletedSelfPayEncounters: deletedSelfPayEncounters.count,
              deletedPanelPatients: deletedPanelPatients.count,
              deletedCorporatePanels: deletedCorporatePanels.count,
              deletedMainCashFundEntries: deletedMainCashFundEntries.count,
              deletedStaff: deletedStaff.count,
              deletedDepartments: deletedDepartments.count,
              deletedShifts: deletedShifts.count,
              deletedWards: deletedWards.count,
              deletedRooms: deletedRooms.count,
              deletedBeds: deletedBeds.count,
            },
          },
        });
      }

      return {
        success: true,
        summary: {
          appointments: deletedAppointments.count,
          invoices: deletedInvoices.count,
          invoiceLines: deletedInvoiceLines.count,
          paymentReceipts: deletedPaymentReceipts.count,
          userCashBalances: deletedUserCashBalances.count,
          accountSettlements: deletedAccountSettlements.count,
          providerSettlements: deletedProviderSettlements.count,
          admissions: deletedAdmissions.count,
          selfPayEncounters: deletedSelfPayEncounters.count,
          panelPatients: deletedPanelPatients.count,
          corporatePanels: deletedCorporatePanels.count,
          pharmacyClearances: deletedPharmacyClearances.count,
          pharmacyCharges: deletedPharmacyCharges.count,
          pharmacyDispenses: deletedPharmacyDispenses.count,
          pharmacyDispenseLines: deletedPharmacyDispenseLines.count,
          resetBeds: deletedBeds.count,
          mainCashFundEntries: deletedMainCashFundEntries.count,
          staff: deletedStaff.count,
          departments: deletedDepartments.count,
          shifts: deletedShifts.count,
          wards: deletedWards.count,
          rooms: deletedRooms.count,
        },
      };
    }, {
      maxWait: 30_000,
      timeout: 120_000,
    });
  },
};
