import { ArrowRight, Truck } from "lucide-react";
import type { LoadDoorRow } from "@/lib/dock-engine";
import type { Zone } from "@/lib/dock-types";

const stage = { yard: "In yard", at_door: "At door", expected: "Expected", complete: "Completed" };
const format = new Intl.NumberFormat("en-US");

export function TrailerSummary({ row, zones, onInspect }: { row: LoadDoorRow; zones: Zone[]; onInspect: (id: string) => void }) {
  const { trailer, decision } = row;
  return <aside className="trailer-summary" aria-label="Selected trailer">
    <div className="summary-cap"><Truck size={15} />Selected trailer</div>
    <div className="summary-id"><h2>{trailer.id}</h2><span>{stage[trailer.status]}</span></div>
    <p className="summary-total">{format.format(trailer.packageCount)} packages</p>
    <section><h3>Destination mix</h3>{trailer.profileKnown ? zones.map(zone => <div className="summary-zone" key={zone.id}>
      <div><span>{zone.name}</span><strong>{format.format(trailer.zoneUnits[zone.id])}</strong></div>
      <div className="summary-track"><i style={{ width: `${trailer.packageCount ? 100 * trailer.zoneUnits[zone.id] / trailer.packageCount : 0}%` }} /></div>
    </div>) : <p>Missing manifest</p>}</section>
    <section className="summary-placement"><h3>Door fit</h3><dl>
      <div><dt>Preassigned</dt><dd>{trailer.plannedDoorId ?? "None"}</dd></div>
      <div><dt>{{ proposal: "Proposed", conditional: "Planning target", physical: "Current door", review: "Review", complete: "Status" }[decision.kind]}</dt><dd>{decision.doorId ?? (decision.kind === "review" ? decision.label : "Completed")}</dd></div>
    </dl></section>
    <button onClick={() => onInspect(trailer.id)}>Review trailer<ArrowRight size={15} /></button>
  </aside>;
}
