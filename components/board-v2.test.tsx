// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import fixtureV2 from "../fixtures/board-v2.json";
import { resetSentStores } from "./sent-store";

const SETTINGS = { boardHostId: "host_board1", boardPath: "/test/board.json", leadThreadId: "thr_lead1" };
const CHECKED = Date.parse(fixtureV2.checkedAt);

type BoardJson = Record<string, unknown> & { decisions: Record<string, unknown>[] };

function fixture(): BoardJson {
  return JSON.parse(JSON.stringify(fixtureV2)) as BoardJson;
}

function fakeSdk(board: unknown) {
  const content = JSON.stringify(board);
  const read = vi.fn(async () => ({
    path: SETTINGS.boardPath,
    content,
    contentEncoding: "utf8" as const,
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.length,
  }));
  const send = vi.fn(async (_args: unknown) => ({ ok: true as const, delivery: "sent" as const }));
  return { read, send, sdk: { files: { read }, threads: { send } } as unknown as RenderSlotOptions["sdk"] };
}

async function renderPanel(board: unknown = fixture()) {
  const app = await loadPluginApp(() => import("../app"));
  const fake = fakeSdk(board);
  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "thr_lead1", params: null },
    { settings: SETTINGS, sdk: fake.sdk, openFilePreview: () => true, openUrl: () => true },
  );
  await slot.findByRole("heading", { name: "Lead board" });
  await slot.findByText("Rotate the demo tokens");
  return { slot, ...fake };
}

async function renderPage(subPath: string, board: unknown = fixture()) {
  const app = await loadPluginApp(() => import("../app"));
  const fake = fakeSdk(board);
  const slot = renderSlot(app.navPanels[0]!, { subPath }, { settings: SETTINGS, sdk: fake.sdk });
  await slot.findByRole("heading", { name: "Lead board" });
  await waitFor(() => expect(fake.read).toHaveBeenCalled());
  return { slot, ...fake };
}

function sentText(call: unknown[]): string {
  return (call[0] as { input: { text: string }[] }).input[0]!.text;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(CHECKED + 3 * 60_000);
  localStorage.clear();
  resetSentStores();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("home page (schema 2)", () => {
  it("shows when the feed checked and when the board changed", async () => {
    const { slot } = await renderPanel();
    expect(slot.getByTestId("freshness").textContent).toBe("checked 3 min ago · last change 13 min ago");
    expect(slot.queryByTestId("stale-banner")).toBeNull();
  });

  it("shows the stale banner only once checkedAt is over 10 minutes old", async () => {
    vi.setSystemTime(CHECKED + 11 * 60_000);
    const { slot } = await renderPanel();
    expect(slot.getByTestId("stale-banner").textContent).toContain("The feed last checked the board 11 min ago");
  });

  it("is not stale when the board has not changed for hours but was just checked", async () => {
    const board = fixture();
    board.updatedAt = "2026-10-20T08:00:00.000Z";
    const { slot } = await renderPanel(board);
    expect(slot.getByTestId("freshness").textContent).toBe("checked 3 min ago · last change 9 h ago");
    expect(slot.queryByTestId("stale-banner")).toBeNull();
  });

  it("shows today's stats", async () => {
    const { slot } = await renderPanel();
    const stats = within(slot.getByRole("region", { name: "Today" }));
    expect(stats.getByText("Merged today").previousSibling?.textContent).toBe("4");
    expect(stats.getByText("Released today").previousSibling?.textContent).toBe("1");
    expect(stats.getByText("Reviews").previousSibling?.textContent).toBe("6");
    expect(stats.getByText("Workers running").previousSibling?.textContent).toBe("3");
    expect(stats.getByText("Waiting on you").previousSibling?.textContent).toBe("4");
  });

  it("orders decisions production or security first, then oldest", async () => {
    const { slot } = await renderPanel();
    const cards = within(slot.getByRole("region", { name: "Needs you now" })).getAllByRole("article");
    expect(cards.map((card) => card.dataset.decisionId)).toEqual([
      "demo-release",
      "demo-tokens",
      "demo-copy",
      "machine-hygiene-cloudroom2",
    ]);
  });

  it("shows each card's age and flags one waiting over a day", async () => {
    const { slot } = await renderPanel();
    const old = within(slot.getByRole("article", { name: "Rotate the demo tokens" }));
    expect(old.getByTestId("asked-age").textContent).toBe("asked 1 d agoover a day");
    expect(old.getByTestId("asked-age").className).toContain("lb-age-old");
    const recent = within(slot.getByRole("article", { name: "Release Demo 1.2 to production" }));
    expect(recent.getByTestId("asked-age").textContent).toBe("asked 1 h ago");
  });

  it("names a card's risk in a badge with an icon, not by colour alone", async () => {
    const { slot } = await renderPanel();
    const release = within(slot.getByRole("article", { name: "Release Demo 1.2 to production" }));
    expect(release.getByTestId("risk-badge").textContent).toBe("Production");
    expect(release.getByTestId("risk-badge").querySelector("svg")).not.toBeNull();
    expect(within(slot.getByRole("article", { name: "Pick the consent form wording" })).queryByTestId("risk-badge")).toBeNull();
  });

  it("sends explain <decision id> without answering the decision", async () => {
    const { slot, send } = await renderPanel();
    const card = within(slot.getByRole("article", { name: "Release Demo 1.2 to production" }));
    fireEvent.click(card.getByRole("button", { name: "Explain: Release Demo 1.2 to production" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(sentText(send.mock.calls[0]!)).toBe("explain demo-release");
    expect(slot.queryByRole("dialog")).toBeNull();
    expect(card.getByRole("button", { name: /Release$/ })).toBeTruthy();
    expect(card.queryByText(/Sent: waiting for the lead/)).toBeNull();
  });

  it("opens thread and file links with bb navigation and keeps https links", async () => {
    const { slot } = await renderPanel();
    const links = within(within(slot.getByRole("article", { name: "Rotate the demo tokens" })).getByRole("list", { name: "Links" }));
    fireEvent.click(links.getByRole("button", { name: "Lead thread note" }));
    fireEvent.click(links.getByRole("button", { name: "Plan" }));
    expect(links.getByRole("link", { name: "PR 42" }).getAttribute("href")).toBe("https://example.com/demo/pull/42");
    expect(slot.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_demoplan1" });
    expect(slot.navigateCalls).toContainEqual({
      method: "experimental_openFilePreview",
      options: { target: { kind: "thread-storage", threadId: "thr_lead1", path: "plans/demo-tokens.md" }, location: null },
    });
  });

  it("links thread ids mentioned in a card's context", async () => {
    const { slot } = await renderPanel();
    fireEvent.click(slot.getByRole("button", { name: "thr_demoplan1" }));
    expect(slot.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_demoplan1" });
  });

  it("summarises a machine-hygiene card in one line with details collapsed", async () => {
    const { slot } = await renderPanel();
    const card = slot.getByRole("article", { name: "Machine hygiene: cloudroom2" });
    expect(within(card).getByText("cloudroom2: 6 unused images, 705 MB")).toBeTruthy();
    const details = card.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("sha256:aaa111");
  });

  it("shows the launch gauge with counts, blocked gates first, and opens a gate's link", async () => {
    const { slot } = await renderPanel();
    const launch = within(slot.getByRole("region", { name: "Launch: Demo clinic launch" }));
    expect(launch.getByRole("img", { name: "4 done, 2 in progress, 1 blocked, 1 not started of 8 gates" })).toBeTruthy();
    const legend = within(launch.getByRole("list", { name: "Gate status" }));
    expect(legend.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Done 4",
      "In progress 2",
      "Blocked 1",
      "Not started 1",
    ]);
    const blocked = within(launch.getByRole("list", { name: "Blocked gates" }));
    fireEvent.click(blocked.getByRole("button", { name: /Signed safety plan/ }));
    expect(slot.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_gate3" });
  });

  it("sorts and filters recent activity", async () => {
    const { slot } = await renderPanel();
    const recent = slot.getByRole("region", { name: "Recent" });
    const texts = () => Array.from(recent.querySelectorAll(".lb-ev-text")).map((node) => node.textContent);
    expect(texts()[0]).toBe("Consent form layout merged to staging");
    fireEvent.change(within(recent).getByRole("combobox", { name: "Sort recent activity" }), {
      target: { value: "oldest-waiting" },
    });
    expect(texts()[0]).toBe("Payments review is waiting on a test account");
    fireEvent.change(within(recent).getByRole("combobox", { name: "Filter recent activity by project" }), {
      target: { value: "site" },
    });
    expect(texts()).toEqual(["Website deploy worker started"]);
  });

  it("shows the done-today strip with only today's items", async () => {
    const { slot } = await renderPanel();
    const strip = slot.getByRole("region", { name: "Done today" });
    expect(within(strip).getByText("Done today · 2")).toBeTruthy();
    expect(strip.textContent).not.toContain("Yesterday's cleanup");
  });
});

describe("project view", () => {
  it("opens from a project chip in the side panel and returns home", async () => {
    const { slot } = await renderPanel();
    fireEvent.click(within(slot.getByRole("navigation", { name: "Projects" })).getByRole("button", { name: /Demo clinic/ }));
    await slot.findByRole("button", { name: "All projects" });
    const needs = within(slot.getByRole("region", { name: "Needs you now" }));
    expect(needs.getAllByRole("article").map((card) => card.dataset.decisionId)).toEqual(["demo-release", "demo-copy"]);
    expect(slot.getByRole("region", { name: "In flight" }).textContent).toContain("Payments review");
    expect(slot.getByRole("region", { name: "Coming up" }).textContent).toContain("Payments retry policy");
    expect(slot.getByRole("region", { name: "Launch: Demo clinic launch" })).toBeTruthy();
    expect(slot.getByRole("region", { name: "Recent" }).querySelectorAll(".lb-ev")).toHaveLength(4);
    fireEvent.click(slot.getByRole("button", { name: "All projects" }));
    await slot.findByRole("navigation", { name: "Projects" });
  });

  it("switches project with the side panel's switcher", async () => {
    const { slot } = await renderPanel();
    fireEvent.change(slot.getByRole("combobox", { name: "View" }), { target: { value: "factory" } });
    const needs = within(await slot.findByRole("region", { name: "Needs you now" }));
    expect(needs.getAllByRole("article").map((card) => card.dataset.decisionId)).toEqual([
      "demo-tokens",
      "machine-hygiene-cloudroom2",
    ]);
  });

  it("renders a project from the sidebar page's sub-path, with no side panel switcher", async () => {
    const { slot } = await renderPage("project/site");
    await slot.findByRole("heading", { name: "Demo website" });
    expect(slot.queryByRole("combobox", { name: "View" })).toBeNull();
    expect(slot.getByText("Nothing needs you right now.")).toBeTruthy();
  });

  it("navigates the sidebar page to a project's sub-path", async () => {
    const { slot } = await renderPage("");
    fireEvent.click(await slot.findByRole("button", { name: /Factory/ }));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "board",
      options: { subPath: "project/factory" },
    });
  });
});
