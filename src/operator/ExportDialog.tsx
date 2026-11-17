import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { toast } from "sonner";
import { FileDown, FileText, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Switch } from "@/components/ui/primitives";
import { exportableSlides, exportTo, type ExportFormat } from "@/lib/export";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";

const useExport = create<{ open: boolean; itemId: string | null }>(() => ({ open: false, itemId: null }));

/** Whole project, or one run-of-show item when `itemId` is given. */
export function openExport(itemId: string | null = null) {
  useExport.setState({ open: true, itemId });
}

const FORMATS: { id: ExportFormat; label: string; hint: string; icon: typeof FileText; ext: string; filter: string }[] = [
  { id: "pdf", label: "PDF", hint: "סרטונים מופיעים כתמונה.", icon: FileText, ext: "pdf", filter: "מסמך PDF" },
  { id: "pptx", label: "PowerPoint", hint: "כולל סרטונים.", icon: Presentation, ext: "pptx", filter: "מצגת PowerPoint" },
];

const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").trim() || "בימה";

export function ExportDialog() {
  const { open, itemId } = useExport();
  const items = useSession((s) => s.items);
  const projectName = useSession((s) => s.name);
  const item = items.find((i) => i.id === itemId);
  const [scope, setScope] = useState<"item" | "all">("all");
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (open) {
      setScope(item ? "item" : "all");
      setProgress(null);
    }
  }, [open, item]);

  const chosen = scope === "item" && item ? [item] : items;
  const count = exportableSlides(chosen, includeHidden).length;
  const hiddenCount = chosen.reduce((n, i) => n + i.slides.filter((s) => s.hidden).length, 0);
  const busy = progress !== null;

  const close = (o: boolean) => {
    if (busy) {
      cancelled.current = true; // closing while exporting = cancel
      return;
    }
    useExport.setState({ open: o });
  };

  const run = async () => {
    const f = FORMATS.find((x) => x.id === format)!;
    const title = scope === "item" && item ? item.title : projectName;
    const path = await save({
      title: "ייצוא",
      defaultPath: `${safeFileName(title)}.${f.ext}`,
      filters: [{ name: f.filter, extensions: [f.ext] }],
    });
    if (!path) return;
    cancelled.current = false;
    setProgress(0);
    try {
      const ok = await exportTo(path, title, {
        format,
        items: chosen,
        includeHidden,
        onProgress: (d, t) => setProgress(d / t),
        isCancelled: () => cancelled.current,
      });
      if (ok) {
        toast.success("נשמר", { description: path });
        useExport.setState({ open: false });
      } else toast("הייצוא בוטל");
    } catch (e) {
      toast.error("הייצוא נכשל", { description: String(e) });
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title="ייצוא" className="max-w-md">
        <div className={cn("flex flex-col gap-5", busy && "pointer-events-none opacity-50")}>
          {item && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-muted-foreground">היקף</span>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-raised p-1" role="radiogroup">
                {(
                  [
                    ["item", item.title],
                    ["all", "כל הפרויקט"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={scope === id}
                    onClick={() => setScope(id)}
                    className={cn(
                      "truncate rounded-md px-3 py-1.5 text-[13px] transition-colors duration-[160ms]",
                      scope === id ? "bg-accent text-foreground shadow-[0_0_0_1px_var(--border-strong)]" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">פורמט</span>
            <div className="flex flex-col gap-1.5" role="radiogroup">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  role="radio"
                  aria-checked={format === f.id}
                  onClick={() => setFormat(f.id)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-right transition-colors duration-[160ms]",
                    format === f.id ? "border-primary/60 bg-primary/10" : "border-border hover:border-border-strong",
                  )}
                >
                  <f.icon className={cn("mt-0.5 size-4 shrink-0", format === f.id ? "text-primary-text" : "text-muted-foreground")} />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-medium">{f.label}</span>
                    <span className="text-[12px] text-muted-foreground">{f.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {hiddenCount > 0 && (
            <label className="flex items-center justify-between gap-4 text-[13px]">
              <span>
                כולל שקופיות מוסתרות <span className="text-faint tabular">({hiddenCount})</span>
              </span>
              <Switch checked={includeHidden} onCheckedChange={setIncludeHidden} />
            </label>
          )}
        </div>

        {busy ? (
          <div className="flex flex-col gap-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="flex items-center justify-between text-[12px] text-muted-foreground">
              <span>מייצא…</span>
              <Button size="sm" variant="ghost" onClick={() => (cancelled.current = true)}>
                ביטול
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-muted-foreground tabular">{count} שקופיות</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => close(false)}>
                ביטול
              </Button>
              <Button onClick={() => void run()} disabled={!count}>
                <FileDown /> ייצוא…
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
