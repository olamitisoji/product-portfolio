import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../lib/dock-fixtures.ts';
import { applyAssignment, advanceClock } from '../lib/dock-engine.ts';
import { BASE_FLOOR_PLAN, moveFloorResource } from '../lib/sort-floor.ts';
import { buildShiftEvidence } from '../lib/shift-evidence.ts';

const facts = (scenario, mode = 'priority', floor, pickup) =>
  new Map(buildShiftEvidence(scenario, mode, floor, pickup).map(fact => [fact.id, fact]));

test('current pickup, dispatchable queue, physical occupancy and planning targets stay distinct', () => {
  const scenario = createScenario();
  const all = facts(scenario);
  assert.match(all.get('pickup-current').text, /1029 packages due/);
  assert.match(all.get('pickup-current').text, /208 expected/);
  assert.match(all.get('dispatch-current').text, /TR-103.*284 due.*A-02/);
  assert.match(all.get('trailer-TR-103').text, /Preassigned A-01.*Proposed A-02/);
  assert.match(all.get('door-A-01').text, /Occupants: TR-101.*Preassigned: TR-103/);
  assert.match(all.get('trailer-TR-109').text, /Conditional target B-02/);
  const updated = facts(applyAssignment(scenario, 'TR-103', 'A-02').scenario);
  assert.match(updated.get('door-A-02').text, /Occupants: TR-103/);
  assert.match(updated.get('dispatch-current').text, /TR-104.*239 due.*B-02/);
});

test('capacity and yield evidence reconcile to separate sources and change with the selected plan', () => {
  const scenario = createScenario();
  const all = facts(scenario);
  assert.match(all.get('best-transfer').text, /chute from North loop to Central loop.*217 to 127.*Crew/);
  assert.match(all.get('move-chutes-A-B').text, /217 to 127.*Crew/);
  const adjusted = facts(scenario, 'priority', moveFloorResource(BASE_FLOOR_PLAN, 'chutes', 'A', 'B'), 'next');
  assert.match(adjusted.get('sort-floor').text, /Baseline shortfall 217.*selected plan shortfall 127/i);
  assert.match(adjusted.get('zone-B').text, /4 chutes.*3 crew.*Crew/);
  assert.match(adjusted.get('shift').text, /selected pickup: next/i);
  assert.deepEqual(adjusted.get('shift-record'), all.get('shift-record'));
  assert.notDeepEqual(facts(advanceClock(scenario)).get('shift-record'), all.get('shift-record'));
  delete scenario.shiftReports;
  assert.match(facts(scenario).get('shift-record').text, /No shift record/);
});

test('the analyst never receives imported names, operator text, or unrecognized IDs as text or link targets', () => {
  const scenario = createScenario();
  const id = 'SECRET_OVERRIDE_INSTRUCTIONS';
  const originalDoor = scenario.doors[0].id;
  scenario.doors[0].id = id;
  for (const load of scenario.trailers) {
    if (load.plannedDoorId === originalDoor) load.plannedDoorId = id;
    if (load.currentDoorId === originalDoor) load.currentDoorId = id;
    load.carrier = id;
  }
  scenario.trailers[0].id = id;
  scenario.name = id;
  scenario.zones[0].name = id;
  const result = buildShiftEvidence(scenario, 'priority');
  assert.doesNotMatch(JSON.stringify(result), /SECRET|OVERRIDE|INSTRUCTIONS/);
  assert.equal(result.find(fact => fact.label === 'Load 1').trailerId, undefined);
  assert.equal(new Set(result.map(fact => fact.id)).size, result.length);
});
