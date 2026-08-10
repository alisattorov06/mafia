const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel = LEVELS.debug;

export function setLogLevel(level) {
  if (level in LEVELS) minLevel = LEVELS[level];
}

function fmt(level, msg, meta) {
  const t = new Date().toISOString();
  const base = `[${t}] [${level.toUpperCase()}] ${msg}`;
  if (meta !== undefined) {
    try {
      return `${base} ${JSON.stringify(meta)}`;
    } catch {
      return base;
    }
  }
  return base;
}

export const logger = {
  debug: (msg, meta) => LEVELS.debug >= minLevel && console.debug(fmt('debug', msg, meta)),
  info: (msg, meta) => LEVELS.info >= minLevel && console.info(fmt('info', msg, meta)),
  warn: (msg, meta) => LEVELS.warn >= minLevel && console.warn(fmt('warn', msg, meta)),
  error: (msg, meta) => LEVELS.error >= minLevel && console.error(fmt('error', msg, meta))
};
