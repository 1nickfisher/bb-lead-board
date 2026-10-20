// The new-decision chime: one store per window, shared by every open Lead
// board panel. Browsers only let a page start audio after a user gesture, so
// the store arms itself on the first pointer or key press in the window; the
// mute choice is persisted to localStorage. The chime is synthesised with
// WebAudio, so the plugin ships no audio files.
import { useSyncExternalStore } from "react";

export const MUTE_KEY = "lead-board:chime-muted";

export interface SoundSnapshot {
  muted: boolean;
  /** Audio is unlocked: a chime would play now. */
  armed: boolean;
  /** The browser has WebAudio. */
  supported: boolean;
}

type AudioCtor = new () => AudioContext;

function audioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Two rising bell-like notes, about half a second in all. */
function playChime(ctx: AudioContext): void {
  const start = ctx.currentTime + 0.02;
  const notes: [frequency: number, offset: number][] = [
    [987.77, 0], // B5
    [1479.98, 0.14], // F#6
  ];
  for (const [frequency, offset] of notes) {
    const at = start + offset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.18, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.38);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.4);
  }
}

const ARM_EVENTS = ["pointerdown", "keydown", "touchend"] as const;

export class SoundStore {
  private snapshot: SoundSnapshot;
  private readonly listeners = new Set<() => void>();
  private ctx: AudioContext | null = null;
  /** Ids already chimed for in this window. */
  private readonly announced = new Set<string>();

  constructor() {
    this.snapshot = { muted: loadMuted(), armed: false, supported: audioCtor() !== null };
  }

  getSnapshot = (): SoundSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      window.addEventListener("storage", this.onStorage);
      // No storage listener ran while every panel was closed: another window
      // may have changed the mute since.
      this.set({ muted: loadMuted() });
      if (!this.snapshot.armed) this.listenForGesture(true);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        window.removeEventListener("storage", this.onStorage);
        this.listenForGesture(false);
      }
    };
  };

  toggleMuted(): void {
    const muted = !this.snapshot.muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    this.set({ muted });
  }

  /** Unlock audio; call from a user gesture. */
  async arm(): Promise<void> {
    const Ctor = audioCtor();
    if (Ctor === null) {
      this.set({ supported: false });
      return;
    }
    try {
      this.ctx ??= new Ctor();
      const ctx = this.ctx;
      // The browser can stop audio later (iOS Safari interrupts it on a tab
      // switch or screen lock); the next gesture must be able to resume it.
      ctx.onstatechange = () => this.setArmed(ctx.state === "running");
      if (ctx.state !== "running") await ctx.resume();
      this.setArmed(ctx.state === "running");
    } catch {
      this.setArmed(false);
    }
  }

  /**
   * Chime for these new decision ids, at most once per call, and only for ids
   * no panel in this window has chimed for. Returns whether it played.
   */
  announce(ids: readonly string[]): boolean {
    const unseen = ids.filter((id) => !this.announced.has(id));
    for (const id of unseen) this.announced.add(id);
    if (unseen.length === 0 || this.snapshot.muted || !this.snapshot.armed || this.ctx === null) return false;
    try {
      playChime(this.ctx);
      return true;
    } catch {
      return false;
    }
  }

  private readonly onGesture = () => {
    void this.arm();
  };

  /** Listen for a gesture whenever a panel is open and audio is not running. */
  private setArmed(armed: boolean): void {
    this.set({ armed });
    if (this.listeners.size > 0) this.listenForGesture(!armed);
  }

  private listenForGesture(on: boolean): void {
    for (const type of ARM_EVENTS) {
      if (on) window.addEventListener(type, this.onGesture, { capture: true, passive: true });
      else window.removeEventListener(type, this.onGesture, { capture: true });
    }
  }

  private readonly onStorage = (event: StorageEvent) => {
    if (event.key === MUTE_KEY || event.key === null) this.set({ muted: loadMuted() });
  };

  private set(patch: Partial<SoundSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    if (next.muted === this.snapshot.muted && next.armed === this.snapshot.armed && next.supported === this.snapshot.supported) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

let shared: SoundStore | null = null;

export function soundStore(): SoundStore {
  shared ??= new SoundStore();
  return shared;
}

/** Tests: forget the window's store. */
export function resetSoundStore(): void {
  shared = null;
}

export function useSound(): SoundSnapshot & { store: SoundStore } {
  const store = soundStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, store };
}
