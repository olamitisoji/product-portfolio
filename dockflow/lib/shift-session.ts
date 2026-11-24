import { parseScenario } from './dock-engine.ts';
import { getBaselineFloorPlan, type FloorPlan } from './sort-floor.ts';
import { isFloorPlan } from './floor-plan-validation.ts';
import type { AuditEvent, PlanMode, Scenario } from './dock-types.ts';

export const SHIFT_KEY = 'dockflow.synthetic.v1';
export type ShiftSession = { scenario: Scenario; audit: AuditEvent[]; mode: PlanMode; floorPlan: FloorPlan };

export function freshSession(scenario: Scenario): ShiftSession {
  return { scenario, audit: [], mode: 'priority', floorPlan: getBaselineFloorPlan(scenario) };
}

export function serializeSession(session: ShiftSession): string {
  return JSON.stringify({ sessionVersion: 2, ...session });
}

// Files and browser storage are untrusted inputs: validate before using them.
export function readSession(value: unknown): ShiftSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a synthetic Sortward JSON snapshot.");
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, "sessionVersion") && record.sessionVersion !== 2) throw new Error("Unsupported shift snapshot version.");
  if (record.sessionVersion === 2 && (!Object.hasOwn(record, "floorPlan") || !Object.hasOwn(record, "mode"))) {
    throw new Error("The shift snapshot is missing its planning settings.");
  }
  const parsed = parseScenario(Object.hasOwn(record, "scenario") ? record.scenario : record);
  if (!parsed.ok) throw new Error(parsed.errors.slice(0, 3).join(" "));
  const sourceAudit = Object.hasOwn(record, "audit") ? record.audit : [];
  if (!Array.isArray(sourceAudit) || sourceAudit.length > 1000) throw new Error("Snapshot audit must contain at most 1,000 events.");
  const audit: AuditEvent[] = sourceAudit.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid audit event.");
    const event = raw as Record<string, unknown>;
    const fields = ["action", "trailerId", "doorId", "atMinute", "reason"];
    if (!fields.every((key) => Object.hasOwn(event, key)) || !["assign", "complete"].includes(event.action as string)
      || typeof event.trailerId !== "string" || !parsed.scenario.trailers.some((trailer) => trailer.id === event.trailerId)
      || typeof event.doorId !== "string" || !parsed.scenario.doors.some((door) => door.id === event.doorId)
      || !Number.isInteger(event.atMinute) || (event.atMinute as number) < 0 || (event.atMinute as number) > parsed.scenario.nowMinute
      || typeof event.reason !== "string" || event.reason.length > 500) throw new Error("Snapshot has an invalid audit event.");
    return { action: event.action as AuditEvent["action"], trailerId: event.trailerId, doorId: event.doorId, atMinute: event.atMinute as number, reason: event.reason };
  });
  const baseline = getBaselineFloorPlan(parsed.scenario);
  const mode = Object.hasOwn(record, "mode") ? record.mode : "priority";
  if (mode !== "priority" && mode !== "arrival") throw new Error("Invalid planning order.");
  const floorPlan = Object.hasOwn(record, "floorPlan") ? record.floorPlan : baseline;
  if (!isFloorPlan(floorPlan, baseline)) throw new Error("Floor allocation must preserve the available positions and crew.");
  return { scenario: parsed.scenario, audit, mode, floorPlan };
}

export type SaveIssue = 'conflict' | 'unreadable' | 'unavailable';
type SnapshotStorage = Pick<Storage, 'getItem' | 'setItem'>;
type Exclusive = (write: () => void) => Promise<void>;

// Compare and write in one same-origin lock. Only the isolated example uses a tab-local store.
export class ShiftStore {
  private expected: string | null = null;
  private initialSnapshot: string | null = null;
  private loaded = false;
  private corrupt = false;

  private storage: SnapshotStorage;
  private exclusive: Exclusive;

  constructor(storage: SnapshotStorage, exclusive: Exclusive) {
    this.storage = storage;
    this.exclusive = exclusive;
  }

  read(initial?: ShiftSession): ShiftSession | null {
    this.expected = this.storage.getItem(SHIFT_KEY);
    this.initialSnapshot = this.expected === null && initial ? serializeSession(initial) : null;
    this.loaded = true;
    this.corrupt = false;
    if (this.expected === null) return null;
    try {
      if (this.expected.length > 2_000_000) throw new Error('Oversize shift');
      return readSession(JSON.parse(this.expected));
    } catch {
      this.corrupt = true;
      throw new Error('Unreadable shift');
    }
  }

  get unreadableData() {
    return this.corrupt ? this.expected : null;
  }

  newerSaveExists() {
    if (!this.loaded) return false;
    const current = this.storage.getItem(SHIFT_KEY);
    if (this.initialSnapshot !== null && current === this.initialSnapshot) return false;
    return current !== this.expected;
  }

  async save(session: ShiftSession, recover = false): Promise<SaveIssue | null> {
    if (!this.loaded) return 'unavailable';
    if (this.corrupt && !recover) return 'unreadable';
    const next = serializeSession(session);
    let conflict = false;
    try {
      await this.exclusive(() => {
        const current = this.storage.getItem(SHIFT_KEY);
        const commonInitial = this.initialSnapshot !== null && current === this.initialSnapshot;
        if (current !== this.expected && current !== next && !commonInitial) {
          conflict = true;
          return;
        }
        // Keep the original bytes recoverable even if the new write fails.
        if (this.corrupt && this.expected !== null) {
          this.storage.setItem(SHIFT_KEY + '.recovered.' + crypto.randomUUID(), this.expected);
        }
        if (next !== current) this.storage.setItem(SHIFT_KEY, next);
        this.expected = next;
        this.initialSnapshot = null;
        this.corrupt = false;
      });
      return conflict ? 'conflict' : null;
    } catch {
      return 'unavailable';
    }
  }
}

export function browserShiftStore(): { store: ShiftStore; storage: Storage } {
  const example = new URLSearchParams(window.location.search).get('example') === 'chutes';
  const storage = example ? window.sessionStorage : window.localStorage;
  const exclusive: Exclusive = example
    ? async write => { write(); }
    : async write => {
      // Fail visibly if this browser cannot guarantee atomic saves across its tabs.
      if (!navigator.locks) throw new Error('Shared storage lock unavailable');
      await navigator.locks.request(SHIFT_KEY, write);
    };
  return { store: new ShiftStore(storage, exclusive), storage };
}
