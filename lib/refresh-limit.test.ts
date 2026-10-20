import { describe, expect, it } from "vitest";
import { REFRESH_INTERVAL_MS, RefreshLimiter } from "./refresh-limit";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("RefreshLimiter", () => {
  it("allows once per 15 seconds", async () => {
    let now = 1_000_000;
    const limiter = new RefreshLimiter(REFRESH_INTERVAL_MS, () => now);
    let runs = 0;
    const task = async () => {
      runs += 1;
      return "done";
    };
    expect(REFRESH_INTERVAL_MS).toBe(15_000);
    expect(await limiter.run(task)).toEqual({ ok: true, value: "done" });
    now += 14_000;
    expect(await limiter.run(task)).toEqual({ ok: false, retryInMs: 1_000 });
    expect(runs).toBe(1);
    now += 1_000;
    expect(await limiter.run(task)).toEqual({ ok: true, value: "done" });
    expect(runs).toBe(2);
  });

  it("counts a failed run, so a failing command cannot be hammered", async () => {
    let now = 0;
    const limiter = new RefreshLimiter(REFRESH_INTERVAL_MS, () => now);
    await expect(limiter.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    now += 5_000;
    expect(await limiter.run(async () => "x")).toEqual({ ok: false, retryInMs: 10_000 });
  });

  it("joins a run already in flight instead of starting another", async () => {
    let now = 0;
    const limiter = new RefreshLimiter(REFRESH_INTERVAL_MS, () => now);
    const gate = deferred<string>();
    let runs = 0;
    const task = () => {
      runs += 1;
      return gate.promise;
    };
    const first = limiter.run(task);
    now += 20_000;
    const second = limiter.run(task);
    gate.resolve("built");
    expect(await first).toEqual({ ok: true, value: "built" });
    expect(await second).toEqual({ ok: true, value: "built" });
    expect(runs).toBe(1);
  });
});
