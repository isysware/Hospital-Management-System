import { describe, expect, it } from 'vitest';
import { servicesForSource, retainAvailableServiceIds, HOSPITAL_SERVICE_SOURCE, OUTSOURCED_SERVICE_SOURCE } from '../../ch-sharif-and-saeed-hospital---hms/src/utils/serviceSelection';
import type { HospitalService } from '../../ch-sharif-and-saeed-hospital---hms/src/types/serviceRates';
const service = (id: string, patch: Partial<HospitalService> = {}): HospitalService => ({
  id, code: id, name: id, departmentId: 'ward', departmentName: 'General Ward',
  providerType: 'INTERNAL', billingSource: 'HOSPITAL_SERVICE', selectable: true,
  category: 'Nursing', standardRate: 500, currency: 'PKR', billingUnit: 'Per Procedure',
  panelEligible: false, manualRateOverrideAllowed: false, discountAllowed: true,
  status: 'Active', createdBy: '', updatedBy: '', createdAt: '', updatedAt: '', ...patch,
});
const catalog = [
  service('Dressing'), service('Nebulization'), service('Injection Administration'),
  service('Inactive', { status: 'Inactive' }), service('Other ward', { departmentId: 'other' }),
  service('Internal CT', { category: 'Radiology', serviceStream: 'LAB' }),
  service('External CT', { providerType: 'OUTSOURCED', billingSource: 'OUTSOURCED_SERVICE', departmentId: 'radiology', outsourcedProviderId: 'abc' }),
  service('Other Provider CT', { providerType: 'OUTSOURCED', billingSource: 'OUTSOURCED_SERVICE', departmentId: 'radiology', outsourcedProviderId: 'other' }),
  ...['PHARMACY', 'DOCTOR_CHARGE', 'ROOM_BED'].map(billingSource => service(billingSource, { billingSource, selectable: false })),
];
describe('Admission and shared service-selection rules', () => {
  it('requires a department after selecting either source', () => {
    expect(servicesForSource(catalog, HOSPITAL_SERVICE_SOURCE)).toEqual([]);
    expect(servicesForSource(catalog, OUTSOURCED_SERVICE_SOURCE)).toEqual([]);
  });
  it('selects only active internal services of the chosen department', () => {
    expect(servicesForSource(catalog, 'INTERNAL:ward:').map(s => s.id)).toEqual(['Dressing', 'Nebulization', 'Injection Administration', 'Internal CT']);
  });
  it('uses provider classification independently of LAB/HOSPITAL stream', () => {
    expect(servicesForSource(catalog, 'INTERNAL:ward:').some(s => s.id === 'Internal CT')).toBe(true);
  });
  it('selects only the selected outsourced provider and department', () => {
    expect(servicesForSource(catalog, 'OUTSOURCED:radiology:abc').map(s => s.id)).toEqual(['External CT']);
    expect(servicesForSource(catalog, 'OUTSOURCED:ward:abc')).toEqual([]);
  });
  it.each(['PHARMACY', 'DOCTOR_CHARGE', 'ROOM_BED'])('rejects %s even if selectable was incorrectly enabled', billingSource => {
    expect(servicesForSource([service('forged', { billingSource })], 'INTERNAL:ward:')).toEqual([]);
  });
  it('drops stale selections when source or department changes', () => {
    expect(retainAvailableServiceIds(['Dressing', 'External CT'], servicesForSource(catalog, 'OUTSOURCED:radiology:abc'))).toEqual(['External CT']);
    expect(retainAvailableServiceIds(['Dressing'], servicesForSource(catalog, 'INTERNAL:empty:'))).toEqual([]);
  });
  it.each(['OPD', 'OBSERVATION', 'EMERGENCY'] as const)('does not leak another department default into %s', encounterType => {
    const rows = [service('own', { encounterType, isDefaultEncounterService: true }), service('other', { encounterType, departmentId: 'other', isDefaultEncounterService: true })];
    expect(servicesForSource(rows, 'ward').map(s => s.id)).toEqual(['own']);
  });
});
