import { toast } from "sonner";
import type { Item, TextSlideData } from "@/lib/types";
import { useSession } from "./session";

/**
 * Undo / redo.
 * - Session stack: the run-of-show (items + name). Rapid changes within 500ms are merged,
 *   so dragging a slider or typing a title is one undo step.
 * - Draft stack: the slide being edited in Live Edit (separate, so Ctrl+Z inside the editor
 *   undoes design changes without touching the playlist).
 */
interface SessionSnap {
  items: Item[];
  name: string;
}

const LIMIT = 100;
const MERGE_MS = 500;

const past: SessionSnap[] = [];
const future: SessionSnap[] = [];
const draftPast: TextSlideData[] = [];
const draftFuture: TextSlideData[] = [];
let applying = false;
let lastPush = 0;
let lastDraftPush = 0;

export function resetHistory() {
  past.length = future.length = draftPast.length = draftFuture.length = 0;
}

export function startHistory() {
  return useSession.subscribe((s, prev) => {
    if (applying) return;
    // session switch → new history
    if (s.loaded && !prev.loaded) return resetHistory();
    if (s.items !== prev.items || s.name !== prev.name) {
      if (prev.items === s.items && prev.name === s.name) return;
      const now = performance.now();
      if (now - lastPush > MERGE_MS || !past.length) {
        past.push({ items: prev.items, name: prev.name });
        if (past.length > LIMIT) past.shift();
      }
      lastPush = now;
      future.length = 0;
    }
    const d = s.editor?.draft;
    const pd = prev.editor?.draft;
    if (s.editor && prev.editor && d !== pd && pd) {
      const now = performance.now();
      if (now - lastDraftPush > MERGE_MS || !draftPast.length) {
        draftPast.push(pd);
        if (draftPast.length > LIMIT) draftPast.shift();
      }
      lastDraftPush = now;
      draftFuture.length = 0;
    }
    if (!s.editor && prev.editor) draftPast.length = draftFuture.length = 0;
  });
}

function apply(fn: () => void) {
  applying = true;
  try {
    fn();
  } finally {
    applying = false;
  }
  lastPush = lastDraftPush = 0;
}

export function undo(): boolean {
  const s = useSession.getState();
  if (s.editor && draftPast.length) {
    const d = draftPast.pop()!;
    draftFuture.push(s.editor.draft);
    apply(() => useSession.setState({ editor: { ...s.editor!, draft: d } }));
    return true;
  }
  if (!past.length) {
    toast("אין מה לבטל", { duration: 1200 });
    return false;
  }
  const snap = past.pop()!;
  future.push({ items: s.items, name: s.name });
  apply(() => {
    const sel = snap.items.some((i) => i.id === s.selectedItemId) ? s.selectedItemId : (snap.items[0]?.id ?? null);
    useSession.setState({ items: snap.items, name: snap.name, selectedItemId: sel });
  });
  toast("בוטל", { duration: 1500, action: { label: "בצע שוב", onClick: () => redo() } });
  return true;
}

export function redo(): boolean {
  const s = useSession.getState();
  if (s.editor && draftFuture.length) {
    const d = draftFuture.pop()!;
    draftPast.push(s.editor.draft);
    apply(() => useSession.setState({ editor: { ...s.editor!, draft: d } }));
    return true;
  }
  if (!future.length) return false;
  const snap = future.pop()!;
  past.push({ items: s.items, name: s.name });
  apply(() => useSession.setState({ items: snap.items, name: snap.name }));
  toast("בוצע שוב", { duration: 1200 });
  return true;
}
