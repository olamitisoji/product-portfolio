import type { Scenario, Trailer } from './dock-types.ts';

export type PickupWindow = 'current' | 'next';
export type ActiveStage = Exclude<Trailer['status'], 'complete'>;
type WindowPhase = 'open' | 'final' | 'overdue';

// An independent policy for this fictional shift. A cutoff is open through its displayed minute.
export const FINAL_SWEEP_MINUTES = 45;

export interface PickupLoad {
  trailer: Trailer;
  stage: ActiveStage;
  due: number;
  arrivesAtOrAfterCutoff: boolean;
}

export function planPickupWindow(scenario: Scenario, window: PickupWindow) {
  const deadline = window === 'current' ? scenario.currentDeadlineMinute : scenario.nextDeadlineMinute;
  const minutesLeft = deadline - scenario.nowMinute;
  const phase: WindowPhase = minutesLeft < 0 ? 'overdue' : minutesLeft <= FINAL_SWEEP_MINUTES ? 'final' : 'open';
  const rows: PickupLoad[] = [];
  const stageDue: Record<ActiveStage, number> = { yard: 0, at_door: 0, expected: 0 };
  let due = 0;
  let loadVolume = 0;
  for (const trailer of scenario.trailers) {
    const units = window === 'current' ? trailer.currentUnits : trailer.nextUnits;
    if (trailer.status === 'complete' || units === 0) continue;
    rows.push({
      trailer,
      stage: trailer.status,
      due: units,
      arrivesAtOrAfterCutoff: trailer.status === 'expected' && trailer.arrivalMinute >= deadline,
    });
    stageDue[trailer.status] += units;
    due += units;
    loadVolume += trailer.packageCount;
  }

  rows.sort((a, b) => {
    // Unarrived freight is still part of the backlog, but cannot be worked ahead of on-site freight.
    const readiness = Number(a.stage === 'expected') - Number(b.stage === 'expected');
    const arrivalOrder = a.trailer.arrivalMinute - b.trailer.arrivalMinute;
    const idOrder = a.trailer.id < b.trailer.id ? -1 : a.trailer.id > b.trailer.id ? 1 : 0;
    if (readiness) return readiness;
    if (a.stage === 'expected') return arrivalOrder || b.due - a.due || idOrder;
    if (phase === 'overdue' && arrivalOrder) return arrivalOrder;
    if (phase === 'final') {
      const shareOrder = b.due * a.trailer.packageCount - a.due * b.trailer.packageCount;
      if (shareOrder) return shareOrder;
    }
    return b.due - a.due || arrivalOrder || idOrder;
  });

  return { deadline, minutesLeft, phase, rows, due, loadVolume, stageDue };
}
