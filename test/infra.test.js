import test from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from '../server/cache.js';
import { RateLimiter } from '../server/ratelimit.js';
import { backoffDelay, withRetry } from '../server/retry.js';
import { UpstreamError, fetchJson, fetchJsonWithRetry } from '../server/upstream.js';
import { corsHeaders, parseAllowedOrigins, clientKey, HttpError } from '../server/http.js';
import { pickHourly } from '../server/air.js';
import { json, timeoutError } from './helpers.js';

test('TtlCache expires entries and bounds its size', () => {
  const cache = new TtlCache(1000, 2);
  cache.set('a', 1, 0);
  assert.equal(cache.get('a', 500), 1);
  assert.equal(cache.get('a', 1500), undefined);
  cache.set('b', 2, 0);
  cache.set('c', 3, 0);
  cache.set('d', 4, 0);
  assert.equal(cache.map.size, 2);
  assert.equal(cache.get('b', 1), undefined);
});

test('TtlCache.getOrLoad shares one in-flight load and caches the result', async () => {
  const cache = new TtlCache(60_000, 10);
  let calls = 0;
  const loader = async () => { calls += 1; await new Promise((r) => setTimeout(r, 10)); return { n: calls }; };
  const [a, b] = await Promise.all([cache.getOrLoad('k', loader), cache.getOrLoad('k', loader)]);
  assert.equal(a, b);
  assert.equal(await cache.getOrLoad('k', loader), a);
  assert.equal(calls, 1);
});

test('TtlCache.getOrLoad can refuse to cache degraded results and clears pending on error', async () => {
  const cache = new TtlCache(60_000, 10);
  let calls = 0;
  const loader = async () => { calls += 1; return { ok: false }; };
  await cache.getOrLoad('k', loader, (v) => v.ok);
  await cache.getOrLoad('k', loader, (v) => v.ok);
  assert.equal(calls, 2);
  await assert.rejects(cache.getOrLoad('boom', async () => { throw new Error('x'); }));
  assert.equal(cache.pending.size, 0);
  assert.equal(await cache.getOrLoad('boom', async () => 5), 5);
});

test('RateLimiter blocks after the limit and resets after its window', () => {
  const rl = new RateLimiter(1000);
  assert.equal(rl.allow('k', 2, 0), true);
  assert.equal(rl.allow('k', 2, 1), true);
  assert.equal(rl.allow('k', 2, 2), false);
  assert.equal(rl.allow('k', 2, 1001), true);
});

test('RateLimiter prunes expired keys and never grows without bound', () => {
  const rl = new RateLimiter(1000, 3);
  for (let i = 0; i < 4; i += 1) rl.allow(`k${i}`, 5, 0);
  rl.allow('fresh', 5, 5000);
  assert.ok(rl.hits.size <= 2);
  const full = new RateLimiter(1_000_000, 2);
  for (let i = 0; i < 6; i += 1) full.allow(`k${i}`, 5, 0);
  assert.ok(full.hits.size <= 3);
});

test('backoffDelay doubles, caps and jitters', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => backoffDelay(i, { random: () => 1 })), [300, 600, 1200, 2000, 2000]);
  assert.equal(backoffDelay(0, { random: () => 0 }), 150);
});

test('withRetry stops on non-retryable errors and rethrows the last error', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw new Error('fatal'); }, { isRetryable: () => false, sleep: async () => {} }), /fatal/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw new Error(`n${calls}`); }, { attempts: 3, sleep: async () => {} }), /n3/);
  assert.equal(calls, 3);
  assert.equal(await withRetry(async (i) => i, { sleep: async () => {} }), 0);
});

test('fetchJson classifies timeouts, network errors, status errors and bad bodies', async () => {
  await assert.rejects(fetchJson(async () => { throw timeoutError(); }, 'http://x'), (e) => e.kind === 'timeout' && e.retryable);
  await assert.rejects(fetchJson(async () => { throw new Error('down'); }, 'http://x'), (e) => e.kind === 'network' && e.retryable);
  await assert.rejects(fetchJson(async () => json({}, false, 404), 'http://x'), (e) => e.kind === 'status' && !e.retryable);
  await assert.rejects(fetchJson(async () => json({}, false, 503), 'http://x'), (e) => e.retryable);
  await assert.rejects(fetchJson(async () => ({ ok: true, json: async () => { throw new Error('x'); } }), 'http://x'), (e) => e.kind === 'parse' && !e.retryable);
  assert.deepEqual(await fetchJson(async () => json({ a: 1 }), 'http://x'), { a: 1 });
  assert.ok(new UpstreamError('status', 429).retryable);
});

test('fetchJsonWithRetry retries once by default then gives up', async () => {
  let calls = 0;
  const impl = async () => { calls += 1; return json({}, false, 503); };
  await assert.rejects(fetchJsonWithRetry(impl, 'http://x', {}, { sleep: async () => {}, random: () => 1 }));
  assert.equal(calls, 2);
});

test('pickHourly keeps the next 24 valid points', () => {
  const times = Array.from({ length: 48 }, (_, i) => `2026-11-${i < 24 ? '26' : '27'}T${String(i % 24).padStart(2, '0')}:00`);
  const out = pickHourly({ time: times, pm2_5: times.map(() => 10), us_aqi: times.map(() => 40) }, '2026-11-26T10:00');
  assert.equal(out.length, 24);
  assert.equal(out[0].time, '2026-11-26T10:00');
  assert.deepEqual(pickHourly(null, 'x'), []);
  assert.deepEqual(pickHourly({ time: ['2026-11-26T10:00'], pm2_5: [null], us_aqi: [1] }, '2026-11-26T00:00'), []);
  assert.deepEqual(pickHourly({ time: [5], pm2_5: [1], us_aqi: [1] }, 'a'), []);
});

test('parseAllowedOrigins trims, drops empties and trailing slashes', () => {
  assert.deepEqual([...parseAllowedOrigins(' https://a.example/ , ,https://b.example')], ['https://a.example', 'https://b.example']);
  assert.equal(parseAllowedOrigins(undefined).size, 0);
});

test('corsHeaders allows same-origin and listed origins and rejects others', () => {
  const allow = parseAllowedOrigins('https://app.example');
  assert.deepEqual(corsHeaders({ headers: {} }, allow), {});
  assert.deepEqual(corsHeaders({ headers: { origin: 'http://h:1', host: 'h:1' } }, allow), {});
  assert.equal(corsHeaders({ headers: { origin: 'https://app.example', host: 'h:1' } }, allow)['Access-Control-Allow-Origin'], 'https://app.example');
  assert.throws(() => corsHeaders({ headers: { origin: 'https://evil.example', host: 'h:1' } }, allow), (e) => e instanceof HttpError && e.status === 403);
  assert.throws(() => corsHeaders({ headers: { origin: 'null', host: 'h:1' } }, allow), HttpError);
});

test('clientKey trusts X-Forwarded-For only behind a proxy', () => {
  const req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: { remoteAddress: '9.9.9.9' } };
  assert.equal(clientKey(req, true), '1.2.3.4');
  assert.equal(clientKey(req, false), '9.9.9.9');
  assert.equal(clientKey({ headers: {}, socket: {} }, true), 'unknown');
});

test('withRetry uses a real timer by default', async () => {
  let calls = 0;
  const started = Date.now();
  await assert.rejects(withRetry(async () => { calls += 1; throw new Error('x'); }, { attempts: 2, baseMs: 2, maxMs: 2 }));
  assert.equal(calls, 2);
  assert.ok(Date.now() - started >= 1);
});
