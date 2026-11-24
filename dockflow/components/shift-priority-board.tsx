"use client";

import { useMemo, useState } from "react";
import type { Evaluation, Scenario } from "@/lib/dock-types";
import {
  planPickupWindow, type ActiveStage, type PickupLoad, type PickupWindow,
} from "@/lib/shift-priorities";
import "./shift-priority-board.css";

const count = new Intl.NumberFormat("en-US");
const formatTime = (minutes: number) =>
  `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
const stageName: Record<ActiveStage, string> = { yard: "In yard", at_door: "At a door", expected: "Expected" };

type BoardProps = {
  window: PickupWindow;
  setWindow: (window: PickupWindow) => void;
  scenario: Scenario;
  evaluation: Evaluation;
  onInspect: (id: string) => void;
};

function stageDetail(row: PickupLoad, now: number) {
  if (row.stage === "expected") return `ETA ${formatTime(row.trailer.arrivalMinute)}`;
  const elapsed = now - row.trailer.arrivalMinute;
  return elapsed >= 0 ? `Arrived ${elapsed} min ago` : `Check arrival ${formatTime(row.trailer.arrivalMinute)}`;
}

export function ShiftPriorityBoard({ scenario, evaluation, onInspect, window, setWindow }: BoardProps) {
  const [stage, setStage] = useState<ActiveStage | "all">("all");
  const plan = useMemo(() => planPickupWindow(scenario, window), [scenario, window]);
  const byTrailer = useMemo(
    () => new Map(evaluation.recommendations.map((rec) => [rec.trailerId, rec])),
    [evaluation.recommendations],
  );
  const visible = plan.rows.filter((row) => stage === "all" || row.stage === stage);
  const sortBasis = {
    open: "Most packages due",
    final: "Highest share due",
    overdue: "Oldest on-site arrival",
  }[plan.phase];
  function nextDecision(row: PickupLoad) {
    const { trailer } = row;
    if (row.stage === "expected") {
      if (row.arrivesAtOrAfterCutoff) return "ETA at or after cutoff";
      return trailer.plannedDoorId ? `Planned door ${trailer.plannedDoorId}` : "Plan a door";
    }
    if (row.stage === "at_door") {
      return trailer.hold ? `On hold at ${trailer.currentDoorId}` : `Monitor ${trailer.currentDoorId}`;
    }
    const rec = byTrailer.get(trailer.id);
    if (rec?.primary) return `Review door ${rec.primary.doorId}`;
    if (trailer.hold) return "Resolve hold";
    if (!trailer.profileKnown) return "Check missing profile";
    return "Review blocked assignment";
  }

  return (
    <section className="panel pickup-board" aria-label="Pickup priorities">
      <header className="pickup-heading">
        <div><h2>Trailer queue</h2><p>On-site order · {sortBasis}</p></div>
        <label>Pickup window
          <select value={window} onChange={(event) => setWindow(event.target.value as PickupWindow)}>
            <option value="current">Current · {formatTime(scenario.currentDeadlineMinute)}</option>
            <option value="next">Next · {formatTime(scenario.nextDeadlineMinute)}</option>
          </select>
        </label>
      </header>
      <dl className="pickup-summary" aria-live="polite" aria-atomic="true">
        <div><dt>Packages in {formatTime(plan.deadline)} pickup</dt><dd>{count.format(plan.due)}</dd></div>
        <div><dt>All packages on {plan.rows.length} {plan.rows.length === 1 ? "trailer" : "trailers"}</dt><dd>{count.format(plan.loadVolume)}</dd></div>
        <div className={plan.phase === "open" ? undefined : "pickup-cutoff-alert"}>
          <dt>{plan.minutesLeft < 0 ? "Past cutoff" : "Until cutoff"}</dt>
          <dd>{plan.minutesLeft === 0 ? "Now" : `${Math.abs(plan.minutesLeft)} min`}</dd>
        </div>
      </dl>
      <div className="pickup-filters" role="group" aria-label="Filter pickup freight by location">
        <button type="button" aria-pressed={stage === "all"} onClick={() => setStage("all")}>All locations</button>
        {(["yard", "at_door", "expected"] as const).map((location) => (
          <button key={location} type="button" aria-pressed={stage === location} onClick={() => setStage(location)}>
            {stageName[location]} <span>{count.format(plan.stageDue[location])} due</span>
          </button>
        ))}
      </div>
      {visible.length ? (
        <div className="pickup-scroll" role="region" tabIndex={0} aria-label="Ranked pickup loads">
          <table>
            <thead><tr><th scope="col">Trailer</th><th scope="col">Location</th><th scope="col">Due packages</th><th scope="col">Share of trailer</th><th scope="col">Next action</th></tr></thead>
            <tbody>{visible.map((row) => (
              <tr key={row.trailer.id}>
                <th scope="row"><button type="button" className="pickup-load" onClick={() => onInspect(row.trailer.id)} aria-label={`Inspect ${row.trailer.id} for this pickup`}>{row.trailer.id}</button></th>
                <td>{stageName[row.stage]}<small>{stageDetail(row, scenario.nowMinute)}</small></td>
                <td>{count.format(row.due)}<small>of {count.format(row.trailer.packageCount)} on load</small></td>
                <td>{(100 * row.due / row.trailer.packageCount).toLocaleString("en-US", {maximumFractionDigits: 1})}%</td>
                <td className={row.arrivesAtOrAfterCutoff || row.trailer.hold ? "pickup-alert-text" : undefined}>{nextDecision(row)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="pickup-empty">No loads match this pickup and location.</p>}
    </section>
  );
}
