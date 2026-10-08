import { doctorCharges, doctorFeeSchema } from '@/shared/doctorCharges';
import { Router } from 'express';
import { authorize } from '@/middleware/authorize';
import { validate } from '@/middleware/validate';
import { asyncHandler } from '@/shared/asyncHandler';
import { setupController as c } from './setup.controller';
import * as s from './setup.schemas';

/** §4.2, §8.4 — mounted at `/api/v1/setup`. */
const router = Router();
const view = authorize('setup', 'view');
const write = authorize('setup', 'edit');
const create = authorize('setup', 'create');
const remove = authorize('setup', 'delete');

// Hospital Profile & System Summary
router.get('/hospital-profile', view, asyncHandler(c.getHospitalProfile));
router.put('/hospital-profile', write, validate({ body: s.updateHospitalProfileSchema }), asyncHandler(c.updateHospitalProfile));
router.get('/hospital-summary', view, asyncHandler(c.getHospitalSummary));

// Departments
router.get('/departments', view, asyncHandler(c.listDepartments));
router.post('/departments', create, validate({ body: s.createDepartmentSchema }), asyncHandler(c.createDepartment));
router.patch('/departments/:id', write, validate({ params: s.idParamsSchema, body: s.updateDepartmentSchema }), asyncHandler(c.updateDepartment));
router.post('/departments/:id/deactivate', write, validate({ params: s.idParamsSchema }), asyncHandler(c.deactivateDepartment));
router.delete('/departments/:id', remove, validate({ params: s.idParamsSchema }), asyncHandler(c.deleteDepartment));

// Hospital Floors
router.get('/floors', view, asyncHandler(c.listFloors));
router.post('/floors', create, validate({ body: s.createFloorSchema }), asyncHandler(c.createFloor));
router.patch('/floors/:id', write, validate({ params: s.idParamsSchema, body: s.updateFloorSchema }), asyncHandler(c.updateFloor));
router.put('/floors/:id', write, validate({ params: s.idParamsSchema, body: s.updateFloorSchema }), asyncHandler(c.updateFloor));
router.delete('/floors/:id', remove, validate({ params: s.idParamsSchema }), asyncHandler(c.deleteFloor));

router.get('/doctor-fees', view, asyncHandler(async (_req, res) => { res.json({ data: await doctorCharges.list() }); }));
router.patch('/doctor-fees/:id', write, validate({ params: s.idParamsSchema, body: doctorFeeSchema }), asyncHandler(async (req, res) => { res.json({ data: await doctorCharges.configure(req.params.id!, req.body.consultationFee) }); }));

// Services & Rates
router.get('/services-rates', view, asyncHandler(c.listServiceRates));
router.post('/services-rates', create, validate({ body: s.createServiceRateSchema }), asyncHandler(c.createServiceRate));
router.patch('/services-rates/:id', write, validate({ params: s.idParamsSchema, body: s.updateServiceRateSchema }), asyncHandler(c.updateServiceRate));
router.post('/services-rates/:id/deactivate', write, validate({ params: s.idParamsSchema }), asyncHandler(c.deactivateServiceRate));
router.delete('/services-rates/:id', remove, validate({ params: s.idParamsSchema }), asyncHandler(c.deleteServiceRate));

// Wards / Rooms / Beds
router.get('/wards-rooms-beds', view, asyncHandler(c.listWardHierarchy));
router.post('/wards-rooms-beds/wards', create, validate({ body: s.createWardSchema }), asyncHandler(c.createWard));
router.patch('/wards-rooms-beds/wards/:id', write, validate({ params: s.idParamsSchema, body: s.updateWardSchema }), asyncHandler(c.updateWard));
router.delete('/wards-rooms-beds/wards/:id', remove, validate({ params: s.idParamsSchema }), asyncHandler(c.deleteWard));
router.post('/wards-rooms-beds/rooms', create, validate({ body: s.createRoomSchema }), asyncHandler(c.createRoom));
router.patch('/wards-rooms-beds/rooms/:id', write, validate({ params: s.idParamsSchema, body: s.updateRoomSchema }), asyncHandler(c.updateRoom));
router.delete('/wards-rooms-beds/rooms/:id', remove, validate({ params: s.idParamsSchema }), asyncHandler(c.deleteRoom));
router.post('/wards-rooms-beds/beds', create, validate({ body: s.createBedSchema }), asyncHandler(c.createBed));
router.patch('/wards-rooms-beds/beds/:id', write, validate({ params: s.idParamsSchema, body: s.updateBedSchema }), asyncHandler(c.updateBed));
router.delete('/wards-rooms-beds/beds/:id', remove, validate({ params: s.idParamsSchema }), asyncHandler(c.deleteBed));

// Shifts (Shift Master)
router.get('/shifts', view, asyncHandler(c.listShifts));
router.post('/shifts', create, validate({ body: s.createShiftSchema }), asyncHandler(c.createShift));
router.patch('/shifts/:id', write, validate({ params: s.idParamsSchema, body: s.updateShiftSchema }), asyncHandler(c.updateShift));
router.post('/shifts/:id/deactivate', write, validate({ params: s.idParamsSchema }), asyncHandler(c.deactivateShift));

// Corporate Panels
router.get('/panel-categories', view, asyncHandler(c.listPanelCategories));
router.get('/corporate-panels', view, asyncHandler(c.listCorporatePanels));
router.post('/corporate-panels', create, validate({ body: s.createCorporatePanelSchema }), asyncHandler(c.createCorporatePanel));
router.patch('/corporate-panels/:id', write, validate({ params: s.idParamsSchema, body: s.updateCorporatePanelSchema }), asyncHandler(c.updateCorporatePanel));
router.delete('/corporate-panels/:id', remove, validate({ params: s.idParamsSchema }), asyncHandler(c.deleteCorporatePanel));
router.put('/corporate-panels/:id/discount-rules', write, validate({ params: s.idParamsSchema, body: s.replaceDiscountRulesSchema }), asyncHandler(c.replaceDiscountRules));
router.get('/corporate-panels/:id/rule-history', view, validate({ params: s.idParamsSchema }), asyncHandler(c.listPanelRuleHistory));

// Outsourced Providers (HMS_V7.2_NEW_REQUIREMENTS.md §2.1)
router.get('/outsourced-providers', view, asyncHandler(c.listOutsourcedProviders));
router.post('/outsourced-providers', create, validate({ body: s.createOutsourcedProviderSchema }), asyncHandler(c.createOutsourcedProvider));
router.patch('/outsourced-providers/:id', write, validate({ params: s.idParamsSchema, body: s.updateOutsourcedProviderSchema }), asyncHandler(c.updateOutsourcedProvider));
router.post('/outsourced-providers/:id/deactivate', write, validate({ params: s.idParamsSchema }), asyncHandler(c.deactivateOutsourcedProvider));

// High-Cost Medicine Policy (HMS_V7.2_NEW_REQUIREMENTS.md §2.6)
router.get('/high-cost-medicine-policy', view, asyncHandler(c.getHighCostMedicinePolicy));
router.put('/high-cost-medicine-policy', write, validate({ body: s.updateHighCostMedicinePolicySchema }), asyncHandler(c.updateHighCostMedicinePolicy));

// Provider Settlements (HMS_V7.2_NEW_REQUIREMENTS.md §2.8)
router.get('/provider-settlements', view, validate({ query: s.listProviderSettlementsQuerySchema }), asyncHandler(c.listProviderSettlements));
router.post('/provider-settlements', create, validate({ body: s.createProviderSettlementSchema }), asyncHandler(c.createProviderSettlement));

// Reset Test / Transactional Data (Super Admin only)
router.post('/reset-transactional-data', remove, asyncHandler(c.resetTransactionalData));

export default router;
