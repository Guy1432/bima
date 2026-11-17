import { useEffect, useRef, useState } from "react";
import { confirmAction } from "@/components/ConfirmHost";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Check, Cloud, CloudOff, Loader2, LogOut, Mail, MailCheck, RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { sendLink, signOut, useCloud, verifyCode } from "@/lib/cloud";
import { cn } from "@/lib/utils";
import { isValidEmail, suggestEmail } from "@/lib/emailTypo";

function ago(ms: number) {
  if (!ms) return "";
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "עכשיו";
  if (s < 3600) return `לפני ${Math.floor(s / 60)} דק׳`;
  return new Date(ms).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

const LAST_EMAIL = "bima-cloud-email";

/** Email → link (clicked on this computer signs in by itself). A 6-digit code works too,
 *  if the email carries one. No passwords to remember. */
export function SignIn({ compact, bare }: { compact?: boolean; bare?: boolean }) {
  const [step, setStep] = useState<"email" | "wait">("email");
  const [email, setEmail] = useState(() => localStorage.getItem(LAST_EMAIL) ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step !== "email") codeRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const un = listen<string>("cloud-signin-error", (e) => setError(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const [typoOk, setTypoOk] = useState("");
  const typo = typoOk === email ? null : suggestEmail(email);
  const send = async () => {
    if (!isValidEmail(email)) {
      setError("כתובת המייל לא תקינה");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await sendLink(email);
      localStorage.setItem(LAST_EMAIL, email.trim());
      setStep("wait");
      setCode("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (c = code) => {
    if (c.replace(/\D/g, "").length < 6) return;
    setBusy(true);
    setError("");
    try {
      const a = await verifyCode(email, c);
      toast.success(`מחובר כ-${a.email}`);
    } catch (e) {
      setError(String(e));
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-3", !bare && "rounded-lg bg-raised p-4 shadow-[inset_0_0_0_1px_var(--border)]", !bare && compact && "p-3.5")}>
      {bare ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          {step === "wait" ? <MailCheck className="size-4 shrink-0 text-primary-text" /> : <Mail className="size-4 shrink-0" />}
          <span className="leading-relaxed">
            {step === "email" ? (
              "קוד כניסה יישלח למייל."
            ) : (
              <>
                קוד נשלח אל <b dir="ltr" className="text-foreground">{email.trim()}</b>.
              </>
            )}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
            {step === "wait" ? <MailCheck className="size-4 text-primary-text" /> : <Cloud className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">{step === "wait" ? "קוד נשלח" : "בימה בענן"}</div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
              {step === "email" && "סנכרון הפרויקטים בין המחשבים שלך."}
              {step !== "email" && (
                <>
                  קוד נשלח אל <b dir="ltr">{email.trim()}</b>.
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {step === "email" && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input
            dir="ltr"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 text-right"
          />
          <Button type="submit" disabled={busy || !email.includes("@") || !!typo}>
            {busy ? <Loader2 className="animate-spin" /> : <Mail />} התחברות
          </Button>
        </form>
      )}
      {step === "email" && typo && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-100">
          <TriangleAlert className="size-3.5 shrink-0 text-amber-400" />
          <span>
            התכוונת ל-<b dir="ltr">{typo}</b>?
          </span>
          <Button size="sm" variant="secondary" className="h-6 text-[11px]" onClick={() => setEmail(typo)}>
            תיקון
          </Button>
          <button className="text-[11px] text-amber-200/70 hover:text-amber-100" onClick={() => setTypoOk(email)}>
            הכתובת נכונה
          </button>
        </div>
      )}

      {step !== "email" && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <Input
            ref={codeRef}
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
            maxLength={8}
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "");
              setCode(v);
              if (v.length === 6) void verify(v);
            }}
            className="flex-1 text-center font-mono text-lg tracking-[0.5em]"
          />
          <Button type="submit" disabled={busy || code.length < 6}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} כניסה
          </Button>
        </form>
      )}

      {error && <div className="text-xs text-red-400">{error}</div>}

      {step !== "email" && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <button className="hover:text-foreground" disabled={busy} onClick={() => void send()}>
            שליחת קוד חדש
          </button>
          <button className="hover:text-foreground" onClick={() => setStep("email")}>
            שינוי כתובת
          </button>
        </div>
      )}
    </div>
  );
}

/** Cloud account + sync status (settings). Sign-out is destructive → red + confirm. */
export function CloudAccountCard({ compact }: { compact?: boolean }) {
  const { signedIn, account, sync, live } = useCloud();

  if (!signedIn) return <SignIn compact={compact} />;

  const icon =
    sync.state === "syncing" ? (
      <Loader2 className="size-3.5 animate-spin text-primary-text" />
    ) : sync.state === "offline" ? (
      <WifiOff className="size-3.5 text-amber-400" />
    ) : sync.state === "error" ? (
      <TriangleAlert className="size-3.5 text-red-400" />
    ) : (
      <Check className="size-3.5 text-emerald-400" />
    );
  const pct = sync.progress && sync.progress[1] ? (sync.progress[0] / sync.progress[1]) * 100 : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-raised p-3.5 shadow-[inset_0_0_0_1px_var(--border)]">
      <div className="flex items-center gap-3">
        <div className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-bold">
          {(account?.email?.[0] ?? "B").toUpperCase()}
          {live && <span className="absolute -bottom-0.5 -left-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-raised" title="מחובר" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">בימה בענן</div>
          <div className="truncate text-right text-[12px] text-muted-foreground" dir="ltr">
            {account?.email}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => invoke("cloud_sync_now")} disabled={sync.state === "syncing"}>
          <RefreshCw className={cn(sync.state === "syncing" && "animate-spin")} /> סנכרון
        </Button>
      </div>
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground" aria-live="polite">
        {icon}
        <span className="min-w-0 flex-1 truncate">
          {sync.state === "idle" ? `הכל מסונכרן${sync.lastSync ? ` · ${ago(sync.lastSync)}` : ""}` : sync.message || "מתחבר…"}
        </span>
        <button
          onClick={async () => {
            const ok = await confirmAction({
              title: "להתנתק מבימה בענן?",
              description: "הפרויקטים יישארו במחשב. הסנכרון ייפסק עד להתחברות מחדש.",
              confirmLabel: "התנתקות",
            });
            if (!ok) return;
            await signOut();
            toast("התנתקת מבימה בענן");
          }}
          className="flex items-center gap-1 rounded px-1 text-[12px] text-red-400 hover:bg-red-500/10 hover:text-red-300"
        >
          <LogOut className="size-3.5" /> התנתקות…
        </button>
      </div>
      {pct !== null && (
        <div className="h-1 overflow-hidden rounded-full bg-accent">
          <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** Small status for headers. */
export function CloudBadge() {
  const { signedIn, sync } = useCloud();
  if (!signedIn) return null;
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title={sync.message}>
      {sync.state === "syncing" ? (
        <Loader2 className="size-3 animate-spin text-primary-text" />
      ) : sync.state === "offline" ? (
        <WifiOff className="size-3.5 text-amber-400" />
      ) : sync.state === "error" ? (
        <CloudOff className="size-3.5 text-red-400" />
      ) : (
        <Check className="size-3.5 text-emerald-400" />
      )}
      {sync.state === "syncing" ? "מסנכרן…" : sync.state === "offline" ? "לא מקוון" : sync.state === "error" ? "שגיאת סנכרון" : "בענן"}
    </span>
  );
}
