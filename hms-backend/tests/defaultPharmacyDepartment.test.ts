import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({department:{findUnique:vi.fn(),findFirst:vi.fn(),update:vi.fn(),delete:vi.fn()}}));
vi.mock('@/db/client',()=>({prisma:db}));
import { setupService } from '../src/modules/setup/setup.service';
import { requirePharmacyDepartment } from '../src/shared/pharmacyDepartment';
const pharmacy={id:'pharmacy',isDefaultPharmacy:true,departmentType:'PHARMACY',pharmacyRelated:true,isActive:true,fulfillmentOwnership:'INTERNAL'};
beforeEach(()=>{vi.resetAllMocks();db.department.findUnique.mockResolvedValue(pharmacy);db.department.findFirst.mockResolvedValue(pharmacy);});
it('blocks default Pharmacy deletion and deactivation before dependency removal',async()=>{
  await expect(setupService.deleteDepartment('pharmacy')).rejects.toThrow('cannot be deleted');
  await expect(setupService.deactivateDepartment('pharmacy','actor')).rejects.toThrow('cannot be deactivated');
  expect(db.department.update).not.toHaveBeenCalled();
  expect(db.department.delete).not.toHaveBeenCalled();
});
it.each([{departmentType:'CLINICAL'},{pharmacyRelated:false},{isActive:false},{fulfillmentOwnership:'OUTSOURCED'}])('blocks reclassification %j',async patch=>{
  await expect(setupService.updateDepartment('pharmacy',patch as any,'actor')).rejects.toThrow('Default Pharmacy must remain');
  expect(db.department.update).not.toHaveBeenCalled();
});
it('resolves billing by explicit default identity and active pharmacy classification',async()=>{
  await expect(requirePharmacyDepartment(db as any)).resolves.toBe(pharmacy);
  expect(db.department.findFirst).toHaveBeenCalledWith({where:{isDefaultPharmacy:true,departmentType:'PHARMACY',pharmacyRelated:true,isActive:true,fulfillmentOwnership:'INTERNAL'}});
});
it('does not silently bill a ward if the default Pharmacy is missing',async()=>{
  db.department.findFirst.mockResolvedValue(null);
  await expect(requirePharmacyDepartment(db as any)).rejects.toThrow('missing or inactive');
});
