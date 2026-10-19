import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useBbNavigate, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import {
  ageMs,
  BOARD_LIMITS,
  clip,
  decisionFingerprint,
  formatAge,
  canSend,
  hasMalformedOption,
  needsRepair,
  isStale,
  needsConfirmation,
  recommendedOption,
  type Board,
  type ComingUp,
  type Decision,
  type DecisionOption,
  type DoneItem,
  type InFlightGroup,
} from "@/lib/board";
import { isReady, notConfiguredMessage, resolveConfig, type ReadyConfig } from "@/lib/config";
import { useBoard, useNow } from "./use-board";
import { useSentMarks, type SentMark } from "./use-sent";
import { VoiceControls } from "./voice";
import "./lead-board.css";

const RISK_LABEL: Record<Decision["risk"], string> = {
  none: "",
  staging: "Staging",
  production: "Production",
  money: "Money",
  security: "Security",
  unknown: "Unrecognised-risk",
};

function SafeLink({ href, children }: { href: string | null; children: string }) {
  const navigate = useBbNavigate();
  if (href === null || !/^https:\/\//.test(href)) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => {
        if (navigate.openUrl(href)) event.preventDefault();
      }}
    >
      {children}
    </a>
  );
}

function DecisionCard({
  decision,
  sent,
  sending,
  onChoose,
}: {
  decision: Decision;
  sent: SentMark | null;
  sending: boolean;
  onChoose(option: DecisionOption): void;
}) {
  const repair = needsRepair(decision);
  const malformed = !repair && hasMalformedOption(decision);
  const rec = recommendedOption(decision);
  const urgent = needsConfirmation(decision);
  // Legacy asks carry an empty tag: fall back to the project.
  const tag = decision.tag?.trim() ? clip(decision.tag, BOARD_LIMITS.decision.tag) : decision.project ? clip(decision.project, BOARD_LIMITS.decision.project) : null;
  return (
    <article
      className={urgent ? "lb-card lb-card-urgent" : "lb-card"}
      aria-label={decision.title}
      data-decision-id={decision.id}
    >
      <div className="lb-top">
        <span className="lb-title">
          <SafeLink href={decision.link}>{clip(decision.title, BOARD_LIMITS.decision.title)}</SafeLink>
        </span>
        {tag ? <span className="lb-tag">{tag}</span> : null}
      </div>
      {decision.context ? <p className="lb-ctx">{clip(decision.context, BOARD_LIMITS.decision.context)}</p> : null}
      {sent === null ? (
        <div className="lb-opts">
          {decision.options.map((option, index) => (
            <Button
              key={index}
              size="sm"
              variant={option.recommended ? "default" : "outline"}
              data-recommended={option.recommended ? "true" : undefined}
              disabled={sending || repair || malformed}
              onClick={() => onChoose(option)}
            >
              {option.recommended ? <span aria-hidden="true">★</span> : null}
              {clip(option.label, BOARD_LIMITS.option.label)}
            </Button>
          ))}
        </div>
      ) : (
        <p className="lb-sent" role="status">
          <span>
            Sent: waiting for the lead. You said "
            <span className="lb-phrase" data-testid="sent-phrase">
              {sent.phrase}
            </span>
            "
          </span>
        </p>
      )}
      {repair ? (
        <p className="lb-malformed" role="note">
          Needs repair: {clip(decision.invalidReason ?? "the lead must fix this decision", BOARD_LIMITS.option.why)}
        </p>
      ) : null}
      {sent === null && malformed ? (
        <p className="lb-malformed" role="note">
          Malformed option: a phrase is empty, too long or has extra spaces, or there are too many
          options, so these buttons are off until the lead fixes the board.
        </p>
      ) : null}
      {rec ? (
        <p className="lb-why">
          <b>Recommended: {clip(rec.label, BOARD_LIMITS.option.label)}</b>
          {rec.why?.trim() ? ` because ${clip(rec.why.trim().replace(/^because\s+/i, ""), BOARD_LIMITS.option.why)}` : null}
        </p>
      ) : null}
    </article>
  );
}

function ComingUpSection({ items }: { items: ComingUp[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Coming up">
      <h3 className="lb-sec">Coming up</h3>
      <details>
        <summary>
          {items.length} {items.length === 1 ? "ask" : "asks"} the lead will bring when ready
        </summary>
        <ul>
          {items.map((item, index) => (
            <li key={index}>
              {item.after ? <span className="lb-wait">After {clip(item.after, BOARD_LIMITS.comingUp.after)}</span> : null}
              {item.after ? " · " : null}
              {item.project ? `${clip(item.project, BOARD_LIMITS.comingUp.project)}: ` : null}
              {clip(item.title, BOARD_LIMITS.comingUp.title)}
              {item.eta ? <span className="lb-muted"> · {clip(item.eta, BOARD_LIMITS.comingUp.eta)}</span> : null}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

const STATE_DOT: Record<"ok" | "wait" | "blocked", { className: string; label: string }> = {
  ok: { className: "lb-ok", label: "on track" },
  wait: { className: "lb-wait", label: "waiting" },
  blocked: { className: "lb-blocked", label: "blocked" },
};

function InFlightSection({ groups }: { groups: InFlightGroup[] }) {
  const visible = groups.filter((group) => group.items.length > 0);
  if (visible.length === 0) return null;
  return (
    <section aria-label="In flight">
      <h3 className="lb-sec">In flight</h3>
      <div className="lb">
        {visible.map((group) => {
          const blocked = group.items.filter((item) => item.state === "blocked").length;
          return (
            <details key={group.project}>
              <summary>
                {clip(group.project, BOARD_LIMITS.inFlightGroup.project)} · {group.items.length}
                {blocked > 0 ? <span className="lb-blocked"> · {blocked} blocked</span> : null}
              </summary>
              <ul>
                {group.items.map((item, index) => (
                  <li key={index}>
                    <span className={STATE_DOT[item.state].className} aria-label={STATE_DOT[item.state].label}>
                      ●
                    </span>{" "}
                    <SafeLink href={item.link}>{clip(item.text, BOARD_LIMITS.inFlight.text)}</SafeLink>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function sameLocalDay(iso: string | null, now: number): boolean {
  if (iso === null) return true;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return true;
  return new Date(at).toDateString() === new Date(now).toDateString();
}

function DoneSection({ items, now }: { items: DoneItem[]; now: number }) {
  const today = items.filter((item) => sameLocalDay(item.at, now));
  if (today.length === 0) return null;
  return (
    <section aria-label="Done today">
      <details>
        <summary>Done today · {today.length}</summary>
        <ul>
          {today.map((item, index) => (
            <li key={index}>
              <SafeLink href={item.link}>{clip(item.text, BOARD_LIMITS.done.text)}</SafeLink>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

interface PendingChoice {
  decision: Decision;
  option: DecisionOption;
}

export function LeadBoard() {
  const { values, isLoading } = useSettings();
  if (isLoading) {
    return (
      <div className="lb">
        <header className="lb-hdr">
          <h2>Lead board</h2>
        </header>
        <div className="lb-empty" role="status">
          Loading the board…
        </div>
      </div>
    );
  }
  const config = resolveConfig(values);
  if (!isReady(config)) {
    return (
      <div className="lb">
        <header className="lb-hdr">
          <h2>Lead board</h2>
        </header>
        <div className="lb-empty" role="status">
          {notConfiguredMessage(config.missing)}
        </div>
      </div>
    );
  }
  return <LoadedBoard config={config} />;
}

/** The pending choice, if the board still asks exactly that question. */
function liveChoice(board: Board | null, choice: PendingChoice | null): PendingChoice | null {
  if (board === null || choice === null) return null;
  const fingerprint = decisionFingerprint(choice.decision);
  const decision = board.decisions.find(
    (candidate) => candidate.id === choice.decision.id && decisionFingerprint(candidate) === fingerprint,
  );
  const option = decision?.options.find((candidate) => candidate.phrase === choice.option.phrase);
  return decision && option ? { decision, option } : null;
}

function LoadedBoard({ config }: { config: ReadyConfig }) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const { board, error, loading, refresh } = useBoard(config.hostId, config.path);
  const now = useNow();
  const sent = useSentMarks(board);
  const [pending, setPending] = useState<PendingChoice | null>(null);
  const confirmable = liveChoice(board, pending);

  useEffect(() => {
    if (pending !== null && confirmable === null) {
      setPending(null);
      toast.info("That decision changed on the board. Check it again before answering.");
    }
  }, [pending, confirmable]);

  const sendText = useCallback(
    async (text: string) => {
      await sdk.threads.send({
        threadId: config.leadThreadId,
        mode: "queue-if-active",
        input: [{ type: "text", text, mentions: [] }],
      });
    },
    [sdk, config.leadThreadId],
  );

  const send = useCallback(
    async ({ decision, option }: PendingChoice) => {
      // Never send an altered phrase; begin() refuses if any panel in this
      // window already sent this decision or is sending it.
      if (!canSend(decision) || !sent.store.begin(decision)) return;
      try {
        await sendText(option.phrase);
        sent.store.markSent(decision, option.phrase);
      } catch (cause) {
        toast.error(`Not sent: ${cause instanceof Error ? cause.message : String(cause)}`);
      } finally {
        sent.store.end(decision.id);
      }
    },
    [sendText, sent.store],
  );

  const choose = (decision: Decision, option: DecisionOption) => {
    if (!canSend(decision)) return;
    if (needsConfirmation(decision)) setPending({ decision, option });
    else void send({ decision, option });
  };

  return (
    <div className="lb">
      <header className="lb-hdr">
        <h2>Lead board</h2>
        <div className="lb-hdr-side">
          <span className="lb-muted">{board ? formatAge(board.updatedAt, now) : loading ? "loading…" : ""}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label="Refresh the board"
            onClick={refresh}
          >
            <Icon name="RefreshCw" className="size-4" />
          </Button>
        </div>
      </header>

      {error !== null ? (
        <div className="lb-banner lb-banner-error" role="alert">
          {error}
          {board ? " Showing the last board read." : null}
        </div>
      ) : null}

      {board && isStale(board.updatedAt, now) ? <StaleBanner board={board} now={now} /> : null}

      {config.voice ? <VoiceControls board={board} onSend={sendText} /> : null}

      {board === null ? (
        loading ? (
          <div className="lb-empty" role="status">
            Loading the board…
          </div>
        ) : null
      ) : (
        <BoardSections
          board={board}
          now={now}
          inFlight={sent.inFlight}
          sentFor={sent.markFor}
          onChoose={choose}
        />
      )}

      <p className="lb-note">
        Tapping a button sends its exact phrase to the lead thread as you, so it counts like typing it. The
        lead still reads production approvals back to you before acting.{" "}
        <button type="button" className="lb-linkbtn" onClick={() => navigate.toThread(config.leadThreadId)}>
          Open the lead thread
        </button>
      </p>

      <Dialog open={confirmable !== null} onOpenChange={(open) => (open ? null : setPending(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmable
                ? `${RISK_LABEL[confirmable.decision.risk]} decision: send your answer?`
                : "Send your answer?"}
            </DialogTitle>
            <DialogDescription>
              {confirmable ? (
                <>
                  This posts <span className="lb-phrase">"{confirmable.option.phrase}"</span> to the lead
                  thread as your message, for "{clip(confirmable.decision.title, BOARD_LIMITS.decision.title)}". The lead still reads it back to
                  you before anything runs.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const choice = liveChoice(board, pending);
                setPending(null);
                if (choice) void send(choice);
              }}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StaleBanner({ board, now }: { board: Board; now: number }) {
  const age = ageMs(board.updatedAt, now);
  const minutes = age === null ? null : Math.floor(age / 60_000);
  return (
    <div className="lb-banner" role="status" data-testid="stale-banner">
      {minutes === null
        ? "The board has no valid update time, so it may be out of date."
        : `The board is ${minutes} min old, so it may be out of date.`}{" "}
      Check the lead thread before you act on it.
    </div>
  );
}

function BoardSections({
  board,
  now,
  inFlight,
  sentFor,
  onChoose,
}: {
  board: Board;
  now: number;
  inFlight: ReadonlySet<string>;
  sentFor(decision: Decision): SentMark | null;
  onChoose(decision: Decision, option: DecisionOption): void;
}) {
  return (
    <>
      <section aria-label="Needs you now" className="lb">
        <h3 className="lb-sec">Needs you now · {board.decisions.length}</h3>
        {board.decisions.length === 0 ? (
          <div className="lb-empty">Nothing needs you right now.</div>
        ) : (
          board.decisions.map((decision) => (
            <DecisionCard
              key={decision.id}
              decision={decision}
              sent={sentFor(decision)}
              sending={inFlight.has(decision.id)}
              onChoose={(option) => onChoose(decision, option)}
            />
          ))
        )}
      </section>
      <ComingUpSection items={board.comingUp} />
      <InFlightSection groups={board.inFlight} />
      <DoneSection items={board.done} now={now} />
    </>
  );
}

/** Full-height scrolling frame for the nav-panel page. */
export function LeadBoardPage() {
  return (
    <div className="lb-page">
      <LeadBoard />
    </div>
  );
}
