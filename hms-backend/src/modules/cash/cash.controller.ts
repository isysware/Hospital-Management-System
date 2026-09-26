import type { Request, Response } from 'express';
import { cashService } from './cash.service';
import { settlementService } from './settlement.service';
import { financeControlService } from './financeControl.service';
import { AuthenticationError } from '@/shared/errors/AppError';
import type { SubmitSettlementBody } from './settlement.schemas';
import type {
  ListBalanceSheetsQuery,
  ListSettlementsQuery,
  MyBalanceSheetQuery,
  MySettlementsQuery,
  FinanceKpisQuery,
  ReviewSettlementBody,
  ReverseSettlementBody,
} from './financeControl.schemas';

function actorId(req: Request): string {
  if (!req.user) throw new AuthenticationError();
  return req.user.sub;
}

export const cashController = {
  getMyBalanceSheet: async (req: Request, res: Response) => {
    const sheet = await cashService.getCashierBalanceSheet(actorId(req), req.query as unknown as MyBalanceSheetQuery);
    res.json({ data: sheet });
  },

  getUserBalanceSheet: async (req: Request, res: Response) => {
    const sheet = await cashService.getCashierBalanceSheet(req.params.userId as string);
    res.json({ data: sheet });
  },

  submitMySettlement: async (req: Request, res: Response) => {
    const settlement = await settlementService.submitSettlement(actorId(req), req.body as SubmitSettlementBody);
    res.status(201).json({ data: settlement });
  },

  listMySettlements: async (req: Request, res: Response) => {
    const settlements = await settlementService.listMySettlements(actorId(req), req.query as unknown as MySettlementsQuery);
    res.json({ data: settlements });
  },

  // ── Finance Control (Admin / Super Admin oversight) ──────────────────
  listBalanceSheets: async (req: Request, res: Response) => {
    const result = await financeControlService.listBalanceSheets(req.query as unknown as ListBalanceSheetsQuery);
    res.json({ data: result });
  },

  listAllSettlements: async (req: Request, res: Response) => {
    const result = await financeControlService.listSettlements(req.query as unknown as ListSettlementsQuery);
    res.json({ data: result });
  },

  getFinanceKpis: async (req: Request, res: Response) => {
    const result = await financeControlService.getFinanceKpis(req.query as unknown as FinanceKpisQuery);
    res.json({ data: result });
  },

  reviewSettlement: async (req: Request, res: Response) => {
    const settlement = await financeControlService.reviewSettlement(
      req.params.id as string,
      req.body as ReviewSettlementBody,
      actorId(req),
    );
    res.json({ data: settlement });
  },

  reverseSettlement: async (req: Request, res: Response) => {
    const settlement = await financeControlService.reverseSettlement(
      req.params.id as string,
      req.body as ReverseSettlementBody,
      actorId(req),
    );
    res.json({ data: settlement });
  },
};
