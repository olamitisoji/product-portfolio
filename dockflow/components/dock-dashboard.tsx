"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction, type CSSProperties } from "react";
import { Box, ChevronDown, FileStack, FolderClosed, Layers3, Minus, PanelRight, Plus, Activity, ArrowDownToLine, ArrowRight, Check, ChevronRight, Clock3, DoorOpen, LayoutDashboard, ListOrdered, RefreshCw, Search, Settings2, Truck, Undo2, Upload, Warehouse } from "lucide-react";
import { advanceClock, applyAssignment, buildLoadDoorBoard, completeTrailer, evaluate, exportScenarioCsv, feasibleDoors, parseScenario, refreshSyntheticProfiles } from "@/lib/dock-engine";
import { VolumeProfile } from "@/components/volume-profile";
import { createScenario } from "@/lib/dock-fixtures";
import { ChuteMap } from "@/components/chute-map";
import { LoadDoorBoard, warningNames } from "@/components/load-door-board";
import { ShiftPriorityBoard } from "@/components/shift-priority-board";
import { SortFloorBoard } from "@/components/sort-floor-board";
import { ShiftAnalyst } from "@/components/shift-analyst";
import { TrailerSummary } from "@/components/trailer-summary";
import "./editor-canvas.css";
import type { PickupWindow } from "@/lib/shift-priorities";
import { getBaselineFloorPlan, evaluateSortFloor, type FloorPlan } from "@/lib/sort-floor";
import { planPickupWindow } from "@/lib/shift-priorities";
import type { AuditEvent, PlanMode, Preset, Scenario } from "@/lib/dock-types";

type View = "overview" | "priorities" | "queue" | "doors" | "floor" | "assumptions";
type Session = { scenario: Scenario; audit: AuditEvent[] };
const STORAGE_KEY = "dockflow.synthetic.v1";
// A shared floor-map example has its own tab session, separate from the saved shift.
function shiftStorage() {
  return new URLSearchParams(window.location.search).get("example") === "chutes"
    ? window.sessionStorage : window.localStorage;
}
const number = (value: number) => value.toLocaleString("en-US");
const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const label = (value: string) => value === "at_door" ? "At door" : value.charAt(0).toUpperCase() + value.slice(1);
const initial = (): Session => ({ scenario: createScenario(), audit: [] });

// Files and browser storage are untrusted inputs: validate before using them.
function readSession(value: unknown): Session {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a synthetic Sortward JSON snapshot.");
  const record = value as Record<string, unknown>;
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
  return { scenario: parsed.scenario, audit };
}

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export default function DockDashboard() {
  const [session, setSession] = useState<Session>(initial);
  const [history, setHistory] = useState<Session[]>([]);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [floorOverride, setFloorOverride] = useState<{ baseline: FloorPlan; plan: FloorPlan } | null>(null);
  const [pickup, setPickup] = useState<PickupWindow>("current");
  const [floorRevision, setFloorRevision] = useState(0);
  const [propertiesVisible, setPropertiesVisible] = useState(true);
  const [zoom, setZoom] = useState(100);
  const canvas = useRef<HTMLElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [mode, setMode] = useState<PlanMode>("priority");
  const [preset, setPreset] = useState<Preset>("balanced");
  const [seed, setSeed] = useState("42");
  const [selectedId, setSelectedId] = useState("TR-103");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [chosenDoor, setChosenDoor] = useState("");
  const [reason, setReason] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scenario = session.scenario;
  const baseline = getBaselineFloorPlan(scenario);
  const floorPlan = floorOverride?.baseline === baseline ? floorOverride.plan : baseline;
  function setFloorPlan(next: SetStateAction<FloorPlan>) {
    setFloorOverride(previous => {
      const current = previous?.baseline === baseline ? previous.plan : baseline;
      const plan = typeof next === "function" ? next(current) : next;
      return plan === baseline ? null : { baseline, plan };
    });
  }
  const result = useMemo(() => evaluate(scenario, mode), [scenario, mode]);
  const floorBaseline = useMemo(() => evaluateSortFloor(scenario), [scenario]);
  const currentPickup = useMemo(() => planPickupWindow(scenario, "current"), [scenario]);
  const selected = scenario.trailers.find((trailer) => trailer.id === selectedId);
  const proposal = result.recommendations.find((item) => item.trailerId === selectedId);
  const loadRows = useMemo(() => buildLoadDoorBoard(scenario, result), [scenario, result]);
  const selectedRow = loadRows.find(row => row.trailer.id === selectedId);
  const review = selectedRow?.decision;
  const eligible = useMemo(() => feasibleDoors(scenario, selectedId), [scenario, selectedId]);
  const targetDoor = eligible.some((door) => door.doorId === chosenDoor) ? chosenDoor : proposal?.primary?.doorId ?? eligible[0]?.doorId ?? "";
  const target = proposal?.primary?.doorId === targetDoor ? proposal.primary : eligible.find((door) => door.doorId === targetDoor);
  const manual = !!targetDoor && targetDoor !== proposal?.primary?.doorId;
  const visibleTrailers = result.queueIds.map((id) => scenario.trailers.find((trailer) => trailer.id === id)!).filter((trailer) => {
    const matchesFilter = filter === "all" || trailer.status === filter || (filter === "high" && result.priorities[trailer.id].level === "high");
    return matchesFilter && `${trailer.id} ${trailer.carrier} ${trailer.handling}`.toLowerCase().includes(search.toLowerCase());
  });

  useEffect(() => {
    // Defer browser-only state until the server-rendered first view has hydrated.
    const timer = window.setTimeout(() => {
      try {
        const saved = shiftStorage().getItem(STORAGE_KEY);
        if (saved) {
          if (saved.length > 2_000_000) throw new Error("Saved snapshot is too large.");
          const restored = readSession(JSON.parse(saved));
          setSession(restored);
          if (!restored.scenario.trailers.some(trailer => trailer.id === "TR-103")) {
            setSelectedId(restored.scenario.trailers[0]?.id ?? "");
          }
          setSeed(String(restored.scenario.seed));
        }
      } catch { setError("Saved data could not be restored. A fresh scenario is loaded."); }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { shiftStorage().setItem(STORAGE_KEY, JSON.stringify(session)); }
    catch {
      const timer = window.setTimeout(() => setError("Browser storage is unavailable. Export JSON to keep this snapshot."), 0);
      return () => window.clearTimeout(timer);
    }
  }, [session, ready]);

  function commit(next: Session, message: string) {
    setHistory((previous) => [...previous.slice(-29), session]);
    setSession(next);
    setError("");
    setNotice(message);
  }
  function changeScenario(next: Scenario, message: string) {
    const parsed = parseScenario(next);
    if (!parsed.ok) { setError(parsed.errors.join(" ")); return; }
    commit({ ...session, scenario: parsed.scenario }, message);
  }
  function inspect(id: string) { setSelectedId(id); setChosenDoor(""); setReason(""); }
  function openTrailer(id: string) {
    inspect(id);
    setDrawerOpen(true);
  }
  function selectOnCanvas(id: string) {
    if (window.matchMedia("(min-width: 1200px)").matches) {
      inspect(id);
      setPropertiesVisible(true);
    } else openTrailer(id);
  }
  useEffect(() => {
    canvas.current?.scrollTo({ top: 0 });
  }, [view]);
  useEffect(() => {
    if (drawerOpen && !drawer.current?.open) drawer.current?.showModal();
  }, [drawerOpen]);
  function leaveDrawer(next: View) {
    drawer.current?.close();
    setView(next);
  }
  function accept() {
    if (!selected || !targetDoor) return;
    if (manual && !reason.trim()) { setError("Add a reason for choosing a different feasible door."); return; }
    try {
      const action = applyAssignment(scenario, selected.id, targetDoor, reason || `Accepted ${mode}-order proposal after reviewing its constraints.`);
      commit({ scenario: action.scenario, audit: [...session.audit, action.event].slice(-1000) }, `${selected.id} assigned to ${targetDoor} in the simulation.`);
      setChosenDoor(""); setReason("");
    } catch (caught) { setError((caught as Error).message); }
  }
  function finish() {
    if (!selected) return;
    try {
      const action = completeTrailer(scenario, selected.id);
      commit({ scenario: action.scenario, audit: [...session.audit, action.event].slice(-1000) }, `${selected.id} marked unloaded. Its physical door is released.`);
    } catch (caught) { setError((caught as Error).message); }
  }
  function reset(loadCurrentExample = false) {
    try {
      const numericSeed = loadCurrentExample ? scenario.seed : Number(seed);
      if (!loadCurrentExample && !seed.trim()) throw new Error("Enter a whole-number seed.");
      const nextPreset = loadCurrentExample ? "balanced" : preset;
      commit({ scenario: createScenario(nextPreset, numericSeed), audit: [] }, `Loaded ${nextPreset} scenario with seed ${numericSeed}.`);
      setPreset(nextPreset); setSeed(String(numericSeed));
      setFloorOverride(null); setPickup("current");
      setFloorRevision((value) => value + 1);
      inspect("TR-103"); setFilter("all"); setSearch("");
    } catch (caught) { setError((caught as Error).message); }
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Choose a JSON file smaller than 2 MB.");
      const imported = readSession(JSON.parse(await file.text()));
      commit(imported, "Snapshot imported.");
      setFloorOverride(null); setPickup("current");
      setFloorRevision((value) => value + 1);
      setSeed(String(imported.scenario.seed)); setSelectedId(imported.scenario.trailers[0]?.id ?? "");
      setSearch(""); setFilter("all"); setChosenDoor(""); setReason("");
    } catch (caught) { setError(`Import rejected. ${(caught as Error).message} Your scenario is unchanged.`); }
    if (fileRef.current) fileRef.current.value = "";
  }

  const nav: { id: View; title: string; icon: typeof Warehouse }[] = [
    { id: "overview", title: "Shift heatmap", icon: LayoutDashboard },
    { id: "priorities", title: "Pickup priorities", icon: Clock3 },
    { id: "floor", title: "Sort floor", icon: Activity },
    { id: "queue", title: "Trailer directory", icon: ListOrdered },
    { id: "doors", title: "Door plan", icon: Warehouse },
    { id: "assumptions", title: "Rules & scenarios", icon: Settings2 },
  ];

  const queue = <section className="panel queue-panel" aria-label="Trailer queue">
    <div className="panel-heading"><h2>Inbound queue <span className="count">{visibleTrailers.length}</span></h2>
      <label className="mode-switch">Plan order<select aria-label="Plan order" value={mode} onChange={(event) => setMode(event.target.value as PlanMode)}><option value="priority">Deadline priority</option><option value="arrival">Arrival order</option></select></label>
    </div>
    <div className="queue-tools"><label className="search"><Search size={16} /><input aria-label="Search trailers" placeholder="Search trailer or carrier…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select aria-label="Filter trailers" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All trailers</option><option value="yard">In yard</option><option value="at_door">At door</option><option value="expected">Expected</option><option value="complete">Completed</option><option value="high">High priority</option></select></div>
    <div className="table-scroll"><table><thead><tr><th>Trailer</th><th>Priority</th><th>Status</th><th>Due by {time(scenario.currentDeadlineMinute)}</th><th>Packages</th><th>Next door</th></tr></thead><tbody>
      {visibleTrailers.map((trailer) => {
        const recommendation = result.recommendations.find((item) => item.trailerId === trailer.id);
        return <tr key={trailer.id} className={selectedId === trailer.id ? "selected" : ""}><td><button className="row-select" onClick={() => openTrailer(trailer.id)} aria-label={`Inspect ${trailer.id}`}><strong>{trailer.id}</strong><span>{trailer.carrier}</span></button></td><td><Badge tone={result.priorities[trailer.id].level}>{label(result.priorities[trailer.id].level)}</Badge>{result.priorities[trailer.id].overdue && <small className="late">Overdue</small>}</td><td><span className={`status-dot ${trailer.status}`} />{label(trailer.status)}{trailer.hold && <small className="held">On hold</small>}</td><td className="numeric">{number(trailer.currentUnits)}</td><td className="numeric">{number(trailer.packageCount)}</td><td>{trailer.status === "yard" ? recommendation?.primary ? <button className="door-link" onClick={() => openTrailer(trailer.id)}>{recommendation.primary.doorId}<ArrowRight size={13} /></button> : <span className="muted">Review</span> : <span className="muted">{trailer.currentDoorId ?? "—"}</span>}</td></tr>;
      })}
    </tbody></table>{!visibleTrailers.length && <p className="empty">No trailers match this view. Change the filter or search.</p>}</div>
  </section>;

  const inspector = <aside className="panel inspector" aria-label="Trailer inspector">{selected ? <>
    <div className="inspector-title"><div><h2>{selected.id}</h2><p>{selected.carrier}</p></div><Badge tone={result.priorities[selected.id].level}>{label(result.priorities[selected.id].level)}</Badge></div>
    <div className="detail-grid"><div><span>Handling</span><strong>{label(selected.handling)}</strong></div><div><span>Arrival</span><strong>{time(selected.arrivalMinute)}</strong></div><div><span>Next deadline</span><strong>{number(selected.nextUnits)} packages</strong></div><div><span>Imported plan</span><strong>{selected.plannedDoorId ?? "None"}</strong></div></div>
    <div className="inspector-block"><h3>Door planning priority</h3><p>{result.priorities[selected.id].reason}</p></div>
    <div className="profile"><span>Destination profile</span><Badge tone={!selected.profileKnown || scenario.nowMinute - (selected.profileUpdatedMinute ?? 0) > 60 ? "medium" : "teal"}>{!selected.profileKnown ? "Unknown" : `${scenario.nowMinute - selected.profileUpdatedMinute!}m old`}</Badge></div>
    <div className="mix">{scenario.zones.map((zone) => <div key={zone.id}><small>Zone {zone.id}</small><strong>{selected.profileKnown ? number(selected.zoneUnits[zone.id]) : "—"}</strong></div>)}</div>
    {selected.status === "yard" ? <div className="recommendation"><h3>{proposal?.primary ? `Assign to ${proposal.primary.doorId}` : "No proposed door"}</h3><p>{proposal?.reason}</p>{eligible.length > 0 && <>
      <label className="field">Assignment door<select aria-label="Assignment door" value={targetDoor} onChange={(event) => setChosenDoor(event.target.value)}>{eligible.map((door) => <option key={door.doorId} value={door.doorId}>{door.doorId}{door.doorId === proposal?.primary?.doorId ? " · proposed" : " · manual choice"}</option>)}</select></label>
      <div className="candidate-stats"><span>Destination match <strong>{target?.zoneMatchPercent == null ? "N/A · transfer" : `${Math.round(target.zoneMatchPercent)}%`}</strong></span><span>{manual ? "Load after this assignment" : "Projected door-zone load"} <strong>{target?.projectedPressurePercent == null ? "N/A · transfer" : `${Math.round(target.projectedPressurePercent)}%`}</strong></span></div>
      <label className="field">{manual ? "Reason for manual choice (required)" : "Decision note"}<textarea aria-label="Decision note" maxLength={500} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {manual && <p className="small-note">A manual choice may use another trailer’s proposed door. The full plan recalculates after acceptance.</p>}
      <button className="button primary full" disabled={!ready || (manual && !reason.trim())} onClick={accept}><Check size={16} />Accept assignment</button>
    </>}</div> : selected.status === "at_door" ? <div className="recommendation"><h3>At {selected.currentDoorId}</h3><p>{selected.hold ? "This trailer holds its door until unloaded." : "Unload to release the door."}</p><button className="button primary full" disabled={!ready} onClick={finish}><Check size={16} />Mark unloaded</button></div> : <div className="inspector-block"><h3>{selected.status === "expected" ? "Awaiting arrival" : "Work completed"}</h3><p>{selected.status === "expected" ? "Advance the simulated clock to its arrival time before assigning a door." : "This trailer is excluded from active workload and new door proposals."}</p></div>}
    {review && (review.kind === "conditional" || (review.kind === "review" && review.detail !== proposal?.reason)) && <div className="inspector-block"><h3>{review.doorId ? `Planning target · ${review.doorId}` : review.label}</h3><p>{review.detail}</p></div>}
    {result.warnings.some(warning => warning.trailerIds.includes(selected.id)) && <details className="inspector-block trailer-warnings"><summary>Exceptions</summary>{result.warnings.filter(warning => warning.trailerIds.includes(selected.id)).map((warning, index) => <p key={`${warning.code}-${index}`}>{warning.message}</p>)}</details>}
    {selected.status !== "complete" && <label className="hold-toggle"><input type="checkbox" checked={selected.hold} onChange={() => changeScenario({ ...scenario, trailers: scenario.trailers.map((trailer) => trailer.id === selected.id ? { ...trailer, hold: !trailer.hold } : trailer) }, `${selected.id} planning hold ${selected.hold ? "removed" : "applied"}. Physical occupancy is unchanged.`)} />Planning hold <span>Blocks new assignments</span></label>}
    <div className="inspector-block"><h3>Assignment history</h3>{session.audit.filter((event) => event.trailerId === selected.id).slice(-4).reverse().map((event, index) => <div className="audit-event" key={`${event.atMinute}-${index}`}><span>{time(event.atMinute)}</span><div><strong>{event.action === "assign" ? `Assigned to ${event.doorId}` : `Unloaded from ${event.doorId}`}</strong><p>{event.reason}</p></div></div>)}{!session.audit.some((event) => event.trailerId === selected.id) && <p>No actions recorded.</p>}</div>
  </> : <p className="empty">Select a trailer.</p>}</aside>;

  const doorPlan = <section className="panel"><div className="panel-heading"><h2>Dock doors <span className="count">{scenario.doors.length}</span></h2><Badge>{result.metrics.availableDoors} available</Badge></div><div className="door-grid">{scenario.doors.map((door) => {
    const occupants = scenario.trailers.filter((trailer) => trailer.status === "at_door" && trailer.currentDoorId === door.id);
    const recommended = result.recommendations.find((item) => item.primary?.doorId === door.id);
    return <article key={door.id} className={`door-card ${!door.enabled ? "disabled-door" : occupants.length ? "occupied" : "open"}`}><div className="door-top"><DoorOpen size={22} /><strong>{door.id}</strong><Badge tone={occupants.length > 1 ? "high" : occupants.length ? "neutral" : door.enabled ? "teal" : "medium"}>{occupants.length ? "Occupied" : door.enabled ? "Available" : "Disabled"}</Badge></div><p>{door.zoneId ? `Zone ${door.zoneId}` : "Dedicated transfer"} · {door.allowedHandling.map(label).join(", ")}</p>{occupants.map((trailer) => <button className="occupant" key={trailer.id} onClick={() => openTrailer(trailer.id)}><Truck size={16} /><span>{trailer.id}{trailer.hold ? " · held" : ""}</span><ChevronRight size={16} /></button>)}{!occupants.length && (recommended ? <button className="proposed-load" onClick={() => openTrailer(recommended.trailerId)}>Proposed: {recommended.trailerId} <ArrowRight size={14} /></button> : <div className="no-proposal">No proposal</div>)}<label className="door-toggle"><input type="checkbox" aria-label={`Enable ${door.id} for new assignments`} checked={door.enabled} onChange={() => changeScenario({ ...scenario, doors: scenario.doors.map((item) => item.id === door.id ? { ...item, enabled: !item.enabled } : item) }, `${door.id} ${door.enabled ? "disabled" : "enabled"}. Existing physical occupancy is preserved.`)} />Enabled for new assignments</label></article>;
  })}</div></section>;

  const currentView = nav.find((item) => item.id === view);
  const facility = scenario.name.split(" · ")[0];
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setSession(previous);
    if (!previous.scenario.trailers.some(trailer => trailer.id === selectedId)) inspect(previous.scenario.trailers[0]?.id ?? "");
    setHistory(history.slice(0, -1));
    setSeed(String(previous.scenario.seed));
    setNotice("Previous shift restored.");
    setError("");
  };

  const volume = scenario.volumePlan;
  const hasChuteRoutes = scenario.trailers.some(trailer => trailer.chuteRoutes !== undefined);
  const chuteMap = <>
    {!hasChuteRoutes && <div className="legacy-volume"><span>Saved shift · chute routes unavailable</span><a className="button" href="?example=chutes#chute-map">Open chute map example</a></div>}
    <div id="chute-map"><ChuteMap key={floorRevision} scenario={scenario} selectedId={selectedId} onSelect={inspect} onInspect={openTrailer} /></div>
  </>;
  const stages = [["yard", "In yard"], ["at_door", "At door"], ["expected", "Expected"], ["complete", "Completed"]] as const;
  const showProperties = view === "overview" && propertiesVisible && !!selectedRow;
  const dueOnSite = currentPickup.due ? (currentPickup.stageDue.yard + currentPickup.stageDue.at_door) / currentPickup.due * 100 : 0;
  const proposedDoors = new Set(result.recommendations.flatMap(item => item.primary ? [item.primary.doorId] : []));
  const maxZoneDemand = Math.max(1, ...floorBaseline.zones.map(zone => zone.packages));

  return <div className="shift-studio">
    <header className="studio-header">
      <a className="studio-brand" href="#main" onClick={() => setView("overview")}>
        Sortward
      </a>
      <div className="studio-file"><FileStack size={17} aria-hidden="true" /><strong>{facility}</strong><ChevronRight size={13} aria-hidden="true" /><span>Shift workspace</span></div>
      <div className="studio-command"><span className="simulation-tag"><i />Simulation</span><ShiftAnalyst scenario={scenario} mode={mode} pickup={pickup} floorPlan={floorPlan} selectedId={selectedId} onInspect={openTrailer} /></div>
    </header>
    <div className={`studio-layout${showProperties ? " has-properties" : ""}`}>
      <aside className="studio-sidebar">
        <div className="rail-area">
          <h2 className="rail-heading">Workspace</h2>
          <nav className="view-list" aria-label="Main navigation">{nav.filter(item => item.id !== "assumptions").map(({ id, title, icon: Icon }) =>
            <button key={id} type="button" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>
              <Icon size={16} strokeWidth={1.7} />{title}
            </button>
          )}</nav>
        </div>
        <div className="rail-layers">
          <h2 className="rail-heading"><Layers3 size={14} aria-hidden="true" />Trailers <span>{scenario.trailers.length}</span></h2>
          {stages.map(([stage, name]) => {
            const items = loadRows.filter(row => row.trailer.status === stage);
            return <details key={stage} open={stage === "yard"} className="layer-group">
              <summary><ChevronRight size={13} className="layer-caret" /><FolderClosed size={14} />{name}<span>{items.length}</span></summary>
              {items.map(({trailer}) => <button key={trailer.id} type="button" className="layer-row" aria-pressed={view === "overview" && trailer.id === selectedId} onClick={() => {setView("overview"); selectOnCanvas(trailer.id);}}>
                <Box size={13} strokeWidth={1.6}/>{trailer.id}
              </button>)}
              {!items.length && <small className="layer-empty">No trailers</small>}
            </details>;
          })}
        </div>
        <button type="button" className="rail-settings" aria-current={view === "assumptions" ? "page" : undefined} onClick={() => setView("assumptions")}><Settings2 size={16} />Rules &amp; scenarios</button>
      </aside>
      <label className="studio-mobile-nav"><Layers3 size={15} /><select aria-label="Workspace view" value={view} onChange={event => setView(event.target.value as View)}>
        {nav.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select><ChevronDown size={14} /></label>
      <main className="studio-canvas" id="main" ref={canvas}>
        <div className="studio-sheet" style={view === "overview" ? { "--canvas-scale": zoom / 100 } as CSSProperties : undefined}>
        <div className="page-heading">
          <h1>{currentView?.title}</h1>
          <div className="shift-clock">
            <span className="clock"><Clock3 size={15} /><span>Shift clock</span><strong>{time(scenario.nowMinute)}</strong></span>
            <button className="button clock-step" disabled={!ready || scenario.nowMinute >= 1440} onClick={() => changeScenario(advanceClock(scenario), "Shift clock advanced. Arrived trailers moved to the yard.")}>+30 min</button>
            <button className="button undo" aria-label="Undo last shift change" title="Undo last shift change" disabled={!history.length} onClick={undo}><Undo2 size={15} /></button>
          </div>
        </div>
        {(error || notice) && !drawerOpen && <div role="status" className={`notice ${error ? "notice-error" : ""}`}><span>{error || notice}</span></div>}
        {view === "overview" && <>
          {volume ? <VolumeProfile plan={volume} activePackages={result.metrics.totalPackages} reports={scenario.shiftReports} nowMinute={scenario.nowMinute} /> : <div className="legacy-volume"><span>Saved shift · facility volume unspecified</span>{hasChuteRoutes && <button className="button" onClick={() => reset(true)}>Open 600,000 package weekly example</button>}</div>}
          <div className="shift-metrics" aria-label="Shift decisions">
            <button className="metric-pickup" onClick={() => setView("priorities")}>
              <span className="metric-title">Due by {time(scenario.currentDeadlineMinute)}</span>
              <strong>{number(currentPickup.due)}</strong><span className="metric-unit">packages</span>
              <span className="metric-ring" title={`${Math.round(dueOnSite)}% already on site`} style={{background: `conic-gradient(#4a8194 0 ${dueOnSite}%, #cad9d7 ${dueOnSite}% 100%)`}} aria-hidden="true" />
            </button>
            <button className="metric-doors" onClick={() => setView("doors")}>
              <span className="metric-title">Yard assignments</span>
              <strong>{number(result.metrics.recommendationCount)}</strong><span className="metric-unit">proposed</span>
              <span className="metric-docks" aria-hidden="true">{scenario.doors.slice(0, 9).map(door => <i key={door.id} className={proposedDoors.has(door.id) ? "assigned" : ""} title={door.id} />)}</span>
            </button>
            <button className="metric-floor" onClick={() => setView("floor")}>
              <span className="metric-title">Sort shortfall</span>
              <strong>{number(floorBaseline.baseGap)}</strong><span className="metric-unit">packages</span>
              <span className="metric-bars" title="Forecast demand by zone" aria-hidden="true">{floorBaseline.zones.map(zone => <i key={zone.zone} style={{height:`${Math.max(5, zone.packages / maxZoneDemand * 100)}%`}} />)}</span>
            </button>
          </div>
          {chuteMap}
          <LoadDoorBoard scenario={scenario} rows={loadRows} selectedId={selectedId} onInspect={selectOnCanvas} />
          <div className="overview-grid">
            <section className="panel demand">
              <div className="panel-heading"><h2>Zone capacity</h2><span className="legend"><i />At door <i />Yard <i />Expected</span></div>
              <div className="zone-list">{result.zones.map((zone) =>
                <div className="zone-row" key={zone.zoneId}>
                  <div className="zone-name"><span>{zone.zoneId}</span><div><strong>{scenario.zones.find((item) => item.id === zone.zoneId)?.name}</strong><small>{number(zone.totalUnits)} of {number(zone.capacityUnits)} capacity</small></div></div>
                  <div className="zone-chart"><div className="bar">{[zone.onDoorUnits, zone.yardUnits, zone.expectedUnits].map((units, index) => <span key={index} style={{ width: `${zone.totalUnits ? units / zone.totalUnits * Math.min(zone.pressurePercent, 100) : 0}%` }} />)}</div><small>{number(zone.heldUnits)} held</small></div>
                  <strong className={zone.pressurePercent > 100 ? "over-capacity" : ""}>{Math.round(zone.pressurePercent)}%</strong>
                </div>
              )}</div>
              {!!result.metrics.unmappedPackages && <div className="panel-foot">{number(result.metrics.unmappedPackages)} packages have no mapped destination.</div>}
            </section>
            <section className="panel exceptions">
              <div className="panel-heading"><h2>Exceptions <span className="count">{result.warnings.length}</span></h2></div>
              <div className="exception-list">{result.warnings.map((warning, index) => <button key={`${warning.code}-${index}`} onClick={() => openTrailer(warning.trailerIds[0] ?? "")} className="exception"><span className={`exception-dot ${warning.severity}`} /><span><strong>{warningNames[warning.code] ?? "Placement issue"}</strong><span>{[warning.doorId, ...warning.trailerIds].filter(Boolean).join(" · ")}</span></span><ChevronRight size={15} /></button>)}{!result.warnings.length && <p className="empty">No exceptions.</p>}</div>
            </section>
          </div>
        </>}
        {view === "priorities" && <ShiftPriorityBoard window={pickup} setWindow={setPickup} scenario={scenario} evaluation={result} onInspect={openTrailer} />}
        <div hidden={view !== "floor"} key={floorRevision}>{view === "floor" && chuteMap}<SortFloorBoard scenario={scenario} plan={floorPlan} setPlan={setFloorPlan} /></div>
        {view === "queue" && queue}
        {view === "doors" && doorPlan}
        {view === "assumptions" && <div className="assumptions-grid">
          <section className="panel rules"><div className="panel-heading"><h2>Scenario</h2></div>
            <div className="command-group"><label>Preset<select aria-label="Scenario preset" value={preset} onChange={(event) => setPreset(event.target.value as Preset)}><option value="balanced">Balanced</option><option value="surge">Volume surge</option><option value="disruption">Disruption</option></select></label>
              <label className="seed-label">Seed<input aria-label="Scenario seed" value={seed} inputMode="numeric" onChange={(event) => setSeed(event.target.value)} /></label><button className="button" disabled={!ready} onClick={() => reset()}>Load scenario</button>
            </div>
            <div className="export-actions">
              <button className="button" disabled={!ready} onClick={() => changeScenario(refreshSyntheticProfiles(scenario), "Known destination profiles refreshed.")}><RefreshCw size={14} />Refresh profiles</button>
              <button className="button" onClick={() => download(JSON.stringify(session, null, 2), "sortward-synthetic-snapshot.json", "application/json")}><ArrowDownToLine size={14} />Export JSON</button>
              <button className="button" onClick={() => download(exportScenarioCsv(scenario, result), "sortward-synthetic-queue.csv", "text/csv")}><ArrowDownToLine size={14} />Export CSV</button>
              <button className="button" disabled={!ready} onClick={() => fileRef.current?.click()}><Upload size={14} />Import JSON</button>
              <input className="visually-hidden" type="file" accept=".json,application/json" ref={fileRef} aria-label="Import synthetic snapshot" onChange={(event) => void importFile(event.target.files?.[0])} />
            </div>
          </section>
          <section className="panel rules"><div className="panel-heading"><h2>Zone capacities</h2></div>
            {scenario.zones.map((zone) => <label className="capacity-field" key={`${zone.id}-${zone.capacityUnits}`}>{zone.name}<input aria-label={`Zone ${zone.id} capacity`} type="number" min="1" max="1000000" defaultValue={zone.capacityUnits} onBlur={(event) => { const value = Number(event.target.value); if (value !== zone.capacityUnits) changeScenario({ ...scenario, zones: scenario.zones.map((item) => item.id === zone.id ? { ...item, capacityUnits: value } : item) }, `Zone ${zone.id} capacity updated.`); }} /></label>)}
          </section>
          <section className="panel rules full-span"><div className="panel-heading"><h2>Door assignment rules</h2></div>
            <ol><li>Queue order sets which trailers get first pick. Deadline priority favors work due at the current pickup, then the next pickup.</li>
              <li>A trailer must be in the yard, arrived, unheld and carrying freight. Its destination profile must be at most 60 simulated minutes old.</li>
              <li>An assignment requires an enabled, empty door with compatible handling and a leading destination zone. Crossdock loads use the transfer door.</li>
              <li>Accepting an assignment rechecks the current door and records the decision. Unloading releases the door.</li></ol>
          </section>
          <section className="panel rules full-span"><div className="panel-heading"><h2>Action history <span className="count">{session.audit.length}</span></h2></div>
            {session.audit.length ? <div className="table-scroll"><table><thead><tr><th>Time</th><th>Action</th><th>Trailer</th><th>Door</th><th>Decision note</th></tr></thead><tbody>{[...session.audit].reverse().map((event, index) => <tr key={index}><td>{time(event.atMinute)}</td><td>{label(event.action)}</td><td>{event.trailerId}</td><td>{event.doorId}</td><td>{event.reason}</td></tr>)}</tbody></table></div> : <p>No assignments or completions recorded.</p>}
          </section>
        </div>}
        </div>
      </main>
      {showProperties && selectedRow && <div className="property-rail"><TrailerSummary row={selectedRow} zones={scenario.zones} onInspect={openTrailer} /></div>}
      {view === "overview" && <div className="canvas-toolbar" role="group" aria-label="Canvas controls">
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= 80} onClick={() => setZoom(value => Math.max(80, value - 10))}><Minus size={15}/></button>
        <button type="button" className="zoom-value" aria-label={`Zoom ${zoom} percent. Reset zoom`} title="Reset zoom" onClick={() => setZoom(100)}>{zoom}%</button>
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= 130} onClick={() => setZoom(value => Math.min(130, value + 10))}><Plus size={15}/></button>
        {selectedRow && <button type="button" className="toggle-properties" title={propertiesVisible ? "Hide properties" : "Show properties"} aria-label="Show trailer properties" aria-pressed={propertiesVisible} onClick={() => setPropertiesVisible(value => !value)}><PanelRight size={16}/></button>}
      </div>}
    </div>
        <dialog className="trailer-drawer" ref={drawer} aria-label="Trailer decision" onClose={() => setDrawerOpen(false)}>
          {drawerOpen && <><div className="drawer-top"><strong>Trailer decision</strong><button type="button" className="button" autoFocus onClick={() => drawer.current?.close()}>Close</button></div>
            {inspector}
            {(error || notice) && <p className="drawer-status" role="status">{error || notice}</p>}
            <div className="drawer-links"><button className="button" onClick={() => leaveDrawer("doors")}>Open door plan</button><button className="button" onClick={() => leaveDrawer("floor")}>Review sort floor</button></div>
          </>}
        </dialog>
  </div>;
}
