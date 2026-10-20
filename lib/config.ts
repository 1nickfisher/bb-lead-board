// Validators shared by server.ts (setting descriptors) and the
// frontend (which re-validates the values it receives).

export const POLL_INTERVAL_MS = 20_000;
/** Schema 1: the board is stale this long after its last change. */
export const STALE_AFTER_MS = 15 * 60_000;
/** Schema 2: the board is stale this long after the feed last checked it. */
export const CHECK_STALE_AFTER_MS = 10 * 60_000;

const HOST_ID = /^host_[a-z0-9]+$/;
const THREAD_ID = /^thr_[a-z0-9]+$/;

export function isHostId(value: unknown): value is string {
  return typeof value === "string" && HOST_ID.test(value);
}

export function isThreadId(value: unknown): value is string {
  return typeof value === "string" && THREAD_ID.test(value);
}

export function isBoardPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    value.endsWith(".json") &&
    !value.split("/").includes("..")
  );
}

export type SettingKey = "boardHostId" | "boardPath" | "leadThreadId";

export interface BoardConfig {
  hostId: string | null;
  path: string | null;
  leadThreadId: string | null;
  voice: boolean;
  /** Required settings that are unset or invalid, in display order. */
  missing: SettingKey[];
}

/** A config with every required setting present. */
export type ReadyConfig = BoardConfig & { hostId: string; path: string; leadThreadId: string };

export function isReady(config: BoardConfig): config is ReadyConfig {
  return config.missing.length === 0;
}

/** "Not configured: set a, b and c in the plugin settings" */
export function notConfiguredMessage(missing: SettingKey[]): string {
  const names =
    missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}` : missing.join("");
  return `Not configured: set ${names} in the plugin settings`;
}

/** Settings arrive over the wire: keep each valid value, leave the rest unset. */
export function resolveConfig(values: Record<string, unknown> | undefined): BoardConfig {
  const v = values ?? {};
  const hostId = isHostId(v.boardHostId) ? v.boardHostId : null;
  const path = isBoardPath(v.boardPath) ? v.boardPath : null;
  const leadThreadId = isThreadId(v.leadThreadId) ? v.leadThreadId : null;
  const missing: SettingKey[] = [];
  if (hostId === null) missing.push("boardHostId");
  if (path === null) missing.push("boardPath");
  if (leadThreadId === null) missing.push("leadThreadId");
  return { hostId, path, leadThreadId, voice: v.voice === true, missing };
}
