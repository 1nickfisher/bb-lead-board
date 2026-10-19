import { useCallback, useEffect, useSyncExternalStore } from "react";
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import type { Board, Decision } from "@/lib/board";
import { sentStore, type SentMark } from "./sent-store";

export type { SentMark };

/** This window's shared sent state (see sent-store.ts), pruned against the panel's board. */
export function useSentMarks(board: Board | null) {
  const store = sentStore(`${experimental_usePluginId()}:sent`);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  useEffect(() => {
    if (board !== null) store.prune(board);
  }, [board, store]);

  const markFor = useCallback(
    (decision: Decision): SentMark | null => store.markFor(decision, snapshot),
    [store, snapshot],
  );

  return { store, markFor, inFlight: snapshot.inFlight };
}
