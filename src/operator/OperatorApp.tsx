import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Toaster, toast } from "sonner";
import {
  Download,
  FolderOpen,
  Keyboard,
  MonitorCheck,
  MonitorX,
  MoreVertical,
  FileDown,
  Library,
  Plus,
  Settings,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { Input, Tip, TooltipProvider } from "@/components/ui/primitives";
import { EV, send, useTauriEvent } from "@/lib/events";
import { useSettings } from "@/lib/settings";
import { applyTheme } from "@/lib/theme";
import { broadcastPresenter, setPresenter, usePresenter } from "@/lib/presenter";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";
import { closeProjector, exportBundle, importBundle, importFromPaths, newSession, refreshMonitors } from "./actions";
import { CenterPanel } from "./CenterPanel";
import { ShortcutsDialog } from "./dialogs";
import { ClipDialog } from "./ClipDialog";
import { ExportDialog, openExport } from "./ExportDialog";
import { startRemote, useRemote } from "./remote";
import { Watch } from "lucide-react";
import { SettingsDialog, type SettingsPage } from "./Settings";
import { LivePanel } from "./LivePanel";
import { Playlist } from "./Playlist";
import { useKeyboard } from "./useKeyboard";
import { SaveIndicator } from "./SessionsDialog";
import { SlidePickerDialog } from "./SlidePicker";
import { startHistory } from "@/store/history";
import { HomeScreen } from "./HomeScreen";
import { flushSave, goHome, openSession, useLibrary } from "./library";
import { bootLibrary, checkRemoteChanges, scheduleSave } from "./library";
import { startUpdater } from "@/lib/updater";
import { ConfirmHost } from "@/components/ConfirmHost";
import { BimaMark } from "@/components/BimaLogo";
import { useMedia } from "@/lib/useMedia";

function useBoot() {
  useEffect(() => {
    (async () => {
      await bootLibrary();
      startUpdater();
      startRemote();
      // dev-only: ?workspace opens the first project straight away (design checks in a browser)
      if (import.meta.env.DEV && new URLSearchParams(location.search).has("workspace")) {
        const first = useLibrary.getState().sessions[0];
        if (first) await openSession(first.id);
        // ?live=<itemId>:<slide>: select that item with that slide on air (README screenshots)
        const live = new URLSearchParams(location.search).get("live");
        if (live) {
          const [id, n] = live.split(":");
          useSession.getState().select(id);
          useSession.getState().goLive(id, Number(n) || 0);
        }
      }
      const open = await invoke<boolean>("is_projector_open").catch(() => false);
      useSession.getState().setProjector(open);
      await refreshMonitors();
    })();
    const t = setInterval(refreshMonitors, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => startHistory(), []);

  // autosave (debounced) into the library - local or cloud-synced folder
  useEffect(() => {
    const unsub = useSession.subscribe((s, prev) => {
      if (s.loaded && (s.items !== prev.items || s.name !== prev.name)) scheduleSave();
    });
    const poll = setInterval(checkRemoteChanges, 8000);
    const onFocus = () => checkRemoteChanges();
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // broadcast live state to the projector on every change
  useEffect(() => {
    const unsub = useSession.subscribe((s, prev) => {
      if (s.live !== prev.live) send(EV.live, s.live);
    });
    return unsub;
  }, []);

  // window title: "בימה" on the projects screen, "בימה - <project>" while working
  const title = useSession((s) => s.name);
  const view = useLibrary((s) => s.view);
  useEffect(() => {
    const t = view === "workspace" && title ? `בימה - ${title}` : "בימה";
    document.title = t;
    getCurrentWindow().setTitle(t).catch(() => {});
  }, [title, view]);

    // keep Windows awake (no sleep, no screen-off) while Bima is open
  const keepAwake = useSettings((s) => s.keepAwake);
  useEffect(() => {
    invoke("set_keep_awake", { system: keepAwake, display: keepAwake }).catch(() => {});
  }, [keepAwake]);

  // operator accent colour
  const theme = useSettings((s) => s.theme);
  useEffect(() => applyTheme(theme), [theme]);

  // keep transition settings in the live state
  const transition = useSettings((s) => s.transition);
  const fadeMs = useSettings((s) => s.fadeMs);
  useEffect(() => useSession.getState().setTransition(transition, fadeMs), [transition, fadeMs]);

  useTauriEvent(EV.projectorReady, () => {
    send(EV.live, useSession.getState().live);
    broadcastPresenter();
  });

  // ink belongs to a slide: wipe it (and release zoom lock) whenever the slide changes
  useEffect(
    () =>
      useSession.subscribe((s, prev) => {
        if (s.live.key !== prev.live.key && (usePresenter.getState().strokes.length || usePresenter.getState().zoomLocked))
          setPresenter({ strokes: [], zoomLocked: false });
      }),
    [],
  );

  // standby screen (session name + clock) when nothing is live
  const standby = useSettings((s) => s.standby);
  const standbyClock = useSettings((s) => s.standbyClock);
  const sessionName = useSession((s) => s.name);
  useEffect(() => {
    useSession.setState((s) => ({
      live: { ...s.live, standby: standby ? { title: sessionName, showClock: standbyClock } : null },
    }));
  }, [standby, standbyClock, sessionName]);
  useTauriEvent(EV.projectorClosed, () => useSession.getState().setProjector(false));
  // closing the app: finish the last save and close the projector (which also restores the
  // display mode) before quitting. Rust quits anyway after 4 s if this never answers.
  useTauriEvent("app-close-requested", async () => {
    try {
      await flushSave();
      if (useSession.getState().projector.open) await closeProjector();
    } finally {
      invoke("quit_app").catch(() => {});
    }
  });
  // the audience screen disappeared mid-show: Rust shrank the projector window so it can't
  // cover this screen — say what happened and how to recover
  useTauriEvent("projector-display-lost", () => {
    useSession.getState().setProjector(true, "windowed");
    void refreshMonitors();
    toast.error("מסך הקהל נותק", {
      description: "חלון ההקרנה הוקטן כדי לא לכסות את המסך שלך. חבר את המקרן ובחר שוב התחלת הקרנה.",
      duration: 12000,
    });
  });
  useTauriEvent<{ key: string }>(EV.mediaEnded, ({ key }) => {
    const s = useSession.getState();
    if (key === s.live.key && s.live.media.advanceOnEnd) s.next();
  });
}

function useFileDrop() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let un: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") setOver(true);
        else if (p.type === "leave") setOver(false);
        else if (p.type === "drop") {
          setOver(false);
          importFromPaths(p.paths);
        }
      })
      .then((u) => (un = u));
    return () => un?.();
  }, []);
  return over;
}

function TopBar({
  onSettings,
  onShortcuts,
}: {
  onSettings: () => void;
  onShortcuts: () => void;
}) {
  const name = useSession((s) => s.name);
  const setName = useSession((s) => s.setName);
  const projector = useSession((s) => s.projector);
  const monitors = useSession((s) => s.monitors);
  const [val, setVal] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setVal(name), [name]);
  const two = monitors.length > 1;

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-background pr-2 pl-2">
      {/* where am I: Bima / projects / this project */}
      <Tip content="כל הפרויקטים">
        <button
          onClick={() => goHome()}
          className="pressable flex h-8 items-center gap-2 rounded-md px-1.5 hover:bg-accent"
          aria-label="כל הפרויקטים"
        >
          <BimaMark />
          <span className="hidden text-[13px] font-medium text-muted-foreground md:inline">פרויקטים</span>
        </button>
      </Tip>
      <span className="text-faint select-none">/</span>
      <Input
        ref={ref}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => setName(val.trim() || "פרויקט חדש")}
        onKeyDown={(e) => e.key === "Enter" && ref.current?.blur()}
        aria-label="שם הפרויקט"
        className="h-8 w-auto max-w-72 min-w-24 border-transparent bg-transparent px-2 text-[13px] font-semibold shadow-none [field-sizing:content] hover:border-border focus-visible:border-ring"
      />
      <SaveIndicator />
      <div className="flex-1" />

      <Tip content={two ? `מסך קהל מחובר${projector.open && projector.label && projector.label !== "windowed" ? ` · ${projector.label.replace(/^\\\\\.\\/, "")}` : ""}` : "לא זוהה מסך נוסף"}>
        <div
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px]",
            two ? "text-muted-foreground" : "text-amber-300/90",
          )}
        >
          {two ? <MonitorCheck className="size-3.5" /> : <MonitorX className="size-3.5" />}
          <span className="hidden lg:inline">{two ? `${monitors.length} מסכים` : "מסך יחיד"}</span>
        </div>
      </Tip>
      <WatchChip onOpen={onSettings} />
      <div className="mx-1 h-4 w-px bg-border" />
      <Tip content="הגדרות">
        <Button size="icon-sm" variant="ghost" onClick={onSettings} aria-label="הגדרות">
          <Settings />
        </Button>
      </Tip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="עוד">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={onShortcuts}>
            <Keyboard /> קיצורי מקלדת…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openExport()}>
            <FileDown /> ייצוא…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => exportBundle()}>
            <Download /> ייצוא חבילת פרויקט…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => importBundle()}>
            <FolderOpen /> פתיחת חבילת פרויקט…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => newSession()}>
            <Plus /> פרויקט חדש
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => goHome()}>
            <Library /> כל הפרויקטים
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

/** The paired watch, when the watch remote is on: connected, or looking for it. */
function WatchChip({ onOpen }: { onOpen: () => void }) {
  const on = useSettings((s) => s.remoteEnabled && !!s.remoteWatch);
  const { state, battery } = useRemote();
  if (!on) return null;
  const linked = state === "connected";
  return (
    <Tip content={linked ? `השעון מחובר${battery != null ? ` · ${battery}%` : ""}` : "מחפש את השעון"}>
      <button
        onClick={onOpen}
        aria-label={linked ? "השעון מחובר" : "מחפש את השעון"}
        className={cn(
          "flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] transition-colors duration-[160ms] hover:bg-accent",
          linked ? "text-muted-foreground" : "text-faint",
        )}
      >
        <Watch className={cn("size-3.5", !linked && "opacity-60")} />
        {linked && battery != null && <span className="hidden tabular lg:inline">{battery}%</span>}
      </button>
    </Tip>
  );
}

/** Three columns that adapt: wide → full lists; ≤1180px → the run-of-show becomes a rail. */
function Workspace() {
  const wide = useMedia("(min-width: 1440px)");
  const roomy = useMedia("(min-width: 1180px)");
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (roomy) setDrawer(false);
  }, [roomy]);
  const cols = wide ? "grid-cols-[288px_minmax(0,1fr)_384px]" : roomy ? "grid-cols-[248px_minmax(0,1fr)_340px]" : "grid-cols-[60px_minmax(0,1fr)_312px]";

  return (
    <main className={cn("enter-fade relative grid min-h-0 flex-1", cols)}>
      <Playlist compact={!roomy} onExpand={() => setDrawer(true)} />
      <CenterPanel />
      <LivePanel />
      {!roomy && drawer && (
        <>
          <div className="enter-fade absolute inset-0 z-30 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="enter-panel absolute inset-y-0 right-0 z-40 w-72">
            <Playlist onClose={() => setDrawer(false)} />
          </div>
        </>
      )}
    </main>
  );
}

export function OperatorApp() {
  useBoot();
  useKeyboard();
  const dragging = useFileDrop();
  const loaded = useSession((s) => s.loaded);
  const view = useLibrary((s) => s.view);
  const [settings, setSettings] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("general");
  const openSettings = (page: SettingsPage = "general") => {
    setSettingsPage(page);
    setSettings(true);
  };
  const [shortcuts, setShortcuts] = useState(false);

  return (
    <TooltipProvider>
      <div dir="rtl" className="flex h-full flex-col">
        {view === "home" ? (
          <HomeScreen onSettings={openSettings} />
        ) : (
          <TopBar onSettings={() => openSettings()} onShortcuts={() => setShortcuts(true)} />
        )}
        {view === "workspace" && loaded && <Workspace />}

        {dragging && (
          <div className="enter-fade pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="enter-fade flex flex-col items-center gap-3 rounded-2xl border border-dashed border-primary/60 bg-card/90 px-16 py-12">
              <Upload className="size-8 text-primary-text" />
              <div className="text-lg font-semibold">שחרור להוספה לפרויקט</div>
              <div className="text-sm text-muted-foreground">PowerPoint · PDF · וידאו · תמונות · חבילת פרויקט</div>
            </div>
          </div>
        )}

        <ClipDialog />
        <ExportDialog />
        <SettingsDialog
          open={settings}
          initialPage={settingsPage}
          onOpenChange={setSettings}
          onShortcuts={() => {
            setSettings(false);
            setShortcuts(true);
          }}
        />
        <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
        <SlidePickerDialog />
        <ConfirmHost />
        <Toaster
          theme="dark"
          dir="rtl"
          position="bottom-center"
          toastOptions={{
            className: "!bg-popover !border-border !text-foreground !font-sans",
          }}
        />
      </div>
    </TooltipProvider>
  );
}
