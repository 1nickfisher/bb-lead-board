import { describe, expect, it } from "vitest";
import v2 from "../fixtures/board-v2.json";
import { parseBoard, type Decision } from "./board";
import { formatBytes, hygieneSummary } from "./hygiene";

function hygieneDecision(context: string, overrides: Record<string, unknown> = {}): Decision {
  const parsed = parseBoard(
    JSON.stringify({
      schema: 2,
      updatedAt: "2026-10-20T17:00:00.000Z",
      decisions: [
        {
          id: "machine-hygiene-cloudroom2",
          title: "Machine hygiene: cloudroom2",
          project: "factory",
          tag: "machine-hygiene",
          context,
          risk: "none",
          options: [{ label: "Keep", phrase: "Keep hygiene", recommended: true, why: null }],
          ...overrides,
        },
      ],
    }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.board.decisions[0]!;
}

const PREFIX =
  "2026-W43: 3 verified unused candidates, 1500000 bytes (image sizes may share layers). Inventory 0123456789ab. " +
  "Explicit Nick approval or a matching standing approval is required before deletion; recheck use and identity then. No changes made. ";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [999, "999 B"],
    [1500, "2 kB"],
    [705_000_000, "705 MB"],
    [1_250_000_000, "1.3 GB"],
    [12_000_000_000, "12 GB"],
  ])("formats %d as %j", (bytes, label) => {
    expect(formatBytes(bytes)).toBe(label);
  });
});

describe("hygieneSummary", () => {
  it("summarises the fixture's card in one line", () => {
    const parsed = parseBoard(JSON.stringify(v2));
    if (!parsed.ok) throw new Error(parsed.error);
    const card = parsed.board.decisions.find((decision) => decision.id === "machine-hygiene-cloudroom2")!;
    const summary = hygieneSummary(card)!;
    expect(summary.summary).toBe("cloudroom2: 6 unused images, 705 MB");
    expect(summary.items).toHaveLength(6);
    expect(summary.items[0]).toEqual({ name: "sha256:aaa111", kind: "image", size: "200 MB" });
  });

  it("names the kind when every candidate is listed and of one kind", () => {
    const context = PREFIX + "/tmp/venv-a (1000000 bytes); /tmp/venv-b (400000 bytes); /tmp/venv-c (100000 bytes)";
    expect(hygieneSummary(hygieneDecision(context))?.summary).toBe("cloudroom2: 3 unused virtualenvs, 2 MB");
  });

  it("breaks down mixed candidates", () => {
    const context =
      PREFIX + "sha256:abc (1000000 bytes); /tmp/venv-b (400000 bytes); /home/agent/.cache/ms-playwright/chromium-1 (100000 bytes)";
    expect(hygieneSummary(hygieneDecision(context))?.summary).toBe(
      "cloudroom2: 3 unused items (1 image, 1 virtualenv, 1 browser), 2 MB",
    );
  });

  it("says items when the clipped context lists only some candidates", () => {
    const context = PREFIX + "sha256:abc (1000000 bytes); sha256:def (4000";
    const summary = hygieneSummary(hygieneDecision(context))!;
    expect(summary.summary).toBe("cloudroom2: 3 unused items, 2 MB");
    expect(summary.items).toHaveLength(1);
  });

  it("keeps the policy text for the collapsed details", () => {
    const summary = hygieneSummary(hygieneDecision(PREFIX + "sha256:abc (1000000 bytes)"))!;
    expect(summary.details).toContain("No changes made.");
    expect(summary.details).toContain("Inventory 0123456789ab.");
    expect(summary.details).not.toContain("sha256:abc");
  });

  it("returns null for an ordinary decision or a context it cannot read", () => {
    expect(hygieneSummary(hygieneDecision(PREFIX, { id: "demo", tag: "Release", title: "Release" }))).toBeNull();
    expect(hygieneSummary(hygieneDecision("cleanup soon"))).toBeNull();
  });
});
