import { PHASES } from '../config.js';
import { GameError, errorCodes } from '../utils/errors.js';
import { buildRoleDeck, teamOfRole } from './roleBalancer.js';
import {
  ROLES,
  ROLE_DEFS,
  canActAtNight,
  killParticipant,
  isMafiaRole
} from './roles.js';
import {
  assertTransition,
  canTransition,
  isActivePhase,
  isNightPhase,
  isVotingPhase,
  nextNightPhase,
  phaseDuration
} from './stateMachine.js';

/**
 * GameEngine — the authoritative server-side game logic.
 *
 * The engine is deliberately transport-agnostic: it mutates `room` objects
 * and returns outcome flags. A RoomManager (see roomManager.js) owns timers
 * and broadcasting and drives the engine by calling advancePhase().
 *
 * Everything the client *believes* about role, phase, vote, timer or winner
 * is derived here from server state. No action is trusted from the client.
 */

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function alivePlayers(room) {
  return [...room.players.values()].filter((p) => p.alive);
}

function aliveByTeam(room, team) {
  return alivePlayers(room).filter((p) => p.team === team);
}

function mafiaAlive(room) {
  return aliveByTeam(room, 'MAFIA');
}

function townAlive(room) {
  return aliveByTeam(room, 'TOWN');
}

function getPlayer(room, id) {
  return room.players.get(id) || null;
}

function recordEvent(room, type, actorId = null, targetId = null, metadata = null) {
  room.history.push({
    type,
    actorId,
    targetId,
    phase: room.phase,
    round: room.round,
    metadata,
    ts: Date.now()
  });
}

export class GameEngine {
  /**
   * Assign secret roles to every player using the configured role balancer.
   */
  assignRoles(room) {
    const deck = buildRoleDeck(room.players.size, { ...room.settings, mode: room.mode });
    const ids = [...room.players.keys()];
    if (deck.length !== ids.length) {
      throw new Error('Role deck size mismatch');
    }
    for (let i = 0; i < ids.length; i += 1) {
      const player = room.players.get(ids[i]);
      const role = deck[i];
      player.role = role;
      player.team = teamOfRole(role);
      player.hasSeenRole = false;
    }
  }

  startGame(room) {
    if (room.phase !== PHASES.LOBBY) {
      throw new GameError(errorCodes.INVALID_PHASE, 'Game has already started.');
    }
    if (room.players.size < room.settings.minPlayers) {
      throw new GameError(errorCodes.INVALID_ACTION, `Need at least ${room.settings.minPlayers} players to start.`);
    }
    this.assignRoles(room);
    room.status = 'PLAYING';
    room.startedAt = Date.now();
    room.endedAt = null;
    room.round = 1;
    room.winner = null;
    room.winningTeam = null;
    room.readySet = new Set();
    room.nightResult = null;
    room.elimination = null;
    room.stats = {
      rounds: 0,
      nightKills: 0,
      successfulSaves: 0,
      investigations: 0,
      votesCast: 0,
      bodyguardSaves: 0
    };
    room.history = [];
    this.transition(room, PHASES.ROLE_REVEAL);
  }

  /**
   * Player confirms they have read their secret role.
   * Advances once every living player has confirmed or the timer expires.
   */
  playerReady(room, playerId) {
    const player = getPlayer(room, playerId);
    if (!player) throw new GameError(errorCodes.UNAUTHORIZED, 'Not a member of this room.');
    if (room.phase !== PHASES.ROLE_REVEAL) {
      throw new GameError(errorCodes.INVALID_PHASE, 'You cannot do that right now.');
    }
    player.hasSeenRole = true;
    room.readySet.add(playerId);
    recordEvent(room, 'role_seen', playerId, null, { role: player.role });
    const all = alivePlayers(room).every((p) => p.hasSeenRole);
    if (all) return { advance: true };
    return { advance: false };
  }

  /**
   * A mafia member proposes a target (or null to skip) and/or locks in.
   */
  mafiaAction(room, playerId, targetId) {
    this.assertInGame(room);
    if (room.phase !== PHASES.NIGHT_MAFIA) {
      throw new GameError(errorCodes.INVALID_PHASE, 'The Mafia are not acting right now.');
    }
    const player = getPlayer(room, playerId);
    this.assertCanAct(room, player, true);
    if (!killParticipant(player.role)) {
      throw new GameError(errorCodes.INVALID_ROLE, 'Only the Mafia may choose a target.');
    }
    const target = this.validateTarget(room, targetId, { allowSelf: false, allowNull: true, selfId: playerId });
    room.mafiaTargets.set(playerId, target ? target.id : null);
    room.mafiaActed.add(playerId);
    recordEvent(room, 'mafia_propose', playerId, target ? target.id : null);
    return { advance: this.mafiaAllActed(room) };
  }

  mafiaLock(room, playerId) {
    this.assertInGame(room);
    if (room.phase !== PHASES.NIGHT_MAFIA) {
      throw new GameError(errorCodes.INVALID_PHASE, 'The Mafia are not acting right now.');
    }
    const player = getPlayer(room, playerId);
    this.assertCanAct(room, player, true);
    if (!killParticipant(player.role)) {
      throw new GameError(errorCodes.INVALID_ROLE, 'Only the Mafia may lock a target.');
    }
    room.mafiaLocked.add(playerId);
    return { advance: this.mafiaAllActed(room) };
  }

  mafiaAllActed(room) {
    const aliveMafia = mafiaAlive(room).filter((p) => killParticipant(p.role));
    return aliveMafia.length > 0 && aliveMafia.every((p) => room.mafiaActed.has(p.id));
  }

  /**
   * Doctor protects a target (living player, subject to configured rules).
   */
  doctorAction(room, playerId, targetId) {
    this.assertInGame(room);
    if (room.phase !== PHASES.NIGHT_DOCTOR) {
      throw new GameError(errorCodes.INVALID_PHASE, 'The Doctor is not acting right now.');
    }
    const player = getPlayer(room, playerId);
    this.assertCanAct(room, player, true);
    if (player.role !== ROLES.DOCTOR) {
      throw new GameError(errorCodes.INVALID_ROLE, 'Only the Doctor may protect.');
    }
    const target = this.validateTarget(room, targetId, {
      allowSelf: room.settings.doctorSelfHeal,
      allowNull: true,
      selfId: playerId
    });
    if (target && !room.settings.doctorRepeatProtect && room.doctorLastTarget === target.id) {
      throw new GameError(errorCodes.INVALID_ACTION, 'You cannot protect the same player on consecutive nights.');
    }
    room.doctorTarget = target ? target.id : null;
    recordEvent(room, 'doctor_protect', playerId, room.doctorTarget);
    return { advance: true };
  }

  /**
   * Bodyguard guards another living player.
   */
  bodyguardAction(room, playerId, targetId) {
    this.assertInGame(room);
    if (room.phase !== PHASES.NIGHT_BODYGUARD) {
      throw new GameError(errorCodes.INVALID_PHASE, 'The Bodyguard is not acting right now.');
    }
    const player = getPlayer(room, playerId);
    this.assertCanAct(room, player, true);
    if (player.role !== ROLES.BODYGUARD) {
      throw new GameError(errorCodes.INVALID_ROLE, 'Only the Bodyguard may guard.');
    }
    const target = this.validateTarget(room, targetId, { allowSelf: false, allowNull: true, selfId: playerId });
    room.bodyguardTarget = target ? target.id : null;
    recordEvent(room, 'bodyguard_guard', playerId, room.bodyguardTarget);
    return { advance: true };
  }

  /**
   * Detective investigates a living player. The result is secret and is
   * delivered exclusively to that Detective.
   */
  detectiveAction(room, playerId, targetId) {
    this.assertInGame(room);
    if (room.phase !== PHASES.NIGHT_DETECTIVE) {
      throw new GameError(errorCodes.INVALID_PHASE, 'The Detective is not acting right now.');
    }
    const player = getPlayer(room, playerId);
    this.assertCanAct(room, player, true);
    if (player.role !== ROLES.DETECTIVE) {
      throw new GameError(errorCodes.INVALID_ROLE, 'Only the Detective may investigate.');
    }
    const target = this.validateTarget(room, targetId, { allowSelf: false, allowNull: true, selfId: playerId });
    room.detectiveTarget = target ? target.id : null;
    if (target) {
      const isMafia = isMafiaRole(target.role);
      const donHidden = target.role === ROLES.DON && room.settings.donImmuneToDetective;
      room.detectiveResult = { targetId: target.id, isMafia: isMafia && !donHidden };
      recordEvent(room, 'detective_investigate', playerId, target.id, { result: room.detectiveResult.isMafia });
    } else {
      room.detectiveResult = null;
    }
    return { advance: true };
  }

  /**
   * Vote during the VOTING phase. Dead players, non-players, invalid targets
   * and (optionally) self votes are rejected by the server.
   */
  castVote(room, playerId, targetId) {
    this.assertInGame(room);
    if (room.phase !== PHASES.VOTING) {
      throw new GameError(errorCodes.INVALID_PHASE, 'Voting is not open.');
    }
    const player = getPlayer(room, playerId);
    this.assertCanAct(room, player, false);
    if (!player.alive) {
      throw new GameError(errorCodes.DEAD_PLAYER, 'Eliminated players cannot vote.');
    }
    const target = this.validateTarget(room, targetId, {
      allowSelf: room.settings.selfVote,
      allowNull: true,
      selfId: playerId,
      message: 'You cannot vote for that player.'
    });
    if (target && room.votingCandidates && !room.votingCandidates.includes(target.id)) {
      throw new GameError(errorCodes.INVALID_ACTION, 'That player is not in the runoff.');
    }
    const hadVote = room.votes.has(playerId);
    room.votes.set(playerId, target ? target.id : null);
    if (!hadVote) room.stats.votesCast += 1;
    recordEvent(room, 'vote', playerId, target ? target.id : null);
    const alive = alivePlayers(room);
    const allVoted = alive.every((p) => room.votes.has(p.id));
    return { advance: allVoted };
  }

  /**
   * The universal state machine driver. Called by the RoomManager when a
   * phase timer expires, or immediately when all players have acted.
   */
  advancePhase(room) {
    const from = room.phase;

    if (from === PHASES.ROLE_REVEAL) {
      // Everyone has seen their role; move into the night.
      this.enterNight(room, 1);
      return;
    }

    if (isNightPhase(from)) {
      // Skip night sub-phases whose role is absent (e.g. no Bodyguard).
      let next = nextNightPhase(from);
      while (next && !this.phaseHasActors(room, next)) {
        next = nextNightPhase(next);
      }
      if (next) {
        this.transition(room, next);
      } else {
        this.resolveNight(room);
        if (room.winner) {
          this.endGame(room, room.winner, room.winningTeam, room.winReason);
        } else {
          this.transition(room, PHASES.DAY_START);
        }
      }
      return;
    }

    if (from === PHASES.DAY_START) {
      this.transition(room, PHASES.DISCUSSION);
      return;
    }

    if (from === PHASES.DISCUSSION) {
      this.transition(room, PHASES.VOTING);
      return;
    }

    if (from === PHASES.VOTING) {
      this.transition(room, PHASES.VOTE_RESULT);
      return;
    }

    if (from === PHASES.VOTE_RESULT) {
      this.afterVoteResult(room);
      return;
    }

    throw new GameError(errorCodes.INVALID_PHASE, `Cannot advance from phase ${from}.`);
  }

  enterNight(room, round) {
    room.round = round;
    room.nightResult = null;
    room.elimination = null;
    room.mafiaTargets = new Map();
    room.mafiaActed = new Set();
    room.mafiaLocked = new Set();
    room.mafiaFinalTarget = null;
    room.doctorTarget = null;
    room.doctorLastTarget = room.doctorLastTarget; // persists across nights
    room.bodyguardTarget = null;
    room.detectiveTarget = null;
    room.detectiveResult = null;
    room.votes = new Map();
    room.votingCandidates = null;
    this.transition(room, PHASES.NIGHT_MAFIA);
  }

  phaseHasActors(room, phase) {
    if (phase === PHASES.NIGHT_BODYGUARD) {
      return aliveByTeam(room, 'TOWN').some((p) => p.role === ROLES.BODYGUARD);
    }
    if (phase === PHASES.NIGHT_DOCTOR) {
      return aliveByTeam(room, 'TOWN').some((p) => p.role === ROLES.DOCTOR);
    }
    if (phase === PHASES.NIGHT_DETECTIVE) {
      return aliveByTeam(room, 'TOWN').some((p) => p.role === ROLES.DETECTIVE);
    }
    return true;
  }

  /**
   * Collapse every Mafia proposal into a single final kill target.
   */
  resolveMafiaTarget(room) {
    const proposals = [];
    for (const [id, targetId] of room.mafiaTargets) {
      const target = getPlayer(room, targetId);
      if (target && target.alive && target.id !== id) proposals.push(targetId);
    }
    if (proposals.length === 0) {
      room.mafiaFinalTarget = null;
      return;
    }
    const rule = room.settings.mafiaKillRule;
    if (rule === 'don') {
      const don = [...room.mafiaTargets.entries()].find(
        ([id, targetId]) => getPlayer(room, id)?.role === ROLES.DON && targetId != null
      );
      if (don) {
        room.mafiaFinalTarget = don[1];
        return;
      }
    }
    const counts = new Map();
    for (const t of proposals) counts.set(t, (counts.get(t) || 0) + 1);
    const max = Math.max(...counts.values());
    let top = [...counts.entries()].filter(([, c]) => c === max).map(([t]) => t);
    if (rule === 'random') {
      room.mafiaFinalTarget = pick(proposals);
      return;
    }
    room.mafiaFinalTarget = top.length > 1 ? pick(top) : top[0];
  }

  /**
   * Apply Doctor / Bodyguard / kill at the end of the night.
   */
  resolveNight(room) {
    this.resolveMafiaTarget(room);
    const killedId = room.mafiaFinalTarget;
    let saved = false;
    let bodyguardDied = null;

    if (killedId) {
      const protectedById = room.doctorTarget;
      if (protectedById === killedId) {
        saved = true;
        room.stats.successfulSaves += 1;
      } else if (room.bodyguardTarget === killedId && room.settings.bodyguardDiesForTarget) {
        const bodyguard = aliveByTeam(room, 'TOWN').find((p) => p.role === ROLES.BODYGUARD);
        if (bodyguard) {
          bodyguardDied = bodyguard.id;
          room.stats.bodyguardSaves += 1;
        }
      }
    }

    if (killedId && !saved) {
      if (bodyguardDied) {
        // Bodyguard takes the hit; original target survives.
        this.killPlayer(room, bodyguardDied, 'NIGHT_KILL');
        room.stats.nightKills += 1;
      } else {
        this.killPlayer(room, killedId, 'NIGHT_KILL');
        room.stats.nightKills += 1;
      }
    }

    room.doctorLastTarget = room.doctorTarget;
    room.nightResult = { killedId, saved, bodyguardDied };
    recordEvent(room, 'night_resolved', null, killedId, { saved, bodyguardDied });

    const win = this.checkWin(room);
    if (win) {
      room.winner = win.winner;
      room.winningTeam = win.winningTeam;
      room.winReason = win.reason;
    }
  }

  killPlayer(room, playerId, reason) {
    const player = getPlayer(room, playerId);
    if (!player || !player.alive) return;
    player.alive = false;
    player.eliminatedAt = Date.now();
    player.eliminationReason = reason;
    recordEvent(room, 'player_killed', null, playerId, { reason });
  }

  /**
   * Count the votes and produce the day's elimination outcome.
   */
  computeVoteResult(room) {
    const counts = new Map();
    const alive = alivePlayers(room);
    const aliveIds = new Set(alive.map((p) => p.id));

    for (const [voterId, targetId] of room.votes) {
      const voter = getPlayer(room, voterId);
      if (!voter || !voter.alive) continue; // dead players' votes are dropped
      if (targetId == null) continue; // abstention
      if (!aliveIds.has(targetId)) continue; // invalid target
      if (targetId === voterId && !room.settings.selfVote) continue;
      if (room.votingCandidates && !room.votingCandidates.includes(targetId)) continue;
      counts.set(targetId, (counts.get(targetId) || 0) + 1);
    }

    if (counts.size === 0) {
      return { eliminatedId: null, tie: false, runoff: null, counts };
    }

    const max = Math.max(...counts.values());
    const top = [...counts.entries()].filter(([, c]) => c === max).map(([t]) => t);

    if (top.length > 1) {
      if (room.settings.tieRule === 'runoff') {
        return { eliminatedId: null, tie: true, runoff: top, counts };
      }
      if (room.settings.tieRule === 'random') {
        return { eliminatedId: pick(top), tie: false, runoff: null, counts };
      }
      return { eliminatedId: null, tie: true, runoff: null, counts };
    }

    return { eliminatedId: top[0], tie: false, runoff: null, counts };
  }

  /**
   * Freeze the elimination announcement as soon as a vote is computed, so it
   * is visible during the VOTE_RESULT phase. Runoffs keep `null`.
   */
  computeElimination(room) {
    const result = room.computedVote;
    room.elimination = null;
    if (!result || result.runoff || !result.eliminatedId) return;
    const eliminated = getPlayer(room, result.eliminatedId);
    if (!eliminated) return;
    room.elimination = {
      playerId: eliminated.id,
      name: eliminated.name,
      role: eliminated.role,
      team: eliminated.team,
      reveal: room.settings.roleReveal,
      reason: 'VOTED_OUT'
    };
  }

  afterVoteResult(room) {
    const result = room.computedVote;
    if (!result) return;

    // Runoff: narrow the candidates and re-open voting.
    if (result.runoff) {
      room.votingCandidates = result.runoff;
      room.votes = new Map();
      this.transition(room, PHASES.VOTING);
      return;
    }

    if (room.elimination && room.elimination.playerId) {
      const eliminated = getPlayer(room, room.elimination.playerId);
      if (eliminated) {
        this.killPlayer(room, eliminated.id, 'VOTED_OUT');
        recordEvent(room, 'voted_out', null, eliminated.id);

        // Jester: if voted out during the day, they win immediately.
        if (eliminated.role === ROLES.JESTER) {
          room.elimination.jesterWin = true;
          this.endGame(room, 'JESTER', 'NEUTRAL', 'The Jester was voted out.');
          return;
        }
      }
    }

    const win = this.checkWin(room);
    if (win) {
      this.endGame(room, win.winner, win.winningTeam, win.reason);
      return;
    }

    this.enterNight(room, room.round + 1);
  }

  /**
   * Evaluate the standard win conditions:
   *  - TOWN wins when no Mafia remain alive.
   *  - MAFIA wins when its alive count reaches or exceeds the Town count.
   *  - NEUTRAL (Jester) is evaluated at vote time, never here.
   */
  checkWin(room) {
    const m = mafiaAlive(room);
    const t = townAlive(room);
    if (m.length === 0) return { winner: 'TOWN', winningTeam: 'TOWN', reason: 'All Mafia eliminated.' };
    if (m.length >= t.length) return { winner: 'MAFIA', winningTeam: 'MAFIA', reason: 'The Mafia reached parity.' };
    return null;
  }

  endGame(room, winner, winningTeam, reason) {
    if (room.phase === PHASES.GAME_OVER) return;
    room.winner = winner;
    room.winningTeam = winningTeam;
    room.winReason = reason;
    room.endedAt = Date.now();
    room.status = 'ENDED';
    this.transition(room, PHASES.GAME_OVER);
    recordEvent(room, 'game_ended', null, null, { winner, winningTeam, reason });
  }

  /**
   * Rematch: reset gameplay state, keep the room + players, deal new roles
   * and go straight into the secret role reveal.
   */
  resetForRematch(room) {
    for (const player of room.players.values()) {
      player.role = null;
      player.team = null;
      player.alive = true;
      player.eliminatedAt = null;
      player.eliminationReason = null;
      player.hasSeenRole = false;
    }
    room.status = 'PLAYING';
    room.startedAt = Date.now();
    room.endedAt = null;
    room.round = 1;
    room.winner = null;
    room.winningTeam = null;
    room.winReason = null;
    room.nightResult = null;
    room.elimination = null;
    room.computedVote = null;
    room.history = [];
    room.stats = {
      rounds: 0,
      nightKills: 0,
      successfulSaves: 0,
      investigations: 0,
      votesCast: 0,
      bodyguardSaves: 0
    };
    this.assignRoles(room);
    room.readySet = new Set();
    room.mafiaTargets = new Map();
    room.doctorLastTarget = null;
    this.transition(room, PHASES.ROLE_REVEAL);
  }

  /** Return to the lobby after a game. Roles are wiped; host restarts. */
  returnToLobby(room) {
    for (const player of room.players.values()) {
      player.role = null;
      player.team = null;
      player.alive = true;
      player.eliminatedAt = null;
      player.eliminationReason = null;
      player.hasSeenRole = false;
    }
    room.status = 'WAITING';
    room.round = 1;
    room.winner = null;
    room.winningTeam = null;
    room.nightResult = null;
    room.elimination = null;
    room.computedVote = null;
    room.history = [];
    room.stats = null;
    room.startedAt = null;
    room.endedAt = null;
    this.transition(room, PHASES.LOBBY);
  }

  /** Remove a player from an in-progress game (they abandoned it). */
  removePlayerFromGame(room, playerId) {
    const player = getPlayer(room, playerId);
    if (!player) return;
    if (player.alive) {
      this.killPlayer(room, playerId, 'LEFT');
      player.eliminationReason = 'LEFT';
    }
    const win = this.checkWin(room);
    if (win) {
      this.endGame(room, win.winner, win.winningTeam, win.reason);
    }
  }

  assertInGame(room) {
    if (room.phase === PHASES.LOBBY || room.status !== 'PLAYING') {
      throw new GameError(errorCodes.GAME_NOT_STARTED, 'The game has not started.');
    }
  }

  assertCanAct(room, player, requireAlive) {
    if (!player) throw new GameError(errorCodes.UNAUTHORIZED, 'Not a member of this room.');
    if (requireAlive && !player.alive) {
      throw new GameError(errorCodes.DEAD_PLAYER, 'You are eliminated and cannot do that.');
    }
  }

  validateTarget(room, targetId, opts) {
    if (targetId == null) return null;
    const o = opts || {};
    const target = getPlayer(room, targetId);
    if (!target) {
      throw new GameError(errorCodes.INVALID_ACTION, o.message || 'You cannot target that player.');
    }
    if (!target.alive) {
      throw new GameError(errorCodes.INVALID_ACTION, 'You cannot target a dead player.');
    }
    if (o.allowSelf === false && targetId === o.selfId) {
      throw new GameError(errorCodes.INVALID_ACTION, 'You cannot target yourself.');
    }
    return target;
  }

  validateTargetId(room, raw, o = {}) {
    const id = typeof raw === 'string' ? raw : null;
    if (!id && !o.allowNull) {
      throw new GameError(errorCodes.INVALID_ACTION, 'A valid target is required.');
    }
    return this.validateTarget(room, id, o);
  }

  transition(room, to) {
    assertTransition(room.phase, to);
    const from = room.phase;
    room.phase = to;
    room.phaseStartedAt = Date.now();
    const dur = phaseDuration(to, room.settings);
    room.phaseDeadline = dur == null ? null : Date.now() + dur * 1000;
    if (to === PHASES.NIGHT_MAFIA && isNightPhase(to)) room.stats.rounds = room.round;
    if (to === PHASES.VOTING) {
      room.votes = new Map();
      room.elimination = null;
    }
    if (to === PHASES.VOTE_RESULT) {
      room.computedVote = this.computeVoteResult(room);
      this.computeElimination(room);
    }
    if (to === PHASES.ROLE_REVEAL) {
      room.readySet = new Set();
    }
    room.previousPhase = from;
    recordEvent(room, 'phase', null, null, { from, to });
  }

  /**
   * Mafia members who still have a pending proposal that matches the current
   * final target. Publicly useful only for the Mafia's own night panel.
   */
  mafiaPanelState(room) {
    const aliveMafia = mafiaAlive(room);
    const panel = [];
    for (const p of aliveMafia) {
      panel.push({
        id: p.id,
        name: p.name,
        targetId: room.mafiaTargets.get(p.id) || null,
        locked: room.mafiaLocked.has(p.id)
      });
    }
    return panel;
  }

  deadPlayerList(room) {
    return [...room.players.values()]
      .filter((p) => !p.alive)
      .map((p) => ({
        id: p.id,
        name: p.name,
        role: room.settings.roleReveal ? p.role : null,
        team: room.settings.roleReveal ? p.team : null,
        eliminationReason: p.eliminationReason
      }));
  }
}
