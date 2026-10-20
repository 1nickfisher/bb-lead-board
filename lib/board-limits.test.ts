import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BOARD_LIMITS } from "./board";

// The feed's limits (TYP-1568, schema 2 fields from TYP-1795). The panel and
// the feed land on separate branches, so until the schema 2 file is in the
// repo the panel's copy must contain it; once it is, they must match exactly.
// BOARD_LIMITS_FILE checks another copy, such as the feed branch's.
const LIMITS_FILE =
  process.env.BOARD_LIMITS_FILE ?? fileURLToPath(new URL("../../../schemas/board-limits.json", import.meta.url));
const file = existsSync(LIMITS_FILE) ? (JSON.parse(readFileSync(LIMITS_FILE, "utf8")) as Record<string, unknown>) : null;
const schema2 = (file?.board as Record<string, unknown> | undefined)?.checkedAt !== undefined;

describe("BOARD_LIMITS", () => {
  it.skipIf(!schema2)("matches schemas/board-limits.json exactly", () => {
    expect(BOARD_LIMITS).toEqual(file);
  });

  it.skipIf(file === null || schema2)("contains the schema 1 limits file until the schema 2 file lands", () => {
    expect(BOARD_LIMITS).toMatchObject(file!);
  });
});
