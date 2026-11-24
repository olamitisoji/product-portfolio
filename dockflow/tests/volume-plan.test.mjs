import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../lib/dock-fixtures.ts';
import { advanceClock, evaluate, parseScenario } from '../lib/dock-engine.ts';
import { DEFAULT_VOLUME_PLAN, getVolumeTargets } from '../lib/volume-plan.ts';

test('the facility calendar converts the weekly target once without accumulating rounded targets', () => {
  const { dailyPackages, shiftPackages, hourlyPackages } = getVolumeTargets(DEFAULT_VOLUME_PLAN);
  assert.equal(dailyPackages, 600_000 / 7);
  assert.equal(shiftPackages, 600_000 / 14);
  assert.equal(hourlyPackages, 600_000 / 168);
  const split = getVolumeTargets({ ...DEFAULT_VOLUME_PLAN, operatingDaysPerWeek: 5, shiftsPerDay: 3, shiftHours: 8 });
  assert.deepEqual(split, { dailyPackages: 120_000, shiftPackages: 40_000, hourlyPackages: 5000 });
});

test('active manifests and seeded facility counts reconcile at their distinct time scales', () => {
  for (const preset of ['balanced', 'surge', 'disruption']) {
    for (const seed of [0, 42, 0xffffffff]) {
      const scenario = createScenario(preset, seed);
      assert.deepEqual(parseScenario(JSON.parse(JSON.stringify(scenario))).scenario, scenario);
      assert.deepEqual(createScenario(preset, seed).shiftReports, scenario.shiftReports);
      const { hourlyPackages, shiftPackages } = getVolumeTargets(scenario.volumePlan);
      const first = scenario.shiftReports[0];
      const last = scenario.shiftReports.at(-1);
      assert.equal(first.atMinute, 360);
      assert.equal(first.processedPackages, 0);
      assert.equal(last.atMinute, 1080);
      assert.equal(last.plannedPackages, Math.round(shiftPackages));
      const active = evaluate(scenario).metrics.totalPackages;
      assert.ok(active > hourlyPackages && active < shiftPackages);
      assert.notEqual(last.processedPackages, active);
      for (const report of scenario.shiftReports) {
        assert.equal(report.plannedPackages, Math.round(hourlyPackages * (report.atMinute - first.atMinute) / 60));
      }
      for (const trailer of scenario.trailers.filter(t => t.profileKnown)) {
        const totals = Object.values(trailer.packageMix).flatMap(Object.values).reduce((sum, units) => sum + units, 0);
        assert.equal(totals, trailer.packageCount);
        assert.ok(trailer.currentUnits + trailer.nextUnits <= trailer.packageCount);
      }
      assert.deepEqual(advanceClock(scenario, 30).shiftReports, scenario.shiftReports);
    }
  }
  assert.notDeepEqual(createScenario('balanced', 17).shiftReports, createScenario('balanced', 42).shiftReports);
});

test('a legacy import retains counts and an unknown weekly target; invalid explicit calendars are rejected', () => {
  const scenario = createScenario();
  const { volumePlan } = scenario;
  const legacy = { ...scenario };
  delete legacy.volumePlan;
  delete legacy.shiftReports;
  legacy.trailers = [{ ...legacy.trailers[0], packageCount: 17, zoneUnits: { A: 17, B: 0, C: 0 } }];
  delete legacy.trailers[0].packageMix;
  delete legacy.trailers[0].chuteRoutes;
  const restored = parseScenario(legacy);
  assert.deepEqual(restored.scenario, legacy);
  const later = advanceClock(restored.scenario);
  assert.equal(Object.hasOwn(later, 'volumePlan'), false);
  assert.equal(Object.hasOwn(later, 'shiftReports'), false);
  assert.equal(later.trailers[0].packageCount, 17);
  assert.equal(parseScenario({ ...legacy, volumePlan: null }).ok, false);
  for (const change of [
    { weeklyPackages: '600000' }, { weeklyPackages: 0 }, { operatingDaysPerWeek: 8 },
    { shiftsPerDay: 0 }, { shiftHours: 13 }, { shiftStartMinute: -1 }, { shiftStartMinute: 1440 },
  ]) assert.equal(parseScenario({ ...legacy, volumePlan: { ...volumePlan, ...change } }).ok, false);
});
