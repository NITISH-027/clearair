import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../server/logger.js';
import { handleError } from '../server/error-handler.js';
import { AiError, HttpError, NotFoundError, RateLimitError, UpstreamApiError, UpstreamError, ValidationError } from '../server/errors.js';
import { findStaticFile, loadStaticFiles, sendStaticFile } from '../server/static.js';
import { hourLabel, isPlainObject, round1 } from '../shared/util.js';
import { categoryFor, pm25ToAqi } from '../shared/aqi.js';

const fakeRes = () => {
  const res = { head: null, body: null };
  res.writeHead = (status, headers) => {
    res.head = { status, headers };
  };
  res.end = (body) => {
    res.body = body;
  };
  return res;
};

test('the logger writes one JSON line per event and honours the level', () => {
  const lines = [];
  let level = 'warn';
  const log = createLogger({ write: (lvl, line) => lines.push([lvl, JSON.parse(line)]), level: () => level });
  log.info('hidden');
  log.warn('shown', { code: 'x' });
  level = 'nonsense';
  log.info('now visible');
  level = 'silent';
  log.error('muted');
  assert.deepEqual(
    lines.map(([lvl, row]) => [lvl, row.event]),
    [
      ['warn', 'shown'],
      ['info', 'now visible'],
    ],
  );
  assert.equal(lines[0][1].code, 'x');
  assert.ok(lines[0][1].time);
});

test('the default logger writes to the standard streams', () => {
  const writes = [];
  const out = process.stdout.write;
  const err = process.stderr.write;
  process.stdout.write = (text) => writes.push(['out', text]);
  process.stderr.write = (text) => writes.push(['err', text]);
  try {
    const log = createLogger({ level: () => 'debug' });
    log.info('a');
    log.error('b');
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  assert.deepEqual(
    writes.map((w) => w[0]),
    ['out', 'err'],
  );
});

test('domain errors carry the right status and code', () => {
  assert.deepEqual(
    [new ValidationError('c', 'm'), new NotFoundError(), new UpstreamApiError('c', 'm'), new RateLimitError()].map((e) => e.status),
    [400, 404, 502, 429],
  );
  assert.ok(new RateLimitError() instanceof HttpError);
  assert.equal(new UpstreamError('status', 503).message, 'Upstream status 503');
  assert.equal(new AiError('timeout').message, 'AI timeout');
});

test('the central error handler maps known errors and hides unknown ones', () => {
  process.env.LOG_LEVEL = 'silent';
  const known = fakeRes();
  handleError(known, new RateLimitError());
  assert.equal(known.head.status, 429);
  assert.equal(known.head.headers['Retry-After'], '60');
  assert.equal(JSON.parse(known.body).error, 'rate_limited');
  const unknown = fakeRes();
  handleError(unknown, new TypeError('secret detail'));
  assert.equal(unknown.head.status, 500);
  assert.ok(!unknown.body.includes('secret'));
  handleError(fakeRes(), undefined);
});

test('static lookup serves known files and rejects bad or unknown paths', () => {
  const files = loadStaticFiles();
  assert.equal(findStaticFile(files, '/').type, 'text/html; charset=utf-8');
  assert.throws(
    () => findStaticFile(files, '/%E0%A4%A'),
    (e) => e.status === 400,
  );
  assert.throws(() => findStaticFile(files, '/nope.js'), NotFoundError);
  const res = fakeRes();
  sendStaticFile({ method: 'HEAD' }, res, findStaticFile(files, '/'));
  assert.equal(res.body, undefined);
  assert.equal(res.head.headers['Cache-Control'], 'no-cache');
});

test('small helpers behave on edge input', () => {
  assert.equal(hourLabel('2026-11-26T00:00'), '12 AM');
  assert.equal(hourLabel('2026-11-26T14:00'), '2 PM');
  assert.equal(hourLabel('2026-11-26Txx:00'), '');
  assert.equal(round1(1.26), 1.3);
  assert.deepEqual([{}, [], null, 'x'].map(isPlainObject), [true, false, false, false]);
  assert.equal(pm25ToAqi(1000), 500);
  assert.equal(categoryFor(999).label, 'Hazardous');
});
