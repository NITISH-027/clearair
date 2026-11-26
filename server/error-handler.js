/**
 * The one place errors become HTTP responses. Known domain errors keep their
 * status and code; anything else is logged by name only and answered with a
 * generic 500.
 */
import { ERROR_HEADERS } from './config.js';
import { HttpError } from './errors.js';
import { sendJson } from './http.js';
import { logger } from './logger.js';

/**
 * Send the JSON error response for `err`.
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} err
 */
export function handleError(res, err) {
  const known = err instanceof HttpError;
  if (!known) logger.error('unhandled_error', { name: /** @type {any} */ (err)?.name });
  const status = known ? err.status : 500;
  sendJson(res, {
    status,
    body: { error: known ? err.code : 'internal_error', message: known ? err.message : 'Something went wrong.' },
    headers: /** @type {Record<string, string>} */ (ERROR_HEADERS.get(status) ?? {}),
  });
}
