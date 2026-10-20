// Each project's status for the home page chips, derived from the feed alone.
import { CONFIRM_RISKS, type Board, type Decision, type Project } from "./board";

/** Most urgent first; the chips sort in this order. */
export const PROJECT_STATUSES = ["urgent", "needs-you", "active", "quiet"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface ProjectState {
  project: Project;
  status: ProjectStatus;
  /** Decisions waiting on Nick. */
  waiting: number;
  /** Any in-flight item is blocked. */
  blocked: boolean;
}

const DAY_MS = 24 * 3_600_000;

/** The feed's bucket for decisions that name no listed project (automations/board.py). */
export const OTHER_PROJECT = "other";

/**
 * The listed project a decision belongs to, as the feed counts it
 * (stored_project in automations/board.py): its project's id or display name,
 * ignoring case and surrounding spaces; otherwise the feed's Other bucket when
 * the board lists one; otherwise none.
 */
export function decisionProjectId(board: Board, decision: Pick<Decision, "project">): string | null {
  const wanted = (decision.project ?? "").trim().toLowerCase();
  if (wanted !== "") {
    const match = board.projects.find(
      (project) => project.id.toLowerCase() === wanted || (project.name ?? "").toLowerCase() === wanted,
    );
    if (match) return match.id;
  }
  return board.projects.some((project) => project.id === OTHER_PROJECT) ? OTHER_PROJECT : null;
}

/** The decisions the feed counts under one project. */
export function projectDecisions(board: Board, id: string): Decision[] {
  return board.decisions.filter((decision) => decisionProjectId(board, decision) === id);
}

function within24h(iso: string | null, now: number): boolean {
  if (iso === null) return false;
  const at = Date.parse(iso);
  return !Number.isNaN(at) && now - at <= DAY_MS;
}

/**
 * - urgent: a waiting decision with production, security, money or unrecognised risk;
 * - needs-you: any other waiting decision;
 * - active: work in flight, a merge today, or any activity in the last 24 hours;
 * - quiet: nothing in 24 hours.
 */
export function projectStatus(board: Board, id: string, now: number): ProjectStatus {
  const decisions = projectDecisions(board, id);
  if (decisions.some((decision) => CONFIRM_RISKS.has(decision.risk))) return "urgent";
  if (decisions.length > 0) return "needs-you";
  const project = board.projects.find((item) => item.id === id);
  const active =
    (project?.inFlight ?? 0) > 0 ||
    board.inFlight.some((group) => group.project === id && group.items.length > 0) ||
    (project?.mergedToday ?? 0) > 0 ||
    (board.stats?.byProject[id]?.prsMerged ?? 0) > 0 ||
    within24h(project?.lastActivityAt ?? null, now) ||
    board.recent.some((event) => event.project === id && within24h(event.at, now));
  return active ? "active" : "quiet";
}

const RANK = new Map<ProjectStatus, number>(PROJECT_STATUSES.map((status, index) => [status, index]));
const byName = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Every listed project with its status, ordered by status, then name. */
export function projectStates(board: Board, now: number): ProjectState[] {
  return board.projects
    .map((project) => ({
      project,
      status: projectStatus(board, project.id, now),
      waiting: projectDecisions(board, project.id).length,
      blocked: board.inFlight.some(
        (group) => group.project === project.id && group.items.some((item) => item.state === "blocked"),
      ),
    }))
    .sort(
      (a, b) =>
        RANK.get(a.status)! - RANK.get(b.status)! ||
        byName.compare(a.project.name ?? a.project.id, b.project.name ?? b.project.id),
    );
}

/** "12 projects · 2 need you · 1 blocked"; zero counts are left out. */
export function projectsSummary(states: readonly ProjectState[]): string {
  const needYou = states.filter((state) => state.status === "urgent" || state.status === "needs-you").length;
  const blocked = states.filter((state) => state.blocked).length;
  return [
    `${states.length} ${states.length === 1 ? "project" : "projects"}`,
    needYou > 0 ? `${needYou} ${needYou === 1 ? "needs" : "need"} you` : null,
    blocked > 0 ? `${blocked} blocked` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
