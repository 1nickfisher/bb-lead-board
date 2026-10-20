// How fresh the board is, and how long each decision has waited.
import { ageMs, formatAge, isStale, type Board } from "./board";
import { CHECK_STALE_AFTER_MS } from "./config";

const DAY_MS = 24 * 60 * 60_000;

/** "just now", "12 min ago", "3 h ago", "2 d ago"; null when the time is unusable. */
export function formatAgo(iso: string, now: number): string | null {
  const age = ageMs(iso, now);
  if (age === null) return null;
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export interface Freshness {
  /** Header label. */
  label: string;
  /** Show the stale banner. */
  stale: boolean;
  /** Minutes since the time staleness is measured from; null when it is unusable. */
  staleMinutes: number | null;
}

/**
 * Schema 2 measures staleness from checkedAt, which the feed writes on every
 * refresh, so a quiet board is not stale. Schema 1 only has updatedAt.
 */
export function freshness(board: Board, now: number): Freshness {
  if (board.schema === 1) {
    const age = ageMs(board.updatedAt, now);
    return {
      label: formatAge(board.updatedAt, now),
      stale: isStale(board.updatedAt, now),
      staleMinutes: age === null ? null : Math.floor(age / 60_000),
    };
  }
  const checkedAge = board.checkedAt === null ? null : ageMs(board.checkedAt, now);
  const checked = board.checkedAt === null ? null : formatAgo(board.checkedAt, now);
  const changed = formatAgo(board.updatedAt, now);
  return {
    label: `${checked ? `checked ${checked}` : "check time unknown"} · ${changed ? `last change ${changed}` : "last change unknown"}`,
    stale: checkedAge === null || checkedAge > CHECK_STALE_AFTER_MS,
    staleMinutes: checkedAge === null ? null : Math.floor(checkedAge / 60_000),
  };
}

/** "asked 3 h ago"; `old` once a decision has waited over 24 hours. */
export function askedAge(createdAt: string | null, now: number): { label: string; old: boolean } | null {
  if (createdAt === null) return null;
  const ago = formatAgo(createdAt, now);
  const age = ageMs(createdAt, now);
  if (ago === null || age === null) return null;
  return { label: `asked ${ago}`, old: age > DAY_MS };
}
