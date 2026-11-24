import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../lib/dock-fixtures.ts';
import { buildChuteMap } from '../lib/chute-routing.ts';
import { applyAssignment, advanceClock } from '../lib/dock-engine.ts';
import { getBaselineFloorPlan, moveFloorResource } from '../lib/sort-floor.ts';
import { buildShiftEvidence } from '../lib/shift-evidence.ts';

const facts = (scenario, mode = 'priority', floor, pickup, question) =>
  new Map(buildShiftEvidence(scenario, mode, floor, pickup, question).map(fact => [fact.id, fact]));

test('current pickup, dispatchable queue, physical occupancy and planning targets stay distinct', () => {
  const scenario = createScenario();
  const all = facts(scenario);
  assert.match(all.get('pickup-current').text, /2576 packages due/);
  assert.match(all.get('pickup-current').text, /521 expected/);
  assert.match(all.get('dispatch-current').text, /TR-103.*712 due.*A-02/);
  assert.match(all.get('trailer-TR-103').text, /Preassigned A-01.*Proposed A-02/);
  assert.match(all.get('door-A-01').text, /Occupants: TR-101.*Preassigned: TR-103/);
  assert.match(all.get('trailer-TR-109').text, /Conditional target B-02/);
  const updated = facts(applyAssignment(scenario, 'TR-103', 'A-02').scenario);
  assert.match(updated.get('door-A-02').text, /Occupants: TR-103/);
  assert.match(updated.get('dispatch-current').text, /TR-104.*597 due.*B-02/);
});

test('capacity and yield evidence reconcile to separate sources and change with the selected plan', () => {
  const scenario = createScenario();
  const all = facts(scenario);
  assert.match(all.get('best-transfer').text, /staffed position from North loop to Central loop.*276 to 216.*Crew/);
  assert.match(all.get('move-chutes-A-B').text, /276 to 216.*Crew/);
  const adjusted = facts(scenario, 'priority', moveFloorResource(getBaselineFloorPlan(scenario), 'chutes', 'A', 'B'), 'next');
  assert.match(adjusted.get('sort-floor').text, /Baseline shortfall 276.*selected plan shortfall 216/i);
  assert.match(adjusted.get('zone-B').text, /10 staffed positions.*8 crew.*Crew/);
  assert.match(adjusted.get('shift').text, /selected pickup: next/i);
  assert.deepEqual(adjusted.get('shift-record'), all.get('shift-record'));
  assert.notDeepEqual(facts(advanceClock(scenario)).get('shift-record'), all.get('shift-record'));
  delete scenario.shiftReports;
  assert.match(facts(scenario).get('shift-record').text, /No shift record/);
});

test('chute evidence is limited to active manifest leaders and one named physical destination', () => {
  const scenario = createScenario();
  const map = buildChuteMap(scenario);
  const leaders = map.zones.map(zone => zone.chutes.reduce((a, b) => a.packages >= b.packages ? a : b));
  const requested = map.zones[1].chutes.find(cell => cell.packages && cell.id !== leaders[1].id);
  const routeFacts = question => Array.from(facts(scenario, 'priority', undefined, undefined, question).values())
    .filter(record => record.id.startsWith('chute-'));
  const overview = routeFacts();
  assert.equal(overview.length, 4);
  const coverage = overview.find(record => record.id === 'chute-coverage').text;
  assert.match(coverage, new RegExp(`${map.totalPackages} active packages`));
  assert.match(coverage, new RegExp(`${map.routedPackages} of ${map.sorterPackages} sorter packages`));
  assert.match(coverage, /551 crossdock packages bypass the sorter/);
  assert.match(coverage, new RegExp(`${map.unmappedPackages} packages lack`));
  assert.match(coverage, /scan/i);
  for (const cell of leaders) {
    const record = overview.find(record => record.id === 'chute-' + cell.id);
    assert.match(record.text, /highest/i);
    assert.match(record.text, new RegExp(`${cell.packages} packages`));
    assert.match(record.text, new RegExp(cell.sources[0].trailerId));
    assert.ok(record.text.includes(cell.sharePercent.toFixed(2) + '% of active sorter packages'));
    assert.doesNotMatch(record.text, /TR-106/);
  }
  const exact = routeFacts(`Show ${requested.id.toLowerCase()} and A200.`);
  assert.equal(exact.length, 5);
  const detail = exact.find(record => record.id === 'chute-' + requested.id);
  assert.match(detail.text, new RegExp(`${requested.packages} packages`));
  assert.match(detail.text, new RegExp(requested.sources[0].trailerId));
  assert.deepEqual(routeFacts(`Where is ${leaders[0].id}?`), overview);
  assert.deepEqual(routeFacts('Can door A-01 take XA099 or Z201?'), overview);
});

test('absent chute routes never imply an empty destination or scan confirmation', () => {
  const scenario = createScenario();
  for (const trailer of scenario.trailers) delete trailer.chuteRoutes;
  const result = facts(scenario, 'priority', undefined, undefined, 'What was scanned at B015?');
  assert.match(result.get('chute-coverage').text, /0 of 5352 sorter packages/);
  assert.match(result.get('chute-B015').text, /0 packages assigned.*unknown/i);
  assert.match(result.get('chute-zone-B').text, /no ranked chute/i);
});

test('an all-crossdock active snapshot has no sorter denominator or missing chute assignments', () => {
  const scenario = createScenario();
  for (const trailer of scenario.trailers) {
    if (trailer.handling !== 'crossdock') trailer.status = 'complete';
  }
  const all = facts(scenario, 'priority', undefined, undefined, 'Does A010 receive the crossdock load?');
  assert.match(all.get('chute-coverage').text, /551 crossdock packages bypass the sorter/);
  assert.match(all.get('chute-coverage').text, /0 packages lack a chute assignment/);
  assert.match(all.get('chute-A010').text, /no active sorter freight/i);
  assert.doesNotMatch(all.get('chute-A010').text, /%|TR-106/);
});

test('weekly facility planning, the full shift, observed counts and visible manifests carry distinct evidence', () => {
  const scenario = createScenario();
  const all = facts(scenario);
  const facility = all.get('volume-plan');
  assert.match(facility.text, /600000 packages per week/);
  assert.match(facility.text, /42857 per shift and 3571 per hour/);
  assert.match(all.get('shift').text, /11 visible active trailers with 5903 packages/);
  assert.match(all.get('sort-floor').text, /3919 mapped packages/);
  assert.match(all.get('shift-record').text, /14643 processed, 14286 planned/);
  assert.deepEqual(facts(advanceClock(scenario)).get('volume-plan'), facility);
  delete scenario.volumePlan;
  assert.match(facts(scenario).get('volume-plan').text, /no facility volume target/i);
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
