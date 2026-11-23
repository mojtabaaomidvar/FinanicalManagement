import { useEffect, useRef, useState } from "react";
import type { UseCases } from "@/application/useCases";
import type { AssistantCapabilities, AssistantOutcome } from "@/domain/assistant/assistant.types";
import type { ContextSession, PendingAction, PreparedAction, PrepareActionFields } from "@/domain/assistant/contextual.types";
import { assistantCapabilities, assistantDraftKey } from "./assistant";
import { restoredContextSession, validActionReceipt, validContextResult, validPreparedAction } from "./contextual";
import { AppError } from "@/shared/lib/appError";

const emptySession = (): ContextSession => ({ result: null, pending: null, receipts: {} });

export function useHouseholdAssistant(useCases: UseCases, familyId: string, memberId: string, offline: boolean) {
  const key = assistantDraftKey(familyId, memberId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [capabilities, setCapabilities] = useState<AssistantCapabilities | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [session, setSession] = useState<ContextSession>(emptySession);
  const [actionBusy, setActionBusy] = useState(false);
  const [review, setReview] = useState<PreparedAction | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, "reviewing" | AssistantOutcome>>({});
  const generation = useRef(0), capabilityGeneration = useRef(0), edits = useRef(0), pending = useRef(false);
  const actionLock = useRef(false), sessionRef = useRef(session);
  const reviewFor = useRef<string | null>(null);
  sessionRef.current = session;
  const latest = useRef({ key, offline, useCases });
  if (latest.current.key !== key || latest.current.useCases !== useCases || latest.current.offline !== offline) {
    generation.current++; capabilityGeneration.current++;
  }
  latest.current = { key, offline, useCases };
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; generation.current++; capabilityGeneration.current++; }, []);
  useEffect(() => {
    const invalidate = () => { generation.current++; capabilityGeneration.current++; };
    window.addEventListener("offline", invalidate);
    return () => window.removeEventListener("offline", invalidate);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const revision = edits.current;
    const requestKey = key;
    setText(""); setSession(emptySession()); setReview(null); reviewFor.current = null; setActionBusy(false); setOutcomes({}); setOpen(false); setBusy(false); setError(null); setStorageError(false);
    generation.current++;
    void useCases.assistantDraft.read(key).then(draft => {
      if (!mounted.current || latest.current.key !== requestKey || latest.current.useCases !== useCases || edits.current !== revision) return;
      if (draft && typeof draft.text === "string" && ["auto", "finance", "shopping", "tasks"].includes(draft.scope)) {
        setText(draft.text.slice(0, 8000));
        const stored = restoredContextSession(draft.session);
        if (stored) { sessionRef.current = stored; setSession(stored); }
      }
    }).catch(() => { if (mounted.current && latest.current.key === requestKey) setStorageError(true); });
  }, [key, useCases]);

  async function checkCapabilities() {
    if (latest.current.offline) return;
    const request = ++capabilityGeneration.current;
    setChecking(true); setCapabilities(null);
    try {
      const value = await useCases.assistantCapabilities.execute();
      if (mounted.current && capabilityGeneration.current === request)
        setCapabilities(assistantCapabilities(value));
    } catch {
      if (mounted.current && capabilityGeneration.current === request)
        setCapabilities({ status: "unavailable", protocol_version: null, kinds: [] });
    } finally {
      if (mounted.current && capabilityGeneration.current === request) setChecking(false);
    }
  }
  useEffect(() => {
    generation.current++;
    capabilityGeneration.current++;
    if (!offline) void checkCapabilities();
    else { setChecking(false); setCapabilities(null); }
  }, [offline, key, useCases]);

  const isCurrent = (requestKey: string, request?: number) => mounted.current && latest.current.key === requestKey && latest.current.useCases === useCases
    && (request === undefined || generation.current === request);
  async function store(next: ContextSession, requestKey = key, requestText = text) {
    // Financial forms retain their existing lifetime; do not resurrect a possibly
    // saved financial proposal after reload without a new explicit analysis.
    const persisted = { ...next, result: next.result ? { ...next.result, proposals: [] } : null };
    await useCases.assistantDraft.write(requestKey, { text: requestText, scope: "auto", session: persisted });
  }
  function change(next: string) {
    if (actionLock.current || sessionRef.current.pending) return;
    edits.current++; generation.current++;
    setText(next); setError(null); setSession(emptySession()); setReview(null); reviewFor.current = null; setOutcomes({});
    const revision = edits.current;
    void useCases.assistantDraft.write(key, { text: next, scope: "auto" }).then(() => {
      if (mounted.current && edits.current === revision) setStorageError(false);
    }).catch(() => { if (mounted.current && edits.current === revision) setStorageError(true); });
  }
  async function analyze() {
    if (pending.current || actionLock.current || sessionRef.current.pending || offline || capabilities?.status !== "ready") return;
    if (!text.trim()) { setError("بنویس چه کاری برای خانه داری."); return; }
    if (text.length > 8000) { setError("متن را کوتاه‌تر کن؛ حداکثر ۸۰۰۰ نویسه در هر نوبت."); return; }
    pending.current = true; setBusy(true); setError(null); setSession(emptySession()); setReview(null); setOutcomes({});
    const request = ++generation.current, requestKey = key;
    try {
      const value = await useCases.contextualHousehold.report(text);
      if (!mounted.current || request !== generation.current || latest.current.key !== requestKey || latest.current.offline) return;
      if (!validContextResult(value)) throw new Error("نتیجهٔ دستیار قابل‌استفاده نبود؛ دوباره تلاش کن.");
      const next = { ...emptySession(), result: value };
      setSession(next);
      try { await store(next, requestKey); }
      catch { if (isCurrent(requestKey, request)) setStorageError(true); }
    } catch (cause) {
      if (mounted.current && request === generation.current) setError(cause instanceof Error ? cause.message : "بررسی درخواست انجام نشد؛ متن باقی مانده است.");
    } finally {
      pending.current = false;
      if (mounted.current && latest.current.key === requestKey) setBusy(false);
    }
  }
  async function prepare(actionId: string, fields: PrepareActionFields) {
    const current = sessionRef.current;
    if (actionLock.current || current.pending || offline || !current.result || current.receipts[actionId]) return;
    const candidate = current.result.actions.find(action => action.id === actionId);
    if (!candidate) return;
    actionLock.current = true; setActionBusy(true); setReview(null); setError(null);
    const requestKey = key, request = generation.current;
    try {
      const value = await useCases.contextualHousehold.prepare(current.result.report_token, actionId, fields);
      if (!isCurrent(requestKey, request) || latest.current.offline) return;
      if (!validPreparedAction(value) || value.kind !== candidate.kind) throw new Error("خلاصهٔ تغییر معتبر نیست؛ دوباره بررسی کن.");
      reviewFor.current = actionId; setReview(value);
    } catch (cause) {
      if (isCurrent(requestKey, request)) setError(cause instanceof Error ? cause.message : "بررسی تغییر انجام نشد.");
    } finally {
      actionLock.current = false;
      if (isCurrent(requestKey)) setActionBusy(false);
    }
  }
  async function execute(actionId: string, resume = false) {
    const current = sessionRef.current;
    const confirmedReview = resume ? current.pending?.review : review;
    if (actionLock.current || current.pending && !resume || offline || !confirmedReview || current.receipts[actionId]) return;
    if (resume ? current.pending?.action_id !== actionId : reviewFor.current !== actionId
      || !current.result?.actions.some(action => action.id === actionId && action.kind === confirmedReview.kind)) return;
    actionLock.current = true; setActionBusy(true); setError(null);
    const requestKey = key, request = generation.current;
    const operation: PendingAction = { action_id: actionId, review: confirmedReview };
    const next = { ...current, pending: operation };
    try {
      // A lost response remains recoverable after reload. Never write before this is durable.
      await store(next, requestKey);
      if (!isCurrent(requestKey, request) || latest.current.offline) {
        actionLock.current = false;
        if (isCurrent(requestKey)) { setActionBusy(false); setSession(next); }
        return;
      }
      sessionRef.current = next; setSession(next);
    } catch {
      if (isCurrent(requestKey, request)) { setStorageError(true); setError("بازیابی نتیجه در این مرورگر ماندگار نشد؛ تغییری ارسال نکردیم."); }
      actionLock.current = false;
      if (isCurrent(requestKey)) setActionBusy(false);
      return;
    }
    try {
      const value = await useCases.contextualHousehold.execute(confirmedReview.review_token);
      if (!validActionReceipt(value) || value.operation_id !== confirmedReview.operation_id || value.kind !== confirmedReview.kind)
        throw new Error("نتیجهٔ ثبت روشن نیست؛ نتیجهٔ قبلی را بررسی کن.");
      if (!isCurrent(requestKey)) return;
      const saved = { ...current, pending: null, receipts: { ...current.receipts, [actionId]: value } };
      sessionRef.current = saved; setSession(saved); setReview(null);
      try { await store(saved, requestKey); } catch { if (isCurrent(requestKey)) setStorageError(true); }
      return value;
    } catch (cause) {
      if (isCurrent(requestKey)) {
        setError(cause instanceof Error ? cause.message : "پاسخ ثبت دریافت نشد؛ پیش از ادامه نتیجهٔ قبلی را بررسی کن.");
        // A proxy timeout/client-close response is not proof that the database
        // write was rejected. Keep its exact operation identity for recovery.
        if (cause instanceof AppError && cause.status && cause.status >= 400 && cause.status < 500
          && cause.status !== 408 && cause.status !== 499) {
          const rejected = { ...current, pending: null };
          sessionRef.current = rejected; setSession(rejected); setReview(null);
          try { await store(rejected, requestKey); } catch { if (isCurrent(requestKey)) setStorageError(true); }
        }
      }
    } finally {
      actionLock.current = false;
      if (isCurrent(requestKey)) setActionBusy(false);
    }
  }
  async function recover() {
    const current = sessionRef.current, operation = current.pending;
    if (actionLock.current || !operation || offline) return;
    actionLock.current = true; setActionBusy(true); setError(null);
    const requestKey = key;
    try {
      const value = await useCases.contextualHousehold.receipt(operation.review.operation_id);
      if (!validActionReceipt(value) || value.operation_id !== operation.review.operation_id || value.kind !== operation.review.kind)
        throw new Error("نتیجهٔ قبلی معتبر نیست؛ تغییری دوباره ارسال نکردیم.");
      if (!isCurrent(requestKey)) return;
      const saved = { ...current, pending: null, receipts: { ...current.receipts, [operation.action_id]: value } };
      sessionRef.current = saved; setSession(saved); setReview(null);
      try { await store(saved, requestKey); } catch { if (isCurrent(requestKey)) setStorageError(true); }
      return value;
    } catch (cause) {
      if (isCurrent(requestKey)) setError(cause instanceof Error ? cause.message : "نتیجه هنوز روشن نیست؛ تغییر را دوباره ارسال نکردیم.");
    } finally {
      actionLock.current = false;
      if (isCurrent(requestKey)) setActionBusy(false);
    }
  }
  function mark(id: string, outcome?: "reviewing" | AssistantOutcome) {
    setOutcomes(previous => {
      if (previous[id] === "saved" && outcome === "queued") return previous;
      if (!outcome && previous[id] !== "reviewing") return previous;
      const next = { ...previous };
      if (outcome) next[id] = outcome; else delete next[id];
      return next;
    });
  }
  return { open, text, capabilities, checking, busy, error, storageError, result: session.result, outcomes,
    actionBusy, review, receipts: session.receipts, pendingAction: session.pending,
    change, analyze, prepare, execute, recover, cancelReview: () => { reviewFor.current = null; setReview(null); },
    resume: () => session.pending ? execute(session.pending.action_id, true) : Promise.resolve(undefined),
    checkCapabilities, mark, close: () => setOpen(false), show: (_route?: string) => setOpen(true) };
}
export type HouseholdAssistantModel = ReturnType<typeof useHouseholdAssistant>;
