import { describe, expect, it } from "vitest";
import { linkify, parseHref } from "./links";

const HOST = "host_board1";

describe("parseHref", () => {
  it("keeps an https link as given", () => {
    expect(parseHref("https://example.com/pull/42?x=1#y", HOST)).toEqual({
      kind: "url",
      href: "https://example.com/pull/42?x=1#y",
    });
  });

  it.each(["http://example.com", "javascript:alert(1)", "https://", "https://exa mple.com", "//example.com", ""])(
    "refuses %j",
    (href) => {
      expect(parseHref(href, HOST).kind).toBe("invalid");
    },
  );

  it("opens a thread link with bb navigation, never as a URL", () => {
    expect(parseHref("thread:thr_abc123", HOST)).toEqual({ kind: "thread", threadId: "thr_abc123" });
    expect(parseHref("thread:thr_abc123/x", HOST).kind).toBe("invalid");
    expect(parseHref("thread:https://evil.example", HOST).kind).toBe("invalid");
  });

  it("opens a file in a thread's storage as a thread-storage file", () => {
    expect(parseHref("file:/srv/bb/thread-storage/thr_lead1/plans/demo.md", HOST)).toEqual({
      kind: "file",
      file: { kind: "thread-storage", threadId: "thr_lead1", path: "plans/demo.md" },
    });
  });

  it("opens any other absolute file on the board host", () => {
    expect(parseHref("file:/home/agent/notes/today.md", HOST)).toEqual({
      kind: "file",
      file: { kind: "host", hostId: HOST, path: "/home/agent/notes/today.md" },
    });
  });

  it.each(["file:notes.md", "file:/a/../etc/passwd", "file://host/x", "file:/a/./b", "file:/a\u0000b"])(
    "refuses the file link %j",
    (href) => {
      expect(parseHref(href, HOST).kind).toBe("invalid");
    },
  );

  it("refuses a file link when no board host is known", () => {
    expect(parseHref("file:/home/agent/x.md", null).kind).toBe("invalid");
  });

  it("leaves a repo link the feed did not turn into a URL as plain text", () => {
    expect(parseHref("repo:demo/docs/runbook.md", HOST)).toEqual({
      kind: "repo",
      project: "demo",
      path: "docs/runbook.md",
    });
    expect(parseHref("repo:demo", HOST).kind).toBe("invalid");
  });
});

describe("linkify", () => {
  it("turns URLs and thread ids in text into links, leaving trailing punctuation", () => {
    expect(linkify("See https://example.com/pull/4. Plan in thr_plan1, then done.")).toEqual([
      { text: "See " },
      { text: "https://example.com/pull/4", href: "https://example.com/pull/4" },
      { text: ". Plan in " },
      { text: "thr_plan1", href: "thread:thr_plan1" },
      { text: ", then done." },
    ]);
  });

  it("keeps a closing bracket that belongs to the URL", () => {
    expect(linkify("(https://example.com/wiki/A_(b))")).toEqual([
      { text: "(" },
      { text: "https://example.com/wiki/A_(b)", href: "https://example.com/wiki/A_(b)" },
      { text: ")" },
    ]);
  });

  it("does not link a thread id inside a word or an http URL", () => {
    expect(linkify("xthr_abc and http://example.com")).toEqual([{ text: "xthr_abc and http://example.com" }]);
  });

  it("returns plain text unchanged", () => {
    expect(linkify("nothing to see")).toEqual([{ text: "nothing to see" }]);
    expect(linkify("")).toEqual([]);
  });
});
