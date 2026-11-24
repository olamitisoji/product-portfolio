import { buildLoadDoorBoard, evaluate } from './dock-engine.ts';
import { createScenario } from './dock-fixtures.ts';
import type { PlanMode, Scenario, Trailer, ZoneId } from './dock-types.ts';
import { planPickupWindow, type PickupWindow } from './shift-priorities.ts';
import { BASE_FLOOR_PLAN, currentShiftRecord, evaluateSortFloor, moveFloorResource, type FloorPlan } from './sort-floor.ts';

export interface ShiftEvidence {
  id: string;
  label: string;
  text: string;
  trailerId?: string;
}

const reference = createScenario();
const fixtureTrailers = new Set(reference.trailers.map(row => row.id));
const fixtureDoors = new Set(reference.doors.map(row => row.id));
const clock = (minute: number) => [Math.floor(minute / 60), minute % 60].map(value => String(value).padStart(2, '0')).join(':');
const stage: Record<Trailer['status'], string> = {
  at_door: 'At door', yard: 'In yard', expected: 'Expected', complete: 'Completed',
};

function summarizeList(names: string[]) {
  if (!names.length) return 'none';
  const head = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${head} and ${names.length - 3} more` : head;
}

// Only published synthetic names can appear in evidence. Imported labels and carriers never enter model context.
function safeReferences(scenario: Scenario) {
  const loads = new Map(scenario.trailers.map((load, index) => [load.id, fixtureTrailers.has(load.id) ? load.id : `Load ${index + 1}`]));
  const doors = new Map(scenario.doors.map((door, index) => [door.id, fixtureDoors.has(door.id) ? door.id : `Door ${index + 1}`]));
  const zone = (id: ZoneId) => {
    const builtIn = reference.zones.find(row => row.id === id)!;
    return scenario.zones.find(row => row.id === id)?.name === builtIn.name ? builtIn.name : `Zone ${id}`;
  };
  return { load: (id: string) => loads.get(id)!, door: (id: string) => doors.get(id)!, zone };
}

// Callers validate the scenario, selected plan and pickup before this projection.
// The scenario schema limits this to 100 trailer, 30 door, and three zone records.
export function buildShiftEvidence(
  scenario: Scenario, mode: PlanMode, floorPlan: FloorPlan = BASE_FLOOR_PLAN, pickup: PickupWindow = 'current',
): ShiftEvidence[] {
  const refs = safeReferences(scenario);
  const evaluation = evaluate(scenario, mode);
  const board = buildLoadDoorBoard(scenario, evaluation);
  const primary = new Map(evaluation.recommendations.flatMap(rec => rec.primary ? [[rec.trailerId, rec.primary] as const] : []));
  const evidence: ShiftEvidence[] = [];
  const add = (id: string, label: string, text: string, trailerId?: string) => {
    evidence.push({ id, label, text, ...(trailerId && fixtureTrailers.has(trailerId) ? { trailerId } : {}) });
  };
  add('shift', 'Shift overview', `Synthetic shift at ${clock(scenario.nowMinute)}. Selected pickup: ${pickup}. Door plan order: ${mode === 'priority' ? 'deadline priority' : 'arrival order'}. ${evaluation.metrics.activeTrailers} active trailers, ${evaluation.metrics.totalPackages} active packages. ${evaluation.metrics.availableDoors} enabled empty doors, ${primary.size} yard assignments proposed. Acceptance is an operator action.`);

  for (const window of ['current', 'next'] as const) {
    const plan = planPickupWindow(scenario, window);
    const name = window === 'current' ? 'Current pickup' : 'Next pickup';
    const phaseOrder = { open: 'most due packages first', final: 'highest due share first', overdue: 'oldest on-site arrival first' }[plan.phase];
    add(`pickup-${window}`, name, `${clock(plan.deadline)} pickup: ${plan.due} packages due across ${plan.rows.length} active trailers carrying ${plan.loadVolume} total packages. Due by stage: ${plan.stageDue.yard} in yard, ${plan.stageDue.at_door} at door, ${plan.stageDue.expected} expected. Phase: ${plan.phase}; on-site pickup ranking: ${phaseOrder}. Expected trailers follow on-site work.`);
    const dispatchable = plan.rows.filter(row => row.stage === 'yard' && primary.has(row.trailer.id));
    const ranked = dispatchable[0];
    if (!ranked) {
      add(`dispatch-${window}`, `${name} yard priority`, 'No yard trailer with freight due in this window has an executable door proposal.');
      continue;
    }
    const largest = dispatchable.reduce((best, row) => row.due > best.due ? row : best);
    const describe = (row: typeof ranked) => `${refs.load(row.trailer.id)}, ${row.due} due, proposed door ${refs.door(primary.get(row.trailer.id)!.doorId)}`;
    add(`dispatch-${window}`, `${name} yard priority`, `Highest pickup-ranked yard load with an executable proposal: ${describe(ranked)}. Most due packages among executable yard proposals: ${describe(largest)}. All ${dispatchable.length} such loads together carry ${dispatchable.reduce((sum, row) => sum + row.due, 0)} packages due in this pickup.`, ranked.trailer.id);
  }

  for (const { trailer, decision, placementIssues } of board) {
    const name = refs.load(trailer.id);
    const location = trailer.currentDoorId ? `At door ${refs.door(trailer.currentDoorId)}` : stage[trailer.status];
    const lines = [`${location}. Arrival ${clock(trailer.arrivalMinute)}. ${trailer.handling} handling. ${trailer.packageCount} total; current pickup ${trailer.currentUnits}, next pickup ${trailer.nextUnits}.`];
    if (trailer.hold) lines.push('Planning hold.');
    lines.push(trailer.plannedDoorId ? `Preassigned ${refs.door(trailer.plannedDoorId)}.` : 'No preassigned door.');
    if (decision.kind === 'proposal') lines.push(`Proposed ${refs.door(decision.doorId)}; compatible, enabled and physically empty.`);
    if (decision.kind === 'conditional') lines.push(`Conditional target ${refs.door(decision.doorId)}: ${decision.label}. Cannot assign now.`);
    if (decision.kind === 'review') lines.push(`Assignment blocked: ${decision.label}.`);
    if (trailer.profileKnown) lines.push(`Destination packages: A ${trailer.zoneUnits.A}, B ${trailer.zoneUnits.B}, C ${trailer.zoneUnits.C}.`);
    else lines.push('Destination counts unknown.');
    if (placementIssues.length) lines.push(`Physical placement exceptions: ${placementIssues.map(item => item.code).join(', ')}.`);
    add(`trailer-${name.replaceAll(' ', '-')}`, name, lines.join(' '), trailer.id);
  }
  for (const door of scenario.doors) {
    const name = refs.door(door.id);
    const list = (ids: string[]) => summarizeList(ids.map(refs.load));
    const occupants = scenario.trailers.filter(load => load.status === 'at_door' && load.currentDoorId === door.id);
    const prior = scenario.trailers.filter(load => load.status !== 'complete' && load.plannedDoorId === door.id);
    const proposals = evaluation.recommendations.filter(rec => rec.primary?.doorId === door.id);
    add(`door-${name.replaceAll(' ', '-')}`, fixtureDoors.has(door.id) ? `Door ${name}` : name,
      `${door.enabled ? 'Enabled' : 'Disabled'}. ${door.zoneId ? refs.zone(door.zoneId) : 'Transfer door'}. Handling: ${door.allowedHandling.join(', ')}. Occupants: ${list(occupants.map(load => load.id))}. Preassigned: ${list(prior.map(load => load.id))}. Executable proposal: ${list(proposals.map(rec => rec.trailerId))}.`);
  }

  const floor = evaluateSortFloor(scenario, floorPlan);
  const excluded = floor.excluded;
  add('sort-floor', 'Sort floor forecast', `${clock(scenario.nowMinute)} to ${clock(floor.endMinute)} forecast for ${floor.minutes} minutes, ${floor.packages} mapped packages. Baseline shortfall ${floor.baseGap}; selected plan shortfall ${floor.gap}. Shortfall sums unmet demand per zone. Excluded packages: held ${excluded.held}, transfer ${excluded.transfer}, unmapped ${excluded.unmapped}, stale ${excluded.stale}. Resource transfers are what-if forecasts.`);
  for (const row of floor.zones) {
    const capacity = row.proposed;
    add(`zone-${row.zone}`, refs.zone(row.zone), `Forecast demand ${row.packages} = ${row.onSite} on site + ${row.expected} expected. Selected plan: ${floorPlan.chutes[row.zone]} chutes (capacity ${capacity.chuteLimit}), ${floorPlan.crew[row.zone]} crew (capacity ${capacity.crewLimit}). Effective capacity ${capacity.units}, limiting resource ${capacity.limitingResource}, shortfall ${row.gap}. Baseline capacity ${row.baseline.units}, shortfall ${row.baseGap}. Package sizes: compact ${row.sizes.compact}, standard ${row.sizes.standard}, bulky ${row.sizes.bulky}, unknown size ${row.unknownSize}.`);
  }
  let best: { gap: number; text: string } | undefined;
  for (const resource of ['chutes', 'crew'] as const) {
    for (const from of ['A', 'B', 'C'] as const) {
      if (floorPlan[resource][from] < 1) continue;
      for (const to of ['A', 'B', 'C'] as const) {
        if (to === from) continue;
        const candidate = evaluateSortFloor(scenario, moveFloorResource(floorPlan, resource, from, to));
        const destination = candidate.zones.find(row => row.zone === to)!;
        const origin = candidate.zones.find(row => row.zone === from)!;
        const unit = resource === 'chutes' ? 'chute' : 'crew member';
        const text = `Move one ${unit} from ${refs.zone(from)} to ${refs.zone(to)} in the selected plan: forecast total shortfall changes from ${floor.gap} to ${candidate.gap} packages. ${refs.zone(to)} then has capacity ${destination.proposed.units}, limiting resource ${destination.proposed.limitingResource}, shortfall ${destination.gap}; ${refs.zone(from)} has shortfall ${origin.gap}.`;
        add(`move-${resource}-${from}-${to}`, `${refs.zone(from)} to ${refs.zone(to)} · ${unit}`, text);
        if (candidate.gap < (best?.gap ?? floor.gap)) best = { gap: candidate.gap, text };
      }
    }
  }
  add('best-transfer', 'Best single transfer', best ? `${best.text} This is a best single transfer by total shortfall; another move may tie.` : 'No single available chute or crew transfer lowers the total shortfall under the selected plan.');

  const record = currentShiftRecord(scenario);
  if (!record) add('shift-record', 'Shift record', 'No shift record available at this clock time. Recorded output and first-pass yield are unknown.');
  else {
    const { report, yieldPercent, variance } = record;
    const yieldText = yieldPercent === null || !report.firstPass ? 'First-pass yield unavailable.'
      : `First-pass yield ${yieldPercent.toFixed(1)}% (${report.firstPass.sorted} sorted on first pass of ${report.firstPass.attempted} attempts).`;
    add('shift-record', 'Shift record', `Latest cumulative synthetic observation at ${clock(report.atMinute)}: ${report.processedPackages} processed, ${report.plannedPackages} planned, variance ${variance >= 0 ? '+' : ''}${variance} packages. ${yieldText} Floor transfers do not change recorded output.`);
  }
  return evidence;
}
