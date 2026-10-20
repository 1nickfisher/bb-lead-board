// The speech contract shared by the server (server.ts) and the board host's
// entry (host.ts). Audio is base64 mp3; reasons never carry credentials.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const MAX_SPEECH_TEXT = 3000;

const speakInput = z.object({ text: z.string().trim().min(1).max(MAX_SPEECH_TEXT) }).strict();
const speakOutput = z.union([
  z.object({ ok: z.literal(true), mimeType: z.literal("audio/mpeg"), audio: z.string() }).strict(),
  z.object({ ok: z.literal(false), reason: z.string() }).strict(),
]);
const statusOutput = z.object({ available: z.boolean(), reason: z.string().nullable() }).strict();

export const hostContract = defineRpcContract({
  speak: { input: speakInput, output: speakOutput },
  status: { input: z.object({}).strict(), output: statusOutput },
});

export const serverContract = defineRpcContract({
  speak: { input: speakInput, output: speakOutput },
  voiceStatus: { input: z.object({}).strict(), output: statusOutput },
});

export type SpeakResult = z.infer<typeof speakOutput>;
export type VoiceStatus = z.infer<typeof statusOutput>;
