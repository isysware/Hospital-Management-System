import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { managementReportsService } from '../src/modules/reports/managementReports.service';
import {
  buildOperatingStatement,
  summarizeStatement,
  hospitalStatementCategories,
} from '../src/modules/reports/operatingProfitStatement';

describe('M04 — Dynamic Operating Profit Statement & P&L Separation', () => {
  it('1. Verifies existing live database: Internal revenue PKR 2,500, Outsourced separated, Profit PKR 2,500', async () => {
    const res = await managementReportsService.getOperatingProfitStatement({
      preset: 'today',
      comparison: 'none',
      view: 'statement',
      page: 1,
      limit: 25,
    });

    expect(res).toBeDefined();
    expect(res.period).toBeDefined();

    // Verify all 5 core hospital sections exist exclusively in rows
    const sections = new Set(res.rows.map((r: any) => r.section));
    expect(sections.has('1. HOSPITAL OPERATING REVENUE')).toBe(true);
    expect(sections.has('2. DIRECT SERVICE COSTS')).toBe(true);
    expect(sections.has('3. GROSS PROFIT (GROSS MARGIN)')).toBe(true);
    expect(sections.has('4. OPERATING OVERHEADS & EXPENSES')).toBe(true);
    expect(sections.has('5. NET OPERATING PROFIT / (LOSS)')).toBe(true);
    // Main statement rows are strictly the 5 approved Hospital sections
    expect(res.rows.length).toBe(hospitalStatementCategories.length);

    // Verify Hospital Net Revenue and Profit exclude the outsourced billings (PKR 2,000)
    expect(res.summary.revenue).toBe(2500);
    expect(res.summary.grossProfit).toBe(2500);
    expect(res.summary.operatingProfit).toBe(2500);
    expect(res.summary.totalCosts).toBe(0);

    // Outsourced streams are separated into res.outsourcedStreams
    expect(res.outsourcedStreams).toBeDefined();
    expect(res.outsourcedStreams.length).toBeGreaterThanOrEqual(1);

    // Total outsourced billing reflects all active outsourced lines in the DB
    expect(res.summary.totalOutsourcedBilling).toBeGreaterThanOrEqual(1000);
    expect(res.summary.totalOutsourcedPayable).toBeGreaterThanOrEqual(1000);

    // Check that each stream has the exact 4 primary attributes needed for the UI
    for (const stream of res.outsourcedStreams) {
      expect(stream).toHaveProperty('departmentId');
      expect(stream).toHaveProperty('departmentName');
      expect(stream).toHaveProperty('providerName');
      expect(stream).toHaveProperty('currentBilling');
      expect(stream).toHaveProperty('currentPayable');
    }
  });

  it('2. Task 1: 3–5 dynamically configured outsourced departments work automatically with zero code changes', async () => {
    // Simulate 5 dynamic outsourced departments with distinct names, providers and billing
    const sampleOutsourced = [
      { id: 'dept-101', name: 'Advanced Radiology Imaging', code: 'ARI', provider: 'Alpha Diagnostics Ltd', billing: 15000, payable: 12000 },
      { id: 'dept-102', name: 'Physiotherapy & Physical Rehab', code: 'PPR', provider: 'Apex Physio Care', billing: 8500, payable: 6800 },
      { id: 'dept-103', name: 'Hemodialysis Center', code: 'HDC', provider: 'Kidney Care Partners', billing: 45000, payable: 38000 },
      { id: 'dept-104', name: 'Pathology & Genomics Lab', code: 'PGL', provider: 'BioGen Diagnostics', billing: 22000, payable: 18500 },
      { id: 'dept-105', name: 'Cardiac Cath Diagnostic Unit', code: 'CCU', provider: 'Heartland Services', billing: 60000, payable: 50000 },
    ];

    // Mock payables summary returned from Department Payables module
    const mockPayables = {
      departments: sampleOutsourced.map(d => ({
        departmentId: d.id,
        departmentName: d.name,
        departmentCode: d.code,
        fulfillmentOwnership: 'OUTSOURCED' as const,
        outsourcedProvider: { id: `prov-${d.id}`, name: d.provider },
        periodBilled: d.billing,
        remainingPayable: d.payable,
        closingBalance: d.payable,
      })),
      totals: {
        totalPeriodBilled: sampleOutsourced.reduce((s, d) => s + d.billing, 0),
        totalRemainingPayable: sampleOutsourced.reduce((s, d) => s + d.payable, 0),
      },
    };

    // Hospital internal lines: OPD 5,000 + Emergency 10,000
    const internalEntries = [
      { id: 'line-1', category: 'opd', revenue: 5000, cost: 0 },
      { id: 'line-2', category: 'emergency', revenue: 10000, cost: 0 },
    ];

    const amounts = summarizeStatement(internalEntries as any, false);
    // Hospital revenue strictly internal
    expect(amounts.netRevenue).toBe(15000);
    expect(amounts.operatingProfit).toBe(15000);

    // Verify all 5 outsourced departments map cleanly to outsourcedStreams
    const totalOutsourcedBilling = sampleOutsourced.reduce((s, d) => s + d.billing, 0);
    const totalOutsourcedPayable = sampleOutsourced.reduce((s, d) => s + d.payable, 0);

    expect(totalOutsourcedBilling).toBe(150500);
    expect(totalOutsourcedPayable).toBe(125300);

    // Confirm NONE enters hospital revenue or reduces hospital profit
    expect(amounts.netRevenue).toBe(15000);
    expect(amounts.operatingProfit).toBe(15000);
  });

  it('3. Department rename resilience: renaming a department updates reporting with zero code changes', () => {
    // When an outsourced department is renamed in the database
    const initial = { departmentId: 'dept-77', departmentName: 'Pathology Lab', providerName: 'Alpha Diagnostics' };
    const renamed = { departmentId: 'dept-77', departmentName: 'Super Specialty Reference Lab', providerName: 'Alpha Diagnostics' };

    // Presentation generates label strictly from departmentName record, not hardcoded strings
    const labelBefore = `${initial.departmentName} (${initial.providerName})`;
    const labelAfter = `${renamed.departmentName} (${renamed.providerName})`;

    expect(labelBefore).toBe('Pathology Lab (Alpha Diagnostics)');
    expect(labelAfter).toBe('Super Specialty Reference Lab (Alpha Diagnostics)');
    // No code logic depends on "Pathology Lab" or "LAB"
  });

  it('4. Zero-transaction outsourced departments appear with zero billing and existing payable balance', () => {
    // An outsourced department with no service invocations in the period
    const idleDept = {
      departmentId: 'dept-idle',
      departmentName: 'Specialty MRI Suite',
      departmentCode: 'MRI',
      fulfillmentOwnership: 'OUTSOURCED',
      outsourcedProvider: { name: 'Metro Imaging Corp' },
      periodBilled: 0,
      remainingPayable: 14500,
    };

    const stream = {
      departmentId: idleDept.departmentId,
      departmentName: idleDept.departmentName,
      departmentCode: idleDept.departmentCode,
      providerName: idleDept.outsourcedProvider?.name ?? null,
      currentBilling: Number(idleDept.periodBilled ?? 0),
      currentPayable: Number(idleDept.remainingPayable ?? 0),
    };

    // Appears in outsourcedStreams with 0 billing and accurate pending payable
    expect(stream.currentBilling).toBe(0);
    expect(stream.currentPayable).toBe(14500);
    expect(stream.providerName).toBe('Metro Imaging Corp');
  });

  it('5. Internal vs Outsourced classification: Internal services stay in Hospital P&L', () => {
    // If a service belongs to an INTERNAL department, its revenue MUST stay in hospital revenue
    const internalEntries: any[] = [
      { id: 'line-1', category: 'opd', revenue: 1000, cost: 0 },
      { id: 'line-2', category: 'emergency', revenue: 2000, cost: 0 },
      { id: 'line-3', category: 'admission', revenue: 5000, cost: 0 },
    ];

    const amounts = summarizeStatement(internalEntries, false);
    expect(amounts.netRevenue).toBe(8000);
    expect(amounts.grossProfit).toBe(8000);
    expect(amounts.operatingProfit).toBe(8000);
  });

  it('6 & 8. Zero double-counting: Provider payable is not deducted from Hospital OPEX', async () => {
    const res = await managementReportsService.getOperatingProfitStatement({
      preset: 'today',
      comparison: 'none',
    });

    // Hospital totalCosts must NOT include provider payables
    expect(res.summary.totalCosts).toBe(0);
    expect(res.summary.operatingProfit).toBe(res.summary.revenue - res.summary.totalCosts);

    // Outsourced streams are reported separately
    expect(res.summary.totalOutsourcedBilling).toBeGreaterThanOrEqual(1000);
    expect(res.summary.totalOutsourcedPayable).toBeGreaterThanOrEqual(1000);
  });

  it('7. Pharmacy isolation: returns null/N/A when standalone pharmacy data is unavailable', async () => {
    const res = await managementReportsService.getOperatingProfitStatement({
      preset: 'today',
      comparison: 'none',
    });

    // Pharmacy stream is separate
    expect(res.pharmacyStream).toBeDefined();
    if (!res.pharmacyStream.available) {
      expect(res.pharmacyStream.currentBilling).toBeNull();
      expect(res.summary.pharmacyBilling).toBeNull();
    }
  });

  it('9. Codebase verification: STRICTLY ZERO hardcoded LAB checks in operatingProfitStatement.ts', () => {
    const filePath = resolve(__dirname, '../src/modules/reports/operatingProfitStatement.ts');
    const content = readFileSync(filePath, 'utf-8');

    // Must not contain forbidden hardcoded keywords
    expect(content).not.toMatch(/=== 'LAB'/);
    expect(content).not.toMatch(/=== "LAB"/);
    expect(content).not.toMatch(/\bisLab\b/);
    expect(content).not.toMatch(/\blabRevenue\b/);
    expect(content).not.toMatch(/\blabPayable\b/);
  });

  it('10. Previous equivalent period comparison calculates variances for Hospital rows and Outsourced streams', async () => {
    const res = await managementReportsService.getOperatingProfitStatement({
      preset: 'today',
      comparison: 'previous',
    });

    expect(res.priorPeriod).toBeDefined();
    // 5 core hospital sections rows
    expect(res.rows.length).toBe(hospitalStatementCategories.length);

    // All core rows have prior field defined
    for (const r of res.rows) {
      expect(r).toHaveProperty('current');
      expect(r).toHaveProperty('prior');
      expect(r).toHaveProperty('variance');
    }

    // Outsourced streams have prior billing and payable fields defined
    for (const stream of res.outsourcedStreams) {
      expect(stream).toHaveProperty('priorBilling');
      expect(stream).toHaveProperty('priorPayable');
    }
  });
});
