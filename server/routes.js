/**
 * Request routing: health check, the JSON API and static files.
 */
import { LOCAL_ORIGIN, PLAN_LIMIT_PER_MINUTE, SECURITY_HEADERS } from './config.js';
import { HttpError, NotFoundError, RateLimitError } from './errors.js';
import { readJsonBody, sendJson } from './http.js';
import { parsePlanRequest } from './request.js';
import { clientKey, corsHeaders } from './security.js';
import { findStaticFile, sendStaticFile } from './static.js';

/**
 * @typedef {object} RouteContext
 * @property {{createResponse: Function, aiEnabled: boolean}} service
 * @property {import('./ratelimit.js').RateLimiter} limiter
 * @property {boolean} trustProxy
 * @property {Set<string>} allowedOrigins
 * @property {Map<string, {type: string, data: Buffer}>} staticFiles
 */

/**
 * @param {string} method
 * @returns {HttpError}
 */
const methodNotAllowed = (method) => new HttpError(405, 'method_not_allowed', `Use ${method}.`);

/**
 * GET /api/config: tells the page whether Gemini is configured.
 * @param {import('node:http').IncomingMessage} _req unused
 * @param {import('node:http').ServerResponse} res
 * @param {{ctx: RouteContext, cors: Record<string, string>}} call
 */
function handleConfig(_req, res, { ctx, cors }) {
  sendJson(res, { status: 200, body: { aiEnabled: ctx.service.aiEnabled }, headers: cors });
}

/**
 * POST /api/plan: validate, rate limit, build the plan.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ctx: RouteContext, cors: Record<string, string>}} call
 */
async function handlePlan(req, res, { ctx, cors }) {
  const key = clientKey(req, ctx.trustProxy);
  if (!ctx.limiter.allow(`plan:${key}`, PLAN_LIMIT_PER_MINUTE)) throw new RateLimitError();
  const request = parsePlanRequest(await readJsonBody(req));
  const body = await ctx.service.createResponse(request, `ai:${key}`);
  sendJson(res, { status: 200, body, headers: cors });
}

/** API routes by path: the allowed method and its handler. */
const API_ROUTES = new Map([
  ['/api/config', { method: 'GET', handle: handleConfig }],
  ['/api/plan', { method: 'POST', handle: handlePlan }],
]);

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ctx: RouteContext, pathname: string}} call
 */
async function handleApi(req, res, { ctx, pathname }) {
  const cors = corsHeaders(req, ctx.allowedOrigins);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...SECURITY_HEADERS, ...cors });
    res.end();
    return;
  }
  const route = API_ROUTES.get(pathname);
  if (!route) throw new NotFoundError();
  if (req.method !== route.method) throw methodNotAllowed(route.method);
  await route.handle(req, res, { ctx, cors });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ctx: RouteContext, pathname: string}} call
 */
function handleStatic(req, res, { ctx, pathname }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed('GET');
  sendStaticFile(req, res, findStaticFile(ctx.staticFiles, pathname));
}

/**
 * Create the request router.
 * @param {RouteContext} ctx
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createRouter(ctx) {
  return async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', LOCAL_ORIGIN);
    if (pathname === '/healthz') return sendJson(res, { status: 200, body: { ok: true } });
    if (pathname.startsWith('/api/')) return handleApi(req, res, { ctx, pathname });
    return handleStatic(req, res, { ctx, pathname });
  };
}
