import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

export const EV = {
  live: "live-state",
  projectorReady: "projector-ready",
  projectorClosed: "projector-closed",
  mediaCmd: "media-cmd",
  mediaStatus: "media-status",
  mediaEnded: "media-ended",
  remoteKey: "remote-key",
  presenter: "presenter-state",
  fx: "stage-fx",
} as const;

export function send<T>(event: string, payload?: T) {
  emit(event, payload).catch(() => {});
}

/** Subscribe to a Tauri event (broadcast across all windows) for the component's lifetime. */
export function useTauriEvent<T>(event: string, handler: (payload: T) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    let un: UnlistenFn | undefined;
    let dead = false;
    listen<T>(event, (e) => ref.current(e.payload)).then((u) => {
      if (dead) u();
      else un = u;
    });
    return () => {
      dead = true;
      un?.();
    };
  }, [event, enabled]);
}
