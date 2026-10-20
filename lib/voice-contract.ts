// The contracts shared by the server (server.ts) and the board host's entry
// (host.ts): speech, and the feed rebuild. Audio is base64 mp3; reasons never
// carry credentials.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { isBoardPath } from "./config";
import { MAX_SPEECH_TEXT } from "./voice-limits";

export { MAX_SPEECH_TEXT };

const speakInput = z.object({ text: z.string().trim().min(1).max(MAX_SPEECH_TEXT) }).strict();
const speakOutput = z.union([
  z.object({ ok: z.literal(true), mimeType: z.literal("audio/mpeg"), audio: z.string() }).strict(),
  z.object({ ok: z.literal(false), reason: z.string() }).strict(),
]);
const statusOutput = z.object({ available: z.boolean(), reason: z.string().nullable() }).strict();
/** No input at all: the client can never choose the command or its arguments. */
const refreshInput = z.object({}).strict();
/**
 * The server adds its own boardPath setting, so the host can refuse when the
 * fixed command would rebuild a different file. It is never a command or argument.
 */
const hostRefreshInput = z.object({ boardPath: z.string().refine(isBoardPath) }).strict();
const hostRefreshOutput = z.union([
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), reason: z.string() }).strict(),
]);
const refreshOutput = z.union([
  z.object({ ok: z.literal(true) }).strict(),
  // retryInMs is set when the server's rate limit refused the rebuild.
  z.object({ ok: z.literal(false), reason: z.string(), retryInMs: z.number().nullable() }).strict(),
]);

export const hostContract = defineRpcContract({
  speak: { input: speakInput, output: speakOutput },
  status: { input: z.object({}).strict(), output: statusOutput },
  refreshBoard: { input: hostRefreshInput, output: hostRefreshOutput },
});

export const serverContract = defineRpcContract({
  speak: { input: speakInput, output: speakOutput },
  voiceStatus: { input: z.object({}).strict(), output: statusOutput },
  refreshBoard: { input: refreshInput, output: refreshOutput },
});

export type SpeakResult = z.infer<typeof speakOutput>;
export type VoiceStatus = z.infer<typeof statusOutput>;
export type RefreshResult = z.infer<typeof hostRefreshOutput>;
export type BoardRefreshResult = z.infer<typeof refreshOutput>;
