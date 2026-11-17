import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Keys } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { checkForUpdate, installUpdate, useUpdater } from "@/lib/updater";
import { Download, RefreshCw } from "lucide-react";

/** Each row: alternatives (any one works), each a combination of keys pressed together. */
const SHORTCUTS: { group: string; rows: [string[][], string][] }[] = [
  {
    group: "ניווט",
    rows: [
      [[["PgDn"], ["→"], ["Space"]], "הבא"],
      [[["PgUp"], ["←"]], "הקודם"],
      [[["Home"], ["End"]], "שקופית ראשונה / אחרונה בפריט"],
      [[["F5"]], "התחלת הקרנה"],
    ],
  },
  {
    group: "מסך הקהל",
    rows: [
      [[["B"], ["."]], "השחרה / חזרה"],
      [[["W"]], "מסך לבן"],
      [[["Esc"]], "ביטול השחרה או כלי מציג"],
      [[["+"], ["−"], ["0"]], "זום במסמך: הגדלה / הקטנה / עמוד שלם"],
    ],
  },
  {
    group: "וידאו",
    rows: [
      [[["K"]], "ניגון / השהיה"],
      [[["J"], ["L"]], "10 שניות אחורה / קדימה"],
      [[["M"]], "השתקה"],
    ],
  },
  {
    group: "עריכה",
    rows: [
      [[["Ctrl", "Enter"]], "בעורך: שמירה והקרנה"],
      [[["Ctrl", "Z"]], "ביטול פעולה"],
      [[["Ctrl", "Y"]], "ביצוע שוב"],
      [[["Shift", "1"], ["Shift", "8"]], "אפקטים 1–8"],
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="קיצורי מקלדת וקליקר" description="המקשים פועלים גם מקליקר." className="max-w-lg">
        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto">
          {SHORTCUTS.map((g) => (
            <section key={g.group} className="flex flex-col">
              <h3 className="pb-1 text-[11px] font-semibold text-faint">{g.group}</h3>
              <div className="flex flex-col divide-y divide-border">
                {g.rows.map(([alts, desc]) => (
                  <div key={desc} className="flex items-center justify-between gap-4 py-2 text-[13px]">
                    <span>{desc}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {alts.map((combo, i) => (
                        <span key={combo.join("+")} className="flex items-center gap-1.5">
                          {i > 0 && <span className="text-[11px] text-faint">{alts.length === 2 && g.group !== "ניווט" ? "/" : "או"}</span>}
                          <Keys combo={combo} />
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function UpdateRow() {
  const { version, available, checking, installing, progress } = useUpdater();
  return (
    <div className="flex items-center justify-between gap-6">
      <div>
        <div className="text-[13px] font-medium">בימה {version}</div>
        <div className="text-xs text-muted-foreground">
          {available ? (
            <span className="text-primary-text">גרסה {available.version} זמינה להתקנה</span>
          ) : (
            "בדיקת עדכונים אוטומטית"
          )}
        </div>
      </div>
      {available ? (
        <Button size="sm" onClick={() => void installUpdate()} disabled={installing}>
          <Download /> {installing ? `${Math.round(progress * 100)}%` : "עדכון"}
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => void checkForUpdate({ silent: false })} disabled={checking}>
          <RefreshCw className={cn(checking && "animate-spin")} /> בדיקת עדכונים
        </Button>
      )}
    </div>
  );
}
