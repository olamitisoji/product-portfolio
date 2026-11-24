import { applyAssignment, buildLoadDoorBoard, evaluate } from './dock-engine.ts';
import { buildChuteMap, chuteZone, CHUTES_PER_ZONE } from './chute-routing.ts';
import type { AnalystContext } from './analyst-context.ts';
import { createScenario } from './dock-fixtures.ts';
import type { PlanMode, Scenario, Trailer, ZoneId } from './dock-types.ts';
import { planPickupWindow, type PickupWindow } from './shift-priorities.ts';
import { getVolumeTargets } from './volume-plan.ts';
import { getBaselineFloorPlan, currentShiftRecord, evaluateSortFloor, moveFloorResource, type FloorPlan } from './sort-floor.ts';

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

function chuteEvidence(
  scenario: Scenario, refs: ReturnType<typeof safeReferences>, question: string,
  context?: AnalystContext, priorQuestions: string[] = [], priorEvidenceIds: string[] = [],
): ShiftEvidence[] {
  const filter = context?.chute;
  const map = buildChuteMap(scenario, filter);
  const focusedZone = filter?.zoneId;
  const label = filter?.trailerId ? refs.load(filter.trailerId)
    : filter?.statuses ? filter.statuses.map(status => stage[status]).join(', ') || 'no locations selected' : 'all active trailers';
  const scope = filter?.trailerId || filter?.statuses ? 'filtered' : 'active';
  const scopedCells = map.zones.filter(zone => !focusedZone || focusedZone === zone.id).flatMap(zone => zone.chutes);
  const top = scopedCells.filter(cell => cell.packages > 0).sort((a, b) => b.packages - a.packages || a.id.localeCompare(b.id)).slice(0, 4);
  // Current question and canvas focus take precedence over older references.
  const named = (value: string) => (value.toUpperCase().match(/\b[ABC][0-9]{3}\b/g) ?? []).filter(id => chuteZone(id));
  const requested = new Set([...new Set([
    ...named(question), ...(filter?.chuteId ? [filter.chuteId] : []),
    ...priorQuestions.slice().reverse().flatMap(named),
    ...priorEvidenceIds.filter(id => /^chute-[ABC][0-9]{3}$/.test(id)).map(id => id.slice(6)),
  ])].slice(0, 8));
  const unknownZone = map.unmappedPackages - map.zones.reduce((sum, zone) => sum + zone.unmappedPackages, 0);
  const records: ShiftEvidence[] = [{
    id: 'chute-coverage', label: 'Destination routing coverage',
    text: `Map selection: ${label}; zone focus: ${focusedZone ? refs.zone(focusedZone) : 'all zones'}; selected chute: ${filter?.chuteId ?? 'none'}. Fictional manifests contain ${map.totalPackages} ${scope} packages across ${map.trailerCount} trailers. ${map.bypassedPackages} crossdock packages bypass the sorter. Manifests assign ${map.routedPackages} of ${map.sorterPackages} sorter packages to physical chutes. ${map.unmappedPackages} packages lack a chute assignment, including ${unknownZone} with an unknown zone. Busiest known chutes in view, descending by assigned packages: ${top.map(cell => cell.id + ' (' + cell.packages + ')').join(', ') || 'none'}. Manifest coverage totals and percentage denominator span all zones of the selected trailers. Each of three zones has ${CHUTES_PER_ZONE} fixed destinations. Individual arrival scans and chute congestion measurements are unavailable.`,
  }];
  const detailed = new Set([...requested, ...top.slice(0, 2).map(cell => cell.id)]);
  for (const zone of map.zones) {
    const inView = !focusedZone || zone.id === focusedZone;
    const name = refs.zone(zone.id);
    const peak = zone.chutes.reduce((best, cell) => cell.packages > best.packages ? cell : best);
    if (inView && peak.packages) detailed.add(peak.id);
    if (inView && !peak.packages) {
      records.push({ id: `chute-zone-${zone.id}`, label: `${name} chute routing`, text: `No ranked chute in ${name}. Selected manifests assign zero packages here. ${zone.unmappedPackages} packages have a known zone and no chute detail. Across all zones, ${unknownZone} packages have an unknown zone.` });
    }
    const ties = zone.chutes.filter(cell => cell.packages === peak.packages).length;
    for (const cell of zone.chutes.filter(item => detailed.has(item.id))) {
      const contributors = cell.sources.slice(0, 12).map(source => `${refs.load(source.trailerId)} (${stage[source.status]}, ${source.packages} packages)`);
      if (cell.sources.length > contributors.length) contributors.push(`${cell.sources.length - contributors.length} additional trailers`);
      const share = map.sorterPackages ? `${cell.sharePercent.toFixed(2)}% of ${scope} sorter packages` : `no ${scope} sorter freight`;
      const rank = peak.packages && cell.packages === peak.packages
        ? (ties > 1 ? `Joint highest known volume among ${ties} chutes in this zone. ` : 'Highest known chute volume in this zone. ') : '';
      records.push({
        id: `chute-${cell.id}`, label: `Chute ${cell.id} · ${name}`,
        text: `${cell.id} in ${name}: ${cell.packages} packages assigned by ${scope} manifests (${share}). ${rank}Contributing trailers: ${contributors.join(', ') || 'none'}. ${zone.unmappedPackages + unknownZone ? 'The destination of additional packages is unknown. ' : ''}Arrival scan confirmation is unavailable.`,
      });
    }
  }
  return records;
}

// Callers validate the scenario, selected plan and pickup before this projection.
// The scenario schema limits this to 100 trailer, 30 door, and three zone records.
export function buildShiftEvidence(
  scenario: Scenario, mode: PlanMode, floorPlan: FloorPlan = getBaselineFloorPlan(scenario), pickup: PickupWindow = 'current', question = '',
  context?: AnalystContext, priorQuestions: string[] = [], priorEvidenceIds: string[] = [],
): ShiftEvidence[] {
  const refs = safeReferences(scenario);
  const evaluation = evaluate(scenario, mode);
  const board = buildLoadDoorBoard(scenario, evaluation);
  const primary = new Map(evaluation.recommendations.flatMap(rec => rec.primary ? [[rec.trailerId, rec.primary] as const] : []));
  const evidence: ShiftEvidence[] = [];
  const add = (id: string, label: string, text: string, trailerId?: string) => {
    evidence.push({ id, label, text, ...(trailerId && fixtureTrailers.has(trailerId) ? { trailerId } : {}) });
  };
  add('shift', 'Shift overview', `Synthetic shift at ${clock(scenario.nowMinute)}. Selected pickup: ${pickup}. Door plan order: ${mode === 'priority' ? 'deadline priority' : 'arrival order'}. ${evaluation.metrics.activeTrailers} visible active trailers with ${evaluation.metrics.totalPackages} packages in their manifests. ${evaluation.metrics.availableDoors} enabled empty doors, ${primary.size} yard assignments proposed. Acceptance is an operator action.`);

  if (context) {
    const selected = context.selectedTrailerId ? refs.load(context.selectedTrailerId) : undefined;
    add('operator-view', 'Current workspace selection', `Screen: ${context.view}. Focused trailer: ${selected ?? 'none'}. Selected pickup: ${pickup}. The chute map filter applies to routing evidence. Shift-wide capacity, pickups and door recommendations use the full scenario.`, context.selectedTrailerId);
  }

  if (scenario.volumePlan) {
    const plan = scenario.volumePlan;
    const targets = getVolumeTargets(plan);
    add('volume-plan', 'Facility volume plan',
      `Facility planning volume: approximately ${plan.weeklyPackages} packages per week. Scenario assumes ${plan.operatingDaysPerWeek} operating days per week, ${plan.shiftsPerDay} shifts per day and ${plan.shiftHours} hours per shift. On average that is about ${Math.round(targets.dailyPackages)} per day, ${Math.round(targets.shiftPackages)} per shift and ${Math.round(targets.hourlyPackages)} per hour. These are full-facility planning targets. The visible trailer manifests form one inbound snapshot; the one-hour forecast covers only eligible freight in that snapshot. Recorded throughput comes from timestamped shift observations.`);
  } else {
    add('volume-plan', 'Facility volume plan', 'This snapshot contains no facility volume target. Weekly and full-shift volumes cannot be established from the currently visible trailer manifests.');
  }

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

  const pickupPlan = planPickupWindow(scenario, pickup);
  let visibleRows = pickupPlan.rows;
  if (context?.view === 'priorities') {
    visibleRows = pickupPlan.rows.filter(row => !context.pickupStage || row.stage === context.pickupStage);
    const selectedStage = context.pickupStage ? stage[context.pickupStage] : 'all locations';
    add('pickup-visible', 'Visible pickup queue', `Selected ${pickup} pickup at ${clock(pickupPlan.deadline)}, location filter: ${selectedStage}. ${visibleRows.reduce((sum,row) => sum + row.due,0)} due packages across ${visibleRows.length} visible loads. Display order, due packages and current action: ${visibleRows.map(row => `${refs.load(row.trailer.id)} (${row.due} due, ${stage[row.stage]}, ${primary.has(row.trailer.id) ? 'executable door proposal' : 'no executable yard proposal'})`).join(', ') || 'no visible loads'}. Whole-pickup volume across locations: ${pickupPlan.due}.`, visibleRows[0]?.trailer.id);
  }
  if (context?.view === 'queue' && context.queue) {
    const selected = context.queue;
    const visibleIds = new Set(selected.trailerIds);
    const loads = new Map(scenario.trailers.map(trailer => [trailer.id,trailer] as const));
    const rows = evaluation.queueIds.filter(id => {
      const trailer = loads.get(id)!;
      return visibleIds.has(id) && (!selected.status || (selected.status === 'high' ? evaluation.priorities[id].level === 'high' : trailer.status === selected.status));
    }).map(id => loads.get(id)!);
    const ids = new Set(rows.map(row => row.id));
    visibleRows = pickupPlan.rows.filter(row => ids.has(row.trailer.id));
    const describe = (row: Trailer) => `${refs.load(row.id)} (${stage[row.status]}, ${row.packageCount} manifest packages, ${pickup === 'current' ? row.currentUnits : row.nextUnits} in selected pickup bucket, ${primary.has(row.id) ? 'proposed ' + refs.door(primary.get(row.id)!.doorId) : 'no executable yard proposal'})`;
    add('directory-visible', 'Visible trailer directory', `Directory filter: ${selected.status ?? 'all statuses'}; ${rows.length} matching loads, ${rows.reduce((sum,row) => sum + row.packageCount,0)} packages in these manifests including any completed rows. Outstanding due packages for these matches in selected pickup: ${visibleRows.reduce((sum,row) => sum + row.due,0)}. Display order: ${rows.map(describe).join(', ') || 'no visible loads'}.`);
  }
  const requestedTrailers = (question.toUpperCase().match(/\bTR-[0-9]+\b/g) ?? []).filter(id => fixtureTrailers.has(id));
  const rankedPickup = visibleRows.find(row => primary.has(row.trailer.id));
  const decisionIds = new Set([
    ...requestedTrailers, ...(context?.selectedTrailerId ? [context.selectedTrailerId] : []),
    ...(rankedPickup ? [rankedPickup.trailer.id] : []),
  ].slice(0, 4));
  for (const id of decisionIds) {
    const candidate = primary.get(id);
    if (!candidate) continue;
    const name = refs.load(id);
    const projected = evaluate(applyAssignment(scenario, id, candidate.doorId).scenario, mode);
    const next = visibleRows.find(row => projected.recommendations.some(rec => rec.primary && rec.trailerId === row.trailer.id));
    const due = scenario.trailers.find(row => row.id === id)!;
    add(`preview-${name.replaceAll(' ', '-')}`, `Preview · ${name} at ${refs.door(candidate.doorId)}`,
      `If the operator accepts the current proposal, ${name} moves from yard to door ${refs.door(candidate.doorId)} with ${pickup === 'current' ? due.currentUnits : due.nextUnits} packages due in the selected pickup. Enabled empty doors: ${evaluation.metrics.availableDoors} before, ${projected.metrics.availableDoors} after. Next executable pickup-ranked yard load among visible matches after this assignment: ${next ? refs.load(next.trailer.id) : 'none'}. Assignment establishes door occupancy; unloading duration, cutoff success and completed packages are unmeasured.`, id);
  }
  for (const { trailer, decision, placementIssues } of board) {
    const name = refs.load(trailer.id);
    const location = trailer.currentDoorId ? `At door ${refs.door(trailer.currentDoorId)}` : stage[trailer.status];
    const lines = [`${location}. Arrival ${clock(trailer.arrivalMinute)}. ${trailer.handling} handling. ${trailer.packageCount} total; current pickup ${trailer.currentUnits}, next pickup ${trailer.nextUnits}.`];
    if (trailer.hold) lines.push('Planning hold.');
    if (trailer.handling === 'crossdock') lines.push('Crossdock transfer bypasses the sorter.');
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

  evidence.push(...chuteEvidence(scenario, refs, question, context, priorQuestions, priorEvidenceIds));
  const floor = evaluateSortFloor(scenario, floorPlan);
  const excluded = floor.excluded;
  const { missingPackages, status: coverageStatus } = floor.coverage;
  const canForecast = coverageStatus !== 'unavailable' && coverageStatus !== 'closed';
  const qualification = coverageStatus === 'partial' ? ' Shortfalls are lower bounds for known freight; verify missing destinations before reallocating resources.' : '';
  const shortfallSummary = canForecast ? `Baseline shortfall ${floor.baseGap}; selected plan shortfall ${floor.gap}.${qualification}`
    : 'Shortfall is unavailable; no capacity clearance or resource decision follows.';
  add('sort-floor', 'Sort floor forecast', `${clock(scenario.nowMinute)} to ${clock(floor.endMinute)} forecast for ${floor.minutes} minutes, ${floor.packages} mapped packages. ${shortfallSummary} Excluded packages: held ${excluded.held}, transfer ${excluded.transfer}, unmapped ${excluded.unmapped}, stale ${excluded.stale}. Resource transfers are what-if forecasts.`);
  if (missingPackages > 0 || !canForecast) {
    add('forecast-coverage', 'Forecast coverage', `Coverage: ${coverageStatus}. Window ${floor.minutes} minutes. ${floor.packages} packages have usable profiles; ${missingPackages} additional packages lack usable destinations (${excluded.stale} stale, ${excluded.unmapped} unmapped). ${coverageStatus === 'closed' ? 'The planning window is closed.' : coverageStatus === 'unavailable' ? 'No eligible freight has a usable profile. Shortfall is unknown. Refresh the synthetic profiles or recover missing destinations before capacity decisions.' : qualification.trim()}`);
  }
  for (const row of floor.zones) {
    const capacity = row.proposed;
    const outlook = canForecast ? `Effective capacity ${capacity.units}, limiting resource ${capacity.limitingResource}, shortfall ${row.gap}. Baseline capacity ${row.baseline.units}, shortfall ${row.baseGap}.${qualification}`
      : `Configured capacity for this window ${capacity.units}. Shortfall and congestion are unknown.`;
    add(`zone-${row.zone}`, refs.zone(row.zone), `Forecast demand ${row.packages} = ${row.onSite} on site + ${row.expected} expected. Selected plan: ${floorPlan.chutes[row.zone]} staffed positions (capacity ${capacity.chuteLimit}), ${floorPlan.crew[row.zone]} crew (capacity ${capacity.crewLimit}). ${outlook} Package sizes: compact ${row.sizes.compact}, standard ${row.sizes.standard}, bulky ${row.sizes.bulky}, unknown size ${row.unknownSize}.`);
  }
  let best: { gap: number; text: string } | undefined;
  for (const resource of (canForecast ? ['chutes', 'crew'] as const : [])) {
    for (const from of ['A', 'B', 'C'] as const) {
      if (floorPlan[resource][from] < 1) continue;
      for (const to of ['A', 'B', 'C'] as const) {
        if (to === from) continue;
        const candidate = evaluateSortFloor(scenario, moveFloorResource(floorPlan, resource, from, to));
        const destination = candidate.zones.find(row => row.zone === to)!;
        const origin = candidate.zones.find(row => row.zone === from)!;
        const unit = resource === 'chutes' ? 'staffed position' : 'crew member';
        const text = `Move one ${unit} from ${refs.zone(from)} to ${refs.zone(to)} in the selected plan: forecast total shortfall changes from ${floor.gap} to ${candidate.gap} packages. ${refs.zone(to)} then has capacity ${destination.proposed.units}, limiting resource ${destination.proposed.limitingResource}, shortfall ${destination.gap}; ${refs.zone(from)} has shortfall ${origin.gap}.`;
        add(`move-${resource}-${from}-${to}`, `${refs.zone(from)} to ${refs.zone(to)} · ${unit}`, text + qualification);
        if (candidate.gap < (best?.gap ?? floor.gap)) best = { gap: candidate.gap, text };
      }
    }
  }
  const transferResult = best ? `${best.text} This is a best single transfer by known shortfall; another move may tie.` : 'No single available staffed position or crew transfer lowers the shortfall calculated for known demand.';
  add('best-transfer', 'Best single transfer', !canForecast ? 'No defensible transfer recommendation: usable demand or an open planning window is missing. Check forecast coverage and refresh profiles.' : transferResult + (missingPackages ? ` ${missingPackages} packages are missing from the forecast. Verify their destinations before reallocating resources.` : ''));

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
