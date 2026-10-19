import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BOARD_LIMITS } from "./board";

// The feed's limits (TYP-1568). Until both branches land the file may be
// absent; once it is in the repo, the panel's copy must match it exactly.
const LIMITS_FILE = fileURLToPath(new URL("../../../schemas/board-limits.json", import.meta.url));

describe("BOARD_LIMITS", () => {
  it.skipIf(!existsSync(LIMITS_FILE))("matches schemas/board-limits.json", () => {
    expect(BOARD_LIMITS).toEqual(JSON.parse(readFileSync(LIMITS_FILE, "utf8")));
  });
});
