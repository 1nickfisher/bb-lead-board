// Board link forms (board.json schema 2, decisions[].links[].href) and the
// panel's plain-text linkifier. The feed writes these, so every form is
// checked here; anything else stays inert text.
import { isThreadId } from "./config";

/** A live file the panel can open with bb's file preview. */
export type FileTarget =
  | { kind: "thread-storage"; threadId: string; path: string }
  | { kind: "host"; hostId: string; path: string };

export type LinkTarget =
  | { kind: "url"; href: string }
  | { kind: "thread"; threadId: string }
  | { kind: "file"; file: FileTarget }
  /** The feed turns repo: links into GitHub URLs; one that arrives unconverted stays text. */
  | { kind: "repo"; project: string; path: string }
  | { kind: "invalid" };

const INVALID: LinkTarget = { kind: "invalid" };
const CONTROL = /[\u0000-\u001f\u007f]/;
const THREAD_STORAGE = /^\/(?:.+\/)?thread-storage\/(thr_[a-z0-9]+)\/(.+)$/;

function isHttpsUrl(href: string): boolean {
  if (!href.startsWith("https://") || /\s/.test(href) || CONTROL.test(href)) return false;
  try {
    return new URL(href).hostname !== "";
  } catch {
    return false;
  }
}

/** An absolute path with no empty, "." or ".." segments. */
function isCleanAbsolutePath(path: string): boolean {
  if (!path.startsWith("/") || CONTROL.test(path) || path.includes("\\")) return false;
  return path
    .slice(1)
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Read one href. `hostId` is the board host, which holds any file outside a
 * thread's storage; without it such file links are refused.
 */
export function parseHref(href: string, hostId: string | null): LinkTarget {
  if (href.startsWith("https://")) return isHttpsUrl(href) ? { kind: "url", href } : INVALID;
  if (href.startsWith("thread:")) {
    const threadId = href.slice("thread:".length);
    return isThreadId(threadId) ? { kind: "thread", threadId } : INVALID;
  }
  if (href.startsWith("file:")) {
    const path = href.slice("file:".length);
    if (!isCleanAbsolutePath(path)) return INVALID;
    const storage = THREAD_STORAGE.exec(path);
    if (storage) return { kind: "file", file: { kind: "thread-storage", threadId: storage[1]!, path: storage[2]! } };
    return hostId === null ? INVALID : { kind: "file", file: { kind: "host", hostId, path } };
  }
  if (href.startsWith("repo:")) {
    const rest = href.slice("repo:".length);
    const slash = rest.indexOf("/");
    if (slash <= 0 || slash === rest.length - 1 || CONTROL.test(rest)) return INVALID;
    return { kind: "repo", project: rest.slice(0, slash), path: rest.slice(slash + 1) };
  }
  return INVALID;
}

export type TextPart = { text: string; href?: string };

const URL_IN_TEXT = /https:\/\/[^\s<>"'`]+/g;
const THREAD_IN_TEXT = /(?<![A-Za-z0-9_])thr_[a-z0-9]+(?![A-Za-z0-9_])/g;

/** Drop trailing punctuation, and a closing bracket the URL did not open. */
function trimUrl(url: string): string {
  let end = url.length;
  for (;;) {
    const last = url[end - 1];
    if (last === undefined) break;
    if (".,;:!?".includes(last)) {
      end -= 1;
      continue;
    }
    if (last === ")") {
      const head = url.slice(0, end);
      if ((head.match(/\)/g)?.length ?? 0) > (head.match(/\(/g)?.length ?? 0)) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

function splitThreads(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const match of text.matchAll(THREAD_IN_TEXT)) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    parts.push({ text: match[0], href: `thread:${match[0]}` });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** Split text into plain runs and links: https URLs and thread ids. */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const url = trimUrl(match[0]);
    if (!isHttpsUrl(url)) continue;
    parts.push(...splitThreads(text.slice(at, match.index)));
    parts.push({ text: url, href: url });
    at = match.index + url.length;
  }
  parts.push(...splitThreads(text.slice(at)));
  return parts;
}
