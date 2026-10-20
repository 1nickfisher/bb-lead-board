// Voice controls, shown only when the "Voice controls" setting is on.
// Reading aloud prefers bb-voice's Cartesia voice, spoken on the board host
// (host.ts) where its key lives; when that is unavailable it uses the best
// installed browser voice, with a picker. Push-to-talk text is always shown
// for editing and is never sent automatically.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { experimental_usePluginId, useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { readAloudScript, type Board } from "@/lib/board";
import { rankVoices } from "@/lib/speech";
import { MAX_SPEECH_TEXT, type serverContract } from "@/lib/voice-contract";
import { Glyph } from "./glyphs";
import { useRecorder } from "./recorder";

export type SpeechEngine = "cartesia" | "browser";

export interface Speaker {
  /** null while checking, or when neither Cartesia nor browser speech is available. */
  engine: SpeechEngine | null;
  /** What is being read now: a card id, "board", or null. */
  speakingKey: string | null;
  /** Read these lines; reading the same key again stops it. */
  toggle(key: string, lines: string[]): void;
  stop(): void;
  voices: SpeechSynthesisVoice[];
  voiceURI: string | null;
  setVoiceURI(uri: string): void;
}

const SpeakerContext = createContext<Speaker | null>(null);

/** The panel's speaker, or null when the voice setting is off. */
export function useSpeaker(): Speaker | null {
  return useContext(SpeakerContext);
}

function browserSpeech(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

function audioUrl(base64: string, mimeType: string): string {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export function SpeakerProvider({ children }: { children: ReactNode }) {
  const rpc = useRpc<typeof serverContract>();
  const voiceKey = `${experimental_usePluginId()}:voice`;
  const synth = browserSpeech();
  const [cartesia, setCartesia] = useState<boolean | null>(null);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURIState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(voiceKey);
    } catch {
      return null;
    }
  });
  // Each reading gets an id, so a stopped reading's late events change nothing.
  const run = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const clips = useRef(new Map<string, string>());

  useEffect(() => {
    let live = true;
    rpc
      .call("voiceStatus", {})
      .then((status) => live && setCartesia(status.available))
      .catch(() => live && setCartesia(false));
    return () => {
      live = false;
    };
  }, [rpc]);

  useEffect(() => {
    if (!synth) return;
    const load = () => setVoices(rankVoices(synth.getVoices(), navigator.language || "en-US"));
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, [synth]);

  const stop = useCallback(() => {
    run.current += 1;
    audio.current?.pause();
    audio.current = null;
    synth?.cancel();
    setSpeakingKey(null);
  }, [synth]);

  useEffect(() => {
    const cached = clips.current;
    return () => {
      stop();
      cached.forEach((url) => URL.revokeObjectURL(url));
      cached.clear();
    };
  }, [stop]);

  const speakBrowser = useCallback(
    (id: number, lines: string[]) => {
      if (!synth) return;
      const voice = voices.find((item) => item.voiceURI === voiceURI) ?? voices[0] ?? null;
      lines.forEach((line, index) => {
        const utterance = new SpeechSynthesisUtterance(line);
        if (voice) {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        }
        if (index === lines.length - 1) {
          utterance.onend = utterance.onerror = () => {
            if (run.current === id) setSpeakingKey(null);
          };
        }
        synth.speak(utterance);
      });
    },
    [synth, voices, voiceURI],
  );

  const speakCartesia = useCallback(
    async (id: number, lines: string[]) => {
      for (const [index, line] of lines.entries()) {
        const text = line.slice(0, MAX_SPEECH_TEXT);
        let url = clips.current.get(text);
        if (!url) {
          let result;
          try {
            result = await rpc.call("speak", { text });
          } catch (cause) {
            result = { ok: false as const, reason: cause instanceof Error ? cause.message : String(cause) };
          }
          if (run.current !== id) return;
          if (!result.ok) {
            toast.info(`bb-voice's voice is unavailable (${result.reason}); using the browser voice.`);
            setCartesia(false);
            speakBrowser(id, lines.slice(index));
            return;
          }
          url = audioUrl(result.audio, result.mimeType);
          clips.current.set(text, url);
        }
        const player = new Audio(url);
        audio.current = player;
        const finished = new Promise<void>((resolve) => {
          player.onended = player.onerror = () => resolve();
        });
        try {
          await player.play();
        } catch {
          // Autoplay refused or no audio device: stop quietly.
          if (run.current === id) setSpeakingKey(null);
          return;
        }
        await finished;
        if (run.current !== id) return;
      }
      if (run.current === id) setSpeakingKey(null);
    },
    [rpc, speakBrowser],
  );

  const engine: SpeechEngine | null = cartesia ? "cartesia" : cartesia === false && synth ? "browser" : null;

  const toggle = useCallback(
    (key: string, lines: string[]) => {
      const wasSpeaking = speakingKey === key;
      stop();
      if (wasSpeaking || engine === null || lines.length === 0) return;
      const id = run.current;
      setSpeakingKey(key);
      if (engine === "cartesia") void speakCartesia(id, lines);
      else speakBrowser(id, lines);
    },
    [speakingKey, stop, engine, speakCartesia, speakBrowser],
  );

  const setVoiceURI = useCallback(
    (uri: string) => {
      setVoiceURIState(uri);
      try {
        localStorage.setItem(voiceKey, uri);
      } catch {
        // Not persisted; the choice still applies until the panel closes.
      }
    },
    [voiceKey],
  );

  const value = useMemo<Speaker>(
    () => ({ engine, speakingKey, toggle, stop, voices, voiceURI, setVoiceURI }),
    [engine, speakingKey, toggle, stop, voices, voiceURI, setVoiceURI],
  );
  return <SpeakerContext.Provider value={value}>{children}</SpeakerContext.Provider>;
}

/** A small square icon button with a tooltip and an accessible name. */
export function IconButton({
  label,
  pressed,
  className,
  children,
  ...props
}: {
  label: string;
  pressed?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">) {
  return (
    <span className="lb-tip" title={label}>
      <Button
        variant="ghost"
        size="icon"
        className={`lb-icon-btn size-8 text-muted-foreground hover:text-foreground ${className ?? ""}`}
        aria-label={label}
        aria-pressed={pressed}
        {...props}
      >
        {children}
      </Button>
    </span>
  );
}

/** Header: read every decision aloud. */
function ReadAloudButton({ board }: { board: Board | null }) {
  const speaker = useSpeaker();
  if (!speaker?.engine) return null;
  const speaking = speaker.speakingKey === "board";
  return (
    <IconButton
      label={speaking ? "Stop reading" : "Read aloud"}
      pressed={speaking}
      disabled={board === null}
      onClick={() => board && speaker.toggle("board", readAloudScript(board))}
    >
      <Glyph name={speaking ? "stop" : "speaker"} />
    </IconButton>
  );
}

/** A hold-to-talk microphone; the transcribed text goes to `onText`. */
export function HoldToTalkButton({ label, onText }: { label: string; onText(text: string): void }) {
  const recorder = useRecorder(onText);
  if (!recorder.available && recorder.state === "idle") return null;
  const name =
    recorder.state === "recording"
      ? "Recording… release to stop"
      : recorder.state === "transcribing"
        ? "Transcribing…"
        : label;
  return (
    <IconButton
      label={name}
      pressed={recorder.state === "recording"}
      disabled={recorder.state === "transcribing"}
      className={recorder.state === "recording" ? "lb-recording" : undefined}
      {...recorder.holdProps}
    >
      <Glyph name="mic" />
    </IconButton>
  );
}

/** Header icons: Read aloud and Hold to talk. */
export function VoiceButtons({ board, onNote }: { board: Board | null; onNote(text: string): void }) {
  return (
    <section aria-label="Voice" className="lb-voice-btns">
      <ReadAloudButton board={board} />
      <HoldToTalkButton label="Hold to talk" onText={onNote} />
    </section>
  );
}

/** The header's voice note, for editing before it is sent. */
export function VoiceNote({
  text,
  onChange,
  onDiscard,
  onSend,
}: {
  text: string;
  onChange(text: string): void;
  onDiscard(): void;
  onSend(text: string): Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  return (
    <div className="lb-voice">
      <label className="lb-muted" htmlFor="lb-voice-note">
        Your voice note. Edit it, then send it as your message.
      </label>
      <textarea id="lb-voice-note" value={text} disabled={sending} onChange={(event) => onChange(event.target.value)} />
      <div className="lb-opts">
        <Button
          size="sm"
          disabled={sending || text.trim() === ""}
          onClick={async () => {
            setSending(true);
            try {
              await onSend(text.trim());
              toast.success("Sent to the lead");
              onDiscard();
            } catch (cause) {
              toast.error(`Not sent: ${cause instanceof Error ? cause.message : String(cause)}`);
            } finally {
              setSending(false);
            }
          }}
        >
          Send as my message
        </Button>
        <Button size="sm" variant="outline" disabled={sending} onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  );
}

/** The browser voice picker, shown only when the browser voice is in use. */
export function VoicePicker() {
  const speaker = useSpeaker();
  if (speaker?.engine !== "browser" || speaker.voices.length < 2) return null;
  const current = speaker.voiceURI ?? speaker.voices[0]!.voiceURI;
  return (
    <label className="lb-voice-pick">
      <span className="lb-muted">Reading voice</span>
      <select
        className="lb-select"
        aria-label="Reading voice"
        value={current}
        onChange={(event) => speaker.setVoiceURI(event.target.value)}
      >
        {speaker.voices.map((voice) => (
          <option key={voice.voiceURI} value={voice.voiceURI}>
            {voice.name}
          </option>
        ))}
      </select>
    </label>
  );
}
