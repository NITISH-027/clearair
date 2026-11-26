import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCity, validateCoordinates, validateProfile, validateAqi } from './shared/validate.js';
import { ACTION_CATALOG } from './shared/planner.js';
import { categoryFor } from './shared/aqi.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIRS = { '/shared/': path.join(ROOT, 'shared'), '/': path.join(ROOT, 'public') };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const MAX_BODY_BYTES = 8 * 1024;
const UPSTREAM_TIMEOUT_MS = 8000;
const AIR_CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const RATE_LIMIT = { windowMs: 60_000, air: 30, explain: 8 };

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Small TTL + size-bounded cache. */
export class TtlCache {
  constructor(ttlMs, maxEntries) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key, now = Date.now()) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= now) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value, now = Date.now()) {
    if (this.map.size >= this.maxEntries) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { value, expires: now + this.ttlMs });
  }
}

/** Fixed-window per-key rate limiter. */
export class RateLimiter {
  constructor(windowMs, maxKeys = 2000) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.hits = new Map();
  }

  allow(key, limit, now = Date.now()) {
    if (this.hits.size > this.maxKeys) {
      for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
      if (this.hits.size > this.maxKeys) this.hits.clear();
    }
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] ?? '');
    if (!type.toLowerCase().startsWith('application/json')) {
      reject(new HttpError(415, 'unsupported_media_type', 'Send JSON.'));
      return;
    }
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (tooLarge) return; // drain without buffering so the 413 can be delivered
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, 'too_large', 'Request body too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'bad_json', 'Body is not valid JSON.'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'bad_request', 'Could not read the request.')));
  });
}

function clientKey(req, trustProxy) {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

async function fetchJson(fetchImpl, url, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, 'upstream_unreachable', 'The air quality service did not respond.');
  }
  if (!response.ok) throw new HttpError(502, 'upstream_error', 'The air quality service returned an error.');
  try {
    return await response.json();
  } catch {
    throw new HttpError(502, 'upstream_bad_data', 'The air quality service returned unreadable data.');
  }
}

/** Reduce an Open-Meteo response to the next 24 hourly points from `currentTime`. */
export function pickHourly(hourly, currentTime) {
  const times = hourly?.time;
  const pm = hourly?.pm2_5;
  const aqi = hourly?.us_aqi;
  if (!Array.isArray(times) || !Array.isArray(pm) || !Array.isArray(aqi)) return [];
  const points = [];
  for (let i = 0; i < times.length && points.length < 24; i += 1) {
    if (typeof times[i] !== 'string' || times[i] < currentTime) continue;
    if (!Number.isFinite(pm[i]) || !Number.isFinite(aqi[i])) continue;
    points.push({ time: times[i], pm25: pm[i], aqi: aqi[i] });
  }
  return points;
}

async function resolvePlace(fetchImpl, query) {
  if (query.city) {
    const url = `${GEOCODE_URL}?${new URLSearchParams({ name: query.city, count: '1', language: 'en', format: 'json' })}`;
    const data = await fetchJson(fetchImpl, url);
    const hit = data?.results?.[0];
    if (!hit) throw new HttpError(404, 'place_not_found', 'We could not find that place. Try a nearby city.');
    return {
      name: String(hit.name),
      region: hit.admin1 ? String(hit.admin1) : '',
      country: hit.country ? String(hit.country) : '',
      lat: hit.latitude,
      lon: hit.longitude,
    };
  }
  return { name: 'Your location', region: '', country: '', lat: query.lat, lon: query.lon };
}

async function loadAir(fetchImpl, cache, query) {
  const cacheKey = query.city ? `c:${query.city.toLowerCase()}` : `p:${query.lat.toFixed(2)},${query.lon.toFixed(2)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const place = await resolvePlace(fetchImpl, query);
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: 'us_aqi,pm2_5,pm10',
    hourly: 'us_aqi,pm2_5',
    forecast_days: '2',
    timezone: 'auto',
  });
  const data = await fetchJson(fetchImpl, `${AIR_URL}?${params}`);
  const cur = data?.current;
  if (!cur || !Number.isFinite(cur.us_aqi) || !Number.isFinite(cur.pm2_5)) {
    throw new HttpError(502, 'no_reading', 'No current air quality reading for that place.');
  }
  const result = {
    place,
    current: { aqi: Math.round(cur.us_aqi), pm25: cur.pm2_5, pm10: Number.isFinite(cur.pm10) ? cur.pm10 : null, time: cur.time },
    hourly: pickHourly(data.hourly, cur.time),
    source: 'Open-Meteo Air Quality (CAMS model, US AQI)',
  };
  cache.set(cacheKey, result);
  return result;
}

function parseAirQuery(url) {
  const params = url.searchParams;
  if (params.has('city')) {
    const city = validateCity(params.get('city'));
    if (!city.ok) throw new HttpError(400, 'bad_city', city.error);
    return { city: city.value };
  }
  if (params.has('lat') || params.has('lon')) {
    const coords = validateCoordinates(params.get('lat'), params.get('lon'));
    if (!coords.ok) throw new HttpError(400, 'bad_coordinates', coords.error);
    return coords.value;
  }
  throw new HttpError(400, 'missing_query', 'Give a city or coordinates.');
}

function buildExplainPrompt(body) {
  const profile = validateProfile(body.profile);
  const aqi = validateAqi(body.aqi);
  if (!profile.ok) throw new HttpError(400, 'bad_profile', profile.errors[0]);
  if (!aqi.ok) throw new HttpError(400, 'bad_aqi', aqi.error);
  const ids = Array.isArray(body.actionIds) ? body.actionIds : [];
  if (ids.length === 0 || ids.length > 30 || !ids.every((id) => typeof id === 'string' && Object.hasOwn(ACTION_CATALOG, id))) {
    throw new HttpError(400, 'bad_actions', 'Unknown actions.');
  }
  const h = profile.value.household;
  const people = ['children', 'elderly', 'respiratory', 'pregnant'].filter((k) => h[k]);
  const titles = ids.map((id) => `- ${ACTION_CATALOG[id].title}`).join('\n');
  // Only validated enums, numbers and catalogue titles reach the model.
  return [
    'You are a calm, practical air quality coach writing for a family in India.',
    `Today the US AQI is ${aqi.value} (${categoryFor(aqi.value).label}).`,
    `Household sensitivities: ${people.length ? people.join(', ') : 'none stated'}.`,
    'Their plan has these actions:',
    titles,
    'Write 4 to 6 short sentences in plain English that explain why this plan fits their day and what to do first.',
    'Do not give medical diagnoses. Do not add actions that are not listed. No lists, no markdown.',
  ].join('\n');
}

async function explainWithGemini(fetchImpl, env, prompt) {
  const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
  if (!/^[a-z0-9.-]{3,40}$/i.test(model)) throw new HttpError(503, 'ai_unavailable', 'AI help is not configured.');
  const data = await fetchJson(fetchImpl, `${GEMINI_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.4 },
    }),
  }).catch((err) => {
    throw new HttpError(503, 'ai_unavailable', err.status === 502 ? 'AI help is busy right now.' : 'AI help failed.');
  });
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(503, 'ai_unavailable', 'AI help returned nothing.');
  return text.trim().slice(0, 1200);
}

async function serveStatic(req, res, pathname) {
  let rel = pathname;
  let baseDir = STATIC_DIRS['/'];
  if (pathname.startsWith('/shared/')) {
    baseDir = STATIC_DIRS['/shared/'];
    rel = pathname.slice('/shared'.length);
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    throw new HttpError(400, 'bad_path', 'Bad path.');
  }
  if (decoded.includes('\0')) throw new HttpError(400, 'bad_path', 'Bad path.');
  const full = path.resolve(baseDir, `.${decoded}`);
  if (full !== baseDir && !full.startsWith(baseDir + path.sep)) throw new HttpError(404, 'not_found', 'Not found.');
  const type = MIME[path.extname(full)];
  if (!type) throw new HttpError(404, 'not_found', 'Not found.');
  let data;
  try {
    data = await readFile(full);
  } catch {
    throw new HttpError(404, 'not_found', 'Not found.');
  }
  const isHtml = type.startsWith('text/html');
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

/**
 * Create the HTTP server. Dependencies are injectable for tests.
 * @param {{fetchImpl?: typeof fetch, env?: object}} [options]
 */
export function createServer({ fetchImpl = fetch, env = process.env } = {}) {
  const airCache = new TtlCache(AIR_CACHE_TTL_MS, CACHE_MAX_ENTRIES);
  const limiter = new RateLimiter(RATE_LIMIT.windowMs);
  const trustProxy = env.TRUST_PROXY === '1';
  const aiAvailable = Boolean(env.GEMINI_API_KEY);

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const { pathname } = url;
      const key = clientKey(req, trustProxy);

      if (pathname === '/healthz') return sendJson(res, 200, { ok: true });
      if (pathname === '/api/config') return sendJson(res, 200, { aiAvailable });

      if (pathname === '/api/air') {
        if (req.method !== 'GET') throw new HttpError(405, 'method_not_allowed', 'Use GET.');
        if (!limiter.allow(`air:${key}`, RATE_LIMIT.air)) throw new HttpError(429, 'rate_limited', 'Too many requests. Wait a minute.');
        const data = await loadAir(fetchImpl, airCache, parseAirQuery(url));
        return sendJson(res, 200, data);
      }

      if (pathname === '/api/explain') {
        if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST.');
        if (!aiAvailable) throw new HttpError(503, 'ai_unavailable', 'AI help is not configured.');
        if (!limiter.allow(`explain:${key}`, RATE_LIMIT.explain)) throw new HttpError(429, 'rate_limited', 'Too many requests. Wait a minute.');
        const body = await readJsonBody(req);
        const prompt = buildExplainPrompt(body ?? {});
        const text = await explainWithGemini(fetchImpl, env, prompt);
        return sendJson(res, 200, { text });
      }

      if (pathname.startsWith('/api/')) throw new HttpError(404, 'not_found', 'Not found.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Use GET.');
      return await serveStatic(req, res, pathname);
    } catch (err) {
      const known = err instanceof HttpError;
      if (!known) console.error('Unhandled error:', err?.message);
      const status = known ? err.status : 500;
      const extra = status === 429 ? { 'Retry-After': '60' } : status === 405 ? { Allow: 'GET, POST' } : status === 413 ? { Connection: 'close' } : {};
      return sendJson(res, status, { error: known ? err.code : 'internal_error', message: known ? err.message : 'Something went wrong.' }, extra);
    }
  };

  const server = http.createServer(handler);
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 8080;
  createServer().listen(port, () => console.log(`ClearAir listening on :${port}`));
}
