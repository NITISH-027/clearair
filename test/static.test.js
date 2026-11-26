import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Paths are relative to the repo root, where `npm test` runs.
const html = readFileSync('public/index.html', 'utf8');
const css = readFileSync('public/styles.css', 'utf8');

test('the page has no inline scripts, inline styles or event handler attributes (strict CSP)', () => {
  assert.ok(!/<style[\s>]/i.test(html));
  assert.ok(!/\sstyle\s*=/i.test(html));
  assert.ok(!/\son[a-z]+\s*=/i.test(html));
  assert.equal([...html.matchAll(/<script\b[^>]*>/gi)].filter((m) => !/\bsrc=/.test(m[0])).length, 0);
});

test('the page keeps its accessibility landmarks and decorative art is hidden from assistive tech', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /class="hero-art" aria-hidden="true"/);
  const labelled = [...html.matchAll(/<input id="([^"]+)"/g)].map((m) => m[1]);
  for (const id of labelled) assert.ok(html.includes(`for="${id}"`), `missing label for #${id}`);
});

test('the stylesheet respects reduced motion, keeps a focus ring and loads no remote resources', () => {
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.ok(!/url\(\s*['"]?https?:/i.test(css));
  assert.ok(!/@import/i.test(css));
});
