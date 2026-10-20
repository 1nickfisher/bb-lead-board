// Nick's replies to a card or a recent-activity row: a one-line reference
// first, so the lead knows what the reply is about, then Nick's own text.
import type { Decision, RecentEvent } from "./board";
import { shortHash } from "./hash";

export type ReplySubject = { kind: "decision"; decision: Decision } | { kind: "event"; event: RecentEvent };

export interface ReplyTarget {
  /** The first line of the message, such as "Re: <title> [<decision id>]". */
  reference: string;
  /** Local-storage key for the unsent draft. */
  draftKey: string;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function replyTarget(subject: ReplySubject): ReplyTarget {
  if (subject.kind === "decision") {
    const { decision } = subject;
    return { reference: `Re: ${oneLine(decision.title)} [${decision.id}]`, draftKey: `decision:${decision.id}` };
  }
  const { event } = subject;
  const where = [event.project ?? "no project", event.kind, event.at].join(" ");
  return {
    reference: `Re: ${oneLine(event.text)} [${oneLine(where)}]`,
    draftKey: `event:${shortHash([event.at, event.project, event.kind, event.text].join("\u0000"))}`,
  };
}

/** The message to send, or null when there is nothing to send. Never sent without Nick pressing Send. */
export function composeReply(reference: string, text: string): string | null {
  const body = text.trim();
  return body === "" ? null : `${reference}\n${body}`;
}
