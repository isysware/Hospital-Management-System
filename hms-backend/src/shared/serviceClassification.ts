import type { Prisma } from '@prisma/client';
import { ValidationError } from './errors/AppError';

export interface ServiceFilters {
  providerType?: 'INTERNAL' | 'OUTSOURCED'; departmentId?: string;
  outsourcedProviderId?: string; status?: 'ACTIVE' | 'INACTIVE'; activeOnly?: boolean;
}
export function isCoreEncounterService(service: any): boolean {
  return service?.isDefaultEncounterService === true && ['OPD', 'OBSERVATION', 'EMERGENCY'].includes(service.encounterType);
}
export function serviceSelectionWhere(filters: ServiceFilters = {}): Prisma.ServiceRateWhereInput {
  const providerType = filters.providerType ?? 'INTERNAL';
  const where: Prisma.ServiceRateWhereInput = {
    isDeleted: false, isSystemGenerated: false, selectable: true, providerType,
    billingSource: providerType === 'OUTSOURCED' ? 'OUTSOURCED_SERVICE' : { in: ['HOSPITAL_SERVICE', 'LAB'] },
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    isActive: filters.status ? filters.status === 'ACTIVE' : true,
    department: { is: {
      isActive: true, pharmacyRelated: false, departmentType: { not: 'PHARMACY' }, fulfillmentOwnership: providerType,
      ...(providerType === 'OUTSOURCED' ? { outsourcedProvider: { is: { isActive: true } } } : {}),
      ...(filters.outsourcedProviderId ? { outsourcedProviderId: filters.outsourcedProviderId } : {}),
    } },
  };
  if (providerType === 'INTERNAL' && !filters.departmentId && !filters.outsourcedProviderId) {
    const department = where.department;
    delete where.department;
    where.OR = [{ department }, { departmentId: null, isDefaultEncounterService: true, encounterType: { in: ['OPD', 'OBSERVATION', 'EMERGENCY'] } }];
  }
  return where;
}

export function assertSelectableService(service: any, selection: ServiceFilters = {}) {
  if (!service || !service.isActive || service.isDeleted || service.isSystemGenerated || !service.selectable || (!service.departmentId && !isCoreEncounterService(service)) ||
      !['HOSPITAL_SERVICE', 'OUTSOURCED_SERVICE', 'LAB'].includes(service.billingSource)) {
    throw new ValidationError('Select an active hospital or outsourced service; pharmacy, doctor and accommodation charges use their own workflows.');
  }
  if (selection.departmentId && selection.departmentId !== service.departmentId) throw new ValidationError('Service does not belong to the selected department');
  if (selection.providerType && selection.providerType !== service.providerType) throw new ValidationError('Service does not belong to the selected provider type');
  if (isCoreEncounterService(service) && !service.departmentId && service.providerType === 'INTERNAL' && service.billingSource === 'HOSPITAL_SERVICE' && !selection.outsourcedProviderId) return;
  const d = service.department;
  if (!d?.isActive || d.pharmacyRelated || d.departmentType === 'PHARMACY' || d.fulfillmentOwnership !== service.providerType ||
      (service.providerType === 'OUTSOURCED' && !d.outsourcedProvider?.isActive) ||
      (selection.outsourcedProviderId && d.outsourcedProviderId !== selection.outsourcedProviderId)) throw new ValidationError('Service provider or department is not available');
}

export async function validateServiceMaster(tx: { department: { findUnique: (args: any) => PromiseLike<any> } }, data: any) {
  if (!data.departmentId) throw new ValidationError('A service requires a department');
  const department = await tx.department.findUnique({ where: { id: data.departmentId }, include: { outsourcedProvider: true } });
  if (!department?.isActive || department.pharmacyRelated || department.departmentType === 'PHARMACY') throw new ValidationError('Select an active non-pharmacy department');
  const providerType = data.providerType ?? department.fulfillmentOwnership;
  if (providerType !== department.fulfillmentOwnership || (providerType === 'OUTSOURCED' && !department.outsourcedProvider?.isActive)) throw new ValidationError('Provider must match the department configuration');
  // Input guard for known legacy technical labels; financial routing uses persisted classification.
  if (/^(SRV-PHARMACY|ROOM-ACC|WARD-PRICE|WARD-FIXED)$/i.test(data.code ?? '') ||
      /^(pharmacy|medicine|medication|consultation|accommodation|room \/ bed)$/i.test(data.category ?? '') ||
      /(consultation|doctor (charge|visit)|specialist fee|round fee|^(room|bed) charges?$|^pharmacy medication)/i.test(data.name ?? '')) throw new ValidationError('This charge belongs to Pharmacy, Doctor Fees or Room/Bed configuration, not Services');
  return { providerType, billingSource: providerType === 'OUTSOURCED' ? 'OUTSOURCED_SERVICE' as const : 'HOSPITAL_SERVICE' as const, selectable: true };
}
