import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
const { db, api } = vi.hoisted(() => ({ api: { post: vi.fn() }, db: {
  admissionRecord: { create: vi.fn(), findUnique: vi.fn() },
  hospitalInvoice: { create: vi.fn(), update: vi.fn() },
  serviceRate: { findUnique: vi.fn() },
  invoiceLineItem: { create: vi.fn() },
} }));
vi.mock('@/db/client', () => ({ prisma: { $transaction: (fn: any) => fn(db) } }));
vi.mock('@/shared/idGenerator', () => ({ generateAdmissionNumber: () => 'ADM', generateInvoiceNumber: () => 'INV' }));
vi.mock('../../ch-sharif-and-saeed-hospital---hms/src/services/apiClient', () => ({ default: api }));
vi.mock('../../ch-sharif-and-saeed-hospital---hms/src/services/patientRegistryService', () => ({ getAllPatients: () => [], getPatientById: () => undefined }));
import { createAdmission } from '../../ch-sharif-and-saeed-hospital---hms/src/services/admissionService';
import { createPlannedAdmissionSchema, addAdmissionServiceSchema } from '../src/modules/admission/admission.schemas';
import { admissionService } from '../src/modules/admission/admission.service';

beforeEach(() => {
  vi.resetAllMocks();
  db.admissionRecord.create.mockImplementation(async ({ data }) => ({ id: 'admission', ...data }));
  db.hospitalInvoice.create.mockImplementation(async ({ data }) => ({ id: 'invoice', ...data }));
  db.invoiceLineItem.create.mockImplementation(async ({ data }) => ({ id: 'line', ...data }));
  db.serviceRate.findUnique.mockResolvedValue({ providerType: 'OUTSOURCED', billingSource: 'OUTSOURCED_SERVICE', selectable: true, isDeleted: false, isSystemGenerated: false, department: { isActive: true, pharmacyRelated: false, fulfillmentOwnership: 'OUTSOURCED', outsourcedProviderId: 'provider', outsourcedProvider: { isActive: true } }, id: 'service', departmentId: 'department', isActive: true, serviceStream: 'LAB', standardRate: new Decimal(500) });
});

describe('admission intake fulfillment defaults', () => {
  it.each([undefined, 'SELF', 'HOSPITAL_MANAGED'])('sends and restores frontend choice %s', async (mode) => {
    api.post.mockImplementation(async (_url, data) => ({ data: { data: { admission: { id: 'admission', ...data } } } }));
    const result = await createAdmission({ medicationMode: mode, outsourcedFulfillmentMode: mode, estimatedAmount: '', weightKg: '', advanceAmount: '' } as any);
    const expected = mode ?? 'HOSPITAL_MANAGED';
    expect(api.post.mock.calls[0][1]).toMatchObject({ medicationMode: expected, outsourcedFulfillmentMode: expected });
    expect(result.admission).toMatchObject({ medicationMode: expected, outsourcedFulfillmentMode: expected });
  });
  it('defaults both omitted choices to Hospital Managed', () => {
    const body = createPlannedAdmissionSchema.parse({ newSelfPayPatient: { fullName: 'Patient' } });
    expect(body.medicationMode).toBe('HOSPITAL_MANAGED');
    expect(body.outsourcedFulfillmentMode).toBe('HOSPITAL_MANAGED');
  });
  it.each(['HOSPITAL_MANAGED', 'SELF'] as const)('persists the explicit %s choices', async (mode) => {
    const body = createPlannedAdmissionSchema.parse({ departmentId: '11111111-1111-4111-8111-111111111111', selfPayEncounterId: '22222222-2222-4222-8222-222222222222', medicationMode: mode, outsourcedFulfillmentMode: mode });
    const result = await admissionService.createPlannedAdmission(body, 'actor');
    expect(result.admission.medicationMode).toBe(mode);
    expect(result.admission.outsourcedFulfillmentMode).toBe(mode);
  });
  it.each(['HOSPITAL_MANAGED', 'SELF'] as const)('uses saved outsourced choice %s for subsequent service entry', async (mode) => {
    db.admissionRecord.findUnique.mockResolvedValue({ id: 'admission', status: 'ACTIVE', outsourcedFulfillmentMode: mode, hospitalInvoices: [{ id: 'invoice', departmentId: 'department', lines: [], paidTotal: new Decimal(0) }] });
    const body = addAdmissionServiceSchema.parse({ serviceRateId: '11111111-1111-4111-8111-111111111111', quantity: 1 });
    await admissionService.addAdmissionService('admission', body, 'actor');
    expect(db.invoiceLineItem.create.mock.calls[0][0].data.lineNet.toNumber()).toBe(mode === 'SELF' ? 0 : 500);
  });
  it('preserves an explicit per-service override of the saved outsourced choice', async () => {
    db.admissionRecord.findUnique.mockResolvedValue({ id: 'admission', status: 'ACTIVE', outsourcedFulfillmentMode: 'SELF', hospitalInvoices: [{ id: 'invoice', departmentId: 'department', lines: [], paidTotal: new Decimal(0) }] });
    await admissionService.addAdmissionService('admission', { serviceRateId: 'service', quantity: 1, arrangementMode: 'HOSPITAL_MANAGED' }, 'actor');
    expect(db.invoiceLineItem.create.mock.calls[0][0].data.lineNet.toNumber()).toBe(500);
  });
});
