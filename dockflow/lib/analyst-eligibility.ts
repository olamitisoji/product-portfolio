import { createScenario } from './dock-fixtures.ts';
import type { Scenario } from './dock-types.ts';

// Balanced, surge and disruption share fictional identities across seeds. Their operating data can change.
const sample = createScenario();
const sampleCarriers = new Map(sample.trailers.map(t => [t.id, t.carrier]));
const sampleDoors = new Set(sample.doors.map(d => d.id));
const sampleZones = new Map(sample.zones.map(z => [z.id, z.name]));

export function usesSampleIdentities(scenario: Scenario) {
  return scenario.name === sample.name &&
    scenario.zones.every(z => sampleZones.get(z.id) === z.name) &&
    scenario.doors.every(d => sampleDoors.has(d.id)) &&
    scenario.trailers.every(t => sampleCarriers.get(t.id) === t.carrier);
}
