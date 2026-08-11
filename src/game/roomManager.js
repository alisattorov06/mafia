import { randomId, randomToken, roomCode, hash } from '../utils/ids.js';
import { sanitizeName, isSafeId } from '../utils/sanitize.js';
import { GameError, errorCodes } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { GameEngine } from './engine.js';
import { ChatManager } from './chat.js';
import { buildLobbyView, buildGameView } from './view.js';
import { persistGame } from '../services/persistence.js';
import { PHASES } from '../config.js';
import { isActivePhase } from './stateMachine.js';
import { GAME_MODES, sanitizeSettings } from './settings.js';

const GRACE_MS = 30000;

function newRoom(code, mode, settings, password) {
  return {
    id: randomId(),
    code,
    mode,
    password: password ? hash(password) : null,
    status: 'WAITING',
    phase: PHASES.LOBBY,
    previousPhase: null,
    round: 1,
    hostId: null,
    players: new Map(),
    settings,
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    winner: null,
    winningTeam: null,
    winReason: null,
    readySet: new Set(),
    mafiaTargets: new Map(),
    mafiaActed: new Set(),
    mafiaLocked: new Set(),
    mafiaFinalTarget: null,
    doctorTarget: null,
    doctorLastTarget: null,
    bodyguardTarget: null,
    detectiveTarget: null,
    detectiveResult: null,
    votes: new Map(),
    votingCandidates: null,
    computedVote: null,
    nightResult: null,
    elimination: null,
    stats: null,
    history: [],
    chat: { room: [], mafia: [], dead: [] },
    _timer: null,
    _ticker: null,
    _removals: new Map() // playerId -> timeout
  };
}

export class RoomManager {
  constructor({ io }) {
    this.io = io;
    this.engine = new GameEngine();
    this.chat = new ChatManager();
    this.rooms = new Map(); // code -> room
    this.sessions = new Map(); // token -> session
    this.playerRooms = new Map(); // playerId -> code
    this._startTicker();
  }

  // ---------------------------------------------------------------- sessions

  createSession(name) {
    const token = randomToken();
    const session = {
      token,
      playerId: randomId(),
      name,
      createdAt: Date.now()
    };
    this.sessions.set(token, session);
    return session;
  }

  getSession(token) {
    if (!token || typeof token !== 'string') return null;
    return this.sessions.get(token) || null;
  }

  destroySession(token) {
    this.sessions.delete(token);
  }

  // ---------------------------------------------------------------- rooms

  createRoom({ name, mode, settings, password, token }) {
    if (!GAME_MODES.includes(mode)) {
      throw new GameError(errorCodes.INVALID_SETTINGS, 'Unknown game mode.');
    }
    const cleanName = sanitizeName(name, 20);
    if (!cleanName) throw new GameError(errorCodes.INVALID_NAME, 'Please enter a username.');
    const safeSettings = sanitizeSettings(settings, mode);

    let code;
    do {
      code = roomCode();
    } while (this.rooms.has(code));

    const room = newRoom(code, mode, safeSettings, password || null);
    room.mafiaPanelState = this.engine.mafiaPanelState.bind(this.engine);
    this.rooms.set(code, room);

    let session = token ? this.getSession(token) : null;
    if (!session) session = this.createSession(cleanName);
    else session.name = cleanName;

    const player = this._addPlayer(room, session, true);
    room.hostId = player.id;

    logger.info('room created', { code, mode, host: player.name });
    return { room, player, session };
  }

  /**
   * Safe, public lobby metadata for the room browser.  Deliberately omit
   * player identities and any private room data from this unauthenticated view.
   */
  listPublicRooms() {
    return [...this.rooms.values()]
      .filter((room) => (
        room.phase === PHASES.LOBBY
        && !room.password
        && room.players.size < room.settings.maxPlayers
      ))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((room) => ({
        code: room.code,
        mode: room.mode,
        playerCount: room.players.size,
        maxPlayers: room.settings.maxPlayers,
        minPlayers: room.settings.minPlayers,
        createdAt: room.createdAt
      }));
  }

  joinRoom(codeRaw, { name, password, token }) {
    const code = String(codeRaw || '').toUpperCase().trim();
    const room = this.rooms.get(code);
    if (!room) throw new GameError(errorCodes.ROOM_NOT_FOUND, 'Room not found. Check the code.');

    if (room.phase !== PHASES.LOBBY) {
      throw new GameError(errorCodes.GAME_ALREADY_STARTED, 'That game has already started.');
    }
    if (room.players.size >= room.settings.maxPlayers) {
      throw new GameError(errorCodes.ROOM_FULL, 'That room is full.');
    }
    if (room.password && hash(String(password || '')) !== room.password) {
      throw new GameError(errorCodes.WRONG_PASSWORD, 'Incorrect room password.');
    }

    const cleanName = sanitizeName(name, 20);
    if (!cleanName) throw new GameError(errorCodes.INVALID_NAME, 'Please enter a username.');

    const dup = [...room.players.values()].find((p) => p.name.toLowerCase() === cleanName.toLowerCase());
    if (dup) throw new GameError(errorCodes.NAME_TAKEN, 'That username is already taken in this room.');

    let session = token ? this.getSession(token) : null;
    if (session && session.roomCode === code && room.players.has(session.playerId)) {
      // Rejoin existing session.
      return { room, player: room.players.get(session.playerId), session, alreadyJoined: true };
    }
    if (!session) session = this.createSession(cleanName);
    else session.name = cleanName;

    const player = this._addPlayer(room, session, room.players.size === 0);
    return { room, player, session, alreadyJoined: false };
  }

  _addPlayer(room, session, isHost) {
    const player = {
      id: session.playerId,
      name: session.name,
      role: null,
      team: null,
      alive: true,
      isHost,
      offline: true,
      connectedSockets: new Set(),
      joinedAt: Date.now(),
      eliminatedAt: null,
      eliminationReason: null,
      disconnectedAt: null,
      hasSeenRole: false
    };
    room.players.set(player.id, player);
    session.roomCode = room.code;
    session.playerId = player.id;
    this.playerRooms.set(player.id, room.code);
    this.chat.system(room, 'room', `${player.name} joined the game.`);
    return player;
  }

  removePlayer(playerId, { kicked = false } = {}) {
    const code = this.playerRooms.get(playerId);
    const room = code ? this.rooms.get(code) : null;
    if (!room) return null;
    const player = room.players.get(playerId);
    if (!player) return null;

    // Detach sockets.
    for (const sid of player.connectedSockets) {
      const sock = this.io.sockets.sockets.get(sid);
      if (sock) {
        sock.emit('session:terminated', { reason: kicked ? 'You were removed from the room.' : 'You left the room.' });
        sock.leave(room.code);
        sock.disconnect(true);
      }
    }
    player.connectedSockets.clear();

    const inGame = room.phase !== PHASES.LOBBY;
    if (inGame) {
      this.engine.removePlayerFromGame(room, playerId);
      this.chat.system(room, 'room', `${player.name} left the game.`);
    } else {
      this.chat.system(room, 'room', `${player.name} left the room.`);
    }

    room.players.delete(playerId);
    this.playerRooms.delete(playerId);
    this._clearRemoval(room, playerId);

    if (player.id === room.hostId || !room.players.has(room.hostId)) {
      this._migrateHost(room);
    }

    if (room.players.size === 0) {
      this.destroyRoom(room.code);
      return room;
    }

    // If the game is waiting/ended and we drop below minimum the host sees it.
    this.broadcastRoom(room);
    return room;
  }

  destroyRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room._timer) clearTimeout(room._timer);
    for (const [, t] of room._removals) clearTimeout(t);
    this.rooms.delete(code);
    for (const pid of room.players.keys()) this.playerRooms.delete(pid);
    for (const [token, s] of this.sessions) {
      if (s.roomCode === code) this.sessions.delete(token);
    }
    logger.info('room destroyed', { code });
  }

  // ---------------------------------------------------------------- host

  _migrateHost(room) {
    if (room.players.size === 0) return;
    const connected = [...room.players.values()].filter((p) => p.connectedSockets.size > 0);
    const pool = connected.length > 0 ? connected : [...room.players.values()];
    const preferred = pool.find((p) => p.alive && p.id !== room.hostId) || pool.find((p) => p.id !== room.hostId) || pool[0];
    room.hostId = preferred.id;
    for (const p of room.players.values()) p.isHost = p.id === room.hostId;
    this.chat.system(room, 'room', `${preferred.name} is now the host.`);
    logger.info('host migrated', { room: room.code, host: preferred.name });
  }

  // ---------------------------------------------------------------- socket lifecycle

  attachSocket(socket) {
    const session = this.getSession(socket.data.token);
    if (!session) {
      socket.emit('error', { code: errorCodes.SESSION_EXPIRED, message: 'Session expired. Return to the home page.' });
      socket.disconnect(true);
      return false;
    }
    const code = session.roomCode;
    const room = this.rooms.get(code);
    if (!room) {
      socket.emit('error', { code: errorCodes.ROOM_NOT_FOUND, message: 'Room not found.' });
      socket.disconnect(true);
      return false;
    }
    const player = room.players.get(session.playerId);
    if (!player) {
      socket.emit('error', { code: errorCodes.UNAUTHORIZED, message: 'You are not part of this room.' });
      socket.disconnect(true);
      return false;
    }

    // Duplicate tab: the newest socket wins; the old one is told to leave.
    if (player.connectedSockets.size > 0) {
      for (const sid of player.connectedSockets) {
        const old = this.io.sockets.sockets.get(sid);
        if (old && old.id !== socket.id) {
          old.emit('session:replaced');
          old.disconnect(true);
        }
      }
      player.connectedSockets.clear();
    }

    player.connectedSockets.add(socket.id);
    player.offline = false;
    player.disconnectedAt = null;
    this._clearRemoval(room, player.id);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;

    if (room.hostId !== player.id && !this._hostConnected(room)) {
      this._migrateHost(room);
    }

    // Push the current state to the freshly connected socket.
    this.pushInitialState(socket, room, player);
    return true;
  }

  pushInitialState(socket, room, player) {
    if (room.phase === PHASES.LOBBY) {
      socket.emit('lobby:state', buildLobbyView(room, player.id));
    } else {
      socket.emit('game:state', buildGameView(room, player.id));
    }
  }

  detachSocket(socket) {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    const room = code ? this.rooms.get(code) : null;
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player) return;

    player.connectedSockets.delete(socket.id);
    if (player.connectedSockets.size > 0) return; // still on another tab

    player.offline = true;
    player.disconnectedAt = Date.now();

    if (player.id === room.hostId || !this._hostConnected(room)) {
      this._migrateHost(room);
    }

    if (room.phase === PHASES.LOBBY) {
      // Temporary session: allow a grace period to come back.
      const t = setTimeout(() => {
        const still = this.rooms.get(room.code);
        const p = still && still.players.get(playerId);
        if (p && p.offline) {
          this.removePlayer(playerId);
        }
      }, GRACE_MS);
      room._removals.set(playerId, t);
    }
  }

  _hostConnected(room) {
    const host = room.players.get(room.hostId);
    return !!host && host.connectedSockets.size > 0;
  }

  _clearRemoval(room, playerId) {
    const t = room._removals.get(playerId);
    if (t) {
      clearTimeout(t);
      room._removals.delete(playerId);
    }
  }

  // ---------------------------------------------------------------- timers

  _startTicker() {
    this.io._mafiaTicker = setInterval(() => this._tick(), 1000);
    this.io._mafiaTicker.unref?.();
  }

  _tick() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.phaseDeadline && isActivePhase(room.phase)) {
        this.io.to(room.code).emit('game:timer', {
          phase: room.phase,
          deadline: room.phaseDeadline,
          now
        });
      }
    }
  }

  schedule(room) {
    if (room._timer) clearTimeout(room._timer);
    room._timer = null;
    if (room.phaseDeadline) {
      const ms = room.phaseDeadline - Date.now();
      if (ms <= 0) {
        this._advance(room);
        return;
      }
      room._timer = setTimeout(() => this._advance(room), ms);
    }
  }

  _advance(room) {
    try {
      this.engine.advancePhase(room);
    } catch (err) {
      logger.error('phase advance failed', { room: room.code, message: err?.message, stack: err?.stack });
      this.io.to(room.code).emit('error', { code: 'INTERNAL', message: 'Something went wrong advancing the game.' });
      return;
    }
    this.afterPhaseChange(room);
  }

  afterPhaseChange(room) {
    this.broadcastRoom(room);
    this.schedule(room);
    if (room.phase === PHASES.GAME_OVER && room.winner) {
      persistGame(room);
    }
  }

  /**
   * Called by action handlers: if the engine says "everyone who can act has
   * acted", advance immediately rather than waiting for the timer.
   */
  maybeAdvance(room) {
    if (isActivePhase(room.phase)) {
      this._advance(room);
    }
  }

  // ---------------------------------------------------------------- broadcast

  broadcastRoom(room) {
    const { io } = this;
    if (room.phase === PHASES.LOBBY) {
      // Per-player lobby views: the `self.isHost` flag can differ per player.
      for (const player of room.players.values()) {
        const view = buildLobbyView(room, player.id);
        for (const sid of player.connectedSockets) {
          io.to(sid).emit('lobby:state', view);
        }
      }
      return;
    }
    this.broadcastGame(room);
  }

  broadcastGame(room) {
    const { io } = this;
    for (const player of room.players.values()) {
      const view = buildGameView(room, player.id);
      for (const sid of player.connectedSockets) {
        io.to(sid).emit('game:state', view);
      }
    }
  }

  /**
   * Deliver a chat message only to sockets that are allowed to read that
   * channel (prevents Mafia chat / dead chat leaks).
   */
  broadcastChat(room, msg, channel) {
    const { io } = this;
    for (const player of room.players.values()) {
      if (this.chat.readableChannels(room, player).includes(channel)) {
        for (const sid of player.connectedSockets) {
          io.to(sid).emit('chat:message', msg);
        }
      }
    }
  }

  sendToPlayer(room, playerId, event, payload) {
    const player = room.players.get(playerId);
    if (!player) return;
    for (const sid of player.connectedSockets) {
      this.io.to(sid).emit(event, payload);
    }
  }
}
