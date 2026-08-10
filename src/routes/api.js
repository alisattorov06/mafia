import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config, PHASES } from '../config.js';
import { errorCodes, GameError } from '../utils/errors.js';
import { sanitizeName } from '../utils/sanitize.js';
import { logger } from '../utils/logger.js';

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});

export function apiRouter(manager) {
  const router = Router();
  router.use(apiLimiter);
  router.use((req, _res, next) => {
    if (req.body && typeof req.body === 'object') {
      const t = req.body;
      const allowed = ['name', 'mode', 'settings', 'password', 'code', 'token', 'roomCode'];
      for (const k of Object.keys(t)) {
        if (!allowed.includes(k)) delete t[k];
      }
    }
    next();
  });

  router.post('/create', (req, res, next) => {
    try {
      const { name, mode = 'CLASSIC', settings, password } = req.body || {};
      const { room, session } = manager.createRoom({
        name: sanitizeName(name, 20),
        mode,
        settings,
        password: typeof password === 'string' && password ? password : null,
        token: typeof req.body?.token === 'string' ? req.body.token : null
      });
      manager.broadcastRoom(room);
      res.json({
        ok: true,
        roomCode: room.code,
        token: session.token,
        playerId: session.playerId
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/join', (req, res, next) => {
    try {
      const { code, name, password } = req.body || {};
      const { room, session, alreadyJoined } = manager.joinRoom(code, {
        name: sanitizeName(name, 20),
        password: typeof password === 'string' ? password : '',
        token: typeof req.body?.token === 'string' ? req.body.token : null
      });
      manager.broadcastRoom(room);
      res.json({
        ok: true,
        roomCode: room.code,
        token: session.token,
        playerId: session.playerId,
        alreadyJoined
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/leave', (req, res, next) => {
    try {
      const { token } = req.body || {};
      const session = manager.getSession(token);
      if (!session) {
        return res.json({ ok: true });
      }
      manager.removePlayer(session.playerId, { kicked: false });
      manager.destroySession(token);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/session', (req, res, next) => {
    try {
      const token = req.query.token;
      const session = manager.getSession(token);
      if (!session) {
        return res.status(404).json({ ok: false, code: errorCodes.SESSION_EXPIRED });
      }
      const room = manager.rooms.get(session.roomCode);
      if (!room || !room.players.has(session.playerId)) {
        return res.status(404).json({ ok: false, code: errorCodes.SESSION_EXPIRED });
      }
      res.json({
        ok: true,
        roomCode: room.code,
        phase: room.phase,
        playerId: session.playerId,
        name: room.players.get(session.playerId)?.name
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function notFoundHandler(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Not found.' });
  }
  res.status(404).send('Not found');
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof GameError) {
    return res.status(err.status || 400).json({ ok: false, code: err.code, message: err.message });
  }
  logger.error('http error', { path: req.path, message: err.message });
  res.status(500).json({ ok: false, code: 'INTERNAL', message: 'Something went wrong. Please try again.' });
}
