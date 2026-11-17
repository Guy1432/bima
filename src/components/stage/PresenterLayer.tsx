import { useState } from "react";
import { EV, useTauriEvent } from "@/lib/events";
import { initialPresenter, type PresenterState } from "@/lib/presenter";

/** Receives presenter-tool state (from the operator) in any window. */
export function usePresenterFeed() {
  const [p, setP] = useState<PresenterState>(initialPresenter);
  useTauriEvent<PresenterState>(EV.presenter, setP);
  return p;
}

/** CSS for the zoom tool: magnify the slide around the pointer. */
export function zoomStyle(p: PresenterState): React.CSSProperties {
  const on = p.mode === "zoom" && (p.active || p.zoomLocked);
  return {
    transform: on ? `scale(${p.zoom})` : "scale(1)",
    transformOrigin: `${p.x * 100}% ${p.y * 100}%`,
    transition: "transform 260ms cubic-bezier(0.23, 1, 0.32, 1), transform-origin 90ms linear",
    willChange: "transform",
  };
}

const VB_W = 1000;
const VB_H = 562.5;

/** Laser dot, spotlight and ink - drawn above the slide, below blackout. */
export function PresenterLayer({ p }: { p: PresenterState }) {
  const showPointer = p.active;
  return (
    <div className="pointer-events-none absolute inset-0">
      {/* ink */}
      {p.strokes.length > 0 && (
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {p.strokes.map((s, i) => (
            <polyline
              key={i}
              points={s.pts.map(([x, y]) => `${x * VB_W},${y * VB_H}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.92}
            />
          ))}
        </svg>
      )}

      {/* spotlight: everything dims except a soft circle */}
      <div
        className="absolute inset-0 transition-opacity duration-300 ease-out"
        style={{
          opacity: p.mode === "spotlight" && showPointer ? 1 : 0,
          background: `radial-gradient(circle at ${p.x * 100}% ${p.y * 100}%, transparent ${p.radius * 100}cqw, rgba(0,0,0,0.86) ${(p.radius + 0.012) * 100}cqw)`,
        }}
      />

      {/* laser pointer */}
      {p.mode === "laser" && showPointer && (
        <div
          className="absolute size-[1.3cqw] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${p.x * 100}%`,
            top: `${p.y * 100}%`,
            background: "radial-gradient(circle, #fff 0%, #ff3b3b 35%, rgba(255,0,0,0.0) 72%)",
            boxShadow: "0 0 1.2cqw 0.4cqw rgba(255,40,40,0.65)",
          }}
        />
      )}
    </div>
  );
}
