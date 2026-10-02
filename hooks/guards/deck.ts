// Which `.typ` is a slide deck: one predicate shared by writing-prose-check (profile selection),
// overflow-check, and the typst-convention guard, node-free so the plugin's mod can use it. It must
// mean the same thing as `is_deck` in scripts/prose-audit.py (tests/prose-engine-wiring.test.ts).

const DECK_MARKERS = ["touying", "polylux", "#slide("];
const DECK_DIR_RE = /^(slides|presentation)/i;

/** pathlib's `.parts`: absolute paths carry a leading "/" element. */
export function pyParts(p: string): string[] {
  const parts: string[] = [];
  if (p.startsWith("/")) parts.push("/");
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    parts.push(seg);
  }
  return parts;
}
export function pyName(p: string): string {
  const parts = pyParts(p);
  const last = parts[parts.length - 1];
  return last === undefined || last === "/" ? "" : last;
}
export function pySuffix(p: string): string {
  const name = pyName(p);
  if (name === "" || name === "." || name === "..") return "";
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i) : "";
}

/**
 * A `.typ` under a `slides*`/`presentation*` directory, or one whose text carries a deck marker.
 * `text` is called only when the path does not settle it; null means unreadable (not a deck).
 * ONLY A `.typ` CAN BE A DECK, so the predicate is total, as `is_deck` is.
 */
export function isTypDeckWith(path: string, text: () => string | null): boolean {
  if (pySuffix(path).toLowerCase() !== ".typ") return false;
  const parts = pyParts(path);
  for (const part of parts.slice(0, -1)) {
    if (DECK_DIR_RE.test(part)) return true;
  }
  const t = text();
  return t !== null && DECK_MARKERS.some((marker) => t.includes(marker));
}
