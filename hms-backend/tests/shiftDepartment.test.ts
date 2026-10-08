import { beforeEach, expect, it, vi } from 'vitest';
import { createShiftSchema, updateShiftSchema } from '../src/modules/setup/setup.schemas';
const api = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn() }));
vi.mock('../../ch-sharif-and-saeed-hospital---hms/src/services/apiClient', () => ({ default: api }));
vi.mock('../../ch-sharif-and-saeed-hospital---hms/src/services/departmentService', () => ({ DepartmentService: { getDepartmentById: (id: string) => ({id,name:'Ward',status:'Active'}) } }));
import { ShiftService } from '../../ch-sharif-and-saeed-hospital---hms/src/services/shiftService';
const departmentId = '11111111-1111-4111-8111-111111111111';
const fields = { name:'Morning', startTime:'08:00', endTime:'16:00' };
const form: any = { ...fields,code:'',departmentId:'',shiftType:'MORNING',breakMinutes:0,defaultArrivalGraceMinutes:0,defaultEarlyExitToleranceMinutes:0,defaultWeeklyOffDays:[],status:'ACTIVE' };
beforeEach(() => { vi.clearAllMocks(); api.post.mockImplementation(async (_url,data) => ({data:{data:{...data,id:'shift',code:'SHF-TEST'}}})); api.patch.mockImplementation(async (_url,data) => ({data:{data:{...data,id:'shift',code:'SHF-TEST'}}})); });
it.each([undefined,null,departmentId])('accepts optional shift department %s', departmentId => {
  expect(createShiftSchema.parse({...fields,departmentId}).departmentId).toBe(departmentId);
});
it('supports explicitly clearing a department without clearing it on unrelated edits', () => {
  expect(updateShiftSchema.parse({departmentId:null})).toEqual({departmentId:null});
  expect(updateShiftSchema.parse({name:'Evening'})).not.toHaveProperty('departmentId');
  expect(createShiftSchema.safeParse({...fields,departmentId:'invalid'}).success).toBe(false);
});
it('posts HMS-wide shifts with null department and displays the HMS scope', async () => {
  const shift = await ShiftService.createShift(form,{} as any);
  expect(api.post.mock.calls[0][1].departmentId).toBeNull();
  expect(shift.departmentName).toBe('HMS (All Departments)');
});
it('preserves a selected department and can clear it on edit', async () => {
  await ShiftService.updateShift('shift',{...form,departmentId},{} as any);
  expect(api.patch.mock.calls[0][1].departmentId).toBe(departmentId);
  await ShiftService.updateShift('shift',form,{} as any);
  expect(api.patch.mock.calls[1][1].departmentId).toBeNull();
});
