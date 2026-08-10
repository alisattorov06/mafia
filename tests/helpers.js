import { GameEngine } from '../src/game/engine.js';
import { ChatManager } from '../src/game/chat.js';
import { DEFAULT_SETTINGS } from '../src/game/settings.js';
import { teamOfRole } from '../src/game/roleBalancer.js';
import { ROLES } from '../src/game/roles.js';

export function makeEngine() {
  return new GameEngine();
}

export function makeChat() {
  return new ChatManager();
}

export function fakeRoom(playerNames, settings = {}, mode = 'CLASSIC') {
  const room = {
    id: 'test-room',
    code: 'TEST01',
    mode,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    status: 'WAITING',
    phase: 'LOBBY',
    previousPhase: null,
    round: 1,
    hostId: null,
    players: new Map(),
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
    _removals: new Map()
  };
  playerNames.forEach((name, i) => {
    const p = {
      id: `p${i}`,
      name,
      role: null,
      team: null,
      alive: true,
      isHost: i === 0,
      offline: false,
      connectedSockets: new Set(),
      joinedAt: Date.now(),
      eliminatedAt: null,
      eliminationReason: null,
      disconnectedAt: null,
      hasSeenRole: false
    };
    room.players.set(p.id, p);
  });
  room.hostId = 'p0';
  return room;
}

/** Force roles onto players after startGame assigned the random deck. Unspecified players become Citizens. */
export function setRoles(room, roleMap) {
  for (const p of room.players.values()) {
    p.role = ROLES.CITIZEN;
    p.team = teamOfRole(ROLES.CITIZEN);
  }
  for (const [pid, role] of Object.entries(roleMap)) {
    const p = room.players.get(pid);
    if (!p) throw new Error(`no player ${pid}`);
    p.role = role;
    p.team = teamOfRole(role);
  }
}

/** Start a game, optionally force roles, and mark everyone as having seen their role. */
export function startAndReveal(engine, room, roles = null) {
  engine.startGame(room);
  if (roles) setRoles(room, roles);
  for (const p of room.players.values()) {
    engine.playerReady(room, p.id);
  }
  engine.advancePhase(room); // ROLE_REVEAL -> NIGHT_MAFIA
  return room;
}

/** Advance through empty night phases (citizens/roles that don't act). */
export function runNight(engine, room) {
  // NIGHT_MAFIA requires mafia to act; callers drive it. For the rest:
  while (room.phase !== 'DAY_START' && room.phase !== 'GAME_OVER') {
    const before = room.phase;
    engine.advancePhase(room);
    if (room.phase === before) throw new Error('stuck in phase ' + before);
  }
  return room;
}
