import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../lib/dock-fixtures.ts';
import { completeTrailer } from '../lib/dock-engine.ts';
import { planPickupWindow, FINAL_SWEEP_MINUTES } from '../lib/shift-priorities.ts';

function shift(loads = []) {
  const example = createScenario();
  return {
    ...example, nowMinute: 20, currentDeadlineMinute: 180, nextDeadlineMinute: 360,
    trailers: loads.map(load => ({
      ...example.trailers[2], status: 'yard', currentDoorId: null, plannedDoorId: null,
      hold: false, packageCount: 100, currentUnits: 10, nextUnits: 10,
      arrivalMinute: 10, ...load,
    })),
  };
}

test('each pickup counts its own freight and distinguishes full trailer volume from packages due', () => {
  const scenario = shift([
    { id: 'Yard', currentUnits: 20, nextUnits: 0 },
    { id: 'Docked', status: 'at_door', currentDoorId: 'A-01', currentUnits: 9, nextUnits: 75 },
    { id: 'Coming', status: 'expected', arrivalMinute: 240, currentUnits: 0, nextUnits: 42 },
    { id: 'Finished', status: 'complete', currentUnits: 90 },
  ]);
  const current = planPickupWindow(scenario, 'current');
  assert.deepEqual(current.stageDue, { yard: 20, at_door: 9, expected: 0 });
  assert.equal(current.due, 29);
  assert.equal(current.loadVolume, 200);
  const next = planPickupWindow(scenario, 'next');
  assert.equal(next.due, 117);
  assert.equal(next.loadVolume, 200);
  assert.deepEqual(next.rows.map(row => row.trailer.id), ['Docked', 'Coming']);
  const finished = completeTrailer(scenario, 'Docked').scenario;
  assert.equal(planPickupWindow(finished, 'next').due, 42);
});

test('early volume order changes to due share at the final-sweep boundary and oldest on-site load after cutoff', () => {
  const scenario = shift([
    { id: 'Most due', packageCount: 400, currentUnits: 80, arrivalMinute: 15 },
    { id: 'Dense', currentUnits: 65, arrivalMinute: 12 },
    { id: 'Oldest', currentUnits: 25, arrivalMinute: 3 },
    { id: 'Inbound', status: 'expected', currentUnits: 90, arrivalMinute: 300 },
  ]);
  const planAt = minute => planPickupWindow({ ...scenario, nowMinute: minute }, 'current');
  const titles = plan => plan.rows.map(row => row.trailer.id);
  const cutoff = scenario.currentDeadlineMinute;
  assert.deepEqual(titles(planAt(cutoff - FINAL_SWEEP_MINUTES - 1)), ['Most due','Dense','Oldest','Inbound']);
  assert.deepEqual(titles(planAt(cutoff - FINAL_SWEEP_MINUTES)), ['Dense','Oldest','Most due','Inbound']);
  assert.equal(planAt(cutoff).phase, 'final');
  assert.deepEqual(titles(planAt(cutoff + 1)), ['Oldest','Dense','Most due','Inbound']);
  assert.equal(planAt(cutoff + 1).rows.at(-1).arrivesAtOrAfterCutoff, true);
});

test('ETA at cutoff is flagged for the affected window, and ties have a stable load order', () => {
  const scenario = shift([
    { id: 'b' }, { id: 'a' }, { id: 'arrival', status: 'expected', arrivalMinute: 180 },
  ]);
  const current = planPickupWindow(scenario, 'current');
  assert.deepEqual(current.rows.map(row => row.trailer.id), ['a','b','arrival']);
  assert.equal(current.rows[2].arrivesAtOrAfterCutoff, true);
  assert.equal(planPickupWindow(scenario, 'next').rows[2].arrivesAtOrAfterCutoff, false);
  assert.deepEqual(scenario.trailers.map(row => row.id), ['b','a','arrival']);
});
