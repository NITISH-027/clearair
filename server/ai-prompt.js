/**
 * Builds what the model sees: the facts object (from validated values only),
 * the prompt text and the response cache key.
 */
import { createHash } from 'node:crypto';
import { categoryFor } from '../shared/aqi.js';
import { round1 } from '../shared/util.js';
import { AQI_UNHEALTHY_THRESHOLD, FORECAST_TIME_SLICE, PROMPT_TAGS, SYSTEM_PROMPT } from './ai-config.js';

/**
 * Summarise the hourly forecast for the model.
 * @param {Array<{time: string, aqi: number}>} hourly
 * @returns {{hours: number, meanAqi: number, peakAqi: number, peakHour: string, hoursAbove150: number}|null}
 */
function forecastSummary(hourly) {
  if (!Array.isArray(hourly) || hourly.length === 0) return null;
  const peak = hourly.reduce((top, p) => (p.aqi > top.aqi ? p : top), hourly[0]);
  const sum = hourly.reduce((total, p) => total + p.aqi, 0);
  return {
    hours: hourly.length,
    meanAqi: Math.round(sum / hourly.length),
    peakAqi: peak.aqi,
    peakHour: String(peak.time).slice(FORECAST_TIME_SLICE.start, FORECAST_TIME_SLICE.end),
    hoursAbove150: hourly.filter((p) => p.aqi > AQI_UNHEALTHY_THRESHOLD).length,
  };
}

/**
 * @param {{name: string, country?: string}|null} place
 * @returns {string}
 */
const placeLabel = (place) => (place ? [place.name, place.country].filter(Boolean).join(', ') : 'not given');

/**
 * Facts passed to the model. Built only from validated values and the plan, never from raw request text.
 * @param {{plan: import('../shared/types.js').Plan, air: import('../shared/types.js').AirData, profile: import('../shared/types.js').Profile}} input
 * @returns {object}
 */
export function buildFacts({ plan, air, profile }) {
  return {
    place: placeLabel(air.place),
    aqi: plan.aqi,
    category: categoryFor(plan.aqi).label,
    pm25: round1(air.current.pm25 ?? 0),
    forecast: forecastSummary(air.hourly),
    cleanestWindow: plan.bestWindow ? plan.bestWindow.label : null,
    household: profile.household,
    commute: profile.commute,
    outdoorExerciseHours: profile.exercise.outdoorHours,
    home: profile.home,
    estimatedExposureUgPerDay: plan.exposure.baseline,
    ruleBasedSteps: plan.sections.flatMap((s) => s.items.map((i) => i.title)),
  };
}

/**
 * Build the system and user prompts.
 * @param {object} facts
 * @param {string} notes sanitised user note, possibly empty
 * @returns {{system: string, user: string}}
 */
export function buildPrompt(facts, notes) {
  const user = [
    PROMPT_TAGS.facts[0],
    JSON.stringify(facts),
    PROMPT_TAGS.facts[1],
    PROMPT_TAGS.notes[0],
    notes || PROMPT_TAGS.empty,
    PROMPT_TAGS.notes[1],
    PROMPT_TAGS.closing,
  ].join('\n');
  return { system: SYSTEM_PROMPT, user };
}

/**
 * Stable cache key for identical requests. The API key is never part of it.
 * @param {string} model
 * @param {object} facts
 * @param {string} notes
 * @returns {string}
 */
export function aiCacheKey(model, facts, notes) {
  return createHash('sha256').update(JSON.stringify({ model, facts, notes })).digest('hex');
}
