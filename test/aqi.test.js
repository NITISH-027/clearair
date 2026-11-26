import test from 'node:test';
import assert from 'node:assert/strict';
import { pm25ToAqi, aqiToPm25, categoryFor } from '../shared/aqi.js';

test('pm25ToAqi hits the EPA breakpoints', () => {
  assert.equal(pm25ToAqi(0), 0);
  assert.equal(pm25ToAqi(9), 50);
  assert.equal(pm25ToAqi(35.4), 100);
  assert.equal(pm25ToAqi(55.4), 150);
  assert.equal(pm25ToAqi(125.4), 200);
  assert.equal(pm25ToAqi(225.4), 300);
});

test('pm25ToAqi caps very high values at 500', () => {
  assert.equal(pm25ToAqi(325.4), 500);
  assert.equal(pm25ToAqi(900), 500);
});

test('aqiToPm25 is the inverse within rounding', () => {
  for (const pm of [5, 20, 45, 90, 180, 280]) {
    const back = aqiToPm25(pm25ToAqi(pm));
    assert.ok(Math.abs(back - pm) < 1.5, `${pm} -> ${back}`);
  }
});

test('categoryFor maps boundaries to the right label', () => {
  assert.equal(categoryFor(50).label, 'Good');
  assert.equal(categoryFor(51).label, 'Moderate');
  assert.equal(categoryFor(150).index, 2);
  assert.equal(categoryFor(201).label, 'Very unhealthy');
  assert.equal(categoryFor(480).label, 'Hazardous');
  assert.equal(categoryFor(9999).label, 'Hazardous');
});

test('rejects invalid numbers', () => {
  for (const bad of [-1, NaN, Infinity, '12', null]) {
    assert.throws(() => pm25ToAqi(bad), RangeError);
    assert.throws(() => aqiToPm25(bad), RangeError);
    assert.throws(() => categoryFor(bad), RangeError);
  }
});
