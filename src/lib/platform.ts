/** macOS shows ⌘ / ⌥ / ⇧ where Windows says Ctrl / Alt / Shift. */
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const MAC_KEYS: Record<string, string> = { Ctrl: "⌘", Alt: "⌥", Shift: "⇧" };

/** A key name as this computer's keyboard labels it. */
export function keyLabel(k: string) {
  return isMac ? (MAC_KEYS[k] ?? k) : k;
}

/** "Ctrl+Z" / "⌘Z" for running text. */
export const UNDO_KEYS = isMac ? "⌘Z" : "Ctrl+Z";
