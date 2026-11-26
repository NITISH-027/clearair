/**
 * HTTP plumbing: JSON responses and bounded JSON request-body reading.
 */
import { JSON_CONTENT_TYPE, MAX_BODY_BYTES, SECURITY_HEADERS } from './config.js';
import { HttpError } from './errors.js';

/**
 * Send a JSON response with the security headers.
 * @param {import('node:http').ServerResponse} res
 * @param {{status: number, body: object, headers?: Record<string, string>}} options
 */
export function sendJson(res, { status, body, headers = {} }) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': JSON_CONTENT_TYPE,
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

/**
 * Collect body chunks, rejecting once the size cap is passed.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 * @param {{resolve: Function, reject: Function}} settle
 */
function collectBody(req, maxBytes, { resolve, reject }) {
  let size = 0;
  let tooLarge = false;
  /** @type {Buffer[]} */
  const chunks = [];
  req.on('data', (chunk) => {
    if (tooLarge) return; // drain without buffering so the 413 can be delivered
    size += chunk.length;
    if (size <= maxBytes) {
      chunks.push(chunk);
      return;
    }
    tooLarge = true;
    chunks.length = 0;
    reject(new HttpError(413, 'too_large', 'Request body too large.'));
  });
  req.on('end', () => {
    if (tooLarge) return;
    try {
      resolve(parseJson(Buffer.concat(chunks)));
    } catch (err) {
      reject(err);
    }
  });
  req.on('error', () => reject(new HttpError(400, 'bad_request', 'Could not read the request.')));
}

/**
 * @param {Buffer} buffer
 * @returns {unknown}
 */
function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new HttpError(400, 'bad_json', 'Body is not valid JSON.');
  }
}

/**
 * Read a JSON body, enforcing content type and a hard size cap.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [maxBytes]
 * @returns {Promise<unknown>}
 */
export function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!type.startsWith('application/json')) {
      reject(new HttpError(415, 'unsupported_media_type', 'Send JSON.'));
      return;
    }
    collectBody(req, maxBytes, { resolve, reject });
  });
}
