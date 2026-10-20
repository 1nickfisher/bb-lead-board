// Test helper: a minimal WebAudio stand-in that counts chimes. Not reachable
// from app.tsx.

export interface FakeAudio {
  /** Chimes played (each chime starts CHIME_NOTES oscillators). */
  chimes(): number;
  /** The browser suspends audio (iOS Safari: tab switch, screen lock). */
  interrupt(): void;
  uninstall(): void;
}

const CHIME_NOTES = 2;

const param = () => ({
  value: 0,
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
});

export function installFakeAudio(): FakeAudio {
  let started = 0;
  let last: FakeAudioContext | null = null;
  class FakeAudioContext {
    constructor() {
      last = this;
    }
    state: AudioContextState = "suspended";
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
    async resume() {
      this.state = "running";
      this.onstatechange?.();
    }
    createOscillator() {
      return {
        type: "sine",
        frequency: param(),
        connect() {},
        start() {
          started += 1;
        },
        stop() {},
      };
    }
    createGain() {
      return { gain: param(), connect() {} };
    }
  }
  const target = window as unknown as { AudioContext?: unknown };
  const previous = target.AudioContext;
  target.AudioContext = FakeAudioContext;
  return {
    chimes: () => started / CHIME_NOTES,
    interrupt() {
      if (last === null) return;
      last.state = "interrupted" as AudioContextState;
      last.onstatechange?.();
    },
    uninstall() {
      if (previous === undefined) delete target.AudioContext;
      else target.AudioContext = previous;
    },
  };
}
