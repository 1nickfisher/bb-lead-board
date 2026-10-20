import { describe, expect, it } from "vitest";
import fixtureV2 from "../fixtures/board-v2.json";
import { parseBoard, type Board } from "./board";
import { decisionProjectId, projectStates, projectStatus, projectsSummary } from "./project-status";
import { projectSlice } from "./views";

const NOW = Date.parse("2026-10-20T17:00:00.000Z");
const HOUR = 3_600_000;

function board(overrides: Record<string, unknown> = {}): Board {
  const raw = {
    schema: 2,
    updatedAt: "2026-10-20T16:00:00.000Z",
    checkedAt: "2026-10-20T16:55:00.000Z",
    updatedBy: "lead",
    projects: [],
    decisions: [],
    comingUp: [],
    inFlight: [],
    done: [],
    recent: [],
    launches: [],
    ...overrides,
  };
  const parsed = parseBoard(JSON.stringify(raw));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.board;
}

function decision(id: string, project: string, risk = "none") {
  return {
    id,
    title: `Decision ${id}`,
    project,
    options: [{ label: "Go", phrase: `${id}: go`, recommended: true }],
    risk,
    createdAt: "2026-10-20T10:00:00.000Z",
  };
}

const iso = (at: number) => new Date(at).toISOString();

describe("projectStatus", () => {
  it("is urgent when a waiting decision carries production, security or money risk", () => {
    for (const risk of ["production", "security", "money"]) {
      const b = board({ projects: [{ id: "p" }], decisions: [decision("a", "p"), decision("b", "p", risk)] });
      expect(projectStatus(b, "p", NOW)).toBe("urgent");
    }
  });

  it("fails closed: an unrecognised risk is urgent too", () => {
    const b = board({ projects: [{ id: "p" }], decisions: [decision("a", "p", "nuclear")] });
    expect(projectStatus(b, "p", NOW)).toBe("urgent");
  });

  it("needs you for any other waiting decision", () => {
    for (const risk of ["none", "staging"]) {
      const b = board({ projects: [{ id: "p" }], decisions: [decision("a", "p", risk)] });
      expect(projectStatus(b, "p", NOW)).toBe("needs-you");
    }
  });

  it("only counts the project's own decisions", () => {
    const b = board({ projects: [{ id: "p" }, { id: "q" }], decisions: [decision("a", "q", "production")] });
    expect(projectStatus(b, "p", NOW)).toBe("quiet");
  });

  it("is active with work in flight, from the project count or the in-flight list", () => {
    expect(projectStatus(board({ projects: [{ id: "p", inFlight: 2 }] }), "p", NOW)).toBe("active");
    const listed = board({ projects: [{ id: "p" }], inFlight: [{ project: "p", items: [{ text: "x", state: "blocked" }] }] });
    expect(projectStatus(listed, "p", NOW)).toBe("active");
  });

  it("is active with a merge today, from the project or the stats", () => {
    expect(projectStatus(board({ projects: [{ id: "p", mergedToday: 1 }] }), "p", NOW)).toBe("active");
    const stats = board({ projects: [{ id: "p" }], stats: { byProject: { p: { prsMerged: 1 } } } });
    expect(projectStatus(stats, "p", NOW)).toBe("active");
  });

  it("is active with any activity in the last 24 hours, and quiet without", () => {
    const recent = (at: number) =>
      board({ projects: [{ id: "p" }], recent: [{ at: iso(at), project: "p", kind: "started", text: "Worker started" }] });
    expect(projectStatus(recent(NOW - 23 * HOUR), "p", NOW)).toBe("active");
    expect(projectStatus(recent(NOW - 25 * HOUR), "p", NOW)).toBe("quiet");
    const last = (at: number) => board({ projects: [{ id: "p", lastActivityAt: iso(at) }] });
    expect(projectStatus(last(NOW - 2 * HOUR), "p", NOW)).toBe("active");
    expect(projectStatus(last(NOW - 30 * HOUR), "p", NOW)).toBe("quiet");
  });

  it("is quiet with zero counts and unreadable times", () => {
    const b = board({ projects: [{ id: "p", inFlight: 0, mergedToday: 0, lastActivityAt: "not a time" }] });
    expect(projectStatus(b, "p", NOW)).toBe("quiet");
  });
});

describe("projectStates", () => {
  it("orders chips by status, then name, ignoring case", () => {
    const b = board({
      projects: [
        { id: "z", name: "zeta" },
        { id: "q", name: "Quiet one" },
        { id: "a", name: "Alpha", inFlight: 1 },
        { id: "u", name: "Urgent" },
        { id: "n2", name: "beta" },
        { id: "n1", name: "Able" },
      ],
      decisions: [decision("d1", "u", "security"), decision("d2", "n1"), decision("d3", "n2")],
    });
    expect(projectStates(b, NOW).map((state) => [state.project.id, state.status])).toEqual([
      ["u", "urgent"],
      ["n1", "needs-you"],
      ["n2", "needs-you"],
      ["a", "active"],
      ["q", "quiet"],
      ["z", "quiet"],
    ]);
  });

  it("carries the waiting count and whether any in-flight work is blocked", () => {
    const b = board({
      projects: [{ id: "p" }],
      decisions: [decision("a", "p"), decision("b", "p")],
      inFlight: [{ project: "p", items: [{ text: "x", state: "ok" }, { text: "y", state: "blocked" }] }],
    });
    expect(projectStates(b, NOW)[0]).toMatchObject({ waiting: 2, blocked: true, status: "needs-you" });
  });

  it("matches the v2 fixture", () => {
    const parsed = parseBoard(JSON.stringify(fixtureV2));
    if (!parsed.ok) throw new Error(parsed.error);
    const states = projectStates(parsed.board, Date.parse(fixtureV2.checkedAt));
    expect(states.map((state) => [state.project.id, state.status, state.blocked])).toEqual([
      ["demo", "urgent", true],
      ["factory", "needs-you", false],
      ["site", "active", false],
    ]);
  });
});

describe("projectsSummary", () => {
  it("counts projects, those that need you and those blocked", () => {
    const b = board({
      projects: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      decisions: [decision("x", "a", "production"), decision("y", "b")],
      inFlight: [{ project: "c", items: [{ text: "x", state: "blocked" }] }],
    });
    expect(projectsSummary(projectStates(b, NOW))).toBe("4 projects · 2 need you · 1 blocked");
  });

  it("uses the singular and leaves out zero counts", () => {
    const one = board({ projects: [{ id: "a" }], decisions: [decision("x", "a")] });
    expect(projectsSummary(projectStates(one, NOW))).toBe("1 project · 1 needs you");
    expect(projectsSummary(projectStates(board({ projects: [{ id: "a" }, { id: "b" }] }), NOW))).toBe("2 projects");
  });
});

describe("the feed's Other bucket (automations/board.py)", () => {
  it("maps a decision to a project by id or display name, ignoring case and spaces", () => {
    const b = board({ projects: [{ id: "roc", name: "Bower (ROC)" }, { id: "other", name: "Other" }] });
    const at = (project: string | null) => decisionProjectId(b, { project });
    expect(at("roc")).toBe("roc");
    expect(at(" ROC ")).toBe("roc");
    expect(at("bower (roc)")).toBe("roc");
    expect(at("LINK")).toBe("other");
    expect(at(null)).toBe("other");
  });

  it("leaves an unmatched decision unassigned when the board has no Other project", () => {
    const b = board({ projects: [{ id: "roc" }] });
    expect(decisionProjectId(b, { project: "LINK" })).toBeNull();
  });

  it("counts a legacy card naming no registered project under Other", () => {
    const b = board({
      projects: [{ id: "roc", name: "ROC" }, { id: "other", name: "Other", decisions: 1 }],
      decisions: [decision("legacy", "LINK", "production")],
    });
    expect(projectStatus(b, "other", NOW)).toBe("urgent");
    expect(projectStates(b, NOW)[0]).toMatchObject({ status: "urgent", waiting: 1 });
    expect(projectStatus(b, "roc", NOW)).toBe("quiet");
    expect(projectsSummary(projectStates(b, NOW))).toBe("2 projects · 1 needs you");
    expect(projectSlice(b, "other").decisions.map((item) => item.id)).toEqual(["legacy"]);
  });

  it("counts a decision named by display name under its project", () => {
    const b = board({ projects: [{ id: "roc", name: "Bower (ROC)" }], decisions: [decision("d", "Bower (ROC)")] });
    expect(projectStates(b, NOW)[0]).toMatchObject({ status: "needs-you", waiting: 1 });
    expect(projectSlice(b, "roc").decisions).toHaveLength(1);
  });
});
