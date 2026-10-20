import { describe, expect, it } from "vitest";
import v1 from "../fixtures/board.json";
import v2 from "../fixtures/board-v2.json";
import { parseBoard, type Board } from "./board";
import {
  doneToday,
  filterRecent,
  losAngelesDay,
  projectFromLocation,
  projectName,
  projectSlice,
  sortDecisions,
  sortRecent,
  withEventKeys,
} from "./views";

function parse(value: unknown): Board {
  const parsed = parseBoard(JSON.stringify(value));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.board;
}

const board = parse(v2);
const ids = (items: { id: string }[]) => items.map((item) => item.id);
const texts = (items: { text: string }[]) => items.map((item) => item.text);

function decision(id: string, risk: string, createdAt: string | null) {
  return {
    id,
    title: id,
    risk,
    createdAt,
    options: [{ label: "Go", phrase: `${id}: go`, recommended: true, why: null }],
  };
}

describe("sortDecisions", () => {
  it("puts production and security first, then the oldest", () => {
    const sorted = sortDecisions(
      parse({
        schema: 2,
        updatedAt: "2026-10-20T17:00:00.000Z",
        decisions: [
          decision("new-plain", "none", "2026-10-20T16:00:00.000Z"),
          decision("new-prod", "production", "2026-10-20T15:00:00.000Z"),
          decision("old-plain", "staging", "2026-10-18T10:00:00.000Z"),
          decision("old-security", "security", "2026-10-19T10:00:00.000Z"),
          decision("money", "money", "2026-10-17T10:00:00.000Z"),
          decision("undated", "none", null),
        ],
      }).decisions,
    );
    expect(ids(sorted)).toEqual(["old-security", "new-prod", "money", "old-plain", "new-plain", "undated"]);
  });

  it("treats an unrecognised risk as urgent", () => {
    const sorted = sortDecisions(
      parse({
        schema: 1,
        updatedAt: "2026-10-20T17:00:00.000Z",
        decisions: [decision("plain", "none", "2026-10-19T10:00:00.000Z"), decision("odd", "prod", "2026-10-20T10:00:00.000Z")],
      }).decisions,
    );
    expect(ids(sorted)).toEqual(["odd", "plain"]);
  });

  it("keeps the feed's order for ties and never mutates its input", () => {
    const input = parse(v1).decisions;
    const before = ids(input);
    sortDecisions(input);
    expect(ids(input)).toEqual(before);
  });
});

describe("sortRecent", () => {
  it("defaults to newest first", () => {
    const shuffled = [...board.recent].reverse();
    expect(texts(sortRecent(shuffled, "newest", board))).toEqual(texts(board.recent));
  });

  it("puts blocked items first, longest waiting first, then the rest newest first", () => {
    const events = parse({
      ...v2,
      recent: [
        { at: "2026-10-20T16:00:00.000Z", project: "demo", kind: "merged", text: "a" },
        { at: "2026-10-20T15:00:00.000Z", project: "demo", kind: "blocked", text: "b" },
        { at: "2026-10-20T14:00:00.000Z", project: "site", kind: "done", text: "c" },
        { at: "2026-10-20T13:00:00.000Z", project: "site", kind: "blocked", text: "d" },
      ],
    }).recent;
    expect(texts(sortRecent(events, "oldest-waiting", board))).toEqual(["d", "b", "a", "c"]);
  });

  it("groups by project in the feed's project order, newest first within each", () => {
    const sorted = sortRecent(board.recent, "project", board);
    expect(sorted.map((event) => event.project)).toEqual([
      "demo", "demo", "demo", "demo", "factory", "factory", "factory", "site",
    ]);
    expect(texts(sorted.slice(0, 2))).toEqual(["Consent form layout merged to staging", "Payments review is waiting on a test account"]);
  });

  it("keeps events without a project last and newest first when grouping by project", () => {
    const events = parse({
      ...v2,
      recent: [
        { at: "2026-10-20T10:00:00.000Z", project: null, kind: "done", text: "old, no project" },
        { at: "2026-10-20T16:00:00.000Z", project: null, kind: "done", text: "new, no project" },
        { at: "2026-10-20T12:00:00.000Z", project: "site", kind: "done", text: "site" },
        { at: "2026-10-20T11:00:00.000Z", project: null, kind: "done", text: "middle, no project" },
      ],
    }).recent;
    expect(texts(sortRecent(events, "project", board))).toEqual([
      "site",
      "new, no project",
      "middle, no project",
      "old, no project",
    ]);
  });

  it("puts events from projects with decisions waiting on Nick first", () => {
    const quiet = parse({ ...v2, decisions: (v2.decisions as { project: string }[]).filter((d) => d.project === "factory") });
    const sorted = sortRecent(quiet.recent, "needs-nick", quiet);
    expect(sorted.slice(0, 3).map((event) => event.project)).toEqual(["factory", "factory", "factory"]);
    expect(texts(sorted.slice(3, 5))).toEqual(["Consent form layout merged to staging", "Payments review is waiting on a test account"]);
  });

  it("sorts unreadable times last", () => {
    const events = parse({
      ...v2,
      recent: [
        { at: "whenever", project: "demo", kind: "done", text: "x" },
        { at: "2026-10-20T13:00:00.000Z", project: "demo", kind: "done", text: "y" },
      ],
    }).recent;
    expect(texts(sortRecent(events, "newest", board))).toEqual(["y", "x"]);
  });
});

describe("withEventKeys", () => {
  it("keys each event by what it is, not where it sits in the list", () => {
    const before = withEventKeys(board.recent);
    const after = withEventKeys([
      { at: "2026-10-20T16:59:00.000Z", project: "factory", kind: "merged", text: "newer", link: null },
      ...board.recent,
    ]);
    expect(after.slice(1).map((item) => item.key)).toEqual(before.map((item) => item.key));
    expect(new Set(before.map((item) => item.key)).size).toBe(before.length);
  });

  it("tells identical events apart", () => {
    const event = board.recent[0]!;
    const keys = withEventKeys([event, { ...event }]).map((item) => item.key);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("filterRecent", () => {
  it("keeps every event for all projects and one project's events otherwise", () => {
    expect(filterRecent(board.recent, null)).toHaveLength(8);
    expect(filterRecent(board.recent, "site").map((event) => event.text)).toEqual(["Website deploy worker started"]);
    expect(filterRecent(board.recent, "nope")).toEqual([]);
  });
});

describe("projectName", () => {
  it("uses the display name, falling back to the id", () => {
    expect(projectName(board, "demo")).toBe("Demo clinic");
    expect(projectName(board, "unknown-id")).toBe("unknown-id");
    expect(projectName(board, null)).toBeNull();
  });
});

describe("projectSlice", () => {
  it("collects one project's decisions, work, coming-up items, activity and launches", () => {
    const slice = projectSlice(board, "demo");
    expect(slice.project?.name).toBe("Demo clinic");
    expect(ids(slice.decisions)).toEqual(["demo-release", "demo-copy"]);
    expect(texts(slice.inFlight)).toEqual(["Consent form rebuild", "Payments review"]);
    expect(slice.comingUp.map((item) => item.title)).toEqual(["Payments retry policy"]);
    expect(slice.recent).toHaveLength(4);
    expect(slice.launches.map((launch) => launch.id)).toEqual(["demo-launch"]);
    expect(slice.stats).toEqual({ prsMerged: 3, releases: 1 });
  });

  it("returns an empty slice for a project the board does not list", () => {
    const slice = projectSlice(board, "gone");
    expect(slice.project).toBeNull();
    expect(slice.decisions).toEqual([]);
    expect(slice.stats).toBeNull();
  });
});

describe("losAngelesDay", () => {
  it("names the Los Angeles calendar day of a time", () => {
    expect(losAngelesDay(Date.parse("2026-10-21T06:30:00.000Z"))).toBe("2026-10-20");
    expect(losAngelesDay(Date.parse("2026-10-21T07:30:00.000Z"))).toBe("2026-10-21");
  });
});

describe("doneToday", () => {
  const now = Date.parse("2026-10-20T17:00:00.000Z");

  it("keeps the stats day's done items, newest first", () => {
    expect(texts(doneToday(board, now))).toEqual(["Factory board feed merged", "Demo staging accepted"]);
  });

  it("uses the Los Angeles day for a schema 1 board and keeps undated items", () => {
    const legacy = parse({
      ...v1,
      done: [
        { text: "evening", at: "2026-10-21T05:00:00.000Z" },
        { text: "undated", at: null },
        { text: "two days ago", at: "2026-10-18T20:00:00.000Z" },
      ],
    });
    expect(texts(doneToday(legacy, now))).toEqual(["evening", "undated"]);
  });
});

describe("projectFromLocation", () => {
  it("reads ?project= on the sidebar page", () => {
    expect(projectFromLocation("", "?project=demo")).toBe("demo");
    expect(projectFromLocation("", "?x=1&project=sccc-wp")).toBe("sccc-wp");
  });

  it("reads the project/<id> sub-path the panel navigates to", () => {
    expect(projectFromLocation("project/demo", "")).toBe("demo");
  });

  it("ignores anything that is not a project id", () => {
    expect(projectFromLocation("", "")).toBeNull();
    expect(projectFromLocation("", "?project=")).toBeNull();
    expect(projectFromLocation("project/a/b", "")).toBeNull();
    expect(projectFromLocation("", "?project=%3Cscript%3E")).toBeNull();
  });
});
