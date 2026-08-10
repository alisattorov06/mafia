import { PHASES } from '../config.js';
import { isMafiaRole } from './roles.js';
import { isNightPhase } from './stateMachine.js';

/**
 * Player-specific sanitized state.
 *
 * SECURITY: these builders are the ONLY place the server turns internal
 * game state into something sent over the wire. They are written so that a
 * client can never learn another player's role, the Mafia team, hidden
 * night actions or private investigation results.
 */

function basePlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    offline: p.offline,
    isHost: p.id === room.hostId
  }));
}

function mafiaTeammates(room, viewer) {
  if (viewer.team !== 'MAFIA') return [];
  return [...room.players.values()]
    .filter((p) => p.team === 'MAFIA' && p.id !== viewer.id)
    .map((p) => ({ id: p.id, name: p.name, alive: p.alive, offline: p.offline }));
}

export function buildLobbyView(room, viewerId) {
  const viewer = room.players.get(viewerId) || null;
  return {
    kind: 'lobby',
    roomCode: room.code,
    mode: room.mode,
    status: room.status,
    players: basePlayers(room),
    hostId: room.hostId,
    self: viewer
      ? { id: viewer.id, name: viewer.name, isHost: viewer.id === room.hostId }
      : null,
    settings: room.settings,
    minPlayers: room.settings.minPlayers,
    playerCount: room.players.size,
    maxPlayers: room.settings.maxPlayers
  };
}

export function buildGameView(room, viewerId) {
  const viewer = room.players.get(viewerId);
  if (!viewer) return null;

  const v = {
    kind: 'game',
    roomCode: room.code,
    mode: room.mode,
    phase: room.phase,
    round: room.round,
    previousPhase: room.previousPhase,
    players: basePlayers(room),
    self: {
      id: viewer.id,
      name: viewer.name,
      alive: viewer.alive,
      role: viewer.role,
      team: viewer.team,
      isHost: viewer.id === room.hostId,
      hasSeenRole: viewer.hasSeenRole === true
    },
    settings: room.settings,
    timer: room.phaseDeadline ? { deadline: room.phaseDeadline, phase: room.phase } : null,
    winner: room.winner,
    winningTeam: room.winningTeam,
    winReason: room.winReason,
    chatAccess: {
      channels: chatChannels(room, viewer)
    }
  };

  // Only the Mafia team knows who the Mafia are.
  if (viewer.team === 'MAFIA') {
    v.teammates = mafiaTeammates(room, viewer);
  }

  // Mafia private night panel.
  if (viewer.team === 'MAFIA' && room.phase === PHASES.NIGHT_MAFIA) {
    v.mafiaPanel = room.mafiaPanelState(room);
    v.myProposal = room.mafiaTargets.get(viewer.id) || null;
    v.locked = room.mafiaLocked.has(viewer.id);
    v.finalTarget = room.mafiaFinalTarget;
  }

  // Role-specific night information.
  if (isNightPhase(room.phase)) {
    v.night = { myTarget: thisPlayerNightTarget(room, viewer) };
    if (viewer.role === 'DOCTOR') {
      v.night.lastTarget = room.doctorLastTarget;
    }
  }

  // Detective result — delivered only to the Detective who acted.
  if (viewer.role === 'DETECTIVE' && room.detectiveResult) {
    if (room.detectiveResult.targetId === room.detectiveTarget) {
      v.detectiveResult = room.detectiveResult;
    }
  }

  // Public morning information (who died, whether someone was saved).
  if (room.nightResult && (room.phase === PHASES.DAY_START || room.phase === PHASES.DISCUSSION || room.phase === PHASES.VOTING || room.phase === PHASES.VOTE_RESULT)) {
    const nr = room.nightResult;
    v.morning = {
      killedId: nr.killedId && !nr.saved ? (nr.bodyguardDied || nr.killedId) : null,
      killedName: null,
      saved: nr.saved,
      bodyguardDiedId: nr.bodyguardDied,
      killedRole: null
    };
    if (v.morning.killedId) {
      const dead = room.players.get(v.morning.killedId);
      if (dead) v.morning.killedName = dead.name;
    }
  }

  // Voting state.
  if (room.phase === PHASES.VOTING) {
    const alive = [...room.players.values()].filter((p) => p.alive);
    const candidates = room.votingCandidates ? alive.filter((p) => room.votingCandidates.includes(p.id)) : alive;
    v.voting = {
      candidates: candidates.map((p) => ({ id: p.id, name: p.name, offline: p.offline })),
      myVote: room.votes.get(viewer.id) ?? null,
      votedCount: [...room.votes.keys()].filter((id) => room.players.get(id)?.alive).length,
      totalVoters: alive.length,
      anonymous: room.settings.anonymousVoting,
      runoff: !!room.votingCandidates,
      selfVoteAllowed: room.settings.selfVote
    };
  }

  // Vote result (public).
  if (room.phase === PHASES.VOTE_RESULT || (room.phase === PHASES.GAME_OVER && room.computedVote)) {
    v.voteResult = buildVoteResultView(room, viewer);
  }

  // Elimination announcement.
  if (room.elimination) {
    const e = room.elimination;
    v.elimination = {
      playerId: e.playerId,
      name: e.name,
      reveal: e.reveal,
      role: e.reveal ? e.role : null,
      team: e.reveal ? e.team : null,
      reason: e.reason,
      jesterWin: !!e.jesterWin
    };
  }

  // Dead players (revealed only when role reveal is on).
  v.deadPlayers = [...room.players.values()]
    .filter((p) => !p.alive)
    .map((p) => ({
      id: p.id,
      name: p.name,
      role: room.settings.roleReveal ? p.role : null,
      team: room.settings.roleReveal ? p.team : null,
      eliminationReason: p.eliminationReason
    }));

  if (room.phase === PHASES.GAME_OVER) {
    v.results = buildResults(room, viewer);
  }

  if (room.phase === PHASES.ROLE_REVEAL) {
    v.roleReveal = {
      role: viewer.role,
      team: viewer.team,
      teammates: viewer.team === 'MAFIA' ? mafiaTeammates(room, viewer) : null
    };
  }

  return v;
}

function thisPlayerNightTarget(room, viewer) {
  switch (room.phase) {
    case PHASES.NIGHT_MAFIA:
      return null;
    case PHASES.NIGHT_BODYGUARD:
      return viewer.role === 'BODYGUARD' ? room.bodyguardTarget : null;
    case PHASES.NIGHT_DOCTOR:
      return viewer.role === 'DOCTOR' ? room.doctorTarget : null;
    case PHASES.NIGHT_DETECTIVE:
      return viewer.role === 'DETECTIVE' ? room.detectiveTarget : null;
    default:
      return null;
  }
}

function chatChannels(room, viewer) {
  const channels = ['dead'];
  if (viewer.alive) channels.push('room');
  if (viewer.alive && isMafiaRole(viewer.role)) channels.push('mafia');
  if (!viewer.alive && room.settings.spectatorMode) channels.push('room');
  return channels;
}

function buildVoteResultView(room, viewer) {
  const cv = room.computedVote;
  if (!cv) return null;
  const anonymous = room.settings.anonymousVoting;
  const rows = [];
  const byName = (id) => room.players.get(id)?.name || 'Unknown';
  for (const [targetId, count] of cv.counts) {
    rows.push({ playerId: targetId, name: byName(targetId), count });
  }
  rows.sort((a, b) => b.count - a.count);
  return {
    rows: anonymous ? rows.map((r) => ({ count: r.count })) : rows,
    totalVotes: cv.counts.size,
    eliminatedId: cv.eliminatedId,
    eliminatedName: cv.eliminatedId ? byName(cv.eliminatedId) : null,
    tie: cv.tie,
    runoff: cv.runoff
  };
}

function buildResults(room, viewer) {
  const durationSec = room.startedAt ? Math.round((Date.now() - room.startedAt) / 1000) : 0;
  const players = [...room.players.values()].map((p) => {
    const survived = p.alive;
    const duration = p.joinedAt ? Math.round((Date.now() - p.joinedAt) / 1000) : 0;
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      team: p.team,
      alive: survived,
      result: survived ? 'SURVIVED' : p.eliminationReason || 'ELIMINATED',
      survivalDuration: duration
    };
  });
  return {
    winner: room.winner,
    winningTeam: room.winningTeam,
    winReason: room.winReason,
    durationSec,
    rounds: room.round,
    playerCount: room.players.size,
    players,
    stats: room.stats || {}
  };
}

export function buildTimerView(room) {
  return {
    phase: room.phase,
    deadline: room.phaseDeadline,
    round: room.round
  };
}
