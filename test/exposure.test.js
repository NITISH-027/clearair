import test from 'node:test';
import assert from 'node:assert/strict';
import { BREATHING, HOME, KITCHEN, MASK, WHO_24H_GUIDELINE, exposureDetail, exposureDose, indoorConcentration, percentReduction } from '../shared/exposure.js';
import { validateProfile } from '../shared/validate.js';
import { buildPlan } from '../shared/planner.js';

const profile = (over = {}) => validateProfile({
  household: {}, commute: { mode: 'twowheeler', hours: 1.5 }, exercise: { outdoorHours: 1 },
  home: { windows: 'open', purifier: false, cooking: 'lpg' }, ...over,
}).value;

test('indoorConcentration matches the mass-balance equation by hand', () => {
  // C_in = P a C_out / (a + k) with no source and no purifier
  const expected = (HOME.penetration * 0.5 * 100) / (0.5 + HOME.deposition);
  assert.ok(Math.abs(indoorConcentration({ outdoor: 100, airChanges: 0.5 }) - expected) < 1e-9);
  // with a purifier the loss term gains CADR / V
  const withCadr = (HOME.penetration * 0.5 * 100) / (0.5 + HOME.deposition + 200 / HOME.roomVolume);
  assert.ok(Math.abs(indoorConcentration({ outdoor: 100, airChanges: 0.5, cadr: 200 }) - withCadr) < 1e-9);
  // a source adds S / V to the numerator
  const withSource = (HOME.penetration * 0.5 * 0 + 4000 / HOME.roomVolume) / (0.5 + HOME.deposition);
  assert.ok(Math.abs(indoorConcentration({ outdoor: 0, airChanges: 0.5, source: 4000 }) - withSource) < 1e-9);
});

test('a bigger CADR always means cleaner indoor air', () => {
  const values = [0, 50, 100, 200, 400, 800].map((cadr) => indoorConcentration({ outdoor: 150, airChanges: 0.5, cadr }));
  values.slice(1).forEach((value, i) => assert.ok(value < values.at(i)));
});

test('tighter homes have lower indoor concentration than leaky ones', () => {
  assert.ok(indoorConcentration({ outdoor: 150, airChanges: HOME.airChanges.closed }) < indoorConcentration({ outdoor: 150, airChanges: HOME.airChanges.open }));
});

test('dose is concentration x breathing rate x hours, summed', () => {
  const p = profile({ commute: { mode: 'wfh', hours: 0 }, exercise: { outdoorHours: 0 }, home: { windows: 'closed', cooking: 'induction' } });
  const cIn = indoorConcentration({ outdoor: 100, airChanges: HOME.airChanges.closed });
  const inc = KITCHEN.emission.induction / (KITCHEN.volume * (KITCHEN.airChanges.normal + HOME.deposition));
  const expected = cIn * BREATHING.sleep * 8 + (cIn + inc) * BREATHING.light * 2 + cIn * BREATHING.rest * 14;
  assert.ok(Math.abs(exposureDose({ pm25: 100, profile: p }) - expected) < 1e-6);
});

test('mean concentration is dose divided by air breathed', () => {
  const d = exposureDetail({ pm25: 120, profile: profile() });
  assert.ok(Math.abs(d.meanConcentration - d.dose / d.volume) < 1e-9);
  assert.ok(d.meanConcentration > 0 && d.meanConcentration < 120 * 1.2);
});

test('zero outdoor PM2.5 leaves only the cooking increment', () => {
  const d = exposureDetail({ pm25: 0, profile: profile({ home: { cooking: 'biomass' } }) });
  assert.ok(d.dose > 0);
  const clean = exposureDetail({ pm25: 0, profile: profile({ home: { cooking: 'induction' } }) });
  assert.ok(clean.dose < d.dose / 10);
});

test('biomass cooking dwarfs gas and induction, and a fan cuts the kitchen share', () => {
  const dose = (cooking, flags) => exposureDose({ pm25: 20, profile: profile({ home: { cooking } }) }, flags);
  assert.ok(dose('biomass') > dose('lpg') && dose('lpg') > dose('induction'));
  assert.ok(dose('lpg', { cookingVent: true }) < dose('lpg'));
  assert.ok(dose('biomass', { cleanCooking: true }) < dose('biomass') / 2);
});

test('a mask uses 1 / APF for open modes only', () => {
  const p = profile({ commute: { mode: 'walk', hours: 2 }, exercise: { outdoorHours: 0 } });
  const base = exposureDetail({ pm25: 100, profile: p });
  const masked = exposureDetail({ pm25: 100, profile: p }, { mask: true });
  const commuteBase = 100 * 1.0 * 1.2 * 2;
  assert.ok(Math.abs(base.dose - masked.dose - commuteBase * (1 - 1 / MASK.assignedProtectionFactor)) < 1e-6);
  const car = profile({ commute: { mode: 'car', hours: 2 } });
  assert.equal(exposureDose({ pm25: 100, profile: car }, { mask: true }), exposureDose({ pm25: 100, profile: car }));
});

test('purifier CADR from the profile is used, and defaults apply to what-if purifiers', () => {
  const strong = profile({ home: { purifier: true, purifierCadr: 600 } });
  const weak = profile({ home: { purifier: true, purifierCadr: 60 } });
  assert.ok(exposureDose({ pm25: 150, profile: strong }) < exposureDose({ pm25: 150, profile: weak }));
  const none = profile();
  const hypothetical = exposureDose({ pm25: 150, profile: none }, { purifier: true });
  assert.ok(hypothetical < exposureDose({ pm25: 150, profile: none }));
});

test('exercising in the cleanest window or indoors lowers dose; both never raise it', () => {
  const ctx = { pm25: 150, bestPm25: 60, profile: profile() };
  const base = exposureDose(ctx);
  assert.ok(exposureDose(ctx, { shiftExercise: true }) < base);
  assert.ok(exposureDose(ctx, { exerciseIndoors: true }) < base);
  assert.equal(exposureDose({ ...ctx, bestPm25: 400 }, { shiftExercise: true }), base, 'a dirtier window is never chosen');
  assert.equal(exposureDose({ ...ctx, bestPm25: null }, { shiftExercise: true }), base);
});

test('unknown modes and cooking fuels degrade safely instead of throwing', () => {
  const odd = { ...profile(), commute: { mode: 'hoverboard', hours: 1 }, home: { windows: 'open', purifier: false, purifierCadr: 0, cooking: 'unknown' } };
  assert.ok(Number.isFinite(exposureDose({ pm25: 50, profile: odd })));
});

test('the plan reports units, the WHO guideline and a lower mean with the plan', () => {
  const plan = buildPlan(profile({ household: { children: true } }), { aqi: 220, pm25: 140 });
  assert.equal(plan.exposure.whoGuideline, WHO_24H_GUIDELINE);
  assert.match(plan.exposure.unit, /PM2\.5/);
  assert.ok(plan.exposure.meanConcentrationWithPlan < plan.exposure.meanConcentration);
});

test('percentReduction is bounded', () => {
  assert.equal(percentReduction(100, 0), 100);
  assert.equal(percentReduction(0, 5), 0);
});

test('purifier CADR validation: default, range and ignored when no purifier', () => {
  assert.equal(validateProfile({ home: { purifier: true } }).value.home.purifierCadr, 200);
  assert.equal(validateProfile({ home: { purifier: true, purifierCadr: '350' } }).value.home.purifierCadr, 350);
  assert.equal(validateProfile({ home: { purifier: true, purifierCadr: 5 } }).ok, false);
  assert.equal(validateProfile({ home: { purifier: true, purifierCadr: 5000 } }).ok, false);
  assert.equal(validateProfile({ home: { purifier: true, purifierCadr: 'lots' } }).ok, false);
  assert.equal(validateProfile({ home: { purifier: false, purifierCadr: 9999 } }).value.home.purifierCadr, 0);
});
