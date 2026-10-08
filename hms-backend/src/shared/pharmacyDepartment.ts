import type { Prisma } from '@prisma/client';
import { ValidationError } from './errors/AppError';

export async function requirePharmacyDepartment(tx: Pick<Prisma.TransactionClient, 'department'>) {
  const department = await tx.department.findFirst({ where: { isDefaultPharmacy: true, departmentType: 'PHARMACY', pharmacyRelated: true, isActive: true, fulfillmentOwnership: 'INTERNAL' } });
  if (!department) throw new ValidationError('Default Pharmacy department is missing or inactive. Apply the Pharmacy department migration.');
  return department;
}
