import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, SECURITY_HEADERS, clientKey, corsHeaders, parseAllowedOrigins, readJsonBody, sendJson } from './http.js';
import { RateLimiter } from './ratelimit.js';
import { createPlanService } from './plan-service.js';
import { parsePlanRequest } from './request.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.webp', 'image/webp'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

export const PLAN_LIMIT_PER_MINUTE = 20;

const ERROR_HEADERS = new Map([
  [429, { 'Retry-After': '60' }],
  [405, { Allow: 'GET, POST, OPTIONS' }],
  [413, { Connection: 'close' }],
]);

const notFound = () => new HttpError(404, 'not_found', 'Not found.');

/**
 * Load every servable file into memory once, keyed by URL path. Requests are
 * looked up in this map, so no request text ever reaches the file system.
 */
export function loadStaticFiles(publicDir = PUBLIC_DIR, sharedDir = SHARED_DIR) {
  const files = new Map();
  const add = (dir, prefix) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- our own folders, not request input
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const type = MIME.get(path.extname(entry.name));
      if (!type) continue;
      const full = path.join(entry.parentPath, entry.name);
      const url = prefix + path.relative(dir, full).split(path.sep).join('/');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from readdir of our own folders
      files.set(url, { type, data: readFileSync(full) });
    }
  };
  add(publicDir, '/');
  add(sharedDir, '/shared/');
  return files;
}

function serveStatic(req, res, files, pathname) {
  let key;
  try {
    key = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    throw new HttpError(400, 'bad_path', 'Bad path.');
  }
  const file = files.get(key);
  if (!file) throw notFound();
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': file.type,
    'Content-Length': file.data.length,
    'Cache-Control': file.type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(req.method === 'HEAD' ? undefined : file.data);
}

/**
 * Create the HTTP server. Dependencies are injectable for tests.
 * @param {{fetchImpl?: typeof fetch, env?: object, sleep?: Function, random?: Function, retry?: object}} [options]
 */
export function createServer({ fetchImpl = fetch, env = process.env, sleep, random, retry } = {}) {
  const service = createPlanService({ fetchImpl, env, sleep, random, retry });
  const staticFiles = loadStaticFiles();
  const limiter = new RateLimiter(60_000);
  const trustProxy = env.TRUST_PROXY === '1';
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);

  async function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { pathname } = url;
    const isApi = pathname.startsWith('/api/');
    const cors = isApi ? corsHeaders(req, allowedOrigins) : {};

    if (pathname === '/healthz') return sendJson(res, 200, { ok: true });

    if (isApi && req.method === 'OPTIONS') {
      res.writeHead(204, { ...SECURITY_HEADERS, ...cors });
      return res.end();
    }
    if (pathname === '/api/config') {
      if (req.method !== 'GET') throw new HttpError(405, 'method_not_allowed', 'Use GET.');
      return sendJson(res, 200, { aiEnabled: service.aiEnabled }, cors);
    }
    if (pathname === '/api/plan') {
      if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST.');
      const key = clientKey(req, trustProxy);
      if (!limiter.allow(`plan:${key}`, PLAN_LIMIT_PER_MINUTE)) throw new HttpError(429, 'rate_limited', 'Too many requests. Wait a minute.');
      const request = parsePlanRequest(await readJsonBody(req));
      return sendJson(res, 200, await service.createResponse(request, `ai:${key}`), cors);
    }
    if (isApi) throw notFound();
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Use GET.');
    return serveStatic(req, res, staticFiles, pathname);
  }

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      const known = err instanceof HttpError;
      if (!known) console.error('Unhandled error:', err?.name);
      const status = known ? err.status : 500;
      const extra = ERROR_HEADERS.get(status) ?? {};
      sendJson(res, status, { error: known ? err.code : 'internal_error', message: known ? err.message : 'Something went wrong.' }, extra);
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.planService = service;
  return server;
}
