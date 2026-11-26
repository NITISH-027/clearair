/**
 * Parsing and strict validation of the model's answer. Model output is
 * untrusted: unknown keys are dropped, text is cleaned and bounded.
 */
import { cleanModelText } from '../shared/sanitize.js';
import { isPlainObject } from '../shared/util.js';
import { PLAN_LIMITS, STEP_CATEGORY, STEP_WHEN } from './ai-config.js';
import { AiError } from './errors.js';

/** @typedef {{title: string, action: string, why: string, when: string, category: string}} AiStep */
/** @typedef {{ok: boolean, value?: {summary: string, steps: AiStep[]}, errors: string[]}} AiPlanCheck */

const FENCE_START = /^```(?:json)?\s*/i;
const FENCE = '```';
const TRAILING_COMMA = /,\s*([}\]])/g;

/**
 * Remove a closing code fence and the whitespace before it.
 * @param {string} text
 * @returns {string}
 */
function stripClosingFence(text) {
  return text.endsWith(FENCE) ? text.slice(0, -FENCE.length).trimEnd() : text;
}

/**
 * Candidate JSON strings: the text itself, the outermost braces, and that slice without trailing commas.
 * @param {string} text
 * @returns {string[]}
 */
function jsonCandidates(text) {
  const unfenced = stripClosingFence(text.trim().replace(FENCE_START, ''));
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) return [unfenced];
  const slice = unfenced.slice(start, end + 1);
  return [unfenced, slice, slice.replace(TRAILING_COMMA, '$1')];
}

/**
 * @param {string} candidate
 * @returns {object|null} a parsed plain object, or null
 */
function tryParseObject(candidate) {
  try {
    const parsed = JSON.parse(candidate);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Parse model output, recovering from code fences, surrounding prose and trailing commas.
 * @param {unknown} text
 * @returns {object}
 */
export function parseModelJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new AiError('invalid_output');
  for (const candidate of jsonCandidates(text)) {
    const parsed = tryParseObject(candidate);
    if (parsed) return parsed;
  }
  throw new AiError('invalid_output');
}

/**
 * @param {unknown} value
 * @param {{min: number, max: number}} limits
 * @returns {string|null} cleaned text, or null when too short
 */
function cleanField(value, limits) {
  const text = cleanModelText(value, limits.max);
  return text.length >= limits.min ? text : null;
}

/**
 * Validate one step. Returns the cleaned step and any problems.
 * @param {*} raw
 * @param {number} index
 * @returns {{step?: AiStep, errors: string[]}}
 */
function validateStep(raw, index) {
  if (raw === null || typeof raw !== 'object') return { errors: [`step ${index} is not an object`] };
  const step = {
    title: cleanField(raw.title, PLAN_LIMITS.title),
    action: cleanField(raw.action, PLAN_LIMITS.action),
    why: cleanField(raw.why, PLAN_LIMITS.why),
    when: raw.when,
    category: raw.category,
  };
  /** @type {string[]} */
  const errors = [];
  if (!step.title || !step.action || !step.why) errors.push(`step ${index} text invalid`);
  if (!STEP_WHEN.includes(step.when)) errors.push(`step ${index} when invalid`);
  if (!STEP_CATEGORY.includes(step.category)) errors.push(`step ${index} category invalid`);
  return { step: /** @type {AiStep} */ (step), errors };
}

/**
 * Strictly validate a parsed model plan.
 * @param {unknown} input
 * @returns {AiPlanCheck}
 */
export function validateAiPlan(input) {
  if (!isPlainObject(input)) return { ok: false, errors: ['Plan must be an object.'] };
  /** @type {string[]} */
  const errors = [];
  const summary = cleanField(input.summary, PLAN_LIMITS.summary);
  if (!summary) errors.push('summary missing or too short');
  if (!Array.isArray(input.steps) || input.steps.length < PLAN_LIMITS.minSteps) {
    errors.push(`need at least ${PLAN_LIMITS.minSteps} steps`);
    return { ok: false, errors };
  }
  const checked = input.steps.slice(0, PLAN_LIMITS.maxSteps).map(validateStep);
  errors.push(...checked.flatMap((c) => c.errors));
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { summary: /** @type {string} */ (summary), steps: /** @type {AiStep[]} */ (checked.map((c) => c.step)) },
    errors,
  };
}

/**
 * @param {any} part
 * @returns {string}
 */
const textOf = (part) => (typeof part?.text === 'string' ? part.text : '');

/**
 * @param {any} data
 * @returns {any} the first candidate, if any
 */
const firstCandidate = (data) => data?.candidates?.[0];

/**
 * @param {any} data
 * @returns {any[]|null} the first candidate's parts, or null when blocked or missing
 */
function candidateParts(data) {
  const candidate = firstCandidate(data);
  if (!candidate || data.promptFeedback?.blockReason) return null;
  const parts = candidate.content?.parts;
  return Array.isArray(parts) ? parts : null;
}

/**
 * Pull the text out of a Gemini response; empty when blocked or malformed.
 * @param {any} data
 * @returns {string}
 */
export function extractText(data) {
  const parts = candidateParts(data);
  return parts ? parts.map(textOf).join('') : '';
}
