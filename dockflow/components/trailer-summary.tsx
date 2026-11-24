import { PanelRight, Truck } from "lucide-react";
import type { LoadDoorRow } from "@/lib/dock-engine";
import type { Zone } from "@/lib/dock-types";
import "./trailer-properties.css";

const stage = { yard: "In yard", at_door: "At door", expected: "Expected", complete: "Completed" };
const handling = { palletized: "Palletized", cart: "Cart", loose: "Loose", crossdock: "Crossdock" };
const doorRole = { proposal: "Proposed", conditional: "Planning target", physical: "Current door", review: "Review", complete: "Status" };
const number = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

type Props = { row: LoadDoorRow; zones: Zone[]; onInspect: (id: string) => void };

export function TrailerSummary({ row, zones, onInspect }: Props) {
  const { trailer, decision } = row;
  const mix = zones.map(zone => ({
    ...zone,
    units: trailer.zoneUnits[zone.id],
    share: trailer.packageCount ? trailer.zoneUnits[zone.id] / trailer.packageCount : 0,
  }));

  return <aside className="trailer-summary" aria-label="Selected trailer">
    <header className="properties-header"><PanelRight size={15} aria-hidden="true" />Properties</header>
    <div className="properties-selection">
      <span className="properties-truck" aria-hidden="true"><Truck size={22} strokeWidth={1.65} /></span>
      <div>
        <h2>{trailer.id}</h2>
        <div className="properties-states">
          <span className="properties-stage">{stage[trailer.status]}</span>
          {trailer.hold && <span className="properties-hold">On hold</span>}
        </div>
      </div>
    </div>
    <section className="properties-group">
      <h3>Manifest</h3>
      <dl className="properties-values">
        <div><dt>Carrier</dt><dd>{trailer.carrier}</dd></div>
        <div><dt>Handling</dt><dd>{handling[trailer.handling]}</dd></div>
        <div><dt>Packages</dt><dd>{number.format(trailer.packageCount)}</dd></div>
      </dl>
    </section>
    <section className="properties-group">
      <h3>Destination mix</h3>
      {trailer.profileKnown ? <>
        <div className="properties-mix-bar" aria-hidden="true">
          {mix.filter(zone => zone.units > 0).map(zone =>
            <i key={zone.id} data-zone={zone.id} style={{ flexGrow: zone.units }} />)}
        </div>
        <ul className="properties-mix-list">
          {mix.map(zone => <li key={zone.id}>
            <i data-zone={zone.id} aria-hidden="true" />
            <span>{zone.name}</span>
            <strong aria-label={`${number.format(zone.units)} packages`}>{number.format(zone.units)}</strong>
            <span className="properties-share">{trailer.packageCount ? percent.format(zone.share) : "—"}</span>
          </li>)}
        </ul>
      </> : <p className="properties-missing">Missing manifest</p>}
    </section>
    <section className="properties-group">
      <h3>Door fit</h3>
      <dl className="properties-values">
        <div><dt>Preassigned</dt><dd>{trailer.plannedDoorId ?? "None"}</dd></div>
        <div><dt>{doorRole[decision.kind]}</dt><dd>
          {decision.doorId
            ? <span className="properties-door" data-kind={decision.kind}>{decision.doorId}</span>
            : decision.kind === "review" ? decision.label : "Completed"}
        </dd></div>
      </dl>
      <button type="button" className="properties-review" onClick={() => onInspect(trailer.id)}>Review trailer</button>
    </section>
  </aside>;
}
