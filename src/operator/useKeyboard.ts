import { useEffect } from "react";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { toast } from "sonner";
import { EV, send, useTauriEvent } from "@/lib/events";
import { useSettings } from "@/lib/settings";
import { slideHasMedia, type MediaCommand, type MediaStatus } from "@/lib/types";
import { isTypingTarget } from "@/lib/utils";
import { useSession } from "@/store/session";
import { setPresenter, usePresenter } from "@/lib/presenter";
import { redo, undo } from "@/store/history";
import { fireFx, WOWS } from "./WowPanel";
import { openProjector } from "./actions";
import { doc } from "./DocControls";

interface KeyInfo {
  key: string;
  code?: string;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
}

/* ------------------------------------------------------------------ clicker × media
 * On a slide with a video the clicker drives the video, so the presenter never touches
 * the computer:
 *   next  – video not started → play · paused → resume · playing → (nothing, waits)
 *   back  – playing → pause · not started → previous slide
 *   next,next (double press)  → next slide          back,back (double press) → previous slide
 *   finished video → next/back behave normally.
 * Anti-trap: if "play" was asked and the video still hasn't moved by the next press
 * (failed to load), that press moves on. */
const DOUBLE_MS = 750;
const media = { key: "", status: null as MediaStatus | null, started: false, askedPlay: false };
let lastPress: { dir: 1 | -1; t: number } | null = null;

function trackMediaStatus(st: MediaStatus) {
  if (st.key !== media.key) {
    media.key = st.key;
    media.started = false;
    media.askedPlay = false;
  }
  media.status = st;
  if (!st.paused || st.currentTime > 0.3) media.started = true;
}

function hint(text: string) {
  toast(text, { id: "clicker-hint", duration: 1600 });
}

/** Returns true if the press was consumed by the video; false → navigate normally. */
function clickerMediaStep(dir: 1 | -1): boolean {
  const s = useSession.getState();
  if (!slideHasMedia(s.live.slide)) {
    lastPress = null;
    return false;
  }
  const key = s.live.key;
  if (media.key !== key) {
    media.key = key;
    media.status = null;
    media.started = false;
    media.askedPlay = false;
  }
  const now = performance.now();
  const double = !!lastPress && lastPress.dir === dir && now - lastPress.t < DOUBLE_MS;
  lastPress = { dir, t: now };
  const navigate = () => {
    lastPress = null; // the next slide starts fresh
    return false;
  };

  const st = media.status;
  if (double || st?.ended) return navigate();
  const playing = !!st && !st.paused;

  if (dir === 1) {
    if (playing) {
      hint("לחיצה כפולה: השקופית הבאה");
      return true;
    }
    if (media.askedPlay && !media.started) return navigate(); // play didn't take → don't trap
    media.askedPlay = true;
    send<MediaCommand>(EV.mediaCmd, { type: "play" });
    return true;
  }

  // back
  if (playing) {
    send<MediaCommand>(EV.mediaCmd, { type: "pause" });
    return true;
  }
  if (!media.started) return navigate();
  hint("לחיצה כפולה: השקופית הקודמת");
  return true;
}

/** Returns true if the key was handled. Shared by the operator window and keys forwarded from the projector. */
function handleKey(k: KeyInfo): boolean {
  const s = useSession.getState();
  const { reverseArrows } = useSettings.getState();
  if (k.ctrl || k.alt) return false;
  const digit = /^Digit([1-8])$/.exec(k.code ?? "");
  if (k.shift && digit) {
    fireFx(WOWS[+digit[1] - 1].id);
    return true;
  }

  const forward = reverseArrows ? ["ArrowLeft"] : ["ArrowRight"];
  const back = reverseArrows ? ["ArrowRight"] : ["ArrowLeft"];

  // Match on the PHYSICAL key (e.code) so it works with a Hebrew keyboard layout too
  // ("." arrives as "ץ" and "B" as "נ" when Hebrew is active).
  const code = k.code ?? "";
  if (
    ["PageDown", " ", "Enter", "ArrowDown", ...forward].includes(k.key) ||
    ["PageDown", "Space", "Enter", "NumpadEnter", "ArrowDown", "KeyN", ...forward].includes(code)
  ) {
    if (!clickerMediaStep(1)) s.next();
    return true;
  }
  if (
    ["PageUp", "Backspace", "ArrowUp", ...back].includes(k.key) ||
    ["PageUp", "Backspace", "ArrowUp", "KeyP", ...back].includes(code)
  ) {
    if (!clickerMediaStep(-1)) s.prev();
    return true;
  }
  // Clicker "blank screen" button: Logitech R400/R500/Spotlight send "." ; others send "B" or ","
  if (["Period", "NumpadDecimal", "Comma", "KeyB"].includes(code) || [".", ",", "b", "B", "ץ", "ת", "נ"].includes(k.key)) {
    s.toggleBlackout("black");
    return true;
  }
  if (k.code === "KeyW") {
    s.toggleBlackout("white");
    return true;
  }
  if (k.code === "KeyK" && slideHasMedia(s.live.slide)) {
    send<MediaCommand>(EV.mediaCmd, { type: "toggle" });
    return true;
  }
  if (k.code === "KeyM" && slideHasMedia(s.live.slide)) {
    s.setLiveMedia({ muted: !s.live.media.muted });
    return true;
  }
  if (k.code === "KeyJ" && slideHasMedia(s.live.slide)) {
    send<MediaCommand>(EV.mediaCmd, { type: "seekBy", delta: -10 });
    return true;
  }
  if (k.code === "KeyL" && slideHasMedia(s.live.slide)) {
    send<MediaCommand>(EV.mediaCmd, { type: "seekBy", delta: 10 });
    return true;
  }
  // document zoom (pages only): + / - / 0
  if (!k.shift && ["Equal", "NumpadAdd"].includes(code) && doc.zoom(1.25)) return true;
  if (!k.shift && ["Minus", "NumpadSubtract"].includes(code) && doc.zoom(1 / 1.25)) return true;
  if (!k.shift && ["Digit0", "Numpad0"].includes(code) && doc.fitPage()) return true;
  if (k.key === "Home") {
    const item = s.items.find((i) => i.id === (s.live.itemId ?? s.selectedItemId));
    if (item) s.goLive(item.id, 0);
    return true;
  }
  if (k.key === "End") {
    const item = s.items.find((i) => i.id === (s.live.itemId ?? s.selectedItemId));
    if (item) s.goLive(item.id, item.slides.length - 1);
    return true;
  }
  if (k.key === "F5") {
    if (!s.projector.open) openProjector();
    else if (!s.live.slide) s.next();
    return true;
  }
  if (k.key === "Escape" && usePresenter.getState().mode !== "none") {
    setPresenter({ mode: "none", zoomLocked: false });
    return true;
  }
  if (k.key === "Escape" && s.live.blackout !== "none") {
    s.setBlackout("none");
    return true;
  }
  return false;
}

let shortcutChain: Promise<unknown> = Promise.resolve();

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Undo / redo (by physical key, so it works with a Hebrew layout). Inside text fields
      // the browser's own text undo wins.
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !isTypingTarget(e.target) && (e.code === "KeyZ" || e.code === "KeyY")) {
        e.preventDefault();
        if (e.code === "KeyY" || e.shiftKey) redo();
        else undo();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.repeat && ["KeyB", "Period", "Comma", "NumpadDecimal"].includes(e.code)) return;
      if (useSession.getState().editor && (e.key === " " || e.key === "Enter")) return;
      // Let focused buttons keep Space/Enter semantics? No - clickers send these, nav wins.
      if (handleKey({ key: e.key, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey })) {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Optional system-wide clicker: works even when PowerPoint/a browser has focus.
  const globalClicker = useSettings((s) => s.globalClicker);
  useEffect(() => {
    if (!globalClicker) return;
    const keys: [string, KeyInfo][] = [
      ["PageDown", { key: "PageDown", code: "PageDown" }],
      ["PageUp", { key: "PageUp", code: "PageUp" }],
      ["Period", { key: ".", code: "Period" }],
      ["KeyB", { key: "b", code: "KeyB" }],
    ];
    let alive = true;
    shortcutChain = shortcutChain.then(async () => {
      await unregisterAll().catch(() => {});
      if (!alive) return;
      for (const [accel, info] of keys) {
        try {
          await register(accel, (e) => {
            if (alive && e.state === "Pressed") handleKey(info);
          });
        } catch (err) {
          toast.error(`לא ניתן לתפוס את המקש ${accel}`, { description: String(err) });
        }
      }
    });
    return () => {
      alive = false;
      shortcutChain = shortcutChain.then(() => unregisterAll().catch(() => {}));
    };
  }, [globalClicker]);

  useTauriEvent<MediaStatus>(EV.mediaStatus, trackMediaStatus);

  useTauriEvent<KeyInfo>(EV.remoteKey, (k) => {
    handleKey(k);
  });
}
