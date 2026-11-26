/**
 * Daily PM2.5 inhalation model. Coefficients live in constants.js.
 */
//
// Inhaled mass (ug/day) = sum over microenvironments i of  C_i x V_i x t_i
//   C_i  PM2.5 concentration the person breathes in microenvironment i (ug/m3)
//   V_i  inhalation rate for the activity (m3/h)
//   t_i  hours spent there
// This is the standard time-weighted exposure framework (US EPA Exposure
// Factors Handbook, 2011; Klepeis et al. 2001, J Expo Anal Environ Epidemiol
// 11:231, the National Human Activity Pattern Survey).
//
// Indoor concentration uses the single-compartment mass balance
// (Riley et al. 2002, Environ Sci Technol 36:200; Wallace 1996, J Air Waste Manag Assoc 46:98; Chen & Zhao 2011,
// Atmos Environ 45:275):
//
//   C_in = (P * a * C_out + S / V_room) / (a + k + CADR / V_room)
//
//   P     penetration factor (fraction of particles that get through the envelope)
//   a     air exchange rate (1/h)
//   k     deposition loss rate (1/h)
//   CADR  clean air delivery rate of a portable HEPA purifier (m3/h, AHAM AC-1)
//   S     indoor source emission (ug/h), V_room room volume (m3)
//
// Cooking is a separate kitchen compartment: increment = S / (V_k * (a_k + k)).
// Masks use the inverse of the OSHA assigned protection factor: penetration =
// 1 / APF (29 CFR 1910.134 Table 1: APF 10 for a half-mask respirator). We use
// half of that protection (APF 5) because most untrained wearers do not get a
// perfect seal.
//
// Every number below is an assumption chosen from the ranges in the sources
// above. It is a comparison tool for choices, not a measurement of any person.

import { BREATHING, HOME, HOURS_PER_DAY, KITCHEN, MASK, MODES } from './constants.js';

/** @typedef {import('./types.js').ExposureContext} ExposureContext */
/** @typedef {import('./types.js').ExposureDetail} ExposureDetail */
/** @typedef {import('./types.js').ExposureFlags} ExposureFlags */
/** @typedef {import('./types.js').Profile} Profile */

/**
 * Steady-state indoor PM2.5 (ug/m3) from the mass-balance equation above.
 * @param {{outdoor: number, airChanges: number, cadr?: number, source?: number, volume?: number}} options
 * @returns {number}
 */
export function indoorConcentration({ outdoor, airChanges, cadr = 0, source = 0, volume = HOME.roomVolume }) {
  const loss = airChanges + HOME.deposition + cadr / volume;
  return (HOME.penetration * airChanges * outdoor + source / volume) / loss;
}

/**
 * Indoor concentration for the home, blending the purifier room and the rest.
 * @param {number} pm25
 * @param {Profile} profile
 * @param {ExposureFlags} flags
 * @returns {number}
 */
function homeConcentration(pm25, profile, flags) {
  const closed = flags.windowsClosed || profile.home.windows === 'closed';
  const airChanges = closed ? HOME.airChanges.closed : HOME.airChanges.open;
  const plain = indoorConcentration({ outdoor: pm25, airChanges });
  if (!(flags.purifier || profile.home.purifier)) return plain;
  const cadr = profile.home.purifierCadr || HOME.defaultCadr;
  const filtered = indoorConcentration({ outdoor: pm25, airChanges, cadr });
  return HOME.purifierCoverage * filtered + (1 - HOME.purifierCoverage) * plain;
}

/**
 * Extra PM2.5 (ug/m3) in the kitchen while cooking.
 * @param {Profile} profile
 * @param {ExposureFlags} flags
 * @returns {number}
 */
function kitchenIncrement(profile, flags) {
  const source = flags.cleanCooking
    ? KITCHEN.emission.induction
    : (/** @type {Record<string, number>} */ (KITCHEN.emission)[profile.home.cooking] ?? 0);
  const airChanges = flags.cookingVent ? KITCHEN.airChanges.fan : KITCHEN.airChanges.normal;
  return source / (KITCHEN.volume * (airChanges + HOME.deposition));
}

/**
 * Concentration breathed during outdoor exercise under the what-if flags.
 * @param {ExposureContext} ctx
 * @param {ExposureFlags} flags
 * @param {number} indoor
 * @returns {number}
 */
function exerciseConcentration(ctx, flags, indoor) {
  if (flags.exerciseIndoors) return indoor;
  const best = typeof ctx.bestPm25 === 'number' && Number.isFinite(ctx.bestPm25) ? ctx.bestPm25 : null;
  return flags.shiftExercise && best !== null ? Math.min(ctx.pm25, best) : ctx.pm25;
}

/**
 * One slice of the day.
 * @param {number} conc ug/m3
 * @param {number} rate m3/h
 * @param {number} hours h
 */
const segment = (conc, rate, hours) => ({ conc, rate, hours });

/**
 * The day as time-weighted segments.
 * @param {ExposureContext} ctx
 * @param {ExposureFlags} flags
 * @param {{home: number, kitchen: number}} indoor
 */
function daySegments(ctx, flags, indoor) {
  const { pm25, profile } = ctx;
  const mode = /** @type {Record<string, typeof MODES.wfh>} */ (MODES)[profile.commute.mode] ?? MODES.wfh;
  const commuteHours = profile.commute.hours;
  const exerciseHours = profile.exercise.outdoorHours;
  const penetration = flags.mask && mode.open ? 1 / MASK.assignedProtectionFactor : 1;
  const awake = HOURS_PER_DAY - HOME.sleepHours - KITCHEN.cookingHours - commuteHours - exerciseHours;
  return [
    segment(indoor.home, BREATHING.sleep, HOME.sleepHours),
    segment(indoor.home + indoor.kitchen, BREATHING.light, KITCHEN.cookingHours),
    segment(pm25 * mode.ratio * penetration, mode.rate, commuteHours),
    segment(exerciseConcentration(ctx, flags, indoor.home), BREATHING.moderate, exerciseHours),
    segment(indoor.home, BREATHING.rest, Math.max(0, awake)),
  ].filter((part) => part.hours > 0);
}

/**
 * Detailed daily exposure.
 * @param {ExposureContext} ctx
 * @param {ExposureFlags} [flags] what-if actions: mask, windowsClosed, purifier,
 *   exerciseIndoors, shiftExercise, cleanCooking, cookingVent
 * @returns {ExposureDetail}
 */
export function exposureDetail(ctx, flags = {}) {
  const home = homeConcentration(ctx.pm25, ctx.profile, flags);
  const parts = daySegments(ctx, flags, { home, kitchen: kitchenIncrement(ctx.profile, flags) });
  const dose = parts.reduce((sum, p) => sum + p.conc * p.rate * p.hours, 0);
  const volume = parts.reduce((sum, p) => sum + p.rate * p.hours, 0);
  return { dose, volume, meanConcentration: volume > 0 ? dose / volume : 0, indoorConcentration: home };
}

/**
 * Percent reduction from `before` to `after`, rounded, never negative.
 * @param {number} before
 * @param {number} after
 * @returns {number}
 */
export function percentReduction(before, after) {
  if (before > 0) return Math.max(0, Math.round(((before - after) / before) * 100));
  return 0;
}
