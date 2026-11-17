import { invoke } from "@tauri-apps/api/core";
import { confirmAction } from "@/components/ConfirmHost";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { importPaths, referencedFiles } from "@/lib/importer";
import { EXT } from "@/lib/media";
import { useSettings } from "@/lib/settings";
import type { MonitorInfo, SessionDoc } from "@/lib/types";
import { formatBytes } from "@/lib/utils";
import { useSession } from "@/store/session";
import { EV, send } from "@/lib/events";
import type { MediaCommand } from "@/lib/types";
import { createSession, useLibrary } from "./library";

export async function refreshMonitors() {
  try {
    const m = await invoke<MonitorInfo[]>("list_monitors");
    useSession.getState().setMonitors(m);
    return m;
  } catch {
    return [];
  }
}

let opening = false;
export async function openProjector(opts?: { monitor?: number | null; windowed?: boolean }) {
  if (opening) return;
  opening = true;
  try {
    await openProjectorInner(opts);
  } finally {
    opening = false;
  }
}

/** Did WE switch Windows from Duplicate to Extend? Then we put it back after the show. */
let switchedDisplay = false;

async function openProjectorInner(opts?: { monitor?: number | null; windowed?: boolean }) {
  const monitor = opts?.monitor !== undefined ? opts.monitor : useSettings.getState().preferredMonitor;
  // Projector mirrored? Switch to Extend first (like PowerPoint) - no Win+P fiddling.
  if (useSettings.getState().autoExtend && !opts?.windowed) {
    const r = await invoke<{ switched: boolean; monitors: number }>("extend_displays").catch(() => null);
    if (r?.switched) {
      switchedDisplay = true;
      await refreshMonitors();
      toast("התצוגה הועברה למצב הרחבה", { description: "המצב הקודם יוחזר בסיום ההקרנה." });
    }
  }
  try {
    const label = await invoke<string>("open_projector", { monitor: monitor ?? null, windowed: !!opts?.windowed });
    useSession.getState().setProjector(true, label);
    if (label === "windowed") toast("חלון הקרנה לבדיקה", { description: "לא זוהה מסך נוסף. חבר מקרן להקרנה במסך מלא." });
  } catch (e) {
    toast.error("פתיחת ההקרנה נכשלה", { description: String(e) });
  }
}

export async function closeProjector() {
  // stop sound right away (the projector is the only thing playing)
  send<MediaCommand>(EV.mediaCmd, { type: "pause" });
  useSession.getState().setProjector(false);
  try {
    await invoke("close_projector");
  } catch (e) {
    toast.error("סגירת המקרן נכשלה", { description: String(e) });
  }
  // verify - if the window somehow survived, report the truth
  const still = await invoke<boolean>("is_projector_open").catch(() => false);
  useSession.getState().setProjector(still);
  if (!still && switchedDisplay) {
    switchedDisplay = false;
    await invoke("restore_duplicate").catch(() => {});
    setTimeout(() => void refreshMonitors(), 2500);
  }
}

export async function toggleProjector() {
  if (useSession.getState().projector.open) await closeProjector();
  else await openProjector();
}

let importing = false;
export async function importFromPaths(paths: string[]) {
  if (!paths.length) return;
  if (importing) {
    toast("ייבוא קודם עדיין בתהליך");
    return;
  }
  importing = true;
  const id = toast.loading("מייבא קבצים…");
  try {
    const { items, bundles, errors } = await importPaths(paths, (msg) => toast.loading(msg, { id }));
    useSession.getState().addItems(items);
    if (items.length) toast.success(`נוספו ${items.length} פריטים לרשימה`, { id });
    else toast.dismiss(id);
    for (const err of errors) toast.error("ייבוא נכשל", { description: err, duration: 8000 });
    for (const b of bundles) await importBundle(b);
  } finally {
    importing = false;
  }
}

export async function pickAndImport() {
  const sel = await open({
    multiple: true,
    title: "הוספת קבצים",
    filters: [
      {
        name: "כל הקבצים הנתמכים",
        extensions: [...EXT.presentation, ...EXT.pdf, ...EXT.video, ...EXT.image],
      },
      { name: "מצגות", extensions: EXT.presentation },
      { name: "PDF", extensions: EXT.pdf },
      { name: "וידאו", extensions: EXT.video },
      { name: "תמונות", extensions: EXT.image },
    ],
  });
  if (!sel) return;
  await importFromPaths(Array.isArray(sel) ? sel : [sel]);
}

export async function exportBundle() {
  const s = useSession.getState();
  const dest = await save({
    title: "ייצוא חבילת פרויקט",
    defaultPath: `${s.name.replace(/[\\/:*?"<>|]/g, "_") || "session"}.zip`,
    filters: [{ name: "חבילת פרויקט", extensions: ["zip"] }],
  });
  if (!dest) return;
  const id = toast.loading("מייצא חבילה…");
  try {
    await invoke("export_bundle", {
      sessionJson: JSON.stringify(s.toDoc()),
      files: referencedFiles(s.items),
      dest,
    });
    toast.success("החבילה נשמרה", { id, description: dest });
  } catch (e) {
    toast.error("הייצוא נכשל", { id, description: String(e) });
  }
}

export async function importBundle(path?: string) {
  let src = path;
  if (!src) {
    const sel = await open({
      title: "פתיחת חבילת פרויקט",
      filters: [{ name: "חבילת פרויקט", extensions: EXT.bundle }],
    });
    if (!sel || Array.isArray(sel)) return;
    src = sel;
  }
  const s = useSession.getState();
  let mode: "replace" | "merge" = "replace";
  if (s.items.length) {
    const replace = await ask("לפתוח את החבילה כפרויקט חדש?\nאחרת הפריטים יתווספו לרשימה הנוכחית.", {
      title: "פתיחת חבילת פרויקט",
      kind: "info",
      okLabel: "פרויקט חדש",
      cancelLabel: "הוספה לרשימה",
    });
    mode = replace ? "replace" : "merge";
  }
  const id = toast.loading("פותח חבילה…");
  try {
    const json = await invoke<string>("import_bundle", { src });
    const doc = JSON.parse(json) as SessionDoc;
    if (mode === "replace") await createSession(doc);
    else s.addItems(doc.items ?? []);
    toast.success(`החבילה "${doc.name}" נטענה`, { id });
  } catch (e) {
    toast.error("פתיחת החבילה נכשלה", { id, description: String(e) });
  }
}

export async function newSession() {
  // previous session stays in "המפגשים שלי" - nothing is lost
  await createSession();
  toast.success("נוצר פרויקט חדש");
}

export async function cleanupMedia() {
  const ok = await confirmAction({
    title: "למחוק קבצי מדיה שלא בשימוש?",
    description: "קבצים שאינם בשימוש באף פרויקט יימחקו מהמחשב.",
    confirmLabel: "מחיקת קבצים",
  });
  if (!ok) return;
  const keepSet = new Set(referencedFiles(useSession.getState().items));
  for (const meta of useLibrary.getState().sessions) {
    const r = await invoke<{ json: string | null }>("load_session", { id: meta.id }).catch(() => ({ json: null }));
    if (r.json) referencedFiles((JSON.parse(r.json) as SessionDoc).items ?? []).forEach((f) => keepSet.add(f));
  }
  const keep = [...keepSet];
  try {
    const [count, bytes] = await invoke<[number, number]>("cleanup_media", { keep });
    toast.success(count ? `נמחקו ${count} קבצים (${formatBytes(bytes)})` : "אין קבצים מיותרים");
  } catch (e) {
    toast.error(String(e));
  }
}
