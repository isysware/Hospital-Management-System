import type { Request, Response } from 'express';
import { NotFoundError } from '@/shared/errors/AppError';
import { frontdeskReportsService as svc } from './frontdeskReports.service';
import type {
  EncounterRegisterQuery,
  InvoiceRegisterQuery,
  CollectionReportQuery,
  OutstandingInvoicesQuery,
  DiscountReportQuery,
  RefundVoidReportQuery,
  DepartmentRevenueQuery,
  AdmissionPaymentCollectionQuery,
  PanelPayerReportQuery,
  ReceiptExceptionLogQuery,
  CashierPerformanceQuery,
  FinancialExceptionsQuery,
} from './frontdeskReports.schemas';

export const frontdeskReportsController = {
  encounterRegister: async (req: Request, res: Response) => {
    res.json({ data: await svc.getEncounterRegister(req.query as unknown as EncounterRegisterQuery) });
  },
  invoiceRegister: async (req: Request, res: Response) => {
    res.json({ data: await svc.getInvoiceRegister(req.query as unknown as InvoiceRegisterQuery) });
  },
  collectionReport: async (req: Request, res: Response) => {
    res.json({ data: await svc.getCollectionReport(req.query as unknown as CollectionReportQuery) });
  },
  outstandingInvoices: async (req: Request, res: Response) => {
    res.json({ data: await svc.getOutstandingInvoices(req.query as unknown as OutstandingInvoicesQuery) });
  },
  discountReport: async (req: Request, res: Response) => {
    res.json({ data: await svc.getDiscountReport(req.query as unknown as DiscountReportQuery) });
  },
  refundVoidReport: async (req: Request, res: Response) => {
    res.json({ data: await svc.getRefundVoidReport(req.query as unknown as RefundVoidReportQuery) });
  },
  departmentRevenue: async (req: Request, res: Response) => {
    res.json({ data: await svc.getDepartmentRevenueReport(req.query as unknown as DepartmentRevenueQuery) });
  },
  admissionPaymentCollection: async (req: Request, res: Response) => {
    res.json({ data: await svc.getAdmissionPaymentCollectionReport(req.query as unknown as AdmissionPaymentCollectionQuery) });
  },
  invoiceLedger: async (req: Request, res: Response) => {
    const result = await svc.getInvoiceLedger(req.params.invoiceId as string);
    if (!result) throw new NotFoundError('Invoice not found');
    res.json({ data: result });
  },
  panelPayerReport: async (req: Request, res: Response) => {
    res.json({ data: await svc.getPanelPayerReport(req.query as unknown as PanelPayerReportQuery) });
  },
  receiptExceptionLog: async (req: Request, res: Response) => {
    res.json({ data: await svc.getReceiptExceptionLog(req.query as unknown as ReceiptExceptionLogQuery) });
  },
  cashierPerformance: async (req: Request, res: Response) => {
    res.json({ data: await svc.getCashierPerformanceReport(req.query as unknown as CashierPerformanceQuery) });
  },
  financialExceptions: async (req: Request, res: Response) => {
    res.json({ data: await svc.getFinancialExceptions(req.query as unknown as FinancialExceptionsQuery) });
  },
  filterOptions: async (_req: Request, res: Response) => {
    res.json({ data: await svc.getFilterOptions() });
  },
};
