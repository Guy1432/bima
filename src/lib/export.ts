/**
 * Export a project (or one run-of-show item) to PDF or PowerPoint.
 *
 * Every slide is rendered exactly as the audience sees it (designed slides and annotations go
 * through the same React components as the stage), then:
 *   PDF   – one page per slide, in the slide's own proportions. Videos become their first
 *           frame with a play mark; YouTube pages link to the video.
 *   PPTX  – one 16:9 slide per slide. Video files are embedded (with their trim, which
 *           PowerPoint honours); YouTube clips are embedded as online videos.
 */
import { createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { toCanvas } from "html-to-image";
import { jsPDF } from "jspdf";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { OverlayView, TextSlideView } from "@/components/stage/TextSlideView";
import { mediaPath, mediaUrl, youtubeThumb } from "./media";
import type { Item, Slide, VideoOverlay } from "./types";

export type ExportFormat = "pdf" | "pptx";

export interface ExportOptions {
  format: ExportFormat;
  items: Item[];
  includeHidden: boolean;
  onProgress: (done: number, total: number) => void;
  isCancelled: () => boolean;
}

/** Embedding a video bigger than this would balloon memory (base64 inside a zip). */
const MAX_EMBED_BYTES = 150 * 1024 * 1024;
const PAGE_W = 1920;

class Cancelled extends Error {}

/** A rendered slide, plus what it needs beyond the picture. */
interface Page {
  canvas: HTMLCanvasElement;
  aspect: number;
  link?: string;
  video?: { file: string; trimStart?: number; trimEnd?: number };
  youtube?: { id: string; start?: number; end?: number };
}

/* ------------------------------------------------------------- loading */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // the asset protocol sends CORS headers → canvas stays readable
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${src}`));
    img.src = src;
  });
}

/** One frame of a video file, at `t` seconds. */
function videoFrame(file: string, t: number): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    const done = (c: HTMLCanvasElement | null) => {
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      resolve(c);
    };
    const timer = setTimeout(() => done(null), 15000);
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.1));
    };
    v.onseeked = () => {
      const c = document.createElement("canvas");
      c.width = v.videoWidth || 1280;
      c.height = v.videoHeight || 720;
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      done(c);
    };
    v.onerror = () => done(null);
    v.src = mediaUrl(file);
  });
}

function blankCanvas(w: number, h: number, color = "#000") {
  const c = document.createElement("canvas");
  c.width = Math.round(w);
  c.height = Math.round(h);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

function drawContain(ctx: CanvasRenderingContext2D, src: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const k = Math.min(w / src.width, h / src.height);
  const dw = src.width * k;
  const dh = src.height * k;
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** The universal "this is a video" mark, centred in a box. */
function drawPlayMark(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = Math.max(18, Math.min(w, h) * 0.09);
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.32, cy - r * 0.45);
  ctx.lineTo(cx + r * 0.5, cy);
  ctx.lineTo(cx - r * 0.32, cy + r * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Render React offscreen at a fixed size and rasterise it (fonts and images embedded). */
async function renderReact(el: ReactElement, w: number, h: number): Promise<HTMLCanvasElement> {
  const host = document.createElement("div");
  // off-screen by a transform: the snapshot copies computed styles, and resets just this one
  host.style.cssText = `position:fixed;left:0;top:0;transform:translateX(-${w + 4000}px);width:${w}px;height:${h}px;overflow:hidden;background:#000;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(el));
    // let effects settle (QR codes are generated asynchronously), then fonts and images
    await new Promise((r) => setTimeout(r, 80));
    await document.fonts.ready;
    await Promise.all(
      [...host.querySelectorAll("img")].map((img) =>
        img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r))),
      ),
    );
    return await toCanvas(host, {
      width: w,
      height: h,
      pixelRatio: 1,
      backgroundColor: "#000000",
      style: { transform: "none" },
    });
  } finally {
    root.unmount();
    host.remove();
  }
}

/* ------------------------------------------------------------- slides */

async function renderVideoAreas(ctx: CanvasRenderingContext2D, videos: VideoOverlay[], w: number, h: number) {
  for (const v of videos) {
    const box = [v.x * w, v.y * h, v.w * w, v.h * h] as const;
    const frame = await videoFrame(v.file, (v.trimStart ?? 0) + 0.3);
    ctx.fillStyle = "#000";
    ctx.fillRect(...box);
    if (frame) ctx.drawImage(frame, ...box);
    drawPlayMark(ctx, ...box);
  }
}

export async function renderSlide(slide: Slide): Promise<Page> {
  const c = slide.content;
  switch (c.kind) {
    case "text": {
      const h = (PAGE_W * 9) / 16;
      const canvas = await renderReact(createElement(TextSlideView, { data: c.text, width: PAGE_W }), PAGE_W, h);
      return { canvas, aspect: 16 / 9 };
    }
    case "image": {
      const img = await loadImage(mediaUrl(c.file));
      const aspect = c.aspect ?? img.naturalWidth / img.naturalHeight;
      const w = Math.min(Math.max(img.naturalWidth, PAGE_W), 2560);
      const h = Math.round(w / aspect);
      let canvas: HTMLCanvasElement;
      if (c.overlay?.length) {
        canvas = await renderReact(
          createElement(
            "div",
            { style: { position: "absolute", inset: 0 } },
            createElement("img", { src: mediaUrl(c.file), style: { position: "absolute", inset: 0, width: "100%", height: "100%" } }),
            createElement(OverlayView, { blocks: c.overlay, width: w, aspect }),
          ),
          w,
          h,
        );
      } else {
        canvas = blankCanvas(w, h, "#fff");
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      }
      if (c.videos?.length) {
        // the picture of a PowerPoint video is its poster; show the real first frame + a play mark
        await renderVideoAreas(canvas.getContext("2d")!, c.videos, w, h);
      }
      return { canvas, aspect };
    }
    case "video": {
      const frame = await videoFrame(c.file, (c.trimStart ?? 0) + 0.3);
      const canvas = blankCanvas(PAGE_W, (PAGE_W * 9) / 16);
      const ctx = canvas.getContext("2d")!;
      if (frame) drawContain(ctx, frame, 0, 0, canvas.width, canvas.height);
      drawPlayMark(ctx, 0, 0, canvas.width, canvas.height);
      return { canvas, aspect: 16 / 9, video: { file: c.file, trimStart: c.trimStart, trimEnd: c.trimEnd } };
    }
    case "youtube": {
      const canvas = blankCanvas(PAGE_W, (PAGE_W * 9) / 16);
      const ctx = canvas.getContext("2d")!;
      try {
        const thumb = await loadImage(youtubeThumb(c.videoId));
        drawContain(ctx, thumb, 0, 0, canvas.width, canvas.height);
      } catch {
        /* offline: a plain card with the play mark */
      }
      drawPlayMark(ctx, 0, 0, canvas.width, canvas.height);
      const q = [c.start ? `t=${Math.floor(c.start)}` : ""].filter(Boolean).join("&");
      return {
        canvas,
        aspect: 16 / 9,
        link: `https://www.youtube.com/watch?v=${c.videoId}${q ? "&" + q : ""}`,
        youtube: { id: c.videoId, start: c.start, end: c.end },
      };
    }
  }
}

/* ------------------------------------------------------------- writers */

const jpeg = (c: HTMLCanvasElement, q = 0.9) => c.toDataURL("image/jpeg", q);

async function buildPdf(pages: Page[], tick: () => void): Promise<ArrayBuffer> {
  // PowerPoint-sized pages (960 × 540 pt for 16:9); portrait pages are A4-wide
  const size = (p: Page) => {
    const w = p.aspect >= 1 ? 960 : 595;
    return [w, w / p.aspect] as [number, number];
  };
  const [w0, h0] = size(pages[0]);
  const doc = new jsPDF({ unit: "pt", format: [w0, h0], orientation: w0 >= h0 ? "landscape" : "portrait", compress: true });
  pages.forEach((p, i) => {
    const [w, h] = size(p);
    if (i > 0) doc.addPage([w, h], w >= h ? "landscape" : "portrait");
    doc.addImage(jpeg(p.canvas), "JPEG", 0, 0, w, h, undefined, "FAST");
    if (p.link) doc.link(0, 0, w, h, { url: p.link });
    tick();
  });
  return doc.output("arraybuffer");
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

const VIDEO_MIME: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", ogv: "video/ogg" };

async function buildPptx(pages: Page[], title: string, tick: () => void, isCancelled: () => boolean): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 × 7.5 in, 16:9
  pptx.rtlMode = true;
  pptx.title = title;
  const W = 13.333;
  const H = 7.5;
  /** slide number (1-based) → trim to write into its video */
  const trims = new Map<number, { st: number; end: number }>();

  for (let i = 0; i < pages.length; i++) {
    if (isCancelled()) throw new Cancelled();
    const p = pages[i];
    const s = pptx.addSlide();
    s.background = { color: "000000" };
    // contain the page in the 16:9 slide
    const w = p.aspect >= W / H ? W : H * p.aspect;
    const h = p.aspect >= W / H ? W / p.aspect : H;
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    const picture = jpeg(p.canvas).replace(/^data:/, "");

    let embedded = false;
    if (p.video) {
      try {
        const ext = (p.video.file.split(".").pop() ?? "mp4").toLowerCase();
        const buf = await invoke<ArrayBuffer>("read_file_bytes", { path: mediaPath(p.video.file) });
        if (buf.byteLength <= MAX_EMBED_BYTES) {
          s.addMedia({ type: "video", data: `${VIDEO_MIME[ext] ?? "video/mp4"};base64,${toBase64(buf)}`, extn: ext, x, y, w, h, cover: picture } as never);
          embedded = true;
          if (p.video.trimStart || p.video.trimEnd)
            trims.set(i + 1, { st: Math.round((p.video.trimStart ?? 0) * 1000), end: Math.round((p.video.trimEnd ?? 0) * 1000) });
        }
      } catch {
        /* unreadable → picture only */
      }
    } else if (p.youtube) {
      const params = [p.youtube.start ? `start=${Math.floor(p.youtube.start)}` : "", p.youtube.end ? `end=${Math.ceil(p.youtube.end)}` : ""].filter(Boolean).join("&");
      s.addMedia({ type: "online", link: `https://www.youtube.com/embed/${p.youtube.id}${params ? "?" + params : ""}`, x, y, w, h, cover: picture } as never);
      embedded = true;
    }
    if (!embedded) s.addImage({ data: picture, x, y, w, h });
    tick();
  }

  const out = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  if (!trims.size) return out;

  // PowerPoint's own "Trim Video" lives in a p14 extension pptxgenjs doesn't write: add it.
  const zip = await JSZip.loadAsync(out);
  for (const [n, t] of trims) {
    const path = `ppt/slides/slide${n}.xml`;
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const patched = xml.replace(/(<p14:media\b[^>]*?)\/>/, `$1><p14:trim st="${t.st}" end="${t.end}"/></p14:media>`);
    zip.file(path, patched);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/* ------------------------------------------------------------- entry */

export function exportableSlides(items: Item[], includeHidden: boolean) {
  return items.flatMap((it) => it.slides.filter((s) => includeHidden || !s.hidden));
}

/** Renders and writes the file. Resolves false if cancelled. */
export async function exportTo(path: string, title: string, o: ExportOptions): Promise<boolean> {
  const slides = exportableSlides(o.items, o.includeHidden);
  if (!slides.length) throw new Error("אין שקופיות לייצוא");
  // rendering is ~2/3 of the work, writing ~1/3
  const total = slides.length * 3;
  let done = 0;
  const tick = (n = 1) => o.onProgress((done += n), total);

  try {
    const pages: Page[] = [];
    for (const s of slides) {
      if (o.isCancelled()) throw new Cancelled();
      try {
        pages.push(await renderSlide(s));
      } catch {
        // one broken media file never sinks the export: a black page keeps the numbering
        pages.push({ canvas: blankCanvas(PAGE_W, (PAGE_W * 9) / 16), aspect: 16 / 9 });
      }
      tick(2);
    }
    const bytes =
      o.format === "pdf"
        ? new Uint8Array(await buildPdf(pages, () => tick()))
        : await buildPptx(pages, title, () => tick(), o.isCancelled);
    if (o.isCancelled()) throw new Cancelled();
    await invoke("write_export", bytes, { headers: { "x-path": encodeURIComponent(path) } });
    pages.forEach((p) => (p.canvas.width = p.canvas.height = 0));
    return true;
  } catch (e) {
    if (e instanceof Cancelled) return false;
    throw e;
  }
}

