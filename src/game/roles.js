export const ROLES = Object.freeze({
  CITIZEN: 'CITIZEN',
  MAFIA: 'MAFIA',
  DON: 'DON',
  DOCTOR: 'DOCTOR',
  DETECTIVE: 'DETECTIVE',
  JESTER: 'JESTER',
  BODYGUARD: 'BODYGUARD'
});

export const TEAM = Object.freeze({
  TOWN: 'TOWN',
  MAFIA: 'MAFIA',
  NEUTRAL: 'NEUTRAL'
});

/**
 * Role catalogue. `playerVisible` flags whether the role is shown to everyone
 * when its holder is eliminated and role reveal is enabled.
 */
export const ROLE_DEFS = Object.freeze({
  [ROLES.CITIZEN]: {
    id: ROLES.CITIZEN,
    name: 'Citizen',
    team: TEAM.TOWN,
    icon: 'person',
    color: '#94a3b8',
    description: 'No special ability. Deduce, discuss and vote out the Mafia.',
    objective: 'Eliminate all Mafia members.'
  },
  [ROLES.MAFIA]: {
    id: ROLES.MAFIA,
    name: 'Mafia',
    team: TEAM.MAFIA,
    icon: 'dagger',
    color: '#e11d48',
    description: 'Eliminate one Town player each night alongside your fellow Mafia.',
    objective: 'Reach parity: Mafia alive must equal or outnumber Town alive.'
  },
  [ROLES.DON]: {
    id: ROLES.DON,
    name: 'Don',
    team: TEAM.MAFIA,
    icon: 'crown',
    color: '#f5c542',
    description: 'Leader of the Mafia. Participates in the nightly kill.',
    objective: 'Lead the Mafia to parity and victory.'
  },
  [ROLES.DOCTOR]: {
    id: ROLES.DOCTOR,
    name: 'Doctor',
    team: TEAM.TOWN,
    icon: 'medkit',
    color: '#34d399',
    description: 'Protect one player each night. A protected target survives the Mafia kill.',
    objective: 'Keep the Town alive and uncover the Mafia.'
  },
  [ROLES.DETECTIVE]: {
    id: ROLES.DETECTIVE,
    name: 'Detective',
    team: TEAM.TOWN,
    icon: 'magnifier',
    color: '#22d3ee',
    description: 'Investigate one player each night. You learn whether they are Mafia.',
    objective: 'Find the Mafia through investigation and guide the Town.'
  },
  [ROLES.JESTER]: {
    id: ROLES.JESTER,
    name: 'Jester',
    team: TEAM.NEUTRAL,
    icon: 'joker',
    color: '#a78bfa',
    description: 'Neutral. Win only by being eliminated through a daytime vote.',
    objective: 'Get voted out during the day. No other victory counts.'
  },
  [ROLES.BODYGUARD]: {
    id: ROLES.BODYGUARD,
    name: 'Bodyguard',
    team: TEAM.TOWN,
    icon: 'shield',
    color: '#f97316',
    description: 'Guard one player each night. If they are attacked you may die in their place.',
    objective: 'Protect key Town roles from the nightly kill.'
  }
});

export function roleDef(role) {
  return ROLE_DEFS[role] || null;
}

export function teamOf(role) {
  return ROLE_DEFS[role]?.team ?? null;
}

export function isMafiaRole(role) {
  return role === ROLES.MAFIA || role === ROLES.DON;
}

export function canActAtNight(role) {
  return role === ROLES.MAFIA || role === ROLES.DON || role === ROLES.DOCTOR || role === ROLES.DETECTIVE || role === ROLES.BODYGUARD;
}

export function killParticipant(role) {
  return role === ROLES.MAFIA || role === ROLES.DON;
}
