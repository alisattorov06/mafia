import { ROLES, TEAM } from './roles.js';

/**
 * Automatic role distribution service.
 *
 * Produces a shuffled role deck for a given player count and settings.
 * Rules are derived from classic Mafia balance (~25% Mafia, town power
 * roles scaled by player count).
 */
export function buildRoleDeck(playerCount, settings) {
  if (!Number.isInteger(playerCount) || playerCount < 6) {
    throw new Error(`Cannot balance a game for ${playerCount} players (minimum 6).`);
  }

  const s = settings || {};
  const mode = s.mode || 'CLASSIC';

  const mafiaCount =
    mode === 'CUSTOM' && s.mafiaCount != null
      ? s.mafiaCount
      : defaultMafiaCount(playerCount);

  const roles = [];

  // Mafia core. If Don is enabled (custom, or classic at 10+), upgrade one
  // Mafia slot into a Don. Otherwise plain Mafia only.
  const donEnabled = mode === 'CUSTOM' ? s.donEnabled === true : playerCount >= 10;

  for (let i = 0; i < mafiaCount; i += 1) {
    if (i === 0 && donEnabled) roles.push(ROLES.DON);
    else roles.push(ROLES.MAFIA);
  }

  const doctorEnabled = mode === 'CUSTOM' ? s.doctorEnabled === true : true;
  const detectiveEnabled = mode === 'CUSTOM' ? s.detectiveEnabled === true : true;
  const jesterEnabled =
    mode === 'CUSTOM' ? s.jesterEnabled === true : playerCount >= 10;
  const bodyguardEnabled =
    mode === 'CUSTOM' ? s.bodyguardEnabled === true : playerCount >= 12;

  if (doctorEnabled) roles.push(ROLES.DOCTOR);
  if (detectiveEnabled) roles.push(ROLES.DETECTIVE);
  if (jesterEnabled && playerCount >= 8) roles.push(ROLES.JESTER);
  if (bodyguardEnabled && playerCount >= 10) roles.push(ROLES.BODYGUARD);

  // Fill the rest with Citizens.
  while (roles.length < playerCount) roles.push(ROLES.CITIZEN);

  if (roles.length > playerCount) {
    throw new Error('Configured role set exceeds the player count. Reduce enabled special roles or add players.');
  }

  // Shuffle deterministically enough (Fisher-Yates).
  for (let i = roles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  return roles;
}

export function defaultMafiaCount(playerCount) {
  const m = Math.floor(playerCount / 4);
  return Math.max(1, Math.min(m, Math.floor(playerCount / 2) - 1));
}

export function teamOfRole(role) {
  if (role === ROLES.DON || role === ROLES.MAFIA) return TEAM.MAFIA;
  if (role === ROLES.JESTER) return TEAM.NEUTRAL;
  return TEAM.TOWN;
}
