// Machine-hygiene decisions (automations/monitoring.py hygiene_card) carry a
// long inventory in their context. The panel shows one summary line, such as
// "cloudroom2: 6 unused images, 705 MB", and keeps the rest for a collapsed
// details block.
import type { Decision } from "./board";

export type HygieneKind = "image" | "virtualenv" | "browser";

export interface HygieneSummary {
  machine: string;
  summary: string;
  items: { name: string; kind: HygieneKind; size: string }[];
  /** The context without its inventory list: week, total, policy and scan notes. */
  details: string;
}

const HEADER = /^\S+: (\d+) verified unused candidates?, (\d+) bytes\b/;
const ITEM = /(\S+) \((\d+) bytes\)/g;
const NOUNS: Record<HygieneKind, [string, string]> = {
  image: ["image", "images"],
  virtualenv: ["virtualenv", "virtualenvs"],
  browser: ["browser", "browsers"],
};

/** Decimal units, as Docker reports sizes. */
export function formatBytes(bytes: number): string {
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit >= 3 && value < 10 ? 1 : 0;
  return `${Number(value.toFixed(digits))} ${units[unit]}`;
}

function kindOf(name: string): HygieneKind {
  if (name.startsWith("sha256:")) return "image";
  if (name.includes("/ms-playwright/")) return "browser";
  return "virtualenv";
}

function noun(kind: HygieneKind, count: number): string {
  return NOUNS[kind][count === 1 ? 0 : 1];
}

export function isHygieneDecision(decision: Decision): boolean {
  return decision.tag === "machine-hygiene" || decision.id.startsWith("machine-hygiene-");
}

/** The summary, or null when this is not a hygiene card or its context is not in the expected form. */
export function hygieneSummary(decision: Decision): HygieneSummary | null {
  if (!isHygieneDecision(decision) || decision.context === null) return null;
  const header = HEADER.exec(decision.context);
  if (!header) return null;
  const total = Number(header[1]);
  const bytes = Number(header[2]);
  const machine = decision.title.replace(/^Machine hygiene:\s*/i, "").trim() || decision.id.replace(/^machine-hygiene-/, "");

  const matches = [...decision.context.matchAll(ITEM)];
  const items = matches.map((match) => ({ name: match[1]!, kind: kindOf(match[1]!), size: formatBytes(Number(match[2])) }));
  const details = (matches[0] ? decision.context.slice(0, matches[0].index) : decision.context).trim();

  // Name the kinds only when the (possibly clipped) context lists every candidate.
  let what = `${total} unused ${total === 1 ? "item" : "items"}`;
  if (items.length === total && total > 0) {
    const counts = new Map<HygieneKind, number>();
    for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    if (counts.size === 1) {
      what = `${total} unused ${noun(items[0]!.kind, total)}`;
    } else {
      const parts = [...counts].map(([kind, n]) => `${n} ${noun(kind, n)}`);
      what = `${what} (${parts.join(", ")})`;
    }
  }
  return { machine, summary: `${machine}: ${what}, ${formatBytes(bytes)}`, items, details };
}
