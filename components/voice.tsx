// Phase 2 voice controls, shown only when the "Voice controls" setting is on.
// Read aloud uses the browser's speechSynthesis. Push-to-talk records a short
// note, transcribes it with bb's configured voice service (Web Speech when
// recording is unavailable or bb transcription fails), and shows the text for
// the user to edit and confirm. Nothing is ever sent automatically.
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { toast } from "sonner";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { readAloudScript, type Board } from "@/lib/board";

const MAX_RECORDING_MS = 60_000;

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function webSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function canRecord(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

function ReadAloud({ board }: { board: Board | null }) {
  const [speaking, setSpeaking] = useState(false);
  // Each run gets an id, so a cancelled run's late end event can't flip the button.
  const run = useRef(0);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  useEffect(() => {
    return () => {
      if (supported) window.speechSynthesis.cancel();
    };
  }, [supported]);
  if (!supported) return null;
  const toggle = () => {
    const synth = window.speechSynthesis;
    const id = ++run.current;
    synth.cancel();
    if (speaking) {
      setSpeaking(false);
      return;
    }
    if (board === null) return;
    const done = () => {
      if (run.current === id) setSpeaking(false);
    };
    const lines = readAloudScript(board);
    lines.forEach((line, index) => {
      const utterance = new SpeechSynthesisUtterance(line);
      if (index === lines.length - 1) {
        utterance.onend = done;
        utterance.onerror = done;
      }
      synth.speak(utterance);
    });
    setSpeaking(true);
  };
  return (
    <Button variant="outline" size="sm" onClick={toggle} disabled={board === null} aria-pressed={speaking}>
      <Icon name={speaking ? "Square" : "Volume2"} className="size-4" />
      {speaking ? "Stop reading" : "Read aloud"}
    </Button>
  );
}

type TalkState =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "transcribing" }
  | { kind: "review"; text: string }
  | { kind: "sending"; text: string };

function PushToTalk({ onSend }: { onSend(text: string): Promise<void> }) {
  const sdk = useSdk();
  const [state, setState] = useState<TalkState>({ kind: "idle" });
  const [useWebSpeech, setUseWebSpeech] = useState(() => !canRecord());
  // Synchronous mirrors of the recording lifecycle: pointer and key events can
  // arrive while getUserMedia is still pending, before any re-render.
  const phase = useRef<"idle" | "starting" | "recording">("idle");
  const stopRequested = useRef(false);
  const mounted = useRef(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const Recognition = webSpeechRecognition();
  const available = useWebSpeech ? Recognition !== null : canRecord();

  const clearTimer = useCallback(() => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      const media = recorder.current;
      recorder.current = null;
      if (media) {
        // Closing the panel discards the note: nothing is transcribed after close.
        media.onstop = null;
        if (media.state !== "inactive") media.stop();
        media.stream.getTracks().forEach((track) => track.stop());
      }
      const rec = recognition.current;
      recognition.current = null;
      if (rec) {
        rec.onend = null;
        rec.abort();
      }
    };
  }, [clearTimer]);

  const transcribe = useCallback(
    async (blob: Blob) => {
      setState({ kind: "transcribing" });
      try {
        const { text } = await sdk.system.transcribeVoice({ file: blob });
        if (mounted.current) setState({ kind: "review", text: text.trim() });
      } catch (cause) {
        if (!mounted.current) return;
        const reason = cause instanceof Error ? cause.message : String(cause);
        if (Recognition) {
          setUseWebSpeech(true);
          toast.error(`bb transcription failed (${reason}). Hold to talk again to use browser speech.`);
        } else {
          toast.error(`Transcription failed: ${reason}`);
        }
        setState({ kind: "idle" });
      }
    },
    [sdk, Recognition],
  );

  const stop = useCallback(() => {
    if (phase.current === "starting") {
      stopRequested.current = true;
      return;
    }
    if (phase.current !== "recording") return;
    phase.current = "idle";
    clearTimer();
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    recognition.current?.stop();
  }, [clearTimer]);

  const start = useCallback(async () => {
    if (phase.current !== "idle" || state.kind !== "idle") return;
    phase.current = "starting";
    stopRequested.current = false;
    if (useWebSpeech) {
      if (!Recognition) {
        phase.current = "idle";
        return;
      }
      const rec = new Recognition();
      rec.lang = navigator.language || "en-US";
      rec.interimResults = false;
      rec.continuous = true;
      let heard = "";
      let failed = false;
      rec.onresult = (event) => {
        heard = Array.from(event.results, (result) => result[0]?.transcript ?? "").join(" ");
      };
      rec.onerror = (event) => {
        failed = event.error === "not-allowed" || event.error === "service-not-allowed";
        toast.error(`Speech recognition: ${event.error}`);
      };
      rec.onend = () => {
        recognition.current = null;
        phase.current = "idle";
        clearTimer();
        setState(failed || heard.trim() === "" ? { kind: "idle" } : { kind: "review", text: heard.trim() });
      };
      recognition.current = rec;
      try {
        rec.start();
      } catch (cause) {
        recognition.current = null;
        phase.current = "idle";
        toast.error(`Speech recognition: ${cause instanceof Error ? cause.message : String(cause)}`);
        return;
      }
    } else {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (cause) {
        phase.current = "idle";
        toast.error(`Microphone unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
        return;
      }
      if (!mounted.current || stopRequested.current) {
        // Released (or closed) while the microphone was opening: record nothing.
        stream.getTracks().forEach((track) => track.stop());
        phase.current = "idle";
        return;
      }
      const media = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recorder.current = null;
        void transcribe(new Blob(chunks, { type: media.mimeType || "audio/webm" }));
      };
      recorder.current = media;
      media.start();
    }
    phase.current = "recording";
    setState({ kind: "recording" });
    clearTimer();
    stopTimer.current = setTimeout(stop, MAX_RECORDING_MS);
  }, [state.kind, useWebSpeech, Recognition, clearTimer, transcribe, stop]);

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      void start();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      stop();
    }
  };

  if (!available && state.kind === "idle") return null;

  if (state.kind === "review" || state.kind === "sending") {
    const text = state.text;
    return (
      <div className="lb-voice">
        <label className="lb-muted" htmlFor="lb-voice-note">
          Your voice note. Edit it, then send it as your message.
        </label>
        <textarea
          id="lb-voice-note"
          value={text}
          disabled={state.kind === "sending"}
          onChange={(event) => setState({ kind: "review", text: event.target.value })}
        />
        <div className="lb-opts">
          <Button
            size="sm"
            disabled={state.kind === "sending" || text.trim() === ""}
            onClick={async () => {
              setState({ kind: "sending", text });
              try {
                await onSend(text.trim());
                toast.success("Sent to the lead");
                setState({ kind: "idle" });
              } catch (cause) {
                toast.error(`Not sent: ${cause instanceof Error ? cause.message : String(cause)}`);
                setState({ kind: "review", text });
              }
            }}
          >
            Send as my message
          </Button>
          <Button size="sm" variant="outline" disabled={state.kind === "sending"} onClick={() => setState({ kind: "idle" })}>
            Discard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      variant={state.kind === "recording" ? "default" : "outline"}
      size="sm"
      disabled={state.kind === "transcribing"}
      aria-pressed={state.kind === "recording"}
      onPointerDown={(event) => {
        event.preventDefault();
        void start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      <Icon name="Mic" className="size-4" />
      {state.kind === "recording"
        ? "Recording… release to stop"
        : state.kind === "transcribing"
          ? "Transcribing…"
          : "Hold to talk"}
    </Button>
  );
}

export function VoiceControls({
  board,
  onSend,
}: {
  board: Board | null;
  onSend(text: string): Promise<void>;
}) {
  return (
    <section aria-label="Voice" className="lb-voice">
      <div className="lb-opts">
        <ReadAloud board={board} />
        <PushToTalk onSend={onSend} />
      </div>
    </section>
  );
}
