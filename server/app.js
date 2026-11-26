/**
 * Builds the HTTP server: wires the plan service, rate limiter, static files,
 * router and the central error handler. Dependencies are injectable for tests.
 */
import http from 'node:http';
import { HEADERS_TIMEOUT_MS, KEEP_ALIVE_TIMEOUT_MS, RATE_WINDOW_MS, REQUEST_TIMEOUT_MS } from './config.js';
import { handleError } from './error-handler.js';
import { createPlanService } from './plan-service.js';
import { RateLimiter } from './ratelimit.js';
import { createRouter } from './routes.js';
import { parseAllowedOrigins } from './security.js';
import { loadStaticFiles } from './static.js';

/**
 * Create the HTTP server.
 * @param {{fetchImpl?: typeof fetch, env?: Record<string, string|undefined>, sleep?: (ms: number) => Promise<void>, random?: () => number, retry?: object}} [options]
 * @returns {http.Server & {planService: object}}
 */
export function createServer({ fetchImpl = fetch, env = process.env, sleep, random, retry } = {}) {
  const service = createPlanService({ fetchImpl, env, sleep, random, retry });
  const route = createRouter({
    service,
    limiter: new RateLimiter(RATE_WINDOW_MS),
    trustProxy: env.TRUST_PROXY === '1',
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    staticFiles: loadStaticFiles(),
  });
  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      handleError(res, err);
    }
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  return Object.assign(server, { planService: service });
}
