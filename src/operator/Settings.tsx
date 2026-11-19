import { useEffect, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Cloud, FolderOpen, HardDrive, Keyboard, MonitorPlay, Settings2, Sparkles, Trash2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider, Switch } from "@/components/ui/primitives";
import { useSettings } from "@/lib/settings";
import { THEMES } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { cleanupMedia } from "./actions";
import { CloudAccountCard } from "./CloudAccount";
import { UpdateRow } from "./dialogs";
import { isMac } from "@/lib/platform";

/* ------------------------------------------------------------------ building blocks */

/** A titled group of rows on one panel (macOS / Linear settings style). */
function Group({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {title && <h3 className="px-1 text-[12px] font-semibold text-muted-foreground">{title}</h3>}
      <div className="flex flex-col divide-y divide-border rounded-lg bg-raised shadow-[inset_0_0_0_1px_var(--border)]">{children}</div>
      {footer && <p className="px-1 text-[12px] leading-relaxed text-faint">{footer}</p>}
    </section>
  );
}

/** One setting: label + explanation on the right, the control on the left. Whole row is the hit target for switches. */
function Row({ label, desc, children, htmlFor }: { label: string; desc?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 px-4 py-3">
      <label htmlFor={htmlFor} className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        {desc && <span className="text-[12px] leading-relaxed text-muted-foreground">{desc}</span>}
      </label>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <Switch id={id} checked={checked} onCheckedChange={onChange} />;
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-md bg-background p-0.5 shadow-[inset_0_0_0_1px_var(--border)]" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "h-7 rounded-[5px] px-3 text-[12px] font-medium transition-colors duration-[160ms]",
            value === o.v ? "bg-accent text-foreground shadow-[0_0_0_1px_var(--border-strong)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ pages */

function General() {
  const s = useSettings();
  return (
    <>
      <Group title="גרסה">
        <div className="px-4 py-3">
          <UpdateRow />
        </div>
      </Group>
      <Group title="מראה" footer="משפיע על מסך המפעיל בלבד.">
        <div className="flex flex-wrap gap-2 px-4 py-3.5">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => s.set({ theme: t.id })}
              aria-pressed={s.theme === t.id}
              className={cn(
                "pressable flex h-8 items-center gap-2 rounded-full py-1 pr-1 pl-3 text-[12px]",
                s.theme === t.id
                  ? "bg-accent text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]"
                  : "text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:text-foreground",
              )}
            >
              <span className="size-6 rounded-full ring-1 ring-white/10" style={{ background: t.primary }} />
              {t.label}
            </button>
          ))}
        </div>
      </Group>
    </>
  );
}

function Projection() {
  const s = useSettings();
  return (
    <>
      <Group title="מעבר בין שקופיות">
        <Row label="סוג מעבר">
          <Segmented
            value={s.transition}
            options={[
              { v: "fade", label: "עמעום" },
              { v: "cut", label: "חיתוך" },
            ]}
            onChange={(v) => s.set({ transition: v })}
          />
        </Row>
        {s.transition === "fade" && (
          <Row label="משך העמעום" desc={<span className="tabular">{(s.fadeMs / 1000).toFixed(2)} שניות</span>}>
            <Slider className="w-44" dir="ltr" min={100} max={1200} step={50} value={[s.fadeMs]} onValueChange={([v]) => s.set({ fadeMs: v })} aria-label="משך העמעום" />
          </Row>
        )}
      </Group>
      <Group title="מסך המתנה">
        <Row label="שם הפרויקט" desc="מוצג כשאין שקופית בשידור, במקום מסך שחור." htmlFor="set-standby">
          <Toggle id="set-standby" checked={s.standby} onChange={(v) => s.set({ standby: v })} />
        </Row>
        {s.standby && (
          <Row label="שעון" htmlFor="set-clock">
            <Toggle id="set-clock" checked={s.standbyClock} onChange={(v) => s.set({ standbyClock: v })} />
          </Row>
        )}
      </Group>
      {/* macOS: mirroring is set in System Settings → Displays; Bima doesn't change it */}
      {!isMac && (
        <Group title="מסכים">
          <Row
            label="מעבר אוטומטי למצב הרחבה"
            desc="כשהמקרן במצב שכפול, התצוגה עוברת להרחבה בתחילת ההקרנה וחוזרת בסיום."
            htmlFor="set-extend"
          >
            <Toggle id="set-extend" checked={s.autoExtend} onChange={(v) => s.set({ autoExtend: v })} />
          </Row>
        </Group>
      )}
    </>
  );
}

function Control({ onShortcuts }: { onShortcuts?: () => void }) {
  const s = useSettings();
  return (
    <>
      <Group title="קליקר ומקלדת">
        <Row
          label="קליקר גלובלי"
          desc="שליטה גם כשחלון אחר פעיל. המקשים PgUp, PgDn, B ונקודה לא יגיעו לתוכנות אחרות."
          htmlFor="set-global"
        >
          <Toggle id="set-global" checked={s.globalClicker} onChange={(v) => s.set({ globalClicker: v })} />
        </Row>
        <Row label="היפוך חיצים" desc="חץ שמאלה מקדם את ההצגה." htmlFor="set-arrows">
          <Toggle id="set-arrows" checked={s.reverseArrows} onChange={(v) => s.set({ reverseArrows: v })} />
        </Row>
      </Group>
      <Group title="מסך המפעיל">
        <Row label="תצוגה מקדימה של השקופית הבאה" htmlFor="set-next">
          <Toggle id="set-next" checked={s.showNextPreview} onChange={(v) => s.set({ showNextPreview: v })} />
        </Row>
      </Group>
      {onShortcuts && (
        <Button variant="secondary" className="self-start" onClick={onShortcuts}>
          <Keyboard /> קיצורי מקלדת…
        </Button>
      )}
    </>
  );
}

function Effects() {
  const s = useSettings();
  return (
    <Group title="אפקטים" footer="הצליל מושמע מהמחשב שמחובר למקרן.">
      <Row label="צלילים" htmlFor="set-fx">
        <Toggle id="set-fx" checked={s.fxSound} onChange={(v) => s.set({ fxSound: v })} />
      </Row>
      <Row label="עוצמה" desc={<span className="tabular">{Math.round(s.fxVolume * 100)}%</span>}>
        <Slider
          className={cn("w-44", !s.fxSound && "opacity-40")}
          dir="ltr"
          min={0}
          max={1}
          step={0.05}
          disabled={!s.fxSound}
          value={[s.fxVolume]}
          onValueChange={([v]) => s.set({ fxVolume: v })}
          aria-label="עוצמת האפקטים"
        />
      </Row>
    </Group>
  );
}

function System() {
  const s = useSettings();
  return (
    <Group title="אמינות" footer="מומלץ במחשבים ניידים.">
      <Row label="מניעת שינה" desc="המסך לא נכבה והמחשב לא נכנס לשינה כל עוד בימה פתוחה." htmlFor="set-awake">
        <Toggle id="set-awake" checked={s.keepAwake} onChange={(v) => s.set({ keepAwake: v })} />
      </Row>
    </Group>
  );
}

function Account() {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-[12px] font-semibold text-muted-foreground">בימה בענן</h3>
      <CloudAccountCard />
      <p className="px-1 text-[12px] leading-relaxed text-faint">
        סנכרון אוטומטי בין המחשבים המחוברים לאותו חשבון.
      </p>
    </section>
  );
}

function Storage() {
  return (
    <Group title="ספריית מדיה" footer="קבצים מיובאים נשמרים במחשב זה.">
      <Row label="תיקיית המדיה" >
        <Button size="sm" variant="secondary" onClick={() => invoke("reveal_media_dir")}>
          <FolderOpen /> פתיחה
        </Button>
      </Row>
      <Row label="ניקוי קבצים" desc="מחיקת קבצים שאינם בשימוש.">
        <Button size="sm" variant="secondary" className="text-red-400 hover:text-red-300" onClick={cleanupMedia}>
          <Trash2 /> ניקוי…
        </Button>
      </Row>
    </Group>
  );
}

/* ------------------------------------------------------------------ dialog */

const PAGES = [
  { id: "general", label: "כללי", icon: Settings2 },
  { id: "projection", label: "הקרנה", icon: MonitorPlay },
  { id: "control", label: "שליטה", icon: Keyboard },
  { id: "effects", label: "אפקטים וקול", icon: Sparkles },
  { id: "system", label: "מערכת", icon: Zap },
  { id: "account", label: "ענן וחשבון", icon: Cloud },
  { id: "storage", label: "אחסון", icon: HardDrive },
] as const;
type PageId = (typeof PAGES)[number]["id"];

export function SettingsDialog({
  open,
  onOpenChange,
  onShortcuts,
  initialPage = "general",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onShortcuts?: () => void;
  initialPage?: PageId;
}) {
  const [page, setPage] = useState<PageId>(initialPage);
  useEffect(() => {
    if (open) setPage(initialPage);
  }, [open, initialPage]);
  const current = PAGES.find((p) => p.id === page)!;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="anim-fade fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content
          dir="rtl"
          className="anim-modal fixed top-1/2 left-1/2 z-50 flex h-[min(86vh,600px)] w-[min(94vw,820px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-popover shadow-2xl ring-1 ring-border-strong outline-none"
        >
          {/* categories */}
          <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-l border-border bg-card p-2" aria-label="קטגוריות הגדרות">
            <DialogPrimitive.Title className="px-2.5 pt-2 pb-3 text-[15px] font-semibold">הגדרות</DialogPrimitive.Title>
            {PAGES.map((p) => (
              <button
                key={p.id}
                onClick={() => setPage(p.id)}
                aria-current={page === p.id ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors duration-[160ms]",
                  page === p.id ? "bg-raised font-medium text-foreground shadow-[inset_0_0_0_1px_var(--border)]" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <p.icon className="size-4 shrink-0" />
                {p.label}
              </button>
            ))}
          </nav>

          {/* page */}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
              <h2 className="text-[15px] font-semibold">{current.label}</h2>
              <DialogPrimitive.Close className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="סגירה">
                <X className="size-4" />
              </DialogPrimitive.Close>
            </header>
            <DialogPrimitive.Description className="sr-only">הגדרות בימה - {current.label}</DialogPrimitive.Description>
            <div key={page} className="enter-fade flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-6 py-5">
              {page === "general" && <General />}
              {page === "projection" && <Projection />}
              {page === "control" && <Control onShortcuts={onShortcuts} />}
              {page === "effects" && <Effects />}
              {page === "system" && <System />}
              {page === "account" && <Account />}
              {page === "storage" && <Storage />}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export type SettingsPage = PageId;
