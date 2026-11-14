import { afterEach, expect, it, vi } from 'vitest';
const captured = vi.hoisted(() => ({ pdf: vi.fn(), sheets: vi.fn(), write: vi.fn(), html: vi.fn() }));
vi.mock('../../frontend/node_modules/jspdf/dist/jspdf.node.min.js', () => ({ jsPDF: class {
  internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
  setFillColor() {} rect() {} setFont() {} setFontSize() {} setTextColor() {} text() {}
  setDrawColor() {} roundedRect() {} setLineWidth() {} line() {} save() {}
} }));
vi.mock('../../frontend/node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.mjs', () => ({ default: captured.pdf }));
vi.mock('../../frontend/node_modules/xlsx/xlsx.js', () => ({ utils: {
  json_to_sheet: (rows: unknown[]) => { captured.sheets(rows); return {}; },
  book_new: () => ({}), book_append_sheet: vi.fn(), sheet_to_csv: () => '',
}, writeFile: captured.write }));
vi.mock('../../frontend/src/services/hospitalProfileService', () => ({
  getHospitalProfile: () => ({ name: 'Test Hospital' }), getProfileFieldValue: () => '', formatHospitalAddress: () => '',
}));
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../frontend/src/services/apiClient', () => ({ default: api }));
import { fetchManagementSummary, type SummaryRecord } from '../../frontend/src/services/managementReportsService';
import { downloadTablePDF, downloadTableExcel, downloadTableCSV, printTable } from '../../frontend/src/services/tableExportService';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('passes identical backend financial values to PDF, Excel, CSV and Print adapters', async () => {
  api.get.mockResolvedValue({data:{data:{period:{label:'January'},rows:[],summary:{grossBilling:'2000',totalBilling:'2000',collections:'1500',collectedIncome:'1500',outstanding:'500',totalOperatingCosts:'0',operatingResult:'1500'}}}});
  const {rows}=await fetchManagementSummary({preset:'today'});
  const request={documentTitle:'Management Summary',filenamePrefix:'Management',currentUser:null,rows,columns:[
    {header:'Metric',cell:(r:SummaryRecord)=>r.metric},
    {header:'Value',cell:(r:SummaryRecord)=>r.value.toFixed(2),excelValue:(r:SummaryRecord)=>r.value},
  ]};
  vi.stubGlobal('document',{createElement:()=>({click:vi.fn()}),body:{appendChild:vi.fn(),removeChild:vi.fn()}});
  vi.stubGlobal('window',{open:()=>({document:{write:captured.html,close:vi.fn()},focus:vi.fn(),print:vi.fn()})});
  vi.useFakeTimers();
  downloadTablePDF(request);downloadTableExcel(request);downloadTableCSV(request);printTable(request);
  const expected=rows.map(r=>[r.metric,r.value.toFixed(2)]);
  expect(captured.pdf.mock.calls[0][1].body).toEqual(expected);
  const spreadsheetRows=rows.map(r=>({Metric:r.metric,Value:r.value}));
  expect(captured.sheets.mock.calls[0][0]).toEqual(spreadsheetRows);
  expect(captured.sheets.mock.calls[2][0]).toEqual(spreadsheetRows);
  const html=captured.html.mock.calls[0][0];
  for(const [metric,value] of expected) expect(html).toContain(`>${metric}</td><td style="text-align:left">${value}</td>`);
  expect(rows.find(r=>r.metric==='Collection-Based Operating Profit / Loss')?.value).toBe(1500);
});
