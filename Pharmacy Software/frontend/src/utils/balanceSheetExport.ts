type Report = {
  period: { label: string; mode: string };
  summary: Record<string, number>;
  transactions: { receiptNumber: string | null; invoiceNumber: string | null; category: string; paymentMethod: string; direction: string; amount: number; occurredAt: string }[];
};

export async function exportBalanceSheet(kind: 'Excel' | 'CSV' | 'PDF' | 'Print', data: Report, user: string, categories: Record<string, string>) {
  const s = data.summary;
  const summary = [
    ['Petty Cash (net)', s.pettyCash], ['Cash Collections', s.cashCollections],
    ['Cash Expenses / Vendor Payments', s.cashExpenses], ['Cash Refunds', s.cashRefunds],
    ['Cash Adjustments', s.adjustments], ['Non-Cash (net)', s.nonPhysicalTotal],
    [data.period.mode === 'shift' ? 'Expected Physical Cash' : 'Period Cash Movement (before handovers)', s.expectedPhysicalCash],
    ['Remaining Unsettled Cash', s.remainingAmount],
    ...(data.period.mode === 'period' ? [['Accepted Settlements', s.settlementCount], ['Physical Cash Counted', s.physicalCashCounted], ['Variance', s.variance], ['Settled', s.settledAmount]] : []),
  ];
  const rows = [
    ['My Balance Sheet — Pharmacy'], [user], [data.period.label], [], ...summary, [],
    ['Receipt / Ref', 'Category', 'Method', 'Direction', 'Amount (PKR)', 'Date / Time (Pakistan)'],
    ...data.transactions.map(t => [t.receiptNumber || t.invoiceNumber || '', categories[t.category] || t.category,
      t.paymentMethod, t.direction, t.direction === 'IN' ? t.amount : -t.amount,
      new Date(t.occurredAt).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })]),
  ];
  if (kind === 'Excel' || kind === 'CSV') {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [{ wch: 46 }, { wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 28 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Balance Sheet');
    XLSX.writeFile(workbook, `pharmacy_balance_sheet.${kind === 'Excel' ? 'xlsx' : 'csv'}`, { bookType: kind === 'Excel' ? 'xlsx' : 'csv' });
    return;
  }
  const popup = window.open('', '_blank', 'width=1100,height=800');
  if (!popup) throw new Error('Allow pop-ups to print or save the report as PDF.');
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  popup.document.write(`<!doctype html><html><head><title>Pharmacy Balance Sheet</title><style>body{font:12px Arial;color:#172033;padding:24px}table{border-collapse:collapse;width:100%}td{border:1px solid #cbd5e1;padding:7px}tr:first-child{background:#08775a;color:white;font-weight:bold}@media print{body{padding:0}tr{break-inside:avoid}}</style></head><body><table>${rows.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</table></body></html>`);
  popup.document.close();
  popup.focus();
  popup.print();
}
