import { DEFAULT_VOLUME_PLAN, getVolumeTargets } from './volume-plan.ts';
import type { Handling, Preset, Scenario, ShiftReport, Trailer, ZoneId } from './dock-types.ts';

// Every name, location, count and policy in these presets is fictional.
export function createScenario(preset: Preset = 'balanced', seed: number = 42): Scenario {
  if (!['balanced', 'surge', 'disruption'].includes(preset)) throw new Error('Unknown synthetic preset.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error('Seed must be a whole number from 0 to 4294967295.');
  let randomState = seed >>> 0;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x1_0000_0000;
  };
  const surge = preset === 'surge';
  const disruption = preset === 'disruption';
  const volume = (base: number) => Math.round(base * (surge ? 1.55 : 1) * (0.9 + random() * 0.2));
  const mix = (packages: number, dominant: ZoneId): Record<ZoneId, number> => {
    const zones: ZoneId[] = ['A', 'B', 'C'];
    const index = zones.indexOf(dominant);
    const counts = [0, 0, 0];
    counts[index] = Math.round(packages * 0.68);
    counts[(index + 1) % 3] = Math.round(packages * 0.22);
    counts[(index + 2) % 3] = packages - counts[index] - counts[(index + 1) % 3];
    return { A: counts[0], B: counts[1], C: counts[2] };
  };
  const load = (id: string, carrier: string, base: number, dominant: ZoneId, handling: Handling, currentFraction: number, overrides: Partial<Trailer> = {}): Trailer => {
    const packageCount = volume(base);
    const currentUnits = Math.floor(packageCount * currentFraction);
    return {
      id, carrier, status: 'yard', arrivalMinute: 390 + Math.floor(random() * 180), handling,
      packageCount, currentUnits, nextUnits: Math.floor((packageCount - currentUnits) * 0.6),
      zoneUnits: mix(packageCount, dominant), profileKnown: true, profileUpdatedMinute: 580 + Math.floor(random() * 21),
      hold: false, currentDoorId: null, plannedDoorId: null, ...overrides,
    };
  };
  // These manifests cover the active dock board at one point in the shift.
  const trailers = [
    load('TR-101', 'Juniper Freight', 400, 'A', 'palletized', 0, { status: 'at_door', currentDoorId: 'A-01', hold: true, nextUnits: 0, arrivalMinute: 360 }),
    load('TR-102', 'Morrow Logistics', 550, 'B', 'cart', 0, { status: 'at_door', currentDoorId: 'B-01', arrivalMinute: 410 }),
    load('TR-103', 'Copperline Cargo', 900, 'A', 'palletized', 0.8, { plannedDoorId: 'A-01' }),
    load('TR-104', 'Cedar Road Transport', 725, 'B', 'cart', 0.75, { plannedDoorId: 'B-02' }),
    load('TR-105', 'Northstar Parcel Co.', 450, 'C', 'loose', 0, { plannedDoorId: 'C-01' }),
    load('TR-106', 'Bluebird Transfer', 600, 'B', 'crossdock', 0.65, { plannedDoorId: 'X-01' }),
    load('TR-107', 'Willow Route', 312, 'A', 'cart', 0.35, { profileKnown: false, profileUpdatedMinute: null, zoneUnits: { A: 0, B: 0, C: 0 } }),
    load('TR-108', 'Silverfern Freight', 525, 'C', 'palletized', 0.55, { profileUpdatedMinute: 505, plannedDoorId: 'C-02' }),
    load('TR-109', 'Orchard Transit', 700, 'B', 'palletized', 0.7, { status: 'expected', arrivalMinute: 625 + Math.floor(random() * 16) }),
    load('TR-110', 'Ember Lane', 225, 'A', 'loose', 0, { hold: true, plannedDoorId: 'A-02' }),
    load('TR-111', 'Linden Distribution', 500, 'A', 'palletized', surge ? 0.7 : 0),
    load('TR-112', 'Saffron Haulage', 375, 'C', 'loose', 0, { status: 'complete', nextUnits: 0, arrivalMinute: 300 }),
  ];
  // A tied A/B profile demonstrates pressure-based ranking without a fabricated winner.
  const tied = trailers[10];
  const half = Math.floor(tied.packageCount / 2);
  tied.zoneUnits = { A: half, B: half, C: tied.packageCount - 2 * half };
  // Fictional manifest counts reconcile to each destination, including mixed loads.
  for (const trailer of trailers) {
    if (!trailer.profileKnown) continue;
    const split = (units: number) => {
      const compact = Math.floor(units * (0.15 + random() * 0.5));
      const standard = Math.floor((units - compact) * (0.35 + random() * 0.5));
      return { compact, standard, bulky: units - compact - standard };
    };
    trailer.packageMix = {
      A: split(trailer.zoneUnits.A),
      B: split(trailer.zoneUnits.B),
      C: split(trailer.zoneUnits.C),
    };
  }
  if (disruption) {
    trailers[1].handling = 'loose'; // Known mismatch remains physically at B-01.
    trailers[4].hold = true;
    trailers[10].plannedDoorId = 'C-01'; // Advisory plan has the wrong destination.
  }
  const volumePlan = { ...DEFAULT_VOLUME_PLAN };
  const { hourlyPackages } = getVolumeTargets(volumePlan);
  const shiftReports: ShiftReport[] = [];
  let processedPackages = 0;
  let attempted = 0;
  let sorted = 0;
  // Generate interval counts once. The shift clock reveals them as observations without
  // recomputing them from the current queue, a door assignment or a proposed floor layout.
  for (let elapsed = 0; elapsed <= volumePlan.shiftHours * 60; elapsed += 30) {
    if (elapsed > 0) {
      const pace = disruption ? 0.78 : surge ? 1.12 : 1.01;
      const intervalProcessed = Math.round(hourlyPackages / 2 * pace * (0.92 + 0.16 * random()));
      const intervalAttempts = intervalProcessed + Math.round(intervalProcessed * (0.015 + 0.02 * random()));
      const firstPassRate = (disruption ? 0.74 : 0.87) + 0.03 * random();
      processedPackages += intervalProcessed;
      attempted += intervalAttempts;
      sorted += Math.round(intervalAttempts * firstPassRate);
    }
    shiftReports.push({
      atMinute: volumePlan.shiftStartMinute + elapsed,
      plannedPackages: Math.round(hourlyPackages * elapsed / 60),
      processedPackages,
      firstPass: { attempted, sorted },
    });
  }
  return {
    version: 1, synthetic: true, seed, volumePlan, shiftReports,
    name: 'Northbank Inbound · Fictional Hub', nowMinute: 600, currentDeadlineMinute: 720, nextDeadlineMinute: 960,
    zones: [
      { id: 'A', name: 'North loop', capacityUnits: surge ? 1750 : 2250 },
      { id: 'B', name: 'Central loop', capacityUnits: surge ? 1900 : 2500 },
      { id: 'C', name: 'South loop', capacityUnits: surge ? 1500 : 2000 },
    ],
    doors: [
      { id: 'A-01', zoneId: 'A', allowedHandling: ['palletized', 'cart'], enabled: true },
      { id: 'A-02', zoneId: 'A', allowedHandling: ['palletized', 'loose'], enabled: !disruption },
      { id: 'B-01', zoneId: 'B', allowedHandling: ['palletized', 'cart'], enabled: true },
      { id: 'B-02', zoneId: 'B', allowedHandling: ['palletized', 'cart'], enabled: true },
      { id: 'C-01', zoneId: 'C', allowedHandling: ['palletized', 'loose'], enabled: true },
      { id: 'C-02', zoneId: 'C', allowedHandling: ['palletized', 'loose'], enabled: true },
      { id: 'X-01', zoneId: null, allowedHandling: ['crossdock'], enabled: true },
    ],
    trailers,
  };
}
