import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export let prisma = null;
export let dbReady = false;

export function initDb() {
  if (!config.databaseUrl) {
    logger.info('DATABASE_URL not set — running with in-memory persistence.');
    return prisma;
  }
  try {
    prisma = new PrismaClient();
    dbReady = true;
    logger.info('PostgreSQL client initialised.');
  } catch (err) {
    logger.error('Failed to initialise Prisma client', { message: err.message });
    prisma = null;
    dbReady = false;
  }
  return prisma;
}

export async function pingDb() {
  if (!prisma) return false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    logger.warn('Database unreachable — falling back to in-memory persistence.', { message: err.message });
    return false;
  }
}
