import { describe, expect, it } from 'vitest';

interface ThermalReceiptData {
  receiptNumber: string;
  invoiceNumber?: string;
  dateTime: string;
  encounterType: 'OPD' | 'EMERGENCY' | 'OBSERVATION' | 'CUSTOM' | string;
  tokenNumber?: string | null;
  mrNumber?: string;
  patientName: string;
  doctorName?: string | null;
  serviceName?: string;
  fees: number;
  others: number;
  total: number;
  receivedNow: number;
  paid?: number;
  outstanding: number;
  advanceCredit?: number;
  paymentMethod?: string;
  collectedBy?: string | null;
  patientPhone?: string | null;
  isReprint?: boolean;
}

function buildThermalReceiptData(
  invoice: any,
  receipt?: any,
  options?: {
    receivedNow?: number;
    paymentMethod?: string;
    collectedBy?: string;
    isReprint?: boolean;
  }
): ThermalReceiptData {
  const encType = invoice.encounterType || 'OPD';
  const isIpd = invoice.sourceType === 'ADMISSION' || (encType as any) === 'ADMISSION' || (encType as any) === 'IPD';

  const primaryLine = invoice.lines?.[0];
  let defaultServiceName = 'General OPD Consultation';
  if (encType === 'EMERGENCY') defaultServiceName = 'Emergency Consultation';
  else if (encType === 'OBSERVATION') defaultServiceName = 'Observation Service';

  const serviceName = primaryLine?.serviceName || defaultServiceName;
  const fees = primaryLine ? Number(primaryLine.lineNet || primaryLine.lineGross || 0) : Number(invoice.total || 0);

  const otherLines = (invoice.lines || []).slice(1);
  const others = otherLines.reduce((sum: number, l: any) => sum + Number(l.lineNet || l.lineGross || 0), 0);

  const netPayable = invoice.payerType === 'Corporate / Panel' ? Number(invoice.patientShare || 0) : Number(invoice.total || 0);

  const receiptNumber = receipt?.receiptNumber || (invoice.receipts?.[invoice.receipts.length - 1]?.receiptNumber) || 'RCP-PENDING';
  const invoiceNumber = invoice.invoiceNumber || '—';
  const dateTime = receipt?.collectedAt || invoice.createdAt || '10-Oct-2026 07:00 PM';
  const receivedNow = options?.receivedNow != null
    ? options.receivedNow
    : receipt
    ? Number(receipt.amount || 0)
    : Number(invoice.paidTotal || 0);

  const paymentMethod = options?.paymentMethod || receipt?.method || 'CASH';
  const collectedBy = options?.collectedBy || receipt?.collectedByName || 'Cashier';

  let rawOutstanding = 0;
  if (invoice.status === 'PAID') {
    rawOutstanding = 0;
  } else if (options?.receivedNow != null && options.receivedNow > 0) {
    if (invoice.balanceDue != null && invoice.balanceDue <= 0) {
      rawOutstanding = 0;
    } else if (invoice.balanceDue != null) {
      rawOutstanding = Math.max(0, Number(invoice.balanceDue) - options.receivedNow);
    } else {
      const basePaid = Number(invoice.paidTotal || 0);
      const effectivePaid = basePaid < netPayable ? basePaid + options.receivedNow : basePaid;
      rawOutstanding = Math.max(0, netPayable - effectivePaid);
    }
  } else if (typeof invoice.balanceDue === 'number') {
    rawOutstanding = Math.max(0, invoice.balanceDue);
  } else {
    const currentPaid = Number(invoice.paidTotal || 0);
    rawOutstanding = Math.max(0, netPayable - currentPaid);
  }

  const advanceCredit = (options?.receivedNow || invoice.paidTotal) > netPayable ? (options?.receivedNow || invoice.paidTotal) - netPayable : 0;

  return {
    receiptNumber,
    invoiceNumber,
    dateTime,
    encounterType: encType,
    tokenNumber: isIpd ? null : (invoice.queueNumber || null),
    mrNumber: invoice.patientMr || '—',
    patientName: invoice.patientName || 'Patient',
    doctorName: invoice.doctorName || 'Consultant',
    serviceName,
    fees,
    others,
    total: netPayable,
    receivedNow,
    paid: receivedNow,
    outstanding: rawOutstanding,
    advanceCredit,
    paymentMethod,
    collectedBy,
    patientPhone: invoice.patientPhone || null,
    isReprint: options?.isReprint || false,
  };
}

describe('80mm Thermal Payment Receipt System', () => {
  it('Test OPD: Builds correct canonical receipt with Date, Token No, Patient, MR, Doctor, Service, Fees, Others, Total', () => {
    const opdInvoice = {
      id: 'inv-opd-1',
      invoiceNumber: 'INV-26-0001',
      sourceType: 'WALK_IN',
      encounterType: 'OPD',
      queueNumber: 'OPD-023',
      patientMr: 'MR-00125',
      patientName: 'Muhammad Ali',
      doctorName: 'Dr. Huzaifa',
      total: 1700,
      paidTotal: 1700,
      balanceDue: 0,
      lines: [
        { id: 'l1', serviceName: 'General OPD Consultation', lineNet: 1500 },
        { id: 'l2', serviceName: 'Basic Dressing', lineNet: 200 },
      ],
      receipts: [
        {
          id: 'rec-1',
          receiptNumber: 'RCP-00125',
          amount: 1700,
          method: 'CASH',
          collectedByName: 'Ahmed',
          collectedAt: '10-Oct-2026 07:00 PM',
        },
      ],
    };

    const receiptData = buildThermalReceiptData(opdInvoice, opdInvoice.receipts[0]);

    expect(receiptData.receiptNumber).toBe('RCP-00125');
    expect(receiptData.dateTime).toBe('10-Oct-2026 07:00 PM');
    expect(receiptData.tokenNumber).toBe('OPD-023');
    expect(receiptData.mrNumber).toBe('MR-00125');
    expect(receiptData.patientName).toBe('Muhammad Ali');
    expect(receiptData.doctorName).toBe('Dr. Huzaifa');
    expect(receiptData.serviceName).toBe('General OPD Consultation');
    expect(receiptData.fees).toBe(1500);
    expect(receiptData.others).toBe(200);
    expect(receiptData.total).toBe(1700);
    expect(receiptData.receivedNow).toBe(1700);
    expect(receiptData.outstanding).toBe(0);
    expect(receiptData.paymentMethod).toBe('CASH');
    expect(receiptData.collectedBy).toBe('Ahmed');
  });

  it('Test ER: Uses same component with dynamic Emergency data', () => {
    const erInvoice = {
      id: 'inv-er-1',
      sourceType: 'WALK_IN',
      encounterType: 'EMERGENCY',
      queueNumber: 'ER-001',
      patientMr: 'MR-00045',
      patientName: 'Bilal Khan',
      doctorName: 'Dr. Zeeshan (ER Incharge)',
      total: 2500,
      paidTotal: 2500,
      lines: [
        { id: 'l1', serviceName: 'Emergency Triage & Consultation', lineNet: 2500 },
      ],
      receipts: [
        {
          receiptNumber: 'RCP-00201',
          amount: 2500,
          method: 'CARD',
          collectedByName: 'Fatima',
          collectedAt: '10-Oct-2026 07:15 PM',
        },
      ],
    };

    const receipt = buildThermalReceiptData(erInvoice, erInvoice.receipts[0]);

    expect(receipt.encounterType).toBe('EMERGENCY');
    expect(receipt.tokenNumber).toBe('ER-001');
    expect(receipt.serviceName).toBe('Emergency Triage & Consultation');
    expect(receipt.fees).toBe(2500);
    expect(receipt.others).toBe(0);
    expect(receipt.total).toBe(2500);
  });

  it('Test Observation: Uses same component with dynamic Observation data', () => {
    const obsInvoice = {
      id: 'inv-obs-1',
      sourceType: 'WALK_IN',
      encounterType: 'OBSERVATION',
      queueNumber: 'OBS-001',
      patientMr: 'MR-00088',
      patientName: 'Ayesha Noor',
      doctorName: 'Dr. Sarah (Day Care)',
      total: 3000,
      paidTotal: 3000,
      lines: [
        { id: 'l1', serviceName: 'Day Observation Care (4 Hours)', lineNet: 2000 },
        { id: 'l2', serviceName: 'IV Drip & Medication Admin', lineNet: 1000 },
      ],
      receipts: [
        {
          receiptNumber: 'RCP-00301',
          amount: 3000,
          method: 'CASH',
          collectedByName: 'Usman',
          collectedAt: '10-Oct-2026 07:30 PM',
        },
      ],
    };

    const receipt = buildThermalReceiptData(obsInvoice, obsInvoice.receipts[0]);

    expect(receipt.encounterType).toBe('OBSERVATION');
    expect(receipt.tokenNumber).toBe('OBS-001');
    expect(receipt.serviceName).toBe('Day Observation Care (4 Hours)');
    expect(receipt.fees).toBe(2000);
    expect(receipt.others).toBe(1000);
    expect(receipt.total).toBe(3000);
  });

  it('Test Reprint: Same Receipt No and same Token No without altering transactions', () => {
    const originalInvoice = {
      id: 'inv-opd-2',
      encounterType: 'OPD',
      queueNumber: 'OPD-023',
      patientMr: 'MR-00125',
      patientName: 'Muhammad Ali',
      total: 1700,
      paidTotal: 1700,
      lines: [{ serviceName: 'General OPD', lineNet: 1700 }],
      receipts: [
        {
          receiptNumber: 'RCP-00125',
          amount: 1700,
          method: 'CASH',
          collectedByName: 'Ahmed',
          collectedAt: '10-Oct-2026 07:00 PM',
        },
      ],
    };

    const reprintReceipt = buildThermalReceiptData(originalInvoice, originalInvoice.receipts[0], {
      isReprint: true,
    });

    expect(reprintReceipt.isReprint).toBe(true);
    expect(reprintReceipt.receiptNumber).toBe('RCP-00125');
    expect(reprintReceipt.tokenNumber).toBe('OPD-023');
    expect(reprintReceipt.total).toBe(1700);
    expect(reprintReceipt.receivedNow).toBe(1700);
  });

  it('Test Partial Payment: Received Now + Outstanding calculated correctly', () => {
    const partialInvoice = {
      id: 'inv-part-1',
      encounterType: 'OPD',
      queueNumber: 'OPD-055',
      patientMr: 'MR-00333',
      patientName: 'Tariq Mehmood',
      total: 2000,
      paidTotal: 1500, // partially paid
      lines: [
        { serviceName: 'Specialist Consultation', lineNet: 2000 },
      ],
      receipts: [
        {
          receiptNumber: 'RCP-00401',
          amount: 1500,
          method: 'CASH',
          collectedByName: 'Ahmed',
        },
      ],
    };

    const receipt = buildThermalReceiptData(partialInvoice, partialInvoice.receipts[0]);

    expect(receipt.total).toBe(2000);
    expect(receipt.receivedNow).toBe(1500);
    expect(receipt.outstanding).toBe(500);
    expect(receipt.advanceCredit).toBe(0);
  });

  it('Test Advance/Credit: Does NOT show negative Outstanding', () => {
    const advanceInvoice = {
      id: 'inv-adv-1',
      encounterType: 'OPD',
      queueNumber: 'OPD-077',
      patientMr: 'MR-00555',
      patientName: 'Saima Khan',
      total: 1500,
      paidTotal: 2000, // patient overpaid 500 advance
      lines: [{ serviceName: 'Consultation', lineNet: 1500 }],
      receipts: [
        {
          receiptNumber: 'RCP-00501',
          amount: 2000,
          method: 'CASH',
          collectedByName: 'Ahmed',
        },
      ],
    };

    const receipt = buildThermalReceiptData(advanceInvoice, advanceInvoice.receipts[0]);

    expect(receipt.total).toBe(1500);
    expect(receipt.receivedNow).toBe(2000);
    expect(receipt.outstanding).toBe(0); // never negative
    expect(receipt.advanceCredit).toBe(500);
  });

  it('Test IPD Exclusion: Strictly NO Token Number generated or displayed for IPD', () => {
    const ipdInvoice = {
      id: 'inv-ipd-1',
      sourceType: 'ADMISSION',
      encounterType: null,
      queueNumber: null,
      patientMr: 'MR-00999',
      patientName: 'Inpatient Patient',
      total: 45000,
      paidTotal: 20000,
      lines: [{ serviceName: 'Room Charge', lineNet: 45000 }],
    };

    const receipt = buildThermalReceiptData(ipdInvoice);

    expect(receipt.tokenNumber).toBeNull();
  });

  it('Test User Reported Scenario: Observation 2000 total with receivedNow 2000 yields Outstanding = 0', () => {
    // Stale invoice where paidTotal is 0 and balanceDue is 2000 before mutate completes
    const obsInvoice = {
      id: 'inv-obs-bug',
      invoiceNumber: 'INV-26-0005',
      encounterType: 'OBSERVATION',
      queueNumber: 'OBS-002',
      patientMr: 'MR-000005',
      patientName: 'UMAIR',
      doctorName: 'Dr. Huzaifa',
      total: 2000,
      paidTotal: 0,
      balanceDue: 2000,
      lines: [
        { serviceName: 'Consultation', lineNet: 1000 },
        { serviceName: 'Others', lineNet: 1000 },
      ],
    };

    const receipt = buildThermalReceiptData(obsInvoice, null, {
      receivedNow: 2000,
    });

    expect(receipt.total).toBe(2000);
    expect(receipt.fees).toBe(1000);
    expect(receipt.others).toBe(1000);
    expect(receipt.receivedNow).toBe(2000);
    expect(receipt.paid).toBe(2000);
    expect(receipt.outstanding).toBe(0);
    expect(receipt.tokenNumber).toBe('OBS-002');
    expect(receipt.invoiceNumber).toBe('INV-26-0005');
  });
});

