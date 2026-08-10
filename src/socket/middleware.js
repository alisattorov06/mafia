import { GameError, errorCodes } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Sliding-window rate limiter for socket events. Per socket, per window.
 * Keeps the chat and action channels from being spammed.
 */
export class RateLimiter {
  constructor({ windowMs = 10000, max = 60, key = () => 'default' } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.key = key;
    this.buckets = new Map();
  }

  allow(socket) {
    const now = Date.now();
    const key = this.key(socket);
    let b = this.buckets.get(key);
    if (!b) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, b);
    }
    if (now >= b.resetAt) {
      b.count = 0;
      b.resetAt = now + this.windowMs;
    }
    b.count += 1;
    if (this.buckets.size > 10000) this.buckets.clear();
    return b.count <= this.max;
  }
}

export function safe(socket, fn) {
  return function wrapped(...args) {
    try {
      return fn.apply(this, args);
    } catch (err) {
      const { code, message } = normalizeError(err);
      const who = socket.data?.playerId || socket.id;
      if (code === 'INTERNAL') {
        logger.error(`socket error [${who}]`, { message: err?.message, stack: err?.stack });
      } else {
        logger.warn(`socket error [${who}]`, { code, message });
      }
      socket.emit('error', { code, message });
    }
  };
}

export function normalizeError(err) {
  if (err instanceof GameError) {
    return { code: err.code, message: err.message };
  }
  return { code: 'INTERNAL', message: 'Something went wrong. Please try again.' };
}

export const authMiddleware = (manager) => (socket, next) => {
  const token = socket.handshake?.auth?.token || socket.handshake?.query?.token;
  if (!token || typeof token !== 'string') {
    return next(new Error('UNAUTHORIZED'));
  }
  socket.data.token = token;
  next();
};
