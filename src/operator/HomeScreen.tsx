import { useEffect, useState } from "react";
import { confirmAction } from "@/components/ConfirmHost";
import { FolderOpen, MoreHorizontal, Plus, Search, Settings, Trash2, Copy, Presentation, Pencil } from "lucide-react";
import { SlideThumb } from "@/components/stage/Stage";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { Input } from "@/components/ui/primitives";
import type { Slide } from "@/lib/types";

import { invoke } from "@tauri-apps/api/core";
import { importBundle } from "./actions";
import { createSession, deleteSession, openSession, refreshSessions, renameSession, useLibrary, type SessionMeta } from "./library";
import { AccountChip } from "./AccountChip";
import type { SettingsPage } from "./Settings";
import { InlineRename } from "@/components/InlineRename";
import { BimaLogo } from "@/components/BimaLogo";

function timeAgo(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "עכשיו";
  if (s < 3600) return `לפני ${Math.floor(s / 60)} דקות`;
  if (s < 86400) return `לפני ${Math.floor(s / 3600)} שעות`;
  if (s < 86400 * 7) return `לפני ${Math.floor(s / 86400)} ימים`;
  return new Date(ms).toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
}

async function duplicateSession(id: string) {
  const r = await invoke<{ json: string | null }>("load_session", { id });
  if (!r.json) return;
  const doc = JSON.parse(r.json);
  doc.name = `${doc.name} (עותק)`;
  await createSession(doc);
}

function ProjectCard({ s, index, onDelete }: { s: SessionMeta & { cover?: Slide | null }; index: number; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const actions = (I: typeof DropdownMenuItem | typeof ContextMenuItem, Sep: () => React.ReactElement) => (
    <>
      <I onSelect={() => openSession(s.id)}>
        <Presentation /> פתיחה
      </I>
      <I onSelect={() => setEditing(true)}>
        <Pencil /> שינוי שם…
      </I>
      <I onSelect={() => duplicateSession(s.id)}>
        <Copy /> שכפול
      </I>
      <Sep />
      <I destructive onSelect={onDelete}>
        <Trash2 /> מחיקה…
      </I>
    </>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div style={{ ["--stagger" as string]: `${Math.min(index, 12) * 30}ms` }} className="enter-rise group relative flex flex-col gap-2">
          <button
            onClick={() => openSession(s.id)}
            className="pressable relative aspect-video w-full overflow-hidden rounded-lg bg-black text-right shadow-[0_0_0_1px_var(--border)] transition-shadow duration-[160ms] outline-none group-hover:shadow-[0_0_0_1px_var(--border-strong),0_10px_30px_-12px_rgb(0_0_0/0.8)] focus-visible:shadow-[0_0_0_2px_var(--ring)]"
            aria-label={`פתיחת ${s.name}`}
          >
            {s.cover ? (
              <SlideThumb slide={s.cover} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-raised">
                <span className="text-[13px] text-faint">פרויקט ריק</span>
              </div>
            )}
          </button>
          <div className="flex items-start gap-1 pr-0.5">
            <div className="min-w-0 flex-1">
              {editing ? (
                <InlineRename
                  value={s.name}
                  label="שם הפרויקט"
                  className="font-semibold"
                  onCommit={async (v) => {
                    setEditing(false);
                    await renameSession(s.id, v);
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <div className="truncate text-[13px] font-semibold" onDoubleClick={() => setEditing(true)} >
                  {s.name}
                </div>
              )}
              <div className="mt-0.5 text-[12px] text-faint tabular">
                {s.items ? `${s.items} פריטים` : "ריק"} · {timeAgo(s.updated)}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                  aria-label="פעולות"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">{actions(DropdownMenuItem, DropdownMenuSeparator)}</DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>{actions(ContextMenuItem, ContextMenuSeparator)}</ContextMenuContent>
    </ContextMenu>
  );
}

/** Launch screen: all projects, new / open bundle, account & sync. */
export function HomeScreen({ onSettings }: { onSettings: (page?: SettingsPage) => void }) {
  const sessions = useLibrary((s) => s.sessions) as (SessionMeta & { cover?: Slide | null })[];
  const [q, setQ] = useState("");
  useEffect(() => {
    refreshSessions();
  }, []);
  const list = sessions.filter((s) => s.name.includes(q.trim()));

  return (
    <div dir="rtl" className="enter-fade flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <BimaLogo markClassName="size-7" />
        <div className="flex-1" />
        <AccountChip onSettings={onSettings} />
        <Button size="icon-sm" variant="ghost" onClick={() => onSettings()} aria-label="הגדרות">
          <Settings />
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pt-8 pb-12 lg:px-10">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-tight">פרויקטים</h1>
            {sessions.length > 0 && <span className="rounded bg-raised px-1.5 py-0.5 text-[12px] text-muted-foreground tabular">{sessions.length}</span>}
            <div className="flex-1" />
            {sessions.length > 3 && (
              <div className="relative w-56">
                <Search className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-faint" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש…" className="h-8 pr-8 text-[13px]" aria-label="חיפוש פרויקט" />
              </div>
            )}
            <Button variant="ghost" onClick={() => importBundle()}>
              <FolderOpen /> פתיחת חבילה
            </Button>
            <Button onClick={() => createSession()}>
              <Plus /> פרויקט חדש
            </Button>
          </div>

          {sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-xl px-6 py-20 text-center shadow-[inset_0_0_0_1px_var(--border)]">
              <div className="flex size-11 items-center justify-center rounded-lg bg-raised text-muted-foreground">
                <Presentation className="size-5" />
              </div>
              <div>
                <div className="text-[15px] font-semibold">עוד אין פרויקטים</div>
                <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                  צור פרויקט והוסף אליו מצגות, קבצי PDF, סרטונים ושקופיות.
                </p>
              </div>
              <Button onClick={() => createSession()}>
                <Plus /> פרויקט חדש
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-5 gap-y-6">
              {list.map((s, i) => (
                <ProjectCard key={s.id} s={s} index={i} onDelete={async () => {
                    const ok = await confirmAction({
                      title: `למחוק את "${s.name}"?`,
                      description: "הפרויקט יימחק מהמחשב ומהענן.",
                      confirmLabel: "מחיקת פרויקט",
                    });
                    if (ok) await deleteSession(s.id, { stayHome: true });
                  }} />
              ))}
            </div>
          )}
          {sessions.length > 0 && list.length === 0 && (
            <p className="py-10 text-center text-[13px] text-muted-foreground">לא נמצאו פרויקטים בשם "{q}"</p>
          )}
        </div>
      </main>

    </div>
  );
}
