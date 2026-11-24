import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../lib/dock-fixtures.ts';
import { advanceClock, parseScenario } from '../lib/dock-engine.ts';
import { buildChuteMap, CHUTES_PER_ZONE } from '../lib/chute-routing.ts';

const sum = (rows, value) => rows.reduce((total, row) => total + value(row), 0);

test('physical chute counts reconcile with every seeded manifest, independently of the resource plan', () => {
  for (const preset of ['balanced', 'surge', 'disruption']) {
    for (const seed of [0, 42, 0xffffffff]) {
      const scenario = createScenario(preset, seed);
      const parsed = parseScenario(JSON.parse(JSON.stringify(scenario)));
      assert.deepEqual(parsed.scenario, scenario);
      assert.deepEqual(createScenario(preset, seed).trailers, scenario.trailers);
      for (const trailer of scenario.trailers) {
        const map = buildChuteMap(scenario, { trailerId: trailer.id });
        assert.equal(map.trailerCount, 1);
        assert.equal(map.totalPackages, trailer.packageCount);
        for (const zone of map.zones) {
          assert.equal(zone.chutes.length, CHUTES_PER_ZONE);
          assert.equal(zone.chutes[0].id, zone.id + '001');
          assert.equal(zone.chutes.at(-1).id, zone.id + '200');
          assert.equal(sum(zone.chutes, c => c.packages), trailer.handling === 'crossdock' ? 0 : trailer.zoneUnits[zone.id]);
        }
      }
      const map = buildChuteMap(scenario);
      const active = scenario.trailers.filter(t => t.status !== 'complete');
      assert.equal(map.totalPackages, sum(active, t => t.packageCount));
      assert.equal(map.routedPackages, sum(map.zones, z => z.routedPackages));
      assert.equal(map.unmappedPackages, sum(active.filter(t => !t.profileKnown && t.handling !== 'crossdock'), t => t.packageCount));
      assert.equal(map.bypassedPackages, sum(active.filter(t => t.handling === 'crossdock'), t => t.packageCount));
      assert.equal(map.totalPackages, map.routedPackages + map.unmappedPackages + map.bypassedPackages);
      const cells = map.zones.flatMap(z => z.chutes);
      assert.ok(cells.some(c => c.sources.length > 1));
      for (const cell of cells) {
        assert.equal(sum(cell.sources, s => s.packages), cell.packages);
        assert.equal(cell.sharePercent, cell.packages / map.sorterPackages * 100);
      }
    }
  }
});

test('selecting inbound stages filters both route counts and contributors and responds to arrivals', () => {
  const scenario = createScenario();
  const expected = scenario.trailers.find(t => t.status === 'expected');
  const map = buildChuteMap(scenario, { statuses: ['expected'] });
  assert.equal(map.trailerCount, 1);
  assert.equal(map.totalPackages, expected.packageCount);
  const cells = map.zones.flatMap(z => z.chutes).filter(c => c.packages);
  assert.ok(cells.length > 0);
  assert.ok(cells.every(c => c.sources.every(s => s.status === 'expected' && s.trailerId === expected.id)));
  const afterArrival = advanceClock(scenario, expected.arrivalMinute - scenario.nowMinute);
  assert.equal(buildChuteMap(afterArrival, { statuses: ['expected'] }).totalPackages, 0);
  assert.deepEqual(buildChuteMap(scenario, { trailerId: expected.id, statuses: ['at_door'] }), buildChuteMap(scenario, { statuses: [] }));
  for (const c of buildChuteMap(scenario, { trailerId: 'absent' }).zones.flatMap(z => z.chutes)) {
    assert.equal(c.sharePercent, 0);
  }
});

test('missing route details stay unassigned at their known granularity in older and mixed snapshots', () => {
  const scenario = createScenario();
  const waiting = scenario.trailers.find(t => t.id === 'TR-103');
  delete waiting.chuteRoutes;
  const unknown = scenario.trailers.find(t => !t.profileKnown);
  const restored = parseScenario(JSON.parse(JSON.stringify(scenario))).scenario;
  const selection = buildChuteMap(restored, { trailerId: waiting.id });
  assert.equal(selection.routedPackages, 0);
  assert.equal(selection.unmappedPackages, waiting.packageCount);
  for (const zone of selection.zones) {
    assert.equal(zone.unmappedPackages, waiting.zoneUnits[zone.id]);
    assert.ok(zone.chutes.every(c => c.packages === 0 && c.sources.length === 0));
  }
  const aggregate = buildChuteMap(restored);
  assert.equal(aggregate.unmappedPackages, waiting.packageCount + unknown.packageCount);
  assert.equal(sum(aggregate.zones, z => z.unmappedPackages), waiting.packageCount);
});

test('chute import enforces per-zone reconciliation, canonical destinations and nonnegative whole counts', () => {
  for (const id of ['A000', 'A201', 'A1', 'A0010', 'a001', 'D001', '__proto__']) {
    const scenario = createScenario();
    Object.defineProperty(scenario.trailers[0].chuteRoutes, id, { value: 0, enumerable: true });
    assert.equal(parseScenario(scenario).ok, false);
  }
  for (const value of [-1, 0.5, Infinity, '3', 1000001]) {
    const scenario = createScenario();
    scenario.trailers[0].chuteRoutes.A200 = value;
    assert.equal(parseScenario(scenario).ok, false);
  }
  const scenario = createScenario();
  const load = scenario.trailers[0];
  const empty = buildChuteMap(scenario, { trailerId: load.id }).zones[0].chutes.find(c => !c.packages);
  load.chuteRoutes[empty.id] = 0;
  assert.equal(parseScenario(scenario).ok, true);
  const full = Object.keys(load.chuteRoutes).find(id => id[0] === 'A' && load.chuteRoutes[id] > 0);
  load.chuteRoutes[full]--;
  load.chuteRoutes.B200 = (load.chuteRoutes.B200 ?? 0) + 1;
  assert.equal(parseScenario(scenario).ok, false);
  const unknown = createScenario();
  unknown.trailers.find(t => !t.profileKnown).chuteRoutes = {};
  assert.equal(parseScenario(unknown).ok, false);
});


test('transfer freight bypasses all chutes, even when a saved transfer has route detail or no profile', () => {
  const scenario = createScenario();
  const load = scenario.trailers.find(t => t.handling === 'crossdock');
  assert.equal(load.chuteRoutes, undefined);
  // An earlier synthetic snapshot might have supplied a fully reconciled transfer manifest.
  load.chuteRoutes = { A001: load.zoneUnits.A, B001: load.zoneUnits.B, C001: load.zoneUnits.C };
  const saved = parseScenario(JSON.parse(JSON.stringify(scenario)));
  assert.equal(saved.ok, true);
  const known = buildChuteMap(saved.scenario, { trailerId: load.id });
  assert.equal(known.totalPackages, load.packageCount);
  assert.equal(known.bypassedPackages, load.packageCount);
  assert.equal(known.sorterPackages, 0);
  assert.equal(known.routedPackages, 0);
  assert.equal(known.unmappedPackages, 0);
  assert.ok(known.zones.every(z => z.unmappedPackages === 0 && z.chutes.every(c => !c.packages && !c.sources.length && c.sharePercent === 0)));
  delete load.chuteRoutes;
  delete load.packageMix;
  load.profileKnown = false;
  load.profileUpdatedMinute = null;
  load.zoneUnits = { A: 0, B: 0, C: 0 };
  assert.deepEqual(buildChuteMap(scenario, { trailerId: load.id }), known);
});
