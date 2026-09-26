import type { Request, Response } from 'express';
import { staffService } from './staff.service';
import { AuthenticationError } from '@/shared/errors/AppError';
import type {
  CreateStaffBody,
  UpdateStaffBody,
  ListStaffQuery,
  SetClinicalAuthBody,
  ResetClinicalAuthPasswordBody,
  CreateSalaryProfileBody,
  ReplaceWeeklyScheduleBody,
  CreateBankAccountBody,
  CommissionSetup,
} from './staff.schemas';

export const staffController = {
  async list(req: Request, res: Response) {
    const { rows, meta } = await staffService.list(req.query as unknown as ListStaffQuery);
    res.json({ data: rows, meta: { pagination: meta } });
  },

  async getById(req: Request, res: Response) {
    const staff = await staffService.getById(req.params.id as string);
    res.json({ data: staff });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const staff = await staffService.create(req.body as CreateStaffBody, req.user.sub);
    res.status(201).json({ data: staff });
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const staff = await staffService.update(req.params.id as string, req.body as UpdateStaffBody, req.user.sub);
    res.json({ data: staff });
  },

  async deactivate(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const staff = await staffService.deactivate(req.params.id as string, req.user.sub);
    res.json({ data: staff });
  },

  async getFullProfile(req: Request, res: Response) {
    const profile = await staffService.getFullProfile(req.params.id as string);
    res.json({ data: profile });
  },

  async delete(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    await staffService.delete(req.params.id as string);
    res.status(204).send();
  },

  async setClinicalAuth(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const staff = await staffService.setClinicalAuth(req.params.id as string, req.body as SetClinicalAuthBody, req.user.sub);
    res.json({ data: staff });
  },

  async resetClinicalAuthPassword(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const staff = await staffService.resetClinicalAuthPassword(
      req.params.id as string,
      req.body as ResetClinicalAuthPasswordBody,
      req.user.sub,
    );
    res.json({ data: staff });
  },

  async activateClinicalAuth(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const staff = await staffService.setClinicalAuthActive(req.params.id as string, true, req.user.sub);
    res.json({ data: staff });
  },

  async deactivateClinicalAuth(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const staff = await staffService.setClinicalAuthActive(req.params.id as string, false, req.user.sub);
    res.json({ data: staff });
  },

  async createSalaryProfile(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const profile = await staffService.createSalaryProfile(req.params.id as string, req.body as CreateSalaryProfileBody, req.user.sub);
    res.status(201).json({ data: profile });
  },

  async replaceWeeklySchedule(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const days = await staffService.replaceWeeklySchedule(req.params.id as string, req.body as ReplaceWeeklyScheduleBody, req.user.sub);
    res.json({ data: days });
  },

  async replaceCommissionSetup(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const rules = await staffService.replaceCommissionSetup(req.params.id as string, req.body as CommissionSetup, req.user.sub);
    res.json({ data: rules });
  },

  async createBankAccount(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const account = await staffService.createBankAccount(req.params.id as string, req.body as CreateBankAccountBody, req.user.sub);
    res.status(201).json({ data: account });
  },
};
