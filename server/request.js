import { validateAqi, validateCity, validateCoordinates, validateProfile } from '../shared/validate.js';
import { sanitizeNotes } from '../shared/sanitize.js';
import { HttpError } from './http.js';

const ALLOWED_KEYS = new Set(['city', 'lat', 'lon', 'aqi', 'profile', 'notes', 'useAi']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a POST /api/plan body. Throws HttpError(400) on anything wrong.
 * @returns {{location: object, profile: object, notes: {value:string, dropped:boolean}, useAi: boolean}}
 */
export function parsePlanRequest(body) {
  if (!isPlainObject(body)) throw new HttpError(400, 'bad_request', 'Body must be a JSON object.');
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) throw new HttpError(400, 'bad_request', `Unknown field: ${key.slice(0, 20)}`);
  }

  let location;
  if (body.aqi !== undefined && body.aqi !== null && body.aqi !== '') {
    const aqi = validateAqi(body.aqi);
    if (!aqi.ok) throw new HttpError(400, 'bad_aqi', aqi.error);
    location = { aqi: aqi.value };
  } else if (body.city !== undefined) {
    const city = validateCity(body.city);
    if (!city.ok) throw new HttpError(400, 'bad_city', city.error);
    location = { city: city.value };
  } else if (body.lat !== undefined || body.lon !== undefined) {
    const coords = validateCoordinates(body.lat, body.lon);
    if (!coords.ok) throw new HttpError(400, 'bad_coordinates', coords.error);
    location = coords.value;
  } else {
    throw new HttpError(400, 'missing_location', 'Give a city, coordinates or an AQI.');
  }

  const profile = validateProfile(body.profile);
  if (!profile.ok) throw new HttpError(400, 'bad_profile', profile.errors[0]);

  if (body.useAi !== undefined && typeof body.useAi !== 'boolean') throw new HttpError(400, 'bad_request', 'useAi must be true or false.');

  return {
    location,
    profile: profile.value,
    notes: sanitizeNotes(body.notes),
    useAi: body.useAi !== false,
  };
}
