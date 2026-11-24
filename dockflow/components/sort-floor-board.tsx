"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { Scenario, ZoneId } from "../lib/dock-types";
import {
  BASE_FLOOR_PLAN, CHUTE_RATE, CREW_RATE, currentShiftRecord, evaluateSortFloor, moveFloorResource,
} from "../lib/sort-floor";
import type { FloorResource, FloorPlan } from "../lib/sort-floor";
import "./sort-floor.css";

const format = (n: number) => n.toLocaleString("en-US");
const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function SortFloorBoard({ scenario, plan, setPlan }: { scenario: Scenario; plan: FloorPlan; setPlan: Dispatch<SetStateAction<FloorPlan>> }) {
  const [resource, setResource] = useState<FloorResource>("chutes");
  const [from, setFrom] = useState<ZoneId>("A");
  const [to, setTo] = useState<ZoneId>("B");
  const floor = evaluateSortFloor(scenario, plan);
  const record = currentShiftRecord(scenario);
  const changed = scenario.zones.some(({ id }) =>
    plan.chutes[id] !== BASE_FLOOR_PLAN.chutes[id] || plan.crew[id] !== BASE_FLOOR_PLAN.crew[id]);
  const canMove = from !== to && plan[resource][from] > 0;
  const { held, transfer, unmapped, stale } = floor.excluded;
  return <div className="floor-board">
    <section className="panel floor-plan">
      <div className="floor-header">
        <h2>Sort floor capacity</h2>
        <div className="floor-window" aria-label={`Forecast from ${time(scenario.nowMinute)} to ${time(floor.endMinute)}`}>{time(scenario.nowMinute)}–{time(floor.endMinute)}</div>
      </div>
      <div className="floor-summary" aria-live="polite" aria-atomic="true">
        <div><span>Forecast packages</span><strong>{format(floor.packages)}</strong></div>
        <div><span>Baseline shortfall · packages</span><strong>{format(floor.baseGap)}</strong></div>
        <div className={floor.gap ? "floor-risk" : "floor-clear"}><span>What-if shortfall · packages</span><strong>{format(floor.gap)}</strong></div>
      </div>
      <div className="floor-table-wrap" tabIndex={0} role="region" aria-label="Destination capacity comparison">
        <table className="floor-table">
          <thead><tr><th scope="col">Destination</th><th scope="col">On site</th><th scope="col">Expected</th><th scope="col">Chutes</th><th scope="col">People</th><th scope="col">Baseline capacity</th><th scope="col">What-if capacity</th><th scope="col">Shortfall</th></tr></thead>
          <tbody>{floor.zones.map(z => <tr key={z.zone}>
            <th scope="row">{z.name}</th><td>{format(z.onSite)}</td><td>{format(z.expected)}</td>
            <td>{plan.chutes[z.zone]}</td><td>{plan.crew[z.zone]}</td>
            <td>{format(z.baseline.units)}</td><td>{format(z.proposed.units)}</td>
            <td><strong className={z.gap ? "floor-warn-text" : ""}>{format(z.gap)}</strong>{z.gap > 0 && <small>{z.proposed.limitingResource} at capacity</small>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <form className="floor-transfer" onSubmit={e => { e.preventDefault(); if (canMove) setPlan(current => moveFloorResource(current, resource, from, to)); }}>
        <label>Move one<select value={resource} onChange={e => setResource(e.target.value as FloorResource)}><option value="chutes">Chute</option><option value="crew">Crew member</option></select></label>
        <label>From<select value={from} onChange={e => setFrom(e.target.value as ZoneId)}>{scenario.zones.map(z => <option key={z.id} value={z.id}>{z.name} ({plan[resource][z.id]})</option>)}</select></label>
        <label>To<select value={to} onChange={e => setTo(e.target.value as ZoneId)}>{scenario.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
        <button className="button primary" type="submit" disabled={!canMove}>Preview move</button>
        <button className="button" type="button" disabled={!changed} onClick={() => setPlan(BASE_FLOOR_PLAN)}>Restore baseline</button>
      </form>
      {!canMove && <p className="floor-action-status" role="status">{from === to ? "Choose two different destinations." : `No ${resource === "chutes" ? "chutes" : "crew members"} available to move from this zone.`}</p>}
      <div className="floor-disclosures">
        <details>
          <summary>Forecast exclusions · {format(held + transfer + unmapped + stale)} packages</summary>
          <dl className="floor-exclusions">
            <div><dt>Held</dt><dd>{format(held)}</dd></div>
            <div><dt>Transfer</dt><dd>{format(transfer)}</dd></div>
            <div><dt>Missing destination</dt><dd>{format(unmapped)}</dd></div>
            <div><dt>Outdated profile</dt><dd>{format(stale)}</dd></div>
          </dl>
        </details>
        <details>
          <summary>Capacity assumptions</summary>
          <p>Demand includes on-site packages and arrivals expected by {time(floor.endMinute)}. Each zone can process up to {CHUTE_RATE} packages per chute and {CREW_RATE} per person per hour, whichever limit is reached first. Both rates are fictional.</p>
        </details>
      </div>
    </section>
    <section className="panel" aria-label="Shift record">
      <div className="floor-header"><div><h2>Shift record</h2>
        <p>{record ? `Fictional shift totals as of ${time(record.report.atMinute)}.` : `No shift record available as of ${time(scenario.nowMinute)}.`}</p>
      </div></div>
      {record && <dl className="floor-record">
        <div><dt>Planned packages</dt><dd>{format(record.report.plannedPackages)}</dd></div>
        <div><dt>Processed packages</dt><dd>{format(record.report.processedPackages)}</dd></div>
        <div className={record.variance < 0 ? "floor-record-warn" : undefined}><dt>Package variance</dt><dd>{record.variance > 0 ? "+" : ""}{format(record.variance)}</dd></div>
        <div><dt>First-pass yield</dt><dd>{record.yieldPercent === null ? "Unavailable" : `${record.yieldPercent.toFixed(1)}%`}</dd>
          {record.report.firstPass && <small>{format(record.report.firstPass.sorted)} first-pass successes of {format(record.report.firstPass.attempted)} unique packages attempted</small>}
        </div>
      </dl>}
    </section>
    <section className="panel">
      <div className="floor-header"><h2>Package size by destination</h2><span className="floor-window">{time(scenario.nowMinute)}–{time(floor.endMinute)}</span></div>
      <div className="floor-table-wrap" tabIndex={0} role="region" aria-label="Package size mix">
        <table className="floor-table">
          <thead><tr><th scope="col">Destination</th><th scope="col">Compact</th><th scope="col">Standard</th><th scope="col">Bulky</th><th scope="col">Size unknown</th><th scope="col">Total</th></tr></thead>
          <tbody>{floor.zones.map(z => <tr key={z.zone}><th scope="row">{z.name}</th><td>{format(z.sizes.compact)}</td><td>{format(z.sizes.standard)}</td><td>{format(z.sizes.bulky)}</td><td>{format(z.unknownSize)}</td><td>{format(z.packages)}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  </div>;
}
