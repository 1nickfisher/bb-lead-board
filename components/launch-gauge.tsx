// Progress toward a launch: one segmented bar of its gates by status, a
// legend with icons and counts, blocked gates listed first, and per-group
// bars behind a disclosure. Status is always icon + label, never colour alone.
import { BOARD_LIMITS, GATE_STATUSES, clip, type Gate, type GateStatus, type Launch } from "@/lib/board";
import { parseHref } from "@/lib/links";
import { gateSummary, type GateCounts } from "@/lib/launch";
import { useContext } from "react";
import { BoardHostContext, useOpenLink } from "./board-link";
import { Glyph, type GlyphName } from "./glyphs";

export const GATE_STATUS: Record<GateStatus, { label: string; glyph: GlyphName }> = {
  done: { label: "Done", glyph: "check" },
  "in-progress": { label: "In progress", glyph: "progress" },
  blocked: { label: "Blocked", glyph: "blocked" },
  "not-started": { label: "Not started", glyph: "circle" },
};

function describe(counts: GateCounts, total: number): string {
  const parts = GATE_STATUSES.filter((status) => counts[status] > 0).map(
    (status) => `${counts[status]} ${GATE_STATUS[status].label.toLowerCase()}`,
  );
  return `${parts.join(", ")} of ${total} ${total === 1 ? "gate" : "gates"}`;
}

function GateBar({ counts, total, size = "lg" }: { counts: GateCounts; total: number; size?: "lg" | "sm" }) {
  return (
    <div className={`lb-bar lb-bar-${size}`} role="img" aria-label={describe(counts, total)}>
      {GATE_STATUSES.filter((status) => counts[status] > 0).map((status) => (
        <span
          key={status}
          className={`lb-seg lb-seg-${status}`}
          style={{ flexGrow: counts[status] }}
          title={`${GATE_STATUS[status].label}: ${counts[status]}`}
        />
      ))}
    </div>
  );
}

function StatusIcon({ status }: { status: GateStatus }) {
  return <Glyph name={GATE_STATUS[status].glyph} className={`lb-st lb-st-${status}`} />;
}

function GateRow({ gate, showGroup = true }: { gate: Gate; showGroup?: boolean }) {
  const hostId = useContext(BoardHostContext);
  const open = useOpenLink();
  const target = gate.link ? parseHref(gate.link, hostId) : null;
  const openable = target !== null && (target.kind === "url" || target.kind === "thread" || target.kind === "file");
  const meta = [showGroup ? gate.group : null, gate.owner].filter(Boolean).map((value) => clip(value!, BOARD_LIMITS.gate.owner));
  const body = (
    <>
      <StatusIcon status={gate.status} />
      <span className="lb-gate-text">
        <span className="lb-gate-name">{clip(gate.name, BOARD_LIMITS.gate.name)}</span>
        <span className="lb-gate-meta">
          {GATE_STATUS[gate.status].label}
          {meta.length > 0 ? ` · ${meta.join(" · ")}` : null}
        </span>
      </span>
      {openable ? <Glyph name={target.kind === "url" ? "external" : target.kind} className="lb-gate-go" /> : null}
    </>
  );
  return (
    <li data-gate-id={gate.id}>
      {openable ? (
        <button type="button" className="lb-gate" onClick={() => open(target)}>
          {body}
        </button>
      ) : (
        <div className="lb-gate">{body}</div>
      )}
    </li>
  );
}

function formatTarget(target: string | null): string | null {
  if (target === null || !/^\d{4}-\d{2}-\d{2}$/.test(target)) return target;
  const at = Date.parse(`${target}T12:00:00Z`);
  if (Number.isNaN(at)) return target;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(at);
}

export function LaunchGauge({ launch, projectLabel }: { launch: Launch; projectLabel: string | null }) {
  const summary = gateSummary(launch);
  const blocked = summary.gates.filter((gate) => gate.status === "blocked");
  const target = formatTarget(launch.target);
  const sub = [target ? `Target ${target}` : null, projectLabel].filter(Boolean).join(" · ");
  return (
    <section className="lb-launch" aria-label={`Launch: ${launch.name}`} data-launch-id={launch.id}>
      <div className="lb-launch-top">
        <span className="lb-launch-name">{clip(launch.name, BOARD_LIMITS.launch.name)}</span>
        {sub ? <span className="lb-muted">{sub}</span> : null}
      </div>
      {summary.total === 0 ? (
        <p className="lb-muted">No gates yet.</p>
      ) : (
        <>
          <p className="lb-launch-head">
            <b>{summary.counts.done}</b> of {summary.total} gates done
          </p>
          <GateBar counts={summary.counts} total={summary.total} />
          <ul className="lb-legend" aria-label="Gate status">
            {GATE_STATUSES.map((status) => (
              <li key={status}>
                <StatusIcon status={status} />
                {GATE_STATUS[status].label} <b>{summary.counts[status]}</b>
              </li>
            ))}
          </ul>
          {blocked.length > 0 ? (
            <ul className="lb-gates" aria-label="Blocked gates">
              {blocked.map((gate) => (
                <GateRow key={gate.id} gate={gate} />
              ))}
            </ul>
          ) : null}
          <details className="lb-launch-more">
            <summary>
              All gates by group · {summary.groups.length}
            </summary>
            {summary.groups.map((group) => (
              <div key={group.name} className="lb-group">
                <div className="lb-group-top">
                  <span className="lb-group-name">{clip(group.name, BOARD_LIMITS.gate.group)}</span>
                  <span className="lb-muted">
                    {group.counts.done}/{group.total} done
                    {group.counts.blocked > 0 ? ` · ${group.counts.blocked} blocked` : null}
                  </span>
                </div>
                <GateBar counts={group.counts} total={group.total} size="sm" />
                <ul className="lb-gates">
                  {summary.gates
                    .filter((gate) => (gate.group ?? "Other") === group.name)
                    .map((gate) => (
                      <GateRow key={gate.id} gate={gate} showGroup={false} />
                    ))}
                </ul>
              </div>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
