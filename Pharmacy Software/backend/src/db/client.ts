import { PrismaClient } from '@prisma/client';
import { env } from '@/config/env';
import { logger } from '@/shared/logger';

function createPrismaClient() {
  return new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
  });
}

type AppPrismaClient = ReturnType<typeof createPrismaClient>;

/**
 * Prisma client singleton. In dev, reuse the client across `tsx watch`
 * reloads via `globalThis` to avoid exhausting the connection pool.
 */
declare global {
  // eslint-disable-next-line no-var
  var __pharmacyPrisma: AppPrismaClient | undefined;
}

export const prisma: AppPrismaClient = globalThis.__pharmacyPrisma ?? createPrismaClient();
globalThis.__pharmacyPrisma = prisma;

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
