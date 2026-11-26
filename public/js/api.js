// Browser-side calls to the ClearAir server. Every call has a timeout and
// turns failures into Error objects with a readable message.

const TIMEOUT_MS = 12000;

async function request(url, init = {}) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error('Could not reach the server. Check your connection, or enter the AQI yourself.');
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

export function fetchAirByCity(city) {
  return request(`/api/air?${new URLSearchParams({ city })}`);
}

export function fetchAirByCoords(lat, lon) {
  return request(`/api/air?${new URLSearchParams({ lat: String(lat), lon: String(lon) })}`);
}

export async function fetchConfig() {
  try {
    return await request('/api/config');
  } catch {
    return { aiAvailable: false };
  }
}

export function fetchExplanation(payload) {
  return request('/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
