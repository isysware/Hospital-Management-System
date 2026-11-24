/** The existing M04 recognition rule, shared by Hospital earnings reports.
 * Patient billing and collection allocation deliberately retain all streams.
 */
export const financialDepartmentSelect = { id: true, name: true, fulfillmentOwnership: true } as const;

export type FinancialDepartment = { id: string; name: string; fulfillmentOwnership?: string };
type Invoice = {
  status?: string;
  department?: FinancialDepartment | null;
  appointment?: { department?: FinancialDepartment | null } | null;
  admissionRecord?: { department?: FinancialDepartment | null } | null;
};
type Line = {
  billingSource?: string;
  isCompleted?: boolean;
  serviceRate?: { providerType?: string; department?: FinancialDepartment | null } | null;
};

export function hospitalServiceDepartment(line: Line, invoice: Invoice) {
  if (line.serviceRate?.department) return line.serviceRate.department;
  // The invoice header describes the encounter, not every service's owner.
  // A department-less internal service must not inherit an outsourced header.
  const outsourced = line.billingSource === 'OUTSOURCED_SERVICE' || line.serviceRate?.providerType === 'OUTSOURCED';
  const internal = !outsourced && (line.serviceRate?.providerType === 'INTERNAL'
    || (line.billingSource !== undefined && line.billingSource !== 'PHARMACY'));
  // Preserve Pharmacy's existing billing visibility; payable readers separately
  // remove its allocated share without distributing it to other services.
  if (line.billingSource === 'PHARMACY') return invoice.department ?? invoice.appointment?.department ?? invoice.admissionRecord?.department;
  return [invoice.department, invoice.appointment?.department, invoice.admissionRecord?.department]
    .find(department => department && (!internal || department.fulfillmentOwnership !== 'OUTSOURCED'));
}

export function isOutsourcedService(line: Line, invoice: Invoice): boolean {
  if (line.billingSource === 'PHARMACY') return false;
  return hospitalServiceDepartment(line, invoice)?.fulfillmentOwnership === 'OUTSOURCED'
    || line.serviceRate?.providerType === 'OUTSOURCED'
    || line.billingSource === 'OUTSOURCED_SERVICE';
}

export function isInternalHospitalEarning(line: Line, invoice: Invoice): boolean {
  return invoice.status !== 'VOID' && line.isCompleted === true
    && line.billingSource !== 'PHARMACY' && !isOutsourcedService(line, invoice);
}
