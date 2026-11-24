"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { Scenario, ZoneId } from "../lib/dock-types";
import { getVolumeTargets } from "../lib/volume-plan";
import {
  getBaselineFloorPlan, CHUTE_RATE, CREW_RATE, currentShiftRecord, evaluateSortFloor, moveFloorResource,
} from "../lib/sort-floor";
import type { FloorResource, FloorPlan } from "../lib/sort-floor";
import "./sort-floor.css";

const format = (n: number) => n.toLocaleString("en-US");
const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function SortFloorBoard({ scenario, plan, setPlan, onRefreshProfiles }: {
  scenario: Scenario;
  plan: FloorPlan;
  setPlan: Dispatch<SetStateAction<FloorPlan>>;
  onRefreshProfiles?: () => void;
}) {
  const [resource, setResource] = useState<FloorResource>("chutes");
  const [from, setFrom] = useState<ZoneId>("A");
  const [to, setTo] = useState<ZoneId>("B");
  const baseline = getBaselineFloorPlan(scenario);
  const floor = evaluateSortFloor(scenario, plan);
  const record = currentShiftRecord(scenario);
  const targets = scenario.volumePlan && getVolumeTargets(scenario.volumePlan);
  const changed = scenario.zones.some(({ id }) =>
    plan.chutes[id] !== baseline.chutes[id] || plan.crew[id] !== baseline.crew[id]);
  const canMove = from !== to && plan[resource][from] > 0;
  const { held, transfer, unmapped, stale } = floor.excluded;
  const { status, missingPackages } = floor.coverage;
  const hasForecast = status === "complete" || status === "partial" || status === "empty";
  function displayGap(gap: number) {
    if (status === "partial") return gap ? `≥ ${format(gap)}` : "Unknown";
    return format(gap);
  }
  return <div className="floor-board">
    <section className="panel floor-plan">
      <div className="floor-header">
        <h2>Sort floor capacity</h2>
        {status !== "closed" && <div className="floor-window" aria-label={`Forecast from ${time(scenario.nowMinute)} to ${time(floor.endMinute)}`}>{time(scenario.nowMinute)}–{time(floor.endMinute)}</div>}
      </div>
      {status === "closed" && <p className="floor-coverage" role="status">Forecast window closed for the day.</p>}
      {missingPackages > 0 && <div className="floor-coverage" role="status">
        <span><strong>{status === "partial" ? "Partial forecast" : "Forecast unavailable"}</strong> · {format(missingPackages)} packages have missing or outdated destination profiles.</span>
        {stale > 0 && onRefreshProfiles && <button type="button" className="button" onClick={onRefreshProfiles}>Refresh profiles</button>}
      </div>}
      {hasForecast && <>
      <div className="floor-summary" aria-live="polite" aria-atomic="true">
        <div><span>{status === "partial" ? "Demand with current profiles" : "Forecast from visible loads"}</span><strong>{format(floor.packages)}</strong></div>
        <div><span>Baseline shortfall · packages</span><strong>{displayGap(floor.baseGap)}</strong></div>
        <div className={floor.gap ? "floor-risk" : status === "partial" ? undefined : "floor-clear"}><span>What-if shortfall · packages</span><strong>{displayGap(floor.gap)}</strong></div>
      </div>
      <div className="floor-table-wrap" tabIndex={0} role="region" aria-label="Destination capacity comparison">
        <table className="floor-table">
          <thead><tr><th scope="col">Destination</th><th scope="col">On site</th><th scope="col">Expected</th><th scope="col">Staffed positions</th><th scope="col">Crew</th><th scope="col">Baseline capacity</th><th scope="col">What-if capacity</th><th scope="col">Shortfall</th></tr></thead>
          <tbody>{floor.zones.map(z => <tr key={z.zone}>
            <th scope="row">{z.name}</th><td>{format(z.onSite)}</td><td>{format(z.expected)}</td>
            <td>{plan.chutes[z.zone]}</td><td>{plan.crew[z.zone]}</td>
            <td>{format(z.baseline.units)}</td><td>{format(z.proposed.units)}</td>
            <td><strong className={z.gap ? "floor-warn-text" : ""}>{displayGap(z.gap)}</strong>{z.gap > 0 && <small>{z.proposed.limitingResource} at capacity</small>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <form className="floor-transfer" onSubmit={e => { e.preventDefault(); if (canMove) setPlan(current => moveFloorResource(current, resource, from, to)); }}>
        <label>Reallocate one<select value={resource} onChange={e => setResource(e.target.value as FloorResource)}><option value="chutes">Staffed position</option><option value="crew">Crew member</option></select></label>
        <label>From<select value={from} onChange={e => setFrom(e.target.value as ZoneId)}>{scenario.zones.map(z => <option key={z.id} value={z.id}>{z.name} ({plan[resource][z.id]})</option>)}</select></label>
        <label>To<select value={to} onChange={e => setTo(e.target.value as ZoneId)}>{scenario.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
        <button className="button primary" type="submit" disabled={!canMove}>Preview move</button>
        <button className="button" type="button" disabled={!changed} onClick={() => setPlan(baseline)}>Restore baseline</button>
      </form>
      {!canMove && <p className="floor-action-status" role="status">{from === to ? "Choose two different destinations." : `No ${resource === "chutes" ? "staffed positions" : "crew members"} available in this zone.`}</p>}
      </>}
      {status !== "closed" && <div className="floor-disclosures">
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
          <p>The plan allocates {Object.values(baseline.chutes).reduce((a, b) => a + b, 0)} staffed processing positions and {Object.values(baseline.crew).reduce((a, b) => a + b, 0)} crew members across three zones. Each position handles {CHUTE_RATE} packages per hour and each person can process {CREW_RATE}. The lower of those two zone totals sets its capacity.</p>
        </details>
      </div>}
    </section>
    <section className="panel" aria-label="Shift record">
      <div className="floor-header"><div><h2>Shift record</h2>
        <p>{record ? `Fictional shift totals as of ${time(record.report.atMinute)}.` : `No shift record available as of ${time(scenario.nowMinute)}.`}</p>
      </div>{targets && <span className="floor-window">Full-shift target ≈ {format(Math.round(targets.shiftPackages))}</span>}</div>
      {record && <dl className="floor-record">
        <div><dt>Planned by this time</dt><dd>{format(record.report.plannedPackages)}</dd></div>
        <div><dt>Processed packages</dt><dd>{format(record.report.processedPackages)}</dd></div>
        <div className={record.variance < 0 ? "floor-record-warn" : undefined}><dt>Package variance</dt><dd>{record.variance > 0 ? "+" : ""}{format(record.variance)}</dd></div>
        <div><dt>First-pass yield</dt><dd>{record.yieldPercent === null ? "Unavailable" : `${record.yieldPercent.toFixed(1)}%`}</dd>
          {record.report.firstPass && <small>{format(record.report.firstPass.sorted)} first-pass successes of {format(record.report.firstPass.attempted)} unique packages attempted</small>}
        </div>
      </dl>}
    </section>
    {hasForecast && <section className="panel">
      <div className="floor-header"><h2>Package size by destination</h2><span className="floor-window">{time(scenario.nowMinute)}–{time(floor.endMinute)}</span></div>
      <div className="floor-table-wrap" tabIndex={0} role="region" aria-label="Package size mix">
        <table className="floor-table">
          <thead><tr><th scope="col">Destination</th><th scope="col">Compact</th><th scope="col">Standard</th><th scope="col">Bulky</th><th scope="col">Size unknown</th><th scope="col">Total</th></tr></thead>
          <tbody>{floor.zones.map(z => <tr key={z.zone}><th scope="row">{z.name}</th><td>{format(z.sizes.compact)}</td><td>{format(z.sizes.standard)}</td><td>{format(z.sizes.bulky)}</td><td>{format(z.unknownSize)}</td><td>{format(z.packages)}</td></tr>)}</tbody>
        </table>
      </div>
    </section>}
  </div>;
}
