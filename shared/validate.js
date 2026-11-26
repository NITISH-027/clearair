/**
 * Input validation shared by the browser and the server. Everything that
 * crosses a trust boundary goes through here: unknown keys are dropped, enums
 * are checked, numbers are range-limited and strings are trimmed and bounded.
 */
import { CITY_PATTERN, COMMUTE_MODES, COOKING_TYPES, HOME, LIMITS, WINDOW_STATES } from './constants.js';
import { isPlainObject } from './util.js';

/** @typedef {{ok: boolean, value?: *, error?: string}} Checked */
/** @typedef {{min: number, max: number}} Range */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function toBool(value) {
  return value === true || value === 'true' || value === 'on';
}

/**
 * @param {unknown} value
 * @returns {number} NaN when the value is not numeric
 */
function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

/**
 * @param {number} value
 * @param {Range} range
 * @returns {boolean}
 */
const inRange = (value, range) => Number.isFinite(value) && value >= range.min && value <= range.max;

/**
 * Validate a city search string.
 * @param {unknown} input
 * @returns {Checked}
 */
export function validateCity(input) {
  if (typeof input !== 'string') return { ok: false, error: 'City must be text.' };
  const value = input.trim().replace(/\s+/g, ' ');
  if (!value) return { ok: false, error: 'Enter a city or area name.' };
  if (!CITY_PATTERN.test(value)) {
    return { ok: false, error: "City can only contain letters, numbers, spaces and . , ' ( ) -" };
  }
  return { ok: true, value };
}

/**
 * Validate a coordinate pair.
 * @param {unknown} lat
 * @param {unknown} lon
 * @returns {Checked}
 */
export function validateCoordinates(lat, lon) {
  const la = toNumber(lat);
  const lo = toNumber(lon);
  if (!inRange(la, LIMITS.lat)) return { ok: false, error: 'Latitude must be between -90 and 90.' };
  if (!inRange(lo, LIMITS.lon)) return { ok: false, error: 'Longitude must be between -180 and 180.' };
  return { ok: true, value: { lat: la, lon: lo } };
}

/**
 * Read a bounded number. An invalid value records `message` and uses `fallback`.
 * @param {{raw: unknown, range: Range, fallback: number, message: string}} spec
 * @param {string[]} errors
 * @returns {number}
 */
function boundedNumber({ raw, range, fallback, message }, errors) {
  const value = raw === undefined ? fallback : toNumber(raw);
  if (inRange(value, range)) return value;
  errors.push(message);
  return fallback;
}

/**
 * Read an enum value, recording `message` when it is not allowed.
 * @param {{raw: any, fallback: string, allowed: readonly string[], message: string}} spec
 * @param {string[]} errors
 * @returns {string}
 */
function enumValue({ raw, fallback, allowed, message }, errors) {
  const value = raw ?? fallback;
  if (!allowed.includes(value)) errors.push(message);
  return value;
}

/**
 * Read the purifier CADR (m3/h). A blank value means the default.
 * @param {Record<string, any>} home
 * @param {string[]} errors
 * @returns {number}
 */
function readCadr(home, errors) {
  if (!toBool(home.purifier)) return 0;
  const raw = home.purifierCadr === '' ? undefined : home.purifierCadr;
  const message = 'Purifier CADR must be between 20 and 1000 m3/h.';
  return boundedNumber({ raw, range: LIMITS.cadr, fallback: HOME.defaultCadr, message }, errors);
}

/**
 * @param {unknown} section
 * @returns {Record<string, any>}
 */
const sectionOf = (section) => (isPlainObject(section) ? section : {});

/**
 * @param {Record<string, any>} commute
 * @param {string[]} errors
 * @returns {{mode: string, hours: number}}
 */
function readCommute(commute, errors) {
  const mode = enumValue({ raw: commute.mode, fallback: 'wfh', allowed: COMMUTE_MODES, message: 'Choose a valid commute mode.' }, errors);
  const message = 'Commute hours must be between 0 and 6.';
  const hours = boundedNumber({ raw: commute.hours, range: LIMITS.commuteHours, fallback: 0, message }, errors);
  return { mode, hours: mode === 'wfh' ? 0 : hours };
}

/**
 * @param {Record<string, any>} home
 * @param {string[]} errors
 * @returns {import('./types.js').Home}
 */
function readHome(home, errors) {
  const windows = enumValue(
    { raw: home.windows, fallback: 'open', allowed: WINDOW_STATES, message: 'Windows must be open or closed.' },
    errors,
  );
  const cooking = enumValue(
    { raw: home.cooking, fallback: 'lpg', allowed: COOKING_TYPES, message: 'Choose a valid cooking fuel.' },
    errors,
  );
  return { windows, purifier: toBool(home.purifier), purifierCadr: readCadr(home, errors), cooking };
}

/**
 * @param {Record<string, any>} household
 * @returns {import('./types.js').Household}
 */
const readHousehold = (household) => ({
  children: toBool(household.children),
  elderly: toBool(household.elderly),
  respiratory: toBool(household.respiratory),
  pregnant: toBool(household.pregnant),
});

/**
 * Validate a household profile. `value` only contains known keys with normalised types.
 * @param {unknown} input
 * @returns {{ok: boolean, value?: import('./types.js').Profile, errors: string[]}}
 */
export function validateProfile(input) {
  if (!isPlainObject(input)) return { ok: false, errors: ['Profile must be an object.'] };
  /** @type {string[]} */
  const errors = [];
  const exercise = sectionOf(input.exercise);
  const message = 'Outdoor exercise hours must be between 0 and 4.';
  const value = {
    household: readHousehold(sectionOf(input.household)),
    commute: readCommute(sectionOf(input.commute), errors),
    exercise: { outdoorHours: boundedNumber({ raw: exercise.outdoorHours, range: LIMITS.exerciseHours, fallback: 0, message }, errors) },
    home: readHome(sectionOf(input.home), errors),
  };
  return { ok: errors.length === 0, value, errors };
}

/**
 * Validate an optional manual AQI override.
 * @param {unknown} input
 * @returns {Checked}
 */
export function validateAqi(input) {
  const aqi = toNumber(input);
  if (!inRange(aqi, LIMITS.aqi)) return { ok: false, error: 'AQI must be between 0 and 500.' };
  return { ok: true, value: Math.round(aqi) };
}
