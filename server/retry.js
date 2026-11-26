/**
 * Retry with exponential backoff and jitter.
 */
import { RETRY_ATTEMPTS, RETRY_BASE_MS, RETRY_JITTER_FLOOR, RETRY_MAX_MS } from './config.js';

/**
 * Delay for attempt i is base * 2^i, capped, then jittered to 50-100%.
 * @param {number} attempt zero-based attempt index
 * @param {{baseMs?: number, maxMs?: number, random?: () => number}} [options]
 * @returns {number} milliseconds
 */
export function backoffDelay(attempt, { baseMs = RETRY_BASE_MS, maxMs = RETRY_MAX_MS, random = Math.random } = {}) {
  const raw = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(raw * (RETRY_JITTER_FLOOR + random() * (1 - RETRY_JITTER_FLOOR)));
}

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @typedef {object} RetryOptions
 * @property {number} [attempts]
 * @property {(err: unknown) => boolean} [isRetryable]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {number} [baseMs]
 * @property {number} [maxMs]
 * @property {() => number} [random]
 */

/**
 * @param {RetryOptions} options
 * @returns {{attempts: number, isRetryable: (err: unknown) => boolean, sleep: (ms: number) => Promise<void>, delayOptions: object}}
 */
function withDefaults({ attempts = RETRY_ATTEMPTS, isRetryable = () => true, sleep = defaultSleep, ...delayOptions }) {
  return { attempts, isRetryable, sleep, delayOptions };
}

/**
 * Run `fn(attemptIndex)` up to `attempts` times, retrying only errors that
 * `isRetryable` accepts.
 * @template T
 * @param {(attempt: number) => Promise<T>} fn
 * @param {RetryOptions} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, options = {}) {
  const { attempts, isRetryable, sleep, delayOptions } = withDefaults(options);
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === attempts - 1 || !isRetryable(err)) break;
      await sleep(backoffDelay(attempt, delayOptions));
    }
  }
  throw lastError;
}
