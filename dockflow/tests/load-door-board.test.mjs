import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoadDoorBoard, evaluate, feasibleDoors, parseScenario, applyAssignment, completeTrailer } from '../lib/dock-engine.ts';
import { createScenario } from '../lib/dock-fixtures.ts';

const find = (scenario, id) => buildLoadDoorBoard(scenario, evaluate(scenario)).find(row => row.trailer.id === id);

test('incoming and occupied compatible doors are conditional, never executable placements', () => {
  const scenario = createScenario('balanced', 89);
  const expected = find(scenario, 'TR-109');
  assert.equal(expected.decision.kind, 'conditional');
  assert.ok(expected.decision.doorId);
  assert.equal(feasibleDoors(scenario, expected.trailer.id).length, 0);
  assert.throws(() => applyAssignment(scenario, expected.trailer.id, expected.decision.doorId));

  const available = find(scenario, 'TR-103');
  assert.equal(available.decision.kind, 'proposal');
  assert.equal(available.preassignmentDiffers, true);
  // The other compatible door is held and still occupied.
  const next = applyAssignment(scenario, available.trailer.id, available.decision.doorId).scenario;
  const waiting = next.trailers.find(load => load.id === 'TR-111');
  waiting.zoneUnits = { A: waiting.packageCount, B: 0, C: 0 };
  delete waiting.packageMix;
  const target = find(next, waiting.id).decision;
  assert.equal(target.kind, 'conditional');
  assert.match(target.detail, /release/);
  assert.throws(() => applyAssignment(next, waiting.id, target.doorId));
  const occupant = next.trailers.find(load => load.currentDoorId === target.doorId);
  const cleared = completeTrailer(next, occupant.id).scenario;
  assert.equal(find(cleared, waiting.id).decision.kind, 'proposal');
});

test('matrix keeps physical exceptions, holds, stale profiles and completion visible', () => {
  const scenario = createScenario('disruption');
  assert.ok(find(scenario, 'TR-102').placementIssues.some(issue => issue.code === 'wrong-handling'));
  assert.equal(find(scenario, 'TR-102').decision.kind, 'physical');
  for (const id of ['TR-107','TR-108','TR-110']) {
    assert.equal(find(scenario, id).decision.kind, 'review');
    assert.equal(find(scenario, id).decision.doorId, null);
  }
  assert.equal(find(scenario, 'TR-112').decision.kind, 'complete');
});

test('synthetic size counts reconcile inside each destination and survive export and import', () => {
  const scenario = createScenario('balanced', 17);
  const known = scenario.trailers.find(load => load.profileKnown);
  for (const zone of scenario.zones) {
    assert.equal(Object.values(known.packageMix[zone.id]).reduce((sum, count) => sum + count, 0), known.zoneUnits[zone.id]);
  }
  const restored = parseScenario(JSON.parse(JSON.stringify(scenario)));
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.scenario.trailers[0].packageMix, known.packageMix);
  known.packageMix.A.bulky++;
  assert.equal(parseScenario(scenario).ok, false);
});

test('legacy imports retain unknown size detail and cannot attach a size breakdown to an unknown destination', () => {
  const scenario = createScenario();
  for (const trailer of scenario.trailers) delete trailer.packageMix;
  const parsed = parseScenario(scenario);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.scenario.trailers.every(trailer => trailer.packageMix === undefined));
  const unknown = scenario.trailers.find(trailer => !trailer.profileKnown);
  unknown.packageMix = Object.fromEntries(['A','B','C'].map(zone => [zone, { compact:0, standard:0, bulky:0 }]));
  assert.equal(parseScenario(scenario).ok, false);
});
