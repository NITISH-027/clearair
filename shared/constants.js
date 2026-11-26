/**
 * Domain constants shared by the browser and the server: AQI breakpoints,
 * exposure-model coefficients, validation limits and planner thresholds.
 * Every number here has a unit or a source in its comment.
 */

/** US EPA PM2.5 AQI breakpoints (2024 revision). cLow/cHigh in ug/m3 (24 h), iLow/iHigh are AQI points. */
export const PM25_BREAKPOINTS = Object.freeze([
  { cLow: 0.0, cHigh: 9.0, iLow: 0, iHigh: 50 },
  { cLow: 9.1, cHigh: 35.4, iLow: 51, iHigh: 100 },
  { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150 },
  { cLow: 55.5, cHigh: 125.4, iLow: 151, iHigh: 200 },
  { cLow: 125.5, cHigh: 225.4, iLow: 201, iHigh: 300 },
  { cLow: 225.5, cHigh: 325.4, iLow: 301, iHigh: 500 },
]);

/** Highest PM2.5 value (ug/m3) the EPA table covers. */
export const PM25_TABLE_MAX = 325.4;
/** Highest AQI value on the EPA scale. */
export const AQI_MAX = 500;

/** US EPA AQI categories. `max` is the inclusive upper AQI bound. */
export const CATEGORIES = Object.freeze([
  { index: 0, label: 'Good', max: 50 },
  { index: 1, label: 'Moderate', max: 100 },
  { index: 2, label: 'Unhealthy for sensitive groups', max: 150 },
  { index: 3, label: 'Unhealthy', max: 200 },
  { index: 4, label: 'Very unhealthy', max: 300 },
  { index: 5, label: 'Hazardous', max: 500 },
]);

/** Category indexes the planner reasons about. */
export const LEVEL = Object.freeze({ MODERATE: 1, SENSITIVE: 2, UNHEALTHY: 3 });

/** Decimal places used when rounding concentrations: one place, as a multiplier. */
export const ONE_DECIMAL = 10;

export const WHO_24H_GUIDELINE = 15; // ug/m3, WHO Global Air Quality Guidelines 2021

/** Representative adult inhalation rates (m3/h), ranges from EPA Exposure Factors Handbook ch. 6. */
export const BREATHING = Object.freeze({ sleep: 0.3, rest: 0.5, light: 1.0, moderate: 2.0 });

/** Home mass-balance coefficients (Riley 2002; Wallace 1996; Chen and Zhao 2011). */
export const HOME = Object.freeze({
  roomVolume: 40, // m3, a 15 m2 room at 2.7 m
  airChanges: Object.freeze({ open: 2.0, closed: 0.5 }), // 1/h, windows open or shut
  penetration: 0.8, // fraction of outdoor particles that pass the envelope
  deposition: 0.2, // 1/h
  defaultCadr: 200, // m3/h, a typical small-room HEPA unit
  purifierCoverage: 0.7, // share of indoor hours spent in the room that has the purifier
  sleepHours: 8, // h/day
});

/** Kitchen compartment (WHO indoor air quality guidelines 2014; Smith et al. 2014). */
export const KITCHEN = Object.freeze({
  volume: 15, // m3
  airChanges: Object.freeze({ normal: 5, fan: 15 }), // 1/h, without and with an exhaust fan
  cookingHours: 2, // h/day
  emission: Object.freeze({ biomass: 46800, lpg: 3000, induction: 600, electric: 600 }), // ug/h
});

/** Half-mask protection factor, halved for imperfect fit (OSHA 29 CFR 1910.134 Table 1 gives 10). */
export const MASK = Object.freeze({ assignedProtectionFactor: 5 });

/**
 * Commute microenvironments. `ratio` is in-vehicle concentration relative to
 * ambient, `rate` the inhalation rate in m3/h (Kaur et al. 2007, Atmos Environ 41:4781).
 */
export const MODES = Object.freeze({
  wfh: { ratio: 0, rate: BREATHING.rest, open: false },
  walk: { ratio: 1.0, rate: 1.2, open: true },
  cycle: { ratio: 1.0, rate: 2.0, open: true },
  twowheeler: { ratio: 1.1, rate: 0.9, open: true },
  bus: { ratio: 0.9, rate: 0.7, open: true },
  metro: { ratio: 0.7, rate: 0.9, open: false },
  car: { ratio: 0.6, rate: 0.6, open: false },
});

/** Hours in a day, used to size the "awake indoors" slice of the exposure model. */
export const HOURS_PER_DAY = 24;

/** Where the hour sits in an ISO local time (YYYY-MM-DDTHH:mm), and the 12-hour clock pivot. */
export const HOUR_SLICE = Object.freeze({ start: 11, end: 13 });
export const NOON_HOUR = 12;

/** Cleanest-window search: local hours (inclusive) and window length in hours. */
export const BEST_WINDOW = Object.freeze({ firstHour: 6, lastHour: 20, lengthHours: 2 });
export const MS_PER_HOUR = 3_600_000;

/** Allowed values and numeric limits for the household profile form. */
export const COMMUTE_MODES = Object.freeze(['wfh', 'walk', 'cycle', 'twowheeler', 'bus', 'metro', 'car']);
export const COOKING_TYPES = Object.freeze(['lpg', 'induction', 'electric', 'biomass']);
export const WINDOW_STATES = Object.freeze(['open', 'closed']);
export const LIMITS = Object.freeze({
  commuteHours: { min: 0, max: 6 },
  exerciseHours: { min: 0, max: 4 },
  cadr: { min: 20, max: 1000 }, // m3/h
  aqi: { min: 0, max: AQI_MAX },
  lat: { min: -90, max: 90 },
  lon: { min: -180, max: 180 },
});
export const CITY_PATTERN = /^[\p{L}\p{M}0-9 .,'()-]{1,80}$/u;

/** One-line headline per effective category level, index 0 to 5. */
export const LEVEL_SUMMARIES = Object.freeze([
  'The air is clean. Enjoy the outdoors and keep up your good habits.',
  'The air is acceptable for most people. A few easy habits keep it that way.',
  'Sensitive groups should cut back on heavy outdoor activity today.',
  'Everyone can feel effects. Reduce time outside and clean your indoor air.',
  'This is a smog emergency for most people. Stay in and filter your indoor air.',
  'Hazardous air. Stay indoors with the cleanest air you can make and avoid any exertion.',
]);
export const SENSITIVE_NOTE = ' Your household includes sensitive members, so we use stricter advice.';
export const EXPOSURE_UNIT = 'ug of PM2.5 inhaled per day';

/** Prompt-injection screening: how many words after a command word still count as its target. */
export const INJECTION_WINDOW = 4;
export const NOTES_MAX = 200;
export const LABEL_MAX = 60;
