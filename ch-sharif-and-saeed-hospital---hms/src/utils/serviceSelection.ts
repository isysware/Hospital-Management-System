import type { Department } from '../types/department';
import type { HospitalService } from '../types/serviceRates';
export const HOSPITAL_SERVICE_SOURCE = 'HOSPITAL_SERVICES';
export const OUTSOURCED_SERVICE_SOURCE = 'OUTSOURCED_SERVICES';
export const NO_ACTIVE_DEPARTMENT_SERVICES = 'Select a department with active services.';
export function serviceSourceOptions(departments: Department[]) {
  return departments.filter(d => d.status === 'Active' && !d.pharmacyRelated && d.fulfillmentOwnership !== 'Outsourced').map(d => ({ label: d.name, value: d.id }));
}
export function selectionFromSource(source: string) {
  const [kind, departmentId, outsourcedProviderId] = source.split(':');
  if (kind === 'INTERNAL' || kind === 'OUTSOURCED') return { providerType: kind, departmentId, outsourcedProviderId: outsourcedProviderId || undefined } as const;
  return { providerType: source === OUTSOURCED_SERVICE_SOURCE ? 'OUTSOURCED' as const : 'INTERNAL' as const, departmentId: source === HOSPITAL_SERVICE_SOURCE || source === OUTSOURCED_SERVICE_SOURCE ? undefined : source };
}
export function servicesForSource(services: HospitalService[], source: string): HospitalService[] {
  const selection = selectionFromSource(source);
  if (!selection.departmentId) return [];
  return services.filter(s => s.status === 'Active' && s.selectable === true &&
    ['HOSPITAL_SERVICE', 'OUTSOURCED_SERVICE', 'LAB'].includes(s.billingSource ?? '') &&
    s.providerType === selection.providerType && s.departmentId === selection.departmentId &&
    (!selection.outsourcedProviderId || s.outsourcedProviderId === selection.outsourcedProviderId));
}
export function retainAvailableServiceIds(ids: string[], availableServices: HospitalService[]): string[] {
  const available = new Set(availableServices.map(s => s.id));
  const retained = ids.filter(id => available.has(id));
  return retained.length === ids.length ? ids : retained;
}
