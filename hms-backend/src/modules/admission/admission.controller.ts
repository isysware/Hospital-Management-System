import type { Request, Response } from 'express';
import { admissionService } from './admission.service';
import { AuthenticationError } from '@/shared/errors/AppError';
import type {
  CreatePlannedAdmissionBody,
  UpdatePlannedAdmissionBody,
  CheckInAdmissionBody,
  RequestPaymentBody,
  TransferBedBody,
  AddAdmissionServiceBody,
  ChangeMedicationModeBody,
  CreatePharmacyRequestBody,
  GrantClearanceBody,
  ListAdmissionsQuery,
  ClinicalDischargeBody,
  AuthorizeHighCostMedicineBody,
  RejectHighCostMedicineBody,
  CloseHospitalDayBody,
} from './admission.schemas';

function actorId(req: Request): string {
  if (!req.user) throw new AuthenticationError();
  return req.user.sub;
}

export const admissionController = {
  createPlannedAdmission: async (req: Request, res: Response) => {
    const admission = await admissionService.createPlannedAdmission(
      req.body as CreatePlannedAdmissionBody,
      actorId(req),
    );
    res.status(201).json({ data: admission });
  },

  listAdmissions: async (req: Request, res: Response) => {
    const admissions = await admissionService.listAdmissions(
      req.query as unknown as ListAdmissionsQuery,
    );
    res.json({ data: admissions });
  },

  getAdmission: async (req: Request, res: Response) => {
    const admission = await admissionService.getAdmission(req.params.id as string);
    res.json({ data: admission });
  },

  updatePlannedAdmission: async (req: Request, res: Response) => {
    const updated = await admissionService.updatePlannedAdmission(
      req.params.id as string,
      req.body as UpdatePlannedAdmissionBody,
    );
    res.json({ data: updated });
  },

  requestPayment: async (req: Request, res: Response) => {
    const request = await admissionService.requestPayment(
      req.params.id as string,
      req.body as RequestPaymentBody,
      actorId(req),
    );
    res.status(201).json({ data: request });
  },

  checkInAdmission: async (req: Request, res: Response) => {
    const result = await admissionService.checkInAdmission(
      req.params.id as string,
      req.body as CheckInAdmissionBody,
      actorId(req),
    );
    res.json({ data: result });
  },

  transferBed: async (req: Request, res: Response) => {
    const result = await admissionService.transferBed(
      req.params.id as string,
      req.body as TransferBedBody,
      actorId(req),
    );
    res.json({ data: result });
  },

  addAdmissionService: async (req: Request, res: Response) => {
    const line = await admissionService.addAdmissionService(
      req.params.id as string,
      req.body as AddAdmissionServiceBody,
      actorId(req),
    );
    res.status(201).json({ data: line });
  },

  changeMedicationMode: async (req: Request, res: Response) => {
    const result = await admissionService.changeMedicationMode(
      req.params.id as string,
      req.body as ChangeMedicationModeBody,
      actorId(req),
    );
    res.json({ data: result });
  },

  createPharmacyRequest: async (req: Request, res: Response) => {
    const request = await admissionService.createPharmacyRequest(
      req.params.id as string,
      req.body as CreatePharmacyRequestBody,
      actorId(req),
    );
    res.status(201).json({ data: request });
  },

  grantClearance: async (req: Request, res: Response) => {
    const clearance = await admissionService.grantClearance(
      req.params.id as string,
      req.body as GrantClearanceBody,
      actorId(req),
    );
    res.json({ data: clearance });
  },

  getClearances: async (req: Request, res: Response) => {
    const status = await admissionService.getClearances(req.params.id as string);
    res.json({ data: status });
  },

  dischargePatient: async (req: Request, res: Response) => {
    const result = await admissionService.dischargePatient(
      req.params.id as string,
      actorId(req),
    );
    res.json({ data: result });
  },

  getDischargeSummary: async (req: Request, res: Response) => {
    const summary = await admissionService.getDischargeSummary(req.params.id as string);
    res.json({ data: summary });
  },

  verifyDischargeDoctor: async (req: Request, res: Response) => {
    const doctor = await admissionService.verifyDischargeDoctor(req.body.doctorUsername, req.body.doctorPassword);
    res.json({ data: doctor });
  },

  clinicalDischarge: async (req: Request, res: Response) => {
    const result = await admissionService.clinicalDischarge(
      req.params.id as string,
      req.body as ClinicalDischargeBody,
      actorId(req),
    );
    res.json({ data: result });
  },

  authorizeHighCostMedicine: async (req: Request, res: Response) => {
    const result = await admissionService.authorizeHighCostMedicine(
      req.params.id as string,
      req.params.clearanceId as string,
      req.body as AuthorizeHighCostMedicineBody,
      actorId(req),
    );
    res.json({ data: result });
  },

  rejectHighCostMedicine: async (req: Request, res: Response) => {
    const result = await admissionService.rejectHighCostMedicine(
      req.params.id as string,
      req.params.clearanceId as string,
      req.body as RejectHighCostMedicineBody,
    );
    res.json({ data: result });
  },

  closeHospitalDay: async (req: Request, res: Response) => {
    const result = await admissionService.closeHospitalDay(
      req.body as CloseHospitalDayBody,
      actorId(req),
    );
    res.status(201).json({ data: result });
  },

  getDayCloseHistory: async (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const history = await admissionService.getDayCloseHistory(limit);
    res.json({ data: history });
  },
};
