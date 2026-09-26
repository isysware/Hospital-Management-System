import type { Request, Response } from 'express';
import { dashboardService } from './dashboard.service';
import { frontdeskBillingReportService } from './frontdeskBilling.service';
import type { GetSuperAdminDashboardQuery } from './dashboard.schemas';
import type { BillingSummaryQuery } from './frontdeskReports.schemas';

export const dashboardController = {
  async getSuperAdminDashboard(req: Request, res: Response) {
    const query = req.query as unknown as GetSuperAdminDashboardQuery;
    const data = await dashboardService.getSuperAdminDashboard(query);
    res.json({ data });
  },

  async getFrontDeskBillingReport(req: Request, res: Response) {
    const query = req.query as unknown as BillingSummaryQuery;
    const data = await frontdeskBillingReportService.getReport(query);
    res.json({ data });
  },
};
