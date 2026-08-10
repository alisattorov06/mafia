import { GameError, errorCodes } from '../utils/errors.js';

export const GAME_MODES = Object.freeze(['CLASSIC', 'HARD', 'CUSTOM']);

export const DEFAULT_SETTINGS = Object.freeze({
  maxPlayers: 8,
  mafiaCount: null,
  doctorEnabled: true,
  detectiveEnabled: true,
  donEnabled: true,
  jesterEnabled: false,
  bodyguardEnabled: false,
  roleReveal: true,
  anonymousVoting: false,
  spectatorMode: false,
  tieRule: 'none',
  mafiaKillRule: 'majority',
  doctorSelfHeal: true,
  doctorRepeatProtect: false,
  bodyguardDiesForTarget: true,
  donImmuneToDetective: true,
  selfVote: false,
  deadChatEnabled: true,
  nightDuration: 30,
  discussionDuration: 90,
  votingDuration: 45,
  morningDuration: 8,
  roleRevealDuration: 12,
  minPlayers: 6
});

const clampInt = (v, lo, hi, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

const boolVal = (v, d) => (typeof v === 'boolean' ? v : d);

const STRING_CHOICES = {
  tieRule: ['none', 'runoff', 'random'],
  mafiaKillRule: ['majority', 'don', 'random']
};

export function defaultSettingsForMode(mode) {
  const s = { ...DEFAULT_SETTINGS };
  if (mode === 'CLASSIC') {
    s.maxPlayers = 8;
  } else if (mode === 'HARD') {
    s.maxPlayers = 8;
    s.roleReveal = false;
  } else if (mode === 'CUSTOM') {
    s.maxPlayers = 12;
  }
  return s;
}

export function sanitizeSettings(input, mode) {
  if (!input || typeof input !== 'object') input = {};
  const base = defaultSettingsForMode(mode);
  const maxCap = parseInt(process.env.MAX_PLAYERS_PER_ROOM || '20', 10);
  const out = { ...base };

  out.maxPlayers = clampInt(input.maxPlayers, 6, maxCap, base.maxPlayers);
  out.mafiaCount = input.mafiaCount == null ? null : clampInt(input.mafiaCount, 1, Math.floor(out.maxPlayers / 2), null);
  out.doctorEnabled = boolVal(input.doctorEnabled, base.doctorEnabled);
  out.detectiveEnabled = boolVal(input.detectiveEnabled, base.detectiveEnabled);
  out.donEnabled = boolVal(input.donEnabled, base.donEnabled);
  out.jesterEnabled = boolVal(input.jesterEnabled, base.jesterEnabled);
  out.bodyguardEnabled = boolVal(input.bodyguardEnabled, base.bodyguardEnabled);
  out.roleReveal = boolVal(input.roleReveal, base.roleReveal);
  out.anonymousVoting = boolVal(input.anonymousVoting, base.anonymousVoting);
  out.spectatorMode = boolVal(input.spectatorMode, base.spectatorMode);
  out.deadChatEnabled = boolVal(input.deadChatEnabled, base.deadChatEnabled);
  out.selfVote = boolVal(input.selfVote, base.selfVote);
  out.doctorSelfHeal = boolVal(input.doctorSelfHeal, base.doctorSelfHeal);
  out.doctorRepeatProtect = boolVal(input.doctorRepeatProtect, base.doctorRepeatProtect);
  out.bodyguardDiesForTarget = boolVal(input.bodyguardDiesForTarget, base.bodyguardDiesForTarget);
  out.donImmuneToDetective = boolVal(input.donImmuneToDetective, base.donImmuneToDetective);

  if (STRING_CHOICES.tieRule.includes(input.tieRule)) out.tieRule = input.tieRule;
  if (STRING_CHOICES.mafiaKillRule.includes(input.mafiaKillRule)) out.mafiaKillRule = input.mafiaKillRule;

  out.nightDuration = clampInt(input.nightDuration, 10, 120, base.nightDuration);
  out.discussionDuration = clampInt(input.discussionDuration, 15, 300, base.discussionDuration);
  out.votingDuration = clampInt(input.votingDuration, 10, 180, base.votingDuration);
  out.morningDuration = clampInt(input.morningDuration, 4, 30, base.morningDuration);
  out.roleRevealDuration = clampInt(input.roleRevealDuration, 6, 60, base.roleRevealDuration);

  if (mode === 'CUSTOM') {
    if (out.mafiaCount != null && out.mafiaCount >= out.maxPlayers) {
      throw new GameError(errorCodes.INVALID_SETTINGS, 'Mafia count must be lower than the player count.');
    }
  }
  return out;
}
