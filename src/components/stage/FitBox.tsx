import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Letterboxes a box of a given aspect ratio inside its parent; children get the box size. */
export function FitBox({
  aspect,
  children,
  className,
}: {
  aspect: number;
  children: (w: number, h: number) => ReactNode;
  className?: string;
}) {
  const [ref, { w, h }] = useElementSize<HTMLDivElement>();
  let bw = w;
  let bh = w / aspect;
  if (bh > h) {
    bh = h;
    bw = h * aspect;
  }
  return (
    <div ref={ref} className={cn("absolute inset-0 flex items-center justify-center overflow-hidden", className)}>
      {bw > 0 && bh > 0 && (
        <div className="relative shrink-0 overflow-hidden" style={{ width: bw, height: bh }}>
          {children(bw, bh)}
        </div>
      )}
    </div>
  );
}
