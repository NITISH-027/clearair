// Browser-side calls to the ClearAir server. Every call has a timeout and
// turns failures into Error objects with a readable message.

const TIMEOUT_MS = 100000; // the server may retry the AI service with backoff

async function request(url, init = {}) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* handled below */
  }
  if (!response.ok) throw new Error(data?.message ?? 'Something went wrong. Please try again.');
  return data;
}

export async function fetchConfig() {
  try {
    return await request('/api/config');
  } catch {
    return { aiEnabled: false };
  }
}

/** POST /api/plan with { city | lat+lon | aqi, profile, notes?, useAi? }. */
export function fetchPlan(payload) {
  return request('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
