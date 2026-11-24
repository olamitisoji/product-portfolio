import type { PackageSize, Scenario, ShiftReport, ZoneId } from './dock-types.ts';

type ZoneCounts = Record<ZoneId, number>;
// The existing floor-plan field "chutes" counts staffed processing positions.
export type FloorResource = 'chutes' | 'crew';
export type FloorPlan = Record<FloorResource, ZoneCounts>;
type ForecastStatus = 'complete' | 'partial' | 'unavailable' | 'empty' | 'closed';

// Invented resource pools and rates for a one-hour planning exercise.
export const BASE_FLOOR_PLAN: FloorPlan = {
  chutes: { A: 4, B: 3, C: 3 },
  crew: { A: 3, B: 3, C: 3 },
};
// A larger fictional floor supports the 600,000-package weekly facility plan.
const FACILITY_FLOOR_PLAN: FloorPlan = {
  chutes: { A: 9, B: 9, C: 7 },
  crew: { A: 7, B: 8, C: 7 },
};

export function getBaselineFloorPlan(scenario: Scenario): FloorPlan {
  return scenario.volumePlan ? FACILITY_FLOOR_PLAN : BASE_FLOOR_PLAN;
}

export const CHUTE_RATE = 180;
export const CREW_RATE = 210;
const freshForMinutes = 60;

export function moveFloorResource(plan: FloorPlan, resource: FloorResource, from: ZoneId, to: ZoneId): FloorPlan {
  if (from === to || plan[resource][from] < 1) return plan;
  return {
    ...plan,
    [resource]: { ...plan[resource], [from]: plan[resource][from] - 1, [to]: plan[resource][to] + 1 },
  };
}

function floorCapacity(plan: FloorPlan, zone: ZoneId, minutes: number) {
  const chuteLimit = Math.floor(plan.chutes[zone] * CHUTE_RATE * minutes / 60);
  const crewLimit = Math.floor(plan.crew[zone] * CREW_RATE * minutes / 60);
  const limitingResource = chuteLimit === crewLimit ? 'Staffed positions and crew' : chuteLimit < crewLimit ? 'Staffed positions' : 'Crew';
  return { units: Math.min(chuteLimit, crewLimit), chuteLimit, crewLimit, limitingResource };
}

export function currentShiftRecord(scenario: Scenario) {
  let latest: ShiftReport | undefined;
  for (const report of scenario.shiftReports ?? []) {
    if (report.atMinute <= scenario.nowMinute && (!latest || report.atMinute > latest.atMinute)) latest = report;
  }
  if (!latest) return null;
  return {
    report: latest,
    variance: latest.processedPackages - latest.plannedPackages,
    yieldPercent: latest.firstPass && latest.firstPass.attempted > 0
      ? 100 * latest.firstPass.sorted / latest.firstPass.attempted : null,
  };
}

export function evaluateSortFloor(scenario: Scenario, plan: FloorPlan = getBaselineFloorPlan(scenario)) {
  const baselinePlan = getBaselineFloorPlan(scenario);
  const endMinute = Math.min(1440, scenario.nowMinute + 60);
  const minutes = endMinute - scenario.nowMinute;
  const excluded = { held: 0, transfer: 0, unmapped: 0, stale: 0 };
  const demand = scenario.zones.map(zone => ({
    zone: zone.id, name: zone.name,
    onSite: 0, expected: 0,
    sizes: { compact: 0, standard: 0, bulky: 0 } as Record<PackageSize, number>,
    unknownSize: 0,
  }));
  for (const trailer of minutes > 0 ? scenario.trailers : []) {
    if (trailer.status === 'complete') continue;
    if (trailer.status === 'expected' && trailer.arrivalMinute > endMinute) continue;
    if (trailer.handling === 'crossdock') { excluded.transfer += trailer.packageCount; continue; }
    if (trailer.hold) { excluded.held += trailer.packageCount; continue; }
    if (!trailer.profileKnown) { excluded.unmapped += trailer.packageCount; continue; }
    if (trailer.profileUpdatedMinute === null || scenario.nowMinute - trailer.profileUpdatedMinute > freshForMinutes) {
      excluded.stale += trailer.packageCount;
      continue;
    }
    for (const row of demand) {
      const units = trailer.zoneUnits[row.zone];
      if (trailer.status === 'expected') row.expected += units;
      else row.onSite += units;
      const counts = trailer.packageMix?.[row.zone];
      if (counts) {
        row.sizes.compact += counts.compact;
        row.sizes.standard += counts.standard;
        row.sizes.bulky += counts.bulky;
      } else row.unknownSize += units;
    }
  }
  const zones = demand.map(row => {
    const packages = row.onSite + row.expected;
    const baseline = floorCapacity(baselinePlan, row.zone, minutes);
    const proposed = floorCapacity(plan, row.zone, minutes);
    return {
      ...row, packages, baseline, proposed,
      baseGap: Math.max(0, packages - baseline.units),
      gap: Math.max(0, packages - proposed.units),
    };
  });
  const packages = zones.reduce((sum, z) => sum + z.packages, 0);
  const missingPackages = excluded.stale + excluded.unmapped;
  let status: ForecastStatus;
  if (minutes === 0) status = 'closed';
  else if (missingPackages > 0) status = packages > 0 ? 'partial' : 'unavailable';
  else status = packages > 0 ? 'complete' : 'empty';
  return {
    zones, excluded, endMinute, minutes, packages,
    coverage: { status, missingPackages },
    baseGap: zones.reduce((sum, z) => sum + z.baseGap, 0),
    gap: zones.reduce((sum, z) => sum + z.gap, 0),
  };
}
