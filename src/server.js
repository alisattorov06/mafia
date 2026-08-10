import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { RoomManager } from './game/roomManager.js';
import { registerHandlers } from './socket/handlers.js';
import { authMiddleware } from './socket/middleware.js';
import { apiRouter, notFoundHandler, errorHandler } from './routes/api.js';
import { initDb, pingDb, dbReady } from './db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, '..', 'client');

export function createServer() {
  const app = express();

  app.set('trust proxy', config.trustProxy ? 1 : 0);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(express.json({ limit: '64kb' }));

  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin.length ? config.corsOrigin : true,
      methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 64 * 1024
  });

  const manager = new RoomManager({ io });
  registerHandlers(io, manager);

  io.use(authMiddleware(manager));

  // REST API
  app.use('/api', apiRouter(manager));

  // Static frontend (index.html, game.html, assets, …)
  app.use(express.static(clientDir, { index: 'index.html', maxAge: config.isProduction ? '1h' : 0 }));

  app.get('/healthz', (_req, res) => res.json({ ok: true, db: dbReady }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, httpServer, io, manager };
}

export async function start() {
  initDb();
  const { httpServer, io, manager } = createServer();

  if (config.databaseUrl) {
    const ok = await pingDb();
    if (!ok) logger.warn('Proceeding without database persistence.');
  }

  await new Promise((resolve) => httpServer.listen(config.port, resolve));
  logger.info(`MAFIA server listening on http://localhost:${config.port}`);

  const shutdown = async () => {
    logger.info('Shutting down…');
    clearInterval(io._mafiaTicker);
    httpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { httpServer, io, manager };
}
