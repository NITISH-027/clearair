// HTTP plumbing: errors, JSON responses, body reading, security headers, CORS.

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

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

export const MAX_BODY_BYTES = 8 * 1024;

export function sendJson(res, status, body, extraHeaders = {}) {
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

/** Read a JSON body, enforcing content type and a hard size cap. */
export function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!type.startsWith('application/json')) {
      reject(new HttpError(415, 'unsupported_media_type', 'Send JSON.'));
      return;
    }
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (tooLarge) return; // drain without buffering so the 413 can be delivered
      size += chunk.length;
      if (size > maxBytes) {
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

/** Identify the client for rate limiting. Only trust X-Forwarded-For behind a known proxy. */
export function clientKey(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Parse ALLOWED_ORIGINS (comma separated) into a Set of origins. */
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
 * CORS allowlist. Same-origin requests and requests without an Origin header
 * pass. Cross-origin requests must come from an allowlisted origin.
 * @returns {Record<string,string>} headers to add to the response
 */
export function corsHeaders(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) return {};
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'origin_not_allowed', 'Origin not allowed.');
  }
  if (host === req.headers.host) return {};
  if (!allowedOrigins.has(origin)) throw new HttpError(403, 'origin_not_allowed', 'Origin not allowed.');
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
  };
}
