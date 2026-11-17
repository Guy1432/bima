import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Maximize, MoveHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, Tip } from "@/components/ui/primitives";
import { FIT_PAGE, clampView, fitWidth, isZoomable, pageAspect, panBy, scrollRoom, zoomAt } from "@/lib/docview";
import { usePresenter } from "@/lib/presenter";
import type { DocView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";

/* ------------------------------------------------------------------ actions (also used by keys) */

function current() {
  const s = useSession.getState();
  const aspect = pageAspect(s.live.slide);
  return { s, aspect, view: s.live.view ?? FIT_PAGE };
}

export const doc = {
  zoom(factor: number, px = 0.5, py = 0.5) {
    const { s, aspect, view } = current();
    if (!aspect) return false;
    s.setView(zoomAt({ ...view, instant: false, fit: undefined }, factor, px, py, aspect));
    return true;
  },
  fitPage() {
    const { s, aspect } = current();
    if (!aspect) return false;
    s.setView(null);
    return true;
  },
  fitWidth() {
    const { s, aspect } = current();
    if (!aspect) return false;
    s.setView(fitWidth(aspect));
    return true;
  },
  /** scroll by a fraction of the visible screen (positive = down) */
  scroll(frac: number) {
    const { s, aspect, view } = current();
    if (!aspect || view.zoom <= 1.0001) return false;
    s.setView(panBy({ ...view, instant: false }, 0, -frac, aspect));
    return true;
  },
};

/* ------------------------------------------------------------------ pointer surface on the monitor */

/**
 * Over the operator's live monitor (only for pages, only when no presenter tool is active):
 * Ctrl+wheel = zoom at the cursor · wheel = scroll · drag = pan · double-click = zoom/fit.
 */
export function DocSurface() {
  const ref = useRef<HTMLDivElement>(null);
  const zoomable = useSession((s) => isZoomable(s.live.slide));
  const tool = usePresenter((s) => s.mode);
  const zoomed = useSession((s) => (s.live.view?.zoom ?? 1) > 1.0001);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const raf = useRef(0);
  const pendingView = useRef<DocView | null>(null);

  // coalesce rapid updates (wheel / drag) into one broadcast per frame
  const push = (v: DocView) => {
    pendingView.current = v;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (pendingView.current) useSession.getState().setView(pendingView.current);
    });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { aspect, view } = current();
      if (!aspect) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const base = pendingView.current && raf.current ? pendingView.current : view;
      if (e.ctrlKey || e.metaKey || base.zoom <= 1.0001) {
        // pinch-zoom on touchpads also arrives as ctrl+wheel
        push(zoomAt({ ...base, instant: true, fit: undefined }, Math.exp(-e.deltaY * 0.0022), px, py, aspect));
      } else {
        push(panBy({ ...base, instant: true }, e.deltaX / r.width, -e.deltaY / r.height, aspect));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomable, tool]);

  if (!zoomable || tool !== "none") return null;

  return (
    <div
      ref={ref}
      className={cn("absolute inset-0 z-[5] touch-none", zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const { aspect, view } = current();
        if (!aspect || view.zoom <= 1.0001) return;
        const r = e.currentTarget.getBoundingClientRect();
        const dx = (e.clientX - d.x) / r.width;
        const dy = (e.clientY - d.y) / r.height;
        if (Math.abs(dx) + Math.abs(dy) > 0.002) d.moved = true;
        d.x = e.clientX;
        d.y = e.clientY;
        const base = pendingView.current && raf.current ? pendingView.current : view;
        push(panBy({ ...base, instant: true }, dx, dy, aspect));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onDoubleClick={(e) => {
        const { s, aspect, view } = current();
        if (!aspect) return;
        if (view.zoom > 1.0001) s.setView(null);
        else {
          const r = e.currentTarget.getBoundingClientRect();
          s.setView(clampView(zoomAt(view, 2.5, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, aspect), aspect));
        }
      }}
    />
  );
}

/* ------------------------------------------------------------------ toolbar under the monitor */

export function DocBar() {
  const live = useSession((s) => s.live);
  const aspect = pageAspect(live.slide);
  if (!aspect) return null;
  const view = live.view ?? FIT_PAGE;
  const zoomed = view.zoom > 1.0001;
  const room = zoomed ? scrollRoom(view, aspect) : { up: false, down: false };
  const widthMode = view.fit === "width";
  const portrait = aspect < 16 / 9 - 0.01;

  return (
    <div className="enter-fade flex items-center gap-0.5 rounded-lg border border-border bg-background/60 p-0.5">
      <Tip content={<>הקטנה <Kbd>-</Kbd></>}>
        <Button size="icon-sm" variant="ghost" disabled={!zoomed} onClick={() => doc.zoom(1 / 1.25)} aria-label="הקטנה">
          <ZoomOut />
        </Button>
      </Tip>
      <Tip content={<>חזרה לעמוד שלם <Kbd>0</Kbd></>}>
        <button
          className="h-7 min-w-12 rounded-md px-1.5 text-[11px] font-semibold text-muted-foreground tabular hover:bg-accent hover:text-foreground"
          onClick={() => doc.fitPage()}
        >
          {Math.round(view.zoom * 100)}%
        </button>
      </Tip>
      <Tip content={<>הגדלה <Kbd>+</Kbd></>}>
        <Button size="icon-sm" variant="ghost" onClick={() => doc.zoom(1.25)} aria-label="הגדלה">
          <ZoomIn />
        </Button>
      </Tip>
      <div className="mx-1 h-4 w-px bg-border" />
      <Tip content="עמוד שלם">
        <Button size="icon-sm" variant="ghost" className={cn(!zoomed && "bg-accent text-foreground")} onClick={() => doc.fitPage()} aria-label="עמוד שלם">
          <Maximize />
        </Button>
      </Tip>
      {portrait && (
        <Tip content="התאמה לרוחב">
          <Button
            size="icon-sm"
            variant="ghost"
            className={cn(widthMode && "bg-primary/15 text-primary-text hover:text-primary-text")}
            onClick={() => (widthMode ? doc.fitPage() : doc.fitWidth())}
            aria-label="התאמה לרוחב"
          >
            <MoveHorizontal />
          </Button>
        </Tip>
      )}
      <div className="flex-1" />
      {zoomed && (
        <>
          <Tip content="גלילה למעלה">
            <Button size="icon-sm" variant="ghost" disabled={!room.up} onClick={() => doc.scroll(-0.6)} aria-label="גלילה למעלה">
              <ChevronUp />
            </Button>
          </Tip>
          <Tip content="גלילה למטה">
            <Button size="icon-sm" variant="ghost" disabled={!room.down} onClick={() => doc.scroll(0.6)} aria-label="גלילה למטה">
              <ChevronDown />
            </Button>
          </Tip>
        </>
      )}
    </div>
  );
}
