import { invoke } from "@tauri-apps/api/core";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { baseName, EXT, extOf, mediaPath } from "./media";
import { DEFAULT_MEDIA, type Item, type Slide, type VideoOverlay } from "./types";
import { uid } from "./utils";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type Progress = (msg: string) => void;

const FULL_W = 2560;
const THUMB_W = 480;

async function canvasToBytes(canvas: HTMLCanvasElement, type = "image/png", q?: number) {
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), type, q),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

async function saveBytes(bytes: Uint8Array, ext: string): Promise<string> {
  return invoke<string>("save_media_bytes", bytes, { headers: { "x-ext": ext } });
}

async function renderPage(page: pdfjs.PDFPageProxy, width: number) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Rasterise every PDF page into crisp PNG slides (+ small thumbnails). */
export async function pdfToSlides(absPath: string, progress: Progress, label: string): Promise<Slide[]> {
  const buf = await invoke<ArrayBuffer>("read_file_bytes", { path: absPath });
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const slides: Slide[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      progress(`${label}: מעבד עמוד ${i} מתוך ${doc.numPages}`);
      const page = await doc.getPage(i);
      const full = await renderPage(page, FULL_W);
      const aspect = full.width / full.height;
      const file = await saveBytes(await canvasToBytes(full), "png");
      const thumbCanvas = await renderPage(page, THUMB_W);
      const thumb = await saveBytes(await canvasToBytes(thumbCanvas, "image/jpeg", 0.85), "jpg");
      full.width = full.height = thumbCanvas.width = thumbCanvas.height = 0;
      page.cleanup();
      slides.push({ id: uid(), content: { kind: "image", file, thumb, aspect } });
    }
  } finally {
    await doc.destroy();
  }
  return slides;
}

interface PresResult {
  engine: "powerpoint" | "libreoffice";
  aspect: number;
  slides: { file: string; thumb: string; hidden: boolean }[];
  pdf: string | null;
  slideVideos: VideoOverlay[][];
  warnings: string[];
}

function newItem(partial: Partial<Item> & Pick<Item, "type" | "title" | "slides">): Item {
  return { id: uid(), media: { ...DEFAULT_MEDIA }, ...partial };
}

export interface ImportOutcome {
  items: Item[];
  bundles: string[];
  errors: string[];
}

async function presentationToSlides(p: string, progress: Progress, title: string) {
  progress(`ממיר מצגת: ${title} (PowerPoint ברקע)…`);
  const r = await invoke<PresResult>("convert_presentation", { path: p });
  let slides: Slide[];
  if (r.engine === "powerpoint") {
    slides = r.slides.map((s, i) => ({
      id: uid(),
      hidden: s.hidden || undefined,
      content: {
        kind: "image",
        file: s.file,
        thumb: s.thumb,
        aspect: r.aspect,
        videos: r.slideVideos[i]?.length ? r.slideVideos[i] : undefined,
      },
    }));
  } else {
    slides = await pdfToSlides(mediaPath(r.pdf!), progress, title);
    slides.forEach((s, i) => {
      if (s.content.kind === "image" && r.slideVideos[i]?.length) s.content.videos = r.slideVideos[i];
    });
  }
  return { slides, r };
}

/** Any supported file → slides (used to insert pages/slides/images into an existing item). */
export async function slidesFromPath(p: string, progress: Progress): Promise<Slide[]> {
  const ext = extOf(p);
  const title = baseName(p);
  if (EXT.image.includes(ext)) {
    progress(`מעתיק תמונה: ${title}`);
    const file = await invoke<string>("import_file", { path: p });
    return [{ id: uid(), content: { kind: "image", file } }];
  }
  if (EXT.video.includes(ext)) {
    progress(`מעתיק וידאו: ${title}`);
    const file = await invoke<string>("import_file", { path: p });
    return [{ id: uid(), content: { kind: "video", file } }];
  }
  if (EXT.pdf.includes(ext)) return pdfToSlides(p, progress, title);
  if (EXT.presentation.includes(ext)) return (await presentationToSlides(p, progress, title)).slides;
  throw new Error(`${title}.${ext}: סוג קובץ לא נתמך`);
}

export async function importPaths(paths: string[], progress: Progress): Promise<ImportOutcome> {
  const items: Item[] = [];
  const bundles: string[] = [];
  const errors: string[] = [];
  const images: string[] = [];

  for (const p of paths) {
    const ext = extOf(p);
    const title = baseName(p);
    try {
      if (EXT.image.includes(ext)) {
        images.push(p);
      } else if (EXT.video.includes(ext)) {
        progress(`מעתיק וידאו: ${title}`);
        const file = await invoke<string>("import_file", { path: p });
        items.push(
          newItem({ type: "video", title, slides: [{ id: uid(), content: { kind: "video", file } }] }),
        );
      } else if (EXT.pdf.includes(ext)) {
        const slides = await pdfToSlides(p, progress, title);
        items.push(newItem({ type: "pdf", title, slides }));
      } else if (EXT.presentation.includes(ext)) {
        const { slides, r } = await presentationToSlides(p, progress, title);
        const vids = r.slideVideos.reduce((n, v) => n + v.length, 0);
        items.push(
          newItem({
            type: "presentation",
            title,
            slides,
            note: `${r.engine === "powerpoint" ? "PowerPoint" : "LibreOffice"}${vids ? ` · ${vids} סרטונים` : ""}`,
            media: { ...DEFAULT_MEDIA, autoplay: false },
          }),
        );
      } else if (EXT.bundle.includes(ext)) {
        bundles.push(p);
      } else {
        errors.push(`${title}.${ext}: סוג קובץ לא נתמך`);
      }
    } catch (e) {
      errors.push(`${title}: ${String(e)}`);
    }
  }

  if (images.length) {
    const slides: Slide[] = [];
    for (const p of images) {
      progress(`מעתיק תמונה: ${baseName(p)}`);
      try {
        const file = await invoke<string>("import_file", { path: p });
        slides.push({ id: uid(), content: { kind: "image", file } });
      } catch (e) {
        errors.push(`${baseName(p)}: ${String(e)}`);
      }
    }
    if (slides.length)
      items.push(
        newItem({
          type: "image",
          title: images.length === 1 ? baseName(images[0]) : `תמונות (${slides.length})`,
          slides,
        }),
      );
  }

  return { items, bundles, errors };
}

/** All media file names referenced by a list of items (for bundles + cleanup). */
export function referencedFiles(items: Item[]): string[] {
  const out = new Set<string>();
  for (const it of items)
    for (const s of it.slides) {
      const c = s.content;
      if (c.kind === "text") {
        if (c.text.bgImage) out.add(c.text.bgImage);
        c.text.blocks?.forEach((b) => b.file && out.add(b.file));
      } else if (c.kind === "image") {
        out.add(c.file);
        if (c.thumb) out.add(c.thumb);
        c.videos?.forEach((v) => out.add(v.file));
        c.overlay?.forEach((b) => b.file && out.add(b.file));
      } else if (c.kind === "video") out.add(c.file);
    }
  return [...out];
}
