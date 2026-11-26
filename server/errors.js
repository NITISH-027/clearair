/**
 * Domain error classes. HTTP errors carry the status and a stable `code` the
 * central error handler turns into a JSON response.
 */

/** Error with an HTTP status and a stable machine-readable code. */
export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} code stable error code sent to the client
   * @param {string} message safe, human-readable text sent to the client
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/** The client sent something invalid (HTTP 400). */
export class ValidationError extends HttpError {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(400, code, message);
    this.name = 'ValidationError';
  }
}

/** A requested thing does not exist (HTTP 404). */
export class NotFoundError extends HttpError {
  /**
   * @param {string} [code]
   * @param {string} [message]
   */
  constructor(code = 'not_found', message = 'Not found.') {
    super(404, code, message);
    this.name = 'NotFoundError';
  }
}

/** A third-party service failed or gave no usable answer (HTTP 502). */
export class UpstreamApiError extends HttpError {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(502, code, message);
    this.name = 'UpstreamApiError';
  }
}

/** The client is over a rate limit (HTTP 429). */
export class RateLimitError extends HttpError {
  /** @param {string} [message] */
  constructor(message = 'Too many requests. Wait a minute.') {
    super(429, 'rate_limited', message);
    this.name = 'RateLimitError';
  }
}

/** Low-level failure talking to a third party. `kind` is timeout, network, status or parse. */
export class UpstreamError extends Error {
  /**
   * @param {'timeout'|'network'|'status'|'parse'} kind
   * @param {number} [status] upstream HTTP status, when there was one
   * @param {string} [detail] short single-line upstream message, never headers
   */
  constructor(kind, status = 0, detail = '') {
    const suffix = status ? ` ${status}` : '';
    super(`Upstream ${kind}${suffix}`);
    this.detail = detail;
    this.name = 'UpstreamError';
    this.kind = kind;
    this.status = status;
  }

  /** True for timeouts, network errors, 429 and 5xx: worth another try. */
  get retryable() {
    return this.kind === 'timeout' || this.kind === 'network' || this.status === 429 || this.status >= 500;
  }
}

/** Failure to get a usable plan from the model. `code` is timeout, api_error or invalid_output. */
export class AiError extends Error {
  /**
   * @param {'timeout'|'api_error'|'invalid_output'} code
   * @param {string} [detail]
   */
  constructor(code, detail = '') {
    super(`AI ${code}`);
    this.detail = detail;
    this.name = 'AiError';
    this.code = code;
  }
}
