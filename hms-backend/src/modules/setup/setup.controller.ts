import { listServiceRatesSchema } from './setup.schemas';
import type { Request, Response } from 'express';
import { setupService } from './setup.service';
import { dataResetService } from './dataReset.service';
import { AuthenticationError } from '@/shared/errors/AppError';

function actorId(req: Request): string {
  if (!req.user) throw new AuthenticationError();
  return req.user.sub;
}

export const setupController = {
  // Hospital Profile & System Summary
  getHospitalProfile: async (_req: Request, res: Response) => {
    res.json({ data: await setupService.getHospitalProfile() });
  },
  getHospitalPublicProfile: async (_req: Request, res: Response) => {
    res.json({ data: await setupService.getHospitalPublicProfile() });
  },
  getHospitalSummary: async (_req: Request, res: Response) => {
    res.json({ data: await setupService.getHospitalSummary() });
  },
  updateHospitalProfile: async (req: Request, res: Response) => {
    res.json({ data: await setupService.updateHospitalProfile(req.body, actorId(req)) });
  },

  // Departments
  listDepartments: async (req: Request, res: Response) => {
    res.json({ data: await setupService.listDepartments(req.query.activeOnly === 'true') });
  },
  createDepartment: async (req: Request, res: Response) => {
    res.status(201).json({ data: await setupService.createDepartment(req.body, actorId(req)) });
  },
  updateDepartment: async (req: Request, res: Response) => {
    res.json({ data: await setupService.updateDepartment(req.params.id as string, req.body, actorId(req)) });
  },
  deactivateDepartment: async (req: Request, res: Response) => {
    res.json({ data: await setupService.deactivateDepartment(req.params.id as string, actorId(req)) });
  },
  deleteDepartment: async (req: Request, res: Response) => {
    await setupService.deleteDepartment(req.params.id as string);
    res.status(204).send();
  },

  // Hospital Floors
  listFloors: async (_req: Request, res: Response) => {
    res.json({ data: await setupService.listFloors() });
  },
  createFloor: async (req: Request, res: Response) => {
    res.status(201).json({ data: await setupService.createFloor(req.body) });
  },
  updateFloor: async (req: Request, res: Response) => {
    res.json({ data: await setupService.updateFloor(req.params.id as string, req.body) });
  },
  deleteFloor: async (req: Request, res: Response) => {
    await setupService.deleteFloor(req.params.id as string);
    res.status(204).send();
  },

  // Service Rates
  listServiceRates: async (req: Request, res: Response) => {
    res.json({ data: await setupService.listServiceRates(listServiceRatesSchema.parse(req.query)) });
  },
  createServiceRate: async (req: Request, res: Response) => {
    res.status(201).json({ data: await setupService.createServiceRate(req.body, actorId(req)) });
  },
  updateServiceRate: async (req: Request, res: Response) => {
    res.json({ data: await setupService.updateServiceRate(req.params.id as string, req.body, actorId(req)) });
  },
  deactivateServiceRate: async (req: Request, res: Response) => {
    res.json({ data: await setupService.deactivateServiceRate(req.params.id as string, actorId(req)) });
  },
  deleteServiceRate: async (req: Request, res: Response) => {
    await setupService.deleteServiceRate(req.params.id as string);
    res.status(204).send();
  },

  // Wards / Rooms / Beds
  listWardHierarchy: async (_req: Request, res: Response) => {
    res.json({ data: await setupService.listWardHierarchy() });
  },
  createWard: async (req: Request, res: Response) => {
    res.status(201).json({ data: await setupService.createWard(req.body, actorId(req)) });
  },
  updateWard: async (req: Request, res: Response) => {
    res.json({ data: await setupService.updateWard(req.params.id as string, req.body, actorId(req)) });
  },
  createRoom: async (req: Request, res: Response) => {
    res.status(201).json({ data: await setupService.createRoom(req.body, actorId(req)) });
  },
  updateRoom: async (req: Request, res: Response) => {
    res.json({ data: await setupService.updateRoom(req.params.id as string, req.body, actorId(req)) });
  },
  createBed: async (req: Request, res: Response) => {
    res.status(201).json({ data: await setupService.createBed(req.body, actorId(req)) });
  },
  updateBed: async (req: Request, res: Response) => {
    res.json({ data: await setupService.updateBed(req.params.id as string, req.body, actorId(req)) });
  },
  deleteWard: async (req: Request, res: Response) => {
    await setupService.deleteWard(req.params.id as string);
    res.status(204).send();
  },
  deleteRoom: async (req: Request, res: Response) => {
    await setupService.deleteRoom(req.params.id as string);
    res.status(204).send();
  },
  deleteBed: async (req: Request, res: Response) => {
    await setupService.deleteBed(req.params.id as string);
    res.status(204).send();
  },

  // Corporate Panels
  listPanelCategories: async (_req: Request, res: Response) => {
    res.json({ data: await setupService.listPanelCategories() });
  },
  listCorporatePanels: async (req: Request, res: Response) => {
    res.json({ data: await setupService.listCorporatePanels(req.query.activeOnly === 'true') });
  },
  createCorporatePanel: async (req: Request, res: Response) => {
    res.status(201).json({ data: await setupService.createCorporatePanel(req.body, actorId(req)) });
  },
  updateCorporatePanel: async (req: Request, res: Response) => {
    res.json({ data: await setupService.updateCorporatePanel(req.params.id as string, req.body, actorId(req)) });
  },
  listPanelRuleHistory: async (req: Request, res: Response) => {
    res.json({ data: await setupService.listPanelRuleHistory(req.params.id as string) });
  },
  replaceDiscountRules: async (req: Request, res: Response) => {
    res.json({ data: await setupService.replaceDiscountRules(req.params.id as string, req.body, actorId(req)) });
  },
  deleteCorporatePanel: async (req: Request, res: Response) => {
    await setupService.deleteCorporatePanel(req.params.id as string);
    res.status(204).send();
  },

  // Shifts
  listShifts: async (req: Request, res: Response) => {
    const { departmentId, shiftType, isActive, search } = req.query as Record<string, string | undefined>;
    res.json({
      data: await setupService.listShifts({
        departmentId,
        shiftType,
        isActive: isActive === undefined ? undefined : isActive === 'true',
        search,
      }),
    });
  },
  createShift: async (req: Request, res: Response) => {
    res.status(201).json({ data: await setupService.createShift(req.body, actorId(req)) });
  },
  updateShift: async (req: Request, res: Response) => {
    res.json({ data: await setupService.updateShift(req.params.id as string, req.body, actorId(req)) });
  },
  deactivateShift: async (req: Request, res: Response) => {
    res.json({ data: await setupService.deactivateShift(req.params.id as string, actorId(req)) });
  },

  // Outsourced Providers
  listOutsourcedProviders: async (req: Request, res: Response) => {
    res.json({ data: await setupService.listOutsourcedProviders(req.query.activeOnly === 'true') });
  },
  createOutsourcedProvider: async (req: Request, res: Response) => {
    res.status(201).json({ data: await setupService.createOutsourcedProvider(req.body, actorId(req)) });
  },
  updateOutsourcedProvider: async (req: Request, res: Response) => {
    res.json({ data: await setupService.updateOutsourcedProvider(req.params.id as string, req.body, actorId(req)) });
  },
  deactivateOutsourcedProvider: async (req: Request, res: Response) => {
    res.json({ data: await setupService.deactivateOutsourcedProvider(req.params.id as string, actorId(req)) });
  },

  // High-Cost Medicine Policy
  getHighCostMedicinePolicy: async (_req: Request, res: Response) => {
    res.json({ data: await setupService.getHighCostMedicinePolicy() });
  },
  updateHighCostMedicinePolicy: async (req: Request, res: Response) => {
    res.json({ data: await setupService.updateHighCostMedicinePolicy(req.body, actorId(req)) });
  },

  // Provider Settlements
  listProviderSettlements: async (req: Request, res: Response) => {
    res.json({ data: await setupService.listProviderSettlements(req.query as any) });
  },
  createProviderSettlement: async (req: Request, res: Response) => {
    res.status(201).json({ data: await setupService.createProviderSettlement(req.body, actorId(req)) });
  },

  // Reset Test / Transactional Data (Super Admin only)
  resetTransactionalData: async (req: Request, res: Response) => {
    const result = await dataResetService.resetTransactionalData(actorId(req), req.user?.role);
    res.json({ data: result });
  },
};
