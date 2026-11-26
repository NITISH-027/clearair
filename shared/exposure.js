// A deliberately simple, transparent exposure model. It estimates a relative
// daily PM2.5 "dose" (concentration x hours x breathing rate) so the app can
// show how much each choice changes things. It is illustrative, not medical.

export const MODES = Object.freeze({
  wfh: { exposure: 0, breathing: 1, open: false },
  walk: { exposure: 1, breathing: 1.6, open: true },
  cycle: { exposure: 1, breathing: 2.4, open: true },
  twowheeler: { exposure: 1.1, breathing: 1.3, open: true },
  bus: { exposure: 0.9, breathing: 1.2, open: true },
  metro: { exposure: 0.7, breathing: 1.3, open: false },
  car: { exposure: 0.6, breathing: 1, open: false },
});

export const MODEL = Object.freeze({
  maskPenetration: 0.2, // fitted N95/FFP2 worn the whole trip, conservative
  outdoorExerciseBreathing: 2.5,
  indoorExerciseBreathing: 1.8,
  infiltrationOpen: 0.8,
  infiltrationClosed: 0.5,
  purifierFactor: 0.4,
  cookingHours: 2,
  cookingSource: Object.freeze({ biomass: 60, lpg: 15, induction: 0, electric: 0 }),
  purifierCookingFactor: 0.6,
  ventCookingFactor: 0.5,
});

/**
 * Relative daily dose (ug/m3 x hours, breathing-weighted).
 * @param {{pm25:number, bestPm25?:number|null, profile:object}} ctx
 * @param {object} flags what-if actions: mask, windowsClosed, purifier,
 *   exerciseIndoors, shiftExercise, cleanCooking, cookingVent
 */
export function exposureDose(ctx, flags = {}) {
  const { pm25, profile } = ctx;
  const best = Number.isFinite(ctx.bestPm25) ? ctx.bestPm25 : null;
  const mode = MODES[profile.commute.mode] ?? MODES.wfh;
  const commuteHours = profile.commute.hours;
  const exerciseHours = profile.exercise.outdoorHours;

  const closed = flags.windowsClosed || profile.home.windows === 'closed';
  const purifier = flags.purifier || profile.home.purifier;
  let infiltration = closed ? MODEL.infiltrationClosed : MODEL.infiltrationOpen;
  if (purifier) infiltration *= MODEL.purifierFactor;
  const indoorConc = pm25 * infiltration;

  const maskFactor = flags.mask && mode.open ? MODEL.maskPenetration : 1;
  const commute = commuteHours * mode.exposure * mode.breathing * pm25 * maskFactor;

  let exercise;
  if (flags.exerciseIndoors) {
    exercise = exerciseHours * MODEL.indoorExerciseBreathing * indoorConc;
  } else {
    const conc = flags.shiftExercise && best !== null ? Math.min(pm25, best) : pm25;
    exercise = exerciseHours * MODEL.outdoorExerciseBreathing * conc;
  }

  const indoorHours = Math.max(0, 24 - commuteHours - exerciseHours);
  let source = MODEL.cookingSource[profile.home.cooking] ?? 0;
  if (flags.cleanCooking) source = 0;
  if (flags.cookingVent) source *= MODEL.ventCookingFactor;
  if (purifier) source *= MODEL.purifierCookingFactor;
  const indoor = indoorHours * indoorConc + MODEL.cookingHours * source;

  return commute + exercise + indoor;
}

/** Percent reduction from `before` to `after`, rounded, never negative. */
export function percentReduction(before, after) {
  if (!(before > 0)) return 0;
  return Math.max(0, Math.round(((before - after) / before) * 100));
}
