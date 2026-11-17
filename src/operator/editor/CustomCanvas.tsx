import { useEffect, useRef, useState, type ReactNode } from "react";
import { BlockContent, blockStyle, CANVAS_H, CANVAS_W, ShapeSvg, TextSlideView } from "@/components/stage/TextSlideView";
import { newBlock, type TextBlock, type TextSlideData } from "@/lib/types";
import { cn } from "@/lib/utils";

const SNAP = 0.012;

export type Tool = "select" | "text" | "rect" | "ellipse" | "line" | "arrow" | "pen" | "highlighter";
export interface DrawStyle {
  color: string;
  /** px on the 1920 canvas */
  stroke: number;
  fill: string | null;
}

type Corner = "tl" | "tr" | "bl" | "br";
type Drag =
  | { mode: "move"; id: string; sx: number; sy: number; bx: number; by: number; h: number }
  | { mode: "resize"; id: string; side: "left" | "right"; sx: number; bx: number; bw: number }
  | { mode: "scale"; id: string; corner: Corner; sx: number; bx: number; by: number; bw: number; bh: number; bsize: number }
  | { mode: "box"; id: string; corner: Corner; sx: number; sy: number; bx: number; by: number; bw: number; bh: number; keep: boolean }
  | { mode: "end"; id: string; which: 0 | 1; abs: [number, number, number, number] };

/** A shape / ink stroke being drawn: absolute canvas fractions. */
interface Creating {
  tool: Exclude<Tool, "select" | "text">;
  pts: number[]; // x,y pairs
}

const isLine = (b: TextBlock) => b.kind === "shape" && (b.shape === "line" || b.shape === "arrow");
const isDrawn = (b: TextBlock) => b.kind === "shape" || b.kind === "ink";
const rid = () => Math.random().toString(36).slice(2, 10);

/** Box + normalised points from absolute points (fractions of the canvas). */
function fromAbs(abs: number[]) {
  const xs = abs.filter((_, i) => i % 2 === 0);
  const ys = abs.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  const points = abs.map((v, i) => (i % 2 === 0 ? (w ? (v - x) / w : 0) : h ? (v - y) / h : 0));
  return { x, y, w, h, points };
}

function lineAbs(b: TextBlock): [number, number, number, number] {
  const p = b.points ?? [0, 0, 1, 1];
  const h = b.h ?? 0;
  return [b.x + p[0] * b.w, b.y + p[1] * h, b.x + p[2] * b.w, b.y + p[3] * h];
}

/** Shift: snap a segment to 0° / 45° / 90° (in screen space, so it looks right on any page). */
function snap45(x0: number, y0: number, x1: number, y1: number, ch: number): [number, number] {
  const dx = (x1 - x0) * CANVAS_W;
  const dy = (y1 - y0) * ch;
  const len = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return [x0 + (Math.cos(a) * len) / CANVAS_W, y0 + (Math.sin(a) * len) / ch];
}

/**
 * Free-layout editor, Photoshop / PowerPoint-style:
 *   text     corners scale box + type · sides set the line width · double-click to type
 *   shapes   corners resize (Shift keeps proportions) · lines: drag either end
 *   drawing  pen / highlighter / shapes / arrows / text from the toolbar (Esc → select)
 *   drag     move (snaps to the centre lines; Alt disables)
 */
export function CustomCanvas({
  draft,
  width,
  selectedId,
  onSelect,
  onBlocks,
  canvasH = CANVAS_H,
  background,
  tool = "select",
  drawStyle = { color: "#ef4444", stroke: 8, fill: null },
  onToolDone,
  emptyHint = "הוסף תיבת טקסט או תמונה",
}: {
  draft: TextSlideData;
  width: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onBlocks: (blocks: TextBlock[]) => void;
  /** canvas height in canvas px (1920 wide). Pages keep their own proportions. */
  canvasH?: number;
  /** drawn under the blocks instead of the designed slide (annotating a page) */
  background?: ReactNode;
  tool?: Tool;
  drawStyle?: DrawStyle;
  /** a one-shot tool (shape / text) finished → back to select */
  onToolDone?: () => void;
  emptyHint?: string;
}) {
  const CH = canvasH;
  const blocks = draft.blocks ?? [];
  const scale = width / CANVAS_W;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  const patch = (id: string, p: Partial<TextBlock>) =>
    onBlocks(blocksRef.current.map((b) => (b.id === id ? { ...b, ...p } : b)));

  /** pointer → canvas fractions */
  const frac = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = layerRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  // a tool change ends any typing and drops the selection (PowerPoint does the same)
  useEffect(() => {
    if (tool !== "select") {
      setEditing(null);
      onSelect(null);
    }
    rootRef.current?.focus({ preventScroll: true }); // Esc / Delete / arrows go to the canvas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  /* ---------------------------------------------------------- edit drags */
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - ("sx" in drag ? drag.sx : 0)) / scale / CANVAS_W;
      if (drag.mode === "move") {
        const dy = (e.clientY - drag.sy) / scale / CH;
        const b = blocksRef.current.find((x) => x.id === drag.id);
        if (!b) return;
        let x = drag.bx + dx;
        let y = drag.by + dy;
        let v = false;
        let h = false;
        if (!e.altKey) {
          if (Math.abs(x + b.w / 2 - 0.5) < SNAP) {
            x = 0.5 - b.w / 2;
            v = true;
          }
          if (Math.abs(y + drag.h / 2 - 0.5) < SNAP) {
            y = 0.5 - drag.h / 2;
            h = true;
          }
        }
        setGuides({ v, h });
        patch(drag.id, { x, y });
      } else if (drag.mode === "scale") {
        // proportional scale around the opposite corner
        const left = drag.corner === "tl" || drag.corner === "bl";
        const top = drag.corner === "tl" || drag.corner === "tr";
        const w = Math.max(0.04, left ? drag.bw - dx : drag.bw + dx);
        const k = w / drag.bw;
        const h = drag.bh * k;
        patch(drag.id, {
          w,
          size: Math.max(8, Math.round(drag.bsize * k)),
          x: left ? drag.bx + drag.bw - w : drag.bx,
          y: top ? drag.by + drag.bh - h : drag.by,
        });
      } else if (drag.mode === "box") {
        const dy = (e.clientY - drag.sy) / scale / CH;
        const left = drag.corner[1] === "l";
        const top = drag.corner[0] === "t";
        let w = Math.max(0.005, left ? drag.bw - dx : drag.bw + dx);
        let h = Math.max(0.005, top ? drag.bh - dy : drag.bh + dy);
        if (drag.keep || e.shiftKey) {
          const k = Math.max(w / Math.max(drag.bw, 1e-6), h / Math.max(drag.bh, 1e-6));
          w = drag.bw * k;
          h = drag.bh * k;
        }
        patch(drag.id, { w, h, x: left ? drag.bx + drag.bw - w : drag.bx, y: top ? drag.by + drag.bh - h : drag.by });
      } else if (drag.mode === "end") {
        let [px, py] = frac(e);
        const a = [...drag.abs];
        const ox = drag.which === 0 ? a[2] : a[0];
        const oy = drag.which === 0 ? a[3] : a[1];
        if (e.shiftKey) [px, py] = snap45(ox, oy, px, py, CH);
        a[drag.which * 2] = px;
        a[drag.which * 2 + 1] = py;
        patch(drag.id, fromAbs(a));
      } else {
        const minW = 0.05;
        if (drag.side === "right") patch(drag.id, { w: Math.max(minW, drag.bw + dx) });
        else {
          const w = Math.max(minW, drag.bw - dx);
          patch(drag.id, { w, x: drag.bx + drag.bw - w });
        }
      }
    };
    const up = () => {
      setDrag(null);
      setGuides({ v: false, h: false });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, scale, CH]);

  /* ------------------------------------------------------------ drawing */
  const buildBlock = (c: Creating, shift: boolean): TextBlock => {
    const s = drawStyle;
    const [x0, y0] = c.pts;
    let [x1, y1] = c.pts.slice(-2);
    if (c.tool === "pen" || c.tool === "highlighter") {
      const hl = c.tool === "highlighter";
      return {
        ...newBlock({ kind: "ink", text: "", color: s.color, opacity: hl ? 0.42 : 1 }),
        stroke: hl ? Math.max(24, s.stroke * 3.5) : s.stroke,
        ...fromAbs(c.pts),
      };
    }
    if (c.tool === "line" || c.tool === "arrow") {
      if (shift) [x1, y1] = snap45(x0, y0, x1, y1, CH);
      return { ...newBlock({ kind: "shape", text: "", color: s.color }), shape: c.tool, stroke: s.stroke, ...fromAbs([x0, y0, x1, y1]) };
    }
    let w = Math.abs(x1 - x0);
    let h = Math.abs(y1 - y0);
    if (shift) {
      const side = Math.max(w * CANVAS_W, h * CH);
      w = side / CANVAS_W;
      h = side / CH;
    }
    return {
      ...newBlock({ kind: "shape", text: "", color: s.color, x: x1 < x0 ? x0 - w : x0, y: y1 < y0 ? y0 - h : y0, w }),
      shape: c.tool,
      h,
      stroke: s.stroke,
      fill: s.fill,
      radius: 0,
    };
  };

  // the stroke lives in a ref too: pointer handlers must not do side effects inside state updaters
  const creatingRef = useRef<Creating | null>(null);
  const setDrawing = (c: Creating | null) => {
    creatingRef.current = c;
    setCreating(c);
  };

  useEffect(() => {
    if (!creating) return;
    let shift = false;
    const move = (e: PointerEvent) => {
      shift = e.shiftKey;
      const c = creatingRef.current;
      if (!c) return;
      const [x, y] = frac(e);
      if (c.tool === "pen" || c.tool === "highlighter") {
        const lx = c.pts[c.pts.length - 2];
        const ly = c.pts[c.pts.length - 1];
        // skip sub-pixel jitter (keeps strokes light)
        if (Math.hypot((x - lx) * CANVAS_W, (y - ly) * CH) < 2) return;
        setDrawing({ ...c, pts: [...c.pts, x, y] });
      } else setDrawing({ ...c, pts: [c.pts[0], c.pts[1], x, y] });
    };
    const up = () => {
      const c = creatingRef.current;
      setDrawing(null);
      if (!c) return;
      let b = buildBlock(c, shift);
      const tiny = b.w * CANVAS_W < 6 && (b.h ?? 0) * CH < 6;
      if (tiny && (c.tool === "rect" || c.tool === "ellipse")) {
        // a click: drop a default-size shape centred there
        const w = 320 / CANVAS_W;
        const h = 200 / CH;
        b = { ...b, x: c.pts[0] - w / 2, y: c.pts[1] - h / 2, w, h };
      } else if (tiny && (c.tool === "line" || c.tool === "arrow")) {
        b = { ...b, ...fromAbs([c.pts[0], c.pts[1], c.pts[0] + 320 / CANVAS_W, c.pts[1]]) };
      }
      onBlocks([...blocksRef.current, b]);
      if (c.tool !== "pen" && c.tool !== "highlighter") {
        onSelect(b.id);
        onToolDone?.();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating !== null]);

  const startDrawing = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const [x, y] = frac(e);
    if (tool === "text") {
      const b = newBlock({ text: "טקסט", x: x - 0.15, y: y - 0.03, w: 0.3, size: 64, color: drawStyle.color, font: draft.bodyFont ?? "heebo" });
      onBlocks([...blocksRef.current, b]);
      onSelect(b.id);
      setEditing(b.id);
      onToolDone?.();
      return;
    }
    if (tool === "select") return;
    setDrawing({ tool, pts: [x, y, x, y] });
  };

  /* ------------------------------------------------------------ keyboard */
  const onKey = (e: React.KeyboardEvent) => {
    if (editing) return;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "Escape" && tool !== "select") {
      onToolDone?.();
      return handled();
    }
    if (!selectedId) return;
    const b = blocks.find((x) => x.id === selectedId);
    if (!b) return;
    const step = e.shiftKey ? 0.02 : 0.004;
    if (e.key === "Delete" || e.key === "Backspace") {
      onBlocks(blocks.filter((x) => x.id !== selectedId));
      onSelect(null);
      handled();
    } else if (e.key === "ArrowLeft") (patch(b.id, { x: b.x - step }), handled());
    else if (e.key === "ArrowRight") (patch(b.id, { x: b.x + step }), handled());
    else if (e.key === "ArrowUp") (patch(b.id, { y: b.y - step }), handled());
    else if (e.key === "ArrowDown") (patch(b.id, { y: b.y + step }), handled());
    else if (e.key === "Enter" && (!b.kind || b.kind === "text")) (setEditing(b.id), handled());
    else if (e.key === "Escape") (onSelect(null), handled());
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      const copy = { ...b, id: rid(), x: b.x + 0.02, y: b.y + 0.03 };
      onBlocks([...blocks, copy]);
      onSelect(copy.id);
      handled();
    } else if (e.key === " " || e.key === "PageDown" || e.key === "PageUp") e.stopPropagation();
  };

  const preview = creating ? buildBlock(creating, false) : null;
  const handleSize = 9 / scale;
  const handle = (extra: React.CSSProperties, cursor: string, onDown: (e: React.PointerEvent) => void, title?: string) => (
    <span
      title={title}
      onPointerDown={(e) => {
        e.stopPropagation();
        onDown(e);
      }}
      className="absolute bg-white shadow-[0_0_0_1px_var(--primary)]"
      style={{ width: handleSize, height: handleSize, borderRadius: 2 / scale, cursor, pointerEvents: "auto", ...extra }}
    />
  );

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKey}
      className="absolute inset-0 outline-none"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.bg) {
          onSelect(null);
          setEditing(null);
        }
      }}
    >
      {background ?? <TextSlideView data={draft} width={width} hideBlocks />}
      <div
        ref={layerRef}
        data-bg="1"
        className="absolute top-0 left-0"
        style={{ width: CANVAS_W, height: CH, transform: `scale(${scale})`, transformOrigin: "top left" }}
        dir="rtl"
      >
        {guides.v && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-fuchsia-500" />}
        {guides.h && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-fuchsia-500" />}

        {blocks.map((b) => {
          const sel = b.id === selectedId;
          const isEditing = editing === b.id;
          const drawn = isDrawn(b);
          const thin = isLine(b) || b.kind === "ink"; // only the stroke is grabbable
          const startMove = (e: React.PointerEvent) => {
            if (isEditing || tool !== "select") return;
            e.stopPropagation();
            onSelect(b.id);
            rootRef.current?.focus();
            const h = drawn ? (b.h ?? 0) : (e.currentTarget as HTMLElement).offsetHeight / CH;
            setDrag({ mode: "move", id: b.id, sx: e.clientX, sy: e.clientY, bx: b.x, by: b.y, h });
          };
          const ends = isLine(b) ? lineAbs(b) : null;
          return (
            <div
              key={b.id}
              className={cn(
                "group absolute whitespace-pre-wrap break-words",
                !isEditing && "cursor-move",
                !sel && !thin && tool === "select" && "hover:outline-dashed hover:outline-white/40",
              )}
              style={{
                ...blockStyle(b, CH),
                pointerEvents: thin ? "none" : undefined,
                outline: sel && !isLine(b) ? `${1.5 / scale}px ${b.kind === "ink" ? "dashed" : "solid"} var(--primary)` : undefined,
                outlineOffset: `${(drawn ? 2 : 6) / scale}px`,
                ...(sel ? {} : { outlineWidth: `${1 / scale}px` }),
              }}
              onPointerDown={thin ? undefined : startMove}
              onDoubleClick={() => (!b.kind || b.kind === "text") && setEditing(b.id)}
            >
              {thin ? (
                // the fat invisible stroke catches the pointer
                <div onPointerDown={startMove} style={{ pointerEvents: tool === "select" ? undefined : "none" }}>
                  <ShapeSvg b={b} ch={CH} hit />
                </div>
              ) : isEditing ? (
                <textarea
                  autoFocus
                  value={b.text}
                  onChange={(e) => patch(b.id, { text: e.target.value })}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                  className="block w-full resize-none border-0 bg-transparent p-0 outline-none [field-sizing:content]"
                  style={{
                    font: "inherit",
                    color: "inherit",
                    textAlign: "inherit",
                    lineHeight: "inherit",
                    letterSpacing: "inherit",
                    background: b.highlight ?? "transparent",
                  }}
                />
              ) : (
                <BlockContent b={b} ch={CH} />
              )}

              {sel && !isEditing && tool === "select" && (
                <>
                  {/* lines: drag either end */}
                  {ends &&
                    ([0, 1] as const).map((which) =>
                      handle(
                        {
                          left: (ends[which * 2] - b.x) * CANVAS_W - handleSize / 2,
                          top: (ends[which * 2 + 1] - b.y) * CH - handleSize / 2,
                          borderRadius: "50%",
                        },
                        "crosshair",
                        () => setDrag({ mode: "end", id: b.id, which, abs: ends }),
                      ),
                    )}

                  {/* shapes / ink: corners resize the box */}
                  {drawn &&
                    !ends &&
                    (["tl", "tr", "bl", "br"] as const).map((c) => (
                      <span key={c}>
                        {handle(
                          {
                            top: c[0] === "t" ? -(2 + 4.5) / scale : undefined,
                            bottom: c[0] === "b" ? -(2 + 4.5) / scale : undefined,
                            left: c[1] === "l" ? -(2 + 4.5) / scale : undefined,
                            right: c[1] === "r" ? -(2 + 4.5) / scale : undefined,
                          },
                          c === "tl" || c === "br" ? "nwse-resize" : "nesw-resize",
                          (e) => setDrag({ mode: "box", id: b.id, corner: c, sx: e.clientX, sy: e.clientY, bx: b.x, by: b.y, bw: b.w, bh: b.h ?? 0, keep: b.kind === "ink" }),
                          "שינוי גודל",
                        )}
                      </span>
                    ))}

                  {/* text / images: sides = line width, corners = scale box + type */}
                  {!drawn && (
                    <>
                      {(["right", "left"] as const).map((side) => (
                        <span
                          key={side}
                          title="רוחב שורה"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setDrag({ mode: "resize", id: b.id, side, sx: e.clientX, bx: b.x, bw: b.w });
                          }}
                          className="absolute top-1/2 cursor-ew-resize rounded-full bg-white shadow-[0_0_0_1px_var(--primary)]"
                          style={{
                            width: 6 / scale,
                            height: 22 / scale,
                            transform: "translateY(-50%)",
                            [side]: -(6 + 3) / scale,
                          }}
                        />
                      ))}
                      {(["tl", "tr", "bl", "br"] as const).map((c) => (
                        <span key={c}>
                          {handle(
                            {
                              top: c[0] === "t" ? -(6 + 4.5) / scale : undefined,
                              bottom: c[0] === "b" ? -(6 + 4.5) / scale : undefined,
                              left: c[1] === "l" ? -(6 + 4.5) / scale : undefined,
                              right: c[1] === "r" ? -(6 + 4.5) / scale : undefined,
                            },
                            c === "tl" || c === "br" ? "nwse-resize" : "nesw-resize",
                            (e) => {
                              const el = (e.currentTarget.parentElement?.parentElement as HTMLElement) ?? null;
                              const bh = el ? el.offsetHeight / CH : 0.1;
                              setDrag({ mode: "scale", id: b.id, corner: c, sx: e.clientX, bx: b.x, by: b.y, bw: b.w, bh, bsize: b.size });
                            },
                            "שינוי גודל",
                          )}
                        </span>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}

        {/* the shape / stroke being drawn */}
        {preview && (
          <div className="pointer-events-none absolute" style={blockStyle(preview, CH)}>
            <BlockContent b={preview} ch={CH} />
          </div>
        )}

        {/* drawing tools capture the whole canvas */}
        {tool !== "select" && (
          <div
            className="absolute inset-0"
            style={{ cursor: tool === "text" ? "text" : "crosshair", touchAction: "none" }}
            onPointerDown={startDrawing}
          />
        )}
      </div>
      {blocks.length === 0 && tool === "select" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-md bg-black/55 px-3 py-1.5 text-sm text-white/70">{emptyHint}</span>
        </div>
      )}
    </div>
  );
}

/** Turns a preset slide into editable boxes, so a template can be a starting point. */
export function presetToBlocks(d: Required<TextSlideData>): TextBlock[] {
  const align = d.align === "center" ? "center" : "right";
  const H = { font: d.headingFont, weight: d.headingWeight, color: d.fg, align, letterSpacing: d.letterSpacing } as const;
  const B = { font: d.bodyFont, weight: d.bodyWeight, color: d.fg, align, letterSpacing: d.letterSpacing } as const;
  const s = d.fontScale;
  switch (d.template) {
    case "title":
      return [
        newBlock({ ...H, text: d.title, x: 0.08, y: 0.34, w: 0.84, size: 128 * s, lineHeight: 1.1 }),
        ...(d.subtitle ? [newBlock({ ...B, text: d.subtitle, x: 0.08, y: 0.56, w: 0.84, size: 56 * s, opacity: 0.72 })] : []),
      ];
    case "bullets":
      return [
        newBlock({ ...H, text: d.title, x: 0.08, y: 0.11, w: 0.84, size: 92 * s, lineHeight: 1.15 }),
        newBlock({
          ...B,
          text: d.body
            .split("\n")
            .filter((l) => l.trim())
            .map((l) => `• ${l.trim()}`)
            .join("\n"),
          x: 0.08,
          y: 0.32,
          w: 0.84,
          size: 58 * s,
          lineHeight: 1.6,
        }),
      ];
    case "quote":
      return [
        newBlock({ ...H, text: d.title, x: 0.1, y: 0.32, w: 0.8, size: 84 * s, lineHeight: 1.3 }),
        ...(d.subtitle ? [newBlock({ ...B, text: `- ${d.subtitle}`, x: 0.1, y: 0.68, w: 0.8, size: 44 * s, opacity: 0.6 })] : []),
      ];
    case "free":
      return [newBlock({ ...B, text: d.body || d.title, x: 0.08, y: 0.36, w: 0.84, size: 76 * s, lineHeight: 1.35 })];
    default:
      return [newBlock({ ...H, text: d.title || "טקסט חדש", color: d.fg })];
  }
}
