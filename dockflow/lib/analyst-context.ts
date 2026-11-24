import { chuteZone } from './chute-routing.ts';
import type { Scenario, TrailerStatus, ZoneId } from './dock-types.ts';

export interface AnalystChuteContext {
  trailerId?: string;
  statuses?: TrailerStatus[];
  zoneId?: ZoneId;
  chuteId?: string;
}

export interface AnalystContext {
  view: 'overview' | 'priorities' | 'floor' | 'queue' | 'doors' | 'assumptions';
  selectedTrailerId?: string;
  pickupStage?: TrailerStatus;
  queue?: { status?: TrailerStatus | 'high'; trailerIds: string[] };
  chute?: AnalystChuteContext;
}

export const MAX_PRIOR_QUESTIONS = 3;
export const MAX_PRIOR_EVIDENCE_IDS = 12;

function fields(value: unknown, allowed: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => allowed.includes(key));
}

export function validAnalystContext(value: unknown, scenario: Scenario): value is AnalystContext {
  if (!fields(value, ['view', 'selectedTrailerId', 'chute', 'queue', 'pickupStage'])
    || !['overview', 'priorities', 'floor', 'queue', 'doors', 'assumptions'].some(view => value.view === view)) return false;
  const knownTrailer = (id: unknown) => id === undefined || scenario.trailers.some(trailer => trailer.id === id);
  if (!knownTrailer(value.selectedTrailerId)) return false;
  const statuses: readonly TrailerStatus[] = ['at_door', 'expected', 'yard', 'complete'];
  if (value.pickupStage !== undefined && !statuses.some(status => status === value.pickupStage)) return false;
  if (value.queue !== undefined) {
    const queue = value.queue;
    if (!fields(queue, ['status','trailerIds']) || !Array.isArray(queue.trailerIds) || queue.trailerIds.length > 12
      || new Set(queue.trailerIds).size !== queue.trailerIds.length || !queue.trailerIds.every(id => typeof id === 'string' && knownTrailer(id))
      || (queue.status !== undefined && queue.status !== 'high' && !statuses.some(status => status === queue.status))) return false;
  }
  const map = value.chute;
  if (map === undefined) return true;
  if (!fields(map, ['trailerId', 'statuses', 'zoneId', 'chuteId']) || !knownTrailer(map.trailerId)) return false;
  if (map.zoneId !== undefined && !scenario.zones.some(zone => zone.id === map.zoneId)) return false;
  if (map.chuteId !== undefined) {
    const zone = typeof map.chuteId === 'string' && chuteZone(map.chuteId);
    if (!zone || (map.zoneId !== undefined && map.zoneId !== zone)) return false;
  }
  if (map.statuses === undefined) return true;
  return map.trailerId === undefined && Array.isArray(map.statuses) && map.statuses.length <= statuses.length
    && new Set(map.statuses).size === map.statuses.length && map.statuses.every(item => statuses.some(status => status === item));
}
