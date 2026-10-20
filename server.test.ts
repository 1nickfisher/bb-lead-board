import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

async function serve(settings: Record<string, string>, answer: (method: string, input: unknown) => unknown) {
  const callHostRpc = vi.fn(async ({ method, input }: { method: string; input: unknown; hostId: string }) =>
    answer(method, input),
  );
  const { bb, harness } = createFakePluginHost({
    pluginId: "lead-board",
    settings,
    experimental_callHostRpc: callHostRpc as never,
  });
  await plugin(bb);
  return { harness, callHostRpc };
}

const CONFIGURED = { boardHostId: "host_board1", boardPath: "/srv/board.json", leadThreadId: "thr_lead1" };

describe("speech rpc", () => {
  it("asks the board host for audio and returns it", async () => {
    const { harness, callHostRpc } = await serve(CONFIGURED, () => ({ ok: true, mimeType: "audio/mpeg", audio: "AQID" }));
    expect(await harness.behavior.callRpc("speak", { text: "Hi." })).toEqual({
      ok: true,
      mimeType: "audio/mpeg",
      audio: "AQID",
    });
    expect(callHostRpc).toHaveBeenCalledWith(
      expect.objectContaining({ method: "speak", input: { text: "Hi." }, hostId: "host_board1" }),
    );
  });

  it("reports the voice status of the board host", async () => {
    const { harness } = await serve(CONFIGURED, () => ({ available: true, reason: null }));
    expect(await harness.behavior.callRpc("voiceStatus", {})).toEqual({ available: true, reason: null });
  });

  it("says unavailable, and calls no host, until the board host is set", async () => {
    const { harness, callHostRpc } = await serve({}, () => ({ available: true, reason: null }));
    expect(await harness.behavior.callRpc("voiceStatus", {})).toEqual({
      available: false,
      reason: "the board host is not set",
    });
    expect(await harness.behavior.callRpc("speak", { text: "Hi." })).toEqual({
      ok: false,
      reason: "the board host is not set",
    });
    expect(callHostRpc).not.toHaveBeenCalled();
  });

  it("turns a host failure into an unavailable answer", async () => {
    const { harness } = await serve(CONFIGURED, () => {
      throw new Error("host offline");
    });
    expect(await harness.behavior.callRpc("voiceStatus", {})).toEqual({
      available: false,
      reason: "the board host did not answer",
    });
  });
});

describe("board refresh rpc", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the board host to rebuild the configured board file, with no input from the client", async () => {
    const { harness, callHostRpc } = await serve(CONFIGURED, () => ({ ok: true }));
    expect(await harness.behavior.callRpc("refreshBoard", {})).toEqual({ ok: true });
    expect(callHostRpc).toHaveBeenCalledWith(
      expect.objectContaining({ method: "refreshBoard", input: { boardPath: "/srv/board.json" }, hostId: "host_board1" }),
    );
  });

  it("passes a custom boardPath setting through, and reports the host's refusal", async () => {
    const reason = "factory board refresh rebuilds /home/a/.local/state/factory/board.json, not the configured board file /data/custom.json";
    const { harness, callHostRpc } = await serve({ ...CONFIGURED, boardPath: "/data/custom.json" }, () => ({ ok: false, reason }));
    expect(await harness.behavior.callRpc("refreshBoard", {})).toEqual({ ok: false, reason, retryInMs: null });
    expect(callHostRpc).toHaveBeenCalledWith(expect.objectContaining({ input: { boardPath: "/data/custom.json" } }));
  });

  it("calls no host when the board file is not set", async () => {
    const { harness, callHostRpc } = await serve({ boardHostId: "host_board1", leadThreadId: "thr_lead1" }, () => ({ ok: true }));
    expect(await harness.behavior.callRpc("refreshBoard", {})).toEqual({
      ok: false,
      reason: "the board file is not set",
      retryInMs: null,
    });
    expect(callHostRpc).not.toHaveBeenCalled();
  });

  it("refuses any input, so the client can never choose the command", async () => {
    const { harness, callHostRpc } = await serve(CONFIGURED, () => ({ ok: true }));
    for (const input of [{ command: "rm -rf /" }, { args: ["board", "add"] }]) {
      await expect(harness.behavior.callRpc("refreshBoard", input)).rejects.toThrow();
    }
    expect(callHostRpc).not.toHaveBeenCalled();
  });

  it("runs at most once per 15 seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-20T18:00:00.000Z"));
    const { harness, callHostRpc } = await serve(CONFIGURED, () => ({ ok: true }));
    expect(await harness.behavior.callRpc("refreshBoard", {})).toEqual({ ok: true });
    vi.setSystemTime(Date.now() + 10_000);
    expect(await harness.behavior.callRpc("refreshBoard", {})).toEqual({
      ok: false,
      reason: "The feed was rebuilt moments ago. Try again in 5 s.",
      retryInMs: 5_000,
    });
    expect(callHostRpc).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 5_000);
    expect(await harness.behavior.callRpc("refreshBoard", {})).toEqual({ ok: true });
    expect(callHostRpc).toHaveBeenCalledTimes(2);
  });

  it("turns a host failure into an error answer", async () => {
    const { harness } = await serve(CONFIGURED, () => {
      throw new Error("host offline");
    });
    expect(await harness.behavior.callRpc("refreshBoard", {})).toEqual({
      ok: false,
      reason: "the board host did not answer",
      retryInMs: null,
    });
  });

  it("calls no host until the board host is set", async () => {
    const { harness, callHostRpc } = await serve({}, () => ({ ok: true }));
    expect(await harness.behavior.callRpc("refreshBoard", {})).toEqual({
      ok: false,
      reason: "the board host is not set",
      retryInMs: null,
    });
    expect(callHostRpc).not.toHaveBeenCalled();
  });
});
