import { aqiToPm25 } from '../shared/aqi.js';
import { looksLikeInjection, sanitizeLabel } from '../shared/sanitize.js';
import { HttpError } from './http.js';
import { fetchJsonWithRetry } from './upstream.js';

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export const AIR_SOURCE = 'Open-Meteo Air Quality (CAMS model, US AQI)';

/** Reduce an Open-Meteo hourly block to the next 24 valid points from `currentTime`. */
export function pickHourly(hourly, currentTime) {
  const times = hourly?.time;
  const pm = hourly?.pm2_5;
  const aqi = hourly?.us_aqi;
  if (!Array.isArray(times) || !Array.isArray(pm) || !Array.isArray(aqi)) return [];
  return times
    .map((time, i) => ({ time, pm25: pm.at(i), aqi: aqi.at(i) }))
    .filter((p) => typeof p.time === 'string' && p.time >= currentTime && Number.isFinite(p.pm25) && Number.isFinite(p.aqi))
    .slice(0, 24);
}

/** Place names come from a third party, so treat them as untrusted text. */
function safeLabel(value) {
  const label = sanitizeLabel(String(value ?? ''));
  return looksLikeInjection(label) ? '' : label;
}

/** fetchJsonWithRetry only ever fails with an UpstreamError. */
function upstreamFailure(fallbackMessage) {
  return new HttpError(502, 'upstream_error', fallbackMessage);
}

async function resolvePlace(deps, location) {
  if (location.city) {
    const url = `${GEOCODE_URL}?${new URLSearchParams({ name: location.city, count: '1', language: 'en', format: 'json' })}`;
    let data;
    try {
      data = await fetchJsonWithRetry(deps.fetchImpl, url, {}, deps.retry);
    } catch {
      throw upstreamFailure('The place lookup service did not respond.');
    }
    const hit = data?.results?.[0];
    if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) {
      throw new HttpError(404, 'place_not_found', 'We could not find that place. Try a nearby city.');
    }
    return {
      name: safeLabel(hit.name) || 'Your area',
      region: safeLabel(hit.admin1),
      country: safeLabel(hit.country),
      lat: hit.latitude,
      lon: hit.longitude,
    };
  }
  return { name: 'Your location', region: '', country: '', lat: location.lat, lon: location.lon };
}

async function fetchLiveAir(deps, location) {
  const place = await resolvePlace(deps, location);
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: 'us_aqi,pm2_5,pm10',
    hourly: 'us_aqi,pm2_5',
    forecast_days: '2',
    timezone: 'auto',
  });
  let data;
  try {
    data = await fetchJsonWithRetry(deps.fetchImpl, `${AIR_URL}?${params}`, {}, deps.retry);
  } catch {
    throw upstreamFailure('The air quality service did not respond.');
  }
  const cur = data?.current;
  if (!cur || !Number.isFinite(cur.us_aqi) || !Number.isFinite(cur.pm2_5) || typeof cur.time !== 'string') {
    throw new HttpError(502, 'no_reading', 'No current air quality reading for that place.');
  }
  return {
    place,
    current: { aqi: Math.round(cur.us_aqi), pm25: cur.pm2_5, pm10: Number.isFinite(cur.pm10) ? cur.pm10 : null, time: cur.time },
    hourly: pickHourly(data.hourly, cur.time),
    source: 'live',
    dataSource: AIR_SOURCE,
  };
}

function cacheKey(location) {
  if (location.city) return `c:${location.city.toLowerCase()}`;
  return `p:${location.lat.toFixed(2)},${location.lon.toFixed(2)}`;
}

/**
 * Load air quality for a validated location: { aqi } (manual), { city } or { lat, lon }.
 * Live results are cached; manual readings are computed directly.
 */
export function loadAir(deps, location) {
  if (location.aqi !== undefined) {
    return Promise.resolve({
      place: null,
      current: { aqi: location.aqi, pm25: aqiToPm25(location.aqi), pm10: null, time: null },
      hourly: [],
      source: 'manual',
      dataSource: 'Entered by you',
    });
  }
  return deps.airCache.getOrLoad(cacheKey(location), () => fetchLiveAir(deps, location));
}
