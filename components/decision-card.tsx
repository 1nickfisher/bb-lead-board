import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  BOARD_LIMITS,
  clip,
  explainPhrase,
  hasMalformedOption,
  needsConfirmation,
  needsRepair,
  recommendedOption,
  type Decision,
  type DecisionOption,
} from "@/lib/board";
import { askedAge } from "@/lib/freshness";
import { hygieneSummary } from "@/lib/hygiene";
import { replyTarget } from "@/lib/reply";
import { decisionScript } from "@/lib/speech";
import { BoardLink, LinkedText } from "./board-link";
import { appendText, useDraft } from "./drafts";
import { Glyph } from "./glyphs";
import { ReplyBox, ReplyButton } from "./reply-box";
import type { SentMark } from "./use-sent";
import { HoldToTalkButton, IconButton, useSpeaker } from "./voice";

/** The risk badge: every risk but "none" is named, with an icon. */
const RISK_BADGE: Record<Decision["risk"], string | null> = {
  none: null,
  staging: "Staging",
  production: "Production",
  money: "Money",
  security: "Security",
  unknown: "Unrecognised risk",
};

export function DecisionCard({
  decision,
  projectLabel,
  showProject,
  now,
  sent,
  sending,
  onChoose,
  onExplain,
  onSendText,
  voice,
}: {
  decision: Decision;
  /** The project's display name. */
  projectLabel: string | null;
  /** Name the project on the card (the home page mixes projects). */
  showProject: boolean;
  now: number;
  sent: SentMark | null;
  sending: boolean;
  onChoose(option: DecisionOption): void;
  onExplain(phrase: string): Promise<void>;
  /** Send Nick's own text to the lead thread (replies). */
  onSendText(text: string): Promise<void>;
  /** The voice setting is on: offer read aloud and push-to-talk. */
  voice: boolean;
}) {
  const [explaining, setExplaining] = useState(false);
  const [replying, setReplying] = useState(false);
  const target = replyTarget({ kind: "decision", decision });
  const [draft, setDraft] = useDraft(target.draftKey);
  const speaker = useSpeaker();
  const repair = needsRepair(decision);
  const malformed = !repair && hasMalformedOption(decision);
  const rec = recommendedOption(decision);
  const urgent = needsConfirmation(decision);
  const hygiene = hygieneSummary(decision);
  const age = askedAge(decision.createdAt, now);
  const explain = explainPhrase(decision);
  const project = projectLabel ? clip(projectLabel, BOARD_LIMITS.decision.project) : null;
  // Legacy asks carry an empty tag: fall back to the project.
  const tag = hygiene
    ? "Machine hygiene"
    : decision.tag?.trim()
      ? clip(decision.tag, BOARD_LIMITS.decision.tag)
      : project;
  const meta = [showProject && tag !== project ? project : null].filter(Boolean);
  const risk = RISK_BADGE[decision.risk];

  return (
    <article
      className={urgent ? "lb-card lb-card-urgent" : "lb-card"}
      aria-label={decision.title}
      data-decision-id={decision.id}
    >
      <div className="lb-top">
        <span className="lb-title">
          <BoardLink href={decision.link}>{clip(decision.title, BOARD_LIMITS.decision.title)}</BoardLink>
        </span>
        {tag ? <span className="lb-tag">{tag}</span> : null}
      </div>
      {age || meta.length > 0 || risk ? (
        <p className="lb-meta">
          {risk ? (
            <span className={urgent ? "lb-risk lb-risk-urgent" : "lb-risk"} data-testid="risk-badge">
              <Glyph name="alert" />
              {risk}
            </span>
          ) : null}
          {age ? (
            <span className={age.old ? "lb-age lb-age-old" : "lb-age"} data-testid="asked-age">
              <Glyph name="clock" />
              {age.label}
              {age.old ? <span className="lb-age-flag">over a day</span> : null}
            </span>
          ) : null}
          {meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </p>
      ) : null}
      {hygiene ? (
        <>
          <p className="lb-ctx lb-hyg-sum">{hygiene.summary}</p>
          <details className="lb-hyg">
            <summary>Details</summary>
            <p>{hygiene.details}</p>
            {hygiene.items.length > 0 ? (
              <ul>
                {hygiene.items.map((item, index) => (
                  <li key={index}>
                    <span className="lb-mono">{item.name}</span> <span className="lb-muted">{item.size}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </details>
        </>
      ) : decision.context ? (
        <p className="lb-ctx">
          <LinkedText text={clip(decision.context, BOARD_LIMITS.decision.context)} />
        </p>
      ) : null}
      {sent === null ? (
        <div className="lb-opts" role="group" aria-label="Options">
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
      {decision.links.length > 0 || explain ? (
        <div className="lb-card-foot">
          {decision.links.length > 0 ? (
            <ul className="lb-links" aria-label="Links">
              {decision.links.map((link, index) => (
                <li key={index}>
                  <BoardLink href={link.href} icon className="lb-chip-link">
                    {clip(link.label, BOARD_LIMITS.option.label)}
                  </BoardLink>
                </li>
              ))}
            </ul>
          ) : (
            <span />
          )}
          {explain ? (
            <div className="lb-card-acts">
              {voice && speaker?.engine ? (
                <IconButton
                  label={speaker.speakingKey === decision.id ? "Stop reading this card" : "Read this card aloud"}
                  pressed={speaker.speakingKey === decision.id}
                  onClick={() => speaker.toggle(decision.id, [decisionScript(decision)])}
                >
                  <Glyph name={speaker.speakingKey === decision.id ? "stop" : "speaker"} />
                </IconButton>
              ) : null}
              {voice ? (
                <HoldToTalkButton
                  label={`Hold to talk about: ${decision.title}`}
                  onText={(text) => {
                    setDraft((previous) => appendText(previous, text));
                    setReplying(true);
                  }}
                />
              ) : null}
              <ReplyButton
                open={replying}
                label={`Reply: ${decision.title}`}
                onToggle={() => setReplying((open) => !open)}
              />
              <Button
                variant="ghost"
                size="sm"
                className="lb-explain text-muted-foreground hover:text-foreground"
                disabled={explaining}
                aria-label={`Explain: ${decision.title}`}
                onClick={() => {
                  setExplaining(true);
                  void onExplain(explain).finally(() => setExplaining(false));
                }}
              >
                Explain
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {replying && explain ? (
        <ReplyBox
          target={target}
          subject={decision.title}
          draft={draft}
          setDraft={setDraft}
          voice={false}
          onSend={onSendText}
          onClose={() => setReplying(false)}
        />
      ) : null}
    </article>
  );
}
