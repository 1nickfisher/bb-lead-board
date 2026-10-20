import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { cartesiaRequest, parseEnvFile } from "./lib/cartesia";

// Synthetic values only: never a real key.
const FAKE_KEY = "fake-key-for-tests";

let dir: string;
let envFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lead-board-host-"));
  envFile = join(dir, "brain.env");
  vi.stubEnv("BB_VOICE_ENV_FILE", envFile);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

async function harness() {
  const { default: entry } = await import("./host");
  return experimental_createHostEntryHarness(entry, {
    experimental_paths: { dataDir: join(dir, "data"), tempDir: join(dir, "tmp") },
  });
}

describe("parseEnvFile", () => {
  it("reads KEY=VALUE lines, quotes and export, ignoring comments", () => {
    expect(
      parseEnvFile('# c\nexport CARTESIA_API_KEY="abc"\nCARTESIA_VOICE_ID=v1 # trailing\nEMPTY=\nOTHER=\'x y\'\n'),
    ).toEqual({ CARTESIA_API_KEY: "abc", CARTESIA_VOICE_ID: "v1", EMPTY: "", OTHER: "x y" });
  });
});

describe("cartesiaRequest", () => {
  it("asks Cartesia for an mp3 of the text in bb-voice's voice", () => {
    const request = cartesiaRequest({ apiKey: FAKE_KEY, voiceId: "voice-1", model: "sonic-3" }, "Hello there.");
    expect(request.url).toBe("https://api.cartesia.ai/tts/bytes");
    expect(request.init.method).toBe("POST");
    expect((request.init.headers as Record<string, string>)["X-API-Key"]).toBe(FAKE_KEY);
    expect(JSON.parse(String(request.init.body))).toEqual({
      model_id: "sonic-3",
      transcript: "Hello there.",
      voice: { mode: "id", id: "voice-1" },
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      language: "en",
    });
  });
});

describe("host entry", () => {
  it("reports the voice unavailable without a key or voice id", async () => {
    writeFileSync(envFile, "CARTESIA_API_KEY=\n");
    const host = await harness();
    expect(await host.experimental_call("status", {})).toEqual({
      available: false,
      reason: "bb-voice has no Cartesia key or voice id on this host",
    });
    expect(await host.experimental_call("speak", { text: "Hi." })).toEqual({
      ok: false,
      reason: "bb-voice has no Cartesia key or voice id on this host",
    });
    await host.experimental_dispose();
  });

  it("speaks with the key from the host and caches the clip", async () => {
    writeFileSync(envFile, `CARTESIA_API_KEY=${FAKE_KEY}\nCARTESIA_VOICE_ID=voice-1\n`);
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const host = await harness();
    expect(await host.experimental_call("status", {})).toEqual({ available: true, reason: null });
    const first = await host.experimental_call("speak", { text: "Hi." });
    expect(first).toEqual({ ok: true, mimeType: "audio/mpeg", audio: "AQID" });
    expect(await host.experimental_call("speak", { text: "Hi." })).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(readdirSync(join(dir, "data", "speech"))).toHaveLength(1);
    await host.experimental_dispose();
  });

  it("never returns the key in an error", async () => {
    writeFileSync(envFile, `CARTESIA_API_KEY=${FAKE_KEY}\nCARTESIA_VOICE_ID=voice-1\n`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`bad key ${FAKE_KEY}`, { status: 401 })),
    );
    const host = await harness();
    const result = await host.experimental_call("speak", { text: "Hi." });
    expect(result).toEqual({ ok: false, reason: "Cartesia answered 401" });
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
    await host.experimental_dispose();
  });

  it("reports a network failure without details", async () => {
    writeFileSync(envFile, `CARTESIA_API_KEY=${FAKE_KEY}\nCARTESIA_VOICE_ID=voice-1\n`);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error(`boom ${FAKE_KEY}`))));
    const host = await harness();
    expect(await host.experimental_call("speak", { text: "Hi." })).toEqual({
      ok: false,
      reason: "Cartesia could not be reached",
    });
    await host.experimental_dispose();
  });
});
