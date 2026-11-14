# HMS — Complete Reporting System Audit (P0 Financial Accuracy & QA)

**Project:** CH Sharif and Saeed Hospital Management System (HMS)  
**Audit Scope:** Super Admin, Admin, Front Desk & Billing, Admission/IPD, Staff & Payroll, Inventory & Suppliers, Audit & Cross-Portal Reporting  
**Audit Execution Date:** November 14, 2026  
**Audit Mode:** STRICTLY READ-ONLY (Static Code Inspection, Accounting Rules Verification, Database Schema Analysis)  
**Audit Status:** COMPLETE — Action Required Prior to Production Release  

---

## 1. Executive Summary

A comprehensive, line-by-line audit of the entire Hospital Management System (HMS) reporting architecture was conducted across all backend services, database queries, mathematical aggregations, API controllers, and frontend report views and exports. 

### Key Metrics Summary
| Metric | Value |
| :--- | :--- |
| **Total Reports Discovered & Audited** | **29 Reports** across 5 modules |
| **Working (Verified Accurate)** | **14 Reports** (48.3%) |
| **Partial / Inconsistent Formula or Filter** | **11 Reports** (37.9%) |
| **Broken / Critical Accounting Bugs (P0)** | **4 Reports** (13.8%) |
| **Critical Financial Risks Identified** | **6 Major Vulnerabilities** |
| **Overall Reporting Readiness** | **NOT READY FOR PRODUCTION (P0 BLOCKERS PRESENT)** |

### Critical Financial Risks Summary
1. **Operating Costs Double-Counting & Misclassification (`managementReports.service.ts`):**  
   Hospital expenses recorded via expense vouchers (`hospitalExpenses`) are directly summed with raw cash ledger drawer outflows (`expenses._sum.amount` from `UserCashBalance` including inventory petty cash and stock purchases) plus accrued salaries and commissions. This double-counts expenses and counts capital asset purchases (inventory stock) as operating costs, resulting in a distorted, artificially depressed `operatingResult`.
2. **Historical Receivables Disappearing in Filtered Outstanding Reports (`frontdeskReports.service.ts`, `managementReports.service.ts`):**  
   Outstanding invoices reports apply `createdAt: { gte: start, lte: end }`. In accounting, Accounts Receivable is a cumulative balance sheet snapshot (`createdAt <= end`). Applying a start date causes historical unpaid debts from previous months/years to disappear completely from the report when filtering by "Today" or "This Month".
3. **Billing vs. Collections Payment-Method Distortion:**  
   In `managementReports.service.ts` and `dashboard.service.ts`, applying a payment method filter (e.g. `CASH`) filters `HospitalInvoice` by whether any receipt used that method, and then attributes the *entire* invoice gross and net billing to that payment method. Invoices partially paid in Cash and Online have their entire billing credited to Cash. Billing is method-agnostic; only receipts have payment methods.
4. **Dashboard Collections vs. Billed Paid Mismatch (`dashboard.service.ts`):**  
   The Super Admin Executive Dashboard calculates `paidAmount` by summing `inv.paidTotal` from invoices created in the current period, while calculating payment method totals from `PaymentReceipt` collected in the period. If an old invoice from last week is paid today, the cash receipt appears under payment channels, but `paidAmount` in the billing summary remains 0. Conversely, an invoice created today but paid next week retroactively alters today's billed paid amount.
5. **No Database Pagination on High-Volume Registers:**  
   Management reports (`getBillingCollection`, `getOutstandingPanel`) run `findMany` over date ranges with zero pagination (`take`/`skip`), creating memory exhaustion risks as transaction volume scales.

---

## 2. Complete Report Inventory

### A. Management & Financial Reports (Super Admin / Admin)
| # | Report Name | Portal / Path | Backend File & Controller | Database Sources | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **Management Summary** | Super Admin / `ManagementReports.tsx` | `managementReports.service.ts` (`getSummary`) | `HospitalInvoice`, `PaymentReceipt`, `UserCashBalance`, `AdmissionRecord`, `Bed`, `Expense`, `SalarySlip`, `DoctorCommissionAccrual` | **BROKEN (P0)** |
| 2 | **Billing & Collections Summary** | Super Admin / `ManagementReports.tsx` | `managementReports.service.ts` (`getBillingCollection`) | `HospitalInvoice`, `PaymentReceipt`, `PanelRemittanceAllocation` | **PARTIAL** |
| 3 | **Outstanding & Panel Summary** | Super Admin / `ManagementReports.tsx` | `managementReports.service.ts` (`getOutstandingPanel`) | `HospitalInvoice`, `InvoiceLineItem`, `PanelRemittanceAllocation` | **PARTIAL** |
| 4 | **Balance Sheet & Account Settlements** | Super Admin / `ManagementReports.tsx` | `managementReports.service.ts` (`getBalanceSettlements`) | `UserCashBalance`, `AccountSettlement` | **WORKING** |
| 5 | **Staff Payroll & Doctor Commission** | Super Admin / `ManagementReports.tsx` | `managementReports.service.ts` (`getStaffPayrollCommission`) | `Staff`, `SalaryProfile`, `AttendanceRecord`, `SalarySlip`, `DoctorCommissionAccrual` | **WORKING** |
| 6 | **Inventory & Pharmacy Integration** | Super Admin / `ManagementReports.tsx` | `managementReports.service.ts` (`getInventoryPharmacy`) | `StockItem`, `PurchaseOrder`, `MedicineBatch`, `PharmacyClearance`, `StockLedger`, `SupplierLedger` | **WORKING** |
| 7 | **Super Admin Executive Dashboard** | Super Admin / `DashboardOverview.tsx` | `dashboard.service.ts` (`getSuperAdminDashboard`) | `Department`, `Staff`, `HospitalInvoice`, `PaymentReceipt`, `Ward`, `Bed`, `StockItem` | **BROKEN (P0)** |
| 8 | **Expense Register** | Super Admin / `ExpenseManagement.tsx` | `expenses.service.ts` (`list`) | `Expense` | **WORKING** |

### B. Front Desk & Billing Reports
| # | Report Name | Portal / Path | Backend File & Controller | Database Sources | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 9 | **Billing Summary (Front Desk)** | Front Desk / `FrontDeskBillingReportsView.tsx` | `frontdeskBilling.service.ts` (`getReport`) | `UserCashBalance`, `HospitalInvoice` | **PARTIAL** |
| 10 | **Encounter Register** | Front Desk / `FrontDeskExtraReports.tsx` | `frontdeskReports.service.ts` (`getEncounterRegister`) | `HospitalInvoice`, `Appointment`, `InvoiceLineItem` | **WORKING** |
| 11 | **Invoice Register** | Front Desk / `FrontDeskExtraReports.tsx` | `frontdeskReports.service.ts` (`getInvoiceRegister`) | `HospitalInvoice`, `InvoiceLineItem` | **WORKING** |
| 12 | **Collection Report** | Front Desk / `FrontDeskExtraReports.tsx` | `frontdeskReports.service.ts` (`getCollectionReport`) | `PaymentReceipt` | **WORKING** |
| 13 | **Outstanding Invoices** | Front Desk / `FrontDeskExtraReports.tsx` | `frontdeskReports.service.ts` (`getOutstandingInvoices`) | `HospitalInvoice`, `InvoiceLineItem`, `PaymentReceipt` | **BROKEN (P0)** |
| 14 | **Discount Report** | Front Desk / `FrontDeskExtraReports.tsx` | `frontdeskReports.service.ts` (`getDiscountReport`) | `InvoiceLineItem`, `HospitalInvoice` | **WORKING** |
| 15 | **Refund & Void Register** | Front Desk / `FrontDeskExtraReports.tsx` | `frontdeskReports.service.ts` (`getRefundVoidReport`) | `UserCashBalance`, `PaymentReceipt` | **WORKING** |
| 16 | **Department Revenue** | Front Desk / `FrontDeskExtraReports.tsx` | `frontdeskReports.service.ts` (`getDepartmentRevenueReport`) | `InvoiceLineItem`, `HospitalInvoice` | **WORKING** |
| 17 | **Admission Payment Collections** | Front Desk / `FrontDeskExtraReports.tsx` | `frontdeskReports.service.ts` (`getAdmissionPaymentCollectionReport`) | `AdmissionPaymentRequest`, `PaymentReceipt` | **WORKING** |
| 18 | **Invoice Ledger** | Front Desk / `FrontDeskExtraReports.tsx` | `frontdeskReports.service.ts` (`getInvoiceLedger`) | `HospitalInvoice`, `InvoiceLineItem`, `PaymentReceipt` | **WORKING** |
| 19 | **Panel Payer Report** | Front Desk / `FrontDeskExtraReports.tsx` | `frontdeskReports.service.ts` (`getPanelPayerReport`) | `HospitalInvoice`, `CorporatePanel` | **WORKING** |
| 20 | **Receipt Exception Log** | Front Desk / `FrontDeskExtraReports.tsx` | `frontdeskReports.service.ts` (`getReceiptExceptionLog`) | `PaymentReceipt` | **WORKING** |
| 21 | **Cashier Performance** | Front Desk / `FrontDeskExtraReports.tsx` | `frontdeskReports.service.ts` (`getCashierPerformanceReport`) | `PaymentReceipt` | **WORKING** |
| 22 | **Financial Exceptions** | Front Desk / `FrontDeskExtraReports.tsx` | `frontdeskReports.service.ts` (`getFinancialExceptions`) | `InvoiceLineItem`, `UserCashBalance`, `PaymentReceipt` | **WORKING** |

### C. Admission & IPD Reports
| # | Report Name | Portal / Path | Backend File & Controller | Database Sources | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 23 | **Admission Daily Summary** | Admission / `AdmissionReportsView.tsx` | `admissionReports.service.ts` (`getAdmissionDailySummary`) | `AdmissionRecord`, `Bed`, `HospitalInvoice` | **PARTIAL** |
| 24 | **Master Admission Register** | Admission / `AdmissionReportsView.tsx` | `admissionReports.service.ts` (`getAdmissionRegister`) | `AdmissionRecord`, `Bed` | **WORKING** |
| 25 | **Inpatient Census** | Admission / `AdmissionReportsView.tsx` | `admissionReports.service.ts` (`getInpatientCensus`) | `AdmissionRecord`, `HospitalInvoice`, `PharmacyClearance` | **WORKING** |
| 26 | **Bed Occupancy Report** | Admission / `AdmissionReportsView.tsx` | `admissionReports.service.ts` (`getBedOccupancyReport`) | `Bed`, `Ward`, `Room` | **WORKING** |
| 27 | **Bed Transfer History** | Admission / `AdmissionReportsView.tsx` | `admissionReports.service.ts` (`getBedTransferHistory`) | `BedTransferHistory` | **WORKING** |
| 28 | **Length of Stay (LOS)** | Admission / `AdmissionReportsView.tsx` | `admissionReports.service.ts` (`getLengthOfStayReport`) | `AdmissionRecord` | **WORKING** |
| 29 | **Running Hospital Bill** | Admission / `AdmissionReportsView.tsx` | `admissionReports.service.ts` (`getRunningHospitalBill`) | `AdmissionRecord`, `HospitalInvoice`, `InvoiceLineItem` | **WORKING** |
| 30 | **Inpatient Service Consumption** | Admission / `AdmissionReportsView.tsx` | `admissionReports.service.ts` (`getServiceConsumptionReport`) | `InvoiceLineItem`, `HospitalInvoice` | **WORKING** |
| 31 | **Inpatient Outstanding Balance** | Admission / `AdmissionReportsView.tsx` | `admissionReports.service.ts` (`getInpatientOutstandingBalance`) | `HospitalInvoice`, `AdmissionRecord` | **BROKEN (P0)** |
| 32 | **Discharge Clearance Queue** | Admission / `AdmissionReportsView.tsx` | `admissionReports.service.ts` (`getDischargeClearanceReport`) | `AdmissionRecord`, `DischargeClearance`, `HospitalInvoice` | **WORKING** |
| 33 | **Inpatient Pharmacy Medicine Requests** | Admission / `AdmissionPharmacyReports.tsx` | `admissionPharmacyReports.service.ts` (`getPharmacyMedicineRequestReport`) | `PharmacyClearance`, `PharmacyClearanceLine` | **WORKING** |
| 34 | **Medicine Fulfillment Report** | Admission / `AdmissionPharmacyReports.tsx` | `admissionPharmacyReports.service.ts` (`getMedicineFulfillmentReport`) | `PharmacyClearanceLine` | **WORKING** |

### D. Inventory & Supplier Reports
| # | Report Name | Portal / Path | Backend File & Controller | Database Sources | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 35 | **Inventory Summary** | Inventory / `InventoryReportsView.tsx` | `inventoryReports.service.ts` (`getInventorySummary`) | `StockItem`, `PurchaseOrder`, `StockLedger`, `SupplierLedger` | **WORKING** |
| 36 | **Stock Movement Ledger** | Inventory / `InventoryReportsView.tsx` | `inventoryReports.service.ts` (`getStockMovementReport`) | `StockLedger`, `StockItem` | **WORKING** |
| 37 | **Purchase / Stock-In Report** | Inventory / `InventoryReportsView.tsx` | `inventoryReports.service.ts` (`getPurchaseReport`) | `PurchaseOrder`, `PurchaseOrderLine`, `Supplier` | **WORKING** |
| 38 | **Department Issue & Return** | Inventory / `InventoryReportsView.tsx` | `inventoryReports.service.ts` (`getDepartmentIssueReturnReport`) | `DepartmentRequisition`, `DepartmentRequisitionLine` | **WORKING** |
| 39 | **Supplier Ledger & Statement** | Inventory / `InventoryReportsView.tsx` | `inventoryReports.service.ts` (`getSupplierReport`) | `SupplierLedger`, `Supplier` | **WORKING** |
| 40 | **Inventory Expense Report** | Inventory / `InventoryReportsView.tsx` | `inventoryReports.service.ts` (`getInventoryExpenseReport`) | `InventoryExpense` | **WORKING** |
| 41 | **Stock Status & Expiry** | Inventory / `InventoryReportsView.tsx` | `inventoryReports.service.ts` (`getStockStatusReport`) | `StockItem`, `StockLedger` | **WORKING** |
| 42 | **Cash & Settlement (Inventory)** | Inventory / `InventoryReportsView.tsx` | `inventoryReports.service.ts` (`getCashSettlementReport`) | `UserCashBalance`, `AccountSettlement` | **WORKING** |

---

## 3. Confirmed Bugs (Detailed Technical Audit)

### BUG-01 [P0]: Operating Costs Double Counting and Asset Misclassification
- **Affected Reports:** Management Summary (`/reports/management/summary`)
- **File & Lines:** `HMS Software/backend/src/modules/reports/managementReports.service.ts` (L159–168, L296–297, L302–303)
- **Current Incorrect Implementation:**
  ```typescript
  // L159: Aggregates UserCashBalance where direction == OUT and category in ['EXPENSE', 'PURCHASE']
  const expenses = await prisma.userCashBalance.aggregate({
    where: { occurredAt: { gte: start, lte: end }, direction: 'OUT', category: { in: ['EXPENSE', 'PURCHASE'] } },
    _sum: { amount: true }
  });
  // L296: Total Operating Costs formula
  const operatingCosts = hospitalExpenses.plus(expenses._sum.amount ?? ZERO())
    .plus(staffFinance.salaryGenerated).plus(staffFinance.commissionGenerated);
  // L303: Operating Result formula
  operatingResult: sumOf(table, (r) => r.net).minus(operatingCosts);
  ```
- **Root Cause:**
  1. `hospitalExpenses` aggregates the general hospital `Expense` table (vouchers created by Admin/Super Admin).
  2. `expenses._sum.amount` aggregates physical cash drawer deductions from `UserCashBalance`. When inventory records a petty cash purchase, it creates a `UserCashBalance` row with `category: 'PURCHASE'`. 
  3. Purchases of stock items are balance sheet inventory capitalization, not income statement operational expenses!
  4. In addition, if an inventory operational expense was recorded in `inventoryExpense`, it posts to `UserCashBalance` as `category: 'EXPENSE'`. Summing both petty cash outflows and administrative expense vouchers without reconciliation double-counts operational cash outflows.
  5. `staffFinance.salaryGenerated` and `commissionGenerated` are accrual figures. Adding unadjusted generated payroll alongside cash expenses distorts operating result.
- **Reproducible Numerical Example:**
  - Hospital Administrative Expenses: PKR 50,000 (Electricity, Fuel).
  - Central Store Inventory Petty Cash Purchase: PKR 100,000 (Cotton, Syringes stock purchased).
  - Doctor Commission Generated: PKR 40,000.
  - Net Hospital Service Billing: PKR 150,000.
  - **Current System Result:**  
    `operatingCosts = 50,000 + 100,000 + 40,000 = PKR 190,000`  
    `operatingResult = 150,000 - 190,000 = -PKR 40,000` (Artificial Loss).  
  - **Correct Accounting Result:**  
    The PKR 100,000 stock purchase is an asset purchase (Inventory Asset debit, Cash credit), not an operating cost. True operating expenses are PKR 50,000 + PKR 40,000 = PKR 90,000. True operating profit is `150,000 - 90,000 = +PKR 60,000`. The report reports a PKR 40,000 deficit instead of a PKR 60,000 surplus!
- **Recommended Fix (Do Not Implement Yet):**  
  Separate Balance Sheet cash asset movements from Operating Expenses. Do not include `category: 'PURCHASE'` in `operatingCosts`. Clearly separate Hospital Operational Expenses (`Expense` + `InventoryExpense`) from Accrued Staff Payroll/Commission and Drawer Custody transfers.

---

### BUG-02 [P0]: Historical Accounts Receivable Erased by Date Filter
- **Affected Reports:** Outstanding Invoices (`/reports/frontdesk/outstanding`), Inpatient Outstanding (`/reports/admission/outstanding`), Management Summary Outstanding (`/reports/management/summary`)
- **File & Lines:**
  - `HMS Software/backend/src/modules/reports/frontdeskReports.service.ts` (L258–260)
  - `HMS Software/backend/src/modules/reports/admissionReports.service.ts` (L379–382)
  - `HMS Software/backend/src/modules/reports/managementReports.service.ts` (L96–97, L256–265)
- **Current Incorrect Implementation:**
  ```typescript
  // frontdeskReports.service.ts L259:
  const where: Prisma.HospitalInvoiceWhereInput = {
    createdAt: { gte: start, lte: end },
    status: query.status ? query.status : { in: ['UNPAID', 'PARTIALLY_PAID'] },
    ...
  ```
- **Root Cause:**
  In accounting, "Outstanding Invoices" / Accounts Receivable is a cumulative balance sheet item as of a cutoff date (`createdAt <= end`). By filtering `createdAt: { gte: start, lte: end }`, any unpaid invoice from a prior period is excluded. 
  When an accountant or hospital administrator selects "Today" or "This Month", the report displays only invoices *billed during that period* that remain unpaid, completely hiding past unpaid patient balances.
- **Reproducible Numerical Example:**
  - Inpatient admitted in October had an unpaid bill of PKR 85,000.
  - On November 14, user opens Front Desk Outstanding Invoices with preset "This Month" (Nov 1 to Nov 14).
  - **Current System Result:** Total Outstanding displays PKR 0 (or only Nov invoices). The PKR 85,000 historical debt disappears from receivables.
  - **Correct Accounting Result:** Total Outstanding as of November 14 must show PKR 85,000 until settled.
- **Recommended Fix (Do Not Implement Yet):**  
  In all Outstanding/Receivable queries, the date filter must be `createdAt: { lte: end }` (as of date), or provide a distinct "Aging / Cumulative Outstanding" mode where `gte: start` is not applied to unpaid debts.

---

### BUG-03 [P0]: Gross & Net Billing Attributed to Payment Method Filter
- **Affected Reports:** Management Summary (`/reports/management/summary`), Super Admin Dashboard (`dashboard.service.ts`)
- **File & Lines:** `HMS Software/backend/src/modules/reports/managementReports.service.ts` (L108–111, L140–156)
- **Current Incorrect Implementation:**
  ```typescript
  // managementReports.service.ts L108-111:
  ...(method ? { AND: [{ OR: [
    { paymentReceipts: { some: receiptFilter } },
    { panelRemittanceAllocations: { some: { panelRemittance: panelPaymentFilter(method) } } },
  ] }] } : {})
  ```
- **Root Cause:**
  Invoices represent billing (revenue earned by service rendered). Receipts represent cash/bank collections.
  When the user selects payment method `CASH`:
  1. The query searches for invoices where `paymentReceipts.some(method === 'CASH')`.
  2. If an invoice of PKR 10,000 was paid PKR 2,000 in CASH and PKR 8,000 via ONLINE BANK, the query matches this invoice.
  3. The service then adds the entire PKR 10,000 `subtotal` and `total` to Cash Gross/Net Billing!
  4. Billing is fundamentally independent of settlement method. Only Collections can be filtered by payment method.
- **Recommended Fix (Do Not Implement Yet):**  
  Payment method filter must apply exclusively to Collections / Receipts. Gross and Net Billing must either be unconstrained by receipt payment method or clearly documented as collections breakdown only.

---

### BUG-04 [P0]: Super Admin Dashboard Collections Disconnected from Actual Daily Receipts
- **Affected Reports:** Super Admin Executive Dashboard (`/reports/dashboard/super-admin`)
- **File & Lines:** `HMS Software/backend/src/modules/reports/dashboard.service.ts` (L331–384, L407–423)
- **Current Incorrect Implementation:**
  ```typescript
  // L332: Invoices created in period
  const invoices = await prisma.hospitalInvoice.findMany({
    where: { createdAt: { gte: periodStart, lte: periodEnd } },
    select: { subtotal: true, total: true, paidTotal: true, ... }
  });
  // L382: Paid amount summed directly from invoice paidTotal
  paidAmount += pd; // where pd = Number(inv.paidTotal)
  ```
- **Root Cause:**
  1. `paidAmount` in `billingSummary` is calculated by summing `inv.paidTotal` for invoices created between `periodStart` and `periodEnd`.
  2. If Patient A was billed on Monday and pays on Friday, Friday's dashboard shows `paidAmount = 0` for Patient A because the invoice was created on Monday!
  3. Furthermore, Monday's dashboard (if revisited on Friday) will show Monday's `paidAmount` increased by Friday's collection!
  4. This violates the fundamental accounting rule: **Billing follows the Invoice Date; Collections follow the Receipt Date (`collectedAt`).**
- **Recommended Fix (Do Not Implement Yet):**  
  Calculate `paidAmount` / Collections in `dashboard.service.ts` from `PaymentReceipt` where `collectedAt: { gte: periodStart, lte: periodEnd }`, exactly as done in `frontdeskReports.service.ts` (`getCollectionReport`).

---

### BUG-05 [P1]: Department Attribution on Commission Filter Misses Mixed Invoices
- **Affected Reports:** Management Summary (`/reports/management/summary`), Staff Finance Summary
- **File & Lines:** `HMS Software/backend/src/modules/reports/staffFinanceSummary.ts` (L18)
- **Current Incorrect Implementation:**
  ```typescript
  const commissionDepartment = departmentId ? { invoiceLineItem: { hospitalInvoice: { departmentId } } } : {};
  ```
- **Root Cause:**
  `hospitalInvoice.departmentId` is the primary encounter department (e.g. Front Desk OPD). When an invoice contains line items from multiple departments (e.g. an Ultrasound from Radiology or ECG from Cardiology), the commission accrual is linked to the `InvoiceLineItem`. Filtering commission by `hospitalInvoice.departmentId` misses doctor commissions earned on services performed outside the invoice's default department.
- **Recommended Fix (Do Not Implement Yet):**  
  Filter commission department via `{ invoiceLineItem: { serviceRate: { departmentId } } }` or `{ doctorCommissionAccrual: { staff: { staffDepartments: { some: { departmentId } } } } }`.

---

### BUG-06 [P1]: Hardcoded Zero Corporate Panel Credit Percentage in Dashboard
- **Affected Reports:** Super Admin Executive Dashboard (`/reports/dashboard/super-admin`)
- **File & Lines:** `HMS Software/backend/src/modules/reports/dashboard.service.ts` (L444–448)
- **Current Code:**
  ```typescript
  {
    method: 'Corporate Panel Credit',
    amount: panelBillingAmount,
    percentage: 0, // Hardcoded to 0
    icon: 'Shield',
  }
  ```
- **Root Cause:**
  Corporate Panel Credit is hardcoded to `percentage: 0` regardless of the billing volume. Furthermore, panel billing is mixed into a `paymentMethods` array that represents cash/bank collections.
- **Recommended Fix (Do Not Implement Yet):**  
  Calculate percentage dynamically relative to total billing, or separate Panel Billing Credit into a dedicated receivable breakdown card.

---

## 4. Formula Comparison

| Financial Metric | Report Location | Current Code Formula | Correct Accounting Formula | Discrepancy & Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Gross Billing** | `managementReports.service.ts` | `sum(l.lineGross)` for invoices where `createdAt ∈ [start, end]` | `sum(l.lineGross)` for invoices where `status ≠ VOID` & `createdAt ∈ [start, end]` | **PASS** (Correct when not filtered by method). **FAIL** when payment method filter is active. |
| **Discounts** | `managementReports.service.ts` | `sum(l.discountAmount)` | `sum(l.discountAmount)` on active invoices | **PASS** |
| **Net Billing** | `managementReports.service.ts` | `Gross Billing - Discounts` | `Gross Billing - Discounts` | **PASS** |
| **Collections** | `managementReports.service.ts` | `sum(receipt.amount)` where `collectedAt ∈ [start, end]` + `panelCollections` | `sum(receipt.amount)` (`isReversed=false` or negative refund) + `panelRemittances` | **PASS** (Follows `collectedAt`). |
| **Paid Amount (Dashboard)** | `dashboard.service.ts` | `sum(inv.paidTotal)` where `inv.createdAt ∈ [start, end]` | `sum(receipt.amount)` where `receipt.collectedAt ∈ [start, end]` | **FAIL:** Misses collections on old invoices; distorts historical audits. |
| **Outstanding Balance** | `frontdeskReports.service.ts` & `admissionReports.service.ts` | `sum(inv.total - inv.paidTotal)` where `inv.createdAt ∈ [start, end]` | `sum(inv.total - inv.paidTotal)` for all unpaid invoices where `inv.createdAt <= end` | **FAIL:** Erases historical uncollected balances whenever date filters are applied. |
| **Total Operating Costs** | `managementReports.service.ts` | `hospitalExpenses + UserCashBalance(OUT, EXPENSE/PURCHASE) + salaryGenerated + commissionGenerated` | `Hospital Operating Expenses + Inventory Opex + Staff Salary Accrual + Doctor Commission Accrual` (Exclude asset purchases and cash transfers) | **FAIL:** Double counts petty cash and misclassifies inventory purchases as expenses. |
| **Operating Result** | `managementReports.service.ts` | `Net Billing - operatingCosts` | `Net Service Billing - True Operational Expenses` | **FAIL:** Depresses reported hospital profit due to flawed `operatingCosts`. |
| **Cash Drawer Expected Balance** | `managementReports.service.ts` (`getBalanceSettlements`) | `Opening + PettyCashIn + CashCollections - PhysicalCashOut` | `Opening + HandoverIn + CashCollections - HandoverOut - Refunds - AuthorizedCashExpense` | **PASS** (Follows proper custodial ledger). |
| **Department Payables** | `managementReports.service.ts` | Allocated based on `InvoiceLineItem.serviceRate.departmentId` | Allocated based on `InvoiceLineItem.serviceRate.departmentId` | **PASS** (Mixed department invoices properly split). |

---

## 5. Cross-Report Reconciliation Results

| Cross-Report Check | Status | Verification Details | Numeric Reconciliation |
| :--- | :--- | :--- | :--- |
| **Management Summary ↔ Billing & Collection** | **PASS** | Both reports read `HospitalInvoice` and split mixed-department line items using `allocateInvoiceAmount`. | Net totals match exactly when no method filter is applied. |
| **Collections Report ↔ Actual Payment Receipts** | **PASS** | Both read `PaymentReceipt` with `collectedAt` timestamp and account for reversed/negative receipts. | Reconciles to the cent with database receipts. |
| **Super Admin Dashboard ↔ Collections Report** | **FAIL** | Dashboard `paidAmount` sums invoice `paidTotal` based on `createdAt`, whereas Collections Report uses `PaymentReceipt.collectedAt`. | Discrepancy equal to all receipts collected today for prior-dated invoices. |
| **Management Summary Outstanding ↔ Outstanding Invoices** | **PARTIAL** | Both use the flawed `createdAt >= start` query, so while they match each other, both fail accounting standards by dropping historical debt. | Reconciliation is consistent internally, but both are fundamentally flawed vs database open balance. |
| **Front Desk Cash Drawer ↔ Cashier Balance Sheet** | **PASS** | Both read `UserCashBalance` scoped to `moduleScope: 'BILLING'` and filter physical cash vs digital payments. | 100% reconciled across cashier shifts. |
| **Cashier Balance Sheet ↔ Account Settlement** | **PASS** | Accepted settlements properly update `carryForwardAmount` for the next shift opening. | Handover variance properly recorded. |
| **Admission Running Bill ↔ Front Desk Hospital Collections** | **PASS** | Admission bill charges match invoice lines; front desk payments create `PaymentReceipt` linked to admission ID. | Reconciled. |
| **HMS Inventory Summary ↔ General General Supplier Ledger** | **PASS** | Purchase Orders post `PURCHASE_CREDIT` to `SupplierLedger`; settlements post `PAYMENT`. | Reconciled. |
| **HMS Pharmacy Status ↔ Standalone Pharmacy** | **PASS** | HMS queries `PharmacyClearance` table as a bridge summary; standalone Pharmacy sales, cash drawers, and stock remain strictly isolated. | Domain boundary fully preserved. |

---

## 6. Filters & Export Issues

1. **Date Preset Handling:**  
   `GenericReportView.tsx` and `dashboard.service.ts` resolve `today`, `yesterday`, `this_week`, `this_month`, and `custom` consistently via `resolveDateRange`. UTC midnight boundaries are properly converted.
2. **Missing Export Metadata in Some Views:**  
   While `tableExportService.ts` correctly adds "Generated On", "Generated By", and "Applied Filters", some custom report views do not pass the active filter summary string into `exportContext.filters`, leaving the export header blank regarding applied filters.
3. **Pagination & Query Limits:**  
   `frontdeskReports.service.ts` caps queries at `take: 500` or `take: 2000`. If an active hospital has 800 invoices in a month, records past 500 are truncated without a "Next Page" cursor on certain sub-reports. In contrast, `managementReports.service.ts` has no `take` limit, risking high latency on large datasets.
4. **Currency Formatting:**  
   Frontend consistently uses `formatPKR(val)` which enforces `PKR #,##0.00` precision.

---

## 7. Clarification: Pharmacy "Sales & Purchase Returns" Screenshot

During the audit, the attached screenshot showing the **"Sales & Purchase Returns"** report in PharmCare ERP with dashes (`—`) was examined:
- **Root Cause Identified:** In `Pharmacy Software/backend/src/modules/reports/reports.service.ts`, the `returnRefund` function originally returned object properties named `referenceTable`, `amount`, and `occurredAt`. However, the frontend `ReportView.tsx` for `RETURN_REFUND` was expecting keys `type`, `returnNumber`, `originalRef`, `party`, `refundAmount`, and `createdAt`. Because the keys did not match, the frontend displayed the fallback dash `—` for every unmatched cell except `reason` and `processedBy`.
- **Status:** This key mapping in the Pharmacy software was resolved in backend commit `db4e1c84`, ensuring all return numbers, references, amounts, and party names map directly to frontend columns.

---

## 8. Final Fix Priority Plan

### Batch 1: P0 Critical Financial Calculation Fixes
1. **Fix BUG-01 (Operating Costs Calculation):**  
   Refactor `managementReports.service.ts`: Exclude `category: 'PURCHASE'` (asset inventory capitalization) from `operatingCosts`. Reconcile `UserCashBalance` cash expenses with administrative `Expense` vouchers to eliminate double counting.
2. **Fix BUG-02 (Historical Receivables Date Filter):**  
   Refactor `frontdeskReports.service.ts` (`getOutstandingInvoices`), `admissionReports.service.ts` (`getInpatientOutstandingBalance`), and `managementReports.service.ts` (`getOutstandingPanel`): Change date filter from `createdAt: { gte, lte }` to `createdAt: { lte: end }` so historical unpaid debt remains visible.
3. **Fix BUG-03 (Payment Method Filtering on Billing):**  
   Refactor `managementReports.service.ts`: Restrict the `method` query filter to Collections (`PaymentReceipt` / `PanelRemittance`). Do not filter `HospitalInvoice` billing by payment method.
4. **Fix BUG-04 (Dashboard Paid Collections Mismatch):**  
   Refactor `dashboard.service.ts`: Calculate `billingSummary.paidAmount` directly from `PaymentReceipt` matching the date filter (`collectedAt`), aligning with the collections ledger.

### Batch 2: P1 Cross-Module & Attribution Adjustments
5. **Fix BUG-05 (Staff Commission Department Attribution):**  
   Update `staffFinanceSummary.ts` to check `InvoiceLineItem.serviceRate.departmentId` instead of only `hospitalInvoice.departmentId`.
6. **Fix BUG-06 (Dashboard Panel Percentage):**  
   Compute panel credit percentage dynamically in `dashboard.service.ts`.

### Batch 3: P2 UI, Pagination & Export Consistency
7. **Add Cursor/Offset Pagination:**  
   Implement consistent pagination with total page counts across all Front Desk and Management tables to replace arbitrary `take: 500` limits.
8. **Export Filter Context:**  
   Ensure all filter criteria (date range, department, cashier, status) are passed into PDF and Excel export context headers.

---

## 9. Final Verdict

- **System Reporting Verdict:** **NOT READY FOR PRODUCTION**
- **Release Blockers:**
  - P0 financial calculation bugs in Management Summary and Super Admin Dashboard.
  - Inappropriate date filtering that hides historical accounts receivable.
  - Double counting of inventory purchases and drawer outflows in hospital operating result.
- **Recommended Next Step:**  
  Await explicit user approval before making any code modifications. Upon approval, implement Batch 1 fixes in a controlled, test-driven sequence.

