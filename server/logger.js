/**
 * Minimal structured logger: one JSON object per line, level-filtered.
 * Callers pass an event name and small plain fields, never request bodies or keys.
 */
import { LOG_LEVELS } from './config.js';

/** @typedef {'debug'|'info'|'warn'|'error'|'silent'} LogLevel */
/** @typedef {(event: string, fields?: Record<string, unknown>) => void} LogFn */

/**
 * @param {string} name
 * @returns {number} numeric severity; unknown names count as info
 */
const rank = (name) => LOG_LEVELS.get(name) ?? /** @type {number} */ (LOG_LEVELS.get('info'));

/**
 * Write one line to stdout (info and below) or stderr (warn and above).
 * @param {LogLevel} level
 * @param {string} line
 */
function defaultWrite(level, line) {
  const stream = rank(level) >= rank('warn') ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

/**
 * Create a logger.
 * @param {{write?: (level: LogLevel, line: string) => void, level?: () => string}} [options]
 * @returns {{debug: LogFn, info: LogFn, warn: LogFn, error: LogFn}}
 */
export function createLogger({ write = defaultWrite, level = () => process.env.LOG_LEVEL ?? 'info' } = {}) {
  /** @param {LogLevel} name */
  const emit =
    (name) =>
    /** @param {string} event @param {Record<string, unknown>} [fields] */
    (event, fields = {}) => {
      if (rank(name) < rank(level())) return;
      write(name, JSON.stringify({ time: new Date().toISOString(), level: name, event, ...fields }));
    };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

export const logger = createLogger();
