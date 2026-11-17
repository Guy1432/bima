import { useState } from "react";
import { confirmAction } from "@/components/ConfirmHost";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Check, Cloud, CloudOff, Loader2, LogOut, RefreshCw, Settings2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { signOut, useCloud } from "@/lib/cloud";
import { cn } from "@/lib/utils";
import { SignIn } from "./CloudAccount";
import { useLibrary } from "./library";

function ago(ms: number) {
  if (!ms) return "";
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "עכשיו";
  if (s < 3600) return `לפני ${Math.floor(s / 60)} דק׳`;
  return new Date(ms).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

/** Sync state, as an icon + a short honest word. */
export function syncLabel(state: string) {
  return state === "syncing" ? "מסנכרן…" : state === "offline" ? "לא מקוון" : state === "error" ? "שגיאת סנכרון" : "מסונכרן";
}

/** Account + sync status for the home screen header. Signed out → "connect" + sign-in dialog. */
export function AccountChip({ onSettings }: { onSettings?: (page?: "account") => void }) {
  const { signedIn, account, sync, live } = useCloud();
  const projects = useLibrary((s) => s.sessions.length);
  const [open, setOpen] = useState(false);

  if (!signedIn) {
    return (
      <>
        <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => setOpen(true)}>
          <Cloud /> התחברות לענן
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            title="בימה בענן"
            description="סנכרון הפרויקטים והמדיה בין המחשבים שלך."
            className="max-w-md"
          >
            <SignIn bare />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  const icon =
    sync.state === "syncing" ? (
      <Loader2 className="size-3.5 animate-spin text-primary-text" />
    ) : sync.state === "offline" ? (
      <WifiOff className="size-3.5 text-amber-400" />
    ) : sync.state === "error" ? (
      <CloudOff className="size-3.5 text-red-400" />
    ) : (
      <Check className="size-3.5 text-emerald-400" />
    );
  const pct = sync.progress && sync.progress[1] ? Math.round((sync.progress[0] / sync.progress[1]) * 100) : null;
  const busy = sync.state === "syncing";
  const tone =
    sync.state === "error" ? "text-red-300" : sync.state === "offline" ? "text-amber-200" : "text-foreground";
  const headline =
    sync.state === "idle"
      ? "הכל מסונכרן"
      : sync.state === "syncing"
        ? sync.message || "מסנכרן…"
        : sync.state === "offline"
          ? "אין חיבור לאינטרנט"
          : sync.state === "error"
            ? "הסנכרון נתקל בבעיה"
            : "מתחבר…";
  const sub =
    sync.state === "idle"
      ? sync.lastSync
        ? `עודכן ${ago(sync.lastSync)}`
        : ""
      : sync.state === "offline"
        ? "השינויים יסונכרנו כשהחיבור יחזור."
        : sync.state === "error"
          ? sync.message
          : "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="pressable flex h-8 items-center gap-2 rounded-md pr-1 pl-2 hover:bg-accent data-[state=open]:bg-accent"
          aria-label={`חשבון: ${account?.email ?? ""} · ${syncLabel(sync.state)}`}
        >
          <span className="relative flex size-6 items-center justify-center rounded-full bg-raised text-[11px] font-bold text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]">
            {(account?.email?.[0] ?? "B").toUpperCase()}
            {live && <span className="absolute -bottom-0.5 -left-0.5 size-2 rounded-full bg-emerald-400 ring-2 ring-background" />}
          </span>
          <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
            {icon}
            <span className="hidden sm:inline">{busy && pct !== null ? `${pct}%` : syncLabel(sync.state)}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[300px] p-0">
        {/* who */}
        <div className="flex items-center gap-3 px-3.5 pt-3.5 pb-3">
          <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-[14px] font-bold text-foreground">
            {(account?.email?.[0] ?? "B").toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-right text-[13px] font-semibold text-foreground" dir="ltr">
              {account?.email}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", live ? "bg-emerald-400" : "bg-faint")} />
              {live ? "מחובר" : "מתחבר…"}
            </div>
          </div>
        </div>

        {/* sync state */}
        <div className="mx-2 mb-2 flex flex-col gap-2 rounded-md bg-raised px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--border)]" aria-live="polite">
          <div className="flex items-start gap-2">
            <span className="mt-0.5">{icon}</span>
            <div className="min-w-0 flex-1">
              <div className={cn("text-[13px] font-medium leading-snug", tone)}>{headline}</div>
              {sub && <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{sub}</div>}
            </div>
            {busy && pct !== null && <span className="text-[11px] text-muted-foreground tabular">{pct}%</span>}
          </div>
          {busy && pct !== null && (
            <div className="h-1 overflow-hidden rounded-full bg-accent">
              <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
            <span>פרויקטים</span>
            <span className="tabular text-foreground">{projects}</span>
          </div>
        </div>

        <div className="border-t border-border p-1">
          <DropdownMenuItem disabled={busy} onSelect={() => invoke("cloud_sync_now").catch(() => {})}>
            <RefreshCw className={cn(busy && "animate-spin")} /> {busy ? "מסנכרן…" : "סנכרון עכשיו"}
          </DropdownMenuItem>
          {onSettings && (
            <DropdownMenuItem onSelect={() => onSettings("account")}>
              <Settings2 /> הגדרות ענן…
            </DropdownMenuItem>
          )}
        </div>
        <div className="border-t border-border p-1">
          <DropdownMenuItem
            destructive
            onSelect={async () => {
              const ok = await confirmAction({
                title: "להתנתק מבימה בענן?",
                description: "הפרויקטים יישארו במחשב. הסנכרון ייפסק עד להתחברות מחדש.",
                confirmLabel: "התנתקות",
              });
              if (!ok) return;
              await signOut();
              toast("התנתקת מבימה בענן");
            }}
          >
            <LogOut /> התנתקות…
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
