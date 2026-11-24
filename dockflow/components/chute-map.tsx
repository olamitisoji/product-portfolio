"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ListFilter, Maximize2, Route } from "lucide-react";
import { buildChuteMap, CHUTES_PER_ZONE } from "@/lib/chute-routing";
import type { AnalystChuteContext } from "@/lib/analyst-context";
import type { Scenario, TrailerStatus, ZoneId } from "@/lib/dock-types";
import "./chute-map.css";

type Zone = ReturnType<typeof buildChuteMap>["zones"][number];
type Chute = Zone["chutes"][number];

const locations: ReadonlyArray<{ id: TrailerStatus; label: string }> = [
  { id: "at_door", label: "At door" }, { id: "yard", label: "In yard" },
  { id: "expected", label: "Expected" }, { id: "complete", label: "Completed" },
];
const activeStates: TrailerStatus[] = ["at_door", "yard", "expected"];
const bankSize = 20;
const count = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function heatLevel(value: number, max: number) {
  if (!value || !max) return 0;
  const relative = value / max;
  if (relative <= .08) return 1;
  if (relative <= .25) return 2;
  if (relative <= .55) return 3;
  return 4;
}

function ZoneOverview({ zone, peak, onChoose }: {
  zone: Zone;
  peak: number;
  onChoose: (zoneId: ZoneId, chute?: Chute) => void;
}) {
  return <button type="button" className="chute-zone-card" data-zone-card={zone.id} aria-label={`Explore ${zone.name}, ${zone.chutes.length} chutes, ${count.format(zone.routedPackages)} routed packages`}
    onClick={event => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-chute]") : null;
      onChoose(zone.id, target ? zone.chutes.find(chute => chute.id === target.dataset.chute) : undefined);
    }}>
    <span className="chute-zone-title"><span><i data-zone={zone.id} />{zone.name}</span><Maximize2 size={13} aria-hidden="true" /></span>
    <span className="chute-zone-volume"><strong>{count.format(zone.routedPackages)}</strong> routed</span>
    <span className="chute-blueprint" aria-hidden="true">
      {[0, 1].map(half => <span key={half} className="chute-bank-half">
        {zone.chutes.slice(half * 100, (half + 1) * 100).map(chute => <i key={chute.id}
          data-chute={chute.id} data-heat={heatLevel(chute.packages, peak)}
          title={`${chute.id} · ${count.format(chute.packages)} routed`} />)}
      </span>)}
    </span>
    <span className="chute-map-coordinates"><span>{zone.chutes[0]?.id}</span><span>{zone.chutes.at(-1)?.id}</span></span>
  </button>;
}

function ChuteDetail({ chute, onInspect }: { chute: Chute; onInspect: (id: string) => void }) {
  return <div className="chute-detail" aria-live="polite">
    <div className="chute-detail-title"><b>{chute.id}</b><span><strong>{count.format(chute.packages)}</strong> routed · {percent.format(chute.sharePercent)}% of sorter-bound packages</span></div>
    {chute.sources.length ? <ul aria-label={`Trailers routed to ${chute.id}`}>{chute.sources.map(source =>
      <li key={source.trailerId}><button type="button" onClick={() => onInspect(source.trailerId)}
        aria-label={`Inspect ${source.trailerId}, ${source.packages} packages to ${chute.id}`}>
        <span>{source.trailerId} <small>{locations.find(location => location.id === source.status)?.label}</small></span>
        <strong>{count.format(source.packages)}</strong>
      </button></li>)}</ul>
      : <p>No manifest routes to this chute in the current selection.</p>}
  </div>;
}

export function ChuteMap({ scenario, selectedId, onSelect, onInspect, onContextChange }: {
  scenario: Scenario;
  selectedId?: string;
  onSelect: (id: string) => void;
  onContextChange: (context: AnalystChuteContext) => void;
  onInspect: (id: string) => void;
}) {
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [statuses, setStatuses] = useState<TrailerStatus[]>(activeStates);
  const [focus, setFocus] = useState<{ zoneId: ZoneId; chuteId?: string } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const bankTitle = useRef<HTMLHeadingElement>(null);
  const previousZone = useRef<ZoneId | undefined>(undefined);
  const trailerScope = scope === "selected" && !!selectedId;
  const map = useMemo(() => buildChuteMap(scenario, trailerScope ? { trailerId: selectedId } : { statuses }),
    [scenario, trailerScope, selectedId, statuses]);
  const ranked = useMemo(() => map.zones.flatMap(zone => zone.chutes).filter(chute => chute.packages > 0)
    .sort((a, b) => b.packages - a.packages || a.id.localeCompare(b.id)), [map]);
  const peak = ranked[0]?.packages ?? 0;
  const zone = map.zones.find(item => item.id === focus?.zoneId);
  const chute = zone?.chutes.find(item => item.id === focus?.chuteId)
    ?? (zone && (ranked.find(item => item.zoneId === zone.id) ?? zone.chutes[0]));
  const bank = zone && chute ? Math.floor(zone.chutes.indexOf(chute) / bankSize) : 0;
  const filteredRanks = (zone ? ranked.filter(item => item.zoneId === zone.id) : ranked).slice(0, 4);
  const defaults = activeStates.length === statuses.length && activeStates.every(status => statuses.includes(status));

  const shownZone = map.routedPackages ? zone?.id : undefined;
  const shownChute = shownZone ? chute?.id : undefined;
  useEffect(() => {
    const filter = trailerScope ? { trailerId: selectedId } : { statuses };
    onContextChange({ ...filter, zoneId: shownZone, chuteId: shownChute });
  }, [trailerScope, selectedId, statuses, shownZone, shownChute, onContextChange]);

  useEffect(() => {
    const previous = previousZone.current;
    if (previous === shownZone) return;
    previousZone.current = shownZone;
    if (shownZone) bankTitle.current?.focus({ preventScroll: true });
    else if (previous) panel.current?.querySelector<HTMLButtonElement>(`[data-zone-card="${previous}"]`)?.focus({ preventScroll: true });
  }, [shownZone]);

  function choose(zoneId: ZoneId, selected?: Chute) {
    setFocus({ zoneId, chuteId: selected?.id });
  }
  function toggleStatus(status: TrailerStatus) {
    setStatuses(current => current.includes(status) ? current.filter(item => item !== status) : [...current, status]);
  }

  return <section ref={panel} className="chute-map panel" aria-label="Chute destination heatmap">
    <header className="chute-head">
      <div><h2><Route size={17} aria-hidden="true" />Chute heatmap</h2>
        <p>{count.format(map.zones.length * CHUTES_PER_ZONE)} destination chutes · {CHUTES_PER_ZONE} per zone</p>
      </div>
      <div className="chute-controls">
        <select aria-label="Chute map trailer" value={trailerScope ? selectedId : ""}
          onChange={event => {
            const id = event.target.value;
            setScope(id ? "selected" : "all");
            if (id) onSelect(id);
          }}>
          <option value="">All trailers</option>
          {scenario.trailers.map(trailer => <option key={trailer.id} value={trailer.id}>{trailer.id}</option>)}
        </select>
        {!trailerScope && <details className="chute-location">
          <summary><ListFilter size={13} aria-hidden="true" />{defaults ? "Active locations" : `Locations (${statuses.length})`}<ChevronDown size={12} aria-hidden="true" /></summary>
          <fieldset><legend className="chute-sr">Trailer locations</legend>{locations.map(location =>
            <label key={location.id}><input type="checkbox" checked={statuses.includes(location.id)}
              onChange={() => toggleStatus(location.id)} />{location.label}</label>)}</fieldset>
        </details>}
      </div>
    </header>

    <div className="chute-map-body">
      {!map.routedPackages && map.unmappedPackages > 0 ? <p className="chute-empty">These manifests have no individual chute routes. {count.format(map.unmappedPackages)} packages have no recorded chute.</p>
        : map.bypassedPackages > 0 && map.bypassedPackages === map.totalPackages ? <p className="chute-empty">These transfer packages bypass the sort floor.</p>
        : !map.trailerCount ? <p className="chute-empty">No trailers match the selected locations.</p>
        : <>
          <div className="chute-map-heading">
            {zone ? <button type="button" className="chute-back" onClick={() => setFocus(null)}><ChevronLeft size={15} />All zones</button>
              : <h3>Floor layout</h3>}
            <span className="chute-scale" aria-label={`Routed packages per chute, from zero to ${peak}`}>
              <span>0</span>{[0, 1, 2, 3, 4].map(level => <i data-heat={level} key={level} aria-hidden="true" />)}<span>{count.format(peak)} packages</span>
            </span>
          </div>
          {!zone && <div className="chute-floor-layout">
            {map.zones.map(area => <ZoneOverview key={area.id} zone={area} peak={peak} onChoose={choose} />)}
          </div>}
          {zone && chute && <div className="chute-bank-view">
            <div className="chute-bank-header"><div><h3 tabIndex={-1} ref={bankTitle}>{zone.name}</h3><p>{count.format(zone.routedPackages)} routed packages</p></div>
              <select aria-label="Chute bank" value={bank} onChange={event => {
                const start = Number(event.target.value) * bankSize;
                const nextBank = zone.chutes.slice(start, start + bankSize);
                choose(zone.id, nextBank.reduce((a, b) => b.packages > a.packages ? b : a));
              }}>
                {zone.chutes.filter((_, index) => index % bankSize === 0).map((first, index) =>
                  <option key={first.id} value={index}>{first.id}–{zone.chutes[(index + 1) * bankSize - 1].id}</option>)}
              </select>
            </div>
            <div className="chute-cells" role="group" aria-label={`${zone.name} chute bank`}>
              {zone.chutes.slice(bank * bankSize, (bank + 1) * bankSize).map(item => <button key={item.id} type="button"
                data-heat={heatLevel(item.packages, peak)} aria-pressed={chute.id === item.id}
                aria-label={`${item.id}, ${count.format(item.packages)} routed packages`}
                onClick={() => choose(zone.id, item)}><span>{item.id}</span><strong>{count.format(item.packages)}</strong></button>)}
            </div>
            <ChuteDetail chute={chute} onInspect={onInspect} />
          </div>}
          {filteredRanks.length > 0 && <div className="chute-ranked">
            <h3>Busiest chutes</h3>
            <div>{filteredRanks.map(item => <button key={item.id} type="button" onClick={() => choose(item.zoneId, item)}
              aria-label={`Inspect chute ${item.id}, ${item.packages} routed packages`}>
              <strong>{item.id}</strong><span>{count.format(item.packages)}</span>
            </button>)}</div>
          </div>}
        </>}
    </div>
    <footer className="chute-footer">
      <span><i className="chute-source-dot" />Manifest routing</span>
      <span>{count.format(map.routedPackages)} routed{map.bypassedPackages > 0 && <> · {count.format(map.bypassedPackages)} bypass the sorter</>}{map.unmappedPackages > 0 && <> · <strong>{count.format(map.unmappedPackages)} without chute data</strong></>}</span>
    </footer>
  </section>;
}
