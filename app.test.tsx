// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import fixtureBoard from "./fixtures/board.json";
import { useBoard } from "./components/use-board";
import { resetSentStores } from "./components/sent-store";
import { BOARD_LIMITS, canSend, clip, parseBoard } from "./lib/board";

const TEST_HOST_ID = "host_test1";
const TEST_BOARD_PATH = "/test/board.json";
const TEST_LEAD_THREAD_ID = "thr_lead1";
const TEST_SETTINGS = { boardHostId: TEST_HOST_ID, boardPath: TEST_BOARD_PATH, leadThreadId: TEST_LEAD_THREAD_ID };

const FIXTURE = JSON.stringify(fixtureBoard);
const FIXTURE_TIME = Date.parse("2026-10-19T12:00:00.000Z");

type BoardJson = Record<string, unknown> & { decisions: unknown[] };

function fixture(): BoardJson {
  return JSON.parse(FIXTURE) as BoardJson;
}

/** A fake board host: `content` is what the next files.read returns. */
function boardHost(initial: unknown) {
  const host = { content: JSON.stringify(initial) };
  const read = vi.fn(async () => ({
    path: TEST_BOARD_PATH,
    content: host.content,
    contentEncoding: "utf8" as const,
    sha256: createHash("sha256").update(host.content).digest("hex"),
    sizeBytes: host.content.length,
  }));
  const send = vi.fn(async (_args: unknown) => ({ ok: true as const, delivery: "sent" as const }));
  const transcribeVoice = vi.fn(async (_args: { file: Blob }) => ({ text: "" }));
  return { host, read, send, transcribeVoice };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function sentText(call: unknown[]): string {
  return (call[0] as { input: { text: string }[] }).input[0]!.text;
}

async function renderBoard(board: unknown, options: Partial<RenderSlotOptions> = {}) {
  const app = await loadPluginApp(() => import("./app"));
  const fake = boardHost(board);
  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: TEST_LEAD_THREAD_ID, params: null },
    {
      ...options,
      settings: { ...TEST_SETTINGS, ...options.settings },
      sdk: {
        files: { read: fake.read },
        threads: { send: fake.send },
        system: { transcribeVoice: fake.transcribeVoice },
      } as unknown as RenderSlotOptions["sdk"],
    },
  );
  await slot.findByRole("heading", { name: "Lead board" });
  return { slot, ...fake };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXTURE_TIME + 3 * 60_000);
  localStorage.clear();
  resetSentStores();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("lead board panel", () => {
  it("registers a thread side panel and a sidebar page", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.threadPanelActions.map((action) => action.title)).toEqual(["Lead board"]);
    expect(app.navPanels.map((panel) => panel.path)).toEqual(["board"]);
  });

  it("renders the fixture board from the board host", async () => {
    const { slot, read } = await renderBoard(fixture());
    await slot.findByText("Rotate the demo tokens");
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: TEST_HOST_ID, path: TEST_BOARD_PATH }),
    );
    expect(slot.getByText("updated 3 min ago")).toBeTruthy();
    expect(slot.getByText("Needs you now · 2")).toBeTruthy();
    expect(slot.getByText("Security · 15 min")).toBeTruthy();
    expect(slot.getByText(/One limited token per demo host/)).toBeTruthy();
    // Everything below the decisions is collapsed.
    const details = slot.container.querySelectorAll("details");
    expect(details.length).toBe(4); // coming up, two in-flight projects, done today
    details.forEach((element) => expect(element.open).toBe(false));
    expect(slot.getByText("Demo · 2")).toBeTruthy();
    expect(slot.getByText("Done today · 1")).toBeTruthy();
    expect(slot.queryByTestId("stale-banner")).toBeNull();
    expect(slot.queryByRole("button", { name: /Read aloud/ })).toBeNull();
  });

  it("highlights the recommended option with a star and the primary style", async () => {
    const { slot } = await renderBoard(fixture());
    const card = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
    const rec = card.getByRole("button", { name: "Start now" });
    const other = card.getByRole("button", { name: "Later" });
    expect(rec.dataset.recommended).toBe("true");
    expect(rec.textContent).toContain("★");
    expect(rec.className).toContain("bg-foreground");
    expect(other.dataset.recommended).toBeUndefined();
    expect(other.textContent).not.toContain("★");
    expect(other.className).not.toContain("bg-foreground");
    expect(
      card.getByText((_, node) =>
        node?.tagName === "P" &&
        node.textContent ===
          "Recommended: Start now because it is the biggest fix for the time it takes, and fully reversible",
      ),
    ).toBeTruthy();
  });

  it("sends the exact phrase to the lead thread as the user, then marks the card sent", async () => {
    const { slot, send } = await renderBoard(fixture());
    const card = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
    fireEvent.click(card.getByRole("button", { name: "Start now" }));
    await card.findByText(/Sent: waiting for the lead/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      threadId: TEST_LEAD_THREAD_ID,
      mode: "queue-if-active",
      input: [{ type: "text", text: "demo tokens: step 2 now", mentions: [] }],
    });
    expect(card.queryByRole("button", { name: "Start now" })).toBeNull();
  });

  it("sends once when an option is tapped twice quickly", async () => {
    const { slot, send } = await renderBoard(fixture());
    const card = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
    const button = card.getByRole("button", { name: "Start now" });
    fireEvent.click(button);
    fireEvent.click(button);
    await card.findByText(/Sent: waiting for the lead/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("posts to the lead thread named in settings", async () => {
    const { slot, send } = await renderBoard(fixture(), { settings: { leadThreadId: "thr_other1" } });
    const card = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
    fireEvent.click(card.getByRole("button", { name: "Later" }));
    await card.findByText(/Sent: waiting for the lead/);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thr_other1" }));
  });

  it("keeps the sent mark until the board drops or changes the decision", async () => {
    const { slot, host } = await renderBoard(fixture());
    const card = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
    fireEvent.click(card.getByRole("button", { name: "Start now" }));
    await card.findByText(/Sent: waiting for the lead/);

    // An unrelated update keeps the card sent.
    const moved = fixture();
    moved.updatedAt = "2026-10-19T12:02:00.000Z";
    host.content = JSON.stringify(moved);
    fireEvent.click(slot.getByRole("button", { name: "Refresh the board" }));
    await slot.findByText("updated 1 min ago");
    expect(card.queryByText(/Sent: waiting for the lead/)).not.toBeNull();

    // The lead re-asks with new options: the buttons come back.
    const changed = fixture();
    (changed.decisions[0] as { options: { label: string }[] }).options[0]!.label = "Tomorrow";
    host.content = JSON.stringify(changed);
    fireEvent.click(slot.getByRole("button", { name: "Refresh the board" }));
    await slot.findByRole("button", { name: "Tomorrow" });
    expect(slot.queryByText(/Sent: waiting for the lead/)).toBeNull();
  });

  it("asks for confirmation before sending a production decision", async () => {
    const { slot, send } = await renderBoard(fixture());
    const card = within(await slot.findByRole("article", { name: "Release Demo 1.2 to production" }));
    fireEvent.click(card.getByRole("button", { name: "Release" }));
    const dialog = within(await slot.findByRole("dialog"));
    expect(dialog.getByText("Production decision: send your answer?")).toBeTruthy();
    expect(dialog.getByText('"demo release: go"')).toBeTruthy();
    expect(send).not.toHaveBeenCalled();

    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(send).not.toHaveBeenCalled();

    fireEvent.click(card.getByRole("button", { name: "Release" }));
    fireEvent.click(within(await slot.findByRole("dialog")).getByRole("button", { name: "Send" }));
    await card.findByText(/Sent: waiting for the lead/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ input: [{ type: "text", text: "demo release: go", mentions: [] }] }),
    );
  });

  it.each(["security", "money"])("asks for confirmation for %s risk too", async (risk) => {
    const board = fixture();
    (board.decisions[0] as { risk: string }).risk = risk;
    const { slot, send } = await renderBoard(board);
    const card = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
    fireEvent.click(card.getByRole("button", { name: "Start now" }));
    await slot.findByRole("dialog");
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["Production", " SECURITY ", "prod", "financial"])(
    "fails closed and asks for confirmation for risk %j",
    async (risk) => {
      const board = fixture();
      (board.decisions[0] as { risk: string }).risk = risk;
      const { slot, send } = await renderBoard(board);
      const card = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
      fireEvent.click(card.getByRole("button", { name: "Start now" }));
      await slot.findByRole("dialog");
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("closes the confirmation when the board changes the decision underneath it", async () => {
    const { slot, host, send } = await renderBoard(fixture());
    const card = within(await slot.findByRole("article", { name: "Release Demo 1.2 to production" }));
    fireEvent.click(card.getByRole("button", { name: "Release" }));
    await slot.findByRole("dialog");

    const changed = fixture();
    (changed.decisions[1] as { options: { phrase: string }[] }).options[1]!.phrase = "demo release: go 1.3";
    host.content = JSON.stringify(changed);
    // The modal hides the page from the accessibility tree; a poll would land the same way.
    fireEvent.click(slot.getByRole("button", { name: "Refresh the board", hidden: true }));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps a card disabled while its send is in flight, even when another card sends", async () => {
    const board = fixture();
    (board.decisions[1] as { risk: string }).risk = "none";
    const { slot, send } = await renderBoard(board);
    const replies = [deferred<{ ok: true; delivery: "sent" }>(), deferred<{ ok: true; delivery: "sent" }>()];
    let call = 0;
    send.mockImplementation(() => replies[call++]!.promise);
    const tokens = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
    const release = within(slot.getByRole("article", { name: "Release Demo 1.2 to production" }));

    fireEvent.click(tokens.getByRole("button", { name: "Start now" }));
    fireEvent.click(release.getByRole("button", { name: "Release" }));
    fireEvent.click(tokens.getByRole("button", { name: "Start now" }));
    expect(send.mock.calls.map(sentText)).toEqual(["demo tokens: step 2 now", "demo release: go"]);

    await act(async () => replies[0]!.resolve({ ok: true, delivery: "sent" }));
    await tokens.findByText(/Sent: waiting for the lead/);
    expect((release.getByRole("button", { name: "Release" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => replies[1]!.resolve({ ok: true, delivery: "sent" }));
    await release.findByText(/Sent: waiting for the lead/);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("records the sent mark even if the panel closes before the send finishes", async () => {
    const { slot, send } = await renderBoard(fixture());
    const reply = deferred<{ ok: true; delivery: "sent" }>();
    send.mockImplementation(() => reply.promise);
    const card = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
    fireEvent.click(card.getByRole("button", { name: "Start now" }));
    slot.lifecycle.unmount();
    await act(async () => reply.resolve({ ok: true, delivery: "sent" }));

    const reopened = await renderBoard(fixture());
    const again = within(await reopened.slot.findByRole("article", { name: "Rotate the demo tokens" }));
    expect(again.getByText(/Sent: waiting for the lead/)).toBeTruthy();
  });

  it("shows the buttons again when the lead re-asks a decision with the same text", async () => {
    const { slot, host } = await renderBoard(fixture());
    const card = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
    fireEvent.click(card.getByRole("button", { name: "Start now" }));
    await card.findByText(/Sent: waiting for the lead/);

    const reasked = fixture();
    (reasked.decisions[0] as { createdAt: string }).createdAt = "2026-10-19T12:02:00.000Z";
    host.content = JSON.stringify(reasked);
    fireEvent.click(slot.getByRole("button", { name: "Refresh the board" }));
    await slot.findByRole("button", { name: "Start now" });
  });

  it("treats an updatedAt in the future as stale", async () => {
    const board = fixture();
    board.updatedAt = "2026-10-19T18:00:00.000Z";
    const { slot } = await renderBoard(board);
    const banner = await slot.findByTestId("stale-banner");
    expect(banner.textContent).toContain("no valid update time");
  });

  it("renders overlong fields clipped for display and still sends the whole phrase", async () => {
    const board = fixture();
    const decision = board.decisions[0] as { title: string; options: { phrase: string }[] };
    decision.title = "Rotate the demo tokens " + "x".repeat(5000);
    const phrase = ("demo tokens: " + "step two now ".repeat(37)).trimEnd();
    expect(phrase.length).toBeLessThanOrEqual(BOARD_LIMITS.option.phrase);
    decision.options[1]!.phrase = phrase;
    const { slot, send } = await renderBoard(board);
    const card = await slot.findByRole("article", { name: decision.title });
    const title = card.querySelector(".lb-title")!.textContent!;
    expect(title).toHaveLength(BOARD_LIMITS.decision.title);
    expect(title.endsWith("…")).toBe(true);
    expect(slot.queryByRole("alert")).toBeNull();

    fireEvent.click(within(card).getByRole("button", { name: "Start now" }));
    await within(card).findByText(/Sent: waiting for the lead/);
    expect(sentText(send.mock.calls[0]!)).toBe(phrase);
  });

  it("renders a legacy ask as a single-option decision tagged with its project", async () => {
    const board = {
      schema: 1,
      updatedAt: "2026-10-19T12:00:00.000Z",
      updatedBy: "lead",
      decisions: [
        {
          id: "lead:abc123",
          title: "Confirm the demo export is saved",
          project: "Demo",
          tag: "",
          context: "",
          options: [{ label: "Saved", phrase: "demo export saved", recommended: true, why: "" }],
          risk: "none",
          link: "",
          approvalId: null,
          createdAt: "2026-10-19T11:00:00.000Z",
        },
      ],
      comingUp: [],
      inFlight: [],
      done: [],
    };
    const { slot } = await renderBoard(board);
    const card = within(await slot.findByRole("article", { name: "Confirm the demo export is saved" }));
    expect(card.getByText("Demo").className).toBe("lb-tag");
    expect(card.getByRole("button", { name: "Saved" }).dataset.recommended).toBe("true");
    expect(card.getByText((_, node) => node?.tagName === "P" && node.textContent === "Recommended: Saved")).toBeTruthy();
    expect(slot.container.querySelector(".lb-ctx")).toBeNull();
  });

  it("shows a stale banner when the board is over 15 minutes old", async () => {
    vi.setSystemTime(FIXTURE_TIME + 20 * 60_000);
    const { slot } = await renderBoard(fixture());
    const banner = await slot.findByTestId("stale-banner");
    expect(banner.textContent).toContain("The board is 20 min old");
    expect(slot.getByText("updated 20 min ago")).toBeTruthy();
  });

  it("does not show the stale banner at exactly 15 minutes", async () => {
    vi.setSystemTime(FIXTURE_TIME + 15 * 60_000);
    const { slot } = await renderBoard(fixture());
    await slot.findByText("updated 15 min ago");
    expect(slot.queryByTestId("stale-banner")).toBeNull();
  });

  it('renders "Nothing needs you right now" for an empty board', async () => {
    const { slot } = await renderBoard({ schema: 1, updatedAt: "2026-10-19T12:00:00.000Z", decisions: [] });
    await slot.findByText("Nothing needs you right now.");
    expect(slot.getByText("Needs you now · 0")).toBeTruthy();
    expect(slot.container.querySelectorAll("details").length).toBe(0);
  });

  it("reports an unreadable board instead of rendering it", async () => {
    const { slot } = await renderBoard({ schema: 2, updatedAt: "2026-10-19T12:00:00.000Z" });
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toContain("schema 2");
  });

  it("shows the voice controls only when the setting is on", async () => {
    const { slot } = await renderBoard(fixture(), { settings: { voice: true } });
    await slot.findByText("Rotate the demo tokens");
    expect(slot.getByRole("region", { name: "Voice" })).toBeTruthy();
  });
});

describe("sent state shared by every panel in the window (review reproduction 1)", () => {
  async function twoPanels(board: unknown) {
    const app = await loadPluginApp(() => import("./app"));
    const fake = boardHost(board);
    const sdk = {
      files: { read: fake.read },
      threads: { send: fake.send },
      system: { transcribeVoice: fake.transcribeVoice },
    } as unknown as RenderSlotOptions["sdk"];
    const side = renderSlot(app.threadPanelActions[0]!, { threadId: TEST_LEAD_THREAD_ID, params: null }, { sdk, settings: TEST_SETTINGS });
    const page = renderSlot(app.navPanels[0]!, { subPath: "" }, { sdk, settings: TEST_SETTINGS });
    // Both panels render into the same document: scope queries to each one.
    const sideCard = within(await within(side.container).findByRole("article", { name: "Rotate the demo tokens" }));
    const pageCard = within(await within(page.container).findByRole("article", { name: "Rotate the demo tokens" }));
    return { ...fake, side, page, sideCard, pageCard };
  }

  it("marks the card sent in every panel after one panel sends", async () => {
    const { send, sideCard, pageCard } = await twoPanels(fixture());
    fireEvent.click(sideCard.getByRole("button", { name: "Start now" }));
    await sideCard.findByText(/Sent: waiting for the lead/);
    await pageCard.findByText(/Sent: waiting for the lead/);
    expect(pageCard.queryByRole("button", { name: "Start now" })).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends nothing from a second panel while the first panel's send is in flight", async () => {
    const { send, sideCard, pageCard } = await twoPanels(fixture());
    const reply = deferred<{ ok: true; delivery: "sent" }>();
    send.mockImplementation(() => reply.promise);
    fireEvent.click(sideCard.getByRole("button", { name: "Start now" }));
    const other = pageCard.getByRole("button", { name: "Later" }) as HTMLButtonElement;
    expect(other.disabled).toBe(true);
    fireEvent.click(other);
    fireEvent.click(pageCard.getByRole("button", { name: "Start now" }));
    await act(async () => reply.resolve({ ok: true, delivery: "sent" }));
    await pageCard.findByText(/Sent: waiting for the lead/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sentText(send.mock.calls[0]!)).toBe("demo tokens: step 2 now");
  });

  it("keeps the mark across unrelated board updates and offers no way to clear it by hand", async () => {
    const { side, host, sideCard } = await twoPanels(fixture());
    fireEvent.click(sideCard.getByRole("button", { name: "Start now" }));
    await sideCard.findByText(/Sent: waiting for the lead/);
    const moved = fixture();
    moved.updatedAt = "2026-10-19T12:02:00.000Z";
    (moved.decisions[1] as { context: string }).context = "Staging accepted again.";
    host.content = JSON.stringify(moved);
    fireEvent.click(within(side.container).getByRole("button", { name: "Refresh the board" }));
    await within(side.container).findByText("updated 1 min ago");
    expect(sideCard.getByText(/Sent: waiting for the lead/)).toBeTruthy();
    expect(sideCard.queryByRole("button", { name: /Show options/ })).toBeNull();
  });
});

describe("verbatim phrases (review reproduction 2)", () => {
  it("sends and shows a phrase exactly as the feed wrote it", async () => {
    const board = fixture();
    const phrase = "demo  tokens:\tstep 2  now";
    (board.decisions[0] as { options: { phrase: string }[] }).options[1]!.phrase = phrase;
    const { slot, send } = await renderBoard(board);
    const card = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
    fireEvent.click(card.getByRole("button", { name: "Start now" }));
    await card.findByText(/Sent: waiting for the lead/);
    expect(sentText(send.mock.calls[0]!)).toBe(phrase);
    expect(card.getByTestId("sent-phrase").textContent).toBe(phrase);
  });

  it.each([" demo tokens: later", "demo tokens: later\n", ""])(
    "disables a decision whose phrase %j is malformed and never sends it",
    async (bad) => {
      const board = fixture();
      (board.decisions[0] as { options: { phrase: string }[] }).options[0]!.phrase = bad;
      const { slot, send } = await renderBoard(board);
      const card = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
      expect(card.getByText(/malformed option/i)).toBeTruthy();
      for (const name of ["Later", "Start now"]) {
        const button = card.getByRole("button", { name }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        fireEvent.click(button);
      }
      expect(send).not.toHaveBeenCalled();
      // The rest of the board still works.
      const release = within(slot.getByRole("article", { name: "Release Demo 1.2 to production" }));
      expect((release.getByRole("button", { name: "Release" }) as HTMLButtonElement).disabled).toBe(false);
    },
  );
});

describe("feed limits (TYP-1568 board-limits.json)", () => {
  it("disables a phrase over the feed's limit instead of clipping it", async () => {
    const board = fixture();
    (board.decisions[0] as { options: { phrase: string }[] }).options[1]!.phrase = "p".repeat(
      BOARD_LIMITS.option.phrase + 1,
    );
    const { slot, send } = await renderBoard(board);
    const card = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
    expect(card.getByText(/malformed option/i)).toBeTruthy();
    fireEvent.click(card.getByRole("button", { name: "Start now" }));
    expect(send).not.toHaveBeenCalled();
  });

  it("disables a decision with more options than the feed allows, hiding none", async () => {
    const board = fixture();
    const options = Array.from({ length: BOARD_LIMITS.maxOptions + 1 }, (_, i) => ({
      label: `Choice ${i}`,
      phrase: `demo choice ${i}`,
      recommended: i === BOARD_LIMITS.maxOptions,
      why: null,
    }));
    (board.decisions[0] as { options: unknown[] }).options = options;
    const { slot } = await renderBoard(board);
    const card = within(await slot.findByRole("article", { name: "Rotate the demo tokens" }));
    expect(card.getAllByRole("button")).toHaveLength(BOARD_LIMITS.maxOptions + 1);
    expect(card.getAllByRole("button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(card.getByText(/malformed option/i)).toBeTruthy();
  });

  it("clips in UTF-16 units without splitting a surrogate pair", () => {
    expect(clip("abcdef", 6)).toBe("abcdef");
    expect(clip("abcdefg", 6)).toBe("abcde…");
    expect(clip("abcd😀xyz", 6)).toBe("abcd…");
    expect(clip("abcd😀xyz", 6)).toHaveLength(5);
  });

  it("tolerates the feed's optional fields", async () => {
    const board = fixture();
    board.migrations = [{ id: "needs-to-board", at: "2026-10-19T11:00:00.000Z" }];
    (board.decisions[0] as Record<string, unknown>).needs = { ref: "n1", where: "lead", thread: "thr_demo1" };
    (board.done as Record<string, unknown>[])[0]!.needsRef = "n0";
    const { slot } = await renderBoard(board);
    await slot.findByRole("article", { name: "Rotate the demo tokens" });
    expect(slot.queryByRole("alert")).toBeNull();
  });
});

describe("legacy decisions TYP-1568 flags as invalid", () => {
  function legacy(overrides: Record<string, unknown>) {
    return {
      id: "lead:old1",
      title: "Old demo ask",
      project: "Demo",
      tag: "",
      context: "Carried over from needs.",
      options: [
        { label: "Yes", phrase: "demo old: yes", recommended: true, why: "" },
        { label: "No", phrase: "demo old: no", recommended: false, why: "" },
      ],
      risk: "none",
      link: "",
      approvalId: null,
      createdAt: "2026-10-19T10:00:00.000Z",
      invalidLegacy: true,
      invalidReason: "migrated from needs without a recommendation",
      ...overrides,
    };
  }

  async function renderWith(decision: unknown) {
    const board = fixture();
    board.decisions = [decision, ...board.decisions];
    const rendered = await renderBoard(board);
    // The rest of the board still renders and works.
    const release = within(await rendered.slot.findByRole("article", { name: "Release Demo 1.2 to production" }));
    expect((release.getByRole("button", { name: "Release" }) as HTMLButtonElement).disabled).toBe(false);
    expect(rendered.slot.queryByRole("alert")).toBeNull();
    return rendered;
  }

  it("shows Needs repair with every option disabled and never sends", async () => {
    const { slot, send } = await renderWith(legacy({}));
    const card = within(slot.getByRole("article", { name: "Old demo ask" }));
    expect(card.getByText("Needs repair: migrated from needs without a recommendation")).toBeTruthy();
    for (const name of ["Yes", "No"]) {
      const button = card.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("clips over-limit text and tolerates duplicate phrases without failing the board", async () => {
    const title = "Old demo ask " + "t".repeat(5000);
    const { slot, send } = await renderWith(
      legacy({
        title,
        context: "c".repeat(3000),
        invalidReason: "duplicate phrases",
        options: [
          { label: "L".repeat(300), phrase: "demo old: same", recommended: true, why: "" },
          { label: "Again", phrase: "demo old: same", recommended: true, why: "" },
        ],
      }),
    );
    const card = slot.getByRole("article", { name: title });
    expect(card.querySelector(".lb-title")!.textContent).toHaveLength(BOARD_LIMITS.decision.title);
    expect(card.querySelector(".lb-ctx")!.textContent).toHaveLength(BOARD_LIMITS.decision.context);
    expect(within(card).getByText("Needs repair: duplicate phrases")).toBeTruthy();
    const buttons = within(card).getAllByRole("button") as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => {
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("treats any non-false invalidLegacy value as needing repair", async () => {
    const { slot } = await renderWith(legacy({ invalidLegacy: "yes", invalidReason: 42 }));
    const card = within(slot.getByRole("article", { name: "Old demo ask" }));
    expect(card.getByText(/Needs repair:/)).toBeTruthy();
    expect((card.getByRole("button", { name: "Yes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("turns an unreadable decision into a needs-repair card instead of hiding the board", async () => {
    const { slot } = await renderWith({ id: "demo-broken", title: "Broken demo ask", options: [{ label: "" }] });
    const card = within(slot.getByRole("article", { name: "Broken demo ask" }));
    expect(card.getByText("Needs repair: the panel could not read this decision")).toBeTruthy();
    expect(card.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("push-to-talk", () => {
  const track = { stop: vi.fn() };
  type FakeStream = { getTracks(): (typeof track)[] };
  const stream: FakeStream = { getTracks: () => [track] };
  let microphone: ReturnType<typeof deferred<FakeStream>>;
  const recorders: FakeRecorder[] = [];

  class FakeRecorder {
    state: "inactive" | "recording" = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(readonly stream: FakeStream) {
      recorders.push(this);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["voice"]) });
      this.onstop?.();
    }
  }

  beforeEach(() => {
    track.stop.mockClear();
    recorders.length = 0;
    microphone = deferred<FakeStream>();
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(() => microphone.promise) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  async function holdToTalk() {
    const rendered = await renderBoard(fixture(), { settings: { voice: true } });
    return { ...rendered, button: await rendered.slot.findByRole("button", { name: "Hold to talk" }) };
  }

  it("transcribes with bb and waits for the user to confirm before sending", async () => {
    const { slot, button, send, transcribeVoice } = await holdToTalk();
    transcribeVoice.mockResolvedValue({ text: " demo tokens: later " });
    fireEvent.pointerDown(button);
    await act(async () => microphone.resolve(stream));
    await slot.findByRole("button", { name: /Recording/ });
    fireEvent.pointerUp(slot.getByRole("button", { name: /Recording/ }));

    const note = (await slot.findByRole("textbox")) as HTMLTextAreaElement;
    expect(note.value).toBe("demo tokens: later");
    expect(transcribeVoice).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();

    fireEvent.change(note, { target: { value: "demo tokens: later today" } });
    fireEvent.click(slot.getByRole("button", { name: "Send as my message" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(sentText(send.mock.calls[0]!)).toBe("demo tokens: later today");
  });

  it("records nothing when released while the microphone is still opening", async () => {
    const { slot, button, transcribeVoice } = await holdToTalk();
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    await act(async () => microphone.resolve(stream));
    expect(recorders).toHaveLength(0);
    expect(track.stop).toHaveBeenCalled();
    expect(transcribeVoice).not.toHaveBeenCalled();
    expect(slot.getByRole("button", { name: "Hold to talk" })).toBeTruthy();
  });

  it("starts one recording when press events overlap", async () => {
    const { button } = await holdToTalk();
    fireEvent.pointerDown(button);
    fireEvent.keyDown(button, { key: " " });
    await act(async () => microphone.resolve(stream));
    expect(recorders).toHaveLength(1);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("discards the note and releases the microphone when the panel closes mid-recording", async () => {
    const { slot, button, transcribeVoice } = await holdToTalk();
    fireEvent.pointerDown(button);
    await act(async () => microphone.resolve(stream));
    await slot.findByRole("button", { name: /Recording/ });
    slot.lifecycle.unmount();
    expect(track.stop).toHaveBeenCalled();
    expect(recorders[0]!.state).toBe("inactive");
    expect(transcribeVoice).not.toHaveBeenCalled();
  });
});

describe("unconfigured panel", () => {
  async function renderWith(settings: Record<string, string | number | boolean>) {
    const app = await loadPluginApp(() => import("./app"));
    const fake = boardHost(fixture());
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: TEST_LEAD_THREAD_ID, params: null },
      {
        settings,
        sdk: {
          files: { read: fake.read },
          threads: { send: fake.send },
          system: { transcribeVoice: fake.transcribeVoice },
        } as unknown as RenderSlotOptions["sdk"],
      },
    );
    return { slot, ...fake };
  }

  it("says what to set and neither reads nor sends", async () => {
    const { slot, read, send } = await renderWith({});
    await slot.findByText(
      "Not configured: set boardHostId, boardPath and leadThreadId in the plugin settings",
    );
    expect(read).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("names only the missing setting when partly configured", async () => {
    const { slot, read } = await renderWith({ boardHostId: TEST_HOST_ID, leadThreadId: TEST_LEAD_THREAD_ID });
    await slot.findByText("Not configured: set boardPath in the plugin settings");
    expect(read).not.toHaveBeenCalled();
  });

  it("treats an invalid value as missing", async () => {
    const { slot } = await renderWith({ ...TEST_SETTINGS, boardPath: "relative.json" });
    await slot.findByText("Not configured: set boardPath in the plugin settings");
  });
});

describe("useBoard", () => {
  function Probe({ path }: { path: string }) {
    const { board } = useBoard(TEST_HOST_ID, path);
    return <p>{board === null ? "no board" : `board ${board.updatedAt}`}</p>;
  }

  it("drops the old board as soon as the board path changes", async () => {
    const reads: string[] = [];
    const read = vi.fn((args: { path: string }) => {
      reads.push(args.path);
      if (args.path !== "/a/board.json") return new Promise<never>(() => {});
      return Promise.resolve({ path: args.path, content: FIXTURE, contentEncoding: "utf8", sha256: "a", sizeBytes: 1 });
    });
    const slot = renderSlot({ component: Probe }, { path: "/a/board.json" }, {
      sdk: { files: { read } } as unknown as RenderSlotOptions["sdk"],
    });
    await slot.findByText("board 2026-10-19T12:00:00.000Z");
    slot.lifecycle.rerender(<Probe path="/b/board.json" />);
    await slot.findByText("no board");
    expect(reads).toEqual(["/a/board.json", "/b/board.json"]);
  });
});

describe("parseBoard", () => {
  it("accepts the fixture and fills missing sections", () => {
    const parsed = parseBoard(JSON.stringify({ schema: 1, updatedAt: "x" }));
    expect(parsed.ok && parsed.board.decisions).toEqual([]);
    expect(parseBoard(FIXTURE).ok).toBe(true);
  });

  it("keeps the board when a decision has no options, but makes that decision unsendable", () => {
    const board = fixture();
    (board.decisions[0] as { options: unknown[] }).options = [];
    const parsed = parseBoard(JSON.stringify(board));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(canSend(parsed.board.decisions[0]!)).toBe(false);
      expect(canSend(parsed.board.decisions[1]!)).toBe(true);
    }
  });

  it("rejects text that is not JSON", () => {
    expect(parseBoard("{").ok).toBe(false);
  });
});
