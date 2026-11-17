import { useEffect, useState } from "react";
import { Stage } from "@/components/stage/Stage";
import { EV, send, useTauriEvent } from "@/lib/events";
import type { LiveState } from "@/lib/types";
import { DEFAULT_MEDIA } from "@/lib/types";

const initial: LiveState = {
  key: "init",
  slide: null,
  itemId: null,
  slideIndex: -1,
  blackout: "none",
  message: null,
  transition: "fade",
  fadeMs: 350,
  startedAt: Date.now(),
  media: DEFAULT_MEDIA,
  projectorOpen: true,
};

/** Audience window: renders only what the operator pushes. No UI, no cursor. */
export function ProjectorApp() {
  const [live, setLive] = useState<LiveState>(initial);

  useTauriEvent<LiveState>(EV.live, setLive);

  useEffect(() => {
    // ask the operator for the current state (sent again in case we mounted first)
    send(EV.projectorReady);
    const t = setTimeout(() => send(EV.projectorReady), 400);
    return () => clearTimeout(t);
  }, []);

  // Clickers send keys to whichever window has focus → forward to the operator.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      send(EV.remoteKey, { key: e.key, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
    };
    const block = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", block);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", block);
    };
  }, []);

  return (
    <div className="projector-root fixed inset-0 bg-black">
      <Stage live={live} role="master" />
    </div>
  );
}
