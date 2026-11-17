import type { ReactNode } from "react";
import {
  ArrowUpLeft,
  BringToFront,
  Circle,
  Copy,
  Highlighter,
  Minus,
  MousePointer2,
  PenLine,
  SendToBack,
  Square,
  Trash2,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/overlay";
import { Keys, Tip } from "@/components/ui/primitives";
import type { TextBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { DrawStyle, Tool } from "./CustomCanvas";
import { ColorField, Field, RangeField } from "./fields";

export const PEN_SWATCHES = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#ffffff", "#0a0a0a"];
const STROKES = [
  { v: 4, label: "דק" },
  { v: 8, label: "רגיל" },
  { v: 14, label: "עבה" },
  { v: 24, label: "עבה מאוד" },
];

/** Physical keys (e.code), so they work with a Hebrew layout too. None of them collide with
 *  clicker keys (PageUp/Down, B, ".", N, P). */
export const TOOL_KEYS: Record<string, Tool> = {
  KeyV: "select",
  KeyT: "text",
  KeyD: "pen",
  KeyH: "highlighter",
  KeyR: "rect",
  KeyO: "ellipse",
  KeyA: "arrow",
};

const TOOLS: { id: Tool; label: string; icon: typeof Square; key?: string }[][] = [
  [
    { id: "select", label: "בחירה", icon: MousePointer2, key: "V" },
    { id: "text", label: "טקסט", icon: Type, key: "T" },
  ],
  [
    { id: "pen", label: "עט", icon: PenLine, key: "D" },
    { id: "highlighter", label: "מרקר", icon: Highlighter, key: "H" },
  ],
  [
    { id: "rect", label: "מלבן", icon: Square, key: "R" },
    { id: "ellipse", label: "אליפסה", icon: Circle, key: "O" },
    { id: "line", label: "קו", icon: Minus },
    { id: "arrow", label: "חץ", icon: ArrowUpLeft, key: "A" },
  ],
];

const isShapeTool = (t: Tool) => t === "rect" || t === "ellipse";

function Divider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

/** The ribbon above the canvas: tools on one side, the look of what you draw on the other. */
export function DrawToolbar({
  tool,
  onTool,
  style,
  onStyle,
  selected,
  extra,
}: {
  tool: Tool;
  onTool: (t: Tool) => void;
  style: DrawStyle;
  onStyle: (p: Partial<DrawStyle>) => void;
  /** the selected element (its look is shown + edited instead of the next stroke's) */
  selected?: TextBlock;
  extra?: ReactNode;
}) {
  const shownColor = selected?.color ?? style.color;
  const shownStroke = selected && (selected.kind === "shape" || selected.kind === "ink") ? (selected.stroke ?? 8) : style.stroke;
  const shownFill = selected?.kind === "shape" ? (selected.fill ?? null) : style.fill;
  const showFill = isShapeTool(tool) || (selected?.kind === "shape" && (selected.shape === "rect" || selected.shape === "ellipse"));
  const showStroke = tool !== "text" && tool !== "select" ? true : !!selected && (selected.kind === "shape" || selected.kind === "ink");

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-y-1 rounded-lg border border-border bg-card px-1.5 py-1" role="toolbar" aria-label="כלי ציור">
      {TOOLS.map((group, gi) => (
        <div key={gi} className="flex items-center">
          {gi > 0 && <Divider />}
          {group.map((t) => (
            <Tip
              key={t.id}
              content={
                <span className="flex items-center gap-2">
                  {t.label}
                  {t.key && <Keys combo={[t.key]} />}
                </span>
              }
            >
              <button
                type="button"
                aria-label={t.label}
                aria-pressed={tool === t.id}
                onClick={() => onTool(t.id)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md transition-colors duration-[160ms] [&_svg]:size-4",
                  tool === t.id ? "bg-primary/15 text-primary-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_45%,transparent)]" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <t.icon />
              </button>
            </Tip>
          ))}
        </div>
      ))}

      <Divider />

      {/* colour */}
      <DropdownMenu>
        <Tip content="צבע">
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="צבע" className="flex h-8 items-center gap-1.5 rounded-md px-2 hover:bg-accent">
              <span className="size-4 rounded-full ring-1 ring-white/25" style={{ background: shownColor }} />
            </button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="start" className="w-56 p-3">
          <ColorField value={shownColor} swatches={PEN_SWATCHES} onChange={(c) => c && onStyle({ color: c })} />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* stroke — always present (dimmed when it doesn't apply) so the bar never changes width */}
      {(
        <DropdownMenu>
          <Tip content="עובי קו">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="עובי קו"
                disabled={!showStroke}
                className="flex h-8 w-10 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none disabled:opacity-35"
              >
                <span className="w-5 rounded-full bg-foreground" style={{ height: Math.max(1.5, Math.min(7, shownStroke / 3.2)) }} />
              </button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="start" className="w-44 p-1">
            {STROKES.map((s) => (
              <button
                key={s.v}
                type="button"
                onClick={() => onStyle({ stroke: s.v })}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-[13px] hover:bg-accent",
                  Math.abs(shownStroke - s.v) < 1 && "bg-accent",
                )}
              >
                <span className="w-8 rounded-full bg-foreground" style={{ height: Math.max(1.5, s.v / 3.2) }} />
                {s.label}
              </button>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* fill */}
      {(
        <DropdownMenu>
          <Tip content="מילוי">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="מילוי"
                disabled={!showFill}
                className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
              >
                <span
                  className="relative size-4 overflow-hidden rounded-[4px] ring-1 ring-white/25"
                  style={{ background: shownFill ?? "transparent" }}
                >
                  {!shownFill && <span className="absolute inset-0 m-auto h-px w-6 -rotate-45 bg-red-400" />}
                </span>
                מילוי
              </button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="start" className="w-56 p-3">
            <ColorField value={shownFill} allowNone swatches={PEN_SWATCHES} onChange={(fill) => onStyle({ fill })} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {extra && (
        <>
          <Divider />
          {extra}
        </>
      )}
    </div>
  );
}

/** Properties of a selected shape / stroke. */
export function ShapeInspector({
  block,
  onPatch,
  onFront,
  onBack,
  onDuplicate,
  onDelete,
}: {
  block: TextBlock;
  onPatch: (p: Partial<TextBlock>) => void;
  onFront: () => void;
  onBack: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const closed = block.kind === "shape" && (block.shape === "rect" || block.shape === "ellipse");
  return (
    <>
      <Field label={closed ? "קו" : "צבע"}>
        <ColorField value={block.color} swatches={PEN_SWATCHES} onChange={(c) => c && onPatch({ color: c })} />
      </Field>
      {closed && (
        <Field label="מילוי">
          <ColorField value={block.fill ?? null} allowNone swatches={PEN_SWATCHES} onChange={(fill) => onPatch({ fill })} />
        </Field>
      )}
      <RangeField
        label="עובי"
        value={block.stroke ?? 8}
        min={closed ? 0 : 1}
        max={60}
        step={1}
        format={(v) => (v ? `${v}px` : "ללא")}
        onChange={(stroke) => onPatch({ stroke })}
      />
      {block.kind === "shape" && block.shape === "rect" && (
        <RangeField label="פינות מעוגלות" value={block.radius ?? 0} min={0} max={160} step={2} format={(v) => `${v}px`} onChange={(radius) => onPatch({ radius })} />
      )}
      <RangeField label="שקיפות" value={block.opacity} min={0.1} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => onPatch({ opacity })} />
      <div className="grid grid-cols-4 gap-1.5">
        <Tip content="קדימה">
          <Button size="sm" variant="secondary" onClick={onFront} aria-label="קדימה">
            <BringToFront />
          </Button>
        </Tip>
        <Tip content="אחורה">
          <Button size="sm" variant="secondary" onClick={onBack} aria-label="אחורה">
            <SendToBack />
          </Button>
        </Tip>
        <Tip content={<span className="flex items-center gap-2">שכפול <Keys combo={["Ctrl", "D"]} /></span>}>
          <Button size="sm" variant="secondary" onClick={onDuplicate} aria-label="שכפול">
            <Copy />
          </Button>
        </Tip>
        <Tip content={<span className="flex items-center gap-2">מחיקה <Keys combo={["Del"]} /></span>}>
          <Button size="sm" variant="secondary" className="hover:bg-red-500/10 hover:text-red-400" onClick={onDelete} aria-label="מחיקה">
            <Trash2 />
          </Button>
        </Tip>
      </div>
    </>
  );
}
