import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { create } from "zustand";
import { Check, CheckCheck, X } from "lucide-react";
import { SlideThumb } from "@/components/stage/Stage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { slidesFromPath } from "@/lib/importer";
import { EXT } from "@/lib/media";
import type { Slide } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PickerState {
  open: boolean;
  slides: Slide[];
  title: string;
  single: boolean;
  resolve: ((s: Slide[] | null) => void) | null;
}

const usePicker = create<PickerState>(() => ({ open: false, slides: [], title: "", single: false, resolve: null }));

/**
 * Choose files (PowerPoint / PDF / images), convert them, then let the user pick which
 * slides to bring in. Resolves with the chosen slides (or null if cancelled).
 */
export async function pickSlides(opts: { single?: boolean; imagesOnly?: boolean; title?: string } = {}): Promise<Slide[] | null> {
  const sel = await open({
    multiple: !opts.single,
    title: opts.title ?? "בחירת מצגת, PDF או תמונות",
    filters: [
      {
        name: "מצגות, PDF ותמונות",
        extensions: [...EXT.presentation, ...EXT.pdf, ...EXT.image, ...(opts.imagesOnly ? [] : EXT.video)],
      },
    ],
  });
  if (!sel) return null;
  const paths = Array.isArray(sel) ? sel : [sel];

  const id = toast.loading("טוען…");
  const all: Slide[] = [];
  try {
    for (const p of paths) all.push(...(await slidesFromPath(p, (m) => toast.loading(m, { id }))));
    toast.dismiss(id);
  } catch (e) {
    toast.error("הטעינה נכשלה", { id, description: String(e) });
    return null;
  }
  const usable = opts.imagesOnly ? all.filter((s) => s.content.kind === "image") : all;
  if (!usable.length) return null;
  // a single image file needs no picking
  if (usable.length === 1) return usable;

  return new Promise((resolve) =>
    usePicker.setState({
      open: true,
      slides: usable,
      single: !!opts.single,
      title: paths.length === 1 ? (paths[0].split(/[\\/]/).pop() ?? "") : `${paths.length} קבצים`,
      resolve,
    }),
  );
}

export function SlidePickerDialog() {
  const { open: isOpen, slides, title, single, resolve } = usePicker();
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) setChosen(single ? new Set() : new Set(slides.map((s) => s.id)));
  }, [isOpen, slides, single]);

  const finish = (result: Slide[] | null) => {
    resolve?.(result);
    usePicker.setState({ open: false, resolve: null });
  };

  const toggle = (id: string) =>
    setChosen((prev) => {
      if (single) return new Set([id]);
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && finish(null)}>
      <DialogContent
        title={single ? "בחירת שקופית" : "בחירת שקופיות"}
        description={`${title} · ${slides.length} שקופיות`}
        className="max-w-5xl"
      >
        {!single && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setChosen(new Set(slides.map((s) => s.id)))}>
              <CheckCheck /> בחירת הכל
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChosen(new Set())}>
              <X /> ניקוי בחירה
            </Button>
            <span className="mr-auto text-xs text-muted-foreground tabular">
              נבחרו {chosen.size} מתוך {slides.length}
            </span>
          </div>
        )}
        <div className="-mx-1 grid max-h-[58vh] grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 overflow-y-auto p-1">
          {slides.map((s, i) => {
            const on = chosen.has(s.id);
            return (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                onDoubleClick={() => single && finish([s])}
                style={{ ["--stagger" as string]: `${Math.min(i, 16) * 15}ms` }}
                className="enter-rise pressable flex flex-col gap-1 text-right"
              >
                <div
                  className={cn(
                    "relative aspect-video w-full overflow-hidden rounded-lg bg-black transition-[box-shadow,opacity] duration-[160ms]",
                    on ? "ring-[3px] ring-primary ring-offset-2 ring-offset-popover" : "opacity-60 ring-1 ring-border hover:opacity-100",
                  )}
                >
                  <SlideThumb slide={s} />
                  <span
                    className={cn(
                      "absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full border transition-colors",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-white/50 bg-black/40",
                    )}
                  >
                    {on && <Check className="size-3" />}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground tabular">{i + 1}</span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => finish(null)}>
            ביטול
          </Button>
          <Button disabled={!chosen.size} onClick={() => finish(slides.filter((s) => chosen.has(s.id)))}>
            <Check /> {single ? "בחירה" : `הוספת ${chosen.size} שקופיות`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
