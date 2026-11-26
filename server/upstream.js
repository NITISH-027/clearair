import { withRetry } from './retry.js';

/** Failure talking to a third-party service. `kind` is timeout, network, status or parse. */
export class UpstreamError extends Error {
  constructor(kind, status = 0) {
    super(`Upstream ${kind}${status ? ` ${status}` : ''}`);
    this.name = 'UpstreamError';
    this.kind = kind;
    this.status = status;
  }

  get retryable() {
    return this.kind === 'timeout' || this.kind === 'network' || this.status === 429 || this.status >= 500;
  }
}

/** Fetch JSON with a timeout. Never includes request headers or URLs in errors. */
export async function fetchJson(fetchImpl, url, init = {}, timeoutMs = 8000) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new UpstreamError(err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'network');
  }
  if (!response.ok) throw new UpstreamError('status', response.status);
  try {
    return await response.json();
  } catch {
    throw new UpstreamError('parse');
  }
}

/** fetchJson with exponential backoff on timeouts, network errors, 429 and 5xx. */
export function fetchJsonWithRetry(fetchImpl, url, init, { timeoutMs, attempts = 2, sleep, random } = {}) {
  return withRetry(() => fetchJson(fetchImpl, url, init, timeoutMs), {
    attempts,
    sleep,
    random,
    isRetryable: (err) => err instanceof UpstreamError && err.retryable,
  });
}
