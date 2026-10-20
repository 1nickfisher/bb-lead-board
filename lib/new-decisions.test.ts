import { describe, expect, it } from "vitest";
import { detectNewDecisions } from "./new-decisions";

describe("detectNewDecisions", () => {
  it("never announces the first load", () => {
    const first = detectNewDecisions(null, ["a", "b"]);
    expect(first.fresh).toEqual([]);
    expect(first.chime).toBe(false);
    expect([...first.seen].sort()).toEqual(["a", "b"]);
  });

  it("treats an empty first board as a first load too", () => {
    const first = detectNewDecisions(null, []);
    expect(first.chime).toBe(false);
    const next = detectNewDecisions(first.seen, ["a"]);
    expect(next.fresh).toEqual(["a"]);
    expect(next.chime).toBe(true);
  });

  it("is silent when a poll repeats the same ids", () => {
    const first = detectNewDecisions(null, ["a", "b"]);
    const again = detectNewDecisions(first.seen, ["b", "a"]);
    expect(again.fresh).toEqual([]);
    expect(again.chime).toBe(false);
  });

  it("is silent when a decision leaves the board", () => {
    const first = detectNewDecisions(null, ["a", "b"]);
    expect(detectNewDecisions(first.seen, ["a"]).chime).toBe(false);
  });

  it("chimes once for several new ids and highlights each, in feed order", () => {
    const first = detectNewDecisions(null, ["a"]);
    const next = detectNewDecisions(first.seen, ["c", "a", "b", "c"]);
    expect(next.fresh).toEqual(["c", "b"]);
    expect(next.chime).toBe(true);
    expect(detectNewDecisions(next.seen, ["a", "b", "c"]).chime).toBe(false);
  });

  it("does not announce an id again when it leaves and returns", () => {
    const first = detectNewDecisions(null, ["a", "b"]);
    const gone = detectNewDecisions(first.seen, ["a"]);
    const back = detectNewDecisions(gone.seen, ["a", "b"]);
    expect(back.chime).toBe(false);
  });
});
