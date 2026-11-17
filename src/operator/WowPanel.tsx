import { useEffect, useState } from "react";
import { CircleCheck, CircleX, Drum, Hand, Heart, PartyPopper, Sparkles, Trophy, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { Keys, Slider, Tip } from "@/components/ui/primitives";
import type { FxEvent } from "@/components/stage/Effects";
import { EV, send } from "@/lib/events";
import { useSettings } from "@/lib/settings";
import { FX_DURATION, type FxKind } from "@/lib/sfx";
import { cn, uid } from "@/lib/utils";

export const WOWS: { id: FxKind; icon: LucideIcon; label: string; tint: string }[] = [
  { id: "confetti", icon: PartyPopper, label: "קונפטי", tint: "#b48cff" },
  { id: "drumroll", icon: Drum, label: "תופים", tint: "#f2b24c" },
  { id: "applause", icon: Hand, label: "כפיים", tint: "#f5cf5a" },
  { id: "tada", icon: Trophy, label: "טה-דה", tint: "#f59a4a" },
  { id: "correct", icon: CircleCheck, label: "נכון", tint: "#4cc98a" },
  { id: "wrong", icon: CircleX, label: "טעות", tint: "#f06a6a" },
  { id: "hearts", icon: Heart, label: "לבבות", tint: "#f07ab4" },
  { id: "fireworks", icon: Sparkles, label: "זיקוקים", tint: "#6aa7ff" },
];

let lastFx: { id: FxKind; at: number } | null = null;
const listeners = new Set<() => void>();

export function fireFx(type: FxKind) {
  const { fxSound, fxVolume } = useSettings.getState();
  send<FxEvent>(EV.fx, { id: uid(), type, sound: fxSound, volume: fxVolume });
  lastFx = { id: type, at: performance.now() };
  listeners.forEach((l) => l());
}

function useRunning() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return lastFx;
}

/** Grid of "wow moment" buttons: effect + synthesised sound on the audience screen. */
export function WowGrid({ big }: { big?: boolean }) {
  const running = useRunning();
  const fxSound = useSettings((s) => s.fxSound);
  const fxVolume = useSettings((s) => s.fxVolume);
  const set = useSettings((s) => s.set);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-1.5">
        {WOWS.map((w, i) => {
          const active = running?.id === w.id && performance.now() - running.at < FX_DURATION[w.id];
          return (
            <Tip key={w.id} content={<span className="flex items-center gap-2">{w.label} <Keys combo={["Shift", String(i + 1)]} /></span>}>
              <button
                onClick={() => fireFx(w.id)}
                className={cn(
                  "pressable group relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-md bg-raised shadow-[inset_0_0_0_1px_var(--border)] hover:bg-accent",
                  big ? "h-16" : "h-[52px]",
                )}
                style={{ ["--tint" as string]: w.tint }}
              >
                <w.icon
                  className={cn("", big ? "size-5" : "size-[18px]")}
                  style={{ color: w.tint }}
                  strokeWidth={1.75}
                />
                <span className="text-[11px] font-medium text-muted-foreground group-hover:text-foreground">{w.label}</span>
                {active && (
                  <span
                    key={running!.at}
                    className="absolute inset-x-0 bottom-0 h-0.5 origin-right bg-[var(--tint)]"
                    style={{ animation: `wow-progress ${FX_DURATION[w.id]}ms linear forwards` }}
                  />
                )}
              </button>
            </Tip>
          );
        })}
      </div>
      <div className="flex items-center gap-2 px-0.5">
        <Tip content={fxSound ? "השתקת צלילים" : "הפעלת צלילים"}>
          <button
            onClick={() => set({ fxSound: !fxSound })}
            className={cn("pressable flex size-7 items-center justify-center rounded-md [&_svg]:size-3.5", fxSound ? "text-foreground" : "text-muted-foreground")}
            aria-label={fxSound ? "השתקת צלילים" : "הפעלת צלילים"}
          >
            {fxSound ? <Volume2 /> : <VolumeX />}
          </button>
        </Tip>
        <Slider
          dir="ltr"
          min={0}
          max={1}
          step={0.05}
          disabled={!fxSound}
          value={[fxVolume]}
          onValueChange={([v]) => set({ fxVolume: v })}
          className={cn("flex-1", !fxSound && "opacity-40")}
        />
        <span className="w-8 text-left text-[11px] text-muted-foreground tabular">{Math.round(fxVolume * 100)}%</span>
      </div>
    </div>
  );
}
