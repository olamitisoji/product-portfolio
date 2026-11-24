import type { Scenario, TrailerStatus, ZoneId } from './dock-types.ts';

// Physical destinations in the fictional facility, independent of staffed processing resources.
export const CHUTES_PER_ZONE = 200;
export const chuteId = (zone: ZoneId, number: number) => zone + String(number).padStart(3, '0');

export function chuteZone(id: string): ZoneId | undefined {
  if (!/^[ABC][0-9]{3}$/.test(id)) return undefined;
  const position = Number(id.slice(1));
  return position >= 1 && position <= CHUTES_PER_ZONE ? id[0] as ZoneId : undefined;
}

interface ChuteSource { trailerId: string; status: TrailerStatus; packages: number }
export interface ChuteCell {
  id: string;
  zoneId: ZoneId;
  packages: number;
  sharePercent: number;
  sources: ChuteSource[];
}
export interface ChuteZone {
  id: ZoneId;
  name: string;
  routedPackages: number;
  unmappedPackages: number;
  chutes: ChuteCell[];
}
interface ChuteFilter { trailerId?: string; statuses?: readonly TrailerStatus[] }

export function buildChuteMap(scenario: Scenario, { trailerId, statuses }: ChuteFilter = {}) {
  const zones: ChuteZone[] = scenario.zones.map(({ id, name }) => ({
    id, name, routedPackages: 0, unmappedPackages: 0,
    chutes: Array.from({ length: CHUTES_PER_ZONE }, (_, index) => ({
      id: chuteId(id, index + 1), zoneId: id, packages: 0, sources: [], sharePercent: 0,
    })),
  }));
  const byChute = new Map(zones.flatMap(zone => zone.chutes.map(chute => [chute.id, chute] as const)));
  const byZone = new Map(zones.map(zone => [zone.id, zone]));
  let totalPackages = 0;
  let routedPackages = 0;
  let bypassedPackages = 0;
  let trailerCount = 0;
  for (const trailer of scenario.trailers) {
    if (trailerId !== undefined && trailer.id !== trailerId) continue;
    if (statuses ? !statuses.includes(trailer.status) : trailerId === undefined && trailer.status === 'complete') continue;
    trailerCount++;
    totalPackages += trailer.packageCount;
    if (trailer.handling === 'crossdock') {
      bypassedPackages += trailer.packageCount;
      continue;
    }
    if (!trailer.profileKnown) continue;
    if (!trailer.chuteRoutes) {
      for (const zone of zones) zone.unmappedPackages += trailer.zoneUnits[zone.id];
      continue;
    }
    for (const [id, packages] of Object.entries(trailer.chuteRoutes)) {
      if (packages === 0) continue;
      const chute = byChute.get(id)!;
      chute.sources.push({ trailerId: trailer.id, status: trailer.status, packages });
      chute.packages += packages;
      byZone.get(chute.zoneId)!.routedPackages += packages;
      routedPackages += packages;
    }
  }
  const sorterPackages = totalPackages - bypassedPackages;
  for (const chute of byChute.values()) {
    chute.sharePercent = sorterPackages ? chute.packages / sorterPackages * 100 : 0;
    chute.sources.sort((a, b) => b.packages - a.packages || a.trailerId.localeCompare(b.trailerId));
  }
  return { zones, totalPackages, sorterPackages, routedPackages, bypassedPackages, unmappedPackages: sorterPackages - routedPackages, trailerCount };
}
