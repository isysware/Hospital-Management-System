import { Prisma, PaymentMethod } from '@prisma/client';
import { prisma } from '@/db/client';
import { NotFoundError, BusinessRuleError } from '@/shared/errors/AppError';
import { generateExpenseNumber } from '@/shared/idGenerator';
import { resolveDateRange } from '@/modules/reports/dashboard.service';
import type { ExpenseBody, VoidExpenseBody, ListExpensesQuery } from './expenses.schemas';

/**
 * Expense Management (reporting.md §8.8) — Super Admin / Admin record hospital
 * operating expenses. Entries are never deleted: a wrong one is VOIDed with a
 * reason, keeping the audit trail. Independent of cashier drawer ledgers.
 */

const userSelect = { select: { id: true, displayName: true, username: true } } as const;
const expenseInclude = {
  department: { select: { id: true, name: true } },
  createdByUser: userSelect,
  updatedByUser: userSelect,
  voidedByUser: userSelect,
} as const;

/** `YYYY-MM-DD` → a Date at UTC midnight, matching the `@db.Date` column. */
const toDateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function toData(body: ExpenseBody) {
  return {
    expenseDate: toDateOnly(body.expenseDate),
    category: body.category,
    amount: new Prisma.Decimal(body.amount),
    paymentMethod: body.paymentMethod,
    paidTo: body.paidTo,
    reference: body.reference ?? null,
    description: body.description ?? null,
    departmentId: body.departmentId ?? null,
  };
}

export const expensesService = {
  async list(query: ListExpensesQuery) {
    const range =
      query.preset === 'all'
        ? null
        : resolveDateRange({
            preset: query.preset,
            fromDate: query.fromDate,
            toDate: query.toDate,
          });

    const where: Prisma.ExpenseWhereInput = {
      // expenseDate is a date-only column: compare on calendar days.
      ...(range
        ? {
            expenseDate: {
              gte: toDateOnly(range.start.toLocaleDateString('en-CA')),
              lte: toDateOnly(range.end.toLocaleDateString('en-CA')),
            },
          }
        : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      ...(query.createdById ? { createdById: query.createdById } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.status === 'ALL' ? {} : { status: query.status }),
    };

    const rows = await prisma.expense.findMany({
      where,
      include: expenseInclude,
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
    });

    return {
      period: range
        ? { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() }
        : { label: 'All Time', start: null, end: null },
      rows,
    };
  },

  async get(id: string) {
    const expense = await prisma.expense.findUnique({ where: { id }, include: expenseInclude });
    if (!expense) throw new NotFoundError('Expense not found');
    return expense;
  },

  async create(body: ExpenseBody, actorId: string) {
    return prisma.$transaction(async (tx) =>
      tx.expense.create({
        data: {
          ...toData(body),
          expenseNumber: await generateExpenseNumber(tx),
          createdById: actorId,
        },
        include: expenseInclude,
      }),
    );
  },

  async update(id: string, body: ExpenseBody, actorId: string) {
    const existing = await prisma.expense.findUnique({ where: { id }, select: { status: true } });
    if (!existing) throw new NotFoundError('Expense not found');
    if (existing.status === 'VOID')
      throw new BusinessRuleError('A voided expense cannot be edited.');
    return prisma.expense.update({
      where: { id },
      data: { ...toData(body), updatedById: actorId },
      include: expenseInclude,
    });
  },

  async void(id: string, body: VoidExpenseBody, actorId: string) {
    const existing = await prisma.expense.findUnique({ where: { id }, select: { status: true } });
    if (!existing) throw new NotFoundError('Expense not found');
    if (existing.status === 'VOID') throw new BusinessRuleError('This expense is already voided.');
    return prisma.expense.update({
      where: { id },
      data: {
        status: 'VOID',
        voidReason: body.reason,
        voidedAt: new Date(),
        voidedById: actorId,
        updatedById: actorId,
      },
      include: expenseInclude,
    });
  },

  /** Total of ACTIVE expenses dated within [start, end] — used by the Management Summary. */
  async totalBetween(start: Date, end: Date, departmentId?: string, paymentMethod?: PaymentMethod) {
    const agg = await prisma.expense.aggregate({
      where: {
        status: 'ACTIVE',
        pharmacySettlementRelease: { is: null },
        expenseDate: {
          gte: toDateOnly(start.toLocaleDateString('en-CA')),
          lte: toDateOnly(end.toLocaleDateString('en-CA')),
        },
        ...(departmentId ? { departmentId } : {}),
        ...(paymentMethod ? { paymentMethod } : {}),
      },
      _sum: { amount: true },
    });
    return agg?._sum?.amount ?? new Prisma.Decimal(0);
  },
};
