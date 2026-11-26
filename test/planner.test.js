import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, findBestWindow, ACTION_CATALOG } from '../shared/planner.js';
import { exposureDose, percentReduction } from '../shared/exposure.js';
import { validateProfile } from '../shared/validate.js';

const profile = (over = {}) => validateProfile({
  household: {}, commute: { mode: 'twowheeler', hours: 1.5 }, exercise: { outdoorHours: 1 },
  home: { windows: 'open', purifier: false, cooking: 'lpg' }, ...over,
}).value;

function hourlyDay(values, date = '2026-11-26') {
  return values.map((pm25, i) => ({ time: `${date}T${String(i).padStart(2, '0')}:00`, pm25, aqi: 100 }));
}

const itemIds = (plan) => plan.sections.flatMap((s) => s.items.map((i) => i.id));

test('clean air gives a light plan with no protective steps', () => {
  const plan = buildPlan(profile(), { aqi: 30, pm25: 6 });
  const ids = itemIds(plan);
  assert.equal(plan.level, 0);
  assert.ok(!ids.includes('wear-mask'));
  assert.ok(!ids.includes('close-windows'));
  assert.ok(ids.includes('no-burning'));
});

test('very unhealthy air adds mask, window, purifier and indoor workout steps', () => {
  const ids = itemIds(buildPlan(profile(), { aqi: 220, pm25: 140 }));
  for (const id of ['wear-mask', 'close-windows', 'get-purifier', 'exercise-indoors']) assert.ok(ids.includes(id), id);
});

test('a sensitive household is treated one level stricter at Moderate', () => {
  const strict = buildPlan(profile({ household: { children: true } }), { aqi: 80, pm25: 25 });
  const normal = buildPlan(profile(), { aqi: 80, pm25: 25 });
  assert.equal(normal.level, 1);
  assert.equal(strict.level, 2);
  assert.ok(itemIds(strict).includes('care-children'));
});

test('household sections only appear for ticked groups', () => {
  const ids = itemIds(buildPlan(profile({ household: { elderly: true } }), { aqi: 180, pm25: 110 }));
  assert.ok(ids.includes('care-elderly'));
  assert.ok(!ids.includes('care-children'));
  assert.ok(!ids.includes('care-pregnancy'));
});

test('biomass cooking triggers the clean cooking step; induction does not', () => {
  const bio = itemIds(buildPlan(profile({ home: { cooking: 'biomass' } }), { aqi: 60, pm25: 20 }));
  const ind = itemIds(buildPlan(profile({ home: { cooking: 'induction' } }), { aqi: 60, pm25: 20 }));
  assert.ok(bio.includes('cleaner-cooking'));
  assert.ok(!ind.includes('cleaner-cooking'));
  assert.ok(!ind.includes('swap-induction'));
});

test('working from home skips commute steps', () => {
  const ids = itemIds(buildPlan(profile({ commute: { mode: 'wfh', hours: 0 } }), { aqi: 200, pm25: 125 }));
  assert.ok(!ids.includes('wear-mask'));
  assert.ok(!ids.includes('no-idling'));
});

test('findBestWindow picks the cleanest two hours between 6 AM and 8 PM', () => {
  const pm = new Array(24).fill(100);
  pm[13] = 20;
  pm[14] = 22;
  pm[2] = 1; // night hours must be ignored
  const w = findBestWindow(hourlyDay(pm));
  assert.equal(w.startTime, '2026-11-26T13:00');
  assert.equal(w.label, '1 PM to 3 PM');
});

test('findBestWindow handles missing or sparse data', () => {
  assert.equal(findBestWindow(undefined), null);
  assert.equal(findBestWindow([]), null);
  assert.equal(findBestWindow([{ time: '2026-11-26T10:00', pm25: 5, aqi: 20 }]), null);
});

test('best window feeds into the plan only for live data', () => {
  const pm = new Array(24).fill(110);
  pm[12] = 60;
  pm[13] = 62;
  const live = buildPlan(profile(), { aqi: 130, pm25: 100, hourly: hourlyDay(pm), source: 'live' });
  const manual = buildPlan(profile(), { aqi: 130, source: 'manual', hourly: hourlyDay(pm) });
  assert.ok(live.bestWindow);
  assert.equal(manual.bestWindow, null);
});

test('exposure: each protective flag lowers dose and never raises it', () => {
  const ctx = { pm25: 150, bestPm25: 80, profile: profile() };
  const base = exposureDose(ctx);
  for (const flag of ['mask', 'windowsClosed', 'purifier', 'exerciseIndoors', 'shiftExercise', 'cleanCooking', 'cookingVent']) {
    assert.ok(exposureDose(ctx, { [flag]: true }) <= base, flag);
  }
  assert.ok(exposureDose(ctx, { mask: true, windowsClosed: true, purifier: true }) < base * 0.8);
});

test('exposure: a mask does nothing inside a closed car', () => {
  const ctx = { pm25: 150, profile: profile({ commute: { mode: 'car', hours: 1 } }) };
  assert.equal(exposureDose(ctx, { mask: true }), exposureDose(ctx));
});

test('plan reports a combined reduction at least as large as any single step', () => {
  const plan = buildPlan(profile(), { aqi: 220, pm25: 140 });
  const best = Math.max(0, ...plan.sections.flatMap((s) => s.items.map((i) => i.impactPercent ?? 0)));
  assert.ok(plan.exposure.reductionPercent >= best);
  assert.ok(plan.exposure.withPlan <= plan.exposure.baseline);
});

test('percentReduction guards bad input', () => {
  assert.equal(percentReduction(0, 0), 0);
  assert.equal(percentReduction(100, 150), 0);
  assert.equal(percentReduction(100, 60), 40);
});

test('every plan item id exists in the catalogue and has a reason', () => {
  const plan = buildPlan(profile({ household: { children: true, elderly: true, respiratory: true, pregnant: true } }), { aqi: 250, pm25: 180 });
  for (const section of plan.sections) {
    for (const item of section.items) {
      assert.ok(ACTION_CATALOG[item.id], item.id);
      assert.ok(item.why.length > 20);
      assert.ok(item.action.length > 10);
    }
  }
  assert.deepEqual(plan.actionIds, itemIds(plan));
});
