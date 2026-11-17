import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Inline rename field that survives being opened from a menu.
 *
 * When a dropdown / context menu closes it hands focus back to its trigger, which used to
 * blur this input the instant it appeared ("rename closes immediately"). We grab focus after
 * the menu has finished closing, and a blur in the first moments is treated as that menu
 * artefact - focus is taken back instead of committing.
 *
 * Enter / leaving the field = save · Escape = cancel. Text is pre-selected.
 */
export function InlineRename({
  value,
  onCommit,
  onCancel,
  className,
  label = "שם חדש",
}: {
  value: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
  className?: string;
  label?: string;
}) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const openedAt = useRef(performance.now());
  const done = useRef(false);

  useEffect(() => {
    const focus = () => {
      ref.current?.focus();
      ref.current?.select();
    };
    focus();
    // after the menu's close animation + focus restore
    const t1 = setTimeout(focus, 60);
    const t2 = setTimeout(focus, 220);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = v.trim();
    if (save && next && next !== value) onCommit(next);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      value={v}
      aria-label={label}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (performance.now() - openedAt.current < 400) {
          // focus was stolen by a closing menu - take it back
          requestAnimationFrame(() => ref.current?.focus());
          return;
        }
        finish(true);
      }}
      onKeyDown={(e) => {
        e.stopPropagation(); // typing a name must not trigger app shortcuts (B, W, arrows…)
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        "h-7 w-full min-w-0 rounded-md bg-background px-2 text-[13px] text-foreground shadow-[inset_0_0_0_1px_var(--ring)] outline-none",
        className,
      )}
    />
  );
}
