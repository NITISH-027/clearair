import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCity, validateCoordinates, validateProfile, validateAqi } from '../shared/validate.js';

test('validateCity trims and accepts real place names', () => {
  assert.deepEqual(validateCity('  New   Delhi '), { ok: true, value: 'New Delhi' });
  assert.equal(validateCity('Kraków').ok, true);
  assert.equal(validateCity("St. John's").ok, true);
});

test('validateCity rejects empty, long and unsafe input', () => {
  assert.equal(validateCity('').ok, false);
  assert.equal(validateCity('   ').ok, false);
  assert.equal(validateCity('a'.repeat(81)).ok, false);
  assert.equal(validateCity('<script>alert(1)</script>').ok, false);
  assert.equal(validateCity('Delhi; DROP TABLE').ok, false);
  assert.equal(validateCity(42).ok, false);
});

test('validateCoordinates enforces ranges', () => {
  assert.deepEqual(validateCoordinates('13.08', '80.27'), { ok: true, value: { lat: 13.08, lon: 80.27 } });
  assert.equal(validateCoordinates(91, 0).ok, false);
  assert.equal(validateCoordinates(0, -181).ok, false);
  assert.equal(validateCoordinates('x', 'y').ok, false);
  assert.equal(validateCoordinates(null, null).ok, false);
});

test('validateProfile fills defaults and drops unknown keys', () => {
  const r = validateProfile({ extra: 'x', commute: { mode: 'car', hours: '2' } });
  assert.equal(r.ok, true);
  assert.equal(r.value.commute.hours, 2);
  assert.equal(r.value.home.cooking, 'lpg');
  assert.equal(r.value.household.children, false);
  assert.equal('extra' in r.value, false);
});

test('validateProfile forces zero commute hours when working from home', () => {
  const r = validateProfile({ commute: { mode: 'wfh', hours: 5 } });
  assert.equal(r.value.commute.hours, 0);
});

test('validateProfile reports bad enums and ranges', () => {
  assert.equal(validateProfile({ commute: { mode: 'rocket' } }).ok, false);
  assert.equal(validateProfile({ commute: { mode: 'car', hours: 9 } }).ok, false);
  assert.equal(validateProfile({ exercise: { outdoorHours: -1 } }).ok, false);
  assert.equal(validateProfile({ home: { windows: 'ajar' } }).ok, false);
  assert.equal(validateProfile({ home: { cooking: 'coal-gas' } }).ok, false);
  assert.equal(validateProfile(null).ok, false);
  assert.equal(validateProfile([]).ok, false);
});

test('validateAqi accepts 0 to 500 and rounds', () => {
  assert.deepEqual(validateAqi('150.4'), { ok: true, value: 150 });
  assert.equal(validateAqi(0).ok, true);
  assert.equal(validateAqi(501).ok, false);
  assert.equal(validateAqi('').ok, false);
});
