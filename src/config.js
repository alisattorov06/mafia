import 'dotenv/config';

const bool = (v, d = false) => (v === undefined ? d : String(v).toLowerCase() === 'true');
const num = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: num(process.env.PORT, 3000),
  // Empty by default => Socket.IO reflects the request origin (same-origin works
  // everywhere, including hosted domains). Set CORS_ORIGIN to restrict.
  corsOrigin: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret',
  maxPlayersPerRoom: num(process.env.MAX_PLAYERS_PER_ROOM, 20),
  debugMode: bool(process.env.DEBUG_MODE, false),
  debugToken: process.env.DEBUG_TOKEN || 'debug',
  trustProxy: bool(process.env.TRUST_PROXY, false),
  databaseUrl: process.env.DATABASE_URL || null,
  env: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production'
};

export const PHASES = Object.freeze({
  LOBBY: 'LOBBY',
  ROLE_REVEAL: 'ROLE_REVEAL',
  NIGHT_MAFIA: 'NIGHT_MAFIA',
  NIGHT_BODYGUARD: 'NIGHT_BODYGUARD',
  NIGHT_DOCTOR: 'NIGHT_DOCTOR',
  NIGHT_DETECTIVE: 'NIGHT_DETECTIVE',
  DAY_START: 'DAY_START',
  DISCUSSION: 'DISCUSSION',
  VOTING: 'VOTING',
  VOTE_RESULT: 'VOTE_RESULT',
  GAME_OVER: 'GAME_OVER'
});

export const TEAMS = Object.freeze(['TOWN', 'MAFIA', 'NEUTRAL']);
