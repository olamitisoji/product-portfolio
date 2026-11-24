import type { VolumePlan } from './dock-types.ts';

// The weekly volume describes the facility. The calendar is a modeling assumption.
export const DEFAULT_VOLUME_PLAN: Readonly<VolumePlan> = Object.freeze({
  weeklyPackages: 600_000, operatingDaysPerWeek: 7, shiftsPerDay: 2,
  shiftHours: 12, shiftStartMinute: 360,
});

export function getVolumeTargets(plan: VolumePlan) {
  const weeklyShifts = plan.operatingDaysPerWeek * plan.shiftsPerDay;
  return {
    dailyPackages: plan.weeklyPackages / plan.operatingDaysPerWeek,
    shiftPackages: plan.weeklyPackages / weeklyShifts,
    hourlyPackages: plan.weeklyPackages / (weeklyShifts * plan.shiftHours),
  };
}
