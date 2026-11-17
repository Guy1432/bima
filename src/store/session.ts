import { create } from "zustand";
import {
  DEFAULT_MEDIA,
  DEFAULT_TEXT,
  type Blackout,
  type DocView,
  type Item,
  type LiveState,
  type MediaSettings,
  type MonitorInfo,
  type SessionDoc,
  type Slide,
  type TextSlideData,
  withTextDefaults,
} from "@/lib/types";
import { uid } from "@/lib/utils";
import { fitWidth, pageAspect } from "@/lib/docview";
import { mediaUrl } from "@/lib/media";

export interface EditorState {
  itemId: string | null; // item to add into / edit in - any type (null → create a new text item)
  slideId: string | null; // null → new slide
  afterIndex?: number | null; // where a NEW slide is inserted (default: end)
  draft: TextSlideData;
  /** annotating a page (image slide): the draft's blocks are drawn over this, not a designed slide */
  base?: Extract<Slide["content"], { kind: "image" }> & { aspect: number };
}

interface SessionState {
  loaded: boolean;
  name: string;
  items: Item[];
  selectedItemId: string | null;
  editor: EditorState | null;
  live: LiveState;
  projector: { open: boolean; label: string };
  monitors: MonitorInfo[];

  // session
  loadDoc: (doc: SessionDoc | null) => void;
  toDoc: () => SessionDoc;
  setName: (name: string) => void;

  // playlist
  addItems: (items: Item[]) => void;
  reorderItems: (fromId: string, toId: string) => void;
  removeItem: (id: string) => void;
  duplicateItem: (id: string) => void;
  renameItem: (id: string, title: string) => void;
  updateItemMedia: (id: string, p: Partial<MediaSettings>) => void;
  select: (id: string | null) => void;

  // slides
  removeSlide: (itemId: string, slideId: string) => void;
  duplicateSlide: (itemId: string, slideId: string) => void;
  toggleSlideHidden: (itemId: string, slideId: string) => void;
  moveSlide: (itemId: string, fromId: string, toId: string) => void;
  insertSlides: (itemId: string, slides: Slide[], afterIndex?: number) => void;
  /** Replace what a slide shows (trim, annotations…), keeping its id and place. */
  setSlideContent: (itemId: string, slideId: string, content: Slide["content"]) => void;

  // live
  goLive: (itemId: string, index: number) => void;
  next: () => void;
  prev: () => void;
  clearLive: () => void;
  setBlackout: (b: Blackout) => void;
  toggleBlackout: (b?: Exclude<Blackout, "none">) => void;
  setMessage: (m: string | null) => void;
  setLiveMedia: (p: Partial<MediaSettings>) => void;
  setTransition: (t: LiveState["transition"], fadeMs: number) => void;
  restartTimer: () => void;
  setView: (view: DocView | null) => void;

  // editor
  openEditor: (itemId: string | null, slideId: string | null) => void;
  /** Draw / place things on top of an existing page (image slide). */
  annotateSlide: (itemId: string, slideId: string) => Promise<void>;
  /** New designed slide. Without args: into the selected text item (or a new item). */
  newTextSlide: (itemId?: string, afterIndex?: number) => void;
  updateDraft: (p: Partial<TextSlideData>) => void;
  commitDraft: (push: boolean) => void;
  closeEditor: () => void;

  // projector
  setProjector: (open: boolean, label?: string) => void;
  setMonitors: (m: MonitorInfo[]) => void;
}

const emptyLive = (): LiveState => ({
  key: uid(),
  slide: null,
  itemId: null,
  slideIndex: -1,
  blackout: "none",
  message: null,
  transition: "fade",
  fadeMs: 350,
  startedAt: Date.now(),
  media: { ...DEFAULT_MEDIA },
  projectorOpen: false,
});

function firstVisible(item: Item | undefined, from: number, dir: 1 | -1): number {
  if (!item) return -1;
  for (let i = from; i >= 0 && i < item.slides.length; i += dir) if (!item.slides[i].hidden) return i;
  return -1;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function freshIds(item: Item): Item {
  return { ...clone(item), id: uid(), slides: item.slides.map((s) => ({ ...clone(s), id: uid() })) };
}

export const useSession = create<SessionState>()((set, get) => ({
  loaded: false,
  name: "פרויקט חדש",
  items: [],
  selectedItemId: null,
  editor: null,
  live: emptyLive(),
  projector: { open: false, label: "" },
  monitors: [],

  loadDoc: (doc) =>
    set((s) => ({
      loaded: true,
      name: doc?.name ?? "פרויקט חדש",
      items: doc?.items ?? [],
      selectedItemId: doc?.items?.[0]?.id ?? null,
      editor: null,
      live: { ...emptyLive(), projectorOpen: s.projector.open, transition: s.live.transition, fadeMs: s.live.fadeMs },
    })),
  toDoc: () => ({ version: 1, name: get().name, items: get().items }),
  setName: (name) => set({ name }),

  addItems: (newItems) =>
    set((s) => {
      if (!newItems.length) return s;
      const idx = s.items.findIndex((i) => i.id === s.selectedItemId);
      const items = [...s.items];
      items.splice(idx === -1 ? items.length : idx + 1, 0, ...newItems);
      return { items, selectedItemId: newItems[0].id };
    }),
  reorderItems: (fromId, toId) =>
    set((s) => {
      const from = s.items.findIndex((i) => i.id === fromId);
      const to = s.items.findIndex((i) => i.id === toId);
      if (from < 0 || to < 0 || from === to) return s;
      const items = [...s.items];
      const [m] = items.splice(from, 1);
      items.splice(to, 0, m);
      return { items };
    }),
  removeItem: (id) =>
    set((s) => {
      const idx = s.items.findIndex((i) => i.id === id);
      const items = s.items.filter((i) => i.id !== id);
      const selectedItemId =
        s.selectedItemId === id ? (items[Math.min(idx, items.length - 1)]?.id ?? null) : s.selectedItemId;
      const editor = s.editor?.itemId === id ? null : s.editor;
      return { items, selectedItemId, editor };
    }),
  duplicateItem: (id) =>
    set((s) => {
      const idx = s.items.findIndex((i) => i.id === id);
      if (idx < 0) return s;
      const copy = freshIds(s.items[idx]);
      copy.title = `${copy.title} (עותק)`;
      const items = [...s.items];
      items.splice(idx + 1, 0, copy);
      return { items, selectedItemId: copy.id };
    }),
  renameItem: (id, title) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, title } : i)) })),
  updateItemMedia: (id, p) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, media: { ...i.media, ...p } } : i)),
      live: s.live.itemId === id ? { ...s.live, media: { ...s.live.media, ...p } } : s.live,
    })),
  select: (id) => set({ selectedItemId: id }),

  removeSlide: (itemId, slideId) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === itemId ? { ...i, slides: i.slides.filter((x) => x.id !== slideId) } : i)),
    })),
  duplicateSlide: (itemId, slideId) =>
    set((s) => ({
      items: s.items.map((i) => {
        if (i.id !== itemId) return i;
        const idx = i.slides.findIndex((x) => x.id === slideId);
        if (idx < 0) return i;
        const slides = [...i.slides];
        slides.splice(idx + 1, 0, { ...clone(i.slides[idx]), id: uid() });
        return { ...i, slides };
      }),
    })),
  toggleSlideHidden: (itemId, slideId) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.id === itemId
          ? { ...i, slides: i.slides.map((x) => (x.id === slideId ? { ...x, hidden: !x.hidden } : x)) }
          : i,
      ),
    })),
  moveSlide: (itemId, fromId, toId) =>
    set((s) => ({
      items: s.items.map((i) => {
        if (i.id !== itemId) return i;
        const from = i.slides.findIndex((x) => x.id === fromId);
        const to = i.slides.findIndex((x) => x.id === toId);
        if (from < 0 || to < 0) return i;
        const slides = [...i.slides];
        const [m] = slides.splice(from, 1);
        slides.splice(to, 0, m);
        return { ...i, slides };
      }),
    })),

  insertSlides: (itemId, slides, afterIndex) =>
    set((s) => ({
      items: s.items.map((i) => {
        if (i.id !== itemId) return i;
        const out = [...i.slides];
        const at = afterIndex === undefined ? out.length : Math.min(out.length, afterIndex + 1);
        out.splice(at, 0, ...slides);
        return { ...i, slides: out };
      }),
    })),

  setSlideContent: (itemId, slideId, content) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.id !== itemId ? i : { ...i, slides: i.slides.map((x) => (x.id === slideId ? { ...x, content } : x)) },
      ),
    })),

  goLive: (itemId, index) => {
    const item = get().items.find((i) => i.id === itemId);
    const slide = item?.slides[index];
    if (!item || !slide) return;
    // reading a document in "fit width": the next page of the same item opens the same way,
    // from its top. Anything else starts as the whole page.
    const prev = get().live;
    const aspect = pageAspect(slide);
    const view = prev.view?.fit === "width" && prev.itemId === itemId && aspect ? fitWidth(aspect) : null;
    set((s) => ({
      live: {
        ...s.live,
        key: uid(),
        slide: clone(slide),
        itemId,
        slideIndex: index,
        startedAt: Date.now(),
        media: { ...item.media },
        view,
      },
    }));
  },
  setView: (view) => set((s) => ({ live: { ...s.live, view } })),
  next: () => {
    const { live, items, selectedItemId, goLive } = get();
    const liveIdx = items.findIndex((i) => i.id === live.itemId);
    if (!live.slide || liveIdx === -1) {
      const item = items.find((i) => i.id === selectedItemId) ?? items[0];
      const k = firstVisible(item, 0, 1);
      if (item && k !== -1) goLive(item.id, k);
      return;
    }
    const k = firstVisible(items[liveIdx], live.slideIndex + 1, 1);
    if (k !== -1) return goLive(items[liveIdx].id, k);
    for (let j = liveIdx + 1; j < items.length; j++) {
      const kk = firstVisible(items[j], 0, 1);
      if (kk !== -1) {
        goLive(items[j].id, kk);
        if (!get().editor) set({ selectedItemId: items[j].id });
        return;
      }
    }
  },
  prev: () => {
    const { live, items, goLive } = get();
    const liveIdx = items.findIndex((i) => i.id === live.itemId);
    if (!live.slide || liveIdx === -1) return;
    const k = firstVisible(items[liveIdx], live.slideIndex - 1, -1);
    if (k !== -1) return goLive(items[liveIdx].id, k);
    for (let j = liveIdx - 1; j >= 0; j--) {
      const kk = firstVisible(items[j], items[j].slides.length - 1, -1);
      if (kk !== -1) {
        goLive(items[j].id, kk);
        if (!get().editor) set({ selectedItemId: items[j].id });
        return;
      }
    }
  },
  clearLive: () =>
    set((s) => ({ live: { ...s.live, key: uid(), slide: null, itemId: null, slideIndex: -1 } })),
  setBlackout: (b) => set((s) => ({ live: { ...s.live, blackout: b } })),
  toggleBlackout: (b = "black") =>
    set((s) => ({ live: { ...s.live, blackout: s.live.blackout === b ? "none" : b } })),
  setMessage: (m) => set((s) => ({ live: { ...s.live, message: m && m.trim() ? m : null } })),
  setLiveMedia: (p) => {
    const { live, updateItemMedia } = get();
    if (live.itemId) updateItemMedia(live.itemId, p);
    else set({ live: { ...live, media: { ...live.media, ...p } } });
  },
  setTransition: (transition, fadeMs) => set((s) => ({ live: { ...s.live, transition, fadeMs } })),
  restartTimer: () => set((s) => ({ live: { ...s.live, startedAt: Date.now() } })),

  openEditor: (itemId, slideId) => {
    const item = get().items.find((i) => i.id === itemId);
    const slide = item?.slides.find((s) => s.id === slideId);
    const draft = slide?.content.kind === "text" ? withTextDefaults(clone(slide.content.text)) : { ...DEFAULT_TEXT };
    set({ editor: { itemId: item ? item.id : null, slideId: slide ? slide.id : null, draft } });
  },
  annotateSlide: async (itemId, slideId) => {
    const item = get().items.find((i) => i.id === itemId);
    const slide = item?.slides.find((s) => s.id === slideId);
    if (!slide || slide.content.kind !== "image") return;
    const c = slide.content;
    const aspect = c.aspect ?? (await imageAspect(c.file));
    set({
      editor: {
        itemId,
        slideId,
        draft: { ...DEFAULT_TEXT, template: "custom", bg: "#000000", blocks: clone(c.overlay ?? []) },
        base: { ...clone(c), aspect },
      },
    });
  },
  newTextSlide: (targetId, afterIndex) => {
    const { items, selectedItemId } = get();
    const explicit = targetId ? items.find((i) => i.id === targetId) : undefined;
    const sel = explicit ?? items.find((i) => i.id === selectedItemId);
    const into = explicit ?? (sel?.type === "text" ? sel : undefined);
    // carry the look of the nearest designed slide in that item
    const near = into?.slides
      .slice(0, afterIndex === undefined ? undefined : afterIndex + 1)
      .reverse()
      .find((s) => s.content.kind === "text");
    const base = near?.content.kind === "text" ? near.content.text : DEFAULT_TEXT;
    set({
      editor: {
        itemId: into ? into.id : null,
        slideId: null,
        afterIndex: afterIndex ?? null,
        // carry the look of the previous slide so a series stays consistent
        draft: {
          ...DEFAULT_TEXT,
          bg: base.bg,
          fg: base.fg,
          align: base.align,
          headingFont: base.headingFont ?? DEFAULT_TEXT.headingFont,
          bodyFont: base.bodyFont ?? DEFAULT_TEXT.bodyFont,
          headingWeight: base.headingWeight ?? DEFAULT_TEXT.headingWeight,
          bodyWeight: base.bodyWeight ?? DEFAULT_TEXT.bodyWeight,
          accent: base.accent ?? DEFAULT_TEXT.accent,
          decor: base.decor ?? DEFAULT_TEXT.decor,
        },
      },
    });
  },
  updateDraft: (p) => set((s) => (s.editor ? { editor: { ...s.editor, draft: { ...s.editor.draft, ...p } } } : s)),
  commitDraft: (push) => {
    const { editor } = get();
    if (!editor) return;
    if (editor.base) {
      // annotations: write the layer back onto the page, never a new slide / item
      const { itemId: aid, slideId: sid, base } = editor;
      const blocks = clone(editor.draft.blocks ?? []);
      const { aspect, ...page } = base;
      const content = { ...page, aspect, overlay: blocks.length ? blocks : undefined };
      if (aid && sid) get().setSlideContent(aid, sid, content);
      if (push && aid && sid) {
        const item = get().items.find((i) => i.id === aid);
        const at = item?.slides.findIndex((x) => x.id === sid) ?? -1;
        if (at >= 0) get().goLive(aid, at);
      }
      return;
    }
    const content = { kind: "text" as const, text: clone(editor.draft) };
    let itemId = editor.itemId;
    let slideId = editor.slideId;

    if (itemId && get().items.some((i) => i.id === itemId)) {
      set((s) => ({
        items: s.items.map((i) => {
          if (i.id !== itemId) return i;
          if (slideId && i.slides.some((x) => x.id === slideId))
            return { ...i, slides: i.slides.map((x) => (x.id === slideId ? { ...x, content } : x)) };
          slideId = uid();
          const slides = [...i.slides];
          const at = editor.afterIndex === null || editor.afterIndex === undefined ? slides.length : Math.min(slides.length, editor.afterIndex + 1);
          slides.splice(at, 0, { id: slideId, content });
          return { ...i, slides };
        }),
      }));
    } else {
      slideId = uid();
      const item: Item = {
        id: uid(),
        type: "text",
        title: editor.draft.title.trim() || "שקופיות טקסט",
        slides: [{ id: slideId, content }],
        media: { ...DEFAULT_MEDIA },
      };
      itemId = item.id;
      get().addItems([item]);
    }
    set({ editor: { ...editor, itemId, slideId, afterIndex: null }, selectedItemId: itemId });
    if (push) {
      const item = get().items.find((i) => i.id === itemId)!;
      get().goLive(itemId!, item.slides.findIndex((x) => x.id === slideId));
    }
  },
  closeEditor: () => set({ editor: null }),

  setProjector: (open, label = "") =>
    set((s) => ({ projector: { open, label }, live: { ...s.live, projectorOpen: open } })),
  setMonitors: (monitors) => set({ monitors }),
}));

/** Width / height of a media image (when the slide didn't record it). */
function imageAspect(file: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 16 / 9);
    img.onerror = () => resolve(16 / 9);
    img.src = mediaUrl(file);
  });
}

export function liveItem(): Item | undefined {
  const s = useSession.getState();
  return s.items.find((i) => i.id === s.live.itemId);
}

/** What `next()` would show - for the "up next" preview. */
export function peekNext(
  s: Pick<SessionState, "live" | "items" | "selectedItemId">,
): { slide: Slide; item: Item; index: number } | null {
  const { live, items } = s;
  const idx = items.findIndex((i) => i.id === live.itemId);
  if (!live.slide || idx === -1) {
    const item = items.find((i) => i.id === s.selectedItemId) ?? items[0];
    const k = firstVisible(item, 0, 1);
    return k === -1 || !item ? null : { slide: item.slides[k], item, index: k };
  }
  const k = firstVisible(items[idx], live.slideIndex + 1, 1);
  if (k !== -1) return { slide: items[idx].slides[k], item: items[idx], index: k };
  for (let j = idx + 1; j < items.length; j++) {
    const kk = firstVisible(items[j], 0, 1);
    if (kk !== -1) return { slide: items[j].slides[kk], item: items[j], index: kk };
  }
  return null;
}
