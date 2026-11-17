import { useEffect, useRef, useState } from "react";
import { EV, useTauriEvent } from "@/lib/events";
import type { MediaStatus } from "@/lib/types";
import { formatTime } from "@/lib/utils";
import { Film, Youtube } from "lucide-react";
import type { LiveState, MediaSettings, Slide } from "@/lib/types";
import { DEFAULT_MEDIA } from "@/lib/types";
import { mediaUrl, useMediaEpoch, youtubeThumb } from "@/lib/media";
import { cn } from "@/lib/utils";
import { FitBox } from "./FitBox";
import { OverlayView, TextSlideView } from "./TextSlideView";
import { VideoPlayer, YouTubePlayer, type PlayerRole } from "./players";
import { PresenterLayer, usePresenterFeed, zoomStyle } from "./PresenterLayer";
import { viewStyle } from "@/lib/docview";
import { Effects } from "./Effects";

interface SlideViewProps {
  slide: Slide;
  role: PlayerRole;
  mediaKey: string;
  media: MediaSettings;
  startedAt?: number;
  silence?: boolean;
}

/** Renders one slide at full fidelity (audience / monitor / editor preview). */
export function SlideView({ slide, role, mediaKey, media, startedAt, silence }: SlideViewProps) {
  const c = slide.content;
  const playing = role === "master" || role === "follower";

  switch (c.kind) {
    case "text":
      return (
        <FitBox aspect={16 / 9} className="bg-black">
          {(w) => <TextSlideView data={c.text} width={w} startedAt={startedAt} running={playing} />}
        </FitBox>
      );
    case "video":
      return (
        <div className="absolute inset-0 bg-black">
          <VideoPlayer
            src={mediaUrl(c.file)}
            role={role}
            mediaKey={mediaKey}
            media={media}
            silence={silence}
            trimStart={c.trimStart}
            trimEnd={c.trimEnd}
          />
        </div>
      );
    case "youtube":
      // Only ONE real YouTube player at a time: the operator monitor mirrors the
      // projector with a lightweight status card instead of a second iframe.
      if (role === "follower") return <YouTubeMirror videoId={c.videoId} mediaKey={mediaKey} />;
      return playing ? (
        <div className="absolute inset-0 bg-black">
          <YouTubePlayer
            videoId={c.videoId}
            start={c.start}
            end={c.end}
            role={role}
            mediaKey={mediaKey}
            media={media}
            silence={silence}
          />
        </div>
      ) : (
        <img src={youtubeThumb(c.videoId)} className="absolute inset-0 h-full w-full bg-black object-contain" alt="" />
      );
    case "image": {
      if (!c.aspect || (!c.videos?.length && !c.overlay?.length))
        return (
          <img
            src={mediaUrl(c.file)}
            className="absolute inset-0 h-full w-full bg-black object-contain"
            decoding="async"
            draggable={false}
            alt=""
          />
        );
      return (
        <FitBox aspect={c.aspect} className="bg-black">
          {(w) => (
            <>
              <img src={mediaUrl(c.file)} className="absolute inset-0 h-full w-full" draggable={false} alt="" />
              {c.videos?.map((v, i) => (
                <div
                  key={i}
                  className="absolute bg-black"
                  style={{ left: `${v.x * 100}%`, top: `${v.y * 100}%`, width: `${v.w * 100}%`, height: `${v.h * 100}%` }}
                >
                  <VideoPlayer
                    src={mediaUrl(v.file)}
                    role={i === 0 ? role : "static"}
                    mediaKey={mediaKey}
                    media={media}
                    silence={silence}
                    trimStart={v.trimStart}
                    trimEnd={v.trimEnd}
                    className="object-fill"
                  />
                </div>
              ))}
              {!!c.overlay?.length && <OverlayView blocks={c.overlay} width={w} aspect={c.aspect!} />}
            </>
          )}
        </FitBox>
      );
    }
  }
}

function YouTubeMirror({ videoId, mediaKey }: { videoId: string; mediaKey: string }) {
  const [st, setSt] = useState<MediaStatus | null>(null);
  useTauriEvent<MediaStatus>(EV.mediaStatus, (s) => s.key === mediaKey && setSt(s));
  const pct = st && st.duration ? (st.currentTime / st.duration) * 100 : 0;
  return (
    <div className="absolute inset-0 bg-black">
      <img src={youtubeThumb(videoId)} className="absolute inset-0 h-full w-full object-cover opacity-70" alt="" />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/90 to-transparent px-[3cqw] pt-[6cqw] pb-[2cqw]">
        <div className="flex items-center justify-between text-[3.6cqw] font-medium text-white tabular" dir="ltr">
          <span>{st ? formatTime(st.currentTime) : "--:--"}</span>
          <span className="flex items-center gap-[1cqw]">
            <span className={cn("size-[1.6cqw] rounded-full", st && !st.paused ? "bg-red-500 live-pulse" : "bg-zinc-500")} />
            {st && !st.paused ? "מתנגן במקרן" : "מושהה"}
          </span>
          <span>{st ? formatTime(st.duration) : "--:--"}</span>
        </div>
        <div className="h-[0.8cqw] overflow-hidden rounded-full bg-white/20">
          <div className="h-full bg-white transition-[width] duration-500 ease-linear" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

/** Lightweight tile used in grids (never plays). */
export function SlideThumb({ slide }: { slide: Slide }) {
  useMediaEpoch(); // re-render when media arrives from the cloud
  const c = slide.content;
  switch (c.kind) {
    case "image":
      return (
        <>
          {c.overlay?.length && c.aspect ? (
            <FitBox aspect={c.aspect}>
              {(w) => (
                <>
                  <img src={mediaUrl(c.thumb ?? c.file, true)} decoding="async" draggable={false} className="absolute inset-0 h-full w-full" alt="" />
                  <OverlayView blocks={c.overlay!} width={w} aspect={c.aspect!} />
                </>
              )}
            </FitBox>
          ) : (
            <img
              src={mediaUrl(c.thumb ?? c.file, true)}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain"
              alt=""
            />
          )}
          {!!c.videos?.length && (
            <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white">
              <Film className="size-3" /> {c.videos.length}
            </span>
          )}
        </>
      );
    case "video":
      return (
        <>
          <VideoPlayer src={mediaUrl(c.file)} role="static" mediaKey="" media={DEFAULT_MEDIA} trimStart={c.trimStart} />
          <Film className="absolute bottom-1.5 left-1.5 size-4 text-white/80 drop-shadow" />
        </>
      );
    case "youtube":
      return (
        <>
          <img src={youtubeThumb(c.videoId)} className="absolute inset-0 h-full w-full object-cover" alt="" />
          <Youtube className="absolute bottom-1.5 left-1.5 size-4 text-white/90 drop-shadow" />
        </>
      );
    case "text":
      return <FitBox aspect={16 / 9}>{(w) => <TextSlideView data={c.text} width={w} />}</FitBox>;
  }
}

function Standby({ title, showClock }: { title: string; showClock: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div dir="rtl" className="stage-fade absolute inset-0 flex flex-col items-center justify-center gap-[1.5cqw] bg-[#070708] text-white">
      {showClock && (
        <div className="text-[9cqw] leading-none font-extralight tabular opacity-90">
          {now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
      {title && <div className="text-[2.6cqw] font-medium tracking-wide opacity-60">{title}</div>}
      <div className="absolute bottom-[4cqw] h-[0.25cqw] w-[6cqw] rounded-full bg-white/15" />
    </div>
  );
}

interface Layer {
  key: string;
  slide: Slide | null;
  startedAsMaster: boolean;
}

/**
 * The audience stage: current slide with cross-fade, blackout and message overlay.
 * Shared by the projector window (role=master) and the operator's live monitor.
 */
export function Stage({
  live,
  role,
  className,
  showOverlays = true,
}: {
  live: LiveState;
  role: "master" | "follower";
  className?: string;
  showOverlays?: boolean;
}) {
  const [layers, setLayers] = useState<Layer[]>([{ key: live.key, slide: live.slide, startedAsMaster: role === "master" }]);

  useEffect(() => {
    setLayers((prev) => {
      if (prev[prev.length - 1]?.key === live.key) return prev;
      const next = { key: live.key, slide: live.slide, startedAsMaster: role === "master" };
      return live.transition === "fade" ? [...prev.slice(-1), next] : [next];
    });
    if (live.transition !== "fade") return;
    const t = setTimeout(() => setLayers((prev) => prev.filter((l) => l.key === live.key)), live.fadeMs + 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.key]);

  const silence = live.blackout !== "none";
  // The cover keeps the colour it was shown in while it fades OUT — otherwise releasing a
  // white screen would flip it to black for the length of the fade (a visible black flash).
  const coverRef = useRef<"black" | "white">("black");
  if (live.blackout !== "none") coverRef.current = live.blackout;
  const cover = coverRef.current;
  const media = live.media ?? DEFAULT_MEDIA;
  const presenter = usePresenterFeed();

  return (
    <div
      className={cn("@container absolute inset-0 overflow-hidden bg-black", className)}
      style={{ ["--fade-ms" as string]: `${live.fadeMs}ms` }}
    >
      <div className="absolute inset-0" style={zoomStyle(presenter)}>
      <div className="absolute inset-0" style={viewStyle(live.view)}>
      {layers.map((l, i) => {
        const current = i === layers.length - 1;
        return (
          <div key={l.key} className={cn("absolute inset-0", current && layers.length > 1 && "stage-fade")}>
            {l.slide && (
              <SlideView
                slide={l.slide}
                role={current ? role : "outgoing"}
                mediaKey={l.key}
                media={l.startedAsMaster ? media : { ...media, autoplay: false }}
                startedAt={live.startedAt}
                silence={silence}
              />
            )}
          </div>
        );
      })}
      </div>
      </div>

      {!live.slide && live.standby && <Standby title={live.standby.title} showClock={live.standby.showClock} />}

      <PresenterLayer p={presenter} />
      <Effects master={role === "master"} />

      {showOverlays && live.message && (
        <div className="absolute inset-x-0 bottom-[5cqh] flex justify-center px-[5cqw]">
          <div
            dir="rtl"
            className="max-w-full rounded-[0.6cqw] bg-black/85 px-[2.4cqw] py-[1cqw] text-center text-[2.6cqw] leading-snug font-medium text-white shadow-2xl ring-1 ring-white/10"
          >
            {live.message}
          </div>
        </div>
      )}

      <div
        className={cn(
          "pointer-events-none absolute inset-0 transition-[opacity,background-color] duration-300",
          cover === "white" ? "bg-white" : "bg-black",
          silence ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
