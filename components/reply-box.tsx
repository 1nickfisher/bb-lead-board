// An inline reply under a card or an activity row. Nick types or dictates,
// edits, and presses Send; the message is his own, starting with a reference
// line. The draft stays in local storage until it is sent.
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { composeReply, type ReplyTarget } from "@/lib/reply";
import { appendText } from "./drafts";
import { Glyph } from "./glyphs";
import { HoldToTalkButton } from "./voice";

export function ReplyButton({ open, label, onToggle }: { open: boolean; label: string; onToggle(): void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="lb-reply-btn text-muted-foreground hover:text-foreground"
      aria-expanded={open}
      aria-label={label}
      onClick={onToggle}
    >
      <Glyph name="reply" />
      Reply
    </Button>
  );
}

export function ReplyBox({
  target,
  subject,
  draft,
  setDraft,
  voice,
  onSend,
  onClose,
}: {
  target: ReplyTarget;
  /** What the reply is about, for the text box's name. */
  subject: string;
  draft: string;
  setDraft(update: (previous: string) => string): void;
  /** Offer push-to-talk in the box. */
  voice: boolean;
  onSend(text: string): Promise<void>;
  onClose(): void;
}) {
  const id = useId();
  const [sending, setSending] = useState(false);
  const message = composeReply(target.reference, draft);
  return (
    <div className="lb-reply">
      <label className="lb-reply-ref" htmlFor={id}>
        Sends as your message, starting <span className="lb-mono">{target.reference}</span>
      </label>
      <textarea
        id={id}
        aria-label={`Reply: ${subject}`}
        value={draft}
        disabled={sending}
        placeholder="Type, or hold the microphone to talk"
        onChange={(event) => {
          const value = event.target.value;
          setDraft(() => value);
        }}
      />
      <div className="lb-reply-acts">
        {voice ? (
          <HoldToTalkButton label="Hold to talk into this reply" onText={(text) => setDraft((previous) => appendText(previous, text))} />
        ) : null}
        <span className="lb-reply-gap" />
        <Button size="sm" variant="outline" disabled={sending} onClick={onClose}>
          Close
        </Button>
        <Button
          size="sm"
          disabled={sending || message === null}
          onClick={async () => {
            if (message === null) return;
            setSending(true);
            try {
              await onSend(message);
              setDraft(() => "");
              toast.success("Sent to the lead");
              onClose();
            } catch (cause) {
              toast.error(`Not sent: ${cause instanceof Error ? cause.message : String(cause)}`);
            } finally {
              setSending(false);
            }
          }}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
