import { describe, expect, it } from "vitest";
import v2 from "../fixtures/board-v2.json";
import { parseBoard, type Launch } from "./board";
import { gateSummary } from "./launch";

function launch(): Launch {
  const parsed = parseBoard(JSON.stringify(v2));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.board.launches[0]!;
}

describe("gateSummary", () => {
  it("counts gates by status", () => {
    const summary = gateSummary(launch());
    expect(summary.total).toBe(8);
    expect(summary.counts).toEqual({ done: 4, "in-progress": 2, blocked: 1, "not-started": 1 });
  });

  it("summarises each group in the feed's order", () => {
    expect(gateSummary(launch()).groups).toEqual([
      { name: "Billing", total: 2, counts: { done: 1, "in-progress": 1, blocked: 0, "not-started": 0 } },
      { name: "Clinical", total: 3, counts: { done: 2, "in-progress": 0, blocked: 1, "not-started": 0 } },
      { name: "Operations", total: 3, counts: { done: 1, "in-progress": 1, blocked: 0, "not-started": 1 } },
    ]);
  });

  it("lists blocked gates first, then in progress, not started and done", () => {
    expect(gateSummary(launch()).gates.map((gate) => gate.id)).toEqual(["g3", "g2", "g6", "g5", "g1", "g4", "g7", "g8"]);
  });

  it("puts gates without a group under Other", () => {
    const value = launch();
    value.gates[0]!.group = null;
    expect(gateSummary(value).groups.at(-1)).toMatchObject({ name: "Other", total: 1 });
  });

  it("handles a launch with no gates", () => {
    const value = launch();
    value.gates = [];
    expect(gateSummary(value)).toEqual({
      total: 0,
      counts: { done: 0, "in-progress": 0, blocked: 0, "not-started": 0 },
      groups: [],
      gates: [],
    });
  });
});
