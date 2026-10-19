// bb-plugin-lead-board backend. The panel itself runs in the app with the
// signed-in user's session (it reads board.json through bb's file API and
// posts option phrases as the user), so the server only declares settings.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  isBoardPath,
  isHostId,
  isThreadId,
} from "./lib/config";

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
  bb.settings.define(settingDescriptors);
}
