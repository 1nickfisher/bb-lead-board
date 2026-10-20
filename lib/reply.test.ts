import { describe, expect, it } from "vitest";
import v2 from "../fixtures/board-v2.json";
import { parseBoard, type Board } from "./board";
import { composeReply, replyTarget } from "./reply";

function parse(value: unknown): Board {
  const parsed = parseBoard(JSON.stringify(value));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.board;
}

const board = parse(v2);

describe("replyTarget", () => {
  it("references a decision by title and id", () => {
    const target = replyTarget({ kind: "decision", decision: board.decisions[1]! });
    expect(target.reference).toBe("Re: Release Demo 1.2 to production [demo-release]");
    expect(target.draftKey).toBe("decision:demo-release");
  });

  it("references a recent event by its text, project, kind and time", () => {
    const target = replyTarget({ kind: "event", event: board.recent[2]! });
    expect(target.reference).toBe(
      "Re: Payments review is waiting on a test account [demo blocked 2026-10-20T15:55:00.000Z]",
    );
    expect(target.draftKey).toMatch(/^event:[0-9a-z]+$/);
  });

  it("keeps the reference to one line", () => {
    const decision = { ...board.decisions[0]!, title: "Two\nlines" };
    expect(replyTarget({ kind: "decision", decision }).reference).toBe("Re: Two lines [demo-tokens]");
  });
});

describe("composeReply", () => {
  it("puts the reference line first, then Nick's text as written", () => {
    expect(composeReply("Re: X [x]", "  hold this until Friday\nplease  ")).toBe(
      "Re: X [x]\nhold this until Friday\nplease",
    );
  });

  it("returns null for an empty reply", () => {
    expect(composeReply("Re: X [x]", "  \n ")).toBeNull();
  });
});
