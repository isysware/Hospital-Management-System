import 'dotenv/config';
import { prisma } from '../src/db/client';
import { commissionService } from '../src/modules/commission/commission.service';
import { commissionBalance } from '../src/modules/commission/commission.calc';

/** Deployment audit: default is rollback-only. --apply --actor=<portal-user-id>
 * appends collection entries and linked corrections; never rewrites statements,
 * approvals, payouts, salaries, invoice lines or receipts. */
async function main() {
  const apply = process.argv.includes('--apply');
  const actorId = process.argv.find(value => value.startsWith('--actor='))?.slice('--actor='.length);
  if (apply && !actorId) throw new Error('--apply requires an explicit --actor=<portal-user-id> for the audit trail.');
  const actor = actorId ? await prisma.portalUser.findUniqueOrThrow({ where: { id: actorId } })
    : await prisma.portalUser.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } });
  if (actor.role !== 'SUPER_ADMIN') throw new Error('Reconciliation requires a Super Admin actor.');
  const invoices = await prisma.hospitalInvoice.findMany({ where: {
    lines: { some: { performedByStaffId: { not: null }, serviceRateId: { not: null },
      OR: [{ isCompleted: true }, { commissionAccruals: { some: {} } }] } },
  }, select: { id: true, invoiceNumber: true }, orderBy: { id: 'asc' } });
  const rollback = new Error('ROLLBACK_PREVIEW');
  for (const invoice of invoices) {
    try {
      await prisma.$transaction(async tx => {
        const where = { invoiceLineItem: { hospitalInvoiceId: invoice.id } };
        const before = await tx.doctorCommissionAccrual.count({ where });
        await commissionService.syncInvoiceCollections(tx, invoice.id, actor.id);
        const rows = await tx.doctorCommissionAccrual.findMany({ where, include: { reversals: true, payouts: true, adjustments: true } });
        console.log(JSON.stringify({ invoice: invoice.invoiceNumber, mode: apply ? 'APPLY' : 'ROLLBACK_PREVIEW',
          appendedEarnings: rows.length - before,
          statements: rows.map(row => ({ id: row.id, ...commissionBalance(row) })),
        }));
        if (!apply) throw rollback;
      }, { timeout: 60000 });
    } catch (error) { if (error !== rollback) throw error; }
  }
  console.log(JSON.stringify({ invoicesReviewed: invoices.length, applied: apply }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
