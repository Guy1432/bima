import { useRef } from "react";
import { create } from "zustand";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * One confirmation pattern for every destructive action:
 *   const ok = await confirmAction({ title: "למחוק את השקופית?", confirmLabel: "מחיקה" });
 * Focus starts on "ביטול" so a stray Enter / clicker press never destroys anything.
 */
interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirm = create<{ req: ConfirmRequest | null }>(() => ({ req: null }));

export function confirmAction(opts: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().req?.resolve(false);
    useConfirm.setState({ req: { destructive: true, ...opts, resolve } });
  });
}

export function ConfirmHost() {
  const req = useConfirm((s) => s.req);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const close = (ok: boolean) => {
    req?.resolve(ok);
    useConfirm.setState({ req: null });
  };

  return (
    <DialogPrimitive.Root open={!!req} onOpenChange={(o) => !o && close(false)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="anim-fade fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content
          dir="rtl"
          role="alertdialog"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            cancelRef.current?.focus();
          }}
          className="anim-modal fixed top-1/2 left-1/2 z-50 w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-popover p-5 shadow-2xl ring-1 ring-border-strong outline-none"
        >
          {req && (
            <div className="flex gap-3">
              {req.destructive && (
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-red-500/10 text-red-400">
                  <TriangleAlert className="size-4" />
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <DialogPrimitive.Title className="text-[15px] font-semibold leading-snug">{req.title}</DialogPrimitive.Title>
                {req.description ? (
                  <DialogPrimitive.Description className="text-[13px] leading-relaxed text-muted-foreground">
                    {req.description}
                  </DialogPrimitive.Description>
                ) : (
                  <DialogPrimitive.Description className="sr-only">אישור פעולה</DialogPrimitive.Description>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <Button ref={cancelRef} variant="ghost" onClick={() => close(false)}>
                    ביטול
                  </Button>
                  <Button variant={req.destructive ? "destructive" : "default"} onClick={() => close(true)}>
                    {req.confirmLabel}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
