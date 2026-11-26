import { withRetry } from './retry.js';

/** Failure talking to a third-party service. `kind` is timeout, network, status or parse. */
export class UpstreamError extends Error {
  constructor(kind, status = 0, detail = '') {
    super(`Upstream ${kind}${status ? ` ${status}` : ''}`);
    this.detail = detail;
    this.name = 'UpstreamError';
    this.kind = kind;
    this.status = status;
  }

  get retryable() {
    return this.kind === 'timeout' || this.kind === 'network' || this.status === 429 || this.status >= 500;
  }
}

/** Short, single-line error message from a JSON error body (Google APIs use error.message). Never contains headers. */
async function readErrorDetail(response) {
  try {
    const message = (await response.json())?.error?.message;
    return typeof message === 'string' ? message.replace(/\s+/g, ' ').slice(0, 160) : '';
  } catch {
    return '';
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
  if (!response.ok) throw new UpstreamError('status', response.status, await readErrorDetail(response));
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
