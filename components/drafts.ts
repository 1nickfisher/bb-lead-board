// Unsent replies, one per card or activity row, kept in this browser's local
// storage until they are sent.
import { useCallback, useState } from "react";
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    if (value === "") localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked: the draft lives only in memory.
  }
}

export function useDraft(draftKey: string): [string, (update: (previous: string) => string) => void] {
  const key = `${experimental_usePluginId()}:draft:${draftKey}`;
  const [state, setState] = useState(() => ({ key, value: read(key) }));
  const value = state.key === key ? state.value : read(key);
  const update = useCallback(
    (next: (previous: string) => string) => {
      setState((previous) => {
        const current = previous.key === key ? previous.value : read(key);
        const value = next(current);
        write(key, value);
        return { key, value };
      });
    },
    [key],
  );
  return [value, update];
}

/** Add dictated text to a draft, on a new line when the draft already has text. */
export function appendText(draft: string, text: string): string {
  return draft.trim() === "" ? text : `${draft.replace(/\s+$/, "")}\n${text}`;
}
