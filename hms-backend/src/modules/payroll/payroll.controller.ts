import type { Request, Response } from 'express';
import { payrollService } from './payroll.service';
import { AuthenticationError } from '@/shared/errors/AppError';
import type { PayrollRunFilters, ListPayrollRunsQuery, PaySalarySlipBody, ListSalarySlipsQuery } from './payroll.schemas';

export const payrollController = {
  async preview(req: Request, res: Response) {
    const result = await payrollService.preview(req.body as PayrollRunFilters);
    res.json({ data: result });
  },

  async generate(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const run = await payrollService.generate(req.body as PayrollRunFilters, req.user.sub);
    res.status(201).json({ data: run });
  },

  async list(req: Request, res: Response) {
    const { rows, meta } = await payrollService.list(req.query as unknown as ListPayrollRunsQuery);
    res.json({ data: rows, meta: { pagination: meta } });
  },

  async getById(req: Request, res: Response) {
    const run = await payrollService.getById(req.params.id as string);
    res.json({ data: run });
  },

  async approve(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const run = await payrollService.approve(req.params.id as string, req.user.sub);
    res.json({ data: run });
  },

  async listSlips(req: Request, res: Response) {
    const { rows, meta } = await payrollService.listSlips(req.query as unknown as ListSalarySlipsQuery);
    res.json({ data: rows, meta: { pagination: meta } });
  },

  async paySlip(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const slip = await payrollService.paySlip(req.params.id as string, req.body as PaySalarySlipBody, req.user.sub);
    res.status(201).json({ data: slip });
  },
};
