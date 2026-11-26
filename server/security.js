/**
 * Request-trust helpers: client identification for rate limiting and the CORS
 * allowlist. The response security headers live in config.js.
 */
import { CORS_MAX_AGE_SECONDS } from './config.js';
import { HttpError } from './errors.js';

/**
 * Identify the client for rate limiting. Only trust X-Forwarded-For behind a known proxy.
 * @param {import('node:http').IncomingMessage} req
 * @param {boolean} trustProxy
 * @returns {string}
 */
export function clientKey(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')[0]
      .trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Parse ALLOWED_ORIGINS (comma separated) into a Set of origins.
 * @param {unknown} value
 * @returns {Set<string>}
 */
export function parseAllowedOrigins(value) {
  if (typeof value !== 'string') return new Set();
  return new Set(
    value
      .split(',')
      .map((v) => v.trim().replace(/\/$/, ''))
      .filter(Boolean),
  );
}

/**
 * @param {string} origin
 * @returns {string} the origin's host
 */
function hostOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    throw new HttpError(403, 'origin_not_allowed', 'Origin not allowed.');
  }
}

/**
 * CORS allowlist. Same-origin requests and requests without an Origin header
 * pass. Cross-origin requests must come from an allowlisted origin.
 * @param {import('node:http').IncomingMessage} req
 * @param {Set<string>} allowedOrigins
 * @returns {Record<string, string>} headers to add to the response
 */
export function corsHeaders(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) return {};
  if (hostOf(origin) === req.headers.host) return {};
  if (!allowedOrigins.has(origin)) throw new HttpError(403, 'origin_not_allowed', 'Origin not allowed.');
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': CORS_MAX_AGE_SECONDS,
  };
}
