import { PHASES } from '../config.js';

/**
 * Server-side state machine for a Mafia room.
 *
 * The game owns the machine: transitions are only reachable through
 * explicit `transition()` calls performed by the engine. Any invalid
 * transition throws.
 */

const TRANSITIONS = {
  [PHASES.LOBBY]: new Set([PHASES.ROLE_REVEAL]),
  [PHASES.ROLE_REVEAL]: new Set([PHASES.NIGHT_MAFIA, PHASES.GAME_OVER]),
  [PHASES.NIGHT_MAFIA]: new Set([
    PHASES.NIGHT_BODYGUARD,
    PHASES.NIGHT_DOCTOR,
    PHASES.NIGHT_DETECTIVE,
    PHASES.DAY_START,
    PHASES.GAME_OVER
  ]),
  [PHASES.NIGHT_BODYGUARD]: new Set([PHASES.NIGHT_DOCTOR, PHASES.NIGHT_DETECTIVE, PHASES.DAY_START, PHASES.GAME_OVER]),
  [PHASES.NIGHT_DOCTOR]: new Set([PHASES.NIGHT_DETECTIVE, PHASES.DAY_START, PHASES.GAME_OVER]),
  [PHASES.NIGHT_DETECTIVE]: new Set([PHASES.DAY_START, PHASES.GAME_OVER]),
  [PHASES.DAY_START]: new Set([PHASES.DISCUSSION, PHASES.GAME_OVER]),
  [PHASES.DISCUSSION]: new Set([PHASES.VOTING, PHASES.GAME_OVER]),
  [PHASES.VOTING]: new Set([PHASES.VOTE_RESULT, PHASES.GAME_OVER]),
  [PHASES.VOTE_RESULT]: new Set([PHASES.DISCUSSION, PHASES.NIGHT_MAFIA, PHASES.VOTING, PHASES.GAME_OVER]),
  [PHASES.GAME_OVER]: new Set([PHASES.ROLE_REVEAL, PHASES.LOBBY])
};

const ACTIVE_PHASES = new Set([
  PHASES.NIGHT_MAFIA,
  PHASES.NIGHT_BODYGUARD,
  PHASES.NIGHT_DOCTOR,
  PHASES.NIGHT_DETECTIVE,
  PHASES.DISCUSSION,
  PHASES.VOTING
]);

export function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  return !!allowed && allowed.has(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid phase transition: ${from} -> ${to}`);
  }
}

export function isActivePhase(phase) {
  return ACTIVE_PHASES.has(phase);
}

export function isNightPhase(phase) {
  return phase === PHASES.NIGHT_MAFIA || phase === PHASES.NIGHT_BODYGUARD || phase === PHASES.NIGHT_DOCTOR || phase === PHASES.NIGHT_DETECTIVE;
}

export function isVotingPhase(phase) {
  return phase === PHASES.VOTING;
}

export function isNight() {
  return false;
}

export function phaseDuration(phase, settings) {
  switch (phase) {
    case PHASES.ROLE_REVEAL:
      return settings.roleRevealDuration;
    case PHASES.NIGHT_MAFIA:
    case PHASES.NIGHT_BODYGUARD:
    case PHASES.NIGHT_DOCTOR:
    case PHASES.NIGHT_DETECTIVE:
      return settings.nightDuration;
    case PHASES.DAY_START:
      return settings.morningDuration;
    case PHASES.DISCUSSION:
      return settings.discussionDuration;
    case PHASES.VOTING:
      return settings.votingDuration;
    case PHASES.VOTE_RESULT:
      return 7;
    default:
      return null;
  }
}

export function nextNightPhase(phase) {
  const order = [
    PHASES.NIGHT_MAFIA,
    PHASES.NIGHT_BODYGUARD,
    PHASES.NIGHT_DOCTOR,
    PHASES.NIGHT_DETECTIVE
  ];
  const idx = order.indexOf(phase);
  if (idx === -1) return null;
  return order[idx + 1] || null;
}
