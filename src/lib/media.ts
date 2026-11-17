import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

/** Bumped when files arrive from the cloud → thumbnails re-request their images. */
const useEpoch = create<{ epoch: number }>(() => ({ epoch: 0 }));
let bumpTimer: ReturnType<typeof setTimeout> | undefined;
export function bumpMediaEpoch() {
  clearTimeout(bumpTimer);
  bumpTimer = setTimeout(() => useEpoch.setState((s) => ({ epoch: s.epoch + 1 })), 800);
}
export function useMediaEpoch() {
  return useEpoch((s) => s.epoch);
}

let mediaDir = "";

export async function initMediaDir() {
  mediaDir = await invoke<string>("get_media_dir");
  return mediaDir;
}

export function mediaPath(file: string) {
  // the OS's own separator: \ on Windows, / on macOS
  return `${mediaDir}${mediaDir.includes("\\") ? "\\" : "/"}${file}`;
}

/** `fresh` (thumbnails only): cache-bust after cloud downloads. Never for the live stage -
 *  a changing src would restart a playing video. */
export function mediaUrl(file: string, fresh = false) {
  const url = convertFileSrc(mediaPath(file));
  const e = fresh ? useEpoch.getState().epoch : 0;
  return e ? `${url}?v=${e}` : url;
}

export function youtubeThumb(id: string) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export const EXT = {
  video: ["mp4", "webm", "m4v", "mov", "ogv", "mkv"],
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"],
  pdf: ["pdf"],
  presentation: ["pptx", "ppt", "ppsx", "pps", "pptm", "odp", "potx"],
  bundle: ["zip", "bima"],
};

export function extOf(path: string) {
  const m = /\.([^.\\/]+)$/.exec(path);
  return m ? m[1].toLowerCase() : "";
}

export function baseName(path: string) {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.[^.]+$/, "");
}
