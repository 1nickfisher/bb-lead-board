// bb-plugin-lead-board host entry: speaks a card in bb-voice's Cartesia voice
// on the board host, where bb-voice keeps its key. Clips are cached per text
// in this plugin's data directory on the host.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { cartesiaRequest, loadCartesiaConfig } from "./lib/cartesia";
import { hostContract } from "./lib/voice-contract";

const NO_VOICE = "bb-voice has no Cartesia key or voice id on this host";
const MAX_CACHED = 200;

async function prune(dir: string): Promise<void> {
  const names = await readdir(dir);
  if (names.length <= MAX_CACHED) return;
  const files = await Promise.all(names.map(async (name) => ({ name, at: (await stat(join(dir, name))).mtimeMs })));
  files.sort((a, b) => a.at - b.at);
  await Promise.all(files.slice(0, files.length - MAX_CACHED).map((file) => rm(join(dir, file.name), { force: true })));
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    status: async () => ((await loadCartesiaConfig()) ? { available: true, reason: null } : { available: false, reason: NO_VOICE }),
    speak: async ({ text }, context) => {
      const config = await loadCartesiaConfig();
      if (config === null) return { ok: false as const, reason: NO_VOICE };
      const dir = join(context.experimental_paths.dataDir, "speech");
      const file = join(dir, `${createHash("sha256").update(`${config.model}\0${config.voiceId}\0${text}`).digest("hex")}.mp3`);
      try {
        return { ok: true as const, mimeType: "audio/mpeg" as const, audio: (await readFile(file)).toString("base64") };
      } catch {
        // Not cached yet.
      }
      const request = cartesiaRequest(config, text);
      let response: Response;
      try {
        response = await fetch(request.url, { ...request.init, signal: context.signal });
      } catch {
        return { ok: false as const, reason: "Cartesia could not be reached" };
      }
      if (!response.ok) return { ok: false as const, reason: `Cartesia answered ${response.status}` };
      const audio = Buffer.from(await response.arrayBuffer());
      await mkdir(dir, { recursive: true });
      await writeFile(file, audio);
      await prune(dir);
      return { ok: true as const, mimeType: "audio/mpeg" as const, audio: audio.toString("base64") };
    },
  },
});
