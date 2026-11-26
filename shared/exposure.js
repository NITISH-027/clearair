// Daily PM2.5 inhalation model.
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

export const WHO_24H_GUIDELINE = 15; // ug/m3, WHO Global Air Quality Guidelines 2021

/** Representative adult inhalation rates (m3/h), ranges from EPA Exposure Factors Handbook ch. 6. */
export const BREATHING = Object.freeze({ sleep: 0.3, rest: 0.5, light: 1.0, moderate: 2.0 });

export const HOME = Object.freeze({
  roomVolume: 40, // m3, a 15 m2 room at 2.7 m
  airChanges: Object.freeze({ open: 2.0, closed: 0.5 }), // 1/h, windows open or shut
  penetration: 0.8,
  deposition: 0.2, // 1/h
  defaultCadr: 200, // m3/h, a typical small-room HEPA unit
  purifierCoverage: 0.7, // share of indoor hours spent in the room that has the purifier
  sleepHours: 8,
});

export const KITCHEN = Object.freeze({
  volume: 15, // m3
  airChanges: Object.freeze({ normal: 5, fan: 15 }), // 1/h, with and without an exhaust fan running
  cookingHours: 2,
  // Emission (ug/h) calibrated so the kitchen increment matches the ranges
  // reported for household fuels (WHO Guidelines for indoor air quality:
  // household fuel combustion, 2014; Smith et al. 2014, Annu Rev Public Health 35:185).
  emission: Object.freeze({ biomass: 46800, lpg: 3000, induction: 600, electric: 600 }),
});

export const MASK = Object.freeze({ assignedProtectionFactor: 5 });

/**
 * Commute microenvironments. `ratio` is in-vehicle (or on-foot) concentration
 * relative to ambient, `rate` the inhalation rate in m3/h. Ratios are
 * assumptions informed by Kaur, Nieuwenhuijsen & Colvile 2007, Atmos Environ
 * 41:4781 (commuter exposure review).
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

/** Steady-state indoor PM2.5 (ug/m3) from the mass-balance equation above. */
export function indoorConcentration({ outdoor, airChanges, cadr = 0, source = 0, volume = HOME.roomVolume }) {
  const loss = airChanges + HOME.deposition + cadr / volume;
  return (HOME.penetration * airChanges * outdoor + source / volume) / loss;
}

/**
 * Detailed daily exposure.
 * @param {{pm25:number, bestPm25?:number|null, profile:object}} ctx
 * @param {object} flags what-if actions: mask, windowsClosed, purifier,
 *   exerciseIndoors, shiftExercise, cleanCooking, cookingVent
 * @returns {{dose:number, volume:number, meanConcentration:number, indoorConcentration:number}}
 */
export function exposureDetail(ctx, flags = {}) {
  const { pm25, profile } = ctx;
  const best = Number.isFinite(ctx.bestPm25) ? ctx.bestPm25 : null;
  const mode = MODES[profile.commute.mode] ?? MODES.wfh;
  const commuteHours = profile.commute.hours;
  const exerciseHours = profile.exercise.outdoorHours;

  const closed = flags.windowsClosed || profile.home.windows === 'closed';
  const airChanges = closed ? HOME.airChanges.closed : HOME.airChanges.open;
  const hasPurifier = Boolean(flags.purifier || profile.home.purifier);
  const cadr = hasPurifier ? profile.home.purifierCadr || HOME.defaultCadr : 0;

  const plain = indoorConcentration({ outdoor: pm25, airChanges });
  const filtered = indoorConcentration({ outdoor: pm25, airChanges, cadr });
  const cIn = hasPurifier ? HOME.purifierCoverage * filtered + (1 - HOME.purifierCoverage) * plain : plain;

  let kitchenSource = KITCHEN.emission[profile.home.cooking] ?? 0;
  if (flags.cleanCooking) kitchenSource = KITCHEN.emission.induction;
  const kitchenAch = flags.cookingVent ? KITCHEN.airChanges.fan : KITCHEN.airChanges.normal;
  const kitchenIncrement = kitchenSource / (KITCHEN.volume * (kitchenAch + HOME.deposition));

  const penetration = flags.mask && mode.open ? 1 / MASK.assignedProtectionFactor : 1;
  const parts = [];
  const add = (conc, rate, hours) => {
    if (hours > 0) parts.push({ conc, rate, hours });
  };

  add(cIn, BREATHING.sleep, HOME.sleepHours);
  add(cIn + kitchenIncrement, BREATHING.light, KITCHEN.cookingHours);
  add(pm25 * mode.ratio * penetration, mode.rate, commuteHours);
  if (flags.exerciseIndoors) {
    add(cIn, BREATHING.moderate, exerciseHours);
  } else {
    const outdoor = flags.shiftExercise && best !== null ? Math.min(pm25, best) : pm25;
    add(outdoor, BREATHING.moderate, exerciseHours);
  }
  const awakeIndoor = 24 - HOME.sleepHours - KITCHEN.cookingHours - commuteHours - exerciseHours;
  add(cIn, BREATHING.rest, Math.max(0, awakeIndoor));

  const dose = parts.reduce((sum, p) => sum + p.conc * p.rate * p.hours, 0);
  const volume = parts.reduce((sum, p) => sum + p.rate * p.hours, 0);
  return { dose, volume, meanConcentration: volume > 0 ? dose / volume : 0, indoorConcentration: cIn };
}

/** Daily inhaled PM2.5 mass in micrograms. */
export function exposureDose(ctx, flags = {}) {
  return exposureDetail(ctx, flags).dose;
}

/** Percent reduction from `before` to `after`, rounded, never negative. */
export function percentReduction(before, after) {
  if (!(before > 0)) return 0;
  return Math.max(0, Math.round(((before - after) / before) * 100));
}
