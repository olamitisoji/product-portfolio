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

test('chute evidence is limited to top-ranked destinations and specifically named physical destinations', () => {
  const scenario = createScenario();
  const map = buildChuteMap(scenario);
  const leaders = map.zones.map(zone => zone.chutes.reduce((a, b) => a.packages >= b.packages ? a : b));
  const requested = map.zones[1].chutes.find(cell => cell.packages && cell.id !== leaders[1].id);
  const routeFacts = question => Array.from(facts(scenario, 'priority', undefined, undefined, question).values())
    .filter(record => record.id.startsWith('chute-'));
  const overview = routeFacts();
  assert.ok(overview.length >= 4 && overview.length <= 6);
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
  assert.ok(exact.length <= overview.length + 2);
  assert.ok(exact.some(record => record.id === 'chute-A200'));
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

test('routing scope, operator focus, explicit comparisons and preceding references are independently grounded', () => {
  const scenario = createScenario();
  const context = { view: 'overview', selectedTrailerId: 'TR-103', chute: { statuses: ['expected'], zoneId: 'B', chuteId: 'B090' } };
  const records = buildShiftEvidence(scenario, 'priority', undefined, 'current', 'Compare A122 and B007', context, ['Why B015?'], ['chute-C200']);
  const byId = new Map(records.map(record => [record.id, record.text]));
  assert.match(byId.get('operator-view'), /TR-103/);
  assert.match(byId.get('chute-coverage'), /Expected.*Central loop.*selected chute: B090.*745 filtered packages/);
  assert.match(byId.get('chute-coverage'), /descending by assigned packages: B090 \(107\)/);
  assert.match(byId.get('chute-B090'), /107 packages.*TR-109/);
  assert.ok(['A122','B007','B015','C200'].every(id => byId.has('chute-' + id)));
  const selected = buildShiftEvidence(scenario, 'priority', undefined, 'current', 'What is here?', {view:'floor', chute:{trailerId:'TR-103', chuteId:'A121'}});
  assert.match(selected.find(r => r.id === 'chute-A121').text, /127 packages assigned by filtered manifests/);
  assert.doesNotMatch(selected.find(r => r.id === 'chute-A121').text, /TR-111/);
  assert.match(byId.get('preview-TR-103'), /yard to door A-02 with 712 packages.*empty doors: 5 before, 4 after.*TR-104/);
  assert.equal(scenario.trailers.find(t => t.id === 'TR-103').status, 'yard');
});

test('capacity evidence marks missing coverage and suppresses decisions when all known work is stale', () => {
  const start = createScenario();
  assert.match(facts(start).get('forecast-coverage').text, /partial.*3919.*829.*lower bounds/);
  const later = facts(advanceClock(advanceClock(start)));
  assert.match(later.get('forecast-coverage').text, /unavailable.*4748.*4410 stale/);
  assert.match(later.get('sort-floor').text, /Shortfall is unavailable/);
  assert.match(later.get('best-transfer').text, /No defensible transfer recommendation/);
  assert.equal(later.has('move-chutes-A-B'), false);
  assert.doesNotMatch(later.get('zone-B').text, /shortfall 0/i);
});

test('the visible directory and pickup table use their own filters, ranks and due totals', () => {
  const scenario = createScenario();
  const visible = (context, key) => buildShiftEvidence(scenario, 'priority', undefined, 'current', 'What is next here?', context).find(record => record.id === key)?.text;
  const pickup = visible({view:'priorities',pickupStage:'expected'}, 'pickup-visible');
  assert.match(pickup, /Expected.*521 due packages across 1 visible loads.*TR-109.*no executable yard proposal.*2576/);
  const directory = visible({view:'queue',queue:{status:'yard',trailerIds:['TR-104','TR-106']}}, 'directory-visible');
  assert.match(directory, /2 matching loads, 1348 packages.*955.*TR-104.*B-02.*TR-106.*X-01/);
  assert.doesNotMatch(directory, /TR-103/);
  assert.match(visible({view:'queue',queue:{trailerIds:[]}},'directory-visible'), /0 matching loads.*no visible loads/);
});
