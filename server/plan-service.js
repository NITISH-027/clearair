import { buildPlan } from '../shared/planner.js';
import { TtlCache } from './cache.js';
import { RateLimiter } from './ratelimit.js';
import { loadAir } from './air.js';
import { DEFAULT_MODEL, aiCacheKey, buildFacts, generateAiPlan } from './ai-plan.js';

export const CACHE_TTL_MS = 15 * 60 * 1000;
export const CACHE_MAX_ENTRIES = 200;
export const AI_LIMIT_PER_MINUTE = 8;

const FALLBACK_LABELS = new Map(Object.entries({
  no_api_key: 'AI personalisation is not configured on this server. This is the rule-based plan.',
  rate_limited: 'AI personalisation is busy. This is the rule-based plan.',
  timeout: 'The AI service took too long. This is the rule-based plan.',
  api_error: 'The AI service is unavailable. This is the rule-based plan.',
  invalid_output: 'The AI service gave an unusable answer. This is the rule-based plan.',
}));

/** Create the plan service. All collaborators are injectable for tests. */
export function createPlanService({ fetchImpl = fetch, env = process.env, sleep, random, retry } = {}) {
  const airCache = new TtlCache(CACHE_TTL_MS, CACHE_MAX_ENTRIES);
  const aiCache = new TtlCache(CACHE_TTL_MS, CACHE_MAX_ENTRIES);
  const aiLimiter = new RateLimiter(60_000);
  const airDeps = { fetchImpl, airCache, retry: { sleep, random, ...retry } };
  const aiEnabled = Boolean(env.GEMINI_API_KEY);

  function fallback(reason, notice, detail) {
    return {
      source: 'fallback',
      reason,
      label: FALLBACK_LABELS.get(reason),
      ...(notice ? { notice } : {}),
      ...(detail ? { detail } : {}),
    };
  }

  async function aiFor({ plan, air, profile, notes, clientId }) {
    const facts = buildFacts({ plan, air, profile });
    const model = env.GEMINI_MODEL || DEFAULT_MODEL;
    const key = aiCacheKey(model, facts, notes.value);
    const cached = aiCache.get(key);
    if (cached) return cached;
    if (!aiLimiter.allow(clientId, AI_LIMIT_PER_MINUTE)) return fallback('rate_limited');
    return aiCache.getOrLoad(
      key,
      async () => {
        try {
          const result = await generateAiPlan({ fetchImpl, env, facts, notes: notes.value, sleep, random });
          return { source: 'gemini', model: result.model, summary: result.summary, steps: result.steps };
        } catch (err) {
          // generateAiPlan only throws AiError. Log the reason (never the key) so the host logs show why.
          console.warn(`[gemini] fallback: ${err.code}${err.detail ? ` (${err.detail})` : ''}`);
          return fallback(err.code, undefined, err.detail);
        }
      },
      (value) => value.source === 'gemini',
    );
  }

  /**
   * Build the full response for a validated request.
   * @param {{location:object, profile:object, notes:{value:string,dropped:boolean}, useAi:boolean}} request
   * @param {string} clientId key used for per-client AI rate limiting
   */
  async function createResponse(request, clientId) {
    const air = await loadAir(airDeps, request.location);
    const plan = buildPlan(request.profile, {
      aqi: air.current.aqi,
      pm25: air.current.pm25,
      hourly: air.hourly,
      source: air.source,
    });

    let ai;
    if (!request.useAi) {
      ai = { source: 'off', label: 'AI personalisation is switched off. This is the rule-based plan.' };
    } else if (!aiEnabled) {
      ai = fallback('no_api_key');
    } else {
      ai = await aiFor({ plan, air, profile: request.profile, notes: request.notes, clientId });
    }
    if (request.notes.dropped && ai.source !== 'off') {
      ai = { ...ai, notice: 'Your note was not used because it looked like instructions for the AI.' };
    }
    return { air, plan, ai };
  }

  return { createResponse, aiEnabled, airCache, aiCache, aiLimiter };
}
