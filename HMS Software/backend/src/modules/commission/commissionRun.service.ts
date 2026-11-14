import { commissionDepartmentFilter } from './commission.calc';
import { prisma } from '@/db/client';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ConflictError, NotFoundError } from '@/shared/errors/AppError';
import { commissionInclude, commissionStatement } from './commission.service';
import type { CommissionRunFilters } from './commission.schemas';

async function preview(tx: Prisma.TransactionClient, filters: CommissionRunFilters) {
  const lines = await tx.doctorCommissionAccrual.findMany({ where: {
    status: 'ACCRUED', commissionRunId: null,
    periodStart: { gte: filters.periodStart, lte: filters.periodEnd },
    ...(filters.staffId ? { staffId: filters.staffId } : {}),

    invoiceLineItem: { ...(filters.departmentId ? commissionDepartmentFilter(filters.departmentId) : {}), isCompleted: true, hospitalInvoice: { status: { not: 'VOID' } }, ...(filters.serviceRateId ? { serviceRateId: filters.serviceRateId } : {}) },
  }, include: commissionInclude, orderBy: [{ periodStart: 'asc' }, { id: 'asc' }] });
  const eligible = lines.map(commissionStatement).filter(line => line.balance.payable.gt(0));
  return { lines: eligible, totalAmount: eligible.reduce((s, r) => s.plus(r.balance.payable), new Decimal(0)), lineCount: eligible.length };
}

export const commissionRunService = {
  preview: (filters: CommissionRunFilters) => prisma.$transaction(tx => preview(tx, filters)),
  async generate(filters: CommissionRunFilters, actorId: string) {
    return prisma.$transaction(async tx => {
      const result = await preview(tx, filters);
      if (!result.lines.length) throw new ConflictError('No ungenerated eligible commission in this period.');
      const run = await tx.commissionRun.create({ data: {
        periodType: filters.periodType, periodStart: filters.periodStart, periodEnd: filters.periodEnd,
        filters: JSON.parse(JSON.stringify(filters)) as Prisma.InputJsonValue,
        totalAmount: result.totalAmount, generatedById: actorId,
      } });
      for (const line of result.lines) {
        const claimed = await tx.doctorCommissionAccrual.updateMany({ where: { id: line.id, commissionRunId: null, status: 'ACCRUED' }, data: {
          commissionRunId: run.id, status: 'GENERATED',
          generatedSnapshot: JSON.parse(JSON.stringify({ rule: line.ruleSnapshot, balance: line.balance, generatedById: actorId })) as Prisma.InputJsonValue,
        } });
        if (claimed.count !== 1) throw new ConflictError('Commission changed during generation; refresh Preview.');
      }
      const generated = await tx.commissionRun.findUniqueOrThrow({ where: { id: run.id }, include: { lines: { include: commissionInclude } } });
      return { ...generated, lines: generated.lines.map(commissionStatement) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },
  list: () => prisma.commissionRun.findMany({ orderBy: { generatedAt: 'desc' }, include: { _count: { select: { lines: true } } } }),
  async get(id: string) {
    const run = await prisma.commissionRun.findUnique({ where: { id }, include: { lines: { include: commissionInclude } } });
    if (!run) throw new NotFoundError('Commission run not found');
    return { ...run, lines: run.lines.map(commissionStatement) };
  },
  async approve(id: string, actorId: string) {
    await prisma.$transaction(async tx => {
      const approvedAt = new Date();
      const changed = await tx.commissionRun.updateMany({ where: { id, status: 'GENERATED' }, data: { status: 'APPROVED', approvedById: actorId, approvedAt } });
      if (!changed.count) throw new ConflictError('Only a generated commission run can be approved.');
      await tx.doctorCommissionAccrual.updateMany({ where: { commissionRunId: id, status: 'GENERATED' }, data: { status: 'APPROVED', approvedById: actorId, approvedAt } });
    });
    return this.get(id);
  },
};
