import { useEffect, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import { clampWeight, fontStack } from "@/lib/fonts";
import { withTextDefaults, type TextBlock, type TextSlideData } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";
import { mediaUrl } from "@/lib/media";

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

function useQr(text: string, fg: string, enabled: boolean) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    if (!enabled || !text.trim()) return setSvg("");
    let alive = true;
    QRCode.toString(text.trim(), { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: fg, light: "#0000" } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(""));
    return () => {
      alive = false;
    };
  }, [text, fg, enabled]);
  return svg;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const isDrawn = (b: TextBlock) => b.kind === "shape" || b.kind === "ink";

/** Position + type of a block on a canvas `ch` px high (1920 wide). */
export function blockStyle(b: TextBlock, ch = CANVAS_H): CSSProperties {
  const base: CSSProperties = {
    left: b.x * CANVAS_W,
    top: b.y * ch,
    width: b.w * CANVAS_W,
    opacity: b.opacity,
  };
  if (isDrawn(b)) return { ...base, height: (b.h ?? 0) * ch };
  return {
    ...base,
    fontFamily: fontStack(b.font),
    fontWeight: clampWeight(b.font, b.weight),
    fontSize: b.size,
    color: b.color,
    textAlign: b.align,
    lineHeight: b.lineHeight,
    letterSpacing: `${b.letterSpacing}em`,
  };
}

/** Smooth path through freehand points (quadratic curves via the midpoints). */
function inkPath(pts: [number, number][]) {
  if (!pts.length) return "";
  if (pts.length < 3)
    return `M${pts[0][0]},${pts[0][1]} ` + pts.slice(1).map((p) => `L${p[0]},${p[1]}`).join(" ") + (pts.length === 1 ? " l0.01,0" : "");
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0]},${pts[i][1]} ${mx},${my}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last[0]},${last[1]}`;
}

/** Rect / ellipse / line / arrow / ink, drawn in the block's box. `hit` adds fat invisible
 *  strokes so thin lines are easy to grab in the editor. */
export function ShapeSvg({ b, ch = CANVAS_H, hit = false }: { b: TextBlock; ch?: number; hit?: boolean }) {
  const w = b.w * CANVAS_W;
  const h = (b.h ?? 0) * ch;
  const sw = b.stroke ?? 8;
  const stroke = sw > 0 ? b.color : "none";
  const pe = hit ? ("stroke" as const) : ("none" as const);
  const box: CSSProperties = { position: "absolute", left: 0, top: 0, width: Math.max(w, 1), height: Math.max(h, 1), overflow: "visible" };
  const raw = b.points ?? [0, 0, 1, 1];
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) pts.push([raw[i] * w, raw[i + 1] * h]);
  const hitW = Math.max(sw, 6) + 24;

  if (b.kind === "ink") {
    const d = inkPath(pts);
    return (
      <svg style={box} aria-hidden>
        {hit && <path d={d} fill="none" stroke="transparent" strokeWidth={hitW} strokeLinecap="round" strokeLinejoin="round" pointerEvents={pe} />}
        <path d={d} fill="none" stroke={b.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
      </svg>
    );
  }
  if (b.shape === "line" || b.shape === "arrow") {
    const [[x1, y1], [x2, y2]] = pts.length >= 2 ? pts : [[0, 0], [w, h]];
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const L = b.shape === "arrow" ? Math.max(sw * 4, 30) : 0;
    // stop the shaft inside the head so the tip stays sharp
    const ex = x2 - Math.cos(ang) * L * 0.7;
    const ey = y2 - Math.sin(ang) * L * 0.7;
    const head =
      b.shape === "arrow"
        ? [
            [x2, y2],
            [x2 - Math.cos(ang - 0.45) * L, y2 - Math.sin(ang - 0.45) * L],
            [x2 - Math.cos(ang + 0.45) * L, y2 - Math.sin(ang + 0.45) * L],
          ]
        : null;
    return (
      <svg style={box} aria-hidden>
        {hit && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={hitW} strokeLinecap="round" pointerEvents={pe} />}
        <line x1={x1} y1={y1} x2={head ? ex : x2} y2={head ? ey : y2} stroke={b.color} strokeWidth={Math.max(sw, 1)} strokeLinecap="round" pointerEvents="none" />
        {head && (
          <polygon
            points={head.map((p) => p.join(",")).join(" ")}
            fill={b.color}
            stroke={b.color}
            strokeWidth={Math.max(1, sw * 0.4)}
            strokeLinejoin="round"
            pointerEvents="none"
          />
        )}
      </svg>
    );
  }
  const inset = sw / 2;
  const iw = Math.max(0, w - sw);
  const ih = Math.max(0, h - sw);
  return (
    <svg style={box} aria-hidden>
      {b.shape === "ellipse" ? (
        <ellipse cx={w / 2} cy={h / 2} rx={iw / 2} ry={ih / 2} fill={b.fill ?? "none"} stroke={stroke} strokeWidth={sw} />
      ) : (
        <rect x={inset} y={inset} width={iw} height={ih} rx={Math.min(b.radius ?? 0, iw / 2, ih / 2)} fill={b.fill ?? "none"} stroke={stroke} strokeWidth={sw} />
      )}
    </svg>
  );
}

/** Content of a free-layout block: image, shape, ink or (highlighted) text. */
export function BlockContent({ b, ch = CANVAS_H }: { b: TextBlock; ch?: number }) {
  if (isDrawn(b)) return <ShapeSvg b={b} ch={ch} />;
  if (b.kind === "image" && b.file)
    return (
      <img
        src={mediaUrl(b.file)}
        draggable={false}
        alt=""
        className="block h-auto w-full select-none"
        style={{ borderRadius: b.radius ?? 0 }}
      />
    );
  return <BlockText b={b} />;
}

/** Annotations over a page: the same blocks, on a canvas with the page's own proportions. */
export function OverlayView({ blocks, width, aspect }: { blocks: TextBlock[]; width: number; aspect: number }) {
  const ch = CANVAS_W / aspect;
  return (
    <div
      dir="rtl"
      className="pointer-events-none absolute top-0 left-0"
      style={{ width: CANVAS_W, height: ch, transform: `scale(${width / CANVAS_W})`, transformOrigin: "top left" }}
    >
      {blocks.map((b) => (
        <div key={b.id} className="absolute whitespace-pre-wrap break-words" style={blockStyle(b, ch)}>
          <BlockContent b={b} ch={ch} />
        </div>
      ))}
    </div>
  );
}

export function BlockText({ b }: { b: TextBlock }) {
  return b.highlight ? (
    <span
      style={{
        background: b.highlight,
        padding: "0.08em 0.3em",
        boxDecorationBreak: "clone",
        WebkitBoxDecorationBreak: "clone",
        borderRadius: "0.12em",
      }}
    >
      {b.text}
    </span>
  ) : (
    <>{b.text}</>
  );
}

/** Renders a text slide on a fixed 1920×1080 canvas, scaled to `width`. */
export function TextSlideView({
  data: raw,
  width,
  startedAt,
  running = false,
  hideBlocks = false,
}: {
  data: TextSlideData;
  width: number;
  startedAt?: number;
  running?: boolean;
  /** editor draws its own interactive blocks */
  hideBlocks?: boolean;
}) {
  const d = withTextDefaults(raw);
  const scale = width / CANVAS_W;
  const fs = (px: number) => px * d.fontScale;
  const center = d.align === "center";
  const isTimer = d.template === "timer";
  const now = useNow(isTimer && running);
  const total = Math.max(0, d.timerMinutes * 60);
  const elapsed = isTimer && running && startedAt ? (now - startedAt) / 1000 : 0;
  const remaining = Math.max(0, total - elapsed);
  const bullets = d.body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const heading: CSSProperties = {
    fontFamily: fontStack(d.headingFont),
    fontWeight: clampWeight(d.headingFont, d.headingWeight),
    letterSpacing: `${d.letterSpacing}em`,
  };
  const body: CSSProperties = {
    fontFamily: fontStack(d.bodyFont),
    fontWeight: clampWeight(d.bodyFont, d.bodyWeight),
    letterSpacing: `${d.letterSpacing}em`,
  };
  const lh = (base: number) => base * d.lineHeight;
  const qr = useQr(d.body, d.fg, d.template === "qr");

  const accentLine = d.decor === "line" && (
    <div
      style={{
        width: 140,
        height: 10,
        borderRadius: 5,
        background: d.accent,
        margin: center ? "0 auto 48px" : "0 0 48px",
      }}
    />
  );

  return (
    <div
      dir="rtl"
      className="absolute top-0 left-0 overflow-hidden"
      style={{
        width: CANVAS_W,
        height: CANVAS_H,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        background: d.bg,
        color: d.fg,
        fontFamily: fontStack(d.bodyFont),
      }}
    >
      {d.bgImage && (
        <>
          <img src={mediaUrl(d.bgImage)} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${d.bgDim})` }} />
        </>
      )}
      {d.decor === "bar" && <div className="absolute inset-y-0 right-0" style={{ width: 28, background: d.accent }} />}
      {d.decor === "frame" && (
        <div className="absolute" style={{ inset: 48, border: `4px solid ${d.accent}`, borderRadius: 12 }} />
      )}

      {d.template === "custom" ? (
        !hideBlocks &&
        d.blocks.map((b) => (
          <div key={b.id} className="absolute whitespace-pre-wrap break-words" style={blockStyle(b)}>
            <BlockContent b={b} />
          </div>
        ))
      ) : (
        <div
          className={cn("flex h-full w-full flex-col justify-center", center ? "items-center text-center" : "items-start text-right")}
          style={{ padding: d.decor === "bar" ? "120px 200px 120px 150px" : "120px 160px" }}
        >
          {d.template === "title" && (
            <div className="w-full">
              {accentLine}
              <h1 style={{ ...heading, fontSize: fs(128), lineHeight: lh(1.1) }}>{d.title}</h1>
              {d.subtitle && (
                <p style={{ ...body, fontSize: fs(56), marginTop: 36, opacity: 0.72, lineHeight: lh(1.3) }}>{d.subtitle}</p>
              )}
            </div>
          )}

          {d.template === "bullets" && (
            <div className="flex h-full w-full flex-col justify-start">
              <h2
                style={{
                  ...heading,
                  fontSize: fs(92),
                  lineHeight: lh(1.15),
                  paddingBottom: 36,
                  marginBottom: 56,
                  borderBottom: `4px solid ${d.decor === "line" ? d.accent : d.fg + "22"}`,
                }}
              >
                {d.title}
              </h2>
              <ul className={cn("flex flex-col", center ? "items-center" : "items-start")} style={{ gap: fs(30) }}>
                {bullets.map((b, i) => (
                  <li key={i} className="flex items-baseline" style={{ ...body, fontSize: fs(58), lineHeight: lh(1.35), gap: 32 }}>
                    <span
                      className="inline-block shrink-0 rounded-[4px]"
                      style={{ width: fs(18), height: fs(18), background: d.accent, transform: `translateY(-${fs(10)}px)` }}
                    />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {d.template === "quote" && (
            <div className="w-full">
              <div style={{ fontSize: fs(240), lineHeight: 0.6, color: d.accent, fontFamily: "Georgia, serif" }}>”</div>
              <blockquote style={{ ...heading, fontSize: fs(84), lineHeight: lh(1.3), maxWidth: 1500, margin: center ? "0 auto" : 0 }}>
                {d.title}
              </blockquote>
              {d.subtitle && <p style={{ ...body, fontSize: fs(44), marginTop: 48, opacity: 0.6 }}>- {d.subtitle}</p>}
            </div>
          )}

          {d.template === "timer" && (
            <div className="flex w-full flex-col items-center text-center">
              {d.title && <h2 style={{ ...heading, fontSize: fs(84), opacity: 0.9 }}>{d.title}</h2>}
              <div
                className="tabular"
                dir="ltr"
                style={{
                  ...heading,
                  fontSize: fs(320),
                  lineHeight: 1,
                  margin: "40px 0",
                  letterSpacing: "-0.03em",
                  opacity: remaining === 0 && running ? 0.4 : 1,
                }}
              >
                {formatTime(Math.ceil(remaining))}
              </div>
              {d.subtitle && <p style={{ ...body, fontSize: fs(48), opacity: 0.6 }}>{d.subtitle}</p>}
            </div>
          )}

          {d.template === "qr" && (
            <div className="flex w-full items-center justify-center" style={{ gap: 120 }}>
              <div
                className="shrink-0 rounded-[28px]"
                style={{ width: 560 * d.fontScale, height: 560 * d.fontScale, padding: 36, border: `4px solid ${d.accent}` }}
                dangerouslySetInnerHTML={{ __html: qr.replace("<svg", '<svg width="100%" height="100%"') }}
              />
              <div className="flex max-w-[820px] flex-col items-start text-right" style={{ gap: 28 }}>
                <h2 style={{ ...heading, fontSize: fs(96), lineHeight: lh(1.1) }}>{d.title}</h2>
                {d.subtitle && <p style={{ ...body, fontSize: fs(48), opacity: 0.7, lineHeight: lh(1.3) }}>{d.subtitle}</p>}
                <p dir="ltr" style={{ ...body, fontSize: fs(34), opacity: 0.5, wordBreak: "break-all" }}>
                  {d.body.replace(/^https?:\/\//, "")}
                </p>
              </div>
            </div>
          )}

          {d.template === "free" && (
            <div className="w-full whitespace-pre-wrap" style={{ ...body, fontSize: fs(76), lineHeight: lh(1.35) }}>
              {accentLine}
              {d.body || d.title}
            </div>
          )}
        </div>
      )}

      {isTimer && total > 0 && (
        <div className="absolute inset-x-0 bottom-0" style={{ height: 14, background: d.fg + "14" }}>
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, (elapsed / total) * 100)}%`,
              background: d.accent,
              marginInlineStart: 0,
              transition: "width 250ms linear",
            }}
          />
        </div>
      )}
    </div>
  );
}
