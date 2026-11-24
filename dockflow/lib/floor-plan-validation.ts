import type { FloorPlan } from './sort-floor.ts';

const zones = ['A', 'B', 'C'] as const;
const resources = ['chutes', 'crew'] as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFloorPlan(value: unknown, baseline: FloorPlan): value is FloorPlan {
  if (!object(value) || Object.keys(value).length !== resources.length) return false;
  for (const resource of resources) {
    const counts = value[resource];
    if (!object(counts) || Object.keys(counts).length !== zones.length) return false;
    const pool = zones.reduce((sum, zone) => sum + baseline[resource][zone], 0);
    let allocated = 0;
    for (const zone of zones) {
      const count = counts[zone];
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > pool) return false;
      allocated += count;
    }
    if (allocated !== pool) return false;
  }
  return true;
}
