// Input validation shared by the browser and the server. Everything that
// crosses a trust boundary goes through here: unknown keys are dropped, enums
// are checked, numbers are range-limited and strings are trimmed and bounded.

export const COMMUTE_MODES = ['wfh', 'walk', 'cycle', 'twowheeler', 'bus', 'metro', 'car'];
export const COOKING_TYPES = ['lpg', 'induction', 'electric', 'biomass'];
export const WINDOW_STATES = ['open', 'closed'];

const CITY_PATTERN = /^[\p{L}\p{M}0-9 .,'()-]{1,80}$/u;

function toBool(value) {
  return value === true || value === 'true' || value === 'on';
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate a city search string. Returns { ok, value, error }. */
export function validateCity(input) {
  if (typeof input !== 'string') return { ok: false, error: 'City must be text.' };
  const value = input.trim().replace(/\s+/g, ' ');
  if (!value) return { ok: false, error: 'Enter a city or area name.' };
  if (!CITY_PATTERN.test(value)) {
    return { ok: false, error: 'City can only contain letters, numbers, spaces and . , \' ( ) -' };
  }
  return { ok: true, value };
}

/** Validate a coordinate pair. Returns { ok, value: {lat, lon}, error }. */
export function validateCoordinates(lat, lon) {
  const la = toNumber(lat);
  const lo = toNumber(lon);
  if (!Number.isFinite(la) || la < -90 || la > 90) return { ok: false, error: 'Latitude must be between -90 and 90.' };
  if (!Number.isFinite(lo) || lo < -180 || lo > 180) return { ok: false, error: 'Longitude must be between -180 and 180.' };
  return { ok: true, value: { lat: la, lon: lo } };
}

/**
 * Validate a household profile. Returns { ok, value, errors }.
 * `value` only contains known keys with normalised types.
 */
export function validateProfile(input) {
  const errors = [];
  if (!isPlainObject(input)) return { ok: false, errors: ['Profile must be an object.'] };

  const household = isPlainObject(input.household) ? input.household : {};
  const commute = isPlainObject(input.commute) ? input.commute : {};
  const exercise = isPlainObject(input.exercise) ? input.exercise : {};
  const home = isPlainObject(input.home) ? input.home : {};

  const mode = commute.mode ?? 'wfh';
  if (!COMMUTE_MODES.includes(mode)) errors.push('Choose a valid commute mode.');

  let hours = commute.hours === undefined ? 0 : toNumber(commute.hours);
  if (!Number.isFinite(hours) || hours < 0 || hours > 6) {
    errors.push('Commute hours must be between 0 and 6.');
    hours = 0;
  }

  let outdoorHours = exercise.outdoorHours === undefined ? 0 : toNumber(exercise.outdoorHours);
  if (!Number.isFinite(outdoorHours) || outdoorHours < 0 || outdoorHours > 4) {
    errors.push('Outdoor exercise hours must be between 0 and 4.');
    outdoorHours = 0;
  }

  const windows = home.windows ?? 'open';
  if (!WINDOW_STATES.includes(windows)) errors.push('Windows must be open or closed.');

  const cooking = home.cooking ?? 'lpg';
  if (!COOKING_TYPES.includes(cooking)) errors.push('Choose a valid cooking fuel.');

  const purifier = toBool(home.purifier);
  let purifierCadr = 0;
  if (purifier) {
    purifierCadr = home.purifierCadr === undefined || home.purifierCadr === '' ? 200 : toNumber(home.purifierCadr);
    if (!Number.isFinite(purifierCadr) || purifierCadr < 20 || purifierCadr > 1000) {
      errors.push('Purifier CADR must be between 20 and 1000 m3/h.');
      purifierCadr = 200;
    }
  }

  const value = {
    household: {
      children: toBool(household.children),
      elderly: toBool(household.elderly),
      respiratory: toBool(household.respiratory),
      pregnant: toBool(household.pregnant),
    },
    commute: { mode: mode === 'wfh' ? 'wfh' : mode, hours: mode === 'wfh' ? 0 : hours },
    exercise: { outdoorHours },
    home: { windows, purifier, purifierCadr, cooking },
  };
  return { ok: errors.length === 0, value, errors };
}

/** Validate an optional manual AQI override (0-500). */
export function validateAqi(input) {
  const aqi = toNumber(input);
  if (!Number.isFinite(aqi) || aqi < 0 || aqi > 500) return { ok: false, error: 'AQI must be between 0 and 500.' };
  return { ok: true, value: Math.round(aqi) };
}
