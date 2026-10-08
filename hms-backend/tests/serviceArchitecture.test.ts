import { describe, expect, it, vi, beforeEach } from 'vitest';
import { serviceSelectionWhere, assertSelectableService, validateServiceMaster } from '../src/shared/serviceClassification';
import { listServiceRatesSchema } from '../src/modules/setup/setup.schemas';
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn().mockResolvedValue([]) }));
vi.mock('@/db/client', () => ({ prisma: { serviceRate: { findMany } } }));
import { setupController } from '../src/modules/setup/setup.controller';
const valid = {
  id: 'dressing', departmentId: 'ward', providerType: 'INTERNAL', billingSource: 'HOSPITAL_SERVICE',
  isActive: true, isDeleted: false, isSystemGenerated: false, selectable: true,
  department: { isActive: true, pharmacyRelated: false, fulfillmentOwnership: 'INTERNAL' },
};
beforeEach(() => vi.clearAllMocks());
describe('Services API filtering', () => {
  it('defaults to active internal selectable services in SQL', async () => {
    const json = vi.fn();
    await setupController.listServiceRates({ query: {} } as any, { json } as any);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ providerType: 'INTERNAL', isActive: true, selectable: true, isSystemGenerated: false, isDeleted: false, billingSource: { in: ['HOSPITAL_SERVICE', 'LAB'] } }) }));
    expect(json).toHaveBeenCalledWith({ data: [] });
  });
  it('passes provider, department, and status to the database', async () => {
    const departmentId = '11111111-1111-4111-8111-111111111111', outsourcedProviderId = '22222222-2222-4222-8222-222222222222';
    await setupController.listServiceRates({ query: { providerType: 'OUTSOURCED', departmentId, outsourcedProviderId, status: 'INACTIVE', selectable: 'true' } } as any, { json: vi.fn() } as any);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ departmentId, isActive: false, providerType: 'OUTSOURCED', billingSource: 'OUTSOURCED_SERVICE', department: { is: expect.objectContaining({ outsourcedProviderId, fulfillmentOwnership: 'OUTSOURCED' }) } }) }));
  });
  it.each([{ providerType: 'LAB' }, { status: 'unknown' }, { selectable: 'false' }, { departmentId: 'invalid' }])('rejects invalid API filters %j', query => {
    expect(listServiceRatesSchema.safeParse(query).success).toBe(false);
  });
  it('keeps selectable and active defaults', () => expect(serviceSelectionWhere()).toMatchObject({ selectable: true, isActive: true }));
});
describe('Posting and master invariants', () => {
  it('accepts a matching internal service', () => expect(() => assertSelectableService(valid, { providerType: 'INTERNAL', departmentId: 'ward' })).not.toThrow());
  it.each(['PHARMACY', 'DOCTOR_CHARGE', 'ROOM_BED', 'OTHER_VALID_SOURCE'])('rejects a forged generic %s charge', billingSource => expect(() => assertSelectableService({ ...valid, billingSource })).toThrow());
  it.each([{ isActive: false }, { isDeleted: true }, { isSystemGenerated: true }, { selectable: false }, { departmentId: null }])('rejects unavailable rows %j', patch => expect(() => assertSelectableService({ ...valid, ...patch })).toThrow());
  it('rejects department/provider mismatches', () => {
    expect(() => assertSelectableService(valid, { departmentId: 'other' })).toThrow();
    expect(() => assertSelectableService(valid, { providerType: 'OUTSOURCED' })).toThrow();
  });
  it('requires the matching active outsourced provider', () => {
    const outsourced = { ...valid, providerType: 'OUTSOURCED', billingSource: 'OUTSOURCED_SERVICE', department: { isActive: true, fulfillmentOwnership: 'OUTSOURCED', outsourcedProviderId: 'abc', outsourcedProvider: { isActive: true } } };
    expect(() => assertSelectableService(outsourced, { outsourcedProviderId: 'abc' })).not.toThrow();
    expect(() => assertSelectableService(outsourced, { outsourcedProviderId: 'other' })).toThrow();
    expect(() => assertSelectableService({ ...outsourced, department: { ...outsourced.department, outsourcedProvider: { isActive: false } } })).toThrow();
  });
  it.each(['Doctor Visit', 'Consultation Fee', 'Room Charge', 'Bed Charge', 'Pharmacy Medication'])('cannot create %s as a Service', async name => {
    const tx = { department: { findUnique: vi.fn().mockResolvedValue(valid.department) } };
    await expect(validateServiceMaster(tx, { departmentId: 'ward', name })).rejects.toThrow();
  });
  it.each(['Dressing', 'Nebulization', 'Injection Administration', 'IV Administration'])('allows genuine %s', async name => {
    const tx = { department: { findUnique: vi.fn().mockResolvedValue(valid.department) } };
    await expect(validateServiceMaster(tx, { departmentId: 'ward', name })).resolves.toMatchObject({ providerType: 'INTERNAL', billingSource: 'HOSPITAL_SERVICE', selectable: true });
  });
});
