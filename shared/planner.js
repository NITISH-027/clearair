/**
 * Plan builder: picks the applicable actions for a household, estimates the
 * exposure effect of each and assembles the sections the page renders.
 */
import { aqiToPm25, categoryFor } from './aqi.js';
import {
  BEST_WINDOW,
  EXPOSURE_UNIT,
  HOUR_SLICE,
  LEVEL,
  LEVEL_SUMMARIES,
  MS_PER_HOUR,
  SENSITIVE_NOTE,
  WHO_24H_GUIDELINE,
} from './constants.js';
import { exposureDetail, percentReduction } from './exposure.js';
import { ACTIONS, SECTIONS } from './actions.js';
import { hourLabel, round1 } from './util.js';

/** @typedef {import('./types.js').BestWindow} BestWindow */
/** @typedef {import('./types.js').Profile} Profile */
/** @typedef {import('./types.js').HourlyPoint} HourlyPoint */
/** @typedef {import('./types.js').PlanItem} PlanItem */
/** @typedef {import('./types.js').PlanSection} PlanSection */
/** @typedef {import('./types.js').ExposureBlock} ExposureBlock */
/** @typedef {import('./types.js').ExposureDetail} ExposureDetail */
/** @typedef {import('./types.js').Plan} Plan */

/**
 * Usable points: finite PM2.5, inside the daytime search hours.
 * @param {Array<{time: string, pm25: number}>} hourly
 */
function daytimePoints(hourly) {
  return hourly.filter((p) => {
    const hour = Number(String(p.time).slice(HOUR_SLICE.start, HOUR_SLICE.end));
    return Number.isFinite(p.pm25) && hour >= BEST_WINDOW.firstHour && hour <= BEST_WINDOW.lastHour;
  });
}

/**
 * @param {Array<{time: string, pm25: number}>} points
 * @returns {{startTime: string, pm25: number}|null} lowest-average pair of consecutive hours
 */
function lowestPair(points) {
  /** @type {{startTime: string, pm25: number}|null} */
  let best = null;
  points.slice(0, -1).forEach((a, i) => {
    const b = /** @type {{time: string, pm25: number}} */ (points.at(i + 1));
    const gap = (new Date(`${b.time}:00Z`).getTime() - new Date(`${a.time}:00Z`).getTime()) / MS_PER_HOUR;
    const avg = (a.pm25 + b.pm25) / 2;
    if (gap === 1 && (best === null || avg < best.pm25)) best = { startTime: a.time, pm25: avg };
  });
  return best;
}

/**
 * Find the cleanest two-hour window between 6 AM and 8 PM local time.
 * @param {Array<{time: string, pm25: number, aqi: number}>} hourly
 * @returns {BestWindow|null}
 */
export function findBestWindow(hourly) {
  if (!Array.isArray(hourly)) return null;
  const best = lowestPair(daytimePoints(hourly));
  if (!best) return null;
  const endHour = Number(best.startTime.slice(HOUR_SLICE.start, HOUR_SLICE.end)) + BEST_WINDOW.lengthHours;
  const end = `${best.startTime.slice(0, HOUR_SLICE.start)}${String(endHour).padStart(2, '0')}:00`;
  return { startTime: best.startTime, label: `${hourLabel(best.startTime)} to ${hourLabel(end)}`, pm25: round1(best.pm25) };
}

/**
 * @param {{children?: boolean, elderly?: boolean, respiratory?: boolean, pregnant?: boolean}} h
 * @returns {boolean}
 */
function isSensitive(h) {
  return Boolean(h.children || h.elderly || h.respiratory || h.pregnant);
}

/**
 * Category index, one step up for sensitive households at "Moderate".
 * @param {{index: number}} category
 * @param {Profile} profile
 * @returns {number}
 */
function effectiveLevel(category, profile) {
  return category.index === LEVEL.MODERATE && isSensitive(profile.household) ? LEVEL.SENSITIVE : category.index;
}

/**
 * Day-representative PM2.5: mean of the next-24h forecast if present.
 * @param {{source?: string, hourly?: Array<{pm25: number}>, pm25?: number, aqi: number}} air
 * @returns {number}
 */
function representativePm25(air) {
  const fallback = air.pm25 ?? aqiToPm25(air.aqi);
  if (air.source === 'manual' || !Array.isArray(air.hourly)) return fallback;
  const vals = air.hourly.map((p) => p.pm25).filter(Number.isFinite);
  return vals.length === 0 ? fallback : vals.reduce((s, v) => s + v, 0) / vals.length;
}

export const ACTION_CATALOG = Object.freeze(
  Object.fromEntries(ACTIONS.map((a) => [a.id, { id: a.id, section: a.section, title: a.title }])),
);

/**
 * @param {{index: number}} category
 * @param {{level: number, bestWindow: BestWindow|null, sensitive: boolean}} state
 * @returns {string}
 */
function summaryFor(category, { level, bestWindow, sensitive }) {
  const extra = sensitive && category.index === LEVEL.MODERATE ? SENSITIVE_NOTE : '';
  const window = bestWindow && level >= LEVEL.SENSITIVE ? ` Cleanest window today: ${bestWindow.label}.` : '';
  return `${LEVEL_SUMMARIES.at(level)}${extra}${window}`;
}

/**
 * Turn an action definition into a plan item.
 * @param {import('./actions.js').ActionDef} def
 * @param {import('./types.js').PlanContext} ctx
 * @param {number} baseDose ug/day with no actions
 */
function itemFor(def, ctx, baseDose) {
  /** @type {PlanItem} */
  const item = { id: def.id, section: def.section, title: def.title, action: def.action(ctx), why: def.why };
  if (def.note) item.note = def.note;
  if (def.flag) {
    // Do not stack alternatives: an indoor workout replaces a window shift.
    const pct = percentReduction(baseDose, exposureDetail(ctx, { [def.flag]: true }).dose);
    if (pct >= 1) item.impactPercent = pct;
  }
  return item;
}

/**
 * @param {import('./types.js').PlanContext} ctx
 * @param {number} baseDose
 * @returns {{items: PlanItem[], flags: Record<string, boolean>}}
 */
function applicableItems(ctx, baseDose) {
  const defs = ACTIONS.filter((def) => def.applies(ctx));
  const flags = Object.fromEntries(defs.filter((d) => d.flag).map((d) => [d.flag, true]));
  return { items: defs.map((def) => itemFor(def, ctx, baseDose)), flags };
}

/**
 * @param {PlanItem[]} items
 * @returns {PlanSection[]} non-empty sections with their items
 */
function groupSections(items) {
  return SECTIONS.map((s) => ({ ...s, items: items.filter((i) => i.section === s.id) })).filter((s) => s.items.length > 0);
}

/**
 * @param {{base: ExposureDetail, withPlan: ExposureDetail, pm25: number}} detail
 * @returns {ExposureBlock} exposure block of the plan
 */
function exposureBlock({ base, withPlan, pm25 }) {
  return {
    baseline: Math.round(base.dose),
    withPlan: Math.round(withPlan.dose),
    reductionPercent: percentReduction(base.dose, withPlan.dose),
    meanConcentration: round1(base.meanConcentration),
    meanConcentrationWithPlan: round1(withPlan.meanConcentration),
    whoGuideline: WHO_24H_GUIDELINE,
    pm25Used: round1(pm25),
    unit: EXPOSURE_UNIT,
  };
}

/**
 * Build a personalised plan.
 * @param {Profile} profile validated profile (see validate.js)
 * @param {{aqi: number, pm25?: number, hourly?: HourlyPoint[], source?: string}} air
 * @returns {Plan}
 */
export function buildPlan(profile, air) {
  const category = categoryFor(air.aqi);
  const level = effectiveLevel(category, profile);
  const bestWindow = air.source === 'manual' ? null : findBestWindow(air.hourly ?? []);
  const pm25 = representativePm25(air);
  const ctx = { profile, level, bestWindow, pm25, bestPm25: bestWindow ? bestWindow.pm25 : null };
  const base = exposureDetail(ctx);
  const { items, flags } = applicableItems(ctx, base.dose);
  const withPlan = exposureDetail(ctx, flags);
  const sensitive = isSensitive(profile.household);
  return {
    aqi: air.aqi,
    category: category.label,
    level,
    summary: summaryFor(category, { level, bestWindow, sensitive }),
    bestWindow,
    sections: groupSections(items),
    actionIds: items.map((i) => i.id),
    exposure: exposureBlock({ base, withPlan, pm25 }),
  };
}
