/**
 * Gemini plan generation: model order, schema and JSON-only modes, retries
 * inside a total time budget. Failures always surface as an AiError so the
 * rule-based plan can take over.
 */
import {
  AI_ATTEMPTS,
  AI_BUDGET_MS,
  AI_TIMEOUT_MS,
  BAD_REQUEST_STATUS,
  DEFAULT_MODEL,
  FALLBACK_MODELS,
  GEMINI_BASE,
  GENERATION,
  JSON_ONLY_SUFFIX,
  MODEL_NAME,
  MODEL_RETRY_STATUSES,
  RESPONSE_SCHEMA,
  SERVER_ERROR_MIN_STATUS,
} from './ai-config.js';
import { buildPrompt } from './ai-prompt.js';
import { extractText, parseModelJson, validateAiPlan } from './ai-validate.js';
import { AiError, UpstreamError } from './errors.js';
import { withRetry } from './retry.js';
import { fetchJson } from './upstream.js';

/**
 * @typedef {object} GenerateOptions
 * @property {typeof fetch} fetchImpl
 * @property {Record<string, string|undefined>} env
 * @property {object} facts
 * @property {string} notes
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {() => number} [random]
 * @property {number} [timeoutMs]
 * @property {number} [attempts]
 * @property {number} [budgetMs]
 */
/**
 * @typedef {object} Settings
 * @property {typeof fetch} fetchImpl
 * @property {(useSchema: boolean) => RequestInit} initFor
 * @property {number} deadline epoch ms after which no new call starts
 * @property {number} timeoutMs
 * @property {number} attempts
 * @property {import('./retry.js').RetryOptions} retry
 */

/**
 * Build the request. Schema mode asks Gemini to enforce the schema. JSON-only
 * mode describes it in the prompt and we validate the result ourselves.
 * @param {{system: string, user: string}} prompt
 * @param {string} apiKey
 * @returns {(useSchema: boolean) => RequestInit}
 */
function requestBuilder({ system, user }, apiKey) {
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
  return (useSchema) => ({
    method: 'POST',
    headers,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: useSchema ? system : `${system}\n${JSON_ONLY_SUFFIX} ${JSON.stringify(RESPONSE_SCHEMA)}` }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        ...GENERATION,
        responseMimeType: 'application/json',
        ...(useSchema ? { responseSchema: RESPONSE_SCHEMA } : {}),
      },
    }),
  });
}

/**
 * Retry timeouts-excluded upstream failures and malformed output.
 * @param {unknown} err
 * @returns {boolean}
 */
function isRetryable(err) {
  if (err instanceof AiError) return err.code === 'invalid_output';
  return err instanceof UpstreamError && err.kind !== 'timeout' && err.retryable;
}

/**
 * One request and validation, inside the remaining time budget.
 * @param {Settings} settings
 * @param {{model: string, init: RequestInit}} call
 */
async function requestPlan(settings, { model, init }) {
  const remaining = settings.deadline - Date.now();
  if (remaining <= 0) throw new UpstreamError('timeout');
  const url = `${GEMINI_BASE}/${model}:generateContent`;
  const data = await fetchJson(settings.fetchImpl, url, { init, timeoutMs: Math.min(settings.timeoutMs, remaining) });
  const checked = validateAiPlan(parseModelJson(extractText(data)));
  if (!checked.ok) throw new AiError('invalid_output');
  return /** @type {{summary: string, steps: object[]}} */ (checked.value);
}

/**
 * @param {Settings} settings
 * @param {{model: string, useSchema: boolean}} mode
 */
async function callMode(settings, { model, useSchema }) {
  const init = settings.initFor(useSchema);
  const plan = await withRetry(() => requestPlan(settings, { model, init }), {
    ...settings.retry,
    attempts: settings.attempts,
    isRetryable,
  });
  return { ...plan, model };
}

/**
 * Schema mode refused (400) or overloaded (5xx): retry on the same model in JSON-only mode.
 * @param {unknown} err
 * @returns {boolean}
 */
function schemaRefused(err) {
  return (
    err instanceof UpstreamError && err.kind === 'status' && (err.status === BAD_REQUEST_STATUS || err.status >= SERVER_ERROR_MIN_STATUS)
  );
}

/**
 * Schema mode first, then JSON-only mode on the same model if Google refuses the schema.
 * @param {Settings} settings
 * @param {string} model
 */
async function callModel(settings, model) {
  try {
    return await callMode(settings, { model, useSchema: true });
  } catch (err) {
    if (!schemaRefused(err)) throw err;
    return callMode(settings, { model, useSchema: false });
  }
}

/**
 * @param {unknown} err
 * @returns {boolean} true when the next model in the chain is worth trying
 */
function shouldTryNextModel(err) {
  if (!(err instanceof UpstreamError)) return false;
  if (err.kind === 'timeout') return true; // a hung model: move on instead of waiting again
  return err.kind === 'status' && (MODEL_RETRY_STATUSES.includes(err.status) || err.status >= SERVER_ERROR_MIN_STATUS);
}

/**
 * Whatever went wrong, the caller only ever sees an AiError.
 * @param {unknown} err
 * @returns {AiError}
 */
function toAiError(err) {
  if (err instanceof AiError) return err;
  if (!(err instanceof UpstreamError)) return new AiError('api_error', 'unexpected error');
  const reason = err.detail ? `: ${err.detail}` : '';
  const detail = err.kind === 'status' ? `HTTP ${err.status}${reason}` : err.kind;
  return new AiError(err.kind === 'timeout' ? 'timeout' : 'api_error', detail);
}

/**
 * @param {GenerateOptions} options
 * @returns {{settings: Settings, models: string[]}}
 */
function resolveSettings(options) {
  const { fetchImpl, env, facts, notes, sleep, random } = options;
  const primary = env.GEMINI_MODEL || DEFAULT_MODEL;
  if (!MODEL_NAME.test(primary)) throw new AiError('api_error', 'invalid model name');
  const settings = {
    fetchImpl,
    initFor: requestBuilder(buildPrompt(facts, notes), /** @type {string} */ (env.GEMINI_API_KEY)),
    deadline: Date.now() + (options.budgetMs ?? AI_BUDGET_MS),
    timeoutMs: options.timeoutMs ?? AI_TIMEOUT_MS,
    attempts: options.attempts ?? AI_ATTEMPTS,
    retry: { sleep, random },
  };
  return { settings, models: [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)] };
}

/**
 * Ask Gemini for a structured plan. Retries timeouts, 429, 5xx and malformed
 * output with exponential backoff, then throws an AiError.
 * @param {GenerateOptions} options
 * @returns {Promise<{summary: string, steps: object[], model: string}>}
 */
export async function generateAiPlan(options) {
  const { settings, models } = resolveSettings(options);
  let lastError;
  for (const model of models) {
    try {
      return await callModel(settings, model);
    } catch (err) {
      lastError = err;
      if (!shouldTryNextModel(err)) break;
    }
  }
  throw toAiError(lastError);
}
