import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { create } from "zustand";
import { initMediaDir } from "@/lib/media";
import type { SessionDoc, Slide } from "@/lib/types";
import { useSession } from "@/store/session";
import { resetHistory } from "@/store/history";
import { requestSync, startCloud } from "@/lib/cloud";

export interface SessionMeta {
  id: string;
  name: string;
  items: number;
  updated: number;
  cover?: Slide | null;
}
export interface LibraryInfo {
  root: string;
  mediaDir: string;
  isDefault: boolean;
}
export interface CloudFolder {
  label: string;
  path: string;
}

const CURRENT_KEY = "bima-current-session";

/** Library state: which session is open, where the library lives, sync status. */
export const useLibrary = create<{
  sessionId: string | null;
  info: LibraryInfo | null;
  sessions: SessionMeta[];
  lastMtime: number;
  saving: boolean;
  savedAt: number | null;
  view: "home" | "workspace";
}>(() => ({ sessionId: null, info: null, sessions: [], lastMtime: 0, saving: false, savedAt: null, view: "home" }));

/** Back to the projects screen (saves first). The projector keeps showing what it shows. */
export async function goHome() {
  await flushSave();
  await refreshSessions();
  useLibrary.setState({ view: "home" });
}

export async function refreshSessions() {
  const sessions = await invoke<SessionMeta[]>("list_sessions").catch(() => []);
  useLibrary.setState({ sessions });
  return sessions;
}

export async function refreshLibraryInfo() {
  const info = await invoke<LibraryInfo>("get_library");
  useLibrary.setState({ info });
  return info;
}

export async function openSession(id: string) {
  await flushSave();
  try {
    const r = await invoke<{ json: string | null; mtime: number }>("load_session", { id });
    const doc = r.json ? (JSON.parse(r.json) as SessionDoc) : null;
    useLibrary.setState({ sessionId: id, lastMtime: r.mtime, view: "workspace" });
    localStorage.setItem(CURRENT_KEY, id);
    useSession.getState().loadDoc(doc);
    clearTimeout(timer);
    pending = false;
    resetHistory();
  } catch (e) {
    toast.error("פתיחת הפרויקט נכשלה", { description: String(e) });
  }
}

export async function createSession(doc?: SessionDoc) {
  await flushSave();
  const id = await invoke<string>("new_session_id");
  useLibrary.setState({ sessionId: id, lastMtime: 0, view: "workspace" });
  localStorage.setItem(CURRENT_KEY, id);
  useSession.getState().loadDoc(doc ?? null);
  resetHistory();
  await saveNow();
  await refreshSessions();
}

export async function deleteSession(id: string, opts: { stayHome?: boolean } = {}) {
  await invoke("delete_session", { id });
  requestSync(300);
  const list = await refreshSessions();
  if (useLibrary.getState().sessionId === id) {
    useLibrary.setState({ sessionId: null });
    if (opts.stayHome) return;
    if (list[0]) await openSession(list[0].id);
    else await createSession();
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false;

export async function saveNow() {
  clearTimeout(timer);
  pending = false;
  const { sessionId } = useLibrary.getState();
  if (!sessionId || !useSession.getState().loaded) return;
  useLibrary.setState({ saving: true });
  try {
    const mtime = await invoke<number>("save_session", {
      id: sessionId,
      json: JSON.stringify(useSession.getState().toDoc()),
      // the version this editor is based on: if sync replaced the file meanwhile, the
      // replaced copy is kept in version history rather than silently overwritten
      baseMtime: useLibrary.getState().lastMtime || null,
    });
    useLibrary.setState({ lastMtime: mtime, savedAt: Date.now() });
    requestSync();
  } catch (e) {
    toast.error("השמירה נכשלה", { description: String(e) });
  } finally {
    useLibrary.setState({ saving: false });
  }
}

export function scheduleSave() {
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(saveNow, 600);
}

export async function flushSave() {
  if (pending) await saveNow();
}

export async function renameSession(id: string, name: string) {
  name = name.trim();
  if (!name) return;
  if (useLibrary.getState().sessionId === id) {
    useSession.getState().setName(name);
    await saveNow();
  } else {
    const r = await invoke<{ json: string | null }>("load_session", { id });
    if (!r.json) return;
    const doc = JSON.parse(r.json) as SessionDoc;
    doc.name = name;
    await invoke("save_session", { id, json: JSON.stringify(doc), baseMtime: null });
    requestSync(300);
  }
  await refreshSessions();
}

/** App start → the projects (launch) screen. */
export async function bootLibrary() {
  startCloud(async (ids) => {
    // sessions changed on another computer
    await refreshSessions();
    const cur = useLibrary.getState().sessionId;
    if (cur && ids.includes(cur)) await checkRemoteChanges();
  });
  // signed in to Bima Cloud → the engine moved the library out of a Drive/OneDrive folder
  listen<string>("library-moved-local", async () => {
    await refreshLibraryInfo().catch(() => {});
    await initMediaDir();
    await refreshSessions();
    toast.success("הספרייה הועברה לתיקייה המקומית", {
      description: "הסנכרון מתבצע דרך בימה בענן.",
    });
  }).catch(() => {});
  await refreshLibraryInfo().catch(() => {});
  await refreshSessions();
  useLibrary.setState({ view: "home" });
}

/** Stable JSON (sorted keys) so the same content compares equal however it was written. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ":" + canonical((v as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(v ?? null);
}

/** Apply a doc that came from the cloud WITHOUT treating it as a local edit (no re-save). */
function applyRemoteDoc(doc: SessionDoc) {
  useSession.setState({ name: doc.name, items: doc.items });
  clearTimeout(timer); // the autosave subscription just fired - this isn't our edit
  pending = false;
}

/**
 * Another computer changed the open project (the sync engine already wrote the file):
 * reload it in place if the content differs. Unsaved local edits win (they're saved next
 * and the engine resolves it). Live state is kept.
 */
export async function checkRemoteChanges() {
  const { sessionId, saving } = useLibrary.getState();
  if (!sessionId || saving || pending || !useSession.getState().loaded) return;
  const r = await invoke<{ json: string | null; mtime: number }>("load_session", { id: sessionId }).catch(() => null);
  if (!r?.json || pending || useLibrary.getState().sessionId !== sessionId) return;
  let doc: SessionDoc;
  try {
    doc = JSON.parse(r.json) as SessionDoc;
  } catch {
    return;
  }
  const mine = useSession.getState().toDoc();
  if (canonical({ name: doc.name, items: doc.items }) === canonical({ name: mine.name, items: mine.items })) {
    useLibrary.setState({ lastMtime: r.mtime });
    return;
  }
  useLibrary.setState({ lastMtime: r.mtime });
  applyRemoteDoc(doc);
}

export async function moveLibrary(folder: string | null) {
  await flushSave();
  const id = toast.loading(folder ? "מעביר את הספרייה לענן… (קבצי וידאו גדולים עשויים לקחת זמן)" : "מחזיר את הספרייה למחשב…");
  try {
    const info = await invoke<LibraryInfo>("set_library", { folder });
    useLibrary.setState({ info });
    await initMediaDir();
    await saveNow();
    await refreshSessions();
    toast.success(folder ? "הספרייה מסונכרנת עכשיו לענן" : "הספרייה נשמרת מקומית", { id, description: info.root });
  } catch (e) {
    toast.error("העברת הספרייה נכשלה", { id, description: String(e) });
  }
}
