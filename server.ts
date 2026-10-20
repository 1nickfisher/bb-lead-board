// bb-plugin-lead-board backend. The panel itself runs in the app with the
// signed-in user's session (it reads board.json through bb's file API and
// posts option phrases as the user). The server declares settings and relays
// speech requests to the board host's entry (host.ts), which holds bb-voice's
// Cartesia key; only audio comes back. It also relays "rebuild the feed now",
// rate-limited here to once per REFRESH_INTERVAL_MS.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  isBoardPath,
  isHostId,
  isThreadId,
} from "./lib/config";
import { REFRESH_INTERVAL_MS, RefreshLimiter } from "./lib/refresh-limit";
import { hostContract, serverContract, type BoardRefreshResult } from "./lib/voice-contract";

export const settingDescriptors = {
  boardHostId: {
    type: "string",
    label: "Board host",
    description: "Host id of the factory control host that writes board.json.",
    experimental_schema: z.string().refine(isHostId, "Use a host id such as host_abc123."),
  },
  boardPath: {
    type: "string",
    label: "Board file",
    description: "Absolute path of board.json on the board host.",
    experimental_schema: z.string().refine(isBoardPath, "Use an absolute path to a .json file."),
  },
  leadThreadId: {
    type: "string",
    label: "Lead thread",
    description: "Thread that receives the phrase when you tap an option.",
    experimental_schema: z.string().refine(isThreadId, "Use a thread id such as thr_abc123."),
  },
  voice: {
    type: "boolean",
    label: "Voice controls",
    description:
      "Show Read aloud and push-to-talk voice notes. Voice notes are never sent until you confirm them.",
    default: false,
  },
} as const;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define(settingDescriptors);
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const boardHost = async () => {
    const { boardHostId } = await settings.get();
    return isHostId(boardHostId) ? boardHostId : null;
  };
  const NOT_SET = "the board host is not set";
  const NO_ANSWER = "the board host did not answer";
  const limiter = new RefreshLimiter(REFRESH_INTERVAL_MS);

  bb.rpc.register(serverContract, {
    speak: async ({ text }) => {
      const hostId = await boardHost();
      if (hostId === null) return { ok: false as const, reason: NOT_SET };
      try {
        return await host.call("speak", { text }, { hostId, timeoutMs: 30_000 });
      } catch {
        return { ok: false as const, reason: NO_ANSWER };
      }
    },
    refreshBoard: async (): Promise<BoardRefreshResult> => {
      const hostId = await boardHost();
      if (hostId === null) return { ok: false, reason: NOT_SET, retryInMs: null };
      // The host rebuilds only when this is the file the fixed command writes.
      const { boardPath } = await settings.get();
      if (!isBoardPath(boardPath)) return { ok: false, reason: "the board file is not set", retryInMs: null };
      try {
        const result = await limiter.run(() =>
          host.call("refreshBoard", { boardPath }, { hostId, timeoutMs: 130_000 }),
        );
        if (!result.ok) {
          const seconds = Math.ceil(result.retryInMs / 1000);
          return {
            ok: false,
            reason: `The feed was rebuilt moments ago. Try again in ${seconds} s.`,
            retryInMs: result.retryInMs,
          };
        }
        return result.value.ok ? { ok: true } : { ok: false, reason: result.value.reason, retryInMs: null };
      } catch {
        return { ok: false, reason: NO_ANSWER, retryInMs: null };
      }
    },
    voiceStatus: async () => {
      const hostId = await boardHost();
      if (hostId === null) return { available: false, reason: NOT_SET };
      try {
        return await host.call("status", {}, { hostId, timeoutMs: 15_000 });
      } catch {
        return { available: false, reason: NO_ANSWER };
      }
    },
  });
}
