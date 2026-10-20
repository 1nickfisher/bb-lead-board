import { describe, expect, it } from "vitest";
import v1 from "../fixtures/board.json";
import v2 from "../fixtures/board-v2.json";
import { parseBoard, type Board } from "./board";
import { askedAge, formatAgo, freshness } from "./freshness";

const MIN = 60_000;

function parse(value: unknown): Board {
  const parsed = parseBoard(JSON.stringify(value));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.board;
}

function withTimes(checkedAt: unknown, updatedAt = "2026-10-20T16:00:00.000Z"): Board {
  return parse({ ...v2, checkedAt, updatedAt });
}

const CHECKED = Date.parse("2026-10-20T17:00:00.000Z");

describe("formatAgo", () => {
  it.each([
    [0, "just now"],
    [59_000, "just now"],
    [MIN, "1 min ago"],
    [59 * MIN, "59 min ago"],
    [60 * MIN, "1 h ago"],
    [3 * 60 * MIN + 40 * MIN, "3 h ago"],
    [24 * 60 * MIN, "1 d ago"],
    [50 * 60 * MIN, "2 d ago"],
  ])("formats %d ms as %j", (age, label) => {
    expect(formatAgo("2026-10-20T17:00:00.000Z", CHECKED + age)).toBe(label);
  });

  it("returns null for an unreadable or future time", () => {
    expect(formatAgo("soon", CHECKED)).toBeNull();
    expect(formatAgo("2026-10-20T17:10:00.000Z", CHECKED)).toBeNull();
  });
});

describe("freshness, schema 2", () => {
  it("shows when the feed last checked and when the board last changed", () => {
    const fresh = freshness(withTimes("2026-10-20T17:00:00.000Z", "2026-10-20T16:12:00.000Z"), CHECKED + 2 * MIN);
    expect(fresh.label).toBe("checked 2 min ago · last change 50 min ago");
    expect(fresh.stale).toBe(false);
  });

  it("is not stale when nothing changed for hours but the feed keeps checking", () => {
    const fresh = freshness(withTimes("2026-10-20T17:00:00.000Z", "2026-10-20T09:00:00.000Z"), CHECKED + 3 * MIN);
    expect(fresh.stale).toBe(false);
  });

  it("is not stale at exactly 10 minutes since the last check", () => {
    expect(freshness(withTimes("2026-10-20T17:00:00.000Z"), CHECKED + 10 * MIN).stale).toBe(false);
  });

  it("is stale once the last check is over 10 minutes old", () => {
    const fresh = freshness(withTimes("2026-10-20T17:00:00.000Z"), CHECKED + 10 * MIN + 1);
    expect(fresh.stale).toBe(true);
    expect(fresh.staleMinutes).toBe(10);
  });

  it.each([null, "garbage", "2026-10-20T17:30:00.000Z"])("is stale when checkedAt is %j", (checkedAt) => {
    const fresh = freshness(withTimes(checkedAt), CHECKED);
    expect(fresh.stale).toBe(true);
    expect(fresh.staleMinutes).toBeNull();
    expect(fresh.label).toMatch(/^check time unknown · last change /);
  });
});

describe("freshness, schema 1", () => {
  const board = parse(v1);
  const updated = Date.parse(board.updatedAt);

  it("keeps the updatedAt label and the 15 minute rule", () => {
    expect(freshness(board, updated + 3 * MIN)).toMatchObject({ label: "updated 3 min ago", stale: false });
    expect(freshness(board, updated + 15 * MIN).stale).toBe(false);
    expect(freshness(board, updated + 16 * MIN)).toMatchObject({ stale: true, staleMinutes: 16 });
  });
});

describe("askedAge", () => {
  const now = Date.parse("2026-10-20T17:00:00.000Z");

  it("says how long ago a decision was asked", () => {
    expect(askedAge("2026-10-20T14:00:00.000Z", now)).toEqual({ label: "asked 3 h ago", old: false });
    expect(askedAge("2026-10-20T16:59:30.000Z", now)).toEqual({ label: "asked just now", old: false });
  });

  it("flags a decision waiting over 24 hours", () => {
    expect(askedAge("2026-10-19T17:00:00.000Z", now)).toEqual({ label: "asked 1 d ago", old: false });
    expect(askedAge("2026-10-19T16:59:00.000Z", now)).toEqual({ label: "asked 1 d ago", old: true });
  });

  it("returns null without a usable time", () => {
    expect(askedAge(null, now)).toBeNull();
    expect(askedAge("yesterday", now)).toBeNull();
  });
});
