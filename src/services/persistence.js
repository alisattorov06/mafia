import { prisma } from '../db/index.js';
import { logger } from '../utils/logger.js';

/**
 * Asynchronous, best-effort persistence of a finished game.
 * Never blocks or breaks gameplay: if the DB is unavailable we simply skip.
 */
export async function persistGame(room) {
  if (!prisma) return;
  if (room._persisted) return;
  room._persisted = true;
  try {
    const game = await prisma.game.create({
      data: {
        roomCode: room.code,
        mode: room.mode,
        status: 'ENDED',
        winner: room.winner,
        phase: room.phase,
        rounds: room.round,
        hostId: room.hostId,
        startedAt: new Date(room.startedAt || Date.now()),
        endedAt: new Date(room.endedAt || Date.now()),
        settings: room.settings,
        players: {
          create: [...room.players.values()].map((p) => ({
            displayName: p.name,
            role: p.role,
            team: p.team,
            alive: p.alive,
            isHost: p.id === room.hostId,
            joinedAt: new Date(p.joinedAt),
            eliminatedAt: p.eliminatedAt ? new Date(p.eliminatedAt) : null,
            eliminationReason: p.eliminationReason,
            result: p.alive ? 'SURVIVED' : p.eliminationReason
          }))
        },
        events: {
          create: room.history.map((e) => ({
            type: e.type,
            actorId: e.actorId,
            targetId: e.targetId,
            round: e.round,
            phase: e.phase,
            metadata: e.metadata,
            createdAt: new Date(e.ts)
          }))
        },
        result: {
          create: {
            winner: room.winner || 'NONE',
            durationSec: room.startedAt ? Math.round((Date.now() - room.startedAt) / 1000) : 0,
            rounds: room.round,
            stats: room.stats || {}
          }
        }
      }
    });
    logger.info('game persisted', { roomCode: room.code, gameId: game.id, winner: room.winner });
  } catch (err) {
    logger.warn('failed to persist game', { roomCode: room.code, message: err.message });
  }
}
