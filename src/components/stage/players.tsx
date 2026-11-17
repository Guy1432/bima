import { useEffect, useRef } from "react";
import { EV, send, useTauriEvent } from "@/lib/events";
import type { MediaCommand, MediaSettings, MediaStatus } from "@/lib/types";
import { loadYouTubeApi } from "@/lib/youtube";
import { cn } from "@/lib/utils";

/**
 * master   – the authoritative player (audience window, or the operator monitor when
 *            no projector is open). Obeys media commands, broadcasts status, has sound.
 * follower – muted mirror that chases the master's status (operator monitor).
 * outgoing – layer that is fading out: paused + muted.
 * static   – thumbnail / preview, never plays.
 */
export type PlayerRole = "master" | "follower" | "outgoing" | "static";

interface PlayerProps {
  role: PlayerRole;
  mediaKey: string;
  media: MediaSettings;
  silence?: boolean; // blackout → mute output
  className?: string;
}

const DRIFT = 0.6;

export function VideoPlayer({
  src,
  role,
  mediaKey,
  media,
  silence,
  className,
  trimStart,
  trimEnd,
}: PlayerProps & { src: string; trimStart?: number; trimEnd?: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const lastSeek = useRef(0);
  const finished = useRef(false);
  const isMaster = role === "master";

  // PowerPoint trim: play only [t0, duration - cutEnd]. All reported times are relative
  // to t0, so the operator's transport shows the trimmed length.
  const t0 = Math.max(0, trimStart ?? 0);
  const cutEnd = Math.max(0, trimEnd ?? 0);
  const trimmed = t0 > 0 || cutEnd > 0;
  const endAt = (v: HTMLVideoElement) =>
    Number.isFinite(v.duration) && v.duration > 0 ? Math.max(t0, v.duration - cutEnd) : Infinity;
  const atEnd = (v: HTMLVideoElement) => finished.current || v.ended || v.currentTime >= endAt(v) - 0.05;

  const emitStatus = () => {
    const v = ref.current;
    if (!v || !isMaster) return;
    const end = endAt(v);
    send<MediaStatus>(EV.mediaStatus, {
      key: mediaKey,
      currentTime: Math.max(0, v.currentTime - t0),
      duration: Number.isFinite(end) ? end - t0 : 0,
      paused: v.paused,
      ended: v.ended || finished.current,
    });
  };

  const playFromStartIfDone = (v: HTMLVideoElement) => {
    if (atEnd(v)) v.currentTime = t0;
    finished.current = false;
  };

  const reachedEnd = (v: HTMLVideoElement) => {
    if (media.loop) {
      v.currentTime = t0;
      v.play().catch(() => {});
      return;
    }
    v.pause();
    if (!isMaster) return;
    finished.current = true;
    emitStatus();
    send(EV.mediaEnded, { key: mediaKey });
  };

  // enforce the trim window precisely (timeupdate alone is only ~4 Hz)
  const checkTrim = () => {
    const v = ref.current;
    if (!v || !trimmed || role === "static" || v.paused || finished.current) return;
    if (v.currentTime >= endAt(v) - 0.03) reachedEnd(v);
    else if (v.currentTime < t0 - 0.25) v.currentTime = t0;
  };
  useEffect(() => {
    if (!trimmed || role === "static") return;
    let raf = 0;
    const tick = () => {
      checkTrim();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, role, t0, cutEnd, media.loop, mediaKey]);

  // autoplay once per slide; a role change (projector opened/closed) never starts playback
  const autoplayed = useRef<string | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (role === "master" && media.autoplay && autoplayed.current !== mediaKey) {
      autoplayed.current = mediaKey;
      finished.current = false;
      v.play().catch(() => {
        v.muted = true;
        v.play().catch(() => {});
      });
    }
    if (role === "outgoing" || role === "static") v.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, mediaKey]);

  // volume / loop / mute
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.loop = media.loop && !trimmed; // trimmed clips loop inside the trim window (reachedEnd)
    v.volume = Math.min(1, Math.max(0, media.volume));
    v.muted = role !== "master" || media.muted || !!silence;
  }, [media.loop, media.volume, media.muted, silence, role, trimmed]);

  // status heartbeat
  useEffect(() => {
    if (!isMaster) return;
    const t = setInterval(emitStatus, 400);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMaster, mediaKey]);

  useTauriEvent<MediaCommand>(
    EV.mediaCmd,
    (cmd) => {
      const v = ref.current;
      if (!v) return;
      switch (cmd.type) {
        case "play":
          playFromStartIfDone(v);
          v.play().catch(() => {});
          break;
        case "pause":
          v.pause();
          break;
        case "toggle":
          if (v.paused) {
            playFromStartIfDone(v);
            v.play().catch(() => {});
          } else v.pause();
          break;
        case "seek":
          finished.current = false;
          v.currentTime = Math.min(t0 + cmd.time, endAt(v));
          break;
        case "seekBy":
          finished.current = false;
          v.currentTime = Math.min(Math.max(t0, v.currentTime + cmd.delta), endAt(v));
          break;
        case "restart":
          finished.current = false;
          v.currentTime = t0;
          v.play().catch(() => {});
          break;
      }
      setTimeout(emitStatus, 30);
    },
    isMaster,
  );

  useTauriEvent<MediaStatus>(
    EV.mediaStatus,
    (s) => {
      const v = ref.current;
      if (!v || s.key !== mediaKey) return;
      // gentle chase: seek at most every 2s, never while still loading → no stutter loops
      const now = performance.now();
      const target = t0 + s.currentTime;
      if (Math.abs(v.currentTime - target) > DRIFT && now - lastSeek.current > 2000 && v.readyState >= 2) {
        lastSeek.current = now;
        v.currentTime = target + 0.15;
      }
      if (s.paused && !v.paused) v.pause();
      if (!s.paused && v.paused && v.readyState >= 3) v.play().catch(() => {});
    },
    role === "follower",
  );

  return (
    <video
      ref={ref}
      src={role === "static" ? `${src}#t=${t0 + 0.5}` : t0 > 0 ? `${src}#t=${t0}` : src}
      preload={role === "static" ? "metadata" : "auto"}
      playsInline
      disablePictureInPicture
      className={cn("h-full w-full object-contain", className)}
      onPlay={emitStatus}
      onPause={emitStatus}
      onSeeked={emitStatus}
      onLoadedMetadata={() => {
        const v = ref.current;
        if (v && role !== "static" && v.currentTime < t0) v.currentTime = t0;
        emitStatus();
      }}
      onTimeUpdate={checkTrim}
      onEnded={() => {
        const v = ref.current;
        if (trimmed && v) {
          if (!finished.current) reachedEnd(v);
          return;
        }
        emitStatus();
        if (isMaster && !media.loop) send(EV.mediaEnded, { key: mediaKey });
      }}
    />
  );
}

export function YouTubePlayer({
  videoId,
  start,
  end,
  role,
  mediaKey,
  media,
  silence,
  className,
}: PlayerProps & { videoId: string; start?: number; end?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const ready = useRef(false);
  const isMaster = role === "master";
  const roleRef = useRef(role);
  roleRef.current = role;
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const silenceRef = useRef(silence);
  silenceRef.current = silence;
  // the clip window: [t0, t1]. Reported times are relative to t0, like trimmed files.
  const t0 = Math.max(0, start ?? 0);
  const t1 = end && end > t0 ? end : 0;
  const clipEnd = (p: any) => (t1 || p.getDuration?.() || 0);
  const finished = useRef(false);

  const applyAudio = () => {
    const p = player.current;
    if (!p || !ready.current) return;
    const m = mediaRef.current;
    p.setVolume(Math.round(m.volume * 100));
    if (roleRef.current !== "master" || m.muted || silenceRef.current) p.mute();
    else p.unMute();
  };

  const emitStatus = () => {
    const p = player.current;
    if (!p || !ready.current || roleRef.current !== "master") return;
    const state = p.getPlayerState?.();
    const endAt = clipEnd(p);
    send<MediaStatus>(EV.mediaStatus, {
      key: mediaKey,
      currentTime: Math.max(0, (p.getCurrentTime?.() ?? 0) - t0),
      duration: Math.max(0, endAt - t0),
      paused: state !== 1 && state !== 3,
      ended: state === 0 || finished.current,
    });
  };

  const reachedEnd = () => {
    const p = player.current;
    if (!p) return;
    if (mediaRef.current.loop) {
      p.seekTo(t0, true);
      p.playVideo();
      return;
    }
    p.pauseVideo();
    if (finished.current) return;
    finished.current = true;
    emitStatus();
    send(EV.mediaEnded, { key: mediaKey });
  };

  const playFromStartIfDone = () => {
    const p = player.current;
    if (!p) return;
    if (finished.current || p.getPlayerState() === 0 || (t1 && p.getCurrentTime() >= t1 - 0.2)) p.seekTo(t0, true);
    finished.current = false;
  };

  useEffect(() => {
    let destroyed = false;
    const mount = document.createElement("div");
    host.current?.appendChild(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (destroyed) return;
        player.current = new YT.Player(mount, {
          videoId,
          width: "100%",
          height: "100%",
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            controls: 0,
            modestbranding: 1,
            rel: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            playsinline: 1,
            cc_load_policy: 0,
            start: Math.floor(t0),
            ...(t1 ? { end: Math.ceil(t1) } : {}),
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              ready.current = true;
              applyAudio();
              if (t0 % 1) player.current.seekTo(t0, true); // the start player var is whole seconds only
              if (roleRef.current === "master" && mediaRef.current.autoplay) player.current.playVideo();
              if (roleRef.current === "follower") player.current.playVideo();
            },
            onStateChange: (e: any) => {
              emitStatus();
              if (e.data === 0 && roleRef.current === "master") reachedEnd();
            },
          },
        });
      })
      .catch(() => {});
    return () => {
      destroyed = true;
      try {
        player.current?.destroy();
      } catch {
        /* ignore */
      }
      player.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, mediaKey]);

  useEffect(() => {
    applyAudio();
    if ((role === "outgoing" || role === "static") && ready.current) player.current?.pauseVideo?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, media.volume, media.muted, silence]);

  useEffect(() => {
    if (!isMaster) return;
    const t = setInterval(emitStatus, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMaster, mediaKey]);

  // enforce the clip end precisely: the `end` player var only applies to the first play,
  // not after a seek / loop / restart
  useEffect(() => {
    if (!t1 || role !== "master") return;
    const t = setInterval(() => {
      const p = player.current;
      if (!p || !ready.current || finished.current || p.getPlayerState?.() !== 1) return;
      if (p.getCurrentTime() >= t1 - 0.15) reachedEnd();
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t1, role, mediaKey]);

  useTauriEvent<MediaCommand>(
    EV.mediaCmd,
    (cmd) => {
      const p = player.current;
      if (!p || !ready.current) return;
      const playing = p.getPlayerState() === 1;
      const endAt = clipEnd(p);
      switch (cmd.type) {
        case "play":
          playFromStartIfDone();
          p.playVideo();
          break;
        case "pause":
          p.pauseVideo();
          break;
        case "toggle":
          if (playing) p.pauseVideo();
          else {
            playFromStartIfDone();
            p.playVideo();
          }
          break;
        case "seek":
          finished.current = false;
          p.seekTo(Math.min(t0 + cmd.time, endAt || Infinity), true);
          break;
        case "seekBy":
          finished.current = false;
          p.seekTo(Math.min(Math.max(t0, p.getCurrentTime() + cmd.delta), endAt || Infinity), true);
          break;
        case "restart":
          finished.current = false;
          p.seekTo(t0, true);
          p.playVideo();
          break;
      }
      setTimeout(emitStatus, 60);
    },
    isMaster,
  );

  useTauriEvent<MediaStatus>(
    EV.mediaStatus,
    (s) => {
      const p = player.current;
      if (!p || !ready.current || s.key !== mediaKey) return;
      if (Math.abs(p.getCurrentTime() - (t0 + s.currentTime)) > 1.2) p.seekTo(t0 + s.currentTime, true);
      const playing = p.getPlayerState() === 1;
      if (s.paused && playing) p.pauseVideo();
      if (!s.paused && !playing) p.playVideo();
    },
    role === "follower",
  );

  return (
    <div className={cn("relative h-full w-full bg-black", className)}>
      <div ref={host} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
      {/* shield: blocks hover UI / clicks so YouTube chrome never appears on the projector */}
      <div className="absolute inset-0" />
    </div>
  );
}
