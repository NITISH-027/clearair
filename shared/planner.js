import { aqiToPm25, categoryFor } from './aqi.js';
import { exposureDetail, percentReduction, MODES, WHO_24H_GUIDELINE } from './exposure.js';

export const SECTIONS = Object.freeze([
  { id: 'routine', title: 'Your day, step by step' },
  { id: 'indoor', title: 'Clean air at home' },
  { id: 'swaps', title: 'Lower-emission swaps' },
  { id: 'care', title: 'Looking after sensitive family members' },
]);

const OPEN_MODES = Object.entries(MODES).filter(([, m]) => m.open).map(([k]) => k);

function hourLabel(iso) {
  const hour = Number(String(iso).slice(11, 13));
  if (!Number.isInteger(hour)) return '';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * Find the cleanest two-hour window between 6 AM and 8 PM local time in a list
 * of hourly points [{ time: 'YYYY-MM-DDTHH:mm', pm25, aqi }].
 */
export function findBestWindow(hourly) {
  if (!Array.isArray(hourly)) return null;
  const usable = hourly.filter((p) => {
    const hour = Number(String(p.time).slice(11, 13));
    return Number.isFinite(p.pm25) && hour >= 6 && hour <= 20;
  });
  let best = null;
  usable.slice(0, -1).forEach((a, i) => {
    const b = usable.at(i + 1);
    const gap = (new Date(`${b.time}:00Z`) - new Date(`${a.time}:00Z`)) / 3600000;
    if (gap !== 1) return;
    const avg = (a.pm25 + b.pm25) / 2;
    if (best === null || avg < best.pm25) best = { startTime: a.time, pm25: avg };
  });
  if (!best) return null;
  const endHour = Number(best.startTime.slice(11, 13)) + 2;
  const end = `${best.startTime.slice(0, 11)}${String(endHour).padStart(2, '0')}:00`;
  return {
    startTime: best.startTime,
    label: `${hourLabel(best.startTime)} to ${hourLabel(end)}`,
    pm25: Math.round(best.pm25 * 10) / 10,
  };
}

function isSensitive(h) {
  return h.children || h.elderly || h.respiratory || h.pregnant;
}

/** Category index adjusted one step up for sensitive households at "Moderate". */
function effectiveLevel(category, profile) {
  return category.index === 1 && isSensitive(profile.household) ? 2 : category.index;
}

/** Day-representative PM2.5: mean of the next-24h forecast if present. */
function representativePm25(air) {
  if (air.source === 'manual' || !Array.isArray(air.hourly) || air.hourly.length === 0) {
    return air.pm25 ?? aqiToPm25(air.aqi);
  }
  const vals = air.hourly.map((p) => p.pm25).filter(Number.isFinite);
  if (vals.length === 0) return air.pm25 ?? aqiToPm25(air.aqi);
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

const ACTIONS = [
  {
    id: 'exercise-indoors',
    section: 'routine',
    flag: 'exerciseIndoors',
    applies: (c) => c.profile.exercise.outdoorHours > 0 && c.level >= 3,
    title: 'Move your workout indoors today',
    action: (c) => `Do your ${c.profile.exercise.outdoorHours} h of exercise indoors, with windows closed. Yoga, a home circuit or stairs all work.`,
    why: 'You breathe two to three times more air when you exercise, so hard outdoor exercise on a smoggy day pulls the most fine particles deep into your lungs.',
  },
  {
    id: 'shift-exercise',
    section: 'routine',
    flag: 'shiftExercise',
    applies: (c) => c.profile.exercise.outdoorHours > 0 && c.level === 2 && c.bestWindow,
    title: 'Exercise in the cleanest window',
    action: (c) => `Take your outdoor exercise between ${c.bestWindow.label}, the cleanest two hours in today's forecast, and keep it light.`,
    why: 'Pollution changes hour by hour. Moving the same exercise to the lowest-PM2.5 hours cuts what you inhale without giving anything up.',
  },
  {
    id: 'wear-mask',
    section: 'routine',
    flag: 'mask',
    applies: (c) => c.profile.commute.hours > 0 && OPEN_MODES.includes(c.profile.commute.mode) && c.level >= 2,
    title: 'Wear a fitted N95 or FFP2 on your commute',
    action: () => 'Wear a well-fitted N95, FFP2 or KN95 for the whole trip. Cloth and surgical masks do little against PM2.5.',
    why: 'Fine particles are the main smog risk. A sealed N95 filters most of them. A loose mask or a beard gap lets air bypass the filter.',
  },
  {
    id: 'off-peak-outdoors',
    section: 'routine',
    applies: (c) => c.level >= 3,
    title: 'Avoid early morning and late evening outdoors',
    action: () => 'Postpone walks, errands and kids\' outdoor time away from dawn and after sunset where you can.',
    why: 'In winter, cold air near the ground traps smoke and exhaust, so levels often peak at night and just after sunrise before the air warms and mixes.',
    note: 'Check the forecast hours above, because local weather can change this pattern.',
  },
  {
    id: 'best-window-errands',
    section: 'routine',
    applies: (c) => c.level >= 2 && c.bestWindow,
    title: 'Bundle outdoor errands into the cleanest window',
    action: (c) => `Do shopping, school runs and other outdoor tasks between ${c.bestWindow.label} (forecast PM2.5 about ${c.bestWindow.pm25} ug/m3).`,
    why: 'One trip in a cleaner window beats several trips at a bad hour, with no change to what you get done.',
    note: 'Forecast data is a model estimate, so check again before heading out.',
  },
  {
    id: 'car-recirculate',
    section: 'routine',
    applies: (c) => c.profile.commute.mode === 'car' && c.level >= 2,
    title: 'Keep car windows up and set air to recirculate',
    action: () => 'Close windows, switch the AC to recirculate in heavy traffic, and replace the cabin filter if it is more than a year old.',
    why: 'A closed cabin with a clean filter keeps out much of the roadside smoke and exhaust you would otherwise breathe in a jam.',
  },
  {
    id: 'recheck-evening',
    section: 'routine',
    applies: (c) => c.level >= 2,
    title: 'Re-check the AQI before evening plans',
    action: () => 'Look at the reading again around 4 PM. Decide on evening walks and kids\' play from that, not the morning number.',
    why: 'Smog can climb sharply after sunset. A second look takes one minute and avoids a bad surprise.',
  },
  {
    id: 'close-windows',
    section: 'indoor',
    flag: 'windowsClosed',
    applies: (c) => c.profile.home.windows === 'open' && c.level >= 2,
    title: 'Keep windows and doors closed',
    action: () => 'Close windows, and seal obvious gaps with door strips or a damp towel.',
    why: 'Fewer air exchanges means fewer outdoor particles drift in, and indoor particles settle out faster than they are replaced. Your home becomes a shelter instead of an extension of the street.',
  },
  {
    id: 'get-purifier',
    section: 'indoor',
    flag: 'purifier',
    applies: (c) => !c.profile.home.purifier && c.level >= 3,
    title: 'Run a HEPA purifier in your main room',
    action: () => 'Use a HEPA purifier sized for the room (a CADR of at least 5 air changes per hour: room volume in m3 x 5), or build a low-cost box fan plus MERV 13 filter unit. Keep the door shut.',
    why: 'A purifier adds a clean-air term (CADR divided by room volume) to the room\'s air balance. At 5 air changes an hour it removes most particles that leak in, so the room where you spend the most hours stays much cleaner.',
  },
  {
    id: 'use-purifier',
    section: 'indoor',
    applies: (c) => c.profile.home.purifier && c.level >= 2,
    title: 'Keep your purifier running in the room you use most',
    action: () => 'Run it continuously on a medium setting, close the door, and check that the filter is not past its life.',
    why: 'A clogged filter quietly stops working. A steady, medium run keeps particle levels low without the noise of high speed.',
  },
  {
    id: 'cleaner-cooking',
    section: 'indoor',
    flag: 'cleanCooking',
    applies: (c) => c.profile.home.cooking === 'biomass',
    title: 'Move cooking off wood, dung or coal',
    action: () => 'Switch to LPG or an induction cooktop. Until you can, cook near an open door or vent and keep children out of the kitchen.',
    why: 'Burning biomass indoors produces very high PM2.5 right where you breathe it. WHO reports it as one of the largest sources of household air pollution.',
  },
  {
    id: 'cooking-vent',
    section: 'indoor',
    flag: 'cookingVent',
    applies: (c) => c.profile.home.cooking === 'lpg' && c.level >= 2,
    title: 'Use the exhaust fan while cooking',
    action: () => 'Run the chimney or exhaust fan during cooking and for 10 minutes after. Keep the kitchen door shut so fumes stay out of other rooms.',
    why: 'Gas and frying release fine particles. Pulling them out at the source stops them mixing into the air everyone breathes.',
  },
  {
    id: 'no-indoor-smoke',
    section: 'indoor',
    applies: (c) => c.level >= 2,
    title: 'Skip incense, coils and candles; wet-mop, don\'t sweep',
    action: () => 'Avoid burning incense, mosquito coils and scented candles. Clean with a damp cloth or mop, or a HEPA vacuum, instead of dry sweeping.',
    why: 'Smoke and stirred-up dust add to the particles you are already trying to keep out.',
  },
  {
    id: 'air-out-best-window',
    section: 'indoor',
    applies: (c) => c.level >= 2 && c.bestWindow && c.level <= 3,
    title: 'Air the house out once, in the cleanest window',
    action: (c) => `Open windows for about 10 minutes between ${c.bestWindow.label}, then close them again.`,
    why: 'Stale indoor air also builds up. One short airing in the best hours refreshes the house at the lowest cost.',
  },
  {
    id: 'swap-transit',
    section: 'swaps',
    applies: (c) => ['car', 'twowheeler'].includes(c.profile.commute.mode),
    title: 'Swap some trips to metro, bus or a shared ride',
    action: () => 'Take the metro or bus, or share a ride, on two or three days a week.',
    why: 'Every vehicle off the road means less exhaust adding to the same winter haze. Note: on a very smoggy day, a closed car can expose you a little less than a bus stop, so pair this with a mask.',
  },
  {
    id: 'swap-induction',
    section: 'swaps',
    applies: (c) => ['lpg', 'biomass'].includes(c.profile.home.cooking),
    title: 'Move toward an induction cooktop',
    action: () => 'Replace one burner or add a single induction plate for daily cooking such as tea, rice and reheating.',
    why: 'It removes combustion particles and gases from your kitchen, and cuts emissions when the grid mix is cleaner than the fuel you burn.',
  },
  {
    id: 'no-burning',
    section: 'swaps',
    applies: () => true,
    title: 'Never burn leaves, trash or crackers; report open burning',
    action: () => 'Compost garden waste, take trash to collection points, skip firecrackers, and report open burning to your local civic helpline.',
    why: 'Open burning is a major short-term smog source in winter, and a small fire near a home puts particles straight into your street.',
  },
  {
    id: 'no-idling',
    section: 'swaps',
    applies: (c) => c.profile.commute.mode === 'car' || c.profile.commute.mode === 'twowheeler',
    title: 'Switch the engine off when you wait',
    action: () => 'Turn the engine off at long signals, level crossings and while waiting for someone.',
    why: 'An idling engine emits exhaust while going nowhere. Over a city, thousands of waiting engines add up.',
  },
  {
    id: 'care-children',
    section: 'care',
    applies: (c) => c.profile.household.children && c.level >= 2,
    title: 'Keep children\'s outdoor play short and indoors-first',
    action: () => 'Move sports and play indoors or to the cleanest window. Ask the school to hold outdoor assembly and sports on bad days.',
    why: 'Children breathe more air for their size and their lungs are still developing, so the same smog affects them more.',
  },
  {
    id: 'care-elderly',
    section: 'care',
    applies: (c) => c.profile.household.elderly && c.level >= 2,
    title: 'Keep older family members indoors on bad days',
    action: () => 'Postpone morning walks, keep medicines stocked, and watch for breathlessness, chest tightness or dizziness.',
    why: 'Fine particles strain the heart and lungs, and risk rises with age and existing conditions.',
  },
  {
    id: 'care-respiratory',
    section: 'care',
    applies: (c) => c.profile.household.respiratory && c.level >= 2,
    title: 'Follow your asthma or lung action plan',
    action: () => 'Keep your reliever inhaler with you, take controller medicine as prescribed, and call your doctor if symptoms get worse.',
    why: 'Smog is a common trigger for flare-ups. Having the plan ready matters more than guessing in the moment.',
  },
  {
    id: 'care-pregnancy',
    section: 'care',
    applies: (c) => c.profile.household.pregnant && c.level >= 2,
    title: 'Limit outdoor time and talk to your doctor if worried',
    action: () => 'Keep outdoor trips short, wear a fitted N95 when you must go out, and mention smog exposure at your next check-up.',
    why: 'Air pollution exposure during pregnancy is linked to poorer birth outcomes, so it is worth cutting where you can.',
  },
];

export const ACTION_CATALOG = Object.freeze(
  Object.fromEntries(ACTIONS.map((a) => [a.id, { id: a.id, section: a.section, title: a.title }])),
);

function summaryFor(category, level, bestWindow, sensitive) {
  const base = [
    'The air is clean. Enjoy the outdoors and keep up your good habits.',
    'The air is acceptable for most people. A few easy habits keep it that way.',
    'Sensitive groups should cut back on heavy outdoor activity today.',
    'Everyone can feel effects. Reduce time outside and clean your indoor air.',
    'This is a smog emergency for most people. Stay in and filter your indoor air.',
    'Hazardous air. Stay indoors with the cleanest air you can make and avoid any exertion.',
  ].at(level);
  const extra = sensitive && category.index === 1 ? ' Your household includes sensitive members, so we use stricter advice.' : '';
  const window = bestWindow && level >= 2 ? ` Cleanest window today: ${bestWindow.label}.` : '';
  return `${base}${extra}${window}`;
}

/**
 * Build a personalised plan.
 * @param {object} profile validated profile (see validate.js)
 * @param {object} air { aqi, pm25?, hourly?, source?, placeName? }
 */
export function buildPlan(profile, air) {
  const category = categoryFor(air.aqi);
  const level = effectiveLevel(category, profile);
  const bestWindow = air.source === 'manual' ? null : findBestWindow(air.hourly);
  const pm25 = representativePm25(air);
  const ctx = { profile, level, bestWindow, pm25, bestPm25: bestWindow ? bestWindow.pm25 : null };
  const base = exposureDetail(ctx);
  const baseDose = base.dose;

  const items = [];
  const recommendedFlags = {};
  for (const def of ACTIONS) {
    if (!def.applies(ctx)) continue;
    const item = {
      id: def.id,
      section: def.section,
      title: def.title,
      action: def.action(ctx),
      why: def.why,
    };
    if (def.note) item.note = def.note;
    if (def.flag) {
      // Do not stack alternatives: an indoor workout replaces a window shift.
      const pct = percentReduction(baseDose, exposureDetail(ctx, { [def.flag]: true }).dose);
      if (pct >= 1) item.impactPercent = pct;
      recommendedFlags[def.flag] = true;
    }
    items.push(item);
  }

  const withPlan = exposureDetail(ctx, recommendedFlags);
  const withPlanDose = withPlan.dose;
  const sections = SECTIONS.map((s) => ({ ...s, items: items.filter((i) => i.section === s.id) })).filter(
    (s) => s.items.length > 0,
  );

  return {
    aqi: air.aqi,
    category: category.label,
    level,
    summary: summaryFor(category, level, bestWindow, isSensitive(profile.household)),
    bestWindow,
    sections,
    actionIds: items.map((i) => i.id),
    exposure: {
      baseline: Math.round(baseDose),
      withPlan: Math.round(withPlanDose),
      reductionPercent: percentReduction(baseDose, withPlanDose),
      meanConcentration: Math.round(base.meanConcentration * 10) / 10,
      meanConcentrationWithPlan: Math.round(withPlan.meanConcentration * 10) / 10,
      whoGuideline: WHO_24H_GUIDELINE,
      pm25Used: Math.round(pm25 * 10) / 10,
      unit: 'ug of PM2.5 inhaled per day',
    },
  };
}
