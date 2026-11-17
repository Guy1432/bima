export function parseYouTube(input: string): { id: string; start?: number } | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return { id: s };
  let url: URL;
  try {
    url = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1, 12);
  else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    id = url.searchParams.get("v");
    const m = /\/(embed|shorts|live|v)\/([\w-]{11})/.exec(url.pathname);
    if (!id && m) id = m[2];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  const t = url.searchParams.get("t") ?? url.searchParams.get("start");
  let start: number | undefined;
  if (t) {
    const mm = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
    if (mm) start = +(mm[1] ?? 0) * 3600 + +(mm[2] ?? 0) * 60 + +(mm[3] ?? 0);
  }
  return { id, start: start || undefined };
}

export async function fetchYouTubeTitle(id: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}`,
    );
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j.title === "string" ? j.title : null;
  } catch {
    return null;
  }
}

// ---- IFrame API loader ----
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<any> | null = null;
export function loadYouTubeApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => {
      apiPromise = null;
      reject(new Error("YouTube API failed to load"));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}
