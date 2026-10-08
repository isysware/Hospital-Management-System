import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSelectableService, serviceSelectionWhere, validateServiceMaster } from '../src/shared/serviceClassification';
const db = vi.hoisted(() => ({ serviceRate: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() }, department: { findUnique: vi.fn() } }));
vi.mock('@/db/client', () => ({ prisma: db }));
import { setupService } from '../src/modules/setup/setup.service';
const core = { id: 'opd', code: 'DEFAULT-OPD', name: 'OPD', encounterType: 'OPD', isDefaultEncounterService: true,
  departmentId: null, providerType: 'INTERNAL', billingSource: 'HOSPITAL_SERVICE', selectable: true,
  isActive: true, isDeleted: false, isSystemGenerated: false, _count: { invoiceLines: 2, panelDiscountRules: 0 }, createdByUser: null, updatedByUser: null };
beforeEach(() => { vi.resetAllMocks(); db.serviceRate.findUnique.mockResolvedValue(core); db.serviceRate.update.mockImplementation(async ({data}) => ({...core,...data})); });
describe('default encounter services', () => {
  it.each(['OPD', 'OBSERVATION', 'EMERGENCY'])('allows department-free %s encounter billing', encounterType => {
    expect(() => assertSelectableService({...core,encounterType})).not.toThrow();
  });
  it('includes defaults in the internal catalog but excludes them from scoped and outsourced selection', () => {
    expect(serviceSelectionWhere().OR).toEqual(expect.arrayContaining([expect.objectContaining({departmentId:null,isDefaultEncounterService:true})]));
    expect(serviceSelectionWhere({departmentId:'ward'})).toMatchObject({departmentId:'ward'});
    expect(serviceSelectionWhere({departmentId:'ward'}).OR).toBeUndefined();
    expect(serviceSelectionWhere({providerType:'OUTSOURCED'}).OR).toBeUndefined();
    expect(() => assertSelectableService(core,{departmentId:'ward'})).toThrow();
  });
  it('still requires departments on regular service creation', async () => {
    await expect(validateServiceMaster(db,{name:'Dressing'})).rejects.toThrow('requires a department');
  });
  it('edits the rate without assigning a department or touching historical invoice lines', async () => {
    await setupService.updateServiceRate('opd',{standardRate:1200,departmentId:null},'actor');
    expect(db.serviceRate.update).toHaveBeenCalledWith(expect.objectContaining({where:{id:'opd'},data:expect.objectContaining({standardRate:1200})}));
    expect(db.serviceRate.update.mock.calls[0][0].data).not.toHaveProperty('departmentId');
  });
  it.each([{departmentId:'ward'},{providerType:'OUTSOURCED'},{isActive:false},{isDefaultEncounterService:false},{encounterType:'EMERGENCY'}])('rejects default identity changes %j', async patch => {
    await expect(setupService.updateServiceRate('opd',patch as any,'actor')).rejects.toThrow();
    expect(db.serviceRate.update).not.toHaveBeenCalled();
  });
  it('cannot create another default', async () => {
    await expect(setupService.createServiceRate({name:'OPD',billingUnit:'Per Visit',standardRate:100,isDefaultEncounterService:true,encounterType:'OPD'},'actor')).rejects.toThrow('already exist');
    expect(db.serviceRate.create).not.toHaveBeenCalled();
  });
  it('cannot delete or deactivate a default', async () => {
    await expect(setupService.deleteServiceRate('opd')).rejects.toThrow('cannot be deleted');
    await expect(setupService.deactivateServiceRate('opd','actor')).rejects.toThrow('only be edited');
    expect(db.serviceRate.update).not.toHaveBeenCalled();
  });
});
