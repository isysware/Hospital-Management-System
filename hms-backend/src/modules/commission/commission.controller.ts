import type { Request, Response } from 'express';
import { commissionService } from './commission.service';
import { AuthenticationError } from '@/shared/errors/AppError';
import type {
  CreateCommissionRuleBody,
  ListCommissionRulesQuery,
  ListAccrualsQuery,
  PayAccrualBody,
} from './commission.schemas';

function actorId(req: Request): string {
  if (!req.user) throw new AuthenticationError();
  return req.user.sub;
}

export const commissionController = {
  createRule: async (req: Request, res: Response) => {
    const rule = await commissionService.createCommissionRule(
      req.body as CreateCommissionRuleBody,
      actorId(req),
    );
    res.status(201).json({ data: rule });
  },

  listRules: async (req: Request, res: Response) => {
    const rules = await commissionService.listCommissionRules(
      req.query as unknown as ListCommissionRulesQuery,
    );
    res.json({ data: rules });
  },

  listAccruals: async (req: Request, res: Response) => {
    const accruals = await commissionService.listAccruals(
      req.query as unknown as ListAccrualsQuery,
    );
    res.json({ data: accruals });
  },

  approveAccrual: async (req: Request, res: Response) => {
    const accrual = await commissionService.approveAccrual(req.params.id as string, actorId(req));
    res.json({ data: accrual });
  },

  payAccrual: async (req: Request, res: Response) => {
    const accrual = await commissionService.payAccrual(req.params.id as string, req.body as PayAccrualBody, actorId(req));
    res.status(201).json({ data: accrual });
  },
};
