/**
 * Validation of the POST /api/plan body. Throws ValidationError on anything wrong.
 */
import { validateAqi, validateCity, validateCoordinates, validateProfile } from '../shared/validate.js';
import { sanitizeNotes } from '../shared/sanitize.js';
import { ValidationError } from './errors.js';
import { isPlainObject } from '../shared/util.js';

const ALLOWED_KEYS = new Set(['city', 'lat', 'lon', 'aqi', 'profile', 'notes', 'useAi']);
const MAX_KEY_ECHO = 20;

/**
 * @typedef {object} PlanRequest
 * @property {{aqi?: number, city?: string, lat?: number, lon?: number}} location
 * @property {import('../shared/types.js').Profile} profile
 * @property {{value: string, dropped: boolean}} notes
 * @property {boolean} useAi
 */

/**
 * @param {{ok: boolean, value?: *, error?: string}} checked
 * @param {string} code
 * @returns {*} the validated value
 */
function unwrap(checked, code) {
  if (!checked.ok) throw new ValidationError(code, /** @type {string} */ (checked.error));
  return checked.value;
}

/**
 * Pick the location: a manual AQI, a city or coordinates, in that order.
 * @param {Record<string, unknown>} body
 * @returns {object}
 */
function parseLocation(body) {
  if (body.aqi !== undefined && body.aqi !== null && body.aqi !== '') {
    return { aqi: unwrap(validateAqi(body.aqi), 'bad_aqi') };
  }
  if (body.city !== undefined) return { city: unwrap(validateCity(body.city), 'bad_city') };
  if (body.lat !== undefined || body.lon !== undefined) {
    return unwrap(validateCoordinates(body.lat, body.lon), 'bad_coordinates');
  }
  throw new ValidationError('missing_location', 'Give a city, coordinates or an AQI.');
}

/**
 * @param {Record<string, unknown>} body
 * @returns {import('../shared/types.js').Profile} the validated profile
 */
function parseProfile(body) {
  const profile = validateProfile(body.profile);
  if (!profile.ok) throw new ValidationError('bad_profile', profile.errors[0]);
  return /** @type {import('../shared/types.js').Profile} */ (profile.value);
}

/**
 * @param {Record<string, unknown>} body
 */
function assertKnownKeys(body) {
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) throw new ValidationError('bad_request', `Unknown field: ${key.slice(0, MAX_KEY_ECHO)}`);
  }
}

/**
 * Validate a POST /api/plan body.
 * @param {unknown} body
 * @returns {PlanRequest}
 */
export function parsePlanRequest(body) {
  if (!isPlainObject(body)) throw new ValidationError('bad_request', 'Body must be a JSON object.');
  assertKnownKeys(body);
  const location = parseLocation(body);
  const profile = parseProfile(body);
  if (body.useAi !== undefined && typeof body.useAi !== 'boolean') {
    throw new ValidationError('bad_request', 'useAi must be true or false.');
  }
  return { location, profile, notes: sanitizeNotes(body.notes), useAi: body.useAi !== false };
}
