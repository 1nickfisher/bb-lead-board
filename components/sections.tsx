// The board's sections: the home page and one project's view are both built
// from these.
import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  BOARD_LIMITS,
  clip,
  type Board,
  type ComingUp,
  type Decision,
  type DecisionOption,
  type DoneItem,
  type InFlightGroup,
  type Project,
  type RecentEvent,
  type RecentKind,
} from "@/lib/board";
import { formatAgo } from "@/lib/freshness";
import {
  RECENT_SORTS,
  doneToday,
  filterRecent,
  projectName,
  projectSlice,
  sortDecisions,
  sortRecent,
  withEventKeys,
  type RecentSort,
} from "@/lib/views";
import { replyTarget } from "@/lib/reply";
import { BoardLink } from "./board-link";
import { useDraft } from "./drafts";
import { ReplyBox, ReplyButton } from "./reply-box";
import { DecisionCard } from "./decision-card";
import { Glyph, type GlyphName } from "./glyphs";
import { LaunchGauge } from "./launch-gauge";
import type { SentMark } from "./use-sent";

export interface DecisionHandlers {
  inFlight: ReadonlySet<string>;
  sentFor(decision: Decision): SentMark | null;
  onChoose(decision: Decision, option: DecisionOption): void;
  onExplain(phrase: string): Promise<void>;
  /** Send Nick's own text to the lead thread (replies). */
  onSendText(text: string): Promise<void>;
  /** The voice setting is on. */
  voice: boolean;
}

function Count({ value }: { value: number | null }) {
  return value === null ? <span aria-label="unknown">–</span> : <>{value}</>;
}

/* ---------- Stats ---------- */

function StatsStrip({ items }: { items: { label: string; value: number | null }[] }) {
  return (
    <section
      aria-label="Today"
      className="lb-stats"
      style={{ "--lb-stat-count": items.length } as CSSProperties}
    >
      {items.map((item) => (
        <div key={item.label} className="lb-stat">
          <span className="lb-stat-value">
            <Count value={item.value} />
          </span>
          <span className="lb-stat-label">{item.label}</span>
        </div>
      ))}
    </section>
  );
}

/* ---------- Projects ---------- */

function ProjectChips({
  board,
  onOpen,
}: {
  board: Board;
  onOpen(id: string): void;
}) {
  return (
    <nav aria-label="Projects" className="lb-chips">
      {board.projects.map((project) => {
        const waiting = board.decisions.filter((decision) => decision.project === project.id).length;
        return (
          <button
            key={project.id}
            type="button"
            className="lb-chip"
            data-project-id={project.id}
            onClick={() => onOpen(project.id)}
          >
            <span className="lb-chip-name">{clip(project.name ?? project.id, BOARD_LIMITS.project.name)}</span>
            {waiting > 0 ? (
              <span className="lb-chip-badge" aria-label={`${waiting} waiting on you`}>
                {waiting}
              </span>
            ) : null}
            {project.inFlight ? <span className="lb-chip-sub">{project.inFlight} in flight</span> : null}
          </button>
        );
      })}
    </nav>
  );
}

/** A project picker for narrow surfaces (the side panel). */
export function ProjectSwitcher({
  board,
  project,
  onChange,
}: {
  board: Board;
  project: string | null;
  onChange(id: string | null): void;
}) {
  if (board.projects.length === 0) return null;
  return (
    <label className="lb-switch">
      <span className="lb-sr">View</span>
      <select
        className="lb-select"
        aria-label="View"
        value={project ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
      >
        <option value="">All projects</option>
        {board.projects.map((item) => (
          <option key={item.id} value={item.id}>
            {clip(item.name ?? item.id, BOARD_LIMITS.project.name)}
          </option>
        ))}
        {project !== null && !board.projects.some((item) => item.id === project) ? (
          <option value={project}>{project}</option>
        ) : null}
      </select>
    </label>
  );
}

/* ---------- Decisions ---------- */

function NeedsYou({
  board,
  decisions,
  now,
  showProject,
  handlers,
}: {
  board: Board;
  decisions: Decision[];
  now: number;
  showProject: boolean;
  handlers: DecisionHandlers;
}) {
  return (
    <section aria-label="Needs you now" className="lb">
      <h3 className="lb-sec">Needs you now · {decisions.length}</h3>
      {decisions.length === 0 ? (
        <div className="lb-empty">Nothing needs you right now.</div>
      ) : (
        sortDecisions(decisions).map((decision) => (
          <DecisionCard
            key={decision.id}
            decision={decision}
            projectLabel={projectName(board, decision.project)}
            showProject={showProject}
            now={now}
            sent={handlers.sentFor(decision)}
            sending={handlers.inFlight.has(decision.id)}
            onChoose={(option) => handlers.onChoose(decision, option)}
            onExplain={handlers.onExplain}
            onSendText={handlers.onSendText}
            voice={handlers.voice}
          />
        ))
      )}
    </section>
  );
}

/* ---------- Recent ---------- */

const KIND: Record<RecentKind, { label: string; glyph: GlyphName }> = {
  merged: { label: "Merged", glyph: "merge" },
  released: { label: "Released", glyph: "release" },
  reviewed: { label: "Reviewed", glyph: "review" },
  decided: { label: "Decided", glyph: "decided" },
  started: { label: "Started", glyph: "start" },
  blocked: { label: "Blocked", glyph: "blocked" },
  done: { label: "Done", glyph: "check" },
  other: { label: "Update", glyph: "dot" },
};

const RECENT_PAGE = 20;

function RecentRow({
  event,
  glyph,
  meta,
  handlers,
}: {
  event: RecentEvent;
  glyph: GlyphName;
  meta: string;
  handlers: DecisionHandlers;
}) {
  const [replying, setReplying] = useState(false);
  const target = replyTarget({ kind: "event", event });
  const [draft, setDraft] = useDraft(target.draftKey);
  return (
    <li className="lb-ev" data-kind={event.kind}>
      <Glyph name={glyph} className={`lb-ev-icon lb-ev-${event.kind}`} />
      <div className="lb-ev-body">
        <span className="lb-ev-text">
          <BoardLink href={event.link}>{clip(event.text, BOARD_LIMITS.recent.text)}</BoardLink>
        </span>
        <span className="lb-ev-foot">
          <span className="lb-ev-meta">{meta}</span>
          <ReplyButton open={replying} label={`Reply: ${event.text}`} onToggle={() => setReplying((open) => !open)} />
        </span>
        {replying ? (
          <ReplyBox
            target={target}
            subject={event.text}
            draft={draft}
            setDraft={setDraft}
            voice={handlers.voice}
            onSend={handlers.onSendText}
            onClose={() => setReplying(false)}
          />
        ) : null}
      </div>
    </li>
  );
}

function RecentFeed({
  board,
  events,
  now,
  projectFilter,
  handlers,
}: {
  board: Board;
  events: RecentEvent[];
  now: number;
  handlers: DecisionHandlers;
  /** Offer the project filter (the home page). */
  projectFilter: boolean;
}) {
  const [sort, setSort] = useState<RecentSort>("newest");
  const [project, setProject] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const shown = sortRecent(filterRecent(events, projectFilter ? project : null), sort, board);
  const visible = all ? shown : shown.slice(0, RECENT_PAGE);
  return (
    <section aria-label="Recent" className="lb">
      <div className="lb-sec-row">
        <h3 className="lb-sec">Recent</h3>
        <div className="lb-tools">
          <select
            className="lb-select"
            aria-label="Sort recent activity"
            value={sort}
            onChange={(event) => setSort(event.target.value as RecentSort)}
          >
            {RECENT_SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {projectFilter && board.projects.length > 0 ? (
            <select
              className="lb-select"
              aria-label="Filter recent activity by project"
              value={project ?? ""}
              onChange={(event) => setProject(event.target.value === "" ? null : event.target.value)}
            >
              <option value="">All projects</option>
              {board.projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {clip(item.name ?? item.id, BOARD_LIMITS.project.name)}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="lb-empty">No recent activity.</div>
      ) : (
        <ol className="lb-feed">
          {withEventKeys(visible).map(({ key, event }) => {
            const kind = KIND[event.kind];
            const ago = formatAgo(event.at, now);
            const where = projectFilter ? projectName(board, event.project) : null;
            return (
              <RecentRow
                key={key}
                event={event}
                glyph={kind.glyph}
                meta={[kind.label, where ? clip(where, BOARD_LIMITS.project.name) : null, ago].filter(Boolean).join(" · ")}
                handlers={handlers}
              />
            );
          })}
        </ol>
      )}
      {!all && shown.length > RECENT_PAGE ? (
        <Button variant="outline" size="sm" className="lb-more" onClick={() => setAll(true)}>
          Show all {shown.length}
        </Button>
      ) : null}
    </section>
  );
}

/* ---------- Coming up, in flight, done ---------- */

export function ComingUpSection({ items, board }: { items: ComingUp[]; board: Board }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Coming up">
      <h3 className="lb-sec">Coming up</h3>
      <details>
        <summary>
          {items.length} {items.length === 1 ? "ask" : "asks"} the lead will bring when ready
        </summary>
        <ul>
          {items.map((item, index) => (
            <li key={index}>
              {item.after ? <span className="lb-wait">After {clip(item.after, BOARD_LIMITS.comingUp.after)}</span> : null}
              {item.after ? " · " : null}
              {item.project ? `${clip(projectName(board, item.project)!, BOARD_LIMITS.comingUp.project)}: ` : null}
              {clip(item.title, BOARD_LIMITS.comingUp.title)}
              {item.eta ? <span className="lb-muted"> · {clip(item.eta, BOARD_LIMITS.comingUp.eta)}</span> : null}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

const STATE: Record<"ok" | "wait" | "blocked", { className: string; label: string; glyph: GlyphName }> = {
  ok: { className: "lb-ok", label: "on track", glyph: "dot" },
  wait: { className: "lb-wait", label: "waiting", glyph: "clock" },
  blocked: { className: "lb-blocked", label: "blocked", glyph: "blocked" },
};

function InFlightItems({ items }: { items: InFlightGroup["items"] }) {
  return (
    <ul className="lb-flight">
      {items.map((item, index) => (
        <li key={index}>
          <Glyph name={STATE[item.state].glyph} className={STATE[item.state].className} label={STATE[item.state].label} />
          <BoardLink href={item.link}>{clip(item.text, BOARD_LIMITS.inFlight.text)}</BoardLink>
        </li>
      ))}
    </ul>
  );
}

export function InFlightSection({ groups, board }: { groups: InFlightGroup[]; board: Board }) {
  const visible = groups.filter((group) => group.items.length > 0);
  if (visible.length === 0) return null;
  return (
    <section aria-label="In flight">
      <h3 className="lb-sec">In flight</h3>
      <div className="lb">
        {visible.map((group) => {
          const blocked = group.items.filter((item) => item.state === "blocked").length;
          return (
            <details key={group.project}>
              <summary>
                {clip(projectName(board, group.project)!, BOARD_LIMITS.inFlightGroup.project)} · {group.items.length}
                {blocked > 0 ? <span className="lb-blocked"> · {blocked} blocked</span> : null}
              </summary>
              <InFlightItems items={group.items} />
            </details>
          );
        })}
      </div>
    </section>
  );
}

function DoneStrip({ items }: { items: DoneItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Done today">
      <details className="lb-done">
        <summary>
          <Glyph name="check" className="lb-st lb-st-done" />
          <span>Done today · {items.length}</span>
          <span className="lb-done-peek">{clip(items[0]!.text, BOARD_LIMITS.done.text)}</span>
        </summary>
        <ul>
          {items.map((item, index) => (
            <li key={index}>
              <BoardLink href={item.link}>{clip(item.text, BOARD_LIMITS.done.text)}</BoardLink>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function Launches({ board, launches }: { board: Board; launches: Board["launches"] }) {
  if (launches.length === 0) return null;
  return (
    <section aria-label="Launches" className="lb">
      <h3 className="lb-sec">{launches.length === 1 ? "Launch" : "Launches"}</h3>
      {launches.map((launch) => (
        <LaunchGauge key={launch.id} launch={launch} projectLabel={projectName(board, launch.project)} />
      ))}
    </section>
  );
}

/* ---------- Pages ---------- */

export function HomeView({
  board,
  now,
  handlers,
  onOpenProject,
}: {
  board: Board;
  now: number;
  handlers: DecisionHandlers;
  onOpenProject(id: string): void;
}) {
  const stats = board.stats;
  return (
    <>
      {board.projects.length > 0 ? <ProjectChips board={board} onOpen={onOpenProject} /> : null}
      {stats ? (
        <StatsStrip
          items={[
            { label: "Waiting on you", value: stats.waitingOnNick },
            { label: "Merged today", value: stats.prsMerged },
            { label: "Released today", value: stats.releases },
            { label: "Reviews", value: stats.reviewsDone },
            { label: "Workers running", value: stats.workersRunning },
          ]}
        />
      ) : null}
      <Launches board={board} launches={board.launches} />
      <NeedsYou board={board} decisions={board.decisions} now={now} showProject={board.schema === 2} handlers={handlers} />
      {board.schema === 2 ? (
        <RecentFeed board={board} events={board.recent} now={now} projectFilter handlers={handlers} />
      ) : (
        <>
          <ComingUpSection items={board.comingUp} board={board} />
          <InFlightSection groups={board.inFlight} board={board} />
        </>
      )}
      <DoneStrip items={doneToday(board, now)} />
    </>
  );
}

function Plain({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="lb">
      <h3 className="lb-sec">{title}</h3>
      {children}
    </section>
  );
}

export function ProjectView({
  board,
  id,
  now,
  handlers,
  onHome,
}: {
  board: Board;
  id: string;
  now: number;
  handlers: DecisionHandlers;
  onHome(): void;
}) {
  const slice = projectSlice(board, id);
  const project: Project | null = slice.project;
  const name = project?.name ?? id;
  return (
    <>
      <div className="lb-proj-top">
        <button type="button" className="lb-back" onClick={onHome}>
          <Glyph name="back" />
          All projects
        </button>
        <h3 className="lb-proj-name">
          <BoardLink href={project?.link ?? null}>{clip(name, BOARD_LIMITS.project.name)}</BoardLink>
        </h3>
        {project === null ? <p className="lb-muted">The board does not list this project.</p> : null}
      </div>
      <StatsStrip
        items={[
          { label: "Waiting on you", value: slice.decisions.length },
          { label: "In flight", value: slice.inFlight.length },
          { label: "Merged today", value: slice.stats?.prsMerged ?? project?.mergedToday ?? null },
          { label: "Released today", value: slice.stats?.releases ?? null },
        ]}
      />
      <NeedsYou board={board} decisions={slice.decisions} now={now} showProject={false} handlers={handlers} />
      <Launches board={board} launches={slice.launches} />
      {slice.inFlight.length > 0 ? (
        <Plain title="In flight">
          <div className="lb-panel">
            <InFlightItems items={slice.inFlight} />
          </div>
        </Plain>
      ) : null}
      {slice.comingUp.length > 0 ? (
        <Plain title="Coming up">
          <ul className="lb-panel lb-plain">
            {slice.comingUp.map((item, index) => (
              <li key={index}>
                {clip(item.title, BOARD_LIMITS.comingUp.title)}
                {item.after ? <span className="lb-muted"> · after {clip(item.after, BOARD_LIMITS.comingUp.after)}</span> : null}
                {item.eta ? <span className="lb-muted"> · {clip(item.eta, BOARD_LIMITS.comingUp.eta)}</span> : null}
              </li>
            ))}
          </ul>
        </Plain>
      ) : null}
      <RecentFeed board={board} events={slice.recent} now={now} projectFilter={false} handlers={handlers} />
    </>
  );
}
