/**
 * Air quality loading: place lookup, live Open-Meteo readings, manual AQI
 * readings and the response cache that sits in front of them.
 */
import { aqiToPm25 } from '../shared/aqi.js';
import { looksLikeInjection, sanitizeLabel } from '../shared/sanitize.js';
import {
  AIR_FORECAST_DAYS,
  AIR_HOURLY_POINTS,
  AIR_SOURCE,
  AIR_URL,
  COORDS_PLACE_NAME,
  GEOCODE_URL,
  MANUAL_SOURCE,
  PLACE_FALLBACK_NAME,
} from './config.js';
import { NotFoundError, UpstreamApiError } from './errors.js';
import { fetchJsonWithRetry } from './upstream.js';

/**
 * @typedef {object} AirDeps
 * @property {typeof fetch} fetchImpl
 * @property {import('./cache.js').TtlCache} airCache
 * @property {import('./retry.js').RetryOptions} retry
 */
/** @typedef {{name: string, region: string, country: string, lat: number, lon: number}} Place */

/**
 * Reduce an Open-Meteo hourly block to the next 24 valid points from `currentTime`.
 * @param {{time?: string[], pm2_5?: number[], us_aqi?: number[]}} hourly
 * @param {string} currentTime
 * @returns {Array<{time: string, pm25: number, aqi: number}>}
 */
export function pickHourly(hourly, currentTime) {
  const times = hourly?.time;
  const pm = hourly?.pm2_5;
  const aqi = hourly?.us_aqi;
  if (!Array.isArray(times) || !Array.isArray(pm) || !Array.isArray(aqi)) return [];
  return /** @type {Array<{time: string, pm25: number, aqi: number}>} */ (
    times
      .map((time, i) => ({ time, pm25: pm.at(i), aqi: aqi.at(i) }))
      .filter((p) => typeof p.time === 'string' && p.time >= currentTime && Number.isFinite(p.pm25) && Number.isFinite(p.aqi))
      .slice(0, AIR_HOURLY_POINTS)
  ); // values are finite numbers after the filter above
}

/**
 * Place names come from a third party, so treat them as untrusted text.
 * @param {unknown} value
 * @returns {string}
 */
function safeLabel(value) {
  const label = sanitizeLabel(String(value ?? ''));
  return looksLikeInjection(label) ? '' : label;
}

/**
 * GET JSON from Open-Meteo, mapping any failure to an UpstreamApiError.
 * @param {AirDeps} deps
 * @param {string} url
 * @param {string} failureMessage
 * @returns {Promise<any>}
 */
async function getUpstream(deps, url, failureMessage) {
  try {
    return await fetchJsonWithRetry(deps.fetchImpl, url, deps.retry);
  } catch {
    throw new UpstreamApiError('upstream_error', failureMessage);
  }
}

/**
 * @param {any} hit first geocoder result
 * @returns {Place}
 */
function placeFromHit(hit) {
  return {
    name: safeLabel(hit.name) || PLACE_FALLBACK_NAME,
    region: safeLabel(hit.admin1),
    country: safeLabel(hit.country),
    lat: hit.latitude,
    lon: hit.longitude,
  };
}

/**
 * Look a city name up with the geocoder.
 * @param {AirDeps} deps
 * @param {string} city
 * @returns {Promise<Place>}
 */
async function geocodeCity(deps, city) {
  const query = new URLSearchParams({ name: city, count: '1', language: 'en', format: 'json' });
  const data = await getUpstream(deps, `${GEOCODE_URL}?${query}`, 'The place lookup service did not respond.');
  const hit = data?.results?.[0];
  if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) {
    throw new NotFoundError('place_not_found', 'We could not find that place. Try a nearby city.');
  }
  return placeFromHit(hit);
}

/**
 * @param {AirDeps} deps
 * @param {{city?: string, lat?: number, lon?: number}} location
 * @returns {Promise<Place>}
 */
function resolvePlace(deps, location) {
  if (location.city) return geocodeCity(deps, location.city);
  return Promise.resolve({
    name: COORDS_PLACE_NAME,
    region: '',
    country: '',
    lat: /** @type {number} */ (location.lat),
    lon: /** @type {number} */ (location.lon),
  });
}

/**
 * @param {any} cur the `current` block of an Open-Meteo response
 * @returns {boolean}
 */
const hasReading = (cur) => Boolean(cur) && Number.isFinite(cur.us_aqi) && Number.isFinite(cur.pm2_5) && typeof cur.time === 'string';

/**
 * @param {Place} place
 * @returns {string} Open-Meteo air quality URL
 */
function airUrl(place) {
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: 'us_aqi,pm2_5,pm10',
    hourly: 'us_aqi,pm2_5',
    forecast_days: AIR_FORECAST_DAYS,
    timezone: 'auto',
  });
  return `${AIR_URL}?${params}`;
}

/**
 * @param {AirDeps} deps
 * @param {{city?: string, lat?: number, lon?: number}} location
 */
async function fetchLiveAir(deps, location) {
  const place = await resolvePlace(deps, location);
  const data = await getUpstream(deps, airUrl(place), 'The air quality service did not respond.');
  const cur = data?.current;
  if (!hasReading(cur)) throw new UpstreamApiError('no_reading', 'No current air quality reading for that place.');
  return {
    place,
    current: { aqi: Math.round(cur.us_aqi), pm25: cur.pm2_5, pm10: Number.isFinite(cur.pm10) ? cur.pm10 : null, time: cur.time },
    hourly: pickHourly(data.hourly, cur.time),
    source: 'live',
    dataSource: AIR_SOURCE,
  };
}

/**
 * @param {{city?: string, lat?: number, lon?: number}} location
 * @returns {string}
 */
function cacheKey(location) {
  if (location.city) return `c:${location.city.toLowerCase()}`;
  return `p:${/** @type {number} */ (location.lat).toFixed(2)},${/** @type {number} */ (location.lon).toFixed(2)}`;
}

/**
 * Load air quality for a validated location: { aqi } (manual), { city } or { lat, lon }.
 * Live results are cached; manual readings are computed directly.
 * @param {AirDeps} deps
 * @param {{aqi?: number, city?: string, lat?: number, lon?: number}} location
 */
export function loadAir(deps, location) {
  if (location.aqi !== undefined) {
    return Promise.resolve({
      place: null,
      current: { aqi: location.aqi, pm25: aqiToPm25(location.aqi), pm10: null, time: null },
      hourly: [],
      source: 'manual',
      dataSource: MANUAL_SOURCE,
    });
  }
  return deps.airCache.getOrLoad(cacheKey(location), () => fetchLiveAir(deps, location));
}
