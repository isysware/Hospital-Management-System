import { describe, it, expect, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';

vi.mock('@/db/client', () => ({ prisma: {} }));

import { patientResponsibility, patientPaymentStatus } from '@/shared/invoicePaymentStatus';
import { admissionService } from '@/modules/admission/admission.service';

const d = (n: number | string) => new Decimal(n);
const panelInvoice = { panelPatientId: 'pp-1', total: d(2000), patientShare: d(1000), panelReceivable: d(1000) };
const selfPayInvoice = { panelPatientId: null, total: d(2000), patientShare: d(2000), panelReceivable: d(0) };

describe('patient responsibility on an invoice (panel.md §6: P + R = N)', () => {
  it('is the patient share on a correctly split panel invoice, the full total otherwise', () => {
    expect(patientResponsibility(panelInvoice)).toEqual(d(1000));
    expect(patientResponsibility(selfPayInvoice)).toEqual(d(2000));
    // Legacy panel invoice whose split does not reconcile: fall back to the full total.
    expect(patientResponsibility({ ...panelInvoice, patientShare: d(0), panelReceivable: d(0) })).toEqual(d(2000));
  });

  it('marks a panel invoice PAID once the patient share is paid, even though the company share is still open', () => {
    expect(patientPaymentStatus(panelInvoice, d(1000))).toBe('PAID');
    expect(patientPaymentStatus(panelInvoice, d(400))).toBe('PARTIALLY_PAID');
    expect(patientPaymentStatus(panelInvoice, d(0))).toBe('UNPAID');
    expect(patientPaymentStatus(selfPayInvoice, d(1000))).toBe('PARTIALLY_PAID');
  });

  it('treats a fully covered panel invoice (patient share 0) as nothing due from the patient', () => {
    expect(patientPaymentStatus({ panelPatientId: 'pp-1', total: d(1500), patientShare: d(0), panelReceivable: d(1500) }, d(0))).toBe('PAID');
  });
});

describe('discharge billing clearance for a panel admission (panel.md §5.3)', () => {
  function txFor(paid: number, invoice = panelInvoice) {
    const clearances: any[] = [{ id: 'dc-clin', clearanceType: 'CLINICAL', status: 'CLEARED' }];
    return {
      admissionRecord: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'adm-1',
          status: 'DISCHARGE_PENDING',
          bedId: null,
          hospitalInvoices: [{ id: 'inv-1', ...invoice }],
          dischargeClearances: clearances,
        }),
        update: vi.fn().mockImplementation(({ data }: any) => ({ id: 'adm-1', ...data })),
      },
      paymentReceipt: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: d(paid) } }) },
      dualDischargeClearance: {
        create: vi.fn().mockImplementation(({ data }: any) => {
          clearances.push({ id: 'dc-bill', ...data });
          return clearances[clearances.length - 1];
        }),
        update: vi.fn(),
        findMany: vi.fn().mockImplementation(async () => clearances),
      },
      bed: { update: vi.fn() },
    };
  }

  it('clears billing and discharges once the PATIENT share is paid, with the company receivable still open', async () => {
    const tx = txFor(1000);
    const result = await admissionService.reconcileAdmissionDischarge(tx, 'adm-1', 'fd-user');
    expect(result.isDischarged).toBe(true);
    expect(tx.dualDischargeClearance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clearanceType: 'HOSPITAL_BILLING', status: 'CLEARED' }) }),
    );
  });

  it('keeps the case billing-pending while part of the patient share is unpaid', async () => {
    const tx = txFor(600);
    const result = await admissionService.reconcileAdmissionDischarge(tx, 'adm-1', 'fd-user');
    expect(result.isDischarged).toBe(false);
    expect(tx.dualDischargeClearance.create).not.toHaveBeenCalled();
  });

  it('still requires the full total from a self-pay patient', async () => {
    const tx = txFor(1000, selfPayInvoice);
    const result = await admissionService.reconcileAdmissionDischarge(tx, 'adm-1', 'fd-user');
    expect(result.isDischarged).toBe(false);
  });
});
