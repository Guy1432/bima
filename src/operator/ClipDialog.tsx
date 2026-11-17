import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { toast } from "sonner";
import { Pause, Play, Scissors, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Input, Keys, Label, Tip } from "@/components/ui/primitives";
import { baseName, EXT, mediaUrl, youtubeThumb } from "@/lib/media";
import { DEFAULT_MEDIA, type Slide } from "@/lib/types";
import { cn, uid } from "@/lib/utils";
import { fetchYouTubeTitle, loadYouTubeApi, parseYouTube } from "@/lib/youtube";
import { useSession } from "@/store/session";
import { undo } from "@/store/history";

/* ------------------------------------------------------------------ state */

/** Where the clip goes: a slide to replace, a place in an item, or (nothing) a new item. */
interface ClipTarget {
  itemId?: string;
  afterIndex?: number;
  slideId?: string;
}

type ClipInit =
  | { kind: "youtube"; videoId?: string; start?: number; end?: number }
  | { kind: "video"; file: string; title: string; trimStart?: number; trimEnd?: number };

const useClip = create<{ open: boolean; init: ClipInit | null; target: ClipTarget }>(() => ({
  open: false,
  init: null,
  target: {},
}));

export function openYouTubeClip(target: ClipTarget = {}) {
  useClip.setState({ open: true, init: { kind: "youtube" }, target });
}

/** Choose a video file, copy it into the library, then open the trimmer. */
export async function openVideoClip(target: ClipTarget = {}) {
  const sel = await openFile({ multiple: false, title: "בחירת סרטון", filters: [{ name: "וידאו", extensions: EXT.video }] });
  if (!sel || Array.isArray(sel)) return;
  const id = toast.loading("מעתיק וידאו…");
  try {
    const file = await invoke<string>("import_file", { path: sel });
    toast.dismiss(id);
    useClip.setState({ open: true, init: { kind: "video", file, title: baseName(sel) }, target });
  } catch (e) {
    toast.error("ההעתקה נכשלה", { id, description: String(e) });
  }
}

/** Re-open the trimmer for a video / YouTube slide that is already in the project. */
export function editClip(itemId: string, slide: Slide) {
  const c = slide.content;
  if (c.kind === "video")
    useClip.setState({ open: true, init: { kind: "video", file: c.file, title: "", trimStart: c.trimStart, trimEnd: c.trimEnd }, target: { itemId, slideId: slide.id } });
  else if (c.kind === "youtube")
    useClip.setState({ open: true, init: { kind: "youtube", videoId: c.videoId, start: c.start, end: c.end }, target: { itemId, slideId: slide.id } });
}

export function isClip(slide: Slide) {
  return slide.content.kind === "video" || slide.content.kind === "youtube";
}

/* ------------------------------------------------------------ time utils */

/** 83.4 → "1:23.4" */
export function fmtClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const tenths = Math.round(sec * 10) / 10;
  const h = Math.floor(tenths / 3600);
  const m = Math.floor((tenths % 3600) / 60);
  const s = tenths % 60;
  const ss = s.toFixed(1).padStart(4, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "1:23.4" | "83.4" | "1:02:03" → seconds (null if unreadable) */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(":");
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
}

/* --------------------------------------------------------- preview players */

interface Preview {
  play(): void;
  pause(): void;
  seek(t: number): void;
  time(): number;
  playing(): boolean;
}

function useFilePreview(file: string | null, onDuration: (d: number) => void) {
  const ref = useRef<HTMLVideoElement>(null);
  const api: Preview = {
    play: () => void ref.current?.play().catch(() => {}),
    pause: () => ref.current?.pause(),
    seek: (t) => {
      if (ref.current) ref.current.currentTime = t;
    },
    time: () => ref.current?.currentTime ?? 0,
    playing: () => !!ref.current && !ref.current.paused,
  };
  const el = file ? (
    <video
      ref={ref}
      src={mediaUrl(file)}
      preload="auto"
      playsInline
      disablePictureInPicture
      className="absolute inset-0 h-full w-full object-contain"
      onLoadedMetadata={(e) => onDuration(e.currentTarget.duration)}
    />
  ) : null;
  return [el, api] as const;
}

function useYouTubePreview(videoId: string | null, onDuration: (d: number) => void) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!videoId || !host.current) return;
    let destroyed = false;
    setFailed(false);
    const mount = document.createElement("div");
    host.current.appendChild(mount);
    let poll: ReturnType<typeof setInterval> | undefined;
    loadYouTubeApi()
      .then((YT) => {
        if (destroyed) return;
        player.current = new YT.Player(mount, {
          videoId,
          width: "100%",
          height: "100%",
          host: "https://www.youtube-nocookie.com",
          playerVars: { controls: 0, modestbranding: 1, rel: 0, disablekb: 1, fs: 0, iv_load_policy: 3, playsinline: 1, origin: window.location.origin },
          events: {
            onReady: () => {
              // duration can read 0 until the metadata arrives
              poll = setInterval(() => {
                const d = player.current?.getDuration?.() ?? 0;
                if (d > 0) {
                  clearInterval(poll);
                  onDuration(d);
                }
              }, 200);
            },
            onError: () => setFailed(true),
          },
        });
      })
      .catch(() => setFailed(true));
    return () => {
      destroyed = true;
      clearInterval(poll);
      try {
        player.current?.destroy();
      } catch {
        /* ignore */
      }
      player.current = null;
      mount.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);
  const p = () => player.current;
  const api: Preview = {
    play: () => p()?.playVideo?.(),
    pause: () => p()?.pauseVideo?.(),
    seek: (t) => p()?.seekTo?.(t, true),
    time: () => p()?.getCurrentTime?.() ?? 0,
    playing: () => p()?.getPlayerState?.() === 1,
  };
  const el = (
    <>
      <div ref={host} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
      {/* clicks go to our transport, never to YouTube's own UI */}
      <div className="absolute inset-0" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-black text-[13px] text-muted-foreground">
          הסרטון לא נטען. ייתכן שאין חיבור, או שההטמעה שלו חסומה.
        </div>
      )}
    </>
  );
  return [el, api] as const;
}

/* --------------------------------------------------------------- trim bar */

function TrimBar({
  duration,
  range,
  now,
  onRange,
  onSeek,
}: {
  duration: number;
  range: [number, number];
  now: number;
  onRange: (r: [number, number], moved: 0 | 1) => void;
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = (t: number) => `${(duration ? t / duration : 0) * 100}%`;
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  };
  const MIN = Math.min(0.5, duration / 4);

  const drag = (which: 0 | 1) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const t = at(ev.clientX);
      onRange(which === 0 ? [Math.min(t, range[1] - MIN), range[1]] : [range[0], Math.max(t, range[0] + MIN)], which);
    };
    const target = e.currentTarget as HTMLElement;
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const handle = (which: 0 | 1) => (
    <button
      type="button"
      aria-label={which === 0 ? "תחילת הקטע" : "סוף הקטע"}
      onPointerDown={drag(which)}
      onKeyDown={(e) => {
        const d = e.key === "ArrowLeft" ? -0.1 : e.key === "ArrowRight" ? 0.1 : 0;
        if (!d) return;
        e.preventDefault();
        const step = e.shiftKey ? d * 10 : d;
        onRange(which === 0 ? [Math.max(0, Math.min(range[0] + step, range[1] - MIN)), range[1]] : [range[0], Math.min(duration, Math.max(range[1] + step, range[0] + MIN))], which);
      }}
      className="absolute top-1/2 z-10 flex h-9 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-[4px] bg-primary shadow-[0_0_0_1px_rgb(0_0_0/0.4)] outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      style={{ left: pct(range[which]) }}
    >
      <span className="h-3.5 w-px bg-white/80" />
    </button>
  );

  return (
    <div
      ref={ref}
      dir="ltr"
      className="relative h-9 cursor-pointer touch-none select-none"
      onPointerDown={(e) => duration && onSeek(at(e.clientX))}
    >
      {/* full length */}
      <div className="absolute inset-x-0 top-1/2 h-7 -translate-y-1/2 rounded-md bg-raised ring-1 ring-border" />
      {/* the kept part */}
      <div
        className="absolute top-1/2 h-7 -translate-y-1/2 rounded-[3px] bg-primary/25 ring-1 ring-primary/70"
        style={{ left: pct(range[0]), width: `calc(${pct(range[1])} - ${pct(range[0])})` }}
      />
      {/* playhead */}
      <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 rounded-full bg-white" style={{ left: pct(now) }} />
      {duration > 0 && handle(0)}
      {duration > 0 && handle(1)}
    </div>
  );
}

function ClockField({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(fmtClock(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmtClock(value));
  }, [value, focused]);
  const commit = () => {
    const v = parseClock(text);
    if (v !== null) onChange(Math.min(max, Math.max(0, v)));
    else setText(fmtClock(value));
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input
        dir="ltr"
        value={text}
        spellCheck={false}
        className="h-8 w-24 text-center tabular"
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

/* ----------------------------------------------------------------- dialog */

export function ClipDialog() {
  const { open, init, target } = useClip();
  const setOpen = (o: boolean) => useClip.setState({ open: o });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {init && (
        <DialogContent
          title={
            target.slideId ? "חיתוך" : init.kind === "youtube" ? "סרטון YouTube" : "סרטון מקובץ"
          }
          description={init.kind === "youtube" && !target.slideId ? "דורש חיבור לאינטרנט בזמן ההקרנה." : undefined}
          className="max-w-2xl"
          onOpenAutoFocus={(e) => init.kind === "video" && e.preventDefault()}
        >
          <ClipEditor key={JSON.stringify(init) + (target.slideId ?? "")} init={init} target={target} onDone={() => setOpen(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ClipEditor({ init, target, onDone }: { init: ClipInit; target: ClipTarget; onDone: () => void }) {
  const isYT = init.kind === "youtube";
  const [url, setUrl] = useState(isYT && init.videoId ? `https://youtu.be/${init.videoId}` : "");
  const parsed = isYT ? parseYouTube(url) : null;
  const videoId = parsed?.id ?? null;
  const [title, setTitle] = useState(init.kind === "video" ? init.title : "");
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  // initial window once the length is known
  const onDuration = (d: number) => {
    if (!Number.isFinite(d) || d <= 0) return;
    setDuration(d);
    let a = 0;
    let b = d;
    if (init.kind === "video") {
      a = init.trimStart ?? 0;
      b = d - (init.trimEnd ?? 0);
    } else if (init.videoId && init.videoId === videoId) {
      a = init.start ?? 0;
      b = init.end ?? d;
    } else if (parsed?.start) a = parsed.start;
    a = Math.min(Math.max(0, a), d);
    b = Math.min(Math.max(a + 0.1, b), d);
    setRange([a, b]);
    setNow(a);
    preview.seek(a);
  };

  const [fileEl, fileApi] = useFilePreview(init.kind === "video" ? init.file : null, onDuration);
  const [ytEl, ytApi] = useYouTubePreview(isYT ? videoId : null, onDuration);
  const preview = isYT ? ytApi : fileApi;

  // new link → forget the old length
  useEffect(() => {
    if (!isYT) return;
    setDuration(0);
    setPlaying(false);
    setNow(0);
  }, [videoId, isYT]);

  // the list name for a new YouTube item
  useEffect(() => {
    if (!isYT || !videoId || target.itemId) return;
    let alive = true;
    fetchYouTubeTitle(videoId).then((t) => alive && t && setTitle((cur) => cur || t));
    return () => {
      alive = false;
    };
  }, [videoId, isYT, target.itemId]);

  // playhead + stop at the out-point
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = preview.time();
      const p = preview.playing();
      setNow(t);
      setPlaying(p);
      if (p && t >= rangeRef.current[1] - 0.04) {
        preview.pause();
        preview.seek(rangeRef.current[1]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYT, videoId]);

  const toggle = () => {
    if (!duration) return;
    if (preview.playing()) return preview.pause();
    const t = preview.time();
    if (t < range[0] - 0.05 || t >= range[1] - 0.1) preview.seek(range[0]);
    preview.play();
  };

  const setIn = (t: number) => setRange(([, b]) => [Math.min(t, b - 0.1), b]);
  const setOut = (t: number) => setRange(([a]) => [a, Math.max(t, a + 0.1)]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") {
      e.preventDefault();
      toggle();
    } else if (k === "i") {
      e.preventDefault();
      setIn(preview.time());
    } else if (k === "o") {
      e.preventDefault();
      setOut(preview.time());
    }
  };

  const ready = duration > 0 && (!isYT || !!videoId);
  const trimmed = ready && (range[0] > 0.05 || range[1] < duration - 0.05);

  const save = () => {
    if (!ready) return;
    const [a, b] = range;
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const content: Slide["content"] = isYT
      ? { kind: "youtube", videoId: videoId!, start: a > 0.05 ? r1(a) : undefined, end: b < duration - 0.3 ? r1(b) : undefined }
      : {
          kind: "video",
          file: (init as Extract<ClipInit, { kind: "video" }>).file,
          trimStart: a > 0.05 ? r1(a) : undefined,
          trimEnd: duration - b > 0.05 ? r1(duration - b) : undefined,
        };
    const s = useSession.getState();
    if (target.itemId && target.slideId) {
      s.setSlideContent(target.itemId, target.slideId, content);
      toast.success("נשמר");
    } else if (target.itemId) {
      s.insertSlides(target.itemId, [{ id: uid(), content }], target.afterIndex);
      toast.success("הסרטון נוסף", { action: { label: "ביטול", onClick: () => undo() } });
    } else {
      s.addItems([
        {
          id: uid(),
          type: isYT ? "youtube" : "video",
          title: title.trim() || (isYT ? "סרטון YouTube" : "סרטון"),
          slides: [{ id: uid(), content }],
          media: { ...DEFAULT_MEDIA },
        },
      ]);
    }
    onDone();
  };

  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      onKeyDown={onKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {isYT && !target.slideId && (
        <div className="flex flex-col gap-1.5">
          <Label>קישור</Label>
          <Input
            autoFocus
            dir="ltr"
            spellCheck={false}
            className="text-right"
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          {url && !parsed && <p className="text-xs text-red-400">קישור לא תקין</p>}
        </div>
      )}

      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black ring-1 ring-border">
        {isYT ? (
          videoId ? (
            <>
              {!duration && <img src={youtubeThumb(videoId)} className="absolute inset-0 h-full w-full object-cover opacity-40" alt="" />}
              {ytEl}
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-faint">
              <Youtube className="size-7" />
              <span className="text-[13px]">הדבק קישור</span>
            </div>
          )
        ) : (
          fileEl
        )}
        {(isYT ? !!videoId : true) && !duration && (
          <div className="absolute inset-x-0 bottom-3 text-center text-[12px] text-white/70">טוען…</div>
        )}
      </div>

      {/* transport + trim */}
      <div className={cn("flex flex-col gap-3", !ready && "pointer-events-none opacity-40")}>
        <div className="flex items-center gap-2">
          <Button type="button" size="icon" variant="secondary" onClick={toggle} aria-label={playing ? "השהיה" : "ניגון"}>
            {playing ? <Pause /> : <Play />}
          </Button>
          <div className="min-w-0 flex-1">
            <TrimBar
              duration={duration}
              range={range}
              now={now}
              onSeek={(t) => preview.seek(t)}
              onRange={(r, moved) => {
                setRange(r);
                if (!preview.playing()) preview.seek(r[moved]); // show the frame at the cut
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <ClockField label="התחלה" value={range[0]} max={duration} onChange={(v) => setIn(v)} />
          <Tip content={<span className="flex items-center gap-1.5">מהמיקום הנוכחי <Keys combo={["I"]} /></span>}>
            <Button type="button" size="sm" variant="ghost" onClick={() => setIn(preview.time())}>
              סמן התחלה
            </Button>
          </Tip>
          <div className="flex-1" />
          <Tip content={<span className="flex items-center gap-1.5">במיקום הנוכחי <Keys combo={["O"]} /></span>}>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOut(preview.time())}>
              סמן סיום
            </Button>
          </Tip>
          <ClockField label="סיום" value={range[1]} max={duration} onChange={(v) => setOut(v)} />
        </div>

        <div className="flex items-center justify-between text-[12px] text-muted-foreground">
          <span>
            אורך <span className="text-foreground tabular" dir="ltr">{fmtClock(range[1] - range[0])}</span>
            {trimmed && (
              <span className="text-faint">
                {" "}
                מתוך <span dir="ltr" className="tabular">{fmtClock(duration)}</span>
              </span>
            )}
          </span>
          {trimmed && (
            <button type="button" className="text-faint hover:text-foreground" onClick={() => setRange([0, duration])}>
              איפוס
            </button>
          )}
        </div>
      </div>

      {!target.itemId && (isYT ? !!videoId : true) && (
        <div className="flex flex-col gap-1.5">
          <Label>שם</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isYT ? "סרטון YouTube" : "סרטון"} />
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-faint sm:flex">
          <Keys combo={["Space"]} /> ניגון · <Keys combo={["I"]} /> <Keys combo={["O"]} /> התחלה / סיום
        </span>
        <Button type="button" variant="ghost" onClick={onDone}>
          ביטול
        </Button>
        <Button type="submit" disabled={!ready}>
          <Scissors /> {target.slideId ? "שמירה" : "הוספה"}
        </Button>
      </div>
    </form>
  );
}
