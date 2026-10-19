// One sent-state store per window, shared by every mounted Lead board panel
// (thread side panel and sidebar page). It holds the "sent: waiting for the
// lead" marks, persisted to localStorage, and the sends in flight. A mark is
// keyed by decision id and lives while the board still asks that exact
// decision (same fingerprint); only the board dropping or changing the
// decision clears it.
import { decisionFingerprint, type Board, type Decision } from "@/lib/board";

export interface SentMark {
  fingerprint: string;
  phrase: string;
  sentAt: number;
}
type SentMarks = Readonly<Record<string, SentMark>>;

export interface SentSnapshot {
  marks: SentMarks;
  /** Decision ids with a send in flight in this window. */
  inFlight: ReadonlySet<string>;
}

function load(key: string): SentMarks {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const marks: Record<string, SentMark> = {};
    for (const [id, value] of Object.entries(raw)) {
      const mark = value as Partial<SentMark> | null;
      if (
        typeof mark?.fingerprint === "string" &&
        typeof mark.phrase === "string" &&
        typeof mark.sentAt === "number"
      ) {
        marks[id] = { fingerprint: mark.fingerprint, phrase: mark.phrase, sentAt: mark.sentAt };
      }
    }
    return marks;
  } catch {
    return {};
  }
}

export class SentStore {
  private snapshot: SentSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly key: string) {
    this.snapshot = { marks: load(key), inFlight: new Set() };
  }

  getSnapshot = (): SentSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) window.addEventListener("storage", this.onStorage);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) window.removeEventListener("storage", this.onStorage);
    };
  };

  /** Another window changed the marks. */
  private onStorage = (event: StorageEvent): void => {
    if (event.key === this.key) this.set({ ...this.snapshot, marks: load(this.key) });
  };

  /** The mark for this decision, if the board still asks exactly it. */
  markFor(decision: Decision, snapshot = this.snapshot): SentMark | null {
    const mark = snapshot.marks[decision.id];
    return mark && mark.fingerprint === decisionFingerprint(decision) ? mark : null;
  }

  /**
   * Claim the right to send for a decision. False when this window already
   * sent it or has a send in flight, so a second click anywhere sends nothing.
   */
  begin(decision: Decision): boolean {
    if (this.snapshot.inFlight.has(decision.id) || this.markFor(decision) !== null) return false;
    this.set({ ...this.snapshot, inFlight: new Set(this.snapshot.inFlight).add(decision.id) });
    return true;
  }

  end(decisionId: string): void {
    const inFlight = new Set(this.snapshot.inFlight);
    inFlight.delete(decisionId);
    this.set({ ...this.snapshot, inFlight });
  }

  markSent(decision: Decision, phrase: string): void {
    const mark = { fingerprint: decisionFingerprint(decision), phrase, sentAt: Date.now() };
    this.write((marks) => ({ ...marks, [decision.id]: mark }));
  }

  /** Drop marks for decisions the board no longer asks in the same form. */
  prune(board: Board): void {
    const live = new Map(board.decisions.map((d) => [d.id, decisionFingerprint(d)]));
    const stale = Object.entries(this.snapshot.marks).some(([id, mark]) => live.get(id) !== mark.fingerprint);
    if (!stale) return;
    this.write((marks) =>
      Object.fromEntries(Object.entries(marks).filter(([id, mark]) => live.get(id) === mark.fingerprint)),
    );
  }

  /** Read-modify-write against storage, so other windows' marks survive. */
  private write(change: (marks: SentMarks) => SentMarks): void {
    const marks = change({ ...load(this.key), ...this.snapshot.marks });
    try {
      localStorage.setItem(this.key, JSON.stringify(marks));
    } catch {
      // Storage full or blocked: the marks still hold in this window.
    }
    this.set({ ...this.snapshot, marks });
  }

  private set(snapshot: SentSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

const stores = new Map<string, SentStore>();

export function sentStore(key: string): SentStore {
  let store = stores.get(key);
  if (!store) {
    store = new SentStore(key);
    stores.set(key, store);
  }
  return store;
}

/** Tests only: forget every window store. */
export function resetSentStores(): void {
  stores.clear();
}
