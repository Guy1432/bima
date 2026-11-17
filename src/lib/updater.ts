import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { create } from "zustand";
import { useSession } from "@/store/session";

/**
 * Auto-update from GitHub Releases (signed). We only ever *notify* - installing restarts
 * the app, so it never happens on its own and is refused while the projector is open.
 */
interface UpdaterState {
  version: string;
  available: Update | null;
  checking: boolean;
  installing: boolean;
  progress: number; // 0..1
  lastChecked: number | null;
}

export const useUpdater = create<UpdaterState>(() => ({
  version: "",
  available: null,
  checking: false,
  installing: false,
  progress: 0,
  lastChecked: null,
}));

const TOAST_ID = "bima-update";

export async function checkForUpdate({ silent }: { silent: boolean }) {
  const st = useUpdater.getState();
  if (st.checking || st.installing) return;
  useUpdater.setState({ checking: true });
  try {
    const update = await check({ timeout: 15000 });
    useUpdater.setState({ available: update, lastChecked: Date.now() });
    if (update) announce(update);
    else if (!silent) toast.success("הגרסה עדכנית", { description: `גרסה ${st.version}` });
  } catch (e) {
    if (!silent) toast.error("בדיקת העדכונים נכשלה", { description: "אין חיבור לשרת העדכונים." });
    console.warn("update check failed", e);
  } finally {
    useUpdater.setState({ checking: false });
  }
}

/** Release notes are markdown for the GitHub page ("- a" lines, an RTL wrapper): one line here. */
function plainNotes(body: string | undefined) {
  return (body ?? "")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean)
    .join(" · ");
}

function announce(update: Update) {
  toast(`גרסה ${update.version} זמינה`, {
    id: TOAST_ID,
    duration: Infinity,
    description: plainNotes(update.body) || "מוכן להתקנה.",
    action: { label: "עדכון", onClick: () => void installUpdate() },
    cancel: { label: "אחר כך", onClick: () => {} },
  });
}

export async function installUpdate() {
  const { available: update, installing } = useUpdater.getState();
  if (!update || installing) return;
  if (useSession.getState().projector.open) {
    toast.error("יש לעצור את ההקרנה לפני העדכון", {
      description: "העדכון מפעיל את בימה מחדש.",
    });
    announce(update);
    return;
  }
  useUpdater.setState({ installing: true, progress: 0 });
  let total = 0;
  let got = 0;
  toast.loading("מוריד עדכון…", { id: TOAST_ID, duration: Infinity, description: undefined, action: undefined, cancel: undefined });
  try {
    await update.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        const p = total ? got / total : 0;
        useUpdater.setState({ progress: p });
        toast.loading(`מוריד עדכון… ${Math.round(p * 100)}%`, { id: TOAST_ID });
      } else if (ev.event === "Finished") toast.loading("מתקין עדכון…", { id: TOAST_ID });
    });
    await relaunch();
  } catch (e) {
    useUpdater.setState({ installing: false });
    toast.error("העדכון נכשל", { id: TOAST_ID, duration: 8000, description: String(e) });
  }
}

/** Called once at startup: check shortly after boot, then every 6 hours. */
export function startUpdater() {
  getVersion().then((v) => useUpdater.setState({ version: v }));
  if (import.meta.env.DEV) return;
  setTimeout(() => void checkForUpdate({ silent: true }), 6000);
  setInterval(() => {
    if (!useUpdater.getState().available) void checkForUpdate({ silent: true });
  }, 6 * 60 * 60 * 1000);
}
