import { useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/overlay";
import { Label, Slider } from "@/components/ui/primitives";
import { clampWeight, fontById, FONTS, loadSystemFonts, SYSTEM_PREFIX, useSystemFonts, WEIGHT_LABELS } from "@/lib/fonts";
import { cn } from "@/lib/utils";

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, value, children }: { label: string; value?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {value !== undefined && <span className="text-[11px] text-muted-foreground tabular">{value}</span>}
      </div>
      {children}
    </div>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} value={format ? format(value) : value}>
      <Slider dir="ltr" min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
    </Field>
  );
}

const KIND_LABEL = { sans: "ללא תגים", serif: "עם תגים", display: "תצוגה", hand: "כתב יד", system: "מותקנים במחשב" } as const;

export function FontPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const f = fontById(value);
  const [q, setQ] = useState("");
  const system = useSystemFonts((s) => s.families);
  const query = q.trim().toLowerCase();
  const match = (label: string) => !query || label.toLowerCase().includes(query);

  const item = (id: string, label: string, family: string) => (
    <DropdownMenuItem key={id} onSelect={() => onChange(id)} className="justify-between gap-3">
      <span style={{ fontFamily: `${family}, 'Heebo Variable', sans-serif` }} className="truncate text-[15px]">
        שלום עולם
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground" dir="ltr">
        {id === value && <Check className="!text-foreground" />}
        {label}
      </span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu
      onOpenChange={(o) => {
        if (o) void loadSystemFonts();
        else setQ("");
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 w-full justify-between px-3 font-normal">
          <span style={{ fontFamily: `${f.family}, 'Heebo Variable', sans-serif` }} className="truncate text-[15px]">
            {f.label} · אבג
          </span>
          <ChevronDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 p-0" align="start">
        <div className="border-b border-border p-1.5">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="חיפוש גופן…"
            spellCheck={false}
            aria-label="חיפוש גופן"
            className="h-8 w-full rounded-md bg-raised px-2.5 text-[13px] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1px_var(--ring)]"
          />
        </div>
        <div className="max-h-80 overflow-y-auto overscroll-contain p-1">
          {(["sans", "serif", "display", "hand"] as const).map((kind) => {
            const list = FONTS.filter((x) => x.kind === kind && match(x.label));
            if (!list.length) return null;
            return (
              <div key={kind}>
                <DropdownMenuLabel className="text-[11px] text-faint">{KIND_LABEL[kind]}</DropdownMenuLabel>
                {list.map((x) => item(x.id, x.label, x.family))}
              </div>
            );
          })}
          {system.filter(match).length > 0 && (
            <div>
              <DropdownMenuLabel className="text-[11px] text-faint">{KIND_LABEL.system}</DropdownMenuLabel>
              {system.filter(match).map((fam) => item(SYSTEM_PREFIX + fam, fam, `'${fam.replace(/'/g, "")}'`))}
            </div>
          )}
          {query && !FONTS.some((x) => match(x.label)) && !system.some(match) && (
            <div className="px-3 py-6 text-center text-[12px] text-faint">לא נמצא גופן</div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WeightPicker({ font, value, onChange }: { font: string; value: number; onChange: (w: number) => void }) {
  const weights = fontById(font).weights;
  const current = clampWeight(font, value);
  if (weights.length === 1)
    return <div className="flex h-9 items-center rounded-md border border-border px-3 text-xs text-muted-foreground">משקל יחיד</div>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 w-full justify-between px-3 font-normal">
          <span style={{ fontFamily: fontById(font).family, fontWeight: current }}>{WEIGHT_LABELS[current]}</span>
          <ChevronDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {weights.map((w) => (
          <DropdownMenuItem key={w} onSelect={() => onChange(w)} className="justify-between">
            <span style={{ fontFamily: fontById(font).family, fontWeight: w }}>{WEIGHT_LABELS[w]}</span>
            <span className="text-xs text-muted-foreground tabular">{w}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ColorField({
  value,
  swatches,
  onChange,
  allowNone,
}: {
  value: string | null;
  swatches: string[];
  onChange: (c: string | null) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowNone && (
        <button
          onClick={() => onChange(null)}
          className={cn(
            "relative size-6 overflow-hidden rounded-md border border-zinc-700 bg-transparent",
            value === null && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
          aria-label="ללא"
        >
          <span className="absolute inset-0 m-auto h-px w-8 -rotate-45 bg-red-400" />
        </button>
      )}
      {swatches.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn(
            "size-6 rounded-md border border-white/10",
            value?.toLowerCase() === c.toLowerCase() && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
          style={{ background: c }}
          aria-label={c}
        />
      ))}
      <label
        className="relative flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-zinc-600 text-xs text-muted-foreground hover:border-zinc-400"
        title="צבע מותאם"
      >
        <span
          className="absolute inset-[3px] rounded-sm"
          style={{
            background: value && !swatches.includes(value) ? value : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
          }}
        />
        <input type="color" value={value ?? "#000000"} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label?: string; icon?: ReactNode; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="relative flex rounded-md border border-border bg-background p-0.5">
      {/* sliding pill - moves with transform only (GPU), ease-in-out because it travels on screen */}
      <span
        aria-hidden
        className="absolute inset-y-0.5 right-0.5 rounded-[5px] bg-accent shadow-sm ring-1 ring-white/5 transition-transform duration-250 ease-[cubic-bezier(0.77,0,0.175,1)]"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${-100 * Math.max(0, options.findIndex((o) => o.value === value))}%)`,
        }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-10 flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[5px] text-xs transition-colors duration-200 [&_svg]:size-3.5",
            value === o.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const BG_SWATCHES = ["#000000", "#0a0a0a", "#18181b", "#f4f4f5", "#ffffff", "#f5efe6", "#0b1f3a", "#12301f", "#3b0d0d", "#2e1065", "#1e293b"];
export const TEXT_SWATCHES = ["#fafafa", "#d4d4d8", "#71717a", "#0a0a0a", "#fde68a", "#fca5a5", "#93c5fd"];
export const ACCENT_SWATCHES = ["#6366f1", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#fafafa"];
