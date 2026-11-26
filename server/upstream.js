/**
 * Fetch JSON from third-party services with a timeout and bounded retries.
 * Errors never include request headers or URLs.
 */
import { ERROR_DETAIL_MAX, UPSTREAM_ATTEMPTS, UPSTREAM_TIMEOUT_MS } from './config.js';
import { UpstreamError } from './errors.js';
import { withRetry } from './retry.js';

/**
 * Short, single-line error message from a JSON error body (Google APIs use error.message).
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function readErrorDetail(response) {
  try {
    const message = (await response.json())?.error?.message;
    return typeof message === 'string' ? message.replace(/\s+/g, ' ').slice(0, ERROR_DETAIL_MAX) : '';
  } catch {
    return '';
  }
}

/**
 * @param {any} err
 * @returns {boolean}
 */
const isTimeout = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError';

/**
 * @typedef {object} FetchOptions
 * @property {RequestInit} [init]
 * @property {number} [timeoutMs]
 */

/**
 * Fetch JSON with a timeout.
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {FetchOptions} [options]
 * @returns {Promise<any>}
 */
export async function fetchJson(fetchImpl, url, { init = {}, timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new UpstreamError(isTimeout(err) ? 'timeout' : 'network');
  }
  if (!response.ok) throw new UpstreamError('status', response.status, await readErrorDetail(response));
  try {
    return await response.json();
  } catch {
    throw new UpstreamError('parse');
  }
}

/**
 * fetchJson with exponential backoff on timeouts, network errors, 429 and 5xx.
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {FetchOptions & import('./retry.js').RetryOptions} [options]
 * @returns {Promise<any>}
 */
export function fetchJsonWithRetry(fetchImpl, url, { init, timeoutMs, attempts = UPSTREAM_ATTEMPTS, sleep, random } = {}) {
  return withRetry(() => fetchJson(fetchImpl, url, { init, timeoutMs }), {
    attempts,
    sleep,
    random,
    isRetryable: (err) => err instanceof UpstreamError && err.retryable,
  });
}
