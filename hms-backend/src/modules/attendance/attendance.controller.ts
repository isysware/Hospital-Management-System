import type { Request, Response } from 'express';
import { attendanceService } from './attendance.service';
import { AuthenticationError } from '@/shared/errors/AppError';
import type {
  MarkAttendanceBody,
  BulkMarkAttendanceBody,
  RosterQuery,
  ListAttendanceQuery,
  SummaryQuery,
  CorrectAttendanceBody,
} from './attendance.schemas';

export const attendanceController = {
  async getRoster(req: Request, res: Response) {
    const rows = await attendanceService.getRoster(req.query as unknown as RosterQuery);
    res.json({ data: rows });
  },

  async mark(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const record = await attendanceService.mark(req.body as MarkAttendanceBody, req.user.sub);
    res.status(201).json({ data: record });
  },

  async bulkMark(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const result = await attendanceService.bulkMark(req.body as BulkMarkAttendanceBody, req.user.sub);
    res.status(201).json({ data: result });
  },

  async list(req: Request, res: Response) {
    const { rows, meta } = await attendanceService.list(req.query as unknown as ListAttendanceQuery);
    res.json({ data: rows, meta: { pagination: meta } });
  },

  async getSummary(req: Request, res: Response) {
    const rows = await attendanceService.getSummary(req.query as unknown as SummaryQuery);
    res.json({ data: rows });
  },

  async getById(req: Request, res: Response) {
    const record = await attendanceService.getById(req.params.id as string);
    res.json({ data: record });
  },

  async approve(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const record = await attendanceService.approve(req.params.id as string, req.user.sub);
    res.json({ data: record });
  },

  async correct(req: Request, res: Response) {
    if (!req.user) throw new AuthenticationError();
    const record = await attendanceService.correct(req.params.id as string, req.body as CorrectAttendanceBody, req.user.sub);
    res.json({ data: record });
  },
};
