import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { Pet, PetCareInput, PetCareTask, PetDetail, PetInput } from "@/domain/pet/pet.types";
import { petCareError, petError } from "@/domain/pet/pet.rules";
import { isTaskAssignee } from "@/features/tasks/model/taskPresentation";
import { AppError, isAppError } from "@/shared/lib/appError";
import { formatISO, isoToJalali, jalaliToIso, parse } from "@/shared/lib/jalali";
import { useOnline } from "@/shared/lib/useOnline";
import { PetSession, type PetTicket } from "./petSession";
import { PetCareOperation } from "./petCareOperation";
import { filterPetCare, filterPets } from "./petPresentation";

interface PetForm { name: string; species: string; breed: string; birthDate: string }
interface CareForm { title: string; assigneeId: string; dueDate: string }
type Dialog = { ticket: PetTicket } & (
  | { kind: "profile"; pet: Pet | null }
  | { kind: "care"; pet: Pet }
  | { kind: "delete"; pet: Pet }
);
const emptyForm = (): PetForm => ({ name: "", species: "", breed: "", birthDate: "" });
const emptyCare = (): CareForm => ({ title: "", assigneeId: "", dueDate: "" });
const messageOf = (error: unknown) => error instanceof Error ? error.message : "انجام عملیات ناموفق بود. دوباره تلاش کنید.";
const dateValue = (value: string): string | null => {
  if (!value.trim()) return null;
  const day = parse(value);
  if (!day) throw new Error("تاریخ معتبر را انتخاب کنید.");
  return jalaliToIso(day);
};
const connected = () => typeof navigator === "undefined" || navigator.onLine !== false;

export function usePetsModel(onChanged?: () => void | Promise<void>) {
  const { phase, member, members, family, useCases, shoppingSync, offlineSession, refreshTasks } = useApp();
  const { show } = useToast();
  const online = useOnline();
  const available = phase === "ready" && member?.status === "active" && member.membershipState === "active"
    && Boolean(family && useCases) && online && !shoppingSync.offline && !offlineSession;
  const scope = available ? `${member!.id}:${family!.id}:${member!.role}` : "";
  const session = useRef(new PetSession()).current;
  session.setScope(scope);
  const careOperation = useRef(new PetCareOperation()).current;
  const mounted = useRef(true);
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const pending = useRef(false);
  const changed = useRef(onChanged); changed.current = onChanged;
  const [snapshot, setSnapshot] = useState<{ ticket: PetTicket | null; pets: Pet[]; canCreate: boolean }>({ ticket: null, pets: [], canCreate: false });
  const [detail, setDetail] = useState<{ ticket: PetTicket; value: PetDetail } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [form, setForm] = useState<PetForm>(emptyForm);
  const [careForm, setCareForm] = useState<CareForm>(emptyCare);
  const [query, setQuery] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [conflict, setConflict] = useState(false);
  const current = useCallback((ticket: PetTicket) => mounted.current && session.isCurrent(ticket), [session]);
  const hasSnapshot = available && !accessDenied && snapshot.ticket !== null && session.isCurrent(snapshot.ticket);
  const pets = hasSnapshot ? snapshot.pets : [];
  const canCreate = hasSnapshot && snapshot.canCreate;
  const visible = useMemo(() => filterPets(pets, query), [pets, query]);
  const detailValue = available && !accessDenied && detail && session.isCurrent(detail.ticket) ? detail.value : null;
  const activeDialog = available && !accessDenied && dialog && session.isCurrent(dialog.ticket)
    && (dialog.kind === "profile" && !dialog.pet ? canCreate
      : dialog.kind === "care" ? detailValue?.pet.id === dialog.pet.id && detailValue.canCreateCare
      : dialog.kind === "delete" ? pets.find((pet) => pet.id === dialog.pet.id)?.canDelete
      : pets.find((pet) => pet.id === dialog.pet?.id)?.canEdit) ? dialog : null;
  const assignees = available && !accessDenied && family ? members.filter((row) => row.familyId === family.id && isTaskAssignee(row)) : [];
  const careTasks = detailValue ? filterPetCare(detailValue.careTasks, showCompleted) : [];

  const clearForm = useCallback(() => {
    setDialog(null); setForm(emptyForm()); setCareForm(emptyCare()); setFormError(""); setConflict(false); careOperation.reset();
  }, [careOperation]);
  const forget = useCallback(() => {
    listSequence.current += 1; detailSequence.current += 1; pending.current = false;
    setSnapshot({ ticket: null, pets: [], canCreate: false }); setDetail(null); clearForm();
    setQuery(""); setShowCompleted(false); setBusy(false); setDetailLoading(false);
  }, [clearForm]);
  const deny = useCallback((error: unknown) => {
    if (!isAppError(error) || ![401, 403, 404].includes(error.status ?? 0)
      && !["SESSION_EXPIRED", "FORBIDDEN", "NOT_FOUND"].includes(error.code)) return false;
    session.invalidate(); forget(); setAccessDenied(true); setLoadError(messageOf(error)); setLoading(false);
    return true;
  }, [session, forget]);
  const reload = useCallback(async () => {
    if (!scope || !useCases || !connected()) return;
    const ticket = session.capture(); const request = ++listSequence.current;
    detailSequence.current += 1; setDetail(null); setDetailLoading(false); setLoading(true); setLoadError("");
    try {
      const result = await useCases.listPets.execute();
      if (!current(ticket) || listSequence.current !== request) return;
      setSnapshot({ ticket, pets: result.pets, canCreate: result.canCreate }); setAccessDenied(false);
    } catch (error) {
      if (!current(ticket) || listSequence.current !== request) return;
      if (!deny(error)) { forget(); setLoadError(messageOf(error)); setLoading(false); }
    } finally { if (current(ticket) && listSequence.current === request) setLoading(false); }
  }, [scope, useCases, session, current, deny, forget]);
  const readDetail = useCallback(async (id: string) => {
    if (!useCases || !scope || !connected()) return;
    const ticket = session.capture(); const request = ++detailSequence.current;
    setDetail(null); setDetailLoading(true); setLoadError("");
    try {
      const value = await useCases.getPet.execute(id);
      if (!current(ticket) || detailSequence.current !== request) return;
      setSnapshot((previous) => ({ ticket, canCreate: previous.canCreate, pets: [value.pet, ...previous.pets.filter((pet) => pet.id !== value.pet.id)] }));
      setDetail({ ticket, value });
    } catch (error) { if (current(ticket) && detailSequence.current === request && !deny(error)) setLoadError(messageOf(error)); }
    finally { if (current(ticket) && detailSequence.current === request) setDetailLoading(false); }
  }, [useCases, scope, session, current, deny]);

  useEffect(() => {
    mounted.current = true; session.setScope(scope);
    return () => { mounted.current = false; session.close(); listSequence.current += 1; detailSequence.current += 1; careOperation.reset(); };
  }, [session, careOperation]);
  useEffect(() => {
    forget(); setAccessDenied(false); setLoadError("");
    if (scope) void reload(); else setLoading(false);
  }, [scope, reload, forget]);
  useEffect(() => {
    const disconnect = () => { session.invalidate(); forget(); setLoading(false); };
    const reconnect = () => { session.invalidate(); forget(); if (scope) void reload(); };
    window.addEventListener("offline", disconnect); window.addEventListener("online", reconnect);
    return () => { window.removeEventListener("offline", disconnect); window.removeEventListener("online", reconnect); };
  }, [session, forget, scope, reload]);
  useEffect(() => { if (hasSnapshot && dialog && !activeDialog) clearForm(); }, [hasSnapshot, dialog, activeDialog, clearForm]);

  const openDetail = (id: string) => {
    if (!available || busy || loading || accessDenied || !hasSnapshot || !connected()) return;
    setShowCompleted(false); void readDetail(id);
  };
  const openProfile = (pet: Pet | null) => {
    if (!available || busy || accessDenied || !connected() || (pet ? !pet.canEdit : !canCreate)) return;
    detailSequence.current += 1; setDetail(null); setDetailLoading(false); clearForm();
    setForm(pet ? { name: pet.name, species: pet.species, breed: pet.breed ?? "", birthDate: pet.birthDate ? formatISO(isoToJalali(pet.birthDate)) : "" } : emptyForm());
    setDialog({ ticket: session.capture(), kind: "profile", pet });
  };
  const openCare = () => {
    if (!available || !detailValue?.canCreateCare || busy || accessDenied || !connected()) return;
    clearForm(); setCareForm({ title: "", assigneeId: assignees.some((row) => row.id === member?.id) ? member!.id : "", dueDate: "" });
    setDialog({ ticket: session.capture(), kind: "care", pet: detailValue.pet });
  };
  const openDelete = (pet: Pet) => {
    if (!available || busy || accessDenied || !connected() || !pet.canDelete) return;
    clearForm(); setDialog({ ticket: session.capture(), kind: "delete", pet });
  };
  const mutate = async (action: (ticket: PetTicket) => Promise<unknown>, success: string, focusId?: string) => {
    if (!available || accessDenied || pending.current || !connected()) return;
    const ticket = session.capture(); pending.current = true; setBusy(true); setFormError(""); setLoadError("");
    try {
      await action(ticket); if (!current(ticket)) return;
      clearForm(); show(success); window.dispatchEvent(new Event("pets-changed"));
      await Promise.resolve(changed.current?.()).catch(() => undefined);
      if (!current(ticket)) return;
      await reload(); if (focusId && current(ticket)) await readDetail(focusId);
    } catch (error) {
      if (!current(ticket)) return;
      if (!deny(error)) { setFormError(messageOf(error)); setLoadError(messageOf(error)); setConflict(isAppError(error) && (error.code === "CONFLICT" || error.status === 409)); }
    } finally { if (current(ticket)) { pending.current = false; setBusy(false); } }
  };
  const saveProfile = () => {
    if (!useCases || activeDialog?.kind !== "profile") return;
    try {
      const input: PetInput = { name: form.name, species: form.species, breed: form.breed, birthDate: dateValue(form.birthDate) };
      const error = petError(input); if (error) { setFormError(error); return; }
      const pet = activeDialog.pet;
      void mutate(() => pet ? useCases.updatePet.execute(pet.id, input, pet.revision) : useCases.addPet.execute(input), "مشخصات حیوان ذخیره شد.", pet?.id);
    } catch (error) { setFormError(messageOf(error)); }
  };
  const saveCare = () => {
    if (!useCases || activeDialog?.kind !== "care") return;
    try {
      const input: PetCareInput = { title: careForm.title, assigneeId: careForm.assigneeId || null, dueDate: dateValue(careForm.dueDate) };
      const error = petCareError(input, assignees.map((row) => row.id)); if (error) { setFormError(error); return; }
      const pet = activeDialog.pet; const operationId = careOperation.idFor(input);
      void mutate(() => useCases.addPetCare.execute(pet.id, input, pet.revision, operationId), "کار مراقبتی ثبت شد.", pet.id);
    } catch (error) { setFormError(messageOf(error)); }
  };
  const deletePet = () => {
    if (!useCases || activeDialog?.kind !== "delete") return;
    const pet = activeDialog.pet; void mutate(() => useCases.deletePet.execute(pet.id, pet.revision), "حیوان از فهرست حذف شد.");
  };
  const setCompleted = (task: PetCareTask) => {
    if (!useCases || !detailValue || !task.canComplete || !connected()) return;
    const petId = detailValue.pet.id;
    void mutate(async (ticket) => {
      try {
        const before = await refreshTasks();
        if (!current(ticket)) return;
        if (!connected()) throw new AppError("NETWORK", "بخش حیوانات خانگی به اتصال اینترنت نیاز دارد.");
        if (before.issues.length) throw new Error(before.issues[0].message);
        await useCases.setTaskCompleted.execute(task.id, !task.completed, task.revision);
        if (!current(ticket)) return;
        if (!connected()) throw new AppError("NETWORK", "بخش حیوانات خانگی به اتصال اینترنت نیاز دارد.");
        const after = await refreshTasks();
        if (after.issues.length) throw new Error(after.issues[0].message);
      } catch (error) {
        // Task queue errors have a reduced shape; a fresh detail also refreshes rights.
        if (current(ticket) && connected()) await readDetail(petId);
        throw error;
      }
    }, task.completed ? "کار مراقبتی دوباره باز شد." : "انجام‌شدن کار مراقبتی ثبت شد.", petId);
  };
  const changeCareForm = (next: (previous: CareForm) => CareForm) => { careOperation.reset(); setCareForm(next); };
  const closeDetail = () => { if (!busy) { detailSequence.current += 1; setDetail(null); setDetailLoading(false); } };
  return { available, pets, visible, canCreate, loading, detailLoading, busy, accessDenied, loadError, formError, conflict,
    query, setQuery, detailValue, activeDialog, form, setForm, careForm, changeCareForm, assignees, careTasks, showCompleted, setShowCompleted,
    reload, openDetail, openProfile, openCare, openDelete, saveProfile, saveCare, deletePet, setCompleted, closeDetail,
    closeForm: () => { if (!busy) clearForm(); }, refreshConflict: () => { if (!busy) { clearForm(); void reload(); } },
  };
}
