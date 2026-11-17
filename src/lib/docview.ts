import type { DocView, Slide } from "./types";

/**
 * Document view - zoom & pan on a page (PDF / PowerPoint / image), shown identically on the
 * projector and the operator monitor.
 *
 * Coordinates are fractions of the STAGE (0..1). `cx, cy` is the stage point shown at the
 * centre; `zoom` 1 = whole page fits. The page itself is letter-boxed inside the stage by
 * its aspect ratio, which is how "fit width" and "top of page" are computed.
 */
export const STAGE_ASPECT = 16 / 9;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

export const FIT_PAGE: DocView = { zoom: 1, cx: 0.5, cy: 0.5, fit: "page" };

export function pageAspect(slide: Slide | null | undefined): number | null {
  const c = slide?.content;
  if (!c || c.kind !== "image") return null;
  return c.aspect && c.aspect > 0 ? c.aspect : STAGE_ASPECT;
}

/** Does this slide support zoom/pan? (pages and images - not text/video) */
export function isZoomable(slide: Slide | null | undefined) {
  return pageAspect(slide) !== null;
}

/** The page's rectangle inside the stage, in stage fractions. */
function pageRect(aspect: number) {
  if (aspect >= STAGE_ASPECT) {
    const h = STAGE_ASPECT / aspect;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = aspect / STAGE_ASPECT;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

/** Keep the view inside the page (no panning into empty black at high zoom). */
export function clampView(v: DocView, aspect: number): DocView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom));
  if (zoom <= 1.0001) return { ...FIT_PAGE };
  const r = pageRect(aspect);
  const half = 0.5 / zoom; // half the visible window, in stage fractions
  const clampAxis = (c: number, start: number, size: number) => {
    const lo = start + half;
    const hi = start + size - half;
    return lo > hi ? start + size / 2 : Math.min(hi, Math.max(lo, c));
  };
  return {
    zoom,
    cx: clampAxis(v.cx, r.x, r.w),
    cy: clampAxis(v.cy, r.y, r.h),
    fit: v.fit === "width" ? "width" : undefined,
    instant: v.instant,
  };
}

/** Fill the screen width with the page, starting at its top (reading mode for documents). */
export function fitWidth(aspect: number): DocView {
  const r = pageRect(aspect);
  const zoom = Math.min(MAX_ZOOM, Math.max(1, 1 / r.w));
  return clampView({ zoom, cx: 0.5, cy: 0, fit: "width" }, aspect);
}

/** Zoom by `factor` keeping stage point (px, py) under the cursor. */
export function zoomAt(v: DocView, factor: number, px: number, py: number, aspect: number): DocView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
  // the stage point currently under the cursor
  const ux = v.cx + (px - 0.5) / v.zoom;
  const uy = v.cy + (py - 0.5) / v.zoom;
  return clampView({ zoom, cx: ux - (px - 0.5) / zoom, cy: uy - (py - 0.5) / zoom }, aspect);
}

/** Pan by a drag of (dx, dy) in stage fractions of the visible screen. */
export function panBy(v: DocView, dx: number, dy: number, aspect: number): DocView {
  return clampView({ ...v, cx: v.cx - dx / v.zoom, cy: v.cy - dy / v.zoom }, aspect);
}

/** CSS transform for the stage content. */
export function viewStyle(v: DocView | null | undefined): React.CSSProperties | undefined {
  if (!v || v.zoom <= 1.0001) return { transform: "none", transformOrigin: "0 0", transition: "transform 240ms cubic-bezier(0.23, 1, 0.32, 1)" };
  const tx = (0.5 - v.cx * v.zoom) * 100;
  const ty = (0.5 - v.cy * v.zoom) * 100;
  return {
    transform: `translate(${tx}%, ${ty}%) scale(${v.zoom})`,
    transformOrigin: "0 0",
    transition: v.instant ? "none" : "transform 240ms cubic-bezier(0.23, 1, 0.32, 1)",
    willChange: "transform",
  };
}

/** Is there more page below / above the current window? (for the scroll hints) */
export function scrollRoom(v: DocView, aspect: number) {
  const r = pageRect(aspect);
  const half = 0.5 / v.zoom;
  return { up: v.cy - half > r.y + 0.001, down: v.cy + half < r.y + r.h - 0.001 };
}
