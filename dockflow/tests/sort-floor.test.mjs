import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceClock, parseScenario } from '../lib/dock-engine.ts';
import { createScenario } from '../lib/dock-fixtures.ts';
import { BASE_FLOOR_PLAN, currentShiftRecord, evaluateSortFloor, moveFloorResource } from '../lib/sort-floor.ts';

test('resource transfers expose the next constraint and protect the shared resource pool', () => {
  const scenario = createScenario('balanced', 42);
  const original = evaluateSortFloor(scenario);
  const layout = moveFloorResource(BASE_FLOOR_PLAN, 'chutes', 'A', 'B');
  const revised = evaluateSortFloor(scenario, layout);
  const beforeB = original.zones.find(z => z.zone === 'B');
  const afterB = revised.zones.find(z => z.zone === 'B');
  assert.equal(beforeB.proposed.limitingResource, 'Chutes');
  assert.equal(beforeB.proposed.units, 540);
  assert.equal(afterB.proposed.units, 630);
  assert.equal(afterB.proposed.limitingResource, 'Crew');
  assert.equal(revised.baseGap, original.gap);
  assert.ok(revised.gap < original.gap);
  const labor = moveFloorResource(layout, 'crew', 'C', 'B');
  assert.equal(evaluateSortFloor(scenario, labor).zones.find(z => z.zone === 'B').proposed.units, 720);
  assert.equal(layout.crew.C, BASE_FLOOR_PLAN.crew.C);
  assert.equal(BASE_FLOOR_PLAN.chutes.A, 4);

  let transferred = BASE_FLOOR_PLAN;
  for (let n = 0; n < 6; n++) transferred = moveFloorResource(transferred, 'crew', 'A', 'B');
  assert.equal(transferred.crew.A, 0);
  assert.equal(Object.values(transferred.crew).reduce((total, n) => total + n, 0), 9);
  assert.strictEqual(moveFloorResource(transferred, 'crew', 'A', 'C'), transferred);
  assert.strictEqual(moveFloorResource(transferred, 'chutes', 'B', 'B'), transferred);
});

test('forecast reconciles actual location, arrival horizon, exclusions and missing size evidence', () => {
  const base = createScenario();
  const trailer = base.trailers.find(t => t.status === 'yard' && !t.hold);
  const load = (overrides = {}) => ({
    ...trailer, packageCount: 30, zoneUnits: { A: 10, B: 15, C: 5 },
    packageMix: undefined, profileUpdatedMinute: base.nowMinute, ...overrides,
  });
  const scenario = { ...base, trailers: [
    load(),
    load({ status: 'expected', arrivalMinute: base.nowMinute + 40, packageMix: {
      A: { compact: 2, standard: 5, bulky: 3 }, B: { compact: 10, standard: 5, bulky: 0 },
      C: { compact: 5, standard: 0, bulky: 0 },
    } }),
    load({ status: 'expected', arrivalMinute: base.nowMinute + 61 }),
    load({ status: 'complete' }),
    load({ hold: true }), load({ handling: 'crossdock' }),
    load({ profileKnown: false, profileUpdatedMinute: null }),
    load({ profileUpdatedMinute: base.nowMinute - 61 }),
  ] };
  const floor = evaluateSortFloor(scenario);
  assert.equal(floor.packages, 60);
  assert.deepEqual(floor.excluded, { held: 30, transfer: 30, unmapped: 30, stale: 30 });
  assert.deepEqual(floor.zones.map(z => [z.onSite, z.expected]), [[10, 10], [15, 15], [5, 5]]);
  for (const z of floor.zones) {
    assert.equal(Object.values(z.sizes).reduce((n, k) => n + k, z.unknownSize), z.packages);
    assert.equal(z.unknownSize, z.onSite);
  }
  assert.deepEqual(floor.zones[0].sizes, { compact: 2, standard: 5, bulky: 3 });
});

test('remaining minutes limit hourly capacity at the end of the fictional day', () => {
  const scenario = { ...createScenario(), nowMinute: 1425, trailers: [] };
  const floor = evaluateSortFloor(scenario);
  assert.equal(floor.minutes, 15);
  assert.equal(floor.endMinute, 1440);
  assert.equal(floor.zones.find(z => z.zone === 'B').proposed.units, 135);
  assert.equal(floor.gap, 0);
});

test('the clock reveals a recorded shift observation, independent of a chute or staffing preview', () => {
  const scenario = createScenario();
  const current = currentShiftRecord(scenario);
  assert.equal(current.report.atMinute, 600);
  assert.equal(current.variance, current.report.processedPackages - current.report.plannedPackages);
  assert.equal(current.yieldPercent, 100 * current.report.firstPass.sorted / current.report.firstPass.attempted);
  evaluateSortFloor(scenario, moveFloorResource(BASE_FLOOR_PLAN, 'crew', 'A', 'B'));
  assert.deepEqual(currentShiftRecord(scenario), current);
  const later = currentShiftRecord(advanceClock(scenario, 40));
  assert.equal(later.report.atMinute, 630);
  assert.equal(currentShiftRecord({ ...scenario, nowMinute: 550 }), null);
});

test('missing evidence and zero first attempts never become a zero-percent yield', () => {
  const scenario = createScenario();
  delete scenario.shiftReports;
  assert.equal(parseScenario(scenario).ok, true);
  assert.equal(currentShiftRecord(scenario), null);
  const base = { atMinute: 600, plannedPackages: 0, processedPackages: 0 };
  scenario.shiftReports = [base];
  assert.equal(currentShiftRecord(scenario).yieldPercent, null);
  assert.equal(currentShiftRecord(scenario).variance, 0);
  scenario.shiftReports = [{ ...base, firstPass: { attempted: 0, sorted: 0 } }];
  assert.equal(currentShiftRecord(scenario).yieldPercent, null);
  scenario.shiftReports = [{ ...base, firstPass: { attempted: 5, sorted: 0 } }];
  assert.equal(currentShiftRecord(scenario).yieldPercent, 0);
});

test('scenario import validates and retains cumulative shift evidence, including future snapshots', () => {
  const scenario = createScenario();
  const report = { atMinute: 600, plannedPackages: 100, processedPackages: 90, firstPass: { attempted: 100, sorted: 85 } };
  const second = { atMinute: 630, plannedPackages: 220, processedPackages: 175, firstPass: { attempted: 180, sorted: 155 } };
  const read = rows => parseScenario({ ...scenario, shiftReports: rows });
  assert.deepEqual(read([second, report]).scenario.shiftReports, [report, second]);
  assert.equal(read([report, { ...second, firstPass: undefined }]).ok, false);
  for (const changes of [
    { atMinute: 600 }, { atMinute: 1441 }, { plannedPackages: 99 },
    { processedPackages: 89 }, { firstPass: { attempted: 1, sorted: 2 } },
    { firstPass: { attempted: 175, sorted: 170 } }, { firstPass: { attempted: 125.5, sorted: 95 } },
    { firstPass: { attempted: 200, sorted: 190 } },
  ]) assert.equal(read([report, { ...second, ...changes }]).ok, false);
  assert.equal(read(Array(97).fill(report)).ok, false);
});
