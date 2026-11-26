/**
 * Server configuration: ports, timeouts, rate limits, cache sizes, upstream
 * URLs, MIME types and the security headers. All durations are milliseconds.
 */

export const DEFAULT_PORT = 8080;

/** Log level ordering; `silent` turns logging off. */
export const LOG_LEVELS = new Map([
  ['debug', 10],
  ['info', 20],
  ['warn', 30],
  ['error', 40],
  ['silent', 100],
]);

/** Node HTTP server timeouts (slow-client protection). */
export const REQUEST_TIMEOUT_MS = 30_000;
export const HEADERS_TIMEOUT_MS = 10_000;
export const KEEP_ALIVE_TIMEOUT_MS = 5_000;

/** Largest accepted request body, in bytes. */
export const MAX_BODY_BYTES = 8 * 1024;

/** Rate limiting: a fixed window, with per-client limits per window. */
export const RATE_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_KEYS = 2000;
export const PLAN_LIMIT_PER_MINUTE = 20;
export const AI_LIMIT_PER_MINUTE = 8;
export const RETRY_AFTER_SECONDS = '60';

/** Response cache for live air data and AI plans: 15 minutes, 200 entries each. */
export const CACHE_TTL_MS = 15 * 60 * 1000;
export const CACHE_MAX_ENTRIES = 200;

/** Static file caching: HTML always revalidates, other assets cache for an hour. */
export const CACHE_CONTROL_HTML = 'no-cache';
export const CACHE_CONTROL_ASSET = 'public, max-age=3600';

/** Third-party fetch behaviour (Open-Meteo). */
export const UPSTREAM_TIMEOUT_MS = 8000;
export const UPSTREAM_ATTEMPTS = 2;
export const ERROR_DETAIL_MAX = 160;

/** Retry backoff: base * 2^attempt, capped, jittered to 50-100%. */
export const RETRY_ATTEMPTS = 3;
export const RETRY_BASE_MS = 300;
export const RETRY_MAX_MS = 2000;
export const RETRY_JITTER_FLOOR = 0.5;

export const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const AIR_SOURCE = 'Open-Meteo Air Quality (CAMS model, US AQI)';
export const AIR_FORECAST_DAYS = '2';
export const AIR_HOURLY_POINTS = 24;
export const PLACE_FALLBACK_NAME = 'Your area';
export const COORDS_PLACE_NAME = 'Your location';
export const MANUAL_SOURCE = 'Entered by you';
export const LOCAL_ORIGIN = 'http://localhost';

export const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.webp', 'image/webp'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

/** Extra headers by error status. */
export const ERROR_HEADERS = new Map([
  [429, { 'Retry-After': RETRY_AFTER_SECONDS }],
  [405, { Allow: 'GET, POST, OPTIONS' }],
  [413, { Connection: 'close' }],
]);

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

export const CORS_MAX_AGE_SECONDS = '600';
