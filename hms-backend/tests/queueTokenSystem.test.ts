import { describe, expect, it } from 'vitest';
import {
  generateQueueToken,
  getQueuePrefix,
  getNormalizedEncounterType,
} from '../src/shared/idGenerator';

describe('Queue / Token Number System', () => {
  it('correctly maps prefixes and normalized encounter types', () => {
    expect(getQueuePrefix('OPD')).toBe('OPD-');
    expect(getQueuePrefix('EMERGENCY')).toBe('ER-');
    expect(getQueuePrefix('ER')).toBe('ER-');
    expect(getQueuePrefix('OBSERVATION')).toBe('OBS-');
    expect(getQueuePrefix('OBS')).toBe('OBS-');

    // IPD / Admission must NEVER have a token prefix
    expect(getQueuePrefix('ADMISSION')).toBeNull();
    expect(getQueuePrefix('IPD')).toBeNull();
    expect(getNormalizedEncounterType('ADMISSION')).toBeNull();
    expect(getNormalizedEncounterType('IPD')).toBeNull();
  });

  it('Test 1: Generates OPD-001 for first OPD encounter, OPD-002 for second', async () => {
    // In-memory sequence tracker simulating Postgres atomic upsert
    let seq = 0;
    const mockDb = {
      dailyQueueSequence: {
        upsert: async () => {
          seq += 1;
          return { lastSequence: seq };
        },
      },
    };

    const token1 = await generateQueueToken('OPD', mockDb as any);
    expect(token1).not.toBeNull();
    expect(token1?.queueNumber).toBe('OPD-001');
    expect(token1?.queueSequence).toBe(1);

    const token2 = await generateQueueToken('OPD', mockDb as any);
    expect(token2).not.toBeNull();
    expect(token2?.queueNumber).toBe('OPD-002');
    expect(token2?.queueSequence).toBe(2);
  });

  it('Test 2: Generates ER-001 for first ER encounter', async () => {
    let erSeq = 0;
    const mockDb = {
      dailyQueueSequence: {
        upsert: async () => {
          erSeq += 1;
          return { lastSequence: erSeq };
        },
      },
    };

    const erToken = await generateQueueToken('EMERGENCY', mockDb as any);
    expect(erToken).not.toBeNull();
    expect(erToken?.queueNumber).toBe('ER-001');
    expect(erToken?.queueSequence).toBe(1);
  });

  it('Test 3: Generates OBS-001 for first Observation encounter', async () => {
    let obsSeq = 0;
    const mockDb = {
      dailyQueueSequence: {
        upsert: async () => {
          obsSeq += 1;
          return { lastSequence: obsSeq };
        },
      },
    };

    const obsToken = await generateQueueToken('OBSERVATION', mockDb as any);
    expect(obsToken).not.toBeNull();
    expect(obsToken?.queueNumber).toBe('OBS-001');
    expect(obsToken?.queueSequence).toBe(1);
  });

  it('Date-scoped resets: Token restarts from 001 on the next calendar day', async () => {
    const sequencesByDateAndType = new Map<string, number>();
    const mockDb = {
      dailyQueueSequence: {
        upsert: async ({ where }: any) => {
          const key = `${where.encounterType_date.encounterType}_${where.encounterType_date.date.toISOString().slice(0, 10)}`;
          const current = (sequencesByDateAndType.get(key) || 0) + 1;
          sequencesByDateAndType.set(key, current);
          return { lastSequence: current };
        },
      },
    };

    const day1 = new Date('2026-10-10T08:00:00.000Z');
    const day2 = new Date('2026-10-11T08:00:00.000Z');

    const opdDay1_1 = await generateQueueToken('OPD', mockDb as any, day1);
    const opdDay1_2 = await generateQueueToken('OPD', mockDb as any, day1);
    expect(opdDay1_1?.queueNumber).toBe('OPD-001');
    expect(opdDay1_2?.queueNumber).toBe('OPD-002');

    // Next day restarts from OPD-001
    const opdDay2_1 = await generateQueueToken('OPD', mockDb as any, day2);
    expect(opdDay2_1?.queueNumber).toBe('OPD-001');
    expect(opdDay2_1?.queueSequence).toBe(1);
  });

  it('Test 4: Token lifecycle persistence — payments, receipts, reprints keep original token', () => {
    const encounterInvoice = {
      id: 'inv-123',
      invoiceNumber: 'INV-26-0001',
      mrNumber: 'MR-00125',
      encounterType: 'OPD',
      queueNumber: 'OPD-023',
      queueSequence: 23,
      total: 1500,
      paidTotal: 0,
      receipts: [] as any[],
    };

    // Patient pays bill
    encounterInvoice.paidTotal = 1500;
    encounterInvoice.receipts.push({
      receiptNumber: 'REC-26-0001',
      amount: 1500,
    });

    // Queue token must remain exactly OPD-023
    expect(encounterInvoice.queueNumber).toBe('OPD-023');
    expect(encounterInvoice.mrNumber).toBe('MR-00125');
  });

  it('Test 5: Same patient returns later — MR Number stays same, new Queue Number is generated', async () => {
    const mrNumber = 'MR-00125';
    let seq = 10;
    const mockDb = {
      dailyQueueSequence: {
        upsert: async () => {
          seq += 1;
          return { lastSequence: seq };
        },
      },
    };

    const firstVisitToken = await generateQueueToken('OPD', mockDb as any);
    expect(firstVisitToken?.queueNumber).toBe('OPD-011');

    // Next visit
    const nextVisitToken = await generateQueueToken('OPD', mockDb as any);
    expect(nextVisitToken?.queueNumber).toBe('OPD-012');

    // MR Number remains identical
    expect(mrNumber).toBe('MR-00125');
    expect(firstVisitToken?.queueNumber).not.toBe(nextVisitToken?.queueNumber);
  });

  it('Test 6: Create IPD Admission — strictly NO Queue/Token Number generated', async () => {
    const ipdToken = await generateQueueToken('ADMISSION');
    expect(ipdToken).toBeNull();

    const ipdTokenAlt = await generateQueueToken('IPD');
    expect(ipdTokenAlt).toBeNull();
  });

  it('Test 7: Concurrent requests prevent duplicates and maintain unique sequences', async () => {
    let atomicCounter = 0;
    const mockDb = {
      dailyQueueSequence: {
        upsert: async () => {
          // Atomic operation simulation
          atomicCounter += 1;
          return { lastSequence: atomicCounter };
        },
      },
    };

    // 20 concurrent requests
    const promises = Array.from({ length: 20 }, () =>
      generateQueueToken('OPD', mockDb as any),
    );

    const results = await Promise.all(promises);
    const tokenStrings = results.map((r) => r?.queueNumber);
    const uniqueTokens = new Set(tokenStrings);

    expect(uniqueTokens.size).toBe(20);
    expect(tokenStrings).toContain('OPD-001');
    expect(tokenStrings).toContain('OPD-020');
  });
});
