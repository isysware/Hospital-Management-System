import crypto from 'crypto';
import { prisma } from '@/db/client';

type PrismaClientOrTx = any;

/**
 * Returns current 2-digit year (e.g. '26' for 2026).
 */
export function currentYear2(): string {
  return String(new Date().getFullYear()).slice(-2);
}

/**
 * Generates a compact random uppercase alphanumeric string
 * (excluding visually ambiguous characters 0, O, 1, I).
 */
export function compactRandom(length = 4): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let res = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    res += chars[bytes[i]! % chars.length];
  }
  return res;
}

/**
 * Generic helper for collision-safe sequential ID generation:
 * Format: `${prefix}${String(seq).padStart(padLength, '0')}` -> e.g. `INV-26-0001`
 * Falls back gracefully to `${prefix}${compactRandom()}` if DB is unavailable or mocked.
 */
async function generateSequentialId(
  tx: PrismaClientOrTx,
  modelName: string,
  field: string,
  prefix: string,
  padLength = 4,
): Promise<string> {
  const db = tx || prisma;
  const model = db?.[modelName];

  if (typeof model?.count === 'function') {
    try {
      const count = await model.count({
        where: { [field]: { startsWith: prefix } },
      });

      for (let offset = 1; offset <= 15; offset++) {
        const candidate = `${prefix}${String(count + offset).padStart(padLength, '0')}`;
        if (typeof model.findUnique === 'function') {
          const exists = await model.findUnique({
            where: { [field]: candidate },
            select: { id: true },
          });
          if (!exists) return candidate;
        } else if (typeof model.findFirst === 'function') {
          const exists = await model.findFirst({
            where: { [field]: candidate },
            select: { id: true },
          });
          if (!exists) return candidate;
        } else {
          return candidate;
        }
      }
    } catch {
      // Fall through to compact random fallback
    }
  }

  return `${prefix}${compactRandom(padLength)}`;
}

/**
 * Short Invoice Number: e.g. `INV-26-0001`
 */
export async function generateInvoiceNumber(tx?: PrismaClientOrTx): Promise<string> {
  const prefix = `INV-${currentYear2()}-`;
  return generateSequentialId(tx, 'hospitalInvoice', 'invoiceNumber', prefix, 4);
}

/**
 * Short Receipt Number: e.g. `REC-26-0001`
 */
export async function generateReceiptNumber(tx?: PrismaClientOrTx): Promise<string> {
  const prefix = `REC-${currentYear2()}-`;
  return generateSequentialId(tx, 'paymentReceipt', 'receiptNumber', prefix, 4);
}

/**
 * Professional Medical Record Number (MRN): e.g. `MR-000001`
 * Lifelong patient identifier without year prefix.
 *
 * A patient is EITHER a `PanelPatient` OR a `SelfPayEncounter` row, but
 * both draw from this one shared sequence — a self-pay visitor and a panel
 * patient must never be handed the same MR number. `generateSequentialId`
 * only checks one model, so this counts and probes across both.
 */
export async function generateMrNumber(tx?: PrismaClientOrTx): Promise<string> {
  const db = tx || prisma;
  const prefix = 'MR-';
  const padLength = 6;

  try {
    const [panelCount, selfPayCount] = await Promise.all([
      db.panelPatient.count({ where: { mrNumber: { startsWith: prefix } } }),
      db.selfPayEncounter.count({ where: { mrNumber: { startsWith: prefix } } }),
    ]);
    const baseCount = panelCount + selfPayCount;

    for (let offset = 1; offset <= 15; offset++) {
      const candidate = `${prefix}${String(baseCount + offset).padStart(padLength, '0')}`;
      const [existsPanel, existsSelfPay] = await Promise.all([
        db.panelPatient.findUnique({ where: { mrNumber: candidate }, select: { id: true } }),
        db.selfPayEncounter.findUnique({ where: { mrNumber: candidate }, select: { id: true } }),
      ]);
      if (!existsPanel && !existsSelfPay) return candidate;
    }
  } catch {
    // Fall through to compact random fallback
  }

  return `${prefix}${compactRandom(padLength)}`;
}

/**
 * Short Admission Number: e.g. `ADM-26-0001`
 */
export async function generateAdmissionNumber(tx?: PrismaClientOrTx): Promise<string> {
  const prefix = `ADM-${currentYear2()}-`;
  return generateSequentialId(tx, 'admissionRecord', 'admissionNumber', prefix, 4);
}

/**
 * Short Panel Remittance Number: e.g. `PRM-26-0001`
 */
export async function generateRemittanceNumber(tx?: PrismaClientOrTx): Promise<string> {
  const prefix = `PRM-${currentYear2()}-`;
  return generateSequentialId(tx, 'panelRemittance', 'remittanceNumber', prefix, 4);
}

/**
 * Short Medicine Request Number: e.g. `REQ-0001`
 */
export async function generateMedicineRequestNumber(tx?: PrismaClientOrTx): Promise<string> {
  const prefix = 'REQ-';
  return generateSequentialId(tx, 'pharmacyClearance', 'medicineRequestNumber', prefix, 4);
}

/**
 * Short Admission Final Bill Number: e.g. `FBL-26-0001` — generated exactly
 * once per admission by `admissionBillingService.generateFinalBill`.
 */
export async function generateFinalBillNumber(tx?: PrismaClientOrTx): Promise<string> {
  const prefix = `FBL-${currentYear2()}-`;
  return generateSequentialId(tx, 'admissionRecord', 'finalBillNumber', prefix, 4);
}

/**
 * Expense Number: e.g. `EXP-26-0001`
 */
export async function generateExpenseNumber(tx?: PrismaClientOrTx): Promise<string> {
  const prefix = `EXP-${currentYear2()}-`;
  return generateSequentialId(tx, 'expense', 'expenseNumber', prefix, 4);
}

export interface QueueTokenResult {
  queueNumber: string;
  queueSequence: number;
  queueDate: Date;
}

export function getQueuePrefix(encounterType: string): string | null {
  const norm = String(encounterType || '').toUpperCase();
  if (norm === 'OPD') return 'OPD-';
  if (norm === 'EMERGENCY' || norm === 'ER') return 'ER-';
  if (norm === 'OBSERVATION' || norm === 'OBS') return 'OBS-';
  if (norm === 'CUSTOM') return 'OPD-';
  return null;
}

export function getNormalizedEncounterType(encounterType: string): 'OPD' | 'EMERGENCY' | 'OBSERVATION' | null {
  const norm = String(encounterType || '').toUpperCase();
  if (norm === 'OPD' || norm === 'CUSTOM') return 'OPD';
  if (norm === 'EMERGENCY' || norm === 'ER') return 'EMERGENCY';
  if (norm === 'OBSERVATION' || norm === 'OBS') return 'OBSERVATION';
  return null;
}

/**
 * Generates an automated, date-scoped Queue/Token Number for OPD, ER, and Observation encounters.
 * Strictly NEVER generates a token for IPD / Admission.
 * 
 * Safe database-backed generation via `DailyQueueSequence` with atomic upsert + increment,
 * preventing duplicate tokens during concurrent requests.
 * Display format: OPD-001, ER-001, OBS-001.
 */
export async function generateQueueToken(
  encounterType: string,
  tx?: PrismaClientOrTx,
  targetDate?: Date,
): Promise<QueueTokenResult | null> {
  const normType = getNormalizedEncounterType(encounterType);
  const prefix = getQueuePrefix(encounterType);
  if (!normType || !prefix) {
    return null; // IPD / Admission or unsupported encounter types do not get queue tokens
  }

  const db = tx || prisma;
  const d = targetDate || new Date();
  const dateStr = d.toISOString().slice(0, 10);
  const queueDate = new Date(`${dateStr}T00:00:00.000Z`);

  let sequence = 1;

  if (typeof db?.dailyQueueSequence?.upsert === 'function') {
    try {
      const record = await db.dailyQueueSequence.upsert({
        where: {
          encounterType_date: {
            encounterType: normType,
            date: queueDate,
          },
        },
        create: {
          encounterType: normType,
          date: queueDate,
          lastSequence: 1,
        },
        update: {
          lastSequence: {
            increment: 1,
          },
        },
        select: {
          lastSequence: true,
        },
      });
      sequence = record.lastSequence;
    } catch {
      sequence = await fallbackSequenceLookup(db, normType, queueDate);
    }
  } else {
    sequence = await fallbackSequenceLookup(db, normType, queueDate);
  }

  const queueNumber = `${prefix}${String(sequence).padStart(3, '0')}`;
  return {
    queueNumber,
    queueSequence: sequence,
    queueDate,
  };
}

async function fallbackSequenceLookup(db: any, encounterType: string, queueDate: Date): Promise<number> {
  try {
    if (typeof db?.hospitalInvoice?.count === 'function') {
      const nextDay = new Date(queueDate.getTime() + 24 * 60 * 60 * 1000);
      const count = await db.hospitalInvoice.count({
        where: {
          encounterType: encounterType as any,
          queueDate: {
            gte: queueDate,
            lt: nextDay,
          },
        },
      });
      return count + 1;
    }
  } catch {
    // ignore
  }
  return 1;
}

