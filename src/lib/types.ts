export type ItemType = "presentation" | "pdf" | "video" | "youtube" | "image" | "text";

export interface VideoOverlay {
  file: string;
  /** fractions of the slide box (0..1) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** PowerPoint "Trim Video": seconds cut from the start / from the end */
  trimStart?: number;
  trimEnd?: number;
}

export type TextTemplate = "title" | "bullets" | "quote" | "timer" | "free" | "qr" | "custom";

export type Decor = "none" | "line" | "bar" | "frame";

export type ShapeKind = "rect" | "ellipse" | "line" | "arrow";

/**
 * A free-positioned element: text box, image, shape or freehand ink.
 * Geometry is in fractions of the canvas (1920 wide; 1080 high on designed slides, or the
 * page's own height on annotated slides). Sizes (font, stroke) are px on the 1920 canvas.
 */
export interface TextBlock {
  id: string;
  kind?: "text" | "image" | "shape" | "ink";
  file?: string; // image blocks: media file
  radius?: number; // image / rect corner radius, px on the 1920 canvas
  /** shape / ink: box height (text and images size themselves) */
  h?: number;
  shape?: ShapeKind;
  /** shape / ink: stroke width, px on the 1920 canvas (0 = no outline) */
  stroke?: number;
  /** rect / ellipse fill (null = none) */
  fill?: string | null;
  /** ink + line / arrow: x,y pairs normalised to the box (0..1) */
  points?: number[];
  text: string;
  x: number;
  y: number;
  w: number;
  size: number; // px on the 1920 canvas
  weight: number;
  font: string;
  color: string;
  align: "right" | "center" | "left";
  lineHeight: number;
  letterSpacing: number; // em
  highlight: string | null; // background box behind the text
  opacity: number;
}

export interface TextSlideData {
  template: TextTemplate;
  title: string;
  subtitle: string;
  body: string;
  bg: string;
  fg: string;
  fontScale: number;
  align: "start" | "center";
  timerMinutes: number;
  // typography (optional for backwards compatibility - see withTextDefaults)
  headingFont?: string;
  bodyFont?: string;
  headingWeight?: number;
  bodyWeight?: number;
  accent?: string;
  lineHeight?: number;
  letterSpacing?: number;
  decor?: Decor;
  blocks?: TextBlock[];
  bgImage?: string | null; // media file
  bgDim?: number; // 0..0.9 darkening over the background image
}

export type SlideContent =
  | {
      kind: "image";
      file: string;
      thumb?: string;
      aspect?: number;
      videos?: VideoOverlay[];
      /** drawings / text / shapes placed on top of the page (canvas: 1920 × 1920/aspect) */
      overlay?: TextBlock[];
    }
  | { kind: "video"; file: string; trimStart?: number; trimEnd?: number }
  /** start / end: absolute seconds in the YouTube video (the clip plays only between them) */
  | { kind: "youtube"; videoId: string; start?: number; end?: number }
  | { kind: "text"; text: TextSlideData };

export interface Slide {
  id: string;
  content: SlideContent;
  hidden?: boolean;
}

export interface MediaSettings {
  autoplay: boolean;
  loop: boolean;
  volume: number; // 0..1
  muted: boolean;
  advanceOnEnd: boolean;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  slides: Slide[];
  media: MediaSettings;
  note?: string;
}

export interface SessionDoc {
  version: 1;
  name: string;
  items: Item[];
}

export type Blackout = "none" | "black" | "white";

/** Everything the audience window needs to render. Broadcast on every change. */
/** Zoom & pan on a page - see lib/docview.ts. */
export interface DocView {
  zoom: number;
  cx: number;
  cy: number;
  fit?: "page" | "width";
  /** follow the pointer exactly (dragging) instead of easing */
  instant?: boolean;
}

export interface LiveState {
  key: string; // changes on every push → transition + media restart
  slide: Slide | null;
  itemId: string | null;
  slideIndex: number;
  blackout: Blackout;
  message: string | null;
  transition: "fade" | "cut";
  fadeMs: number;
  startedAt: number; // ms epoch, for timers
  media: MediaSettings;
  projectorOpen: boolean;
  /** shown on the audience screen when nothing is live (null = plain black) */
  standby?: { title: string; showClock: boolean } | null;
  /** document zoom/pan for page slides (null = whole page) */
  view?: DocView | null;
}

export type MediaCommand =
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "seek"; time: number }
  | { type: "seekBy"; delta: number }
  | { type: "restart" };

export interface MediaStatus {
  key: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
}

export interface MonitorInfo {
  index: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
}

export const DEFAULT_MEDIA: MediaSettings = {
  autoplay: true,
  loop: false,
  volume: 1,
  muted: false,
  advanceOnEnd: false,
};

export const DEFAULT_TEXT: TextSlideData = {
  template: "title",
  title: "כותרת ראשית",
  subtitle: "כותרת משנה",
  body: "",
  bg: "#0a0a0a",
  fg: "#fafafa",
  fontScale: 1,
  align: "center",
  timerMinutes: 10,
  headingFont: "heebo",
  bodyFont: "heebo",
  headingWeight: 700,
  bodyWeight: 400,
  accent: "#6366f1",
  lineHeight: 1,
  letterSpacing: 0,
  decor: "none",
  blocks: [],
  bgImage: null,
  bgDim: 0.35,
};

export type FullText = Required<TextSlideData>;

export function withTextDefaults(d: TextSlideData): FullText {
  const out = { ...DEFAULT_TEXT, ...d } as FullText;
  for (const k of Object.keys(DEFAULT_TEXT) as (keyof TextSlideData)[])
    if (out[k] === undefined) (out as any)[k] = DEFAULT_TEXT[k];
  return out;
}

export function newBlock(p: Partial<TextBlock> = {}): TextBlock {
  return {
    id: Math.random().toString(36).slice(2, 10),
    text: "טקסט חדש",
    x: 0.2,
    y: 0.42,
    w: 0.6,
    size: 72,
    weight: 600,
    font: "heebo",
    color: "#fafafa",
    align: "center",
    lineHeight: 1.25,
    letterSpacing: 0,
    highlight: null,
    opacity: 1,
    ...p,
  };
}

/** Does this slide contain a controllable media element? */
export function slideHasMedia(s: Slide | null | undefined): boolean {
  if (!s) return false;
  const c = s.content;
  return c.kind === "video" || c.kind === "youtube" || (c.kind === "image" && !!c.videos?.length);
}
