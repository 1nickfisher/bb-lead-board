import { useEffect, useRef, useState } from "react";
import type { Board } from "@/lib/board";
import { detectNewDecisions } from "@/lib/new-decisions";
import { soundStore } from "./sound";

/** How long a new card stays highlighted. */
export const HIGHLIGHT_MS = 10_000;

/**
 * Watches each board read for decision ids not seen since the panel opened:
 * chimes once for them (unless muted or not yet armed) and returns them for a
 * brief highlight. A null board (a different board loading) starts over, so
 * its first read is a first load again.
 */
export function useNewDecisions(board: Board | null): ReadonlySet<string> {
  const seen = useRef<ReadonlySet<string> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (board === null) {
      seen.current = null;
      return;
    }
    const result = detectNewDecisions(
      seen.current,
      board.decisions.map((decision) => decision.id),
    );
    seen.current = result.seen;
    if (!result.chime) return;
    soundStore().announce(result.fresh);
    setHighlighted((previous) => new Set([...previous, ...result.fresh]));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setHighlighted((previous) => {
        const next = new Set(previous);
        for (const id of result.fresh) next.delete(id);
        return next;
      });
    }, HIGHLIGHT_MS);
    timers.current.add(timer);
  }, [board]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return highlighted;
}
