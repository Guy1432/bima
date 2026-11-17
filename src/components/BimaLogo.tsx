import { useId } from "react";
import { cn } from "@/lib/utils";

/** Brand colours of the mark - fixed, identical to the Windows app icon (app-icon.svg). */
export const BRAND_TOP = "#7a76f5";
export const BRAND_BOTTOM = "#5d58e6";

/**
 * The Bima mark: a stage (במה) with a beam of light landing on it - the platform and the
 * projection in one shape. Drawn on a 32-unit grid so it stays crisp at 16-24 px.
 * Always in the brand colours (never the operator's accent theme), so it matches the icon
 * Windows shows in the taskbar and title bar.
 */
export function BimaMark({ className, title = "בימה" }: { className?: string; title?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={cn("size-6 shrink-0", className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={BRAND_TOP} />
          <stop offset="1" stopColor={BRAND_BOTTOM} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.25" fill={`url(#${id})`} />
      {/* beam */}
      <path d="M13.2 6h5.6l5.4 14H7.8z" fill="#fff" fillOpacity="0.38" />
      {/* light source */}
      <rect x="12.4" y="4.6" width="7.2" height="2.6" rx="1.3" fill="#fff" />
      {/* stage */}
      <rect x="5.5" y="21" width="21" height="4.6" rx="1.6" fill="#fff" />
    </svg>
  );
}

/** Mark + wordmark, for headers. */
export function BimaLogo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <BimaMark className={markClassName} />
      <span className="text-[14px] font-semibold tracking-tight" translate="no">
        בימה
      </span>
    </span>
  );
}
