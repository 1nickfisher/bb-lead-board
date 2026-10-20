import { describe, expect, it } from "vitest";
import v1 from "../fixtures/board.json";
import v2 from "../fixtures/board-v2.json";
import { explainPhrase, parseBoard, type Board } from "./board";

function parse(value: unknown): Board {
  const parsed = parseBoard(JSON.stringify(value));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.board;
}

function v2Board(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(v2)) as Record<string, unknown>;
}

describe("parseBoard, schema 2", () => {
  it("reads every schema 2 section of the fixture", () => {
    const board = parse(v2);
    expect(board.schema).toBe(2);
    expect(board.checkedAt).toBe("2026-10-20T16:58:00.000Z");
    expect(board.stats).toMatchObject({ day: "2026-10-20", prsMerged: 4, waitingOnNick: 4 });
    expect(board.stats?.byProject.demo).toEqual({ prsMerged: 3, releases: 1 });
    expect(board.projects.map((project) => project.id)).toEqual(["demo", "factory", "site"]);
    expect(board.recent).toHaveLength(8);
    expect(board.launches[0]?.gates).toHaveLength(8);
    expect(board.decisions[0]?.links.map((link) => link.label)).toEqual(["Plan", "Lead thread note", "PR 42"]);
  });

  it("still reads schema 1 and gives it empty schema 2 sections", () => {
    const board = parse(v1);
    expect(board.schema).toBe(1);
    expect(board.checkedAt).toBeNull();
    expect(board.stats).toBeNull();
    expect(board.projects).toEqual([]);
    expect(board.recent).toEqual([]);
    expect(board.launches).toEqual([]);
    expect(board.decisions[0]?.links).toEqual([]);
  });

  it("rejects a schema it does not know", () => {
    const parsed = parseBoard(JSON.stringify({ schema: 3, updatedAt: "x" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("schema 3");
  });

  it("drops one unreadable item instead of hiding a section", () => {
    const board = v2Board();
    (board.recent as unknown[]).splice(1, 0, { at: 5, kind: "merged" });
    (board.projects as unknown[]).push({ name: "no id" });
    (board.launches as { gates: unknown[] }[])[0]!.gates.push({ name: "no id" });
    const parsed = parse(board);
    expect(parsed.recent).toHaveLength(8);
    expect(parsed.projects).toHaveLength(3);
    expect(parsed.launches[0]?.gates).toHaveLength(8);
  });

  it("keeps the board when a whole schema 2 section is malformed", () => {
    const board = v2Board();
    board.stats = "lots";
    board.recent = { not: "a list" };
    board.launches = null;
    const parsed = parse(board);
    expect(parsed.stats).toBeNull();
    expect(parsed.recent).toEqual([]);
    expect(parsed.launches).toEqual([]);
    expect(parsed.decisions).toHaveLength(4);
  });

  it("shows a count it cannot read as unknown, never as zero", () => {
    const board = v2Board();
    (board.stats as Record<string, unknown>).prsMerged = "four";
    (board.stats as Record<string, unknown>).releases = -1;
    const parsed = parse(board);
    expect(parsed.stats?.prsMerged).toBeNull();
    expect(parsed.stats?.releases).toBeNull();
    expect(parsed.stats?.reviewsDone).toBe(6);
  });

  it("maps an unknown event kind to other and an unknown gate status to not started", () => {
    const board = v2Board();
    (board.recent as { kind: string }[])[0]!.kind = "teleported";
    (board.launches as { gates: { status: string }[] }[])[0]!.gates[0]!.status = "almost";
    const parsed = parse(board);
    expect(parsed.recent[0]?.kind).toBe("other");
    expect(parsed.launches[0]?.gates[0]?.status).toBe("not-started");
  });

  it("keeps at most 100 recent events", () => {
    const board = v2Board();
    board.recent = Array.from({ length: 130 }, (_, index) => ({
      at: new Date(Date.UTC(2026, 9, 20, 12, 0, 0) - index * 60_000).toISOString(),
      project: "demo",
      kind: "done",
      text: `event ${index}`,
      link: null,
    }));
    expect(parse(board).recent).toHaveLength(100);
  });

  it("falls back to the project id when a project has no display name", () => {
    const board = v2Board();
    delete (board.projects as Record<string, unknown>[])[2]!.name;
    expect(parse(board).projects[2]?.name).toBe("site");
  });
});

describe("explainPhrase", () => {
  it("asks the lead to explain a decision by its id", () => {
    expect(explainPhrase(parse(v2).decisions[1]!)).toBe("explain demo-release");
  });

  it("offers no explain phrase for a decision the panel could not read", () => {
    const board = v2Board();
    (board.decisions as unknown[]).push({ title: 5 });
    expect(explainPhrase(parse(board).decisions[4]!)).toBeNull();
  });
});
