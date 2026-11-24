"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronRight, Sparkles, X } from "lucide-react";
import { usesSampleIdentities } from "@/lib/analyst-eligibility";
import type { Scenario, PlanMode } from "@/lib/dock-types";
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
  selectedId?: string;
  onInspect: (id: string) => void;
};

export function ShiftAnalyst({ scenario, mode, floorPlan, pickup, selectedId, onInspect }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<AbortController | null>(null);
  const lastContext = useRef({ scenario, mode, floorPlan, pickup });
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => pending.current?.abort(), []);

  function open() {
    const old = lastContext.current;
    if (old.scenario !== scenario || old.mode !== mode || old.floorPlan !== floorPlan || old.pickup !== pickup) {
      setAnswer(null);
      setQuestion("");
      setError("");
    }
    lastContext.current = { scenario, mode, floorPlan, pickup };
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
      setError("Use a sample shift to ask the analyst. Custom facility and trailer identities stay in this browser.");
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setQuestion(value);
    setError("");
    setAnswer(null);
    setBusy(true);
    try {
      const res = await fetch("/api/shift-analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: value, scenario, mode, floorPlan, pickup }),
        signal: controller.signal,
      });
      const valueFromServer: unknown = await res.json();
      const data = valueFromServer && typeof valueFromServer === "object" ? valueFromServer as Partial<Answer> & { error?: string } : {};
      if (!res.ok) throw new Error(data.error || "The analyst is unavailable. Try again shortly.");
      if (typeof data.answer !== "string" || !Array.isArray(data.citations)) throw new Error("The analyst returned an unreadable answer. Try again.");
      if (pending.current === controller) {
        setAnswer({ question: value, answer: data.answer, citations: data.citations });
        setQuestion("");
      }
    } catch (issue) {
      if (!controller.signal.aborted) setError(issue instanceof Error && issue.name !== "SyntaxError" && issue.name !== "TypeError" ? issue.message : "Couldn’t reach the analyst. Try again.");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }
  const trailerQuestion = selectedId && /^TR-1(?:0[1-9]|1[0-2])$/.test(selectedId)
    ? `Which door fits ${selectedId}, and why?` : "Which door assignments need review?";
  const starters = ["Which yard trailer should we unload next?", trailerQuestion, "Which chute has the most inbound packages?"];

  return <>
    <button type="button" className="ask-trigger" onClick={open}><Sparkles size={15} aria-hidden="true" />Ask Sortward</button>
    <dialog className="analyst-dialog" ref={dialog} onClose={cancel} aria-labelledby="analyst-title">
      <header className="analyst-head"><div><Sparkles size={18} aria-hidden="true" /><h2 id="analyst-title">Shift analyst</h2></div><button aria-label="Close analyst" className="analyst-close" onClick={() => dialog.current?.close()}><X size={18} /></button></header>
      <div className="analyst-body">
        {!answer && !busy && <div className="analyst-starters">{starters.map(item => <button key={item} type="button" onClick={() => ask(item)}>{item}<ChevronRight size={15} /></button>)}</div>}
        <div aria-live="polite" aria-atomic="true">
          {busy && <p className="analyst-pending" role="status">Checking shift records…</p>}
          {error && <p className="analyst-error" role="alert">{error}</p>}
          {answer && <article><p className="analyst-question">{answer.question}</p><p className="analyst-answer">{answer.answer}</p>
            {!!answer.citations.length && <div className="analyst-evidence"><h3>Shift records</h3>{answer.citations.map(item => <details key={item.id}><summary>{item.label}</summary><p>{item.text}</p>{item.trailerId && <button onClick={() => { dialog.current?.close(); onInspect(item.trailerId!); }}>Inspect {item.trailerId}<ChevronRight size={13} /></button>}</details>)}</div>}
          </article>}
        </div>
        <form className="analyst-form" onSubmit={e => { e.preventDefault(); ask(question); }}>
          <label className="sr-only" htmlFor="shift-question">Question about the current shift</label>
          <textarea id="shift-question" ref={input} maxLength={600} rows={2} placeholder="Ask about this shift…" value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(question); } }} />
          <button type="submit" disabled={busy || !question.trim()} aria-label="Send question"><ArrowUp size={18} /></button>
        </form>
        <small className="analyst-limit">OpenAI · 30 requests per day across the demo</small>
      </div>
    </dialog>
  </>;
}
