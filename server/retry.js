/** Exponential backoff with jitter. Delay for attempt i is base * 2^i, capped, then jittered to 50-100%. */
export function backoffDelay(attempt, { baseMs = 300, maxMs = 2000, random = Math.random } = {}) {
  const raw = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(raw * (0.5 + random() * 0.5));
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn(attemptIndex)` up to `attempts` times, retrying only errors that
 * `isRetryable` accepts.
 */
export async function withRetry(fn, { attempts = 3, isRetryable = () => true, sleep = defaultSleep, ...delayOptions } = {}) {
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
