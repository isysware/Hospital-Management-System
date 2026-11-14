import { randomUUID } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/db/client';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors/AppError';
import { nextCode, SEQUENCE } from '@/shared/sequence';
import { hmsBridgeClient } from '@/shared/hmsBridgeClient';
import { broadcastHmsNotification } from '@/shared/hmsEvents';
import { pharmacyService } from '../pharmacy/pharmacy.service';
import type {
  CreateRequestBody,
  ListRequestsQuery,
  FulfillRequestBody,
  RejectRequestBody,
  UpdateSettingsBody,
  PatientCollectedCallbackBody,
  ReconcileCollectionBody,
  CreateSettlementRequestBody,
  ReleaseSettlementCallbackBody,
  HighCostApprovalCallbackBody,
} from './hms-requests.schemas';

async function getOrCreateSettings() {
  const existing = await prisma.pharmacySettings.findFirst();
  if (existing) return existing;
  return prisma.pharmacySettings.create({ data: {} });
}

const requestInclude = {
  lines: { include: { medicine: true, batch: true } },
  handledByUser: { select: { id: true, fullName: true, username: true } },
  approvedByUser: { select: { id: true, fullName: true, username: true } },
  invoice: { include: { lines: true, payments: true, settlements: true } },
} satisfies Prisma.MedicineRequestInclude;

export const hmsRequestsService = {
  // ── Settings ─────────────────────────────────────────────────────────────
  async getSettings() {
    return getOrCreateSettings();
  },
  async updateSettings(body: UpdateSettingsBody, actorId: string) {
    const settings = await getOrCreateSettings();
    return prisma.pharmacySettings.update({ where: { id: settings.id }, data: { ...body, updatedById: actorId } });
  },

  // ── Requests (Idempotent creation) ────────────────────────────────────────
  async createRequest(body: CreateRequestBody, actorId?: string) {
    let existing: any = null;
    if (body.externalRequestRef) {
      existing = await prisma.medicineRequest.findFirst({
        where: { externalRequestRef: body.externalRequestRef },
        include: requestInclude,
      });
    }
    if (!existing && body.externalAdmissionRef) {
      existing = await prisma.medicineRequest.findFirst({
        where: { externalAdmissionRef: body.externalAdmissionRef },
        orderBy: { requestedAt: 'asc' },
        include: requestInclude,
      });
    }

    if (existing) {
      // Find lines that are NOT already in existing.lines
      const existingLineTags = new Set(
        existing.lines
          .map((l: any) => {
            const match = l.notes?.match(/\[HMS_LINE:([^\]]+)\]/);
            return match ? match[1] : null;
          })
          .filter(Boolean),
      );

      // Determine lines to add:
      const linesToAdd = body.lines.filter((l) => {
        const match = l.notes?.match(/\[HMS_LINE:([^\]]+)\]/);
        if (match && existingLineTags.has(match[1])) {
          return false; // already ingested!
        }
        return true;
      });

      if (linesToAdd.length > 0) {
        for (const line of linesToAdd) {
          const medicine = await prisma.medicineMaster.findUnique({ where: { id: line.medicineId } });
          if (!medicine || !medicine.isActive) throw new NotFoundError(`Medicine ${line.medicineId} not found or inactive`);
        }

        await prisma.$transaction(async (tx) => {
          for (const l of linesToAdd) {
            await tx.medicineRequestLine.create({
              data: {
                medicineRequestId: existing.id,
                medicineId: l.medicineId,
                requestedQuantity: new Decimal(l.requestedQuantity),
                notes: l.notes,
              },
            });
          }

          // Update status to REQUESTED or PARTIALLY_ACCEPTED
          const allLines = await tx.medicineRequestLine.findMany({ where: { medicineRequestId: existing.id } });
          const anyDispensed = allLines.some((l) => l.dispensedQuantity.greaterThan(0));
          const updatedStatus = anyDispensed ? 'PARTIALLY_ACCEPTED' : 'REQUESTED';

          await tx.medicineRequest.update({
            where: { id: existing.id },
            data: {
              status: updatedStatus,
              patientNameSnapshot: body.patientNameSnapshot || existing.patientNameSnapshot,
              urgency: body.urgency || existing.urgency,
              requestedAt: new Date(),
              approvedById: null,
              approvedAt: null,
            },
          });
        });

        const updated = await prisma.medicineRequest.findUnique({
          where: { id: existing.id },
          include: requestInclude,
        });

        // Broadcast SSE notification for newly added lines
        const medSummary = linesToAdd.map((l) => `${l.requestedQuantity}x`).join(', ');
        broadcastHmsNotification({
          type: 'NEW_HMS_REQUEST',
          requestNumber: updated?.requestNumber || existing.requestNumber,
          patientName: updated?.patientNameSnapshot || 'Patient',
          admissionRef: existing.externalAdmissionRef,
          urgency: updated?.urgency || 'ROUTINE',
          medicinesSummary: `Added: ${medSummary}`,
          timestamp: new Date().toISOString(),
        });

        return updated!;
      }

      return existing;
    }

    for (const line of body.lines) {
      const medicine = await prisma.medicineMaster.findUnique({ where: { id: line.medicineId } });
      if (!medicine || !medicine.isActive) throw new NotFoundError(`Medicine ${line.medicineId} not found or inactive`);
    }

    let validActorId: string | null = null;
    if (actorId && actorId !== 'bridge-system') {
      const user = await prisma.portalUser.findUnique({ where: { id: actorId } });
      if (user) validActorId = user.id;
    }

    const created = await prisma.$transaction(async (tx) => {
      const requestNumber = await nextCode(tx, SEQUENCE.MEDICINE_REQUEST);
      return tx.medicineRequest.create({
        data: {
          requestNumber,
          externalAdmissionRef: body.externalAdmissionRef,
          externalRequestRef: body.externalRequestRef,
          patientNameSnapshot: body.patientNameSnapshot,
          urgency: (body.isHighCost && !body.isApproved) ? 'HIGH_COST_PENDING' : body.urgency,
          requestedByExternal: body.requestedByExternal,
          handledById: validActorId,
          approvedById: (body.isApproved && validActorId) ? validActorId : undefined,
          approvedAt: body.isApproved ? new Date() : undefined,
          lines: {
            create: body.lines.map((l) => ({
              medicineId: l.medicineId,
              requestedQuantity: new Decimal(l.requestedQuantity),
              notes: l.notes,
            })),
          },
        },
        include: requestInclude,
      });
    });

    // Broadcast real-time SSE notification to connected Pharmacy apps
    const medSummary = created.lines.map((l) => `${Number(l.requestedQuantity)}x ${l.medicine.name}`).join(', ');
    broadcastHmsNotification({
      type: 'NEW_HMS_REQUEST',
      requestNumber: created.requestNumber,
      patientName: created.patientNameSnapshot || 'Patient',
      admissionRef: created.externalAdmissionRef,
      urgency: created.urgency || 'ROUTINE',
      medicinesSummary: medSummary,
      timestamp: new Date().toISOString(),
    });

    return created;
  },

  // ── Sync queued requests from HMS Outbox (when Pharmacy was offline) ──────
  async syncFromHmsOutbox() {
    try {
      const pending = await hmsBridgeClient.getPendingRequests();
      if (!Array.isArray(pending) || pending.length === 0) {
        return { synced: 0 };
      }

      let syncedCount = 0;
      for (const req of pending) {
        if (!req.externalRequestRef) continue;

        // Check if already ingested in Pharmacy
        const existing = await prisma.medicineRequest.findFirst({
          where: { externalRequestRef: req.externalRequestRef },
        });
        if (existing) continue;

        const validLines: Array<{ medicineId: string; requestedQuantity: number; notes?: string }> = [];
        for (const l of req.lines || []) {
          let med = await prisma.medicineMaster.findUnique({ where: { id: l.medicineId } });
          if (!med && l.medicineName) {
            med = await prisma.medicineMaster.findFirst({
              where: { name: { equals: l.medicineName, mode: 'insensitive' } },
            });
          }
          if (med) {
            validLines.push({
              medicineId: med.id,
              requestedQuantity: Number(l.requestedQuantity),
              notes: l.notes,
            });
          }
        }

        if (validLines.length === 0) continue;

        await this.createRequest(
          {
            externalAdmissionRef: req.externalAdmissionRef,
            externalRequestRef: req.externalRequestRef,
            patientNameSnapshot: req.patientNameSnapshot,
            urgency: req.urgency || 'ROUTINE',
            requestedByExternal: req.requestedByExternal,
            lines: validLines,
          },
          'bridge-system',
        );
        syncedCount++;
      }

      return { synced: syncedCount };
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('[hmsRequestsService.syncFromHmsOutbox] sync warning:', err?.message || err);
      return { synced: 0, error: err?.message };
    }
  },

  async list(query: ListRequestsQuery) {
    // Proactively pull any pending requests that were queued while Pharmacy was offline
    await this.syncFromHmsOutbox().catch(() => null);
    return prisma.medicineRequest.findMany({ where: { status: query.status }, include: requestInclude, orderBy: { requestedAt: 'desc' } });
  },

  async getById(id: string) {
    const req = await prisma.medicineRequest.findUnique({ where: { id }, include: requestInclude });
    if (!req) throw new NotFoundError('Medicine request not found');
    return req;
  },

  async estimatedValue(requestId: string): Promise<Decimal> {
    const lines = await prisma.medicineRequestLine.findMany({ where: { medicineRequestId: requestId }, include: { medicine: true } });
    if (lines.length === 0) return new Decimal(0);

    const medicineIds = [...new Set(lines.map((l) => l.medicineId))];
    const now = new Date();
    const batches = await prisma.medicineBatch.findMany({
      where: { medicineId: { in: medicineIds }, expiryDate: { gt: now } },
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
      include: { stockEntries: { select: { quantityDelta: true } } },
    });

    const poolByMed = new Map<string, Array<{ remaining: Decimal; saleRate: Decimal | null }>>();
    for (const b of batches) {
      const available = b.stockEntries.reduce((s, e) => s.plus(e.quantityDelta), new Decimal(0));
      if (available.lte(0)) continue;
      const list = poolByMed.get(b.medicineId) ?? [];
      list.push({ remaining: available, saleRate: b.saleRate });
      poolByMed.set(b.medicineId, list);
    }

    let total = new Decimal(0);
    for (const l of lines) {
      let needed = new Decimal(l.requestedQuantity);
      const medBatches = poolByMed.get(l.medicineId) ?? [];
      for (const b of medBatches) {
        if (needed.lte(0)) break;
        if (b.remaining.lte(0)) continue;
        const take = Decimal.min(needed, b.remaining);
        const rate = b.saleRate ?? l.medicine.saleRate;
        total = total.plus(take.mul(rate));
        b.remaining = b.remaining.minus(take);
        needed = needed.minus(take);
      }
      if (needed.gt(0)) {
        total = total.plus(needed.mul(l.medicine.saleRate));
      }
    }
    return total;
  },

  // ── Approvals & Rejections ────────────────────────────────────────────────
  async approve(id: string, actorId: string) {
    const request = await prisma.medicineRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundError('Medicine request not found');
    if (request.status !== 'REQUESTED') throw new ConflictError('Only a pending request can be approved');
    if (request.approvedById) throw new ConflictError('This request is already approved');
    return prisma.medicineRequest.update({ where: { id }, data: { approvedById: actorId, approvedAt: new Date() }, include: requestInclude });
  },

  async reject(id: string, body: RejectRequestBody, actorId: string) {
    const request = await prisma.medicineRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundError('Medicine request not found');
    if (request.status !== 'REQUESTED') throw new ConflictError('Only a pending request can be rejected');
    return prisma.medicineRequest.update({ where: { id }, data: { status: 'REJECTED', rejectionReason: body.reason, handledById: actorId }, include: requestInclude });
  },

  // ── FEFO Dispensing (HMS Linked Invoice) ──────────────────────────────────
  async fulfill(id: string, body: FulfillRequestBody, actorId: string) {
    const settings = await getOrCreateSettings();
    const request = await prisma.medicineRequest.findUnique({ where: { id }, include: { lines: { include: { medicine: true } } } });
    if (!request) throw new NotFoundError('Medicine request not found');
    if (request.status !== 'REQUESTED' && request.status !== 'PARTIALLY_ACCEPTED') {
      throw new ConflictError(`Cannot fulfill a request with status ${request.status}`);
    }

    if (request.urgency === 'HIGH_COST_PENDING' && !request.approvedById) {
      throw new ConflictError('This medicine request contains high-cost medicines and requires HMS Admin/Super Admin approval before dispensing.');
    }

    if (settings.highValueApprovalEnabled) {
      const value = await hmsRequestsService.estimatedValue(id);
      if (value.greaterThanOrEqualTo(settings.highValueThreshold) && !request.approvedById) {
        throw new ConflictError(`This request (PKR ${value.toFixed(2)}) is at/above the high-value threshold (PKR ${settings.highValueThreshold.toFixed(2)}) and needs approval before dispensing.`);
      }
    }

    const linesByRequestLineId = new Map(request.lines.map((l) => [l.id, l]));
    for (const fl of body.lines) {
      const line = linesByRequestLineId.get(fl.requestLineId);
      if (!line) throw new NotFoundError(`Request line ${fl.requestLineId} not found on this request`);
      const remaining = line.requestedQuantity.minus(line.dispensedQuantity);
      if (new Decimal(fl.dispenseQuantity).greaterThan(remaining)) {
        throw new ValidationError(`Cannot dispense more than the remaining ${remaining} for ${line.medicine.name}`);
      }
    }

    const dispenseEventId = `DISP-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const updatedRequest = await prisma.$transaction(async (tx) => {
      let subtotal = new Decimal(0);
      let taxTotal = new Decimal(0);
      const invoiceLines: Prisma.PharmacyInvoiceLineCreateManyInvoiceInput[] = [];
      const stockDeductions: { medicineId: string; batchId: string | null; quantity: Decimal }[] = [];

      for (const fl of body.lines) {
        const qty = new Decimal(fl.dispenseQuantity);
        if (qty.lessThanOrEqualTo(0)) continue;
        const line = linesByRequestLineId.get(fl.requestLineId)!;
        const medicine = line.medicine;

        const allocations = await pharmacyService.allocateFefoBatches(medicine.id, qty, tx);
        for (const alloc of allocations) {
          const gross = alloc.quantity.mul(alloc.saleRate);
          const tax = gross.mul(medicine.taxPercent).div(100);
          subtotal = subtotal.plus(gross);
          taxTotal = taxTotal.plus(tax);
          invoiceLines.push({
            medicineId: medicine.id,
            batchId: alloc.batchId,
            quantity: alloc.quantity,
            rateSnapshot: alloc.saleRate,
            costRateSnapshot: alloc.costRate,
            discountAmount: 0,
            taxAmount: tax,
            lineNet: gross.plus(tax),
            medicineRequestId: id,
            requestLineId: line.id,
            externalRequestRef: request.externalRequestRef,
            dispenseEventId,
            dispensedById: actorId,
            dispensedAt: new Date(),
          });
          stockDeductions.push({ medicineId: medicine.id, batchId: alloc.batchId, quantity: alloc.quantity });
        }

        await tx.medicineRequestLine.update({
          where: { id: line.id },
          data: { dispensedQuantity: line.dispensedQuantity.plus(qty), batchId: allocations[0]?.batchId ?? line.batchId },
        });
      }

      const callTotal = subtotal.plus(taxTotal);

      // ── ONE ACTIVE ADMISSION = ONE HMS-LINKED PHARMACY INVOICE ──────────────
      // Concurrency lock per admission reference (§1, §17)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${request.externalAdmissionRef}))`;

      // Search for an existing active/open HMS-linked invoice for this admission
      const existingInvoice = await tx.pharmacyInvoice.findFirst({
        where: {
          channel: 'HMS_LINKED',
          externalAdmissionRef: request.externalAdmissionRef,
        },
        orderBy: { createdAt: 'desc' },
      });

      let targetInvoiceId: string;

      if (existingInvoice) {
        const newSubtotal = existingInvoice.subtotal.plus(subtotal);
        const newTaxTotal = existingInvoice.taxTotal.plus(taxTotal);
        const newTotal = existingInvoice.total.plus(callTotal);
        const newOutstanding = Decimal.max(0, newTotal.minus(existingInvoice.paidTotal));
        const newStatus = newOutstanding.equals(0)
          ? 'PAID'
          : existingInvoice.paidTotal.greaterThan(0)
            ? 'PARTIALLY_PAID'
            : 'UNPAID';
        const newClearanceStatus = newOutstanding.equals(0) ? 'CLEARED' : 'OUTSTANDING';

        await tx.pharmacyInvoice.update({
          where: { id: existingInvoice.id },
          data: {
            subtotal: newSubtotal,
            taxTotal: newTaxTotal,
            total: newTotal,
            outstanding: newOutstanding,
            status: newStatus,
            clearanceStatus: newClearanceStatus,
            lines: invoiceLines.length ? { create: invoiceLines } : undefined,
          },
        });

        targetInvoiceId = existingInvoice.id;
      } else {
        const invoiceNumber = await nextCode(tx, SEQUENCE.INVOICE_HMS);
        const createdInvoice = await tx.pharmacyInvoice.create({
          data: {
            invoiceNumber,
            channel: 'HMS_LINKED',
            externalAdmissionRef: request.externalAdmissionRef,
            collectionOwner: 'HMS_FRONT_DESK',
            internalSettlementStatus: 'NOT_DUE',
            medicineRequestId: id,
            customerName: request.patientNameSnapshot,
            subtotal,
            discountTotal: 0,
            taxTotal,
            total: callTotal,
            paidTotal: 0,
            outstanding: callTotal,
            hmsReceivable: 0,
            status: 'UNPAID',
            clearanceStatus: 'OUTSTANDING',
            dispensedById: actorId,
            lines: { create: invoiceLines },
          },
        });

        targetInvoiceId = createdInvoice.id;
      }

      for (const d of stockDeductions) {
        await tx.stockLedgerEntry.create({
          data: {
            medicineId: d.medicineId,
            batchId: d.batchId,
            movementType: 'HMS_DISPENSE_OUT',
            quantityDelta: d.quantity.negated(),
            referenceTable: 'medicine_requests',
            referenceId: id,
            actorId,
          },
        });
      }
      const touchedMedicineIds = new Set(stockDeductions.map((d) => d.medicineId));
      for (const medicineId of touchedMedicineIds) {
        await pharmacyService.syncEffectiveSaleRate(medicineId, tx);
      }

      const allLines = await tx.medicineRequestLine.findMany({ where: { medicineRequestId: id } });
      const allFullyDispensed = allLines.every((l) => l.dispensedQuantity.greaterThanOrEqualTo(l.requestedQuantity));
      const anyDispensed = allLines.some((l) => l.dispensedQuantity.greaterThan(0));
      const newStatus = allFullyDispensed ? 'DISPENSED' : anyDispensed ? 'PARTIALLY_ACCEPTED' : request.status;

      return tx.medicineRequest.update({
        where: { id },
        data: {
          status: newStatus,
          handledById: actorId,
          invoiceId: targetInvoiceId,
        },
        include: requestInclude,
      });
    });

    // Notify HMS Backend via Webhook
    if (updatedRequest.invoiceId) {
      const dispenser = actorId ? await prisma.portalUser.findUnique({ where: { id: actorId } }) : null;
      const fullLines = await prisma.pharmacyInvoiceLine.findMany({
        where: { invoiceId: updatedRequest.invoiceId },
        include: { medicine: true, batch: true },
        orderBy: { dispensedAt: 'asc' },
      });

      const invoice = await prisma.pharmacyInvoice.findUnique({
        where: { id: updatedRequest.invoiceId },
      });

      if (invoice) {
        const linkedRequests = await prisma.medicineRequest.findMany({
          where: { invoiceId: invoice.id },
          select: { externalRequestRef: true, status: true },
        });
        const dispenserName = dispenser?.fullName || dispenser?.username || 'Pharmacy Dispenser';
        const eventLines = fullLines.filter((l) => l.dispenseEventId === dispenseEventId);
        const deltaAmount = eventLines.reduce((s, l) => s + Number(l.lineNet), 0);

        hmsBridgeClient
          .notifyDispensed({
            dispenseEventId,
            externalAdmissionRef: updatedRequest.externalAdmissionRef,
            externalRequestRef: updatedRequest.externalRequestRef,
            pharmacyInvoiceId: invoice.id,
            pharmacyInvoiceNumber: invoice.invoiceNumber,
            subtotal: Number(invoice.subtotal),
            taxTotal: Number(invoice.taxTotal),
            discountTotal: Number(invoice.discountTotal),
            totalAmount: Number(invoice.total),
            deltaAmount,
            dispensedBy: dispenserName,
            dispensedAt: new Date().toISOString(),
            requestStatuses: linkedRequests.filter(r => r.externalRequestRef && ['DISPENSED', 'PARTIALLY_ACCEPTED'].includes(r.status))
              .map(r => ({ externalRequestRef: r.externalRequestRef!, status: r.status === 'DISPENSED' ? 'DISPENSED' as const : 'PARTIALLY_FULFILLED' as const })),
            lines: fullLines.map((l) => ({
              dispenseEventId: l.dispenseEventId || dispenseEventId,
              externalRequestRef: l.externalRequestRef || updatedRequest.externalRequestRef,
              medicineName: l.medicine.name,
              unit: l.medicine.unit,
              batchNumber: l.batch?.batchNumber || null,
              quantity: Number(l.quantity),
              rate: Number(l.rateSnapshot),
              lineNet: Number(l.lineNet),
              dispensedAt: l.dispensedAt?.toISOString(),
              dispensedBy: dispenserName,
            })),
          })
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[hmsRequestsService] notifyDispensed webhook error:', err.message);
          });
      }
    }

    return updatedRequest;
  },

  // ── Patient Front Desk Collection Callback ────────────────────────────────
  async handlePatientCollected(body: PatientCollectedCallbackBody) {
    if (!body.receiptNumber || !body.collectedAt || !Number.isFinite(Date.parse(body.collectedAt)))
      throw new ValidationError('A stable HMS receipt number and actual collection date are required');
    return recordHmsCollection(body.pharmacyInvoiceNumber, new Decimal(body.collectedAmount), false,
      body.receiptNumber, new Date(body.collectedAt), body.method, body.collectedBy);
  },
  async reconcileHmsCollected(body: ReconcileCollectionBody) {
    // Undated totals repair operational balances, but cannot establish a revenue period.
    return recordHmsCollection(body.pharmacyInvoiceNumber,new Decimal(body.authoritativeCollectedAmount),true,
      body.receiptNumber, body.collectedAt ? new Date(body.collectedAt) : undefined,body.method,body.collectedBy);
  },

  async createSettlementRequest(body: CreateSettlementRequestBody, actorId: string) {
    const invoice = await prisma.pharmacyInvoice.findUnique({
      where: { invoiceNumber: body.invoiceNumber },
      include: { medicineRequests: true },
    });
    if (!invoice) throw new NotFoundError(`Invoice ${body.invoiceNumber} not found`);
    if (invoice.channel !== 'HMS_LINKED') throw new ConflictError('Only HMS-linked invoices can request settlement');

    if (invoice.internalSettlementStatus !== 'PENDING' && invoice.internalSettlementStatus !== 'PARTIALLY_RELEASED') {
      throw new ConflictError(`Invoice is in status ${invoice.internalSettlementStatus}, cannot request settlement`);
    }

    const requested = new Decimal(body.amountRequested);
    if (requested.greaterThan(invoice.hmsReceivable)) {
      throw new ValidationError(`Requested amount (${requested}) exceeds remaining receivable (${invoice.hmsReceivable})`);
    }

    const user = await prisma.portalUser.findUnique({ where: { id: actorId } });
    const settlementNumber = `SET-PHARM-${Date.now().toString().slice(-6)}`;

    const settlement = await prisma.$transaction(async (tx) => {
      const rec = await tx.hmsReceivableSettlement.create({
        data: {
          settlementNumber,
          invoiceId: invoice.id,
          externalAdmissionRef: invoice.externalAdmissionRef || 'N/A',
          patientNameSnapshot: invoice.customerName,
          invoiceNumber: invoice.invoiceNumber,
          invoiceTotal: invoice.total,
          hmsCollected: invoice.hmsCollectedAmount,
          amountRequested: requested,
          amountReleased: new Decimal(0),
          remainingReceivable: invoice.hmsReceivable,
          status: 'REQUESTED',
          requestedById: actorId,
          releaseRemarks: body.remarks,
        },
      });

      await tx.pharmacyInvoice.update({
        where: { id: invoice.id },
        data: { internalSettlementStatus: 'REQUESTED' },
      });

      return rec;
    });

    // Notify HMS Backend
    await hmsBridgeClient.requestSettlement({
      settlementNumber,
      pharmacyInvoiceNumber: invoice.invoiceNumber,
      requestedAmount: Number(requested),
      requestedBy: user?.fullName || user?.username || 'Pharmacy Manager',
      remarks: body.remarks,
    });

    return settlement;
  },

  // ── Handle Settlement Release from HMS ─────────────────────────────────────
  async handleSettlementRelease(body: ReleaseSettlementCallbackBody) {
    const invoice = await prisma.pharmacyInvoice.findUnique({
      where: { invoiceNumber: body.pharmacyInvoiceNumber },
    });
    if (!invoice) throw new NotFoundError(`Invoice ${body.pharmacyInvoiceNumber} not found`);

    const released = new Decimal(body.releasedAmount);
    const newSettled = invoice.hmsSettledAmount.plus(released);
    const newReceivable = Decimal.max(0, invoice.hmsReceivable.minus(released));
    const newStatus = newReceivable.equals(0) ? 'SETTLED' : 'PARTIALLY_RELEASED';

    return prisma.$transaction(async (tx) => {
      await tx.pharmacyInvoice.update({
        where: { id: invoice.id },
        data: {
          hmsSettledAmount: newSettled,
          hmsReceivable: newReceivable,
          internalSettlementStatus: newStatus,
        },
      });

      const existingSettlement = await tx.hmsReceivableSettlement.findFirst({
        where: {
          OR: [{ settlementNumber: body.settlementNumber }, { invoiceId: invoice.id }],
        },
        orderBy: { requestedAt: 'desc' },
      });

      if (existingSettlement) {
        await tx.hmsReceivableSettlement.update({
          where: { id: existingSettlement.id },
          data: {
            amountReleased: existingSettlement.amountReleased.plus(released),
            remainingReceivable: newReceivable,
            status: newStatus,
            releasedAt: body.releasedAt ? new Date(body.releasedAt) : new Date(),
            paymentMethod: body.paymentMethod,
            paymentReference: body.paymentReference,
            releaseRemarks: body.remarks,
          },
        });
      }

      return {
        invoiceNumber: invoice.invoiceNumber,
        releasedAmount: released,
        remainingReceivable: newReceivable,
        status: newStatus,
      };
    });
  },

  // ── List Receivables & Settlements ────────────────────────────────────────
  async listReceivables() {
    return prisma.pharmacyInvoice.findMany({
      where: { channel: 'HMS_LINKED' },
      include: {
        medicineRequests: true,
        settlements: { orderBy: { requestedAt: 'desc' } },
        dispensedByUser: { select: { fullName: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async handleHighCostApprovalCallback(body: HighCostApprovalCallbackBody) {
    const request = await prisma.medicineRequest.findFirst({
      where: {
        OR: [
          { externalRequestRef: body.externalRequestRef },
          { id: body.externalRequestRef },
        ],
      },
    });
    if (!request) {
      throw new NotFoundError(`Medicine request not found for external reference ${body.externalRequestRef}`);
    }

    if (body.isApproved) {
      let approverId = request.handledById;
      if (!approverId) {
        const sysUser = await prisma.portalUser.findFirst({ where: { role: 'ADMIN' } });
        approverId = sysUser?.id || null;
      }

      const updated = await prisma.medicineRequest.update({
        where: { id: request.id },
        data: {
          urgency: 'ROUTINE',
          approvedById: approverId,
          approvedAt: new Date(),
        },
      });

      broadcastHmsNotification({
        type: 'NEW_HMS_REQUEST',
        requestNumber: request.requestNumber,
        patientName: request.patientNameSnapshot || 'Patient',
        admissionRef: request.externalAdmissionRef,
        urgency: 'ROUTINE',
        medicinesSummary: `HMS Approval Granted by ${body.approvedBy || 'Management'} — Unlocked for Dispensing`,
        timestamp: new Date().toISOString(),
      });

      return updated;
    } else {
      const updated = await prisma.medicineRequest.update({
        where: { id: request.id },
        data: {
          status: 'REJECTED',
          rejectionReason: body.rejectionReason || 'Rejected by HMS Management',
        },
      });

      broadcastHmsNotification({
        type: 'NEW_HMS_REQUEST',
        requestNumber: request.requestNumber,
        patientName: request.patientNameSnapshot || 'Patient',
        admissionRef: request.externalAdmissionRef,
        urgency: 'ROUTINE',
        medicinesSummary: `HMS High-Cost Request Rejected: ${body.rejectionReason || 'Declined'}`,
        timestamp: new Date().toISOString(),
      });

      return updated;
    }
  },
};

export async function recordHmsCollection(invoiceNumber: string, amount: Decimal, authoritative: boolean,
  receipt?: string, occurredAt?: Date, method?: string, actorId?: string, transaction?: Prisma.TransactionClient) {
  const execute = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceNumber}))`;
    const invoice=await tx.pharmacyInvoice.findUnique({where:{invoiceNumber}});
    if(!invoice) throw new NotFoundError('Pharmacy invoice not found');
    if(invoice.channel!=='HMS_LINKED') throw new ValidationError('HMS collection must reference an HMS-linked invoice');
    const key=receipt?'hms:'+invoice.id+':'+receipt:null;
    if(key) {
      const previous=await tx.pharmacyFinancialEvent.findUnique({where:{eventKey:key}});
      if(previous) {
        if((!authoritative && !previous.collectionDelta.equals(amount)) || previous.occurredAt?.getTime()!==occurredAt?.getTime()) throw new ConflictError('HMS receipt identity reused with different values');
        return invoice;
      }
      if(invoice.processedCollectionReceipts.includes(receipt!)) return invoice;
    }
    const delta=authoritative?amount.minus(invoice.hmsCollectedAmount):amount;
    if(delta.isZero()) return invoice;
    const collected=invoice.hmsCollectedAmount.plus(delta);
    if(collected.lt(0)) throw new ValidationError('HMS collection reversal exceeds collected amount');
    await tx.pharmacyFinancialEvent.create({data:{invoiceId:invoice.id,
      eventKey:key??'hms-reconcile:'+invoice.id+':'+randomUUID(),kind:'HMS_COLLECTION',occurredAt:occurredAt??null,
      collectionDelta:delta,method,actorId,reference:receipt}});
    const receivable=Decimal.max(0,collected.minus(invoice.hmsSettledAmount));
    const full=collected.gte(invoice.total);
    return tx.pharmacyInvoice.update({where:{id:invoice.id},data:{hmsCollectedAmount:collected,hmsReceivable:receivable,
      paidTotal:collected,outstanding:Decimal.max(0,invoice.total.minus(collected)),status:full?'PAID':collected.gt(0)?'PARTIALLY_PAID':'UNPAID',
      clearanceStatus:full?'CLEARED':invoice.clearanceStatus==='APPROVED_CREDIT'?'APPROVED_CREDIT':'OUTSTANDING',
      ...(receipt?{processedCollectionReceipts:{push:receipt}}:{}),
      internalSettlementStatus:['REQUESTED','PARTIALLY_RELEASED'].includes(invoice.internalSettlementStatus??'')?invoice.internalSettlementStatus:receivable.gt(0)?'PENDING':'SETTLED'}});
  };
  return transaction ? execute(transaction) : prisma.$transaction(execute);
}
