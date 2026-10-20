// The board host's refresh handler runs one fixed command; nothing the client
// sends can choose or change it.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";

type Callback = (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void;
const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));

import { FACTORY_BIN, REFRESH_ARGS } from "./lib/board-refresh";

let dir: string;
/** The board file factory rebuilds: $FACTORY_STATE_ROOT/board.json. */
let feed: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lead-board-refresh-"));
  mkdirSync(join(dir, "state"));
  feed = join(dir, "state", "board.json");
  writeFileSync(feed, "{}");
  vi.stubEnv("FACTORY_STATE_ROOT", join(dir, "state"));
  execFile.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function harness() {
  const { default: entry } = await import("./host");
  return experimental_createHostEntryHarness(entry, {
    experimental_paths: { dataDir: join(dir, "data"), tempDir: join(dir, "tmp") },
  });
}

function answer(error: (Error & { code?: unknown }) | null, stderr = "") {
  execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: Callback) => {
    callback(error, "", stderr);
    return {};
  });
}

describe("refreshBoard host handler", () => {
  it("runs exactly bin/factory board refresh, without a shell", async () => {
    expect(FACTORY_BIN).toBe("/home/agent/code/factory/bin/factory");
    expect(REFRESH_ARGS).toEqual(["board", "refresh"]);
    expect(Object.isFrozen(REFRESH_ARGS)).toBe(true);
    answer(null);
    const host = await harness();
    expect(await host.experimental_call("refreshBoard", { boardPath: feed })).toEqual({ ok: true });
    expect(execFile).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFile.mock.calls[0]!;
    expect(file).toBe(FACTORY_BIN);
    expect(args).toEqual(["board", "refresh"]);
    expect((options as { shell?: unknown }).shell).toBeFalsy();
    await host.experimental_dispose();
  });

  it("refuses any input, so the client can never pass a command or arguments", async () => {
    answer(null);
    const host = await harness();
    for (const input of [
      {},
      { command: "rm -rf /" },
      { args: ["--help"] },
      { path: "/bin/sh" },
      { boardPath: feed, command: "rm -rf /" },
      { boardPath: "relative/board.json" },
      { boardPath: "/srv/../etc/board.json" },
      { boardPath: "/bin/sh" },
    ]) {
      await expect(host.experimental_call("refreshBoard", input as never)).rejects.toThrow();
    }
    expect(execFile).not.toHaveBeenCalled();
    await host.experimental_dispose();
  });

  it("reports a failure with its exit code and last error line, clipped", async () => {
    answer(Object.assign(new Error("Command failed"), { code: 2 }), `warming up\nboard: ${"x".repeat(400)}\n`);
    const host = await harness();
    const result = (await host.experimental_call("refreshBoard", { boardPath: feed })) as { ok: false; reason: string };
    expect(result.ok).toBe(false);
    expect(result.reason.startsWith("factory board refresh failed (exit 2): board: xxx")).toBe(true);
    expect(result.reason.length).toBeLessThanOrEqual(260);
    await host.experimental_dispose();
  });

  it("says when factory is not installed on the board host", async () => {
    answer(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    const host = await harness();
    expect(await host.experimental_call("refreshBoard", { boardPath: feed })).toEqual({
      ok: false,
      reason: `factory is not installed at ${FACTORY_BIN} on the board host`,
    });
    await host.experimental_dispose();
  });

  it("refuses, without running anything, when boardPath is not the file factory rebuilds", async () => {
    answer(null);
    const custom = join(dir, "custom-board.json");
    writeFileSync(custom, "{}");
    const host = await harness();
    expect(await host.experimental_call("refreshBoard", { boardPath: custom })).toEqual({
      ok: false,
      reason: `factory board refresh rebuilds ${feed}, not the configured board file ${custom}`,
    });
    expect(execFile).not.toHaveBeenCalled();
    await host.experimental_dispose();
  });

  it("follows the same state root factory uses, so a custom FACTORY_STATE_ROOT board refreshes", async () => {
    answer(null);
    mkdirSync(join(dir, "elsewhere"));
    const moved = join(dir, "elsewhere", "board.json");
    writeFileSync(moved, "{}");
    vi.stubEnv("FACTORY_STATE_ROOT", join(dir, "elsewhere"));
    const host = await harness();
    expect(await host.experimental_call("refreshBoard", { boardPath: moved })).toEqual({ ok: true });
    const options = execFile.mock.calls[0]![2] as { env?: Record<string, string> };
    expect(options.env?.FACTORY_STATE_ROOT).toBe(join(dir, "elsewhere"));
    await host.experimental_dispose();
  });

  it("accepts a boardPath that is a symlink to the factory feed", async () => {
    answer(null);
    const link = join(dir, "link-board.json");
    symlinkSync(feed, link);
    const host = await harness();
    expect(await host.experimental_call("refreshBoard", { boardPath: link })).toEqual({ ok: true });
    await host.experimental_dispose();
  });

  it("reports a missing board file instead of rebuilding", async () => {
    answer(null);
    rmSync(feed);
    const host = await harness();
    expect(await host.experimental_call("refreshBoard", { boardPath: feed })).toEqual({
      ok: false,
      reason: `the configured board file ${feed} does not exist on the board host`,
    });
    expect(execFile).not.toHaveBeenCalled();
    await host.experimental_dispose();
  });
});
