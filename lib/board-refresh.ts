// Host side of "force a refresh": rebuild the board feed by running one fixed
// command on the board host. The command and its arguments are constants; the
// panel sends no input, so nothing from the client reaches them. The server
// passes its boardPath setting, and the rebuild runs only when that is the file
// the command writes, so a success always means the panel's own board.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import type { RefreshResult } from "./voice-contract";

export const FACTORY_BIN = "/home/agent/code/factory/bin/factory";
export const REFRESH_ARGS: readonly string[] = Object.freeze(["board", "refresh"]);
const TIMEOUT_MS = 120_000;
const MAX_REASON_LINE = 200;

function lastLine(text: string): string {
  const line = text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).pop() ?? "";
  return line.length > MAX_REASON_LINE ? `${line.slice(0, MAX_REASON_LINE - 1)}…` : line;
}

/** Where factory keeps its state (STATE_ROOT in bin/factory). */
export function factoryStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.FACTORY_STATE_ROOT || join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "factory");
}

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolvePath(path);
  }
}

export async function runBoardRefresh(boardPath: string, signal?: AbortSignal): Promise<RefreshResult> {
  const stateRoot = factoryStateRoot();
  const feed = join(stateRoot, "board.json");
  let board: string;
  try {
    board = await realpath(boardPath);
  } catch {
    return { ok: false, reason: `the configured board file ${boardPath} does not exist on the board host` };
  }
  if (board !== (await canonical(feed))) {
    return { ok: false, reason: `factory board refresh rebuilds ${feed}, not the configured board file ${boardPath}` };
  }
  return execRefresh(stateRoot, signal);
}

function execRefresh(stateRoot: string, signal?: AbortSignal): Promise<RefreshResult> {
  return new Promise((resolve) => {
    execFile(
      FACTORY_BIN,
      [...REFRESH_ARGS],
      {
        cwd: "/home/agent/code/factory",
        // Pin the state root just checked, so the command writes that board.json.
        env: { ...process.env, FACTORY_STATE_ROOT: stateRoot },
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        signal,
        windowsHide: true,
      },
      (error, _stdout, stderr) => {
        if (error === null) return resolve({ ok: true });
        const code = (error as { code?: unknown }).code;
        if (code === "ENOENT" || code === "EACCES") {
          return resolve({ ok: false, reason: `factory is not installed at ${FACTORY_BIN} on the board host` });
        }
        const exit = typeof code === "number" ? `exit ${code}` : (error as { killed?: boolean }).killed ? "timed out" : "failed to run";
        const detail = lastLine(String(stderr ?? ""));
        resolve({ ok: false, reason: `factory board refresh failed (${exit})${detail ? `: ${detail}` : ""}` });
      },
    );
  });
}
