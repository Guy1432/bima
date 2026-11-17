import { Component, type ReactNode } from "react";

/**
 * Last line of defence: if any component throws, show a readable message with a reload
 * button instead of an empty black window. The projector window shows plain black (the
 * audience must never see an error).
 */
export class ErrorBoundary extends Component<{ children: ReactNode; silent?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Bima crashed:", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.silent) return <div className="fixed inset-0 bg-black" />;
    return (
      <div dir="rtl" className="flex h-full items-center justify-center p-8">
        <div className="flex max-w-lg flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-2xl">
          <div className="text-lg font-semibold">אירעה שגיאה בתצוגה</div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            הנתונים שמורים. טעינה מחדש תחזיר את המסך לפעולה.
          </p>
          <pre dir="ltr" className="max-h-40 overflow-auto rounded-lg bg-background p-3 text-left text-[11px] text-red-300 select-text">
            {String(error?.message ?? error)}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={() => location.reload()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              טעינה מחדש
            </button>
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              המשך
            </button>
          </div>
        </div>
      </div>
    );
  }
}
