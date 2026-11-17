import { useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  Maximize2,
  MousePointer2,
  PenLine,
  Sun,
  ZoomIn,
  Crosshair,
  Undo2,
} from "lucide-react";
import { DocBar, DocSurface } from "./DocControls";
import { Stage } from "@/components/stage/Stage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Kbd, Tip } from "@/components/ui/primitives";
import { clearInk, PEN_COLORS, setPresenter, usePresenter, type ToolMode } from "@/lib/presenter";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";
import { WowGrid } from "./WowPanel";

/**
 * Transparent surface laid over a stage preview. Pointer position is normalised (0..1)
 * and broadcast so the projector draws the laser / spotlight / zoom / ink in the same spot.
 */
export function ToolSurface() {
  const mode = usePresenter((s) => s.mode);
  const drawing = useRef(false);
  if (mode === "none") return null;

  const pos = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))] as [
      number,
      number,
    ];
  };

  return (
    <div
      className={cn("absolute inset-0 z-10 touch-none", mode === "pen" ? "cursor-crosshair" : "cursor-none")}
      onPointerMove={(e) => {
        const [x, y] = pos(e);
        const st = usePresenter.getState();
        if (drawing.current && st.mode === "pen") {
          const strokes = st.strokes.slice();
          const last = strokes[strokes.length - 1];
          strokes[strokes.length - 1] = { ...last, pts: [...last.pts, [x, y]] };
          setPresenter({ x, y, active: true, strokes });
        } else setPresenter({ x, y, active: true });
      }}
      onPointerLeave={() => {
        drawing.current = false;
        setPresenter({ active: false });
      }}
      onPointerDown={(e) => {
        const st = usePresenter.getState();
        const [x, y] = pos(e);
        if (st.mode === "pen") {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          setPresenter({ strokes: [...st.strokes, { color: st.color, width: 5, pts: [[x, y]] }] });
        } else if (st.mode === "zoom") setPresenter({ zoomLocked: !st.zoomLocked, x, y });
      }}
      onPointerUp={() => (drawing.current = false)}
      onWheel={(e) => {
        const st = usePresenter.getState();
        const d = e.deltaY > 0 ? -1 : 1;
        if (st.mode === "zoom") setPresenter({ zoom: Math.min(5, Math.max(1.2, +(st.zoom + d * 0.25).toFixed(2))) });
        if (st.mode === "spotlight") setPresenter({ radius: Math.min(0.4, Math.max(0.05, st.radius + d * 0.015)) });
      }}
    />
  );
}

const TOOLS: { id: ToolMode; icon: typeof Crosshair; label: string; hint: string }[] = [
  { id: "none", icon: MousePointer2, label: "ללא", hint: "ללא כלי" },
  { id: "laser", icon: Crosshair, label: "לייזר", hint: "נקודת לייזר" },
  { id: "spotlight", icon: Sun, label: "זרקור", hint: "הדגשת אזור · גלגלת לשינוי גודל" },
  { id: "zoom", icon: ZoomIn, label: "זום", hint: "הגדלה · גלגלת לעוצמה · לחיצה לנעילה" },
  { id: "pen", icon: PenLine, label: "עט", hint: "ציור על השקופית" },
];

export function ToolBar({ big }: { big?: boolean }) {
  const p = usePresenter();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative flex rounded-lg border border-border bg-background/60 p-0.5">
        <span
          aria-hidden
          className="absolute inset-y-0.5 right-0.5 rounded-md bg-primary/15 ring-1 ring-primary/40 transition-transform duration-250 ease-[cubic-bezier(0.77,0,0.175,1)]"
          style={{
            width: `calc((100% - 4px) / ${TOOLS.length})`,
            transform: `translateX(${-100 * TOOLS.findIndex((t) => t.id === p.mode)}%)`,
          }}
        />
        {TOOLS.map((t) => (
          <Tip key={t.id} content={t.hint}>
            <button
              onClick={() => setPresenter({ mode: t.id, zoomLocked: false })}
              className={cn(
                "relative z-10 flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-[11px] transition-colors duration-[160ms]",
                big ? "h-12" : "h-10",
                p.mode === t.id ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {/* icon carries the accent (non-text: 3:1 is enough); the label stays full-contrast */}
              <t.icon className={cn("size-4", p.mode === t.id && "text-primary-text")} />
              {t.label}
            </button>
          </Tip>
        ))}
      </div>

      {p.mode === "pen" && (
        <div className="enter-fade flex items-center gap-1.5 px-0.5">
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setPresenter({ color: c })}
              className={cn(
                "pressable size-5 rounded-full ring-1 ring-white/15",
                p.color === c && "ring-2 ring-primary ring-offset-2 ring-offset-card",
              )}
              style={{ background: c }}
              aria-label={c}
            />
          ))}
          <div className="flex-1" />
          <Tip content="ביטול קו אחרון">
            <Button size="icon-sm" variant="ghost" disabled={!p.strokes.length} onClick={() => setPresenter({ strokes: p.strokes.slice(0, -1) })}>
              <Undo2 />
            </Button>
          </Tip>
          <Tip content="ניקוי ציור">
            <Button size="icon-sm" variant="ghost" disabled={!p.strokes.length} onClick={clearInk}>
              <Eraser />
            </Button>
          </Tip>
        </div>
      )}
      {p.mode === "zoom" && (
        <div className="enter-fade flex items-center justify-between px-1 text-[11px] text-muted-foreground">
          <span>
            הגדלה <span className="text-foreground tabular">×{p.zoom.toFixed(1)}</span>
          </span>
          <span>{p.zoomLocked ? "נעול · לחיצה לשחרור" : "לחיצה לנעילה"}</span>
        </div>
      )}
      {p.mode === "spotlight" && (
        <div className="enter-fade px-1 text-[11px] text-muted-foreground">גלגלת לשינוי גודל</div>
      )}
    </div>
  );
}

/** Large presenter view: comfortable drawing / pointing on a big preview. */
export function PresenterView({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const live = useSession((s) => s.live);
  const projectorOpen = useSession((s) => s.projector.open);
  const { next, prev } = useSession.getState();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="מסך מציג" description="מוצג לקהל בזמן אמת." className="max-w-[min(92vw,1500px)] gap-3">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-border">
          <Stage live={live} role={projectorOpen ? "follower" : "master"} />
          <DocSurface />
          <ToolSurface />
        </div>
        <DocBar />
        <div className="grid grid-cols-[1fr_1fr_auto] items-start gap-4">
          <ToolBar big />
          <WowGrid />
          <div className="flex flex-col gap-1.5">
            <Button size="lg" className="h-14 px-8 text-base" onClick={next}>
              קדימה <ChevronLeft />
            </Button>
            <Button size="lg" variant="secondary" className="h-10" onClick={prev}>
              <ChevronRight /> אחורה
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function useBigView() {
  const [open, setOpen] = useState(false);
  const button = (
    <Tip content={<>מסך מציג גדול</>}>
      <Button size="icon-sm" variant="ghost" onClick={() => setOpen(true)}>
        <Maximize2 />
      </Button>
    </Tip>
  );
  return { open, setOpen, button, kbd: <Kbd>Esc</Kbd> };
}
