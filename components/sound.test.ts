// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFakeAudio, type FakeAudio } from "./fake-audio";
import { MUTE_KEY, SoundStore } from "./sound";

let audio: FakeAudio;

beforeEach(() => {
  localStorage.clear();
  audio = installFakeAudio();
});

afterEach(() => {
  audio.uninstall();
});

describe("SoundStore mute toggle", () => {
  it("starts unmuted and persists the toggle", () => {
    const store = new SoundStore();
    expect(store.getSnapshot().muted).toBe(false);
    store.toggleMuted();
    expect(store.getSnapshot().muted).toBe(true);
    expect(localStorage.getItem(MUTE_KEY)).toBe("1");
    expect(new SoundStore().getSnapshot().muted).toBe(true);
    store.toggleMuted();
    expect(localStorage.getItem(MUTE_KEY)).toBe("0");
    expect(new SoundStore().getSnapshot().muted).toBe(false);
  });

  it("follows a toggle made in another window", () => {
    const store = new SoundStore();
    const stop = store.subscribe(() => {});
    localStorage.setItem(MUTE_KEY, "1");
    window.dispatchEvent(new StorageEvent("storage", { key: MUTE_KEY, newValue: "1" }));
    expect(store.getSnapshot().muted).toBe(true);
    stop();
  });

  it("picks up a mute saved by another window while every panel here was closed", async () => {
    const store = new SoundStore();
    await store.arm();
    const first = store.subscribe(() => {});
    first();
    // Window B mutes while window A has no panel open (no storage listener).
    localStorage.setItem(MUTE_KEY, "1");
    const again = store.subscribe(() => {});
    expect(store.getSnapshot().muted).toBe(true);
    expect(store.announce(["a"])).toBe(false);
    expect(audio.chimes()).toBe(0);
    again();
  });

  it("never chimes while muted", async () => {
    const store = new SoundStore();
    await store.arm();
    store.toggleMuted();
    expect(store.announce(["a"])).toBe(false);
    expect(audio.chimes()).toBe(0);
  });
});

describe("SoundStore arming and chimes", () => {
  it("is not armed until a user gesture arms it, and then chimes", async () => {
    const store = new SoundStore();
    expect(store.getSnapshot()).toMatchObject({ armed: false, supported: true });
    expect(store.announce(["a"])).toBe(false);
    expect(audio.chimes()).toBe(0);
    await store.arm();
    expect(store.getSnapshot().armed).toBe(true);
    expect(store.announce(["b"])).toBe(true);
    expect(audio.chimes()).toBe(1);
  });

  it("arms on the first pointer or key press in the window", async () => {
    const store = new SoundStore();
    const stop = store.subscribe(() => {});
    window.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getSnapshot().armed).toBe(true);
    stop();
  });

  it("re-arms on the next gesture after the browser interrupts audio", async () => {
    const store = new SoundStore();
    const stop = store.subscribe(() => {});
    window.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getSnapshot().armed).toBe(true);
    audio.interrupt();
    expect(store.getSnapshot().armed).toBe(false);
    expect(store.announce(["a"])).toBe(false);
    window.dispatchEvent(new Event("touchend"));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getSnapshot().armed).toBe(true);
    expect(store.announce(["b"])).toBe(true);
    expect(audio.chimes()).toBe(1);
    stop();
  });

  it("chimes at most once for several new ids", async () => {
    const store = new SoundStore();
    await store.arm();
    expect(store.announce(["a", "b", "c"])).toBe(true);
    expect(audio.chimes()).toBe(1);
  });

  it("chimes once per id per window, so two open panels do not both chime", async () => {
    const store = new SoundStore();
    await store.arm();
    expect(store.announce(["a"])).toBe(true);
    expect(store.announce(["a"])).toBe(false);
    expect(audio.chimes()).toBe(1);
  });

  it("reports a browser without WebAudio as unsupported and stays silent", async () => {
    audio.uninstall();
    const store = new SoundStore();
    await store.arm();
    expect(store.getSnapshot()).toMatchObject({ armed: false, supported: false });
    expect(store.announce(["a"])).toBe(false);
  });
});
