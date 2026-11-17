import { useEffect, useMemo, useRef, useState } from "react";
import { EV, useTauriEvent } from "@/lib/events";
import { FX_DURATION, playSfx, stopSfx, type FxKind } from "@/lib/sfx";

export interface FxEvent {
  id: string;
  type: FxKind;
  sound: boolean;
  volume: number;
}

const COLORS = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#fde047", "#ffffff"];

/* ------------------------------------------------------------------ canvas particles */

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  w: number;
  h: number;
  c: string;
  kind: "paper" | "heart" | "spark";
  life: number;
  born: number;
}

function runCanvas(canvas: HTMLCanvasElement, type: FxKind) {
  const ctx = canvas.getContext("2d")!;
  const W = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const H = (canvas.height = canvas.clientHeight * devicePixelRatio);
  const ps: P[] = [];
  const g = H * 0.00045;

  const paperBurst = (n: number, t0: number) => {
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      ps.push({
        x: left ? 0 : W,
        y: H * (0.55 + Math.random() * 0.3),
        vx: (left ? 1 : -1) * W * (0.006 + Math.random() * 0.012),
        vy: -H * (0.012 + Math.random() * 0.018),
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        w: W * (0.005 + Math.random() * 0.006),
        h: W * (0.008 + Math.random() * 0.01),
        c: COLORS[i % COLORS.length],
        kind: "paper",
        life: 99,
        born: t0,
      });
    }
  };

  if (type === "confetti") paperBurst(240, 0);
  if (type === "tada") paperBurst(160, 0.2);
  if (type === "hearts")
    for (let i = 0; i < 70; i++)
      ps.push({
        x: Math.random() * W,
        y: H + Math.random() * H * 0.3,
        vx: (Math.random() - 0.5) * W * 0.0015,
        vy: -(H * (0.006 + Math.random() * 0.006)),
        r: 0,
        vr: 0,
        w: W * (0.012 + Math.random() * 0.016),
        h: 0,
        c: ["#f43f5e", "#ec4899", "#fb7185", "#ffffff"][i % 4],
        kind: "heart",
        life: 99,
        born: 0,
      });

  // fireworks: 5 shells, timing matches the sound (whistle 0.45s → boom)
  const shells =
    type === "fireworks"
      ? Array.from({ length: 5 }, (_, i) => ({
          t: i * 0.42 + 0.45,
          x: W * (0.2 + Math.random() * 0.6),
          y: H * (0.18 + Math.random() * 0.3),
          c: COLORS[i % 5],
          done: false,
        }))
      : [];

  const drawHeart = (x: number, y: number, s: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s / 2, y, x - s / 2, y + s * 0.3);
    ctx.bezierCurveTo(x - s / 2, y + s * 0.6, x, y + s * 0.8, x, y + s);
    ctx.bezierCurveTo(x, y + s * 0.8, x + s / 2, y + s * 0.6, x + s / 2, y + s * 0.3);
    ctx.bezierCurveTo(x + s / 2, y, x, y, x, y + s * 0.3);
    ctx.fill();
  };

  const total = FX_DURATION[type] / 1000;
  let raf = 0;
  let stopped = false;
  const start = performance.now();
  const tick = (now: number) => {
    const age = (now - start) / 1000;
    for (const s of shells)
      if (!s.done && age >= s.t) {
        s.done = true;
        for (let k = 0; k < 90; k++) {
          const a = (k / 90) * Math.PI * 2;
          const sp = W * (0.002 + Math.random() * 0.004);
          ps.push({ x: s.x, y: s.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 0, vr: 0, w: W * 0.0025, h: 0, c: s.c, kind: "spark", life: 1.3 + Math.random() * 0.5, born: age });
        }
      }

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    for (const s of shells)
      if (!s.done && age > s.t - 0.45) {
        // rising rocket
        const p = (age - (s.t - 0.45)) / 0.45;
        ctx.fillStyle = "rgba(255,240,200,0.9)";
        ctx.beginPath();
        ctx.arc(s.x, H - (H - s.y) * p, W * 0.002, 0, 7);
        ctx.fill();
      }

    for (const p of ps) {
      if (age < p.born) continue;
      const alpha = p.kind === "spark" ? Math.max(0, 1 - (age - p.born) / p.life) : Math.max(0, Math.min(1, total - age));
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.c;
      if (p.kind === "heart") {
        p.x += p.vx + Math.sin(age * 3 + p.w) * W * 0.0008;
        p.y += p.vy;
        drawHeart(p.x, p.y, p.w);
      } else if (p.kind === "spark") {
        p.vy += g * 0.25;
        p.vx *= 0.975;
        p.vy *= 0.975;
        p.x += p.vx;
        p.y += p.vy;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.w, 0, 7);
        ctx.fill();
      } else {
        p.vy += g;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    if (age < total && !stopped) raf = requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, W, H);
  };
  raf = requestAnimationFrame(tick);
  // stopping (a new effect, or unmount) must leave a clean canvas - no frozen confetti
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, W, H);
  };
}

/* ------------------------------------------------------------------ DOM moments */

function Applause() {
  const hands = useMemo(
    () =>
      Array.from({ length: 34 }, () => ({
        left: 4 + Math.random() * 92,
        delay: Math.random() * 1.4,
        size: 3.5 + Math.random() * 4,
        dur: 1.8 + Math.random() * 1.1,
        drift: (Math.random() - 0.5) * 8,
      })),
    [],
  );
  return (
    <>
      {hands.map((h, i) => (
        <span
          key={i}
          className="fx-rise absolute bottom-0"
          style={{
            left: `${h.left}%`,
            fontSize: `${h.size}cqw`,
            animationDelay: `${h.delay}s`,
            animationDuration: `${h.dur}s`,
            ["--drift" as string]: `${h.drift}cqw`,
          }}
        >
          👏
        </span>
      ))}
    </>
  );
}

function Drumroll() {
  return (
    <>
      <div className="fx-vignette absolute inset-0" />
      <div className="absolute inset-x-0 bottom-[6cqw] flex justify-center">
        <div className="fx-drum relative text-[15cqw] leading-none">
          🥁
          <span className="fx-hit" />
        </div>
      </div>
    </>
  );
}

function Tada() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="fx-rays absolute size-[70cqw] rounded-full" />
      <div className="fx-pop text-[16cqw] leading-none">🎉</div>
    </div>
  );
}

function Verdict({ ok }: { ok: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        className={ok ? "fx-pop" : "fx-pop fx-shake"}
        style={{
          width: "24cqw",
          height: "24cqw",
          borderRadius: "50%",
          background: ok ? "#16a34a" : "#dc2626",
          boxShadow: `0 0 0 1.4cqw ${ok ? "rgba(22,163,74,0.25)" : "rgba(220,38,38,0.25)"}, 0 2cqw 6cqw rgba(0,0,0,0.5)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg viewBox="0 0 100 100" width="62%" height="62%" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round">
          {ok ? (
            <path className="fx-draw" d="M22 52 L42 72 L80 30" pathLength={1} />
          ) : (
            <>
              <path className="fx-draw" d="M28 28 L72 72" pathLength={1} />
              <path className="fx-draw" style={{ animationDelay: "120ms" }} d="M72 28 L28 72" pathLength={1} />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

/** "Wow moments" on the audience screen. Only the master stage makes sound. */
export function Effects({ master }: { master: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fx, setFx] = useState<FxEvent | null>(null);
  const [visible, setVisible] = useState(false);
  useTauriEvent<FxEvent>(EV.fx, setFx);

  useEffect(() => {
    if (!fx) return;
    // one moment at a time: the previous effect's cleanup already cleared canvas + DOM
    if (master && fx.sound) playSfx(fx.type, fx.volume);
    else if (master) stopSfx();
    setVisible(true);
    const stopCanvas = ["confetti", "hearts", "tada", "fireworks"].includes(fx.type) ? runCanvas(ref.current!, fx.type) : undefined;
    const t = setTimeout(() => setVisible(false), FX_DURATION[fx.type]);
    return () => {
      stopCanvas?.();
      clearTimeout(t);
      setVisible(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
      {visible && fx && (
        <div key={fx.id} className="fx-fadeout absolute inset-0" style={{ animationDelay: `${FX_DURATION[fx.type] - 450}ms` }}>
          {fx.type === "applause" && <Applause />}
          {fx.type === "drumroll" && <Drumroll />}
          {fx.type === "tada" && <Tada />}
          {fx.type === "correct" && <Verdict ok />}
          {fx.type === "wrong" && <Verdict ok={false} />}
        </div>
      )}
    </div>
  );
}
