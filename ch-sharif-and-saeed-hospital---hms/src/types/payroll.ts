export type PayrollPeriodType = 'DAILY' | 'MONTHLY' | 'CUSTOM';
export type SalaryStatus = 'DRAFT' | 'GENERATED' | 'APPROVED' | 'PARTIALLY_PAID' | 'PAID';

export interface PayrollFilters {
  periodType: PayrollPeriodType;
  periodStart: string;
  periodEnd: string;
  departmentId?: string;
  category?: string;
}

export interface EligibleRow {
  staffId: string;
  fullName: string;
  employeeId: string;
  salaryBasis: string;
  scheduledPayableDays: number;
  attendanceEquivalentDays: number;
  periodBaseAmount: string;
  earnedBase: string;
  attendanceDeductions: string;
  allowances: string;
  grossAmount: string;
  tax: string;
  otherDeductions: string;
  netAmount: string;
}

export interface SkippedRow {
  staffId: string;
  fullName: string;
  employeeId: string;
  reason: string;
}

export interface PayrollPreview {
  eligible: EligibleRow[];
  skipped: SkippedRow[];
  totalAmount: string;
  staffCount: number;
}

export interface SalaryPayment {
  id: string;
  amount: string;
  method: string;
  reference: string | null;
  paidAt: string;
}

export interface SalarySlip {
  id: string;
  staffId: string;
  payrollRunId: string | null;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  baseAmount: string;
  attendanceDeductions: string;
  allowances: string;
  otherDeductions: string;
  generatedAmount: string;
  componentBreakdown?: { tax?: number; grossAmount?: number; earnedBase?: number } | null;
  status: SalaryStatus;
  staff: { id: string; fullName: string; employeeId: string };
  payments: SalaryPayment[];
}

export interface PayrollRun {
  id: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  department: { id: string; name: string } | null;
  category: string | null;
  status: 'GENERATED' | 'APPROVED';
  staffCount: number;
  totalAmount: string;
  skippedStaff: SkippedRow[];
  generatedByUser: { id: string; username: string } | null;
  generatedAt: string;
  approvedByUser: { id: string; username: string } | null;
  approvedAt: string | null;
  lines: SalarySlip[];
}
