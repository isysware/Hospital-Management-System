import { PrismaClient } from '@prisma/client';
import { env } from '@/config/env';
import { logger } from '@/shared/logger';

function createPrismaClient() {
  return new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
    omit: {
      staff: { clinicalAuthPasswordHash: true },
    },
  });
}

type AppPrismaClient = ReturnType<typeof createPrismaClient>;

declare global {
  // eslint-disable-next-line no-var
  var __prisma: AppPrismaClient | undefined;
}

export const prisma: AppPrismaClient = globalThis.__prisma ?? createPrismaClient();
globalThis.__prisma = prisma;

if (env.NODE_ENV === 'development') {
}

prisma.$use(async (params, next) => {
  if (params.model === 'HospitalInvoice' && params.action === 'create') {
    const data = params.args?.data as { panelPatientId?: string | null; corporatePanelId?: string | null } | undefined;
    if (data && data.panelPatientId && data.corporatePanelId === undefined) {
      const patient = await prisma.panelPatient.findUnique({
        where: { id: data.panelPatientId },
        select: { corporatePanelId: true },
      });
      if (patient) data.corporatePanelId = patient.corporatePanelId;
    }
  }
  return next(params);
});

if (env.NODE_ENV === 'development') {
  prisma.$on('query', (e: { query: string; duration: number }) => {
    logger.debug('prisma:query', { query: e.query, durationMs: e.duration });
  });
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('Database connectivity check failed', { error: (error as Error).message });
    return false;
  }
}
