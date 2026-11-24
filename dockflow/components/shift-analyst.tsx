"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronRight, RotateCcw, Sparkles, X } from "lucide-react";
import { usesSampleIdentities } from "@/lib/analyst-eligibility";
import { MAX_PRIOR_QUESTIONS, MAX_PRIOR_EVIDENCE_IDS, type AnalystContext } from "@/lib/analyst-context";
import { buildChuteMap } from "@/lib/chute-routing";
import type { Scenario, PlanMode, TrailerStatus } from "@/lib/dock-types";
import type { FloorPlan } from "@/lib/sort-floor";
import type { PickupWindow } from "@/lib/shift-priorities";
import "./shift-workspace.css";

type Citation = { id: string; label: string; text: string; trailerId?: string };
type Answer = { question: string; answer: string; citations: Citation[] };
type Props = {
  scenario: Scenario;
  mode: PlanMode;
  floorPlan: FloorPlan;
  pickup: PickupWindow;
  context: AnalystContext;
  onInspect: (id: string) => void;
};

function isCitation(value: unknown): value is Citation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Citation>;
  return typeof item.id === "string" && typeof item.label === "string" && typeof item.text === "string"
    && (item.trailerId === undefined || typeof item.trailerId === "string");
}

const viewNames = {
  overview: "Shift heatmap", priorities: "Pickup priorities", floor: "Sort floor",
  queue: "Trailer directory", doors: "Door plan", assumptions: "Rules and scenarios",
};
const locations: Record<TrailerStatus, string> = {
  expected: "Expected", yard: "In yard", at_door: "At door", complete: "Completed",
};
const clock = (minute: number) =>
  [Math.floor(minute / 60), minute % 60].map(part => String(part).padStart(2, "0")).join(":");

function scopeLabel({ scenario, context, pickup, mode }: Props) {
  const { chute, view } = context;
  const parts = [viewNames[view]];
  if (chute) {
    if (chute.trailerId) parts.push(chute.trailerId);
    else {
      const stages = chute.statuses;
      const active = !stages || (stages.length === 3 && !stages.includes("complete"));
      parts.push(active ? "Active trailers" : stages.length ? stages.map(stage => locations[stage]).join(", ") : "No locations");
    }
    if (chute.zoneId) parts.push(scenario.zones.find(zone => zone.id === chute.zoneId)?.name ?? chute.zoneId);
    if (chute.chuteId) parts.push(chute.chuteId);
  }
  if (view === "priorities") {
    parts.push(clock(pickup === "current" ? scenario.currentDeadlineMinute : scenario.nextDeadlineMinute) + " pickup");
    if (context.pickupStage) parts.push(locations[context.pickupStage]);
  } else if (view === "doors" || view === "queue") {
    parts.push(mode === "arrival" ? "Arrival order" : "Deadline priority");
    if (context.queue) {
      const status = context.queue.status;
      if (status) parts.push(status === "high" ? "High priority" : locations[status]);
      const count = context.queue.trailerIds.length;
      parts.push(count === 1 ? context.queue.trailerIds[0] : count + " trailers");
    } else if (context.selectedTrailerId) parts.push(context.selectedTrailerId);
  }
  parts.push("Shift " + clock(scenario.nowMinute));
  return parts.join(" · ");
}

function suggestedQuestions({ scenario, context, pickup }: Props) {
  const { chute, view, selectedTrailerId } = context;
  if (view === "floor") return [
    "Which single staffing move would reduce the next hour’s shortfall most? What would it cost the other zone?",
    "How much freight is missing from this forecast, and could that change the staffing decision?",
  ];
  if (view === "priorities" && context.pickupStage === "expected") return [
    "Which expected trailer puts the most packages at risk for this pickup, and when is it due to arrive?",
    "Which expected load should I prepare a door for first? What has to happen before it can unload?",
  ];
  if (view === "priorities") return [
    `Which trailer should get a door first for the ${clock(pickup === "current" ? scenario.currentDeadlineMinute : scenario.nextDeadlineMinute)} pickup, and why?`,
    "Which load is most at risk of missing this pickup, and what can the shift lead do about it?",
  ];
  if (view === "queue" && context.queue && !context.queue.trailerIds.length) return [
    "Why are there no trailers in this selection, and which filter should I check?",
  ];
  const trailer = view === "queue" && context.queue
    ? context.queue.trailerIds.find(id => id === selectedTrailerId) ?? context.queue.trailerIds[0]
    : selectedTrailerId;
  if (view === "queue" || view === "doors") return [
    trailer ? `Would you assign ${trailer} now or let another trailer go first? Why?` : "Which yard trailer should get the next compatible door?",
    "Which preassigned door needs a different plan, and what would you do instead?",
  ];
  if (view === "assumptions") return [
    "Which assumptions have the biggest effect on the next staffing decision?",
    "What information is missing before we can trust the next door recommendation?",
  ];
  if (chute?.chuteId) return [
    `Which trailer contributes most to ${chute.chuteId} in this view, and what should I check before unloading it?`,
    `What can the manifests tell us about ${chute.chuteId}, and what would require a scan?`,
  ];
  const map = buildChuteMap(scenario, chute);
  const busiest = map.zones.filter(zone => !chute?.zoneId || zone.id === chute.zoneId)
    .flatMap(zone => zone.chutes).filter(item => item.packages > 0)
    .sort((a, b) => b.packages - a.packages || a.id.localeCompare(b.id)).slice(0, 2);
  return [
    busiest.length === 2
      ? `Compare ${busiest[0].id} and ${busiest[1].id}. Which trailers explain the difference?`
      : "What limits our view of chute demand for these trailers?",
    "Which missing or outdated manifests should I review first?",
  ];
}

export function ShiftAnalyst(props: Props) {
  const { scenario, mode, floorPlan, pickup, context, onInspect } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pending = useRef<AbortController | null>(null);
  const scopeKey = JSON.stringify(context);
  const lastScope = useRef({ scenario, mode, floorPlan, pickup, scopeKey });
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Answer[]>([]);
  const [starters, setStarters] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const panel = dialog.current;
    return () => {
      pending.current?.abort();
      if (panel?.open) panel.close();
    };
  }, [scenario, mode, floorPlan, pickup, scopeKey]);
  useEffect(() => {
    if (dialog.current?.open && content.current) content.current.scrollTop = content.current.scrollHeight;
  }, [turns, busy, error]);

  function reset() {
    setTurns([]);
    setQuestion("");
    setError("");
    input.current?.focus();
  }
  function open() {
    const old = lastScope.current;
    if (old.scenario !== scenario || old.mode !== mode || old.floorPlan !== floorPlan || old.pickup !== pickup || old.scopeKey !== scopeKey) reset();
    lastScope.current = { scenario, mode, floorPlan, pickup, scopeKey };
    setStarters(suggestedQuestions(props));
    dialog.current?.showModal();
    input.current?.focus();
  }
  function cancel() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
  }
  async function ask(prompt: string) {
    const value = prompt.trim();
    if (!value || value.length > 600 || pending.current) return;
    if (!usesSampleIdentities(scenario)) {
      setError("Open a sample shift to use the analyst. Custom facility and trailer identities stay in this browser.");
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setQuestion(value);
    setError("");
    setBusy(true);
    try {
      const recent = turns.slice(-MAX_PRIOR_QUESTIONS);
      const priorQuestions = recent.map(turn => turn.question);
      const citedIds = recent.reverse().flatMap(turn => turn.citations.map(item => item.id));
      const priorEvidenceIds = [...new Set(citedIds)].slice(0, MAX_PRIOR_EVIDENCE_IDS);
      const res = await fetch("/api/shift-analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: value, scenario, mode, floorPlan, pickup, context, priorQuestions, priorEvidenceIds }),
        signal: controller.signal,
      });
      const body: unknown = await res.json();
      const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "The analyst is unavailable. Try again shortly.");
      const { answer, citations } = data;
      if (typeof answer !== "string" || !Array.isArray(citations) || !citations.every(isCitation)) {
        throw new Error("The analyst returned an unreadable answer. Try again.");
      }
      if (pending.current === controller) {
        setTurns(previous => [...previous, { question: value, answer, citations }]);
        setQuestion("");
        input.current?.focus();
      }
    } catch (issue) {
      if (!controller.signal.aborted) setError(issue instanceof Error && issue.name !== "SyntaxError" && issue.name !== "TypeError" ? issue.message : "Couldn’t reach the analyst. Try again.");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return <>
    <button type="button" className="ask-trigger" onClick={open}><Sparkles size={15} aria-hidden="true" />Ask Sortward</button>
    <dialog className="analyst-dialog" ref={dialog} onClose={cancel} aria-labelledby="analyst-title" aria-describedby="analyst-scope">
      <header className="analyst-head">
        <div><h2 id="analyst-title">Shift analyst</h2><p id="analyst-scope">{scopeLabel(props)}</p></div>
        <div className="analyst-actions">
          {turns.length > 0 && <button type="button" aria-label="Start new conversation" title="Start new conversation" disabled={busy} onClick={reset}><RotateCcw size={16} /></button>}
          <button type="button" aria-label="Close analyst" onClick={() => dialog.current?.close()}><X size={18} /></button>
        </div>
      </header>
      <div className="analyst-scroll" ref={content}>
        {!turns.length && !busy && <div className="analyst-starters">{starters.map(item =>
          <button key={item} type="button" onClick={() => void ask(item)}>{item}<ChevronRight size={15} aria-hidden="true" /></button>)}</div>}
        <div className="analyst-thread" role="log" aria-label="Shift conversation" aria-live="polite" aria-relevant="additions">
          {turns.map((turn, index) => <article key={index + turn.question}>
            <p className="analyst-question">{turn.question}</p>
            <p className="analyst-answer">{turn.answer}</p>
            {turn.citations.length > 0 && <details className="analyst-sources">
              <summary>{turn.citations.length} shift {turn.citations.length === 1 ? "record" : "records"}</summary>
              {turn.citations.map(item => <section key={item.id}><h3>{item.label}</h3><p>{item.text}</p>
                {item.trailerId && <button type="button" onClick={() => { dialog.current?.close(); onInspect(item.trailerId!); }}>Inspect {item.trailerId}<ChevronRight size={13} aria-hidden="true" /></button>}
              </section>)}
            </details>}
          </article>)}
        </div>
        {busy && <div><p className="analyst-question">{question}</p><p className="analyst-pending" role="status">Checking shift records…</p></div>}
        {error && <p className="analyst-error" role="alert">{error}</p>}
      </div>
      <footer className="analyst-compose">
        <form className="analyst-form" onSubmit={event => { event.preventDefault(); void ask(question); }}>
          <textarea id="shift-question" aria-label="Question about the current shift" ref={input} maxLength={600} rows={2}
            placeholder={turns.length ? "Ask a follow-up…" : "Ask about this shift…"} value={busy ? "" : question} readOnly={busy}
            onChange={event => setQuestion(event.target.value)} onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(question); }
            }} />
          <button type="submit" disabled={busy || !question.trim()} aria-label="Send question"><ArrowUp size={18} /></button>
        </form>
        <small>OpenAI · 30 requests per day across the demo</small>
      </footer>
    </dialog>
  </>;
}
