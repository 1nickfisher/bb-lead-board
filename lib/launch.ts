// Launch gate counts for the launch gauge.
import { GATE_STATUSES, type Gate, type GateStatus, type Launch } from "./board";

export type GateCounts = Record<GateStatus, number>;

export interface GateSummary {
  total: number;
  counts: GateCounts;
  /** Groups in the order the feed first lists them; gates without one fall under "Other", last. */
  groups: { name: string; total: number; counts: GateCounts }[];
  /** Blocked first, then in progress, not started and done; feed order within each. */
  gates: Gate[];
}

const ORDER: Record<GateStatus, number> = { blocked: 0, "in-progress": 1, "not-started": 2, done: 3 };

function emptyCounts(): GateCounts {
  return Object.fromEntries(GATE_STATUSES.map((status) => [status, 0])) as GateCounts;
}

export function gateSummary(launch: Launch): GateSummary {
  const counts = emptyCounts();
  const groups = new Map<string, { name: string; total: number; counts: GateCounts }>();
  let other: { name: string; total: number; counts: GateCounts } | null = null;
  for (const gate of launch.gates) {
    counts[gate.status] += 1;
    let group: { name: string; total: number; counts: GateCounts };
    if (gate.group === null) {
      other ??= { name: "Other", total: 0, counts: emptyCounts() };
      group = other;
    } else {
      group = groups.get(gate.group) ?? { name: gate.group, total: 0, counts: emptyCounts() };
      groups.set(gate.group, group);
    }
    group.total += 1;
    group.counts[gate.status] += 1;
  }
  return {
    total: launch.gates.length,
    counts,
    groups: other ? [...groups.values(), other] : [...groups.values()],
    gates: [...launch.gates].sort((a, b) => ORDER[a.status] - ORDER[b.status]),
  };
}
