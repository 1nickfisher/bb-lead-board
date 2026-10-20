import { describe, expect, it, vi } from "vitest";
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
