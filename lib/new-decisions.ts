// Which decisions are new since the panel opened, for the new-decision chime.

export interface NewDecisions {
  /** Every id seen since the panel opened. */
  seen: ReadonlySet<string>;
  /** Ids not seen before, in feed order. */
  fresh: string[];
  /** Play the chime: once per poll, however many ids are new. */
  chime: boolean;
}

/**
 * `seen` is null on the first load, which never announces anything. An id
 * that leaves the board and comes back is not new.
 */
export function detectNewDecisions(seen: ReadonlySet<string> | null, ids: readonly string[]): NewDecisions {
  const next = new Set(seen ?? []);
  const fresh: string[] = [];
  for (const id of ids) {
    if (next.has(id)) continue;
    next.add(id);
    if (seen !== null) fresh.push(id);
  }
  return { seen: next, fresh, chime: fresh.length > 0 };
}
