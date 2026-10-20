// bb-voice's Cartesia voice, for the host entry (host.ts). The key is read on
// the board host at call time and never leaves it: only audio is returned.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CartesiaConfig {
  apiKey: string;
  voiceId: string;
  model: string;
}

/** bb-voice's settings file (bbvoice/config.py DEFAULT_ENV_FILE). */
export function envFilePath(): string {
  return process.env.BB_VOICE_ENV_FILE || join(homedir(), ".config", "bb-voice", "brain.env");
}

/** KEY=VALUE lines, as python-dotenv reads them: `export`, quotes and comments allowed. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!;
    const quoted = /^(['"])(.*)\1$/.exec(value);
    value = quoted ? quoted[2]! : value.replace(/\s+#.*$/, "").trim();
    values[match[1]!] = value;
  }
  return values;
}

/** The voice bb-voice uses, or null when this host has no key or voice id. */
export async function loadCartesiaConfig(): Promise<CartesiaConfig | null> {
  let text: string;
  try {
    text = await readFile(envFilePath(), "utf8");
  } catch {
    return null;
  }
  const env = parseEnvFile(text);
  const apiKey = env.CARTESIA_API_KEY?.trim();
  const voiceId = (env.CARTESIA_VOICE_ID ?? env.VOICE_CARTESIA_VOICE_ID)?.trim();
  if (!apiKey || !voiceId) return null;
  return { apiKey, voiceId, model: env.CARTESIA_MODEL?.trim() || "sonic-3" };
}

/** Cartesia's bytes endpoint: the whole clip as one mp3. */
export function cartesiaRequest(config: CartesiaConfig, text: string): { url: string; init: RequestInit } {
  return {
    url: "https://api.cartesia.ai/tts/bytes",
    init: {
      method: "POST",
      headers: {
        "X-API-Key": config.apiKey,
        "Cartesia-Version": "2025-04-16",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: config.model,
        transcript: text,
        voice: { mode: "id", id: config.voiceId },
        output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
        language: "en",
      }),
    },
  };
}
