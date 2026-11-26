/**
 * Plan service: loads air data, builds the rule-based plan, asks Gemini for a
 * personalised one when allowed, and falls back to the rules on any AI failure.
 */
import { buildPlan } from '../shared/planner.js';
import { DEFAULT_MODEL } from './ai-config.js';
import { aiCacheKey, buildFacts } from './ai-prompt.js';
import { generateAiPlan } from './ai-plan.js';
import { loadAir } from './air.js';
import { TtlCache } from './cache.js';
import { AI_LIMIT_PER_MINUTE, CACHE_MAX_ENTRIES, CACHE_TTL_MS, RATE_WINDOW_MS } from './config.js';
import { logger } from './logger.js';
import { RateLimiter } from './ratelimit.js';

const AI_OFF_LABEL = 'AI personalisation is switched off. This is the rule-based plan.';
const NOTE_DROPPED = 'Your note was not used because it looked like instructions for the AI.';
const FALLBACK_LABELS = new Map(
  Object.entries({
    no_api_key: 'AI personalisation is not configured on this server. This is the rule-based plan.',
    rate_limited: 'AI personalisation is busy. This is the rule-based plan.',
    timeout: 'The AI service took too long. This is the rule-based plan.',
    api_error: 'The AI service is unavailable. This is the rule-based plan.',
    invalid_output: 'The AI service gave an unusable answer. This is the rule-based plan.',
  }),
);

/**
 * @typedef {object} ServiceDeps
 * @property {typeof fetch} fetchImpl
 * @property {Record<string, string|undefined>} env
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {() => number} [random]
 * @property {import('./cache.js').TtlCache} airCache
 * @property {import('./cache.js').TtlCache} aiCache
 * @property {import('./ratelimit.js').RateLimiter} aiLimiter
 * @property {import('./air.js').AirDeps} airDeps
 * @property {boolean} aiEnabled
 */

/**
 * The `ai` block of the response when the rule-based plan is used instead.
 * @param {string} reason
 * @param {{notice?: string, detail?: string}} [extra]
 */
function fallback(reason, { notice, detail } = {}) {
  return {
    source: 'fallback',
    reason,
    label: FALLBACK_LABELS.get(reason),
    ...(notice ? { notice } : {}),
    ...(detail ? { detail } : {}),
  };
}

/**
 * Ask Gemini; any failure becomes a fallback block. The reason is logged, never the key.
 * @param {ServiceDeps} deps
 * @param {{facts: object, notes: string}} input
 */
async function askGemini(deps, { facts, notes }) {
  try {
    const { fetchImpl, env, sleep, random } = deps;
    const result = await generateAiPlan({ fetchImpl, env, facts, notes, sleep, random });
    return { source: 'gemini', model: result.model, summary: result.summary, steps: result.steps };
  } catch (error) {
    const err = /** @type {any} */ (error);
    logger.warn('gemini_fallback', { code: err.code, detail: err.detail });
    return fallback(err.code, { detail: err.detail });
  }
}

/**
 * Cached, rate-limited Gemini plan for one request.
 * @param {ServiceDeps} deps
 * @param {{plan: import('../shared/types.js').Plan, air: import('../shared/types.js').AirData, profile: import('../shared/types.js').Profile, notes: {value: string}, clientId: string}} input
 */
async function aiFor(deps, { plan, air, profile, notes, clientId }) {
  const facts = buildFacts({ plan, air, profile });
  const key = aiCacheKey(deps.env.GEMINI_MODEL || DEFAULT_MODEL, facts, notes.value);
  const cached = deps.aiCache.get(key);
  if (cached) return cached;
  if (!deps.aiLimiter.allow(clientId, AI_LIMIT_PER_MINUTE)) return fallback('rate_limited');
  return deps.aiCache.getOrLoad(
    key,
    () => askGemini(deps, { facts, notes: notes.value }),
    (value) => value.source === 'gemini',
  );
}

/**
 * Choose the `ai` block: off, not configured, or a Gemini attempt.
 * @param {ServiceDeps} deps
 * @param {{plan: import('../shared/types.js').Plan, air: import('../shared/types.js').AirData, request: import('./request.js').PlanRequest, clientId: string}} input
 */
async function chooseAi(deps, { plan, air, request, clientId }) {
  if (!request.useAi) return { source: 'off', label: AI_OFF_LABEL };
  if (!deps.aiEnabled) return fallback('no_api_key');
  const { profile, notes } = request;
  return aiFor(deps, { plan, air, profile, notes, clientId });
}

/**
 * Build the full response for a validated request.
 * @param {ServiceDeps} deps
 * @param {import('./request.js').PlanRequest} request
 * @param {string} clientId key used for per-client AI rate limiting
 */
async function createResponse(deps, request, clientId) {
  const air = await loadAir(deps.airDeps, request.location);
  const { aqi, pm25 } = air.current;
  const plan = buildPlan(request.profile, { aqi, pm25, hourly: air.hourly, source: air.source });
  let ai = await chooseAi(deps, { plan, air, request, clientId });
  if (request.notes.dropped && ai.source !== 'off') ai = { ...ai, notice: NOTE_DROPPED };
  return { air, plan, ai };
}

/**
 * Create the plan service. All collaborators are injectable for tests.
 * @param {{fetchImpl?: typeof fetch, env?: Record<string, string|undefined>, sleep?: (ms: number) => Promise<void>, random?: () => number, retry?: object}} [options]
 */
export function createPlanService({ fetchImpl = fetch, env = process.env, sleep, random, retry } = {}) {
  const airCache = new TtlCache(CACHE_TTL_MS, CACHE_MAX_ENTRIES);
  const deps = {
    fetchImpl,
    env,
    sleep,
    random,
    airCache,
    aiCache: new TtlCache(CACHE_TTL_MS, CACHE_MAX_ENTRIES),
    aiLimiter: new RateLimiter(RATE_WINDOW_MS),
    airDeps: { fetchImpl, airCache, retry: { sleep, random, ...retry } },
    aiEnabled: Boolean(env.GEMINI_API_KEY),
  };
  return {
    /** @param {import('./request.js').PlanRequest} request @param {string} clientId */
    createResponse: (request, clientId) => createResponse(deps, request, clientId),
    aiEnabled: deps.aiEnabled,
    airCache,
    aiCache: deps.aiCache,
    aiLimiter: deps.aiLimiter,
  };
}
