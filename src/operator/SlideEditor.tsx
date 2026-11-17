import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/lib/media";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowRight,
  BringToFront,
  Check,
  Clock,
  Copy,
  Film,
  Heading1,
  ImagePlus,
  QrCode,
  List,
  MousePointer2,
  Plus,
  Quote,
  Radio,
  SendToBack,
  Trash2,
  Wand2,
} from "lucide-react";
import { FitBox } from "@/components/stage/FitBox";
import { CANVAS_W, TextSlideView } from "@/components/stage/TextSlideView";
import { confirmAction } from "@/components/ConfirmHost";
import { Button } from "@/components/ui/button";
import { Badge, Input, Kbd, Keys, Textarea, Tip } from "@/components/ui/primitives";
import { fontById } from "@/lib/fonts";
import { newBlock, withTextDefaults, type Decor, type TextBlock, type TextTemplate } from "@/lib/types";

const SHAPE_LABEL: Record<string, string> = { rect: "מלבן", ellipse: "אליפסה", line: "קו", arrow: "חץ" };

/** The page being annotated, with its video areas marked (they play there on the projector). */
function PageBackground({ base }: { base: NonNullable<EditorState["base"]> }) {
  return (
    <div className="absolute inset-0 bg-black">
      <img src={mediaUrl(base.file)} className="absolute inset-0 h-full w-full" draggable={false} alt="" />
      {base.videos?.map((v, i) => (
        <div
          key={i}
          className="absolute flex items-center justify-center bg-black/75 text-white/50"
          style={{ left: `${v.x * 100}%`, top: `${v.y * 100}%`, width: `${v.w * 100}%`, height: `${v.h * 100}%` }}
        >
          <Film className="size-6" />
        </div>
      ))}
    </div>
  );
}
import { cn, isTypingTarget, uid } from "@/lib/utils";
import { useSession } from "@/store/session";
import { CustomCanvas, presetToBlocks, type DrawStyle, type Tool } from "./editor/CustomCanvas";
import { DrawToolbar, ShapeInspector, TOOL_KEYS } from "./editor/DrawToolbar";
import type { EditorState } from "@/store/session";
import { pickSlides } from "./SlidePicker";
import { UNDO_KEYS } from "@/lib/platform";
import {
  ACCENT_SWATCHES,
  BG_SWATCHES,
  ColorField,
  Field,
  FontPicker,
  RangeField,
  Section,
  Segmented,
  TEXT_SWATCHES,
  WeightPicker,
} from "./editor/fields";

const TEMPLATES: { id: TextTemplate; label: string; icon: typeof List }[] = [
  { id: "title", label: "כותרת", icon: Heading1 },
  { id: "bullets", label: "נקודות", icon: List },
  { id: "quote", label: "ציטוט", icon: Quote },
  { id: "timer", label: "טיימר", icon: Clock },
  { id: "free", label: "טקסט", icon: AlignJustify },
  { id: "qr", label: "קוד QR", icon: QrCode },
  { id: "custom", label: "חופשי", icon: MousePointer2 },
];

const PRESETS: Record<Exclude<TextTemplate, "custom">, { title: string; subtitle: string; body: string }> = {
  title: { title: "כותרת ראשית", subtitle: "כותרת משנה", body: "" },
  bullets: { title: "נושאים להיום", subtitle: "", body: "נקודה ראשונה\nנקודה שנייה\nנקודה שלישית" },
  quote: { title: "מה הדבר החשוב ביותר שלמדתם היום?", subtitle: "", body: "" },
  timer: { title: "הפסקה", subtitle: "נחזור בעוד", body: "" },
  free: { title: "", subtitle: "", body: "טקסט חופשי\nבכמה שורות" },
  qr: { title: "סרקו להצטרפות", subtitle: "פתחו את המצלמה בטלפון", body: "https://" },
};

interface Look {
  id: string;
  label: string;
  bg: string;
  fg: string;
  headingFont: string;
  headingWeight: number;
  bodyFont: string;
  bodyWeight: number;
  accent: string;
  decor: Decor;
}

const LOOKS: Look[] = [
  { id: "classic", label: "קלאסי", bg: "#0a0a0a", fg: "#fafafa", headingFont: "heebo", headingWeight: 700, bodyFont: "heebo", bodyWeight: 400, accent: "#6366f1", decor: "none" },
  { id: "minimal", label: "מינימלי", bg: "#ffffff", fg: "#0a0a0a", headingFont: "heebo", headingWeight: 300, bodyFont: "heebo", bodyWeight: 300, accent: "#0a0a0a", decor: "line" },
  { id: "editorial", label: "עיתונאי", bg: "#f5efe6", fg: "#1c1917", headingFont: "frank", headingWeight: 700, bodyFont: "frank", bodyWeight: 400, accent: "#b91c1c", decor: "line" },
  { id: "bold", label: "נועז", bg: "#111827", fg: "#ffffff", headingFont: "secular", headingWeight: 400, bodyFont: "rubik", bodyWeight: 400, accent: "#f59e0b", decor: "bar" },
  { id: "tech", label: "טכנולוגי", bg: "#020617", fg: "#e2e8f0", headingFont: "plex", headingWeight: 600, bodyFont: "plex", bodyWeight: 300, accent: "#06b6d4", decor: "frame" },
  { id: "soft", label: "רך", bg: "#ecfdf5", fg: "#064e3b", headingFont: "varela", headingWeight: 400, bodyFont: "assistant", bodyWeight: 400, accent: "#10b981", decor: "none" },
  { id: "poster", label: "פוסטר", bg: "#7f1d1d", fg: "#fff7ed", headingFont: "karantina", headingWeight: 700, bodyFont: "rubik", bodyWeight: 500, accent: "#fde68a", decor: "none" },
  { id: "notebook", label: "מחברת", bg: "#fffbeb", fg: "#292524", headingFont: "amatic", headingWeight: 700, bodyFont: "assistant", bodyWeight: 400, accent: "#ea580c", decor: "line" },
];

export function SlideEditor() {
  const editor = useSession((s) => s.editor)!;
  const item = useSession((s) => s.items.find((i) => i.id === editor.itemId));
  const isEditingLive = useSession((s) => !!editor.slideId && s.live.slide?.id === editor.slideId);
  const { updateDraft, commitDraft, closeEditor } = useSession.getState();
  const d = withTextDefaults(editor.draft);
  const [selected, setSelected] = useState<string | null>(null);
  const isCustom = d.template === "custom";
  const block = isCustom ? d.blocks.find((b) => b.id === selected) : undefined;
  const base = editor.base;
  const annotate = !!base;
  const drawn = !!block && (block.kind === "shape" || block.kind === "ink");
  const [tool, setTool] = useState<Tool>("select");
  const [drawStyle, setDrawStyle] = useState<DrawStyle>(() => ({ color: annotate ? "#ef4444" : (d.accent ?? "#ef4444"), stroke: 8, fill: null }));

  const setBlocks = (blocks: TextBlock[]) => updateDraft({ blocks });
  const patchBlock = (p: Partial<TextBlock>) =>
    block && setBlocks(d.blocks.map((b) => (b.id === block.id ? { ...b, ...p } : b)));

  const setTemplate = (t: TextTemplate) => {
    if (t === d.template) return;
    if (t === "custom") {
      updateDraft({ template: "custom", blocks: d.blocks.length ? d.blocks : presetToBlocks(d) });
      return;
    }
    const current = d.template !== "custom" ? PRESETS[d.template] : null;
    const untouched =
      !current || (d.title === current.title && d.subtitle === current.subtitle && d.body === current.body);
    updateDraft(untouched || (!d.title && !d.body) ? { template: t, ...PRESETS[t] } : { template: t });
  };

  /** Drawing on a preset slide turns it into a free layout first (its text becomes boxes). */
  const pickTool = (t: Tool) => {
    if (t !== "select" && !isCustom) setTemplate("custom");
    setTool(t);
  };

  // tool letters work wherever the focus is (they are not live-control keys)
  const pickToolRef = useRef(pickTool);
  pickToolRef.current = pickTool;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || isTypingTarget(e.target)) return;
      if (document.querySelector("[role=dialog],[role=menu]")) return;
      const t = TOOL_KEYS[e.code];
      if (!t) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      pickToolRef.current(t);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  /** Toolbar look: the next stroke, and the selected element if there is one. */
  const changeStyle = (p: Partial<DrawStyle>) => {
    setDrawStyle((cur) => ({ ...cur, ...p }));
    if (!block) return;
    if (drawn)
      patchBlock({
        ...(p.color ? { color: p.color } : {}),
        ...(p.stroke !== undefined ? { stroke: p.stroke } : {}),
        ...(p.fill !== undefined ? { fill: p.fill } : {}),
      });
    else if (p.color && (!block.kind || block.kind === "text")) patchBlock({ color: p.color });
  };

  const toFront = (b: TextBlock) => setBlocks([...d.blocks.filter((x) => x.id !== b.id), b]);
  const toBack = (b: TextBlock) => setBlocks([b, ...d.blocks.filter((x) => x.id !== b.id)]);
  const duplicate = (b: TextBlock) => {
    const c = { ...b, id: uid(), x: b.x + 0.02, y: b.y + 0.03 };
    setBlocks([...d.blocks, c]);
    setSelected(c.id);
  };
  const remove = (b: TextBlock) => {
    setBlocks(d.blocks.filter((x) => x.id !== b.id));
    setSelected(null);
  };

  const clearAll = async () => {
    const ok = await confirmAction({
      title: "למחוק את כל הציור?",
      description: `ניתן לשחזר עם ${UNDO_KEYS}.`,
      confirmLabel: "מחיקת הכול",
    });
    if (!ok) return;
    setBlocks([]);
    setSelected(null);
  };

  const applyLook = (l: Look) => {
    const { id: _id, label: _label, ...look } = l;
    if (!isCustom) return updateDraft(look);
    updateDraft({
      ...look,
      blocks: d.blocks.map((b, i) => ({
        ...b,
        color: l.fg,
        font: i === 0 ? l.headingFont : l.bodyFont,
        weight: i === 0 ? l.headingWeight : l.bodyWeight,
      })),
    });
  };

  /** An image file - or a single slide taken from a PowerPoint / PDF - as a media file. */
  const pickImage = async (): Promise<string | null> => {
    const picked = await pickSlides({ single: true, imagesOnly: true, title: "בחירת תמונה" });
    const c = picked?.[0]?.content;
    return c && c.kind === "image" ? c.file : null;
  };

  const addImage = async () => {
    const file = await pickImage();
    if (!file) return;
    const b = newBlock({ kind: "image", file, text: "", x: 0.3, y: 0.2, w: 0.4, radius: 0 });
    setBlocks([...(useSession.getState().editor?.draft.blocks ?? []), b]);
    setSelected(b.id);
  };

  const addBlock = () => {
    const b = newBlock({ font: d.bodyFont, color: d.fg, y: 0.42 + ((d.blocks.length * 0.07) % 0.4) });
    setBlocks([...d.blocks, b]);
    setSelected(b.id);
  };

  return (
    <section
      className="enter-panel flex min-h-0 flex-col"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          commitDraft(true);
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          commitDraft(false);
        }
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Button variant="ghost" size="sm" onClick={closeEditor}>
          <ArrowRight /> חזרה
        </Button>
        <div className="h-4 w-px bg-border" />
        <div className="text-[13px] font-semibold">{annotate ? "ציור על השקופית" : "עריכת שקופית"}</div>
        {!editor.slideId && <Badge>חדשה</Badge>}
        {item && <span className="truncate text-xs text-muted-foreground">ב־{item.title}</span>}
        <div className="flex-1" />
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-faint" /> טיוטה · לא מוצג לקהל
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)]">
        {/* ------------- controls ------------- */}
        <div className="min-h-0 overflow-y-auto border-l border-border">
          {!annotate && (
          <Section title="תבנית">
            <div className="grid grid-cols-4 gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTemplate(t.id)}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-1 rounded-lg border text-[11px] transition-colors",
                    d.template === t.id
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-zinc-600 hover:text-foreground",
                  )}
                >
                  <t.icon className={cn("size-4", d.template === t.id && "text-primary-text")} /> {t.label}
                </button>
              ))}
            </div>
          </Section>
          )}

          {!annotate && (
          <Section title="ערכת עיצוב">
            <div className="grid grid-cols-4 gap-1.5">
              {LOOKS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => applyLook(l)}
                  className="group flex flex-col items-center gap-1"
                  title={l.label}
                >
                  <span
                    className={cn(
                      "relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md text-base ring-1 ring-white/10 group-hover:ring-white/30",
                      d.bg === l.bg && d.headingFont === l.headingFont && "ring-2 ring-primary",
                    )}
                    style={{ background: l.bg, color: l.fg, fontFamily: fontById(l.headingFont).family, fontWeight: l.headingWeight }}
                  >
                    אב
                    {l.decor === "bar" && <span className="absolute inset-y-0 right-0 w-1" style={{ background: l.accent }} />}
                    {l.decor === "line" && <span className="absolute bottom-1.5 h-0.5 w-4 rounded" style={{ background: l.accent }} />}
                    {l.decor === "frame" && <span className="absolute inset-1 rounded-sm border" style={{ borderColor: l.accent }} />}
                  </span>
                  <span className="text-[10px] text-muted-foreground group-hover:text-foreground">{l.label}</span>
                </button>
              ))}
            </div>
          </Section>
          )}

          {/* ---- content ---- */}
          {!isCustom && (
            <Section title="תוכן">
              {d.template !== "free" && (
                <Field label={d.template === "quote" ? "ציטוט / שאלה" : "כותרת"}>
                  {d.template === "quote" ? (
                    <Textarea rows={3} value={d.title} onChange={(e) => updateDraft({ title: e.target.value })} />
                  ) : (
                    <Input value={d.title} onChange={(e) => updateDraft({ title: e.target.value })} autoFocus />
                  )}
                </Field>
              )}
              {d.template === "qr" && (
                <Field label="קישור">
                  <Input dir="ltr" spellCheck={false} className="text-right" value={d.body} onChange={(e) => updateDraft({ body: e.target.value })} placeholder="https://forms.gle/…" />
                </Field>
              )}
              {(d.template === "title" || d.template === "quote" || d.template === "timer" || d.template === "qr") && (
                <Field label={d.template === "quote" ? "מקור" : "כותרת משנה"}>
                  <Input value={d.subtitle} onChange={(e) => updateDraft({ subtitle: e.target.value })} />
                </Field>
              )}
              {(d.template === "bullets" || d.template === "free") && (
                <Field label={d.template === "bullets" ? "נקודות (שורה לכל נקודה)" : "טקסט"}>
                  <Textarea rows={6} value={d.body} onChange={(e) => updateDraft({ body: e.target.value })} />
                </Field>
              )}
              {d.template === "timer" && (
                <Field label="משך (דקות)">
                  <div className="grid grid-cols-6 gap-1">
                    {[1, 3, 5, 10, 15, 20].map((m) => (
                      <Button
                        key={m}
                        size="sm"
                        variant={d.timerMinutes === m ? "default" : "secondary"}
                        className="px-0"
                        onClick={() => updateDraft({ timerMinutes: m })}
                      >
                        {m}
                      </Button>
                    ))}
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={d.timerMinutes}
                    onChange={(e) => updateDraft({ timerMinutes: Math.max(0, +e.target.value || 0) })}
                    className="mt-1"
                  />
                </Field>
              )}
              {d.template !== "timer" && (
                <Button variant="outline" size="sm" onClick={() => setTemplate("custom")} className="justify-start text-muted-foreground">
                  <Wand2 /> המרה לעיצוב חופשי
                </Button>
              )}
            </Section>
          )}

          {/* ---- custom: selected box ---- */}
          {isCustom && (
            <Section
              title={block ? (drawn ? "צורה נבחרת" : block.kind === "image" ? "תמונה נבחרת" : "תיבה נבחרת") : annotate ? "ציור" : "תיבות טקסט"}
              action={
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" className="h-7" onClick={addBlock}>
                    <Plus /> טקסט
                  </Button>
                  <Button size="sm" variant="secondary" className="h-7" onClick={addImage}>
                    <ImagePlus /> תמונה
                  </Button>
                </div>
              }
            >
              {!block ? (
                <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3 text-xs leading-relaxed text-muted-foreground">
                  <span>{annotate ? "פינות: שינוי גודל · גרירה: הזזה" : "פינות: שינוי גודל · צדדים: רוחב שורה · גרירה: הזזה"}</span>
                  <span>
                    לחיצה כפולה: עריכה · <Kbd>Del</Kbd> מחיקה · <Keys combo={["Ctrl", "D"]} /> שכפול · חיצים: הזזה
                  </span>
                  {d.blocks.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1">
                      {d.blocks.map((b, i) => (
                        <button
                          key={b.id}
                          onClick={() => setSelected(b.id)}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-right text-foreground hover:bg-accent"
                        >
                          <span className="text-muted-foreground tabular">{i + 1}</span>
                          {b.kind === "shape" || b.kind === "ink" ? (
                            <span className="flex items-center gap-2">
                              <span className="size-3 rounded-full ring-1 ring-white/20" style={{ background: b.color }} />
                              {b.kind === "ink" ? (b.opacity < 1 ? "מרקר" : "ציור") : SHAPE_LABEL[b.shape ?? "rect"]}
                            </span>
                          ) : b.kind === "image" && b.file ? (
                            <span className="flex items-center gap-2">
                              <img src={mediaUrl(b.file)} className="h-5 w-8 rounded-sm object-cover" alt="" /> תמונה
                            </span>
                          ) : (
                            <span className="truncate" style={{ fontFamily: fontById(b.font).family }}>
                              {b.text.split("\n")[0] || "(ריק)"}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {annotate && d.blocks.length > 0 && (
                    <Button variant="ghost" size="sm" className="mt-1 justify-start text-red-400 hover:bg-red-500/10 hover:text-red-400" onClick={clearAll}>
                      <Trash2 /> מחיקת הכול
                    </Button>
                  )}
                </div>
              ) : drawn ? (
                <ShapeInspector
                  block={block}
                  onPatch={patchBlock}
                  onFront={() => toFront(block)}
                  onBack={() => toBack(block)}
                  onDuplicate={() => duplicate(block)}
                  onDelete={() => remove(block)}
                />
              ) : block.kind === "image" ? (
                <>
                  <RangeField label="רוחב" value={Math.round(block.w * 100)} min={5} max={100} step={1} format={(v) => `${v}%`} onChange={(v) => patchBlock({ w: v / 100 })} />
                  <RangeField label="פינות מעוגלות" value={block.radius ?? 0} min={0} max={120} step={2} format={(v) => `${v}px`} onChange={(radius) => patchBlock({ radius })} />
                  <RangeField label="שקיפות" value={block.opacity} min={0.1} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => patchBlock({ opacity })} />
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button size="sm" variant="secondary" onClick={async () => { const f = await pickImage(); if (f) patchBlock({ file: f }); }}>
                      <ImagePlus /> החלפת תמונה
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => patchBlock({ x: 0.5 - block.w / 2 })}>
                      <AlignCenter /> מרכז
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setBlocks([...d.blocks.filter((b) => b.id !== block.id), block])}>
                      <BringToFront /> קדימה
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setBlocks([block, ...d.blocks.filter((b) => b.id !== block.id)])}>
                      <SendToBack /> אחורה
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="col-span-2 hover:text-red-400"
                      onClick={() => {
                        setBlocks(d.blocks.filter((b) => b.id !== block.id));
                        setSelected(null);
                      }}
                    >
                      <Trash2 /> מחיקת תמונה
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Field label="טקסט">
                    <Textarea rows={3} value={block.text} onChange={(e) => patchBlock({ text: e.target.value })} />
                  </Field>
                  <div className="grid grid-cols-[1fr_120px] gap-2">
                    <Field label="גופן">
                      <FontPicker value={block.font} onChange={(font) => patchBlock({ font })} />
                    </Field>
                    <Field label="משקל">
                      <WeightPicker font={block.font} value={block.weight} onChange={(weight) => patchBlock({ weight })} />
                    </Field>
                  </div>
                  <RangeField label="גודל" value={Math.round(block.size)} min={16} max={360} step={2} format={(v) => `${v}px`} onChange={(size) => patchBlock({ size })} />
                  <Field label="יישור">
                    <Segmented
                      value={block.align}
                      onChange={(align) => patchBlock({ align })}
                      options={[
                        { value: "right", icon: <AlignRight />, title: "ימין" },
                        { value: "center", icon: <AlignCenter />, title: "מרכז" },
                        { value: "left", icon: <AlignLeft />, title: "שמאל" },
                      ]}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <RangeField label="ריווח שורות" value={block.lineHeight} min={0.8} max={2.4} step={0.05} format={(v) => v.toFixed(2)} onChange={(lineHeight) => patchBlock({ lineHeight })} />
                    <RangeField label="ריווח אותיות" value={block.letterSpacing} min={-0.1} max={0.4} step={0.01} format={(v) => v.toFixed(2)} onChange={(letterSpacing) => patchBlock({ letterSpacing })} />
                  </div>
                  <Field label="צבע טקסט">
                    <ColorField value={block.color} swatches={[...TEXT_SWATCHES, d.accent]} onChange={(c) => c && patchBlock({ color: c })} />
                  </Field>
                  <Field label="הדגשת רקע">
                    <ColorField value={block.highlight} allowNone swatches={[d.accent, "#000000", "#ffffff", "#fde047"]} onChange={(highlight) => patchBlock({ highlight })} />
                  </Field>
                  <RangeField label="שקיפות" value={block.opacity} min={0.1} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => patchBlock({ opacity })} />
                  <div className="grid grid-cols-4 gap-1.5">
                    <Tip content="קדימה">
                      <Button size="sm" variant="secondary" onClick={() => setBlocks([...d.blocks.filter((b) => b.id !== block.id), block])}>
                        <BringToFront />
                      </Button>
                    </Tip>
                    <Tip content="אחורה">
                      <Button size="sm" variant="secondary" onClick={() => setBlocks([block, ...d.blocks.filter((b) => b.id !== block.id)])}>
                        <SendToBack />
                      </Button>
                    </Tip>
                    <Tip content="שכפול">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const c = { ...block, id: uid(), x: block.x + 0.02, y: block.y + 0.04 };
                          setBlocks([...d.blocks, c]);
                          setSelected(c.id);
                        }}
                      >
                        <Copy />
                      </Button>
                    </Tip>
                    <Tip content="מחיקה">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="hover:text-red-400"
                        onClick={() => {
                          setBlocks(d.blocks.filter((b) => b.id !== block.id));
                          setSelected(null);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </Tip>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => patchBlock({ x: 0.5 - block.w / 2 })}
                  >
                    <AlignCenter /> מרכז אופקית
                  </Button>
                </>
              )}
            </Section>
          )}

          {/* ---- typography (presets) ---- */}
          {!isCustom && (
            <Section title="טיפוגרפיה">
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <Field label="גופן כותרת">
                  <FontPicker value={d.headingFont} onChange={(headingFont) => updateDraft({ headingFont })} />
                </Field>
                <Field label="משקל">
                  <WeightPicker font={d.headingFont} value={d.headingWeight} onChange={(headingWeight) => updateDraft({ headingWeight })} />
                </Field>
              </div>
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <Field label="גופן טקסט">
                  <FontPicker value={d.bodyFont} onChange={(bodyFont) => updateDraft({ bodyFont })} />
                </Field>
                <Field label="משקל">
                  <WeightPicker font={d.bodyFont} value={d.bodyWeight} onChange={(bodyWeight) => updateDraft({ bodyWeight })} />
                </Field>
              </div>
              <RangeField label="גודל טקסט" value={d.fontScale} min={0.5} max={1.8} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(fontScale) => updateDraft({ fontScale })} />
              <div className="grid grid-cols-2 gap-3">
                <RangeField label="ריווח שורות" value={d.lineHeight} min={0.8} max={1.6} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(lineHeight) => updateDraft({ lineHeight })} />
                <RangeField label="ריווח אותיות" value={d.letterSpacing} min={-0.05} max={0.3} step={0.01} format={(v) => v.toFixed(2)} onChange={(letterSpacing) => updateDraft({ letterSpacing })} />
              </div>
              {d.template !== "timer" && (
                <Field label="יישור">
                  <Segmented
                    value={d.align}
                    onChange={(align) => updateDraft({ align })}
                    options={[
                      { value: "start", label: "לימין", icon: <AlignRight /> },
                      { value: "center", label: "למרכז", icon: <AlignCenter /> },
                    ]}
                  />
                </Field>
              )}
            </Section>
          )}

          {!annotate && (
          <Section title="צבעים וקישוט">
            <Field label="רקע">
              <ColorField value={d.bg} swatches={BG_SWATCHES} onChange={(c) => c && updateDraft({ bg: c })} />
            </Field>
            <Field label="תמונת רקע">
              {d.bgImage ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <img src={mediaUrl(d.bgImage)} className="aspect-video w-24 rounded-md object-cover ring-1 ring-border" alt="" />
                    <div className="flex flex-1 flex-col gap-1">
                      <Button size="sm" variant="secondary" className="h-7" onClick={async () => { const f = await pickImage(); if (f) updateDraft({ bgImage: f }); }}>
                        החלפה
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 hover:text-red-400" onClick={() => updateDraft({ bgImage: null })}>
                        הסרה
                      </Button>
                    </div>
                  </div>
                  <RangeField label="הכהיה" value={d.bgDim} min={0} max={0.9} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(bgDim) => updateDraft({ bgDim })} />
                </div>
              ) : (
                <Button size="sm" variant="outline" className="justify-start text-muted-foreground" onClick={async () => { const f = await pickImage(); if (f) updateDraft({ bgImage: f }); }}>
                  <ImagePlus /> בחירת תמונה…
                </Button>
              )}
            </Field>
            {!isCustom && (
              <Field label="טקסט">
                <ColorField value={d.fg} swatches={TEXT_SWATCHES} onChange={(c) => c && updateDraft({ fg: c })} />
              </Field>
            )}
            <Field label="צבע הדגשה">
              <ColorField value={d.accent} swatches={ACCENT_SWATCHES} onChange={(c) => c && updateDraft({ accent: c })} />
            </Field>
            <Field label="קישוט">
              <Segmented
                value={d.decor}
                onChange={(decor) => updateDraft({ decor })}
                options={[
                  { value: "none", label: "ללא" },
                  { value: "line", label: "קו" },
                  { value: "bar", label: "פס צד" },
                  { value: "frame", label: "מסגרת" },
                ]}
              />
            </Field>
          </Section>
          )}
        </div>

        {/* ------------- preview ------------- */}
        <div className="flex min-h-0 flex-col gap-3 bg-[radial-gradient(circle_at_center,#18181b_0%,#09090b_70%)] p-6">
          <div className="flex items-start gap-2">
            <DrawToolbar
              tool={tool}
              onTool={pickTool}
              style={drawStyle}
              onStyle={changeStyle}
              selected={block}
              extra={
                <Tip content="תמונה">
                  <button
                    type="button"
                    aria-label="הוספת תמונה"
                    onClick={() => {
                      if (!isCustom) setTemplate("custom");
                      void addImage();
                    }}
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[160ms] hover:bg-accent hover:text-foreground [&_svg]:size-4"
                  >
                    <ImagePlus />
                  </button>
                </Tip>
              }
            />
            <div className="flex-1" />
            {isEditingLive && <Badge className="mt-2 border-live/40 text-live">בשידור</Badge>}
          </div>
          <div className="relative min-h-0 flex-1">
            <FitBox aspect={base ? base.aspect : 16 / 9}>
              {(w) => (
                <div className="absolute inset-0 overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/10">
                  {isCustom ? (
                    <CustomCanvas
                      draft={d}
                      width={w}
                      selectedId={selected}
                      onSelect={setSelected}
                      onBlocks={setBlocks}
                      tool={tool}
                      drawStyle={drawStyle}
                      onToolDone={() => setTool("select")}
                      {...(base
                        ? { canvasH: CANVAS_W / base.aspect, background: <PageBackground base={base} />, emptyHint: "בחר כלי וצייר" }
                        : {})}
                    />
                  ) : (
                    <TextSlideView data={d} width={w} />
                  )}
                </div>
              )}
            </FitBox>
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Keys combo={["Ctrl", "S"]} /> שמירה · <Keys combo={["Ctrl", "Enter"]} /> הקרנה
            </span>
            <Button variant="ghost" onClick={closeEditor}>
              ביטול
            </Button>
            <Button variant="secondary" onClick={() => commitDraft(false)}>
              <Check /> שמירה
            </Button>
            <Button variant="live" size="lg" onClick={() => commitDraft(true)}>
              <Radio /> שמירה והקרנה
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
