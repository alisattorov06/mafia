import { GameError, errorCodes } from '../utils/errors.js';
import { sanitizeText, sanitizeName } from '../utils/sanitize.js';
import { sanitizeSettings } from '../game/settings.js';
import { logger } from '../utils/logger.js';
import { config, PHASES } from '../config.js';
import { safe, RateLimiter } from './middleware.js';

const chatLimiter = new RateLimiter({ windowMs: 10000, max: 30, key: (s) => `chat:${s.data.token}` });
const chatInterval = new Map(); // socketId -> last ts

export function registerHandlers(io, manager) {
  const { engine, chat } = manager;

  io.on('connection', (socket) => {
    const attached = manager.attachSocket(socket);
    if (!attached) return;

    socket.on('disconnect', () => manager.detachSocket(socket));
    socket.on('disconnect_sync', () => manager.detachSocket(socket));

    // ------------------------------------------------------------ room events

    socket.on(
      'room:startGame',
      safe(socket, (data) => {
        requireHost(manager, socket);
        const room = roomOf(manager, socket);
        engine.startGame(room);
        manager.afterPhaseChange(room);
      })
    );

    socket.on(
      'room:kick',
      safe(socket, (data) => {
        requireHost(manager, socket);
        const room = roomOf(manager, socket);
        const targetId = String(data?.targetId || '');
        const target = room.players.get(targetId);
        if (!target) throw new GameError(errorCodes.INVALID_ACTION, 'Player not found.');
        if (target.id === socket.data.playerId) throw new GameError(errorCodes.INVALID_ACTION, 'You cannot kick yourself.');
        manager.removePlayer(targetId, { kicked: true });
      })
    );

    socket.on(
      'room:leave',
      safe(socket, () => {
        manager.removePlayer(socket.data.playerId, { kicked: false });
        manager.destroySession(socket.data.token);
        socket.disconnect(true);
      })
    );

    socket.on(
      'room:updateSettings',
      safe(socket, (data) => {
        requireHost(manager, socket);
        const room = roomOf(manager, socket);
        if (room.phase !== PHASES.LOBBY) {
          throw new GameError(errorCodes.GAME_ALREADY_STARTED, 'Settings can only be changed before the game starts.');
        }
        const sanitized = sanitizeSettings(data?.settings || {}, room.mode);
        if (sanitized.maxPlayers < room.players.size) {
          throw new GameError(errorCodes.INVALID_SETTINGS, 'Max players cannot be lower than the current player count.');
        }
        room.settings = sanitized;
        manager.chat.system(room, 'room', 'The host updated the room settings.');
        manager.broadcastRoom(room);
      })
    );

    // ------------------------------------------------------------ role reveal

    socket.on(
      'game:ready',
      safe(socket, () => {
        const room = roomOf(manager, socket);
        const { advance } = engine.playerReady(room, socket.data.playerId);
        if (advance) manager.maybeAdvance(room);
        else manager.broadcastGame(room);
      })
    );

    // ------------------------------------------------------------ night actions

    socket.on(
      'mafia:target',
      safe(socket, (data) => {
        const room = roomOf(manager, socket);
        const targetId = typeof data?.targetId === 'string' ? data.targetId : null;
        const { advance } = engine.mafiaAction(room, socket.data.playerId, targetId);
        manager.broadcastGame(room);
        if (advance) manager.maybeAdvance(room);
      })
    );

    socket.on(
      'mafia:lock',
      safe(socket, () => {
        const room = roomOf(manager, socket);
        const { advance } = engine.mafiaLock(room, socket.data.playerId);
        manager.broadcastGame(room);
        if (advance) manager.maybeAdvance(room);
      })
    );

    socket.on(
      'doctor:target',
      safe(socket, (data) => {
        const room = roomOf(manager, socket);
        const targetId = typeof data?.targetId === 'string' ? data.targetId : null;
        const { advance } = engine.doctorAction(room, socket.data.playerId, targetId);
        manager.broadcastGame(room);
        if (advance) manager.maybeAdvance(room);
      })
    );

    socket.on(
      'bodyguard:target',
      safe(socket, (data) => {
        const room = roomOf(manager, socket);
        const targetId = typeof data?.targetId === 'string' ? data.targetId : null;
        const { advance } = engine.bodyguardAction(room, socket.data.playerId, targetId);
        manager.broadcastGame(room);
        if (advance) manager.maybeAdvance(room);
      })
    );

    socket.on(
      'detective:target',
      safe(socket, (data) => {
        const room = roomOf(manager, socket);
        const targetId = typeof data?.targetId === 'string' ? data.targetId : null;
        const { advance } = engine.detectiveAction(room, socket.data.playerId, targetId);
        manager.broadcastGame(room);
        if (advance) manager.maybeAdvance(room);
      })
    );

    // ------------------------------------------------------------ voting

    socket.on(
      'vote:cast',
      safe(socket, (data) => {
        const room = roomOf(manager, socket);
        const targetId = typeof data?.targetId === 'string' ? data.targetId : null;
        const { advance } = engine.castVote(room, socket.data.playerId, targetId);
        manager.broadcastGame(room);
        if (advance) manager.maybeAdvance(room);
      })
    );

    // ------------------------------------------------------------ chat

    socket.on(
      'chat:send',
      safe(socket, (data) => {
        const room = roomOf(manager, socket);
        const channel = String(data?.channel || 'room');
        const player = room.players.get(socket.data.playerId);

        const now = Date.now();
        const last = chatInterval.get(socket.id) || 0;
        if (now - last < 600) {
          throw new GameError(errorCodes.RATE_LIMITED, 'You are sending messages too quickly.');
        }
        if (!chatLimiter.allow(socket)) {
          throw new GameError(errorCodes.RATE_LIMITED, 'Too many messages. Slow down.');
        }

        const msg = chat.add(room, player, channel, String(data?.text || ''));
        chatInterval.set(socket.id, now);
        manager.broadcastChat(room, msg, channel);
      })
    );

    // ------------------------------------------------------------ lifecycle

    socket.on(
      'game:rematch',
      safe(socket, () => {
        requireHost(manager, socket);
        const room = roomOf(manager, socket);
        if (room.phase !== PHASES.GAME_OVER) {
          throw new GameError(errorCodes.INVALID_PHASE, 'The game is not over yet.');
        }
        engine.resetForRematch(room);
        manager.chat.system(room, 'room', 'A rematch has begun. New roles have been dealt.');
        manager.afterPhaseChange(room);
      })
    );

    socket.on(
      'game:returnToLobby',
      safe(socket, () => {
        requireHost(manager, socket);
        const room = roomOf(manager, socket);
        if (room.phase !== PHASES.GAME_OVER) {
          throw new GameError(errorCodes.INVALID_PHASE, 'The game is not over yet.');
        }
        engine.returnToLobby(room);
        manager.afterPhaseChange(room);
      })
    );

    // ------------------------------------------------------------ debug (dev only)

    socket.on('debug:state', () => {
      if (!config.debugMode) {
        socket.emit('error', { code: 'FORBIDDEN', message: 'Debug mode is disabled.' });
        return;
      }
      const room = roomOf(manager, socket);
      const view = {
        phase: room.phase,
        settings: room.settings,
        players: [...room.players.values()].map((p) => ({
          id: p.id,
          name: p.name,
          role: p.role,
          team: p.team,
          alive: p.alive,
          offline: p.offline
        })),
        mafiaTargets: [...room.mafiaTargets.entries()],
        mafiaFinalTarget: room.mafiaFinalTarget,
        doctorTarget: room.doctorTarget,
        doctorLastTarget: room.doctorLastTarget,
        bodyguardTarget: room.bodyguardTarget,
        detectiveTarget: room.detectiveTarget,
        detectiveResult: room.detectiveResult,
        votes: [...room.votes.entries()],
        winner: room.winner,
        history: room.history.slice(-20)
      };
      socket.emit('debug:state', view);
      logger.info('debug state requested', { room: room.code, by: socket.data.playerId });
    });
  });
}

function roomOf(manager, socket) {
  const room = manager.rooms.get(socket.data.roomCode);
  if (!room) throw new GameError(errorCodes.ROOM_NOT_FOUND, 'Room not found.');
  return room;
}

function requireHost(manager, socket) {
  const room = roomOf(manager, socket);
  if (room.hostId !== socket.data.playerId) {
    throw new GameError(errorCodes.NOT_HOST, 'Only the host can do that.');
  }
}
