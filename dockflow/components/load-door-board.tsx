"use client";

import { useState, type CSSProperties } from "react";
import { ChevronDown, Table2 } from "lucide-react";
import type { LoadDoorRow } from "@/lib/dock-engine";
import type { PackageSize, Scenario, TrailerStatus } from "@/lib/dock-types";
import "./load-door-board.css";

const locationGroups = [
  ["at_door", "At door"],
  ["yard", "In yard"],
  ["expected", "Expected"],
  ["complete", "Completed"],
] as const;

const sizeOptions = ["compact", "standard", "bulky"] as const;
const decisionLabels = {
  physical: "Current door", proposal: "Proposed", conditional: "Planning target",
  review: "Review", complete: "Completed",
};
export const warningNames: Record<string, string> = {
  "duplicate-occupancy": "Conflicting occupancy",
  "missing-profile": "Missing manifest",
  "stale-profile": "Stale manifest",
  "wrong-handling": "Handling mismatch",
  "wrong-destination": "Destination mismatch",
  "planned-handling": "Planned handling mismatch",
  "planned-destination": "Planned destination mismatch",
  "disabled-occupied-door": "Disabled door occupied",
  "priority-inversion": "Higher priority waiting",
};
const number = new Intl.NumberFormat("en-US");
const clock = (minute: number) => [Math.floor(minute / 60), minute % 60].map(value => String(value).padStart(2, "0")).join(":");

export function LoadDoorBoard({ scenario, rows, selectedId, onInspect }: {
  scenario: Scenario;
  rows: LoadDoorRow[];
  selectedId?: string;
  onInspect: (id: string) => void;
}) {
  const [location, setLocation] = useState<"all" | TrailerStatus>("all");
  const [size, setSize] = useState<"all" | PackageSize>("all");
  const groups = locationGroups.filter(([key]) => key === location || location === "all");

  return <section className="panel load-door-board" aria-labelledby="load-board-heading">
    <header className="load-board-header">
      <h2 id="load-board-heading"><Table2 size={17} aria-hidden="true" />Inbound trailers <span className="count">{rows.filter(row => location === "all" || row.trailer.status === location).length}</span></h2>
      <div className="load-board-controls">
        <label className="load-board-filter">
          <select aria-label="Location" value={location} onChange={event => setLocation(event.target.value as typeof location)}>
            <option value="all">All locations</option>
            {locationGroups.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
        <label className="load-board-filter">
          <select aria-label="Destination counts by package size" value={size} onChange={event => setSize(event.target.value as typeof size)}>
            <option value="all">All package sizes</option>
            {sizeOptions.map(key => <option key={key} value={key}>{key.charAt(0).toUpperCase() + key.slice(1)} packages</option>)}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
      </div>
    </header>
    {size !== "all" && !rows.some(row => row.trailer.packageMix) && <p className="load-board-missing">
      This snapshot has no package size breakdown.
    </p>}
    <div className="load-board-scroll" role="region" aria-label="Scrollable trailer destination matrix" tabIndex={0}>
      <table>
        <thead><tr>
          <th scope="col">Trailer</th><th scope="col">Due by pickup<small>{clock(scenario.currentDeadlineMinute)} · {clock(scenario.nextDeadlineMinute)}</small></th>
          {scenario.zones.map(zone => <th key={zone.id} className="zone-column" data-zone={zone.id} scope="col">
            <span><i aria-hidden="true" />{zone.name}</span>
          </th>)}
          <th scope="col">Preassigned</th><th scope="col">Door review</th>
        </tr></thead>
        {groups.map(([key, name]) => {
          const group = rows.filter(row => row.trailer.status === key);
          return <tbody key={key}>
            <tr className="load-board-group"><th colSpan={7} scope="rowgroup"><i aria-hidden="true" className={`location-dot ${key}`} />{name} <span>{group.length}</span></th></tr>
            {group.length === 0 && <tr><td colSpan={7} className="load-board-empty">No trailers.</td></tr>}
            {group.map(({ trailer, decision, preassignmentDiffers, placementIssues }) => {
              const cells = scenario.zones.map(zone => size === "all"
                ? trailer.profileKnown ? trailer.zoneUnits[zone.id] : null
                : trailer.packageMix?.[zone.id][size] ?? null);
              const rowTotal = cells.reduce<number>((sum, units) => sum + (units ?? 0), 0);
              return <tr key={trailer.id} className={trailer.id === selectedId ? "load-board-selected" : undefined}
                onClick={event => { if (!(event.target as Element).closest("button")) onInspect(trailer.id); }}>
                <th scope="row"><button type="button" className="load-board-inspect" aria-current={trailer.id === selectedId ? true : undefined} onClick={() => onInspect(trailer.id)}>{trailer.id}</button>
                  <small>{trailer.handling}{trailer.hold && " · On hold"}</small>
                </th>
                <td>{number.format(trailer.currentUnits)} · {number.format(trailer.nextUnits)}<small>{number.format(trailer.packageCount)} total</small></td>
                {cells.map((units, i) => {
                  const share = rowTotal && units !== null ? units / rowTotal : 0;
                  const label = units === null ? "No manifest detail" : `${number.format(units)} packages · ${Math.round(share * 100)}%`;
                  const cellStyle = units === null ? undefined : { "--heat-strength": `${4 + share * 70}%` } as CSSProperties;
                  return <td key={scenario.zones[i].id} className="load-board-count" data-zone={scenario.zones[i].id} title={label}>
                    <span className={units === null ? "heat-unknown" : "heat-value"} style={cellStyle}>{units === null ? "—" : number.format(units)}</span>
                  </td>;
                })}
                <td>{trailer.plannedDoorId ?? "—"}{preassignmentDiffers && <small className="load-board-discrepancy">Different door</small>}</td>
                <td className="load-board-decision">
                  <strong className={decision.kind === "review" ? "load-board-discrepancy" : undefined}>{decision.doorId ?? (decision.kind === "review" ? decision.label : decisionLabels[decision.kind])}</strong>
                  {decision.doorId && <span>{decisionLabels[decision.kind]}</span>}
                  {decision.kind === "conditional" && <small>{decision.label}</small>}
                  {placementIssues.map(issue => <small className="load-board-discrepancy" key={issue.code}>{warningNames[issue.code] ?? "Placement issue"}</small>)}
                </td>
              </tr>;
            })}
          </tbody>;
        })}
      </table>
    </div>
    <div className="load-board-key"><span>Destination share</span><span>0%</span><i className="share-legend" aria-hidden="true" /><span>100%</span><span className="detail-key"><i aria-hidden="true" /> No manifest detail</span></div>
  </section>;
}
