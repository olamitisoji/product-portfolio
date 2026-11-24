import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../lib/dock-fixtures.ts';
import { advanceClock, applyAssignment, evaluate } from '../lib/dock-engine.ts';
import { evaluateSortFloor, moveFloorResource } from '../lib/sort-floor.ts';
import { freshSession, readSession, serializeSession, ShiftStore, SHIFT_KEY } from '../lib/shift-session.ts';

function sharedStorage() {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  let pending = Promise.resolve();
  const lock = fn => { const result = pending.then(fn); pending = result.catch(() => {}); return result; };
  return { data, open: () => new ShiftStore(storage, lock) };
}

test('snapshot round-trip reproduces the recommended door and the staffing forecast', () => {
  const session = freshSession(createScenario());
  session.mode = 'arrival';
  session.floorPlan = moveFloorResource(session.floorPlan, 'chutes', 'A', 'B');
  const restored = readSession(JSON.parse(serializeSession(session)));
  const proposal = evaluate(restored.scenario, restored.mode).recommendations.find(rec => rec.primary?.doorId === 'B-02');
  assert.equal(proposal.trailerId, 'TR-111');
  assert.equal(evaluateSortFloor(restored.scenario, restored.floorPlan).gap, 216);
  assert.deepEqual(restored, session);
});

test('bare scenarios and version 1 envelopes retain baseline resources; invalid explicit settings are rejected', () => {
  const base = createScenario();
  delete base.volumePlan;
  const defaults = freshSession(base);
  assert.deepEqual(readSession(base), defaults);
  assert.deepEqual(readSession({ scenario: base, audit: [] }), defaults);
  for (const amendment of [{ sessionVersion: 17 }, { floorPlan: null }, { mode: 'alphabetical' },
    { floorPlan: { ...defaults.floorPlan, chutes: { A: 5, B: 5, C: 5 } } }]) {
    assert.throws(() => readSession({ ...defaults, ...amendment }));
  }
});

test('two first-time tabs can both use the same untouched initial shift', async () => {
  const { open } = sharedStorage();
  const pristine = freshSession(createScenario());
  const first = open();
  const second = open();
  assert.equal(first.read(pristine), null);
  assert.equal(second.read(pristine), null);
  assert.equal(await first.save(pristine), null);
  assert.equal(second.newerSaveExists(), false);
  assert.equal(await second.save({ ...pristine, mode: 'arrival' }), null);
  assert.equal(first.newerSaveExists(), true);
});

test('concurrent canonical tabs cannot overwrite each other; the stale session remains exportable', async () => {
  const { data, open } = sharedStorage();
  const pristine = freshSession(createScenario());
  data.set(SHIFT_KEY, serializeSession(pristine));
  const first = open();
  const second = open();
  const sessionA = first.read();
  const sessionB = second.read();
  const assignment = applyAssignment(sessionA.scenario, 'TR-103', 'A-02', 'Accepted');
  const assigned = { ...sessionA, scenario: assignment.scenario, audit: [assignment.event] };
  const advanced = { ...sessionB, scenario: advanceClock(sessionB.scenario) };
  const writes = await Promise.all([first.save(assigned), second.save(advanced)]);
  assert.deepEqual(writes, [null, 'conflict']);
  assert.equal(second.newerSaveExists(), true);
  assert.equal(first.newerSaveExists(), false);
  assert.deepEqual(open().read(), assigned);
  assert.equal(readSession(JSON.parse(serializeSession(advanced))).scenario.nowMinute, 630);
  assert.deepEqual(second.read(), assigned);
  assert.equal(await second.save({ ...assigned, scenario: advanceClock(assigned.scenario) }), null);
});

test('corrupt save survives initial render and subsequent edits and can be backed up explicitly', async () => {
  const { data, open } = sharedStorage();
  const tab = open();
  const raw = '{"scenario":';
  data.set(SHIFT_KEY, raw);
  assert.throws(() => tab.read());
  assert.equal(tab.unreadableData, raw);
  const fresh = freshSession(createScenario());
  assert.equal(await tab.save(fresh), 'unreadable');
  assert.equal(data.get(SHIFT_KEY), raw);
  assert.equal(await tab.save(fresh, true), null);
  const backup = [...data.entries()].find(([key]) => key.startsWith(SHIFT_KEY + '.recovered.'));
  assert.equal(backup[1], raw);
  assert.deepEqual(open().read(), fresh);
});

test('corrupt recovery refuses to overwrite a concurrently restored valid shift', async () => {
  const { data, open } = sharedStorage();
  data.set(SHIFT_KEY, 'invalid');
  const tab = open();
  assert.throws(() => tab.read());
  const fresh = freshSession(createScenario());
  const saved = { ...fresh, mode: 'arrival' };
  data.set(SHIFT_KEY, serializeSession(saved));
  assert.equal(await tab.save(fresh, true), 'conflict');
  assert.deepEqual(open().read(), saved);
});
