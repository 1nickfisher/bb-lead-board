// Push-to-talk recording, shared by the header's Hold to talk and each card's
// microphone. Records a short note and transcribes it with bb's configured
// voice service, or with the browser's Web Speech API when recording or bb
// transcription is unavailable. The text goes to `onText`; nothing is sent.
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { toast } from "sonner";
import { useSdk } from "@get-bb/plugin-sdk/app";

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

export type RecorderState = "idle" | "recording" | "transcribing";

export interface Recorder {
  state: RecorderState;
  /** Whether this browser can record or recognise speech at all. */
  available: boolean;
  /** Props for a hold-to-talk button: press to record, release to stop. */
  holdProps: {
    onPointerDown(event: PointerEvent): void;
    onPointerUp(): void;
    onPointerLeave(): void;
    onPointerCancel(): void;
    onKeyDown(event: KeyboardEvent): void;
    onKeyUp(event: KeyboardEvent): void;
  };
}

export function useRecorder(onText: (text: string) => void): Recorder {
  const sdk = useSdk();
  const [state, setState] = useState<RecorderState>("idle");
  const [useWebSpeech, setUseWebSpeech] = useState(() => !canRecord());
  // Synchronous mirrors of the recording lifecycle: pointer and key events can
  // arrive while getUserMedia is still pending, before any re-render.
  const phase = useRef<"idle" | "starting" | "recording">("idle");
  const stopRequested = useRef(false);
  const mounted = useRef(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deliver = useRef(onText);
  deliver.current = onText;
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
      setState("transcribing");
      try {
        const { text } = await sdk.system.transcribeVoice({ file: blob });
        if (!mounted.current) return;
        setState("idle");
        if (text.trim() !== "") deliver.current(text.trim());
      } catch (cause) {
        if (!mounted.current) return;
        const reason = cause instanceof Error ? cause.message : String(cause);
        if (Recognition) {
          setUseWebSpeech(true);
          toast.error(`bb transcription failed (${reason}). Hold to talk again to use browser speech.`);
        } else {
          toast.error(`Transcription failed: ${reason}`);
        }
        setState("idle");
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
    if (phase.current !== "idle" || state !== "idle") return;
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
        setState("idle");
        if (!failed && heard.trim() !== "") deliver.current(heard.trim());
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
    setState("recording");
    clearTimer();
    stopTimer.current = setTimeout(stop, MAX_RECORDING_MS);
  }, [state, useWebSpeech, Recognition, clearTimer, transcribe, stop]);

  return {
    state,
    available,
    holdProps: {
      onPointerDown: (event) => {
        event.preventDefault();
        void start();
      },
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
      onKeyDown: (event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          void start();
        }
      },
      onKeyUp: (event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          stop();
        }
      },
    },
  };
}
