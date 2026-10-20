// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import fixtureV2 from "../fixtures/board-v2.json";
import { installFakeAudio, type FakeAudio } from "./fake-audio";
import { resetSentStores } from "./sent-store";
import { MUTE_KEY, resetSoundStore } from "./sound";

const SETTINGS = { boardHostId: "host_board1", boardPath: "/test/board.json", leadThreadId: "thr_lead1" };
const CHECKED = Date.parse(fixtureV2.checkedAt);

type BoardJson = Record<string, unknown> & { decisions: Record<string, unknown>[] };

function fixture(): BoardJson {
  return JSON.parse(JSON.stringify(fixtureV2)) as BoardJson;
}

/** A fake board host: `host.content` is what the next files.read returns. */
function fakeSdk(board: unknown) {
  const host = { content: JSON.stringify(board) };
  const read = vi.fn(async () => ({
    path: SETTINGS.boardPath,
    content: host.content,
    contentEncoding: "utf8" as const,
    sha256: createHash("sha256").update(host.content).digest("hex"),
    sizeBytes: host.content.length,
  }));
  const send = vi.fn(async (_args: unknown) => ({ ok: true as const, delivery: "sent" as const }));
  return { host, read, send, sdk: { files: { read }, threads: { send } } as unknown as RenderSlotOptions["sdk"] };
}

type Slot = Awaited<ReturnType<typeof renderPanel>>["slot"];

/** Open the collapsed project list. */
function openProjects(slot: Slot) {
  const toggle = slot.getByRole("button", { name: /^Projects/ });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  return within(slot.getByRole("navigation", { name: "Projects" }));
}

async function renderPanel(board: unknown = fixture(), rpc?: RenderSlotOptions["rpc"]) {
  const app = await loadPluginApp(() => import("../app"));
  const fake = fakeSdk(board);
  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "thr_lead1", params: null },
    { settings: SETTINGS, sdk: fake.sdk, openFilePreview: () => true, openUrl: () => true, rpc },
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
  sessionStorage.clear();
  resetSentStores();
  resetSoundStore();
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
    fireEvent.click(openProjects(slot).getByRole("button", { name: /Demo clinic/ }));
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
    await slot.findByRole("button", { name: /^Projects/ });
    fireEvent.click(openProjects(slot as unknown as Slot).getByRole("button", { name: /Factory/ }));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "board",
      options: { subPath: "project/factory" },
    });
  });
});

describe("projects accordion (TYP-1869)", () => {
  it("starts collapsed with a one-line summary and opens on click", async () => {
    const { slot } = await renderPanel();
    const toggle = slot.getByRole("button", { name: /^Projects/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(slot.getByTestId("projects-summary").textContent).toBe("3 projects · 2 need you · 1 blocked");
    expect(slot.queryByRole("navigation", { name: "Projects" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(slot.getByRole("navigation", { name: "Projects" })).toBeTruthy();
    fireEvent.click(toggle);
    expect(slot.queryByRole("navigation", { name: "Projects" })).toBeNull();
  });

  it("remembers open or closed for the window", async () => {
    const first = await renderPanel();
    openProjects(first.slot);
    cleanup();
    const second = await renderPanel();
    expect(second.slot.getByRole("button", { name: /^Projects/ }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(second.slot.getByRole("button", { name: /^Projects/ }));
    cleanup();
    const third = await renderPanel();
    expect(third.slot.getByRole("button", { name: /^Projects/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("orders chips by status and labels each status with an icon and words", async () => {
    const { slot } = await renderPanel();
    const chips = openProjects(slot).getAllByRole("button");
    expect(chips.map((chip) => [chip.dataset.projectId, chip.dataset.status])).toEqual([
      ["demo", "urgent"],
      ["factory", "needs-you"],
      ["site", "active"],
    ]);
    expect(chips.map((chip) => chip.querySelector(".lb-chip-status")?.textContent)).toEqual([
      "Urgent",
      "Needs you",
      "Active",
    ]);
    expect(chips[0]!.getAttribute("aria-label")).toBe("Demo clinic, needs you, urgent, 2 waiting on you, blocked work");
    for (const chip of chips) expect(chip.querySelector("svg.lb-chip-icon")).not.toBeNull();
    expect(chips[0]!.textContent).toContain("blocked");
  });
});

describe("new-decision sound (TYP-1869)", () => {
  let audio: FakeAudio;

  beforeEach(() => {
    audio = installFakeAudio();
  });

  afterEach(() => {
    audio.uninstall();
  });

  function withDecision(board: BoardJson, id: string): BoardJson {
    const copy = JSON.parse(JSON.stringify(board)) as BoardJson;
    copy.decisions.push({ ...copy.decisions[2]!, id, title: `Decision ${id}` });
    return copy;
  }

  async function poll(slot: Slot, read: ReturnType<typeof fakeSdk>["read"]) {
    const calls = read.mock.calls.length;
    fireEvent.click(slot.getByRole("button", { name: "Refresh the board" }));
    await waitFor(() => expect(read.mock.calls.length).toBe(calls + 1));
    await act(async () => {});
  }

  async function arm() {
    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
    });
  }

  it("hints until a user gesture arms the sound, then hides the hint", async () => {
    const { slot } = await renderPanel();
    expect(slot.getByTestId("sound-hint").textContent).toContain("turn on the sound");
    await arm();
    expect(slot.queryByTestId("sound-hint")).toBeNull();
  });

  it("never chimes or highlights on the first load", async () => {
    const { slot } = await renderPanel();
    await arm();
    expect(audio.chimes()).toBe(0);
    expect(slot.queryByTestId("new-badge")).toBeNull();
  });

  it("chimes once and highlights each new card when a poll brings new decisions", async () => {
    const { slot, host, read } = await renderPanel();
    await arm();
    host.content = JSON.stringify(withDecision(withDecision(fixture(), "new-1"), "new-2"));
    await poll(slot, read);
    await slot.findByText("Decision new-1");
    expect(audio.chimes()).toBe(1);
    const fresh = slot.getAllByRole("article").filter((card) => card.classList.contains("lb-card-new"));
    expect(fresh.map((card) => card.dataset.decisionId).sort()).toEqual(["new-1", "new-2"]);
    expect(slot.getAllByTestId("new-badge")).toHaveLength(2);
  });

  it("stays silent when a poll repeats the same decisions", async () => {
    const { slot, host, read } = await renderPanel();
    await arm();
    host.content = JSON.stringify({ ...fixture(), checkedAt: "2026-10-20T17:00:00.000Z" });
    await poll(slot, read);
    expect(audio.chimes()).toBe(0);
  });

  it("mutes from the header, persisted, and stays silent while muted", async () => {
    const { slot, host, read } = await renderPanel();
    await arm();
    const mute = slot.getByRole("button", { name: "Mute the new-decision sound" });
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(mute);
    const unmute = slot.getByRole("button", { name: "Unmute the new-decision sound" });
    expect(unmute.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem(MUTE_KEY)).toBe("1");
    host.content = JSON.stringify(withDecision(fixture(), "new-1"));
    await poll(slot, read);
    await slot.findByText("Decision new-1");
    expect(audio.chimes()).toBe(0);
    expect(slot.getByTestId("new-badge")).toBeTruthy();
  });

  it("starts muted when the window saved mute", async () => {
    localStorage.setItem(MUTE_KEY, "1");
    resetSoundStore();
    const { slot } = await renderPanel();
    expect(slot.getByRole("button", { name: "Unmute the new-decision sound" })).toBeTruthy();
    expect(slot.queryByTestId("sound-hint")).toBeNull();
  });
});

describe("force refresh (TYP-1869)", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  type RefreshAnswer = { ok: true } | { ok: false; reason: string; retryInMs: number | null };

  it("re-reads at once, rebuilds the feed with a spinner, then reads again", async () => {
    const gate = deferred<RefreshAnswer>();
    const refreshBoard = vi.fn((_input: unknown) => gate.promise);
    const { slot, read } = await renderPanel(fixture(), { refreshBoard } as never);
    const before = read.mock.calls.length;
    const button = slot.getByTestId("refresh-board");
    expect(button.getAttribute("aria-label")).toBe("Refresh the board");
    expect(button.parentElement?.getAttribute("title")).toBe("Refresh the board");
    fireEvent.click(button);
    expect(read.mock.calls.length).toBe(before + 1);
    await waitFor(() => expect(refreshBoard).toHaveBeenCalledWith({}));
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
    expect(button.getAttribute("aria-label")).toBe("Rebuilding the board…");
    expect(button.querySelector(".lb-spin")).not.toBeNull();

    // A second tap while it runs re-reads but starts no second rebuild.
    fireEvent.click(button);
    expect(read.mock.calls.length).toBe(before + 2);
    expect(refreshBoard).toHaveBeenCalledTimes(1);

    await act(async () => gate.resolve({ ok: true }));
    await waitFor(() => expect(read.mock.calls.length).toBe(before + 3));
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(slot.queryByTestId("refresh-error")).toBeNull();
  });

  it("shows a failure and keeps the last good board", async () => {
    const refreshBoard = vi.fn(async () => ({
      ok: false,
      reason: "The feed was rebuilt moments ago. Try again in 9 s.",
      retryInMs: 9_000,
    }));
    const { slot } = await renderPanel(fixture(), { refreshBoard } as never);
    fireEvent.click(slot.getByTestId("refresh-board"));
    const banner = await slot.findByTestId("refresh-error");
    expect(banner.textContent).toContain("Could not rebuild the board: The feed was rebuilt moments ago. Try again in 9 s.");
    expect(banner.textContent).toContain("Showing the last board read.");
    expect(slot.getByText("Rotate the demo tokens")).toBeTruthy();
  });

  it("shows an rpc error the same way", async () => {
    const refreshBoard = vi.fn(async () => Promise.reject(new Error("server unavailable")));
    const { slot } = await renderPanel(fixture(), { refreshBoard } as never);
    fireEvent.click(slot.getByTestId("refresh-board"));
    expect((await slot.findByTestId("refresh-error")).textContent).toContain("server unavailable");
    expect(slot.getByText("Rotate the demo tokens")).toBeTruthy();
  });
});
