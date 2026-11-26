import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

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
  const labelled = [...html.matchAll(/<input id="([^"]+)"/g)].map((m) => m[1]);
  for (const id of labelled) assert.ok(html.includes(`for="${id}"`), `missing label for #${id}`);
});

test('the stylesheet respects reduced motion, keeps a focus ring and loads no remote resources', () => {
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.ok(!/url\(\s*['"]?https?:/i.test(css));
  assert.ok(!/@import/i.test(css));
});

test('every image is a local WebP file, decorative (empty alt), sized and under 60 KB', () => {
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  assert.equal(imgs.length, 6);
  for (const tag of imgs) {
    assert.match(tag, /alt=""/);
    assert.match(tag, /\bwidth="\d+"/);
    assert.match(tag, /\bheight="\d+"/);
    const src = /src="(\/img\/[a-z]+\.webp)"/.exec(tag);
    assert.ok(src, `image must be a local WebP: ${tag}`);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from our own HTML
    assert.ok(statSync(`public${src[1]}`).size < 60 * 1024, `${src[1]} is over 60 KB`);
  }
});

test('every image the scripts add exists on disk', () => {
  const js = readFileSync('public/js/render.js', 'utf8');
  const srcs = [...js.matchAll(/src: '(\/img\/[a-z]+\.webp)'/g)].map((m) => m[1]);
  assert.equal(srcs.length, 3);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from our own script
  for (const src of srcs) assert.ok(statSync(`public${src}`).size < 60 * 1024);
  assert.ok(!/<img[^>]*src="http/i.test(html));
});
