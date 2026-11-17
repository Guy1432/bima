import { useRef, useState } from "react";
import { confirmAction } from "@/components/ConfirmHost";
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ImagePlus } from "lucide-react";
import { pickSlides } from "./SlidePicker";
import { Check, Copy, Eye, EyeOff, Film, Grid2x2, Grid3x3, Pencil, PenLine, PlayCircle, Plus, Scissors, Square, Trash2, Upload, Type, Link2, Youtube } from "lucide-react";
import { SlideThumb } from "@/components/stage/Stage";
import { Button } from "@/components/ui/button";
import { Badge, Tip } from "@/components/ui/primitives";
import { useSettings } from "@/lib/settings";
import type { Item, Slide } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";
import { undo } from "@/store/history";
import { toast } from "sonner";
import { pickAndImport } from "./actions";
import { TYPE_META } from "./Playlist";
import { TYPE_COLOR } from "@/lib/theme";
import { SlideEditor } from "./SlideEditor";
import { editClip, isClip, openVideoClip, openYouTubeClip } from "./ClipDialog";
import { UNDO_KEYS } from "@/lib/platform";

/** Tiny "+" menu: insert a designed slide or slides from files after a given slide. */
function InsertMenu({ item, afterIndex, children }: { item: Item; afterIndex?: number; children: React.ReactNode }) {
  const newTextSlide = useSession((s) => s.newTextSlide);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem onSelect={() => newTextSlide(item.id, afterIndex)}>
          <Type /> שקופית חדשה
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => addFromFiles(item.id, afterIndex)}>
          <ImagePlus /> ייבוא שקופיות מקובץ…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openYouTubeClip({ itemId: item.id, afterIndex })}>
          <Youtube /> סרטון YouTube…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void openVideoClip({ itemId: item.id, afterIndex })}>
          <Film /> סרטון מקובץ…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TileCard({ item, slide, index, isLive, overlay }: { item: Item; slide: Slide; index: number; isLive: boolean; overlay?: boolean }) {
  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-lg bg-black",
        isLive ? "ring-2 ring-live ring-offset-2 ring-offset-background" : "ring-1 ring-border group-hover:ring-border-strong",
        overlay && "shadow-2xl shadow-black/60 ring-2 ring-primary",
        slide.hidden && !overlay && "opacity-35",
      )}
    >
      <SlideThumb slide={slide} />
      {isLive && (
        <Badge variant="live" className="enter-fade absolute top-1.5 right-1.5 shadow">
          בשידור
        </Badge>
      )}
      {overlay && <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 text-[11px] text-white tabular">{index + 1}</span>}
      <span className="sr-only">{item.title}</span>
    </div>
  );
}

function Tile({ item, slide, index, wasDragged }: { item: Item; slide: Slide; index: number; wasDragged: () => boolean }) {
  const isLive = useSession((s) => s.live.itemId === item.id && s.live.slideIndex === index && !!s.live.slide);
  const { goLive, openEditor, annotateSlide, toggleSlideHidden, duplicateSlide, removeSlide } = useSession.getState();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  const isText = slide.content.kind === "text";
  const clip = isClip(slide);
  const isPage = slide.content.kind === "image";
  const annotated = slide.content.kind === "image" && !!slide.content.overlay?.length;
  const trimmed =
    (slide.content.kind === "video" && !!(slide.content.trimStart || slide.content.trimEnd)) ||
    (slide.content.kind === "youtube" && !!(slide.content.start || slide.content.end));

  return (
    // outer: positioned by dnd-kit (no CSS transition of ours may touch `transform` here)
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className="touch-none">
      {/* inner: entrance animation only */}
      <div
        style={{ ["--stagger" as string]: `${Math.min(index, 14) * 18}ms` }}
        className={cn("enter-rise group relative flex flex-col gap-1.5", isDragging && "opacity-30")}
      >
        <button
          {...attributes}
          {...listeners}
          onClick={() => {
            if (wasDragged()) return; // releasing a drag must not put the slide on air
            goLive(item.id, index);
          }}
          onDoubleClick={() =>
            isText ? openEditor(item.id, slide.id) : clip ? editClip(item.id, slide) : isPage && void annotateSlide(item.id, slide.id)
          }
          className="pressable block w-full cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:cursor-grabbing"
        >
          <TileCard item={item} slide={slide} index={index} isLive={isLive} />
        </button>
        <div className="flex h-6 items-center justify-between px-0.5">
          <span className={cn("text-[12px] tabular", isLive ? "font-semibold text-live" : "text-faint")}>
            {index + 1}
            {slide.hidden && <span className="mr-1.5 text-[11px]">מוסתרת</span>}
            {isText && <span className="mr-1.5 text-[11px] text-muted-foreground">טקסט</span>}
            {trimmed && <span className="mr-1.5 text-[11px] text-muted-foreground">חתוך</span>}
            {annotated && <span className="mr-1.5 text-[11px] text-muted-foreground">ציור</span>}
          </span>
          <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
            {isText && (
              <Tip content="עריכה">
                <Button variant="ghost" size="icon-sm" onClick={() => openEditor(item.id, slide.id)}>
                  <Pencil className="size-3.5" />
                </Button>
              </Tip>
            )}
            {isPage && (
              <Tip content="ציור על השקופית">
                <Button variant="ghost" size="icon-sm" aria-label="ציור על השקופית" onClick={() => void annotateSlide(item.id, slide.id)}>
                  <PenLine className="size-3.5" />
                </Button>
              </Tip>
            )}
            {clip && (
              <Tip content="חיתוך">
                <Button variant="ghost" size="icon-sm" aria-label="חיתוך" onClick={() => editClip(item.id, slide)}>
                  <Scissors className="size-3.5" />
                </Button>
              </Tip>
            )}
            <InsertMenu item={item} afterIndex={index}>
              <Button variant="ghost" size="icon-sm" aria-label="הוספת שקופית אחרי זו">
                <Plus className="size-3.5" />
              </Button>
            </InsertMenu>
            <Tip content={slide.hidden ? "הצגה בהקרנה" : "דילוג בהקרנה"}>
              <Button variant="ghost" size="icon-sm" onClick={() => toggleSlideHidden(item.id, slide.id)}>
                {slide.hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </Button>
            </Tip>
            <Tip content="שכפול">
              <Button variant="ghost" size="icon-sm" onClick={() => duplicateSlide(item.id, slide.id)}>
                <Copy className="size-3.5" />
              </Button>
            </Tip>
            {item.slides.length > 1 && (
              <Tip content="מחיקת שקופית">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hover:bg-red-500/10 hover:text-red-400"
                  aria-label="מחיקת שקופית"
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: `למחוק את שקופית ${index + 1}?`,
                      description: `ניתן לשחזר עם ${UNDO_KEYS}.`,
                      confirmLabel: "מחיקת שקופית",
                    });
                    if (!ok) return;
                    removeSlide(item.id, slide.id);
                    toast(`שקופית ${index + 1} נמחקה`, { action: { label: "ביטול", onClick: () => undo() } });
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </Tip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MediaMenu({ item }: { item: Item }) {
  const update = useSession((s) => s.updateItemMedia);
  const hasMedia = item.slides.some(
    (s) => s.content.kind === "video" || s.content.kind === "youtube" || (s.content.kind === "image" && s.content.videos?.length),
  );
  if (!hasMedia) return null;
  const on = [item.media.autoplay && "אוטומטי", item.media.loop && "חוזר", item.media.advanceOnEnd && "מעבר בסיום"].filter(Boolean);
  const opt = (key: "autoplay" | "loop" | "advanceOnEnd", label: string, hint: string) => (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault(); // keep the menu open while toggling
        update(item.id, { [key]: !item.media[key] });
      }}
      className="items-start gap-2.5 py-2"
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
          item.media[key] ? "border-primary bg-primary text-primary-foreground" : "border-border-strong",
        )}
      >
        {item.media[key] && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] text-foreground">{label}</span>
        <span className="text-[11px] text-faint">{hint}</span>
      </span>
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <Tip content="אפשרויות ניגון">
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="gap-1.5 px-2">
            <PlayCircle />
            <span className="hidden max-w-40 truncate 2xl:inline">{on.length ? on.join(" · ") : "ניגון"}</span>
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-64">
        {opt("autoplay", "ניגון אוטומטי", "הניגון מתחיל עם הצגת השקופית")}
        {opt("loop", "ניגון חוזר", "חזרה להתחלה בסיום")}
        {opt("advanceOnEnd", "מעבר לפריט הבא", "בסיום הסרטון")}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SIZES = [
  { v: 168, label: "קטן", icon: Grid3x3 },
  { v: 232, label: "בינוני", icon: Grid2x2 },
  { v: 320, label: "גדול", icon: Square },
];

function SizeToggle() {
  const thumbSize = useSettings((s) => s.thumbSize);
  const set = useSettings((s) => s.set);
  const current = SIZES.reduce((a, b) => (Math.abs(b.v - thumbSize) < Math.abs(a.v - thumbSize) ? b : a));
  return (
    <div className="flex items-center rounded-md bg-raised p-0.5" role="radiogroup" aria-label="גודל תצוגה">
      {SIZES.map((s) => (
        <Tip key={s.v} content={`תצוגה ${s.label}`}>
          <button
            role="radio"
            aria-checked={current.v === s.v}
            aria-label={`תצוגה ${s.label}`}
            onClick={() => set({ thumbSize: s.v })}
            className={cn(
              "flex size-6 items-center justify-center rounded-[5px] transition-colors duration-[160ms]",
              current.v === s.v ? "bg-accent text-foreground shadow-[0_0_0_1px_var(--border-strong)]" : "text-faint hover:text-foreground",
            )}
          >
            <s.icon className="size-3.5" />
          </button>
        </Tip>
      ))}
    </div>
  );
}

function EmptyState() {
  const newTextSlide = useSession((s) => s.newTextSlide);
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="flex max-w-md flex-col items-center gap-5 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-card">
          <Grid2x2 className="size-6 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-[17px] font-semibold">הפרויקט ריק</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            גרור לכאן מצגות, קבצי PDF, סרטונים ותמונות, או צור שקופית טקסט.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => pickAndImport()}>
            <Upload /> הוספת קבצים
          </Button>
          <Button variant="secondary" onClick={() => openYouTubeClip()}>
            <Link2 /> YouTube
          </Button>
          <Button variant="secondary" onClick={() => newTextSlide()}>
            <Type /> שקופית טקסט
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Pick slides from a deck / PDF / images and append them to an item. */
export async function addFromFiles(itemId: string, afterIndex?: number) {
  const slides = await pickSlides({ title: "ייבוא שקופיות" });
  if (!slides?.length) return;
  useSession.getState().insertSlides(itemId, slides, afterIndex);
  toast.success(`נוספו ${slides.length} שקופיות`, { action: { label: "ביטול", onClick: () => undo() } });
}

export function CenterPanel() {
  const item = useSession((s) => s.items.find((i) => i.id === s.selectedItemId));
  const editor = useSession((s) => s.editor);
  const { moveSlide } = useSession.getState();
  const thumbSize = useSettings((s) => s.thumbSize);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const draggedAt = useRef(0);
  const wasDragged = () => performance.now() - draggedAt.current < 250;

  if (editor) return <SlideEditor />;
  if (!item) return <EmptyState />;

  const Icon = TYPE_META[item.type].icon;
  const onDragEnd = (e: DragEndEvent) => {
    draggedAt.current = performance.now();
    setActiveId(null);
    if (e.over && e.active.id !== e.over.id) moveSlide(item.id, String(e.active.id), String(e.over.id));
  };
  const activeIndex = activeId ? item.slides.findIndex((s) => s.id === activeId) : -1;

  return (
    <section className="flex min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border pr-4 pl-2">
        <Icon className="size-4 shrink-0" style={{ color: TYPE_COLOR[item.type] }} />
        <h2 className="min-w-0 truncate text-[13px] font-semibold">{item.title}</h2>
        <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[11px] text-muted-foreground tabular">{item.slides.length}</span>
        <div className="min-w-2 flex-1" />
        <MediaMenu item={item} />
        <SizeToggle />
        <div className="mx-0.5 h-4 w-px bg-border" />
        <InsertMenu item={item}>
          <Button size="sm" variant="secondary" className="gap-1.5 px-2.5">
            <Plus /> <span>שקופית</span>
          </Button>
        </InsertMenu>
      </header>

      <div key={item.id} className="enter-fade min-h-0 flex-1 overflow-y-auto p-5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setActiveId(String(e.active.id))}
          onDragCancel={() => {
            draggedAt.current = performance.now();
            setActiveId(null);
          }}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={item.slides.map((s) => s.id)} strategy={rectSortingStrategy}>
            <div className="grid gap-x-4 gap-y-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}>
              {item.slides.map((slide, i) => (
                <Tile key={slide.id} item={item} slide={slide} index={i} wasDragged={wasDragged} />
              ))}
              <InsertMenu item={item}>
                <button className="pressable flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong text-[12px] text-faint transition-colors hover:border-faint hover:bg-accent/40 hover:text-foreground">
                  <Plus className="size-5" />
                  הוספת שקופית
                </button>
              </InsertMenu>
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}>
            {activeIndex >= 0 && (
              <div className="rotate-[1.5deg] scale-[1.03]">
                <TileCard item={item} slide={item.slides[activeIndex]} index={activeIndex} isLive={false} overlay />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>
    </section>
  );
}
