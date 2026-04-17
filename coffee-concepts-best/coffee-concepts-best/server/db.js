/**
 * server/db.js
 * Prisma Client singleton — safe to import from multiple modules.
 * In production the connection pool is managed by Prisma automatically.
 */
'use strict';

const { PrismaClient } = require('@prisma/client');

// Reuse the same instance across hot-reloads in development.
const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

module.exports = prisma;
