import { useEffect, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eraser,
  MessageSquareText,
  MonitorPlay,
  Moon,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  RotateCcw,
  SendHorizontal,
  Square,
  Sun,
  Timer,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { SlideThumb, Stage } from "@/components/stage/Stage";
import { DocBar, DocSurface } from "./DocControls";
import { Button } from "@/components/ui/button";
import { Kbd, Slider, Tip } from "@/components/ui/primitives";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { EV, send, useTauriEvent } from "@/lib/events";
import { useSettings } from "@/lib/settings";
import { slideHasMedia, type MediaCommand, type MediaStatus } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";
import { peekNext, useSession } from "@/store/session";
import { closeProjector, openProjector, refreshMonitors } from "./actions";
import { PresenterView, ToolBar, ToolSurface, useBigView } from "./PresenterTools";
import { WowGrid } from "./WowPanel";

const cmd = (c: MediaCommand) => send<MediaCommand>(EV.mediaCmd, c);

/* ------------------------------------------------------------------ projector control (header) */

function ProjectorControl() {
  const projector = useSession((s) => s.projector);
  const monitors = useSession((s) => s.monitors);
  const preferred = useSettings((s) => s.preferredMonitor);
  const setSettings = useSettings((s) => s.set);

  return (
    <div className="flex items-center">
      <Tip content={<>{projector.open ? "עצירת הקרנה" : "התחלת הקרנה"} <Kbd>F5</Kbd></>}>
        <Button
          size="sm"
          variant={projector.open ? "secondary" : "default"}
          className="rounded-l-none"
          onClick={() => (projector.open ? closeProjector() : openProjector())}
        >
          {projector.open ? <Square className="size-3 fill-current" /> : <MonitorPlay />}
          {projector.open ? "עצירת הקרנה" : "התחלת הקרנה"}
        </Button>
      </Tip>
      <DropdownMenu onOpenChange={(o) => o && refreshMonitors()}>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant={projector.open ? "secondary" : "default"}
            className="rounded-r-none border-r border-r-black/15 px-1.5"
            aria-label="בחירת מסך"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>
            {monitors.length > 1 ? `זוהו ${monitors.length} מסכים` : "לא זוהה מסך נוסף"}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setSettings({ preferredMonitor: null })}>
            <span className={cn("size-1.5 rounded-full", preferred === null ? "bg-primary" : "bg-transparent")} />
            אוטומטי
          </DropdownMenuItem>
          {monitors.map((m) => (
            <DropdownMenuItem
              key={m.index}
              onSelect={() => {
                setSettings({ preferredMonitor: m.index });
                openProjector({ monitor: m.index });
              }}
            >
              <span className={cn("size-1.5 rounded-full", preferred === m.index ? "bg-primary" : "bg-transparent")} />
              <span className="flex-1 truncate">
                מסך {m.index + 1} {m.primary ? "(ראשי)" : ""}
              </span>
              <span className="text-xs text-muted-foreground tabular" dir="ltr">
                {m.width}×{m.height}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openProjector({ windowed: true })}>
            <MonitorPlay /> חלון בדיקה
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ------------------------------------------------------------------ media transport */

function Transport() {
  const live = useSession((s) => s.live);
  const setLiveMedia = useSession((s) => s.setLiveMedia);
  const [st, setSt] = useState<MediaStatus | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);

  useTauriEvent<MediaStatus>(EV.mediaStatus, (s) => {
    if (s.key === useSession.getState().live.key) setSt(s);
  });
  useEffect(() => setSt(null), [live.key]);

  const dur = st?.duration ?? 0;
  const cur = scrub ?? st?.currentTime ?? 0;
  const paused = st?.paused ?? true;
  const muted = live.media.muted || live.media.volume === 0;

  return (
    <div className="enter-fade flex flex-col gap-2 rounded-xl border border-border bg-background/60 p-2.5">
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          className="size-10 shrink-0 rounded-full"
          variant={paused ? "default" : "secondary"}
          onClick={() => cmd({ type: "toggle" })}
          aria-label={paused ? "ניגון" : "השהיה"}
        >
          {paused ? <Play className="size-4 translate-x-[-1px] fill-current" /> : <Pause className="size-4 fill-current" />}
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Slider
            dir="ltr"
            min={0}
            max={Math.max(dur, 0.1)}
            step={0.1}
            value={[cur]}
            onValueChange={([v]) => setScrub(v)}
            onValueCommit={([v]) => {
              cmd({ type: "seek", time: v });
              setTimeout(() => setScrub(null), 250);
            }}
          />
          <div className="flex justify-between text-[11px] text-muted-foreground tabular" dir="ltr">
            <span>{formatTime(cur)}</span>
            <span>-{formatTime(Math.max(0, dur - cur))}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <Tip content="מההתחלה">
          <Button size="icon-sm" variant="ghost" onClick={() => cmd({ type: "restart" })}>
            <RotateCcw />
          </Button>
        </Tip>
        <Tip content={<>10 שניות אחורה <Kbd>J</Kbd></>}>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] tabular" onClick={() => cmd({ type: "seekBy", delta: -10 })}>
            −10
          </Button>
        </Tip>
        <Tip content={<>10 שניות קדימה <Kbd>L</Kbd></>}>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] tabular" onClick={() => cmd({ type: "seekBy", delta: 10 })}>
            +10
          </Button>
        </Tip>
        <Tip content="ניגון חוזר">
          <Button
            size="icon-sm"
            variant="ghost"
            className={cn(live.media.loop && "bg-primary/15 text-primary-text hover:text-primary-text")}
            onClick={() => setLiveMedia({ loop: !live.media.loop })}
          >
            <Repeat />
          </Button>
        </Tip>
        <div className="flex-1" />
        <Tip content={<>השתקה <Kbd>M</Kbd></>}>
          <Button size="icon-sm" variant="ghost" onClick={() => setLiveMedia({ muted: !live.media.muted })}>
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
        </Tip>
        <Slider
          dir="ltr"
          className="w-20"
          min={0}
          max={1}
          step={0.02}
          value={[live.media.muted ? 0 : live.media.volume]}
          onValueChange={([v]) => setLiveMedia({ volume: v, muted: v === 0 })}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ screen-state segmented control */

function ScreenModes() {
  const blackout = useSession((s) => s.live.blackout);
  const hasSlide = useSession((s) => !!s.live.slide);
  const { toggleBlackout, clearLive } = useSession.getState();

  const opt = (
    active: boolean,
    onClick: () => void,
    icon: ReactNode,
    label: string,
    kbd: string,
    tone: "black" | "white" | "plain",
    disabled = false,
  ) => (
    <Tip content={<>{label} <Kbd>{kbd}</Kbd></>}>
      <button
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "pressable flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-[12px] font-medium disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-3.5",
          !active && "bg-raised text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-accent hover:text-foreground",
          active && tone === "black" && "bg-live-soft text-live shadow-[inset_0_0_0_1px_var(--live)]",
          active && tone === "white" && "bg-white text-zinc-900",
        )}
      >
        {icon}
        {label}
      </button>
    </Tip>
  );

  return (
    <div className="flex gap-1.5">
      {opt(blackout === "black", () => toggleBlackout("black"), <Moon />, blackout === "black" ? "ביטול השחרה" : "השחרה", "B", "black")}
      {opt(blackout === "white", () => toggleBlackout("white"), <Sun />, "מסך לבן", "W", "white")}
      {opt(false, clearLive, <Eraser />, "ניקוי", "-", "plain", !hasSlide)}
    </div>
  );
}

/* ------------------------------------------------------------------ message overlay */

function MessageBox() {
  const message = useSession((s) => s.live.message);
  const setMessage = useSession((s) => s.setMessage);
  const [msg, setMsg] = useState("");

  if (message)
    return (
      <div className="enter-fade flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 py-1.5 pr-3 pl-1.5">
        <span className="size-1.5 shrink-0 rounded-full bg-primary live-pulse" />
        <span className="min-w-0 flex-1 truncate text-xs">{message}</span>
        <Button size="sm" variant="ghost" className="h-7 text-foreground" onClick={() => setMessage(null)}>
          <X /> הסתרה
        </Button>
      </div>
    );

  return (
    <form
      className="flex items-center gap-1 rounded-md bg-raised pr-2.5 pl-1 shadow-[inset_0_0_0_1px_var(--border)] focus-within:shadow-[inset_0_0_0_1px_var(--ring)]"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(msg);
      }}
    >
      <MessageSquareText className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        placeholder="הודעה לקהל…"
        className="h-8 min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-faint"
      />
      <Button size="icon-sm" type="submit" variant={msg.trim() ? "default" : "ghost"} disabled={!msg.trim()} aria-label="הצגה">
        <SendHorizontal className="size-3.5 -scale-x-100" />
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ clock */

function Clock() {
  const [now, setNow] = useState(new Date());
  const [since, setSince] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span className="text-sm font-medium text-foreground tabular">
        {now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
      </span>
      <Tip content="איפוס" side="top">
        <button className="pressable flex min-h-7 items-center gap-1.5 rounded-md px-1.5 hover:bg-accent hover:text-foreground" onClick={() => setSince(Date.now())}>
          <Timer className="size-3.5" />
          <span className="tabular">{formatTime((now.getTime() - since) / 1000)}</span>
          <span>משך</span>
        </button>
      </Tip>
    </div>
  );
}

/* ------------------------------------------------------------------ collapsible section */

function Section({ id, label, children, aside }: { id: string; label: string; children: ReactNode; aside?: ReactNode }) {
  const key = `bima-section-${id}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== "0");
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            setOpen(!open);
            localStorage.setItem(key, open ? "0" : "1");
          }}
          className="flex min-h-7 flex-1 items-center gap-1 rounded px-0.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
          aria-expanded={open}
        >
          <ChevronDown className={cn("size-3.5 transition-transform duration-200", !open && "rotate-90")} />
          {label}
        </button>
        {aside}
      </div>
      {open && <div className="enter-fade">{children}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ panel */

export function LivePanel() {
  const live = useSession((s) => s.live);
  const projectorOpen = useSession((s) => s.projector.open);
  const liveItem = useSession((s) => s.items.find((i) => i.id === s.live.itemId));
  const next = useSession(useShallow((s) => peekNext(s) ?? { slide: null, item: null, index: -1 }));
  const stale = useSession((s) => {
    if (!s.live.slide) return false;
    const it = s.items.find((i) => i.id === s.live.itemId);
    const cur = it?.slides.find((x) => x.id === s.live.slide!.id);
    return !!cur && JSON.stringify(cur.content) !== JSON.stringify(s.live.slide.content);
  });
  const showNext = useSettings((s) => s.showNextPreview);
  const { next: goNext, prev, goLive, restartTimer } = useSession.getState();

  const big = useBigView();
  const isTimer = live.slide?.content.kind === "text" && live.slide.content.text.template === "timer";
  const hasMedia = slideHasMedia(live.slide);
  const onAir = projectorOpen && !!live.slide && live.blackout === "none";
  const status = !projectorOpen ? "מקרן כבוי" : live.blackout !== "none" ? "מוחשך" : live.slide ? "בשידור" : "מקרן פתוח";

  return (
    <aside className="flex min-h-0 flex-col border-r border-border bg-card">
      {/* header: is the audience seeing anything? */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border pr-3 pl-2">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold" aria-live="polite">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full transition-colors duration-300",
              onAir ? "bg-live live-pulse" : projectorOpen ? "bg-amber-400" : "bg-faint",
            )}
          />
          <span className="truncate">{status}</span>
        </div>
        <ProjectorControl />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {/* 1. what the audience sees */}
        <div className="flex flex-col gap-2">
          <div
            className={cn(
              "relative aspect-video overflow-hidden rounded-lg bg-black transition-shadow duration-300",
              onAir ? "shadow-[0_0_0_2px_var(--live),0_0_0_6px_var(--live-soft)]" : "shadow-[0_0_0_1px_var(--border-strong)]",
            )}
          >
            <Stage live={live} role={projectorOpen ? "follower" : "master"} />
            {!big.open && <DocSurface />}
            {!big.open && <ToolSurface />}
            {!live.slide && !live.standby && live.blackout === "none" && (
              <div className="absolute inset-0 flex items-center justify-center text-[12px] text-faint">אין שקופית בשידור</div>
            )}
            {live.blackout !== "none" && (
              <div className="enter-fade absolute inset-0 flex flex-col items-center justify-center gap-1">
                {live.blackout === "black" ? <Moon className="size-5 text-zinc-500" /> : <Sun className="size-5 text-zinc-500" />}
                <span className="text-[11px] text-zinc-500">מסך {live.blackout === "black" ? "שחור" : "לבן"}</span>
              </div>
            )}
            {liveItem && (
              <span className="absolute bottom-1.5 left-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular">
                {live.slideIndex + 1}/{liveItem.slides.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 pr-0.5">
            <div className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{liveItem ? liveItem.title : "לא נבחרה שקופית"}</div>
            {big.button}
          </div>
          <DocBar />

          {(stale || isTimer) && (
            <div className="flex gap-1.5">
              {stale && (
                <Button size="sm" variant="secondary" className="enter-fade flex-1 text-primary-text" onClick={() => liveItem && goLive(liveItem.id, live.slideIndex)}>
                  <RefreshCw /> עדכון בשידור
                </Button>
              )}
              {isTimer && (
                <Button size="sm" variant="secondary" className="enter-fade flex-1" onClick={restartTimer}>
                  <RotateCcw /> איפוס טיימר
                </Button>
              )}
            </div>
          )}
        </div>

        {/* 2. media - only when relevant */}
        {hasMedia && <Transport key={live.key} />}

        {/* 3. navigation: back · next (with what comes next) */}
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <Tip content={<>שקופית קודמת <Kbd>PgUp</Kbd> <Kbd>←</Kbd></>}>
              <Button variant="secondary" onClick={prev} className="h-[72px] w-16 shrink-0 flex-col gap-1 text-[11px]" aria-label="אחורה">
                <ChevronRight className="size-5" />
                אחורה
              </Button>
            </Tip>
            <Tip content={<>שקופית הבאה <Kbd>PgDn</Kbd> <Kbd>→</Kbd> <Kbd>רווח</Kbd></>}>
              <button
                onClick={goNext}
                className="pressable group flex h-[72px] min-w-0 flex-1 items-center gap-3 rounded-lg bg-primary pr-3 pl-2 text-right text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.14)] outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px] font-semibold leading-tight">הבא</span>
                  {showNext && (
                    <span className="truncate text-[11px] leading-tight opacity-95">
                      {next.item ? `${next.item.id !== live.itemId ? next.item.title + " · " : ""}שקופית ${next.index + 1}` : "סוף הרשימה"}
                    </span>
                  )}
                </div>
                {showNext && next.slide ? (
                  <div className="relative aspect-video h-[52px] shrink-0 overflow-hidden rounded-md bg-black shadow-[0_0_0_1px_rgb(0_0_0/0.25)]">
                    <SlideThumb key={next.slide.id} slide={next.slide} />
                  </div>
                ) : (
                  <ChevronLeft className="size-6 shrink-0" />
                )}
              </button>
            </Tip>
          </div>
          <ScreenModes />
        </div>

        {/* 4. presenter tools */}
        <Section id="tools" label="כלי מציג">
          <ToolBar />
        </Section>

        {/* 5. wow moments */}
        <Section id="wow" label="אפקטים">
          <WowGrid />
        </Section>

        {/* 6. message on screen */}
        <Section id="message" label="הודעה לקהל">
          <MessageBox />
        </Section>
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2">
        <Clock />
      </div>
      <PresenterView open={big.open} onOpenChange={big.setOpen} />
    </aside>
  );
}
