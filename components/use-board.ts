import { useCallback, useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { parseBoard, type Board } from "@/lib/board";
import { POLL_INTERVAL_MS } from "@/lib/config";

export interface BoardState {
  board: Board | null;
  /** Set when the latest read or parse failed; the last good board stays shown. */
  error: string | null;
  loading: boolean;
  refresh(): void;
}

function decode(content: string, encoding: "base64" | "utf8"): string {
  if (encoding === "utf8") return content;
  const bytes = Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Polls board.json on the board host through bb's file API. */
export function useBoard(hostId: string, path: string): BoardState {
  const sdk = useSdk();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastSha = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    sdk.files
      .read({ hostId, path, signal: controller.signal })
      .then((file) => {
        if (controller.signal.aborted) return;
        if (file.sha256 !== lastSha.current) {
          const parsed = parseBoard(decode(file.content, file.contentEncoding));
          if (parsed.ok) {
            lastSha.current = file.sha256;
            setBoard(parsed.board);
            setError(null);
          } else {
            setError(parsed.error);
          }
        } else {
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(`Can't read the board: ${message(cause)}`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [sdk, hostId, path]);

  useEffect(() => {
    // A different board: never leave the old one clickable while the new one loads.
    lastSha.current = null;
    setBoard(null);
    setError(null);
    setLoading(true);
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") refresh();
    }, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      inFlight.current?.abort();
    };
  }, [refresh]);

  return { board, error, loading, refresh };
}

/** A clock that re-renders the "updated N min ago" label. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
