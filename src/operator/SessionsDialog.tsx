import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Cloud, CloudOff, FolderOpen, HardDrive, Loader2, Plus, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { useCloud } from "@/lib/cloud";
import { CloudBadge } from "./CloudAccount";
import {
  createSession,
  deleteSession,
  moveLibrary,
  openSession,
  refreshSessions,
  useLibrary,
  type CloudFolder,
} from "./library";

function timeAgo(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "עכשיו";
  if (s < 3600) return `לפני ${Math.floor(s / 60)} דק׳`;
  if (s < 86400) return `לפני ${Math.floor(s / 3600)} שע׳`;
  return new Date(ms).toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
}

export function isCloudPath(p?: string | null) {
  return !!p && /(my drive|האחסון שלי|google drive|onedrive|dropbox)/i.test(p);
}

/** Where the library lives + one-click "sync with Google Drive". */
export function CloudSetup({ compact }: { compact?: boolean }) {
  const info = useLibrary((s) => s.info);
  const [folders, setFolders] = useState<CloudFolder[] | null>(null);
  useEffect(() => {
    invoke<CloudFolder[]>("detect_cloud_folders").then(setFolders).catch(() => setFolders([]));
  }, []);
  const cloud = isCloudPath(info?.root);
  const drive = folders?.find((f) => f.label === "Google Drive");

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-3.5",
        cloud ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-border bg-background/50",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            cloud ? "bg-emerald-500/15 text-emerald-400" : "bg-accent text-muted-foreground",
          )}
        >
          {cloud ? <Cloud className="size-4.5" /> : <HardDrive className="size-4.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{cloud ? "מסונכרן לענן" : "נשמר רק במחשב הזה"}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {cloud
              ? "כל מחשב עם אותו חשבון רואה את אותם מפגשים, מצגות וסרטונים - בלי להעביר קבצים."
              : "חבר את Google Drive כדי שהמפגשים יחכו לך בכל מחשב, גם אם שכחת משהו בבית."}
          </div>
          {!compact && info && (
            <div className="mt-1.5 truncate text-right text-[11px] text-muted-foreground/70" dir="ltr" title={info.root}>
              {info.root}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!cloud && drive && (
          <Button size="sm" onClick={() => moveLibrary(drive.path)}>
            <Cloud /> סנכרן עם Google Drive
          </Button>
        )}
        {!cloud &&
          folders
            ?.filter((f) => f.label !== "Google Drive")
            .map((f) => (
              <Button key={f.path} size="sm" variant="secondary" onClick={() => moveLibrary(f.path)}>
                <Cloud /> {f.label}
              </Button>
            ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            const dir = await openDialog({ directory: true, title: "בחירת תיקיית ספרייה (למשל תיקייה מסונכרנת)" });
            if (dir && !Array.isArray(dir)) moveLibrary(dir);
          }}
        >
          <FolderOpen /> תיקייה אחרת…
        </Button>
        {cloud && (
          <Button size="sm" variant="ghost" onClick={() => moveLibrary(null)}>
            <CloudOff /> שמור מקומית
          </Button>
        )}
      </div>
      {!cloud && folders && !drive && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          לא נמצא Google Drive למחשב. התקן את "Google Drive for desktop", התחבר - והכפתור יופיע כאן.
        </p>
      )}
    </div>
  );
}

export function SessionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const sessions = useLibrary((s) => s.sessions);
  const current = useLibrary((s) => s.sessionId);
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (open) refreshSessions();
    else setConfirm(null);
  }, [open]);

  const list = sessions.filter((s) => s.name.includes(q.trim()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="המפגשים שלי" description="כל מפגש נשמר אוטומטית. לחץ כדי לפתוח." className="max-w-2xl">
        <CloudSetup compact />
        <div className="flex gap-2">
          <Input placeholder="חיפוש מפגש…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button
            onClick={async () => {
              await createSession();
              onOpenChange(false);
            }}
          >
            <Plus /> מפגש חדש
          </Button>
        </div>
        <div className="-mx-2 flex max-h-[45vh] flex-col gap-0.5 overflow-y-auto px-2">
          {list.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">אין מפגשים</div>}
          {list.map((s, i) => {
            const isCur = s.id === current;
            return (
              <div
                key={s.id}
                style={{ ["--stagger" as string]: `${Math.min(i, 10) * 20}ms` }}
                className={cn(
                  "enter-rise group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                  isCur ? "border-primary/40 bg-primary/[0.07]" : "border-transparent hover:bg-accent/60",
                )}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-3 text-right"
                  onClick={async () => {
                    if (!isCur) await openSession(s.id);
                    onOpenChange(false);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 truncate text-sm font-medium">
                      {s.name}
                      {isCur && (
                        <span className="flex items-center gap-1 text-[11px] font-normal text-primary-text">
                          <Check className="size-3" /> פתוח
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.items} פריטים · {timeAgo(s.updated)}
                    </div>
                  </div>
                </button>
                {confirm === s.id ? (
                  <div className="enter-fade flex items-center gap-1">
                    <Button size="sm" variant="destructive" onClick={() => deleteSession(s.id).then(() => setConfirm(null))}>
                      מחק
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      ביטול
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 hover:text-red-400"
                    onClick={() => setConfirm(s.id)}
                    aria-label="מחיקה"
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Tiny "saved ✓ / saving…" indicator for the top bar. */
export function SaveIndicator() {
  const signedIn = useCloud((s) => s.signedIn);
  const saving = useLibrary((s) => s.saving);
  const info = useLibrary((s) => s.info);
  if (signedIn) return <CloudBadge />;
  const cloud = isCloudPath(info?.root);
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title={info?.root}>
      {saving ? (
        <Loader2 className="size-3 animate-spin" />
      ) : cloud ? (
        <Cloud className="size-3.5 text-emerald-400" />
      ) : (
        <HardDrive className="size-3.5" />
      )}
      {saving ? "שומר…" : cloud ? "מסונכרן" : "נשמר במחשב"}
    </span>
  );
}
