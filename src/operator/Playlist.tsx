import type React from "react";
import { confirmAction } from "@/components/ConfirmHost";
import { openYouTubeClip } from "./ClipDialog";
import { openExport } from "./ExportDialog";
import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FileText,
  Film,
  GripVertical,
  Image as ImageIcon,
  Link2,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Presentation,
  Trash2,
  Type,
  Upload,
  Youtube, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/primitives";
import { InlineRename } from "@/components/InlineRename";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import type { Item, ItemType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";
import { undo } from "@/store/history";
import { toast } from "sonner";
import { TYPE_COLOR } from "@/lib/theme";
import { pickAndImport } from "./actions";
import { UNDO_KEYS } from "@/lib/platform";

export const TYPE_META: Record<ItemType, { icon: typeof Film; label: string }> = {
  presentation: { icon: Presentation, label: "מצגת" },
  pdf: { icon: FileText, label: "PDF" },
  video: { icon: Film, label: "וידאו" },
  youtube: { icon: Youtube, label: "YouTube" },
  image: { icon: ImageIcon, label: "תמונה" },
  text: { icon: Type, label: "טקסט" },
};

const firstVisible = (item: Item) => Math.max(0, item.slides.findIndex((s) => !s.hidden));

function LiveBadge() {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-live-soft px-1.5 py-0.5 text-[11px] font-semibold text-live">
      <span className="live-pulse size-1.5 rounded-full bg-live" />
      בשידור
    </span>
  );
}

function Row({ item, index, total }: { item: Item; index: number; total: number }) {
  const selected = useSession((s) => s.selectedItemId === item.id);
  const isLive = useSession((s) => s.live.itemId === item.id && !!s.live.slide);
  const liveIdx = useSession((s) => (s.live.itemId === item.id ? s.live.slideIndex : -1));
  const { select, goLive, removeItem, duplicateItem, renameItem } = useSession.getState();
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const Icon = TYPE_META[item.type].icon;

  const moveBy = (d: number) => {
    const items = useSession.getState().items;
    const target = items[index + d];
    if (target) useSession.getState().reorderItems(item.id, target.id);
  };

  const actions = (I: typeof DropdownMenuItem | typeof ContextMenuItem, Sep: () => React.ReactElement) => (
    <>
      <I onSelect={() => goLive(item.id, firstVisible(item))}>
        <Presentation /> הקרנה מההתחלה
      </I>
      <I onSelect={() => setEditing(true)}>
        <Pencil /> שינוי שם…
      </I>
      <I onSelect={() => duplicateItem(item.id)}>
        <Copy /> שכפול
      </I>
      <I disabled={index === 0} onSelect={() => moveBy(-1)}>
        <ArrowUp /> הזזה למעלה
      </I>
      <I disabled={index === total - 1} onSelect={() => moveBy(1)}>
        <ArrowDown /> הזזה למטה
      </I>
      <Sep />
      <I onSelect={() => openExport(item.id)}>
        <FileDown /> ייצוא…
      </I>
      <Sep />
      <I
        destructive
        onSelect={async () => {
          const ok = await confirmAction({
            title: `להסיר את "${item.title}" מהרשימה?`,
            description: `${item.slides.length > 1 ? `כל ${item.slides.length} השקופיות שלו יוסרו. ` : ""}אפשר להחזיר עם ${UNDO_KEYS}.`,
            confirmLabel: "הסרה",
          });
          if (!ok) return;
          removeItem(item.id);
          toast(`"${item.title}" הוסר מהרשימה`, { action: { label: "ביטול", onClick: () => undo() } });
        }}
      >
        <Trash2 /> הסרה מהרשימה…
      </I>
    </>
  );


  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={{
            transform: CSS.Translate.toString(transform),
            transition,
            ["--stagger" as string]: `${Math.min(index, 10) * 25}ms`,
          }}
          onClick={() => select(item.id)}
          onDoubleClick={() => goLive(item.id, firstVisible(item))}
          className={cn(
            "enter-rise group relative flex h-12 cursor-default items-center gap-2.5 rounded-md pr-2 pl-1 transition-[background-color,box-shadow] duration-[160ms]",
            selected ? "bg-raised shadow-[inset_0_0_0_1px_var(--border-strong)]" : "hover:bg-accent/60",
            isDragging && "z-10 bg-raised shadow-xl ring-1 ring-border-strong",
          )}
        >
          <button
            {...attributes}
            {...listeners}
            className="absolute inset-y-0 -right-1 flex w-6 cursor-grab items-center justify-start text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
            aria-label="גרור לסידור"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="size-3" />
          </button>
          <div
            className={cn(
              "w-5 shrink-0 text-center text-[13px] font-semibold tabular leading-none transition-colors",
              isLive ? "text-live" : selected ? "text-foreground" : "text-faint",
            )}
          >
            {index + 1}
          </div>
          <Icon className="size-4 shrink-0" style={{ color: isLive ? "var(--live)" : TYPE_COLOR[item.type] }} />
          <div className="min-w-0 flex-1">
            {editing ? (
              <InlineRename
                value={item.title}
                label="שם הפריט"
                onCommit={(v) => {
                  setEditing(false);
                  renameItem(item.id, v);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <>
                <div className={cn("truncate text-[13px] leading-tight", selected ? "font-semibold" : "font-medium")}>{item.title}</div>
                <div className="mt-0.5 truncate text-[11px] text-faint tabular">
                  {TYPE_META[item.type].label}
                  {item.slides.length > 1 && ` · ${liveIdx >= 0 ? `${liveIdx + 1}/` : ""}${item.slides.length}`}
                  {item.note && ` · ${item.note}`}
                </div>
              </>
            )}
          </div>
          {isLive && <LiveBadge />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                onClick={(e) => e.stopPropagation()}
                aria-label="פעולות"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">{actions(DropdownMenuItem, DropdownMenuSeparator)}</DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>{actions(ContextMenuItem, ContextMenuSeparator)}</ContextMenuContent>
    </ContextMenu>
  );
}

/** Narrow windows: the run-of-show becomes a rail of numbers + type icons. */
function RailRow({ item, index }: { item: Item; index: number }) {
  const selected = useSession((s) => s.selectedItemId === item.id);
  const isLive = useSession((s) => s.live.itemId === item.id && !!s.live.slide);
  const { select, goLive } = useSession.getState();
  const Icon = TYPE_META[item.type].icon;
  return (
    <Tip content={item.title} side="left">
      <button
        onClick={() => select(item.id)}
        onDoubleClick={() => goLive(item.id, firstVisible(item))}
        className={cn(
          "relative flex h-12 w-full shrink-0 flex-col items-center justify-center gap-1 rounded-md transition-colors duration-[160ms]",
          selected ? "bg-raised shadow-[inset_0_0_0_1px_var(--border-strong)]" : "hover:bg-accent/60",
        )}
        aria-label={item.title}
      >
        <span className={cn("text-[12px] font-semibold tabular leading-none", isLive ? "text-live" : selected ? "text-foreground" : "text-faint")}>
          {index + 1}
        </span>
        <Icon className="size-3.5" style={{ color: isLive ? "var(--live)" : TYPE_COLOR[item.type] }} />
        {isLive && <span className="live-pulse absolute top-1.5 left-1.5 size-1.5 rounded-full bg-live" />}
      </button>
    </Tip>
  );
}

function AddMenu({ compact }: { compact?: boolean }) {
  const newTextSlide = useSession((s) => s.newTextSlide);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button size="icon-sm" variant="ghost" aria-label="הוספה לרשימה">
            <Plus />
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="gap-1.5 px-2 text-foreground">
            <Plus /> הוספה
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={() => pickAndImport()}>
          <Upload /> קבצים…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openYouTubeClip()}>
          <Link2 /> סרטון YouTube…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => newTextSlide()}>
          <Type /> שקופית טקסט
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Playlist({
  compact,
  onExpand,
  onClose,
}: {
  /** narrow window: numbers + icons only */
  compact?: boolean;
  onExpand?: () => void;
  /** rendered as a drawer over the compact rail */
  onClose?: () => void;
}) {
  const items = useSession((s) => s.items);
  const reorder = useSession((s) => s.reorderItems);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) reorder(String(e.active.id), String(e.over.id));
  };

  if (compact) {
    return (
      <aside className="flex min-h-0 flex-col border-l border-border bg-card">
        <div className="flex h-11 shrink-0 items-center justify-center border-b border-border">
          <Tip content="הצגת הרשימה" side="left">
            <Button size="icon-sm" variant="ghost" onClick={onExpand} aria-label="הצגת הרשימה">
              <PanelRightOpen />
            </Button>
          </Tip>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-1.5">
          {items.map((item, i) => (
            <RailRow key={item.id} item={item} index={i} />
          ))}
          <div className="mt-1 flex justify-center">
            <AddMenu compact />
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className={cn("flex min-h-0 flex-col border-l border-border bg-card", onClose && "h-full shadow-2xl")}>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border pr-3 pl-1.5">
        <h2 className="flex-1 text-[13px] font-semibold">רשימת הצגה</h2>
        <AddMenu />
        {onClose && (
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="סגור">
            <PanelRightClose />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {items.length === 0 ? (
          <button
            onClick={() => pickAndImport()}
            className="flex h-full min-h-60 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong p-6 text-center text-muted-foreground transition-colors hover:border-faint hover:text-foreground"
          >
            <Upload className="size-5" />
            <div className="text-[13px] font-medium">גרור קבצים לכאן או לחץ לבחירה</div>
            <div className="text-[11px] leading-relaxed text-faint">PowerPoint · PDF · וידאו · תמונות · חבילת פרויקט</div>
          </button>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-px">
                {items.map((item, i) => (
                  <Row key={item.id} item={item} index={i} total={items.length} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </aside>
  );
}
