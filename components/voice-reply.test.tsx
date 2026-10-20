// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import fixtureV2 from "../fixtures/board-v2.json";
import { resetSentStores } from "./sent-store";

const SETTINGS = { boardHostId: "host_board1", boardPath: "/test/board.json", leadThreadId: "thr_lead1" };
const CHECKED = Date.parse(fixtureV2.checkedAt);

type Rpc = NonNullable<RenderSlotOptions["rpc"]>;

async function renderPanel({ voice = false, rpc = {} as Rpc, transcribe = "" } = {}) {
  const app = await loadPluginApp(() => import("../app"));
  const host = { content: JSON.stringify(fixtureV2) };
  const read = vi.fn(async () => ({
    path: SETTINGS.boardPath,
    content: host.content,
    contentEncoding: "utf8" as const,
    sha256: createHash("sha256").update(host.content).digest("hex"),
    sizeBytes: host.content.length,
  }));
  const send = vi.fn(async (_args: unknown) => ({ ok: true as const, delivery: "sent" as const }));
  const transcribeVoice = vi.fn(async (_args: { file: Blob }) => ({ text: transcribe }));
  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "thr_lead1", params: null },
    {
      settings: { ...SETTINGS, voice },
      rpc,
      sdk: {
        files: { read },
        threads: { send },
        system: { transcribeVoice },
      } as unknown as RenderSlotOptions["sdk"],
    },
  );
  await slot.findByText("Rotate the demo tokens");
  /** A poll that finds a newer event at the top of the feed. */
  const newActivity = async (text: string) => {
    const board = JSON.parse(host.content) as { recent: unknown[]; updatedAt: string };
    board.recent.unshift({ at: "2026-10-20T16:59:00.000Z", project: "factory", kind: "merged", text, link: null });
    board.updatedAt = "2026-10-20T16:59:00.000Z";
    host.content = JSON.stringify(board);
    fireEvent.click(slot.getByRole("button", { name: "Refresh the board" }));
    await slot.findByText(text);
  };
  return { slot, send, transcribeVoice, newActivity };
}

function sentText(call: unknown[]): string {
  return (call[0] as { input: { text: string }[] }).input[0]!.text;
}

const card = (slot: Awaited<ReturnType<typeof renderPanel>>["slot"], title: string) =>
  within(slot.getByRole("article", { name: title }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(CHECKED + 3 * 60_000);
  localStorage.clear();
  resetSentStores();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Reply", () => {
  it("sends Nick's text with a reference line, only when he presses Send", async () => {
    const { slot, send } = await renderPanel();
    const release = card(slot, "Release Demo 1.2 to production");
    fireEvent.click(release.getByRole("button", { name: "Reply: Release Demo 1.2 to production" }));
    const box = release.getByRole("textbox", { name: "Reply: Release Demo 1.2 to production" });
    expect(release.getByText("Re: Release Demo 1.2 to production [demo-release]")).toBeTruthy();
    fireEvent.change(box, { target: { value: "Hold until Monday, please." } });
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(release.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(sentText(send.mock.calls[0]!)).toBe("Re: Release Demo 1.2 to production [demo-release]\nHold until Monday, please.");
    await waitFor(() => expect(release.queryByRole("textbox")).toBeNull());
    expect(Object.keys(localStorage).filter((key) => key.includes(":draft:"))).toEqual([]);
  });

  it("keeps an unsent draft per card across closing and reopening the panel", async () => {
    const first = await renderPanel();
    const copy = card(first.slot, "Pick the consent form wording");
    fireEvent.click(copy.getByRole("button", { name: "Reply: Pick the consent form wording" }));
    fireEvent.change(copy.getByRole("textbox"), { target: { value: "Short, but add the clinic name" } });
    cleanup();

    const second = await renderPanel();
    const again = card(second.slot, "Pick the consent form wording");
    fireEvent.click(again.getByRole("button", { name: "Reply: Pick the consent form wording" }));
    expect((again.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Short, but add the clinic name");
    const other = card(second.slot, "Rotate the demo tokens");
    fireEvent.click(other.getByRole("button", { name: "Reply: Rotate the demo tokens" }));
    expect((other.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(second.send).not.toHaveBeenCalled();
  });

  it("does not send an empty reply", async () => {
    const { slot } = await renderPanel();
    const release = card(slot, "Release Demo 1.2 to production");
    fireEvent.click(release.getByRole("button", { name: "Reply: Release Demo 1.2 to production" }));
    expect((release.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("replies to a recent-activity row", async () => {
    const { slot, send } = await renderPanel();
    const recent = within(slot.getByRole("region", { name: "Recent" }));
    fireEvent.click(recent.getByRole("button", { name: "Reply: Payments review is waiting on a test account" }));
    fireEvent.change(recent.getByRole("textbox"), { target: { value: "Use the sandbox account." } });
    fireEvent.click(recent.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(sentText(send.mock.calls[0]!)).toBe(
      "Re: Payments review is waiting on a test account [demo blocked 2026-10-20T15:55:00.000Z]\nUse the sandbox account.",
    );
  });
});

describe("Reply while the feed updates", () => {
  const ROW = "Reply: Payments review is waiting on a test account";

  it("keeps an open recent-row reply, and its text, when new activity arrives", async () => {
    const { slot, newActivity } = await renderPanel();
    const recent = within(slot.getByRole("region", { name: "Recent" }));
    fireEvent.click(recent.getByRole("button", { name: ROW }));
    const box = recent.getByRole("textbox", { name: ROW });
    fireEvent.change(box, { target: { value: "Use the sandbox account." } });
    await newActivity("A newer merge");
    const after = recent.getByRole("textbox", { name: ROW }) as HTMLTextAreaElement;
    expect(after).toBe(box);
    expect(after.value).toBe("Use the sandbox account.");
  });

  it("keeps recording a recent-row reply when new activity arrives mid-dictation", async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    class FakeRecorder {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(readonly stream: unknown) {}
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["voice"]) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } });
    const { slot, newActivity, transcribeVoice } = await renderPanel({ voice: true, transcribe: "use the sandbox account" });
    const recent = within(slot.getByRole("region", { name: "Recent" }));
    fireEvent.click(recent.getByRole("button", { name: ROW }));
    await act(async () => {
      fireEvent.pointerDown(recent.getByRole("button", { name: "Hold to talk into this reply" }));
    });
    await recent.findByRole("button", { name: /Recording/ });
    await newActivity("A newer merge");
    fireEvent.pointerUp(recent.getByRole("button", { name: /Recording/ }));
    await waitFor(() => expect(transcribeVoice).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((recent.getByRole("textbox", { name: ROW }) as HTMLTextAreaElement).value).toBe("use the sandbox account"),
    );
    Reflect.deleteProperty(navigator, "mediaDevices");
  });
});

describe("per-card voice", () => {
  it("shows no voice icons when the voice setting is off", async () => {
    const { slot } = await renderPanel();
    expect(slot.queryByRole("button", { name: "Read this card aloud" })).toBeNull();
    expect(slot.queryByRole("button", { name: /^Hold to talk/ })).toBeNull();
  });

  it("reads a card in bb-voice's voice when the board host has it", async () => {
    const played: string[] = [];
    class FakeAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly src: string) {}
      async play() {
        played.push(this.src);
        setTimeout(() => this.onended?.(), 0);
      }
      pause() {}
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:clip", revokeObjectURL: () => {} }));
    const speak = vi.fn(async (_input: { text: string }) => ({ ok: true as const, mimeType: "audio/mpeg" as const, audio: "AQID" }));
    const { slot } = await renderPanel({
      voice: true,
      rpc: { voiceStatus: async () => ({ available: true, reason: null }), speak } as unknown as Rpc,
    });
    const release = card(slot, "Release Demo 1.2 to production");
    const speaker = await release.findByRole("button", { name: "Read this card aloud" });
    expect(speaker.parentElement?.getAttribute("title")).toBe("Read this card aloud");
    fireEvent.click(speaker);
    await waitFor(() => expect(played).toEqual(["blob:clip"]));
    expect(speak.mock.calls[0]![0]).toEqual({
      text:
        "Release Demo 1.2 to production. Staging accepted. The lead reads the release back before it runs. " +
        "Options: Hold, or Release. Recommended: Release, because staging acceptance is green.",
    });
  });

  it("falls back to the best browser voice, with a picker, when bb-voice's voice is unavailable", async () => {
    const spoken: { text: string; voice: unknown }[] = [];
    const voices = [
      { name: "Fred", lang: "en-US", localService: true, voiceURI: "fred" },
      { name: "Ava (Premium)", lang: "en-US", localService: true, voiceURI: "ava" },
    ];
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => voices,
      addEventListener: () => {},
      removeEventListener: () => {},
      cancel: () => {},
      speak: (utterance: { text: string; voice: unknown }) => spoken.push(utterance),
    });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        voice: unknown = null;
        lang = "";
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(readonly text: string) {}
      },
    );
    const { slot } = await renderPanel({
      voice: true,
      rpc: { voiceStatus: async () => ({ available: false, reason: "no key" }) } as unknown as Rpc,
    });
    const picker = (await slot.findByRole("combobox", { name: "Reading voice" })) as HTMLSelectElement;
    expect(picker.value).toBe("ava");
    fireEvent.click(card(slot, "Pick the consent form wording").getByRole("button", { name: "Read this card aloud" }));
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.text).toContain("Pick the consent form wording.");
    expect(spoken[0]!.voice).toBe(voices[1]);
    fireEvent.change(picker, { target: { value: "fred" } });
    expect(localStorage.getItem("lead-board:voice") ?? Object.entries(localStorage).find(([k]) => k.endsWith(":voice"))?.[1]).toBe("fred");
  });

  it("keeps the header's Read aloud and Hold to talk as icons with tooltips", async () => {
    vi.stubGlobal("MediaRecorder", class {});
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
    const { slot } = await renderPanel({
      voice: true,
      rpc: { voiceStatus: async () => ({ available: true, reason: null }) } as unknown as Rpc,
    });
    const voice = within(slot.getByRole("region", { name: "Voice" }));
    const read = await voice.findByRole("button", { name: "Read aloud" });
    const talk = voice.getByRole("button", { name: "Hold to talk" });
    expect(read.parentElement?.getAttribute("title")).toBe("Read aloud");
    expect(talk.parentElement?.getAttribute("title")).toBe("Hold to talk");
    expect(read.textContent).toBe("");
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("fills the card's reply with what Nick said, prefixed by the card reference, and waits for Send", async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    class FakeRecorder {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(readonly stream: unknown) {}
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["voice"]) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } });
    const { slot, send } = await renderPanel({ voice: true, transcribe: " go with the short one " });
    const copy = card(slot, "Pick the consent form wording");
    const mic = copy.getByRole("button", { name: "Hold to talk about: Pick the consent form wording" });
    await act(async () => {
      fireEvent.pointerDown(mic);
    });
    fireEvent.pointerUp(await copy.findByRole("button", { name: /Recording/ }));
    const box = (await copy.findByRole("textbox", { name: "Reply: Pick the consent form wording" })) as HTMLTextAreaElement;
    expect(box.value).toBe("go with the short one");
    expect(copy.getByText("Re: Pick the consent form wording [demo-copy]")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });
});
