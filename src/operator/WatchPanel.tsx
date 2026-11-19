/**
 * The watch remote, from the top bar: the chip shows whether the watch is with us, and opens a
 * small panel to pair, pause or unpair it and set the talk length. Opening it with no watch
 * paired starts looking; closing it before pairing stops.
 */
import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Loader2, Watch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch, Tip } from "@/components/ui/primitives";
import { confirmAction } from "@/components/ConfirmHost";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { pairWatch, useRemote } from "./remote";

const TALK = [0, 20, 30, 45, 60, 90, 120];

export function WatchChip() {
  const enabled = useSettings((s) => s.remoteEnabled);
  const watch = useSettings((s) => s.remoteWatch);
  const { state, battery, pairCode } = useRemote();
  const [open, setOpen] = useState(false);

  const linked = enabled && !!watch && state === "connected";
  const looking = enabled && !!watch && !linked;
  const tip = linked
    ? `השעון מחובר${battery != null ? ` · ${battery}%` : ""}`
    : looking
      ? state === "no-bluetooth"
        ? "ה-Bluetooth במחשב כבוי"
        : "מחפש את השעון"
      : watch
        ? "שליטה משעון כבויה"
        : "חיבור שעון";

  // a pairing that ended (or failed) after the panel was closed: stop looking
  useEffect(() => {
    const s = useSettings.getState();
    if (!pairCode && !open && !s.remoteWatch && s.remoteEnabled) s.set({ remoteEnabled: false });
  }, [pairCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const onOpenChange = (v: boolean) => {
    setOpen(v);
    const s = useSettings.getState();
    // no watch yet: look while the panel is open, stop when it closes (unless a code is up)
    if (!s.remoteWatch) {
      if (v && !s.remoteEnabled) s.set({ remoteEnabled: true });
      if (!v && !useRemote.getState().pairCode) s.set({ remoteEnabled: false });
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Tip content={tip}>
        <Popover.Trigger asChild>
          <button
            aria-label={tip}
            className={cn(
              "pressable flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors duration-[160ms] hover:bg-accent data-[state=open]:bg-accent",
              linked ? "text-foreground" : "text-muted-foreground",
              pairCode && "text-primary",
            )}
          >
            <span className="relative">
              <Watch className={cn("size-3.5", looking && "opacity-50")} />
              {linked && <span className="absolute -top-0.5 -left-0.5 size-1.5 rounded-full bg-emerald-400 ring-2 ring-background" />}
            </span>
            {linked && battery != null && <span className="hidden tabular lg:inline">{battery}%</span>}
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content
          dir="rtl"
          align="end"
          sideOffset={6}
          className="anim-pop origin-popover z-50 w-72 rounded-lg border border-border bg-popover p-1 text-[13px] shadow-xl shadow-black/40 outline-none"
        >
          {watch ? <Paired close={() => setOpen(false)} /> : <Pairing />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Pairing() {
  const { state, found, pairCode } = useRemote();
  return (
    <div className="flex flex-col">
      <Head title="חיבור שעון" />
      {pairCode ? (
        <div className="flex flex-col items-center gap-1 px-3 pt-2 pb-4">
          <span className="text-[12px] text-muted-foreground">אשר בשעון את הקוד</span>
          <span dir="ltr" className="text-[28px] font-semibold tracking-[0.2em] tabular">
            {pairCode}
          </span>
        </div>
      ) : state === "no-bluetooth" ? (
        <Note>ה-Bluetooth במחשב כבוי.</Note>
      ) : found.length ? (
        <div className="flex flex-col pb-1">
          {found.map((f) => (
            <div key={f.id} className="flex h-10 items-center gap-2 rounded-md px-2 hover:bg-accent/50">
              <Watch className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <Button size="sm" onClick={() => void pairWatch(f.id)}>
                חיבור
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-3 pt-1 pb-3 text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
          <span>מחפש… פתח את בימה בשעון.</span>
        </div>
      )}
    </div>
  );
}

function Paired({ close }: { close: () => void }) {
  const s = useSettings();
  const r = useRemote();
  const watch = s.remoteWatch!;
  const status = !s.remoteEnabled
    ? "כבוי"
    : r.state === "connected"
      ? `מחובר${r.battery != null ? ` · ${r.battery}%` : ""}`
      : r.state === "no-bluetooth"
        ? "ה-Bluetooth במחשב כבוי"
        : "מחפש…";
  const linked = s.remoteEnabled && r.state === "connected";

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2.5 px-2 pt-2 pb-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-accent", linked ? "text-foreground" : "text-muted-foreground")}>
          <Watch className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{watch.name}</span>
          <span className={cn("text-[12px]", linked ? "text-emerald-400" : "text-muted-foreground")}>{status}</span>
        </div>
        <Switch checked={s.remoteEnabled} onCheckedChange={(v) => s.set({ remoteEnabled: v })} aria-label="שליטה משעון" />
      </div>
      <div className="mx-1 h-px bg-border" />
      <label className="flex h-10 items-center gap-2 px-2">
        <span className="flex-1">משך ההרצאה</span>
        <select
          value={s.talkMinutes}
          onChange={(e) => s.set({ talkMinutes: Number(e.target.value) })}
          className="h-7 rounded-md border border-border bg-raised px-1.5 text-[12px] text-foreground"
        >
          {TALK.map((m) => (
            <option key={m} value={m}>
              {m ? `${m} דקות` : "בלי התראות"}
            </option>
          ))}
        </select>
      </label>
      <p className="px-2 pb-2 text-[12px] text-muted-foreground">
        {s.talkMinutes ? "רטט 5 דקות ודקה לפני הסוף, ובסוף." : "השעון יראה כמה זמן עבר."}
      </p>
      <div className="mx-1 h-px bg-border" />
      <button
        className="m-1 flex h-8 items-center rounded-md px-2 text-red-400 transition-colors hover:bg-red-500/10"
        onClick={async () => {
          close();
          const ok = await confirmAction({
            title: `לנתק את ${watch.name}?`,
            description: "כדי לשלוט שוב תצטרך לחבר אותו מחדש.",
            confirmLabel: "ניתוק",
          });
          if (ok) s.set({ remoteWatch: null, remoteEnabled: false });
        }}
      >
        ניתוק השעון
      </button>
    </div>
  );
}

function Head({ title }: { title: string }) {
  return <div className="px-3 pt-2.5 pb-2 text-[12px] font-medium text-muted-foreground">{title}</div>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pt-1 pb-3 text-muted-foreground">{children}</p>;
}
