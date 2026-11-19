/**
 * Watch remote bridge (Bima for Wear OS). Rust (src-tauri/src/remote.rs) keeps the Bluetooth
 * link; this file decides what the watch's commands do and what the watch is told:
 *   commands → the same paths as the keyboard / clicker, then an ack (the wrist buzzes only
 *              when the show really changed)
 *   state    → slide n/total, what's next, blackout, video, show clock, projector
 *   alerts   → time left (5 / 1 / 0 min), last slide, video ended, projector lost
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { toast } from "sonner";
import { EV } from "@/lib/events";
import { useSettings } from "@/lib/settings";
import { useShowClock } from "@/lib/showClock";
import { slideHasMedia, type MediaStatus } from "@/lib/types";
import { peekNext, useSession } from "@/store/session";
import { remoteAction } from "./useKeyboard";

export interface RemoteStatus {
  state: "off" | "searching" | "connected" | "no-bluetooth";
  name: string | null;
  battery: number | null;
  found: { id: string; name: string }[];
}

export const useRemote = create<RemoteStatus & { pairCode: string | null }>(() => ({
  state: "off",
  name: null,
  battery: null,
  found: [],
  pairCode: null,
}));

const sendRaw = (msg: object) => void invoke("remote_send", { json: JSON.stringify(msg) }).catch(() => {});
const buzz = (p: "time5" | "time1" | "timeup" | "last" | "vidend" | "projlost") => sendRaw({ t: "buzz", p });

let playing = false;
let mediaKey = "";

function nextLabel(): string {
  const s = useSession.getState();
  const n = peekNext(s);
  if (!n) return "סוף ההצגה";
  if (n.item.id !== s.live.itemId) return n.item.title;
  const c = n.slide.content;
  if (c.kind === "text" && c.text.title.trim()) return c.text.title.trim();
  return `שקופית ${n.index + 1}`;
}

function snapshot() {
  const s = useSession.getState();
  const item = s.items.find((i) => i.id === s.live.itemId);
  const clip = (t: string) => (t.length > 28 ? t.slice(0, 27) + "…" : t);
  return {
    t: "st",
    i: s.live.slide ? s.live.slideIndex + 1 : 0,
    n: s.live.slide ? (item?.slides.length ?? 0) : 0,
    it: clip(item?.title ?? ""),
    nx: clip(nextLabel()),
    bk: s.live.blackout,
    md: slideHasMedia(s.live.slide) ? 1 : 0,
    pl: playing && mediaKey === s.live.key ? 1 : 0,
    el: Math.max(0, Math.floor((Date.now() - useShowClock.getState().since) / 1000)),
    tl: Math.max(0, Math.round(useSettings.getState().talkMinutes * 60)),
    pj: s.projector.open ? 1 : 0,
  };
}

let lastSent = "";
let timer: ReturnType<typeof setTimeout> | undefined;

/** Coalesce bursts (a slide change touches several fields) into one message. */
function pushState(force = false) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const snap = snapshot();
    // the clock ticks on the watch by itself; resend only when something else changed
    const key = JSON.stringify({ ...snap, el: 0 });
    if (!force && key === lastSent) return;
    lastSent = key;
    sendRaw(snap);
  }, 80);
}

/** Time-left alerts, each once per talk (a reset of the show clock re-arms them). */
let fired = new Set<string>();
function checkTime() {
  const mins = useSettings.getState().talkMinutes;
  if (!mins || useRemote.getState().state !== "connected") return;
  const left = mins * 60 - (Date.now() - useShowClock.getState().since) / 1000;
  const once = (k: "time5" | "time1" | "timeup", at: number) => {
    if (left <= at && left > at - 30 && !fired.has(k)) {
      fired.add(k);
      buzz(k);
    }
  };
  if (mins > 5) once("time5", 300);
  if (mins > 1) once("time1", 60);
  once("timeup", 0);
}

let started = false;

export function startRemote() {
  if (started) return;
  started = true;

  // settings → Rust (on/off, which watch is ours)
  const config = () => {
    const { remoteEnabled, remoteWatch } = useSettings.getState();
    void invoke("remote_config", { enabled: remoteEnabled, paired: remoteWatch?.id ?? null }).catch(() => {});
  };
  config();
  useSettings.subscribe((s, p) => {
    if (s.remoteEnabled !== p.remoteEnabled || s.remoteWatch?.id !== p.remoteWatch?.id) config();
    if (s.talkMinutes !== p.talkMinutes) pushState(true);
  });

  void listen<RemoteStatus>("remote-status", (e) => useRemote.setState(e.payload));
  void listen<string>("remote-pair-code", (e) => useRemote.setState({ pairCode: e.payload }));
  void listen("remote-connected", () => {
    useRemote.setState({ pairCode: null });
    pushState(true);
  });
  void listen<string>("remote-lost", () => {
    if (useSettings.getState().remoteEnabled && useSettings.getState().remoteWatch) {
      toast("השעון התנתק", { id: "remote-lost", description: "בימה תתחבר אליו שוב כשיהיה בטווח." });
    }
  });

  // watch → show
  void listen<{ s: number; c: string; a?: string }>("remote-command", (e) => {
    const { s, c, a } = e.payload;
    let ok = true;
    if (c === "clock" && a === "reset") {
      useShowClock.getState().reset();
      fired = new Set();
    } else ok = remoteAction(c, a);
    sendRaw({ t: "ack", s, ok: ok ? 1 : 0, bk: useSession.getState().live.blackout });
    pushState();
  });

  // show → watch
  let prevLive = useSession.getState().live;
  useSession.subscribe((st) => {
    const live = st.live;
    if (live === prevLive) return;
    const moved = live.key !== prevLive.key;
    prevLive = live;
    pushState();
    // reached the very last slide of the run-of-show
    if (moved && live.slide && !peekNext(st)) buzz("last");
  });
  useShowClock.subscribe(() => {
    fired = new Set();
    pushState(true);
  });
  void listen<MediaStatus>(EV.mediaStatus, (e) => {
    const was = playing;
    playing = !e.payload.paused && !e.payload.ended;
    mediaKey = e.payload.key;
    if (was !== playing) pushState();
  });
  void listen(EV.mediaEnded, () => buzz("vidend"));
  void listen("projector-display-lost", () => buzz("projlost"));

  setInterval(checkTime, 5000);
  // resync now and then (the watch keeps its own clock between messages)
  setInterval(() => pushState(true), 30_000);
}

/** Pair with a watch found nearby; resolves when the presenter confirms on the wrist. */
export async function pairWatch(id: string) {
  try {
    const w = await invoke<{ id: string; name: string }>("remote_pair", { id });
    useSettings.getState().set({ remoteWatch: w });
    toast.success("השעון מחובר", { description: w.name });
  } catch (e) {
    toast.error("החיבור לא הושלם", { description: String(e) });
  } finally {
    useRemote.setState({ pairCode: null });
  }
}
