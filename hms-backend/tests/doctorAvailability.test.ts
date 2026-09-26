import { beforeEach, describe, expect, it, vi } from 'vitest';
import { doctorsForEncounter } from '../../ch-sharif-and-saeed-hospital---hms/src/utils/doctorAvailability';
import type { StaffUser } from '../../ch-sharif-and-saeed-hospital---hms/src/types/staffUser';
import { createStaffBodySchema, updateStaffBodySchema } from '../src/modules/identity/staff.schemas';
import { bookAppointmentSchema, updateAppointmentSchema } from '../src/modules/frontdesk/appointments.schemas';
import { createEncounterSchema } from '../src/modules/frontdesk/invoices.schemas';
import { createPlannedAdmissionSchema } from '../src/modules/admission/admission.schemas';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), findMany: vi.fn(), findById: vi.fn(), create: vi.fn(), update: vi.fn(),
}));
vi.mock('../../ch-sharif-and-saeed-hospital---hms/src/services/apiClient', () => ({ default: { get: mocks.get } }));
vi.mock('../../ch-sharif-and-saeed-hospital---hms/src/services/departmentService', () => ({ DepartmentService: {} }));
vi.mock('@/db/client', () => ({
  prisma: {
    // staffService.create writes the Staff row (plus any wizard sections)
    // inside a transaction, then re-reads it through the repository.
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        staff: {
          create: vi.fn(async ({ data }: { data: unknown }) => {
            const saved = await mocks.create(data);
            mocks.findById.mockResolvedValueOnce(saved);
            return { id: 'new-staff-id' };
          }),
        },
      }),
    ),
    staff: {
      // No existing staff shares a CNIC in these fixtures.
      findUnique: vi.fn(async () => null),
    },
    serviceRate: {
      // Echoes back every requested id as an active, non-deleted service —
      // staff.service.ts's assertServicesActive() consumes this.
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((serviceId) => ({ id: serviceId, isActive: true, isDeleted: false })),
      ),
    },
  },
}));
vi.mock('@/shared/actorLabel', () => ({ resolveActorLabel: vi.fn().mockResolvedValue('Test Admin') }));
vi.mock('../src/modules/identity/staff.repository', () => ({ staffRepository: mocks }));
import { fetchStaffUsers } from '../../ch-sharif-and-saeed-hospital---hms/src/services/staffUserService';
import { staffService } from '../src/modules/identity/staff.service';

const id = 'c90d3c00-ed54-4c87-b4e8-e6e3cfc37a01';
function doctor(id: string, fields: Partial<StaffUser> = {}): StaffUser {
  return { id, staffCategory: 'Doctor', status: 'ACTIVE', departmentId: 'unrelated-department', ...fields } as StaffUser;
}
const staff = [
  doctor('opd', { availableForOpd: true }),
  doctor('observation', { availableForObservation: true }),
  doctor('emergency', { availableForEmergency: true }),
  doctor('all', { availableForOpd: true, availableForObservation: true, availableForEmergency: true }),
  doctor('none'),
  doctor('inactive', { status: 'INACTIVE', availableForEmergency: true }),
  doctor('suspended', { status: 'SUSPENDED', availableForEmergency: true }),
  doctor('nurse', { staffCategory: 'Nursing', availableForEmergency: true }),
];

beforeEach(() => vi.clearAllMocks());

describe('doctor eligibility independent of department', () => {
  it.each([
    ['OPD', ['opd', 'all']], ['OBSERVATION', ['observation', 'all']], ['EMERGENCY', ['emergency', 'all']],
  ])('filters %s by explicit active Doctor eligibility', (encounter, expected) => {
    expect(doctorsForEncounter(staff, encounter as string).map((row) => row.id)).toEqual(expected);
  });

  it('allows active Doctors for admission without requiring encounter eligibility', () => {
    expect(doctorsForEncounter(staff, 'ADMISSION').map((row) => row.id))
      .toEqual(['opd', 'observation', 'emergency', 'all', 'none']);
  });

  it('excludes a previously selected doctor when their next encounter is ineligible', () => {
    expect(doctorsForEncounter(staff, 'EMERGENCY').some((row) => row.id === 'opd')).toBe(false);
    expect(doctorsForEncounter(staff, 'EMERGENCY').some((row) => row.id === 'all')).toBe(true);
  });

  it('loads Emergency eligibility from Staff API pages after page one', async () => {
    mocks.get.mockResolvedValueOnce({ data: {
      data: [{ id: 'first', category: 'Doctor', isActive: true, availableForOpd: true }],
      meta: { pagination: { totalPages: 2 } },
    } }).mockResolvedValueOnce({ data: {
      data: [{ id: 'later', category: 'Doctor', isActive: true, availableForEmergency: true }],
      meta: { pagination: { totalPages: 2 } },
    } });
    const loaded = await fetchStaffUsers();
    expect(mocks.get).toHaveBeenNthCalledWith(2, '/staff', { params: { pageSize: 100, page: 2 } });
    expect(doctorsForEncounter(loaded, 'EMERGENCY').map((row) => row.id)).toEqual(['later']);
    expect(loaded[0].availableForEmergency).toBe(false);
  });
});

describe('Staff eligibility persistence and compatibility', () => {
  const body = {
    fullName: 'Test Doctor', fatherGuardianName: 'Test Father', cnic: '35201-1234567-1', dateOfBirth: new Date('1985-01-01'),
    category: 'Doctor', departmentIds: [id], serviceIds: [id],
    designation: 'Consultant', phone: '03001234567', joiningDate: new Date(),
  };

  it.each([
    [false, false, false], [true, false, false], [false, true, true], [true, true, true],
  ])('persists optional combinations %s/%s/%s', async (availableForOpd, availableForObservation, availableForEmergency) => {
    mocks.findMany.mockResolvedValue({ rows: [] });
    mocks.create.mockImplementation(async (data) => data);
    const eligibility = { availableForOpd, availableForObservation, availableForEmergency };
    const saved = await staffService.create(createStaffBodySchema.parse({ ...body, ...eligibility }), 'admin');
    expect(saved).toMatchObject(eligibility);
    expect(saved.department).toEqual({ connect: { id } });
  });

  it('defaults old create callers to no eligibility while preserving department assignment', async () => {
    mocks.findMany.mockResolvedValue({ rows: [] });
    mocks.create.mockImplementation(async (data) => data);
    expect(await staffService.create(createStaffBodySchema.parse(body), 'admin')).toMatchObject({
      availableForOpd: false, availableForObservation: false, availableForEmergency: false,
      department: { connect: { id } },
    });
  });

  it('preserves eligibility on unrelated edits and permits clearing all flags', async () => {
    mocks.findById.mockResolvedValue({ id, availableForEmergency: true });
    mocks.update.mockResolvedValue({ id });
    await staffService.update(id, updateStaffBodySchema.parse({ fullName: 'Updated' }), 'admin');
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('availableForEmergency');
    const cleared = { availableForOpd: false, availableForObservation: false, availableForEmergency: false };
    await staffService.update(id, updateStaffBodySchema.parse(cleared), 'admin');
    expect(mocks.update.mock.calls[1][1]).toMatchObject(cleared);
  });
});

describe('optional Front Desk doctor validation', () => {
  it.each(['OPD', 'OBSERVATION', 'EMERGENCY'])('accepts %s intake without a doctor', (encounterType) => {
    expect(createEncounterSchema.parse({ encounterType, newSelfPayPatient: { fullName: 'Test Patient' } }))
      .not.toHaveProperty('doctorStaffId');
  });

  it('accepts admission and appointment intake without a doctor', () => {
    const patient = { newSelfPayPatient: { fullName: 'Test Patient' } };
    expect(createPlannedAdmissionSchema.parse(patient)).not.toHaveProperty('doctorStaffId');
    expect(bookAppointmentSchema.parse({ ...patient, departmentId: id, serviceRateId: id, slotAt: new Date() }))
      .not.toHaveProperty('doctorStaffId');
  });

  it('supports clearing an appointment doctor and rejects invalid IDs', () => {
    expect(updateAppointmentSchema.parse({ doctorStaffId: null })).toHaveProperty('doctorStaffId', null);
    expect(updateAppointmentSchema.safeParse({ doctorStaffId: 'invalid' }).success).toBe(false);
  });
});
