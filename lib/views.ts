// Ordering, filtering and per-project slices of a parsed board. Pure, so the
// components only render.
import type { Board, ComingUp, Decision, DoneItem, InFlightGroup, Launch, Project, RecentEvent } from "./board";
import { shortHash } from "./hash";

/** Unreadable times sort after every readable one. */
function time(iso: string | null): number {
  if (iso === null) return Number.POSITIVE_INFINITY;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

/** Newest first, unreadable times last. */
function newestFirst(a: string | null, b: string | null): number {
  const x = time(a);
  const y = time(b);
  if (x === y) return 0;
  if (x === Number.POSITIVE_INFINITY) return 1;
  if (y === Number.POSITIVE_INFINITY) return -1;
  return y - x;
}

/** Production, security and unrecognised risks come first (an unknown risk fails closed). */
const URGENT_RISKS: ReadonlySet<Decision["risk"]> = new Set(["production", "security", "unknown"]);

/** Most urgent first: production or security, then the oldest. Ties keep the feed's order. */
export function sortDecisions(decisions: readonly Decision[]): Decision[] {
  return [...decisions].sort((a, b) => {
    const tier = Number(!URGENT_RISKS.has(a.risk)) - Number(!URGENT_RISKS.has(b.risk));
    return tier !== 0 ? tier : time(a.createdAt) - time(b.createdAt) || 0;
  });
}

export const RECENT_SORTS = [
  { id: "newest", label: "Newest" },
  { id: "oldest-waiting", label: "Oldest waiting" },
  { id: "project", label: "By project" },
  { id: "needs-nick", label: "Needs Nick first" },
] as const;
export type RecentSort = (typeof RECENT_SORTS)[number]["id"];

/**
 * - newest: newest first.
 * - oldest-waiting: blocked events first, longest waiting first; then the rest, newest first.
 * - project: grouped in the feed's project order, newest first within each.
 * - needs-nick: events from projects with a decision waiting on Nick first, newest first within each part.
 */
export function sortRecent(events: readonly RecentEvent[], sort: RecentSort, board: Board): RecentEvent[] {
  const sorted = [...events].sort((a, b) => newestFirst(a.at, b.at));
  if (sort === "oldest-waiting") {
    const blocked = sorted.filter((event) => event.kind === "blocked").reverse();
    return [...blocked, ...sorted.filter((event) => event.kind !== "blocked")];
  }
  if (sort === "project") {
    const order = new Map(board.projects.map((project, index) => [project.id, index]));
    // Finite ranks: unknown projects after listed ones, events without a project last.
    const rank = (event: RecentEvent) => (event.project === null ? order.size + 1 : (order.get(event.project) ?? order.size));
    return sorted.sort((a, b) => rank(a) - rank(b));
  }
  if (sort === "needs-nick") {
    const waiting = new Set(board.decisions.map((decision) => decision.project));
    return [
      ...sorted.filter((event) => waiting.has(event.project)),
      ...sorted.filter((event) => !waiting.has(event.project)),
    ];
  }
  return sorted;
}

/**
 * Each event with a key from its own content, so a row keeps its state (an
 * open reply, a recording) when newer events arrive above it. Identical
 * events are told apart by how many came before them.
 */
export function withEventKeys(events: readonly RecentEvent[]): { key: string; event: RecentEvent }[] {
  const seen = new Map<string, number>();
  return events.map((event) => {
    const id = shortHash([event.at, event.project, event.kind, event.text, event.link].join("\u0000"));
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    return { key: count === 0 ? id : `${id}-${count}`, event };
  });
}

/** One project's events, or all of them for null. */
export function filterRecent(events: readonly RecentEvent[], project: string | null): RecentEvent[] {
  return project === null ? [...events] : events.filter((event) => event.project === project);
}

/** A project's display name, falling back to its id. */
export function projectName(board: Board, id: string | null): string | null {
  if (id === null) return null;
  return board.projects.find((project) => project.id === id)?.name ?? id;
}

export interface ProjectSlice {
  project: Project | null;
  decisions: Decision[];
  inFlight: InFlightGroup["items"];
  comingUp: ComingUp[];
  recent: RecentEvent[];
  launches: Launch[];
  stats: { prsMerged: number | null; releases: number | null } | null;
}

/** Everything the board says about one project. */
export function projectSlice(board: Board, id: string): ProjectSlice {
  return {
    project: board.projects.find((project) => project.id === id) ?? null,
    decisions: sortDecisions(board.decisions.filter((decision) => decision.project === id)),
    inFlight: board.inFlight.filter((group) => group.project === id).flatMap((group) => group.items),
    comingUp: board.comingUp.filter((item) => item.project === id),
    recent: filterRecent(board.recent, id),
    launches: board.launches.filter((launch) => launch.project === id),
    stats: board.stats?.byProject[id] ?? null,
  };
}

const LA_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD in America/Los_Angeles, the day the feed's stats use. */
export function losAngelesDay(at: number): string {
  return LA_DAY.format(at);
}

/** Done items from the stats day (or today in Los Angeles), newest first; undated items count as today. */
export function doneToday(board: Board, now: number): DoneItem[] {
  const day = board.stats?.day ?? losAngelesDay(now);
  return board.done
    .filter((item) => {
      const at = time(item.at);
      return at === Number.POSITIVE_INFINITY || losAngelesDay(at) === day;
    })
    .sort((a, b) => newestFirst(a.at, b.at));
}

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;

/** The project a sidebar page URL names: `?project=<id>`, or the `project/<id>` sub-path. */
export function projectFromLocation(subPath: string, search: string): string | null {
  const fromPath = /^project\/([^/]+)$/.exec(subPath)?.[1];
  let candidate: string | null = null;
  try {
    candidate = fromPath !== undefined ? decodeURIComponent(fromPath) : new URLSearchParams(search).get("project");
  } catch {
    return null;
  }
  return candidate !== null && PROJECT_ID.test(candidate) ? candidate : null;
}
