import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useBbNavigate,
  useRpc,
  useSdk,
  useSettings,
  type PluginNavPanelProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
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
  BOARD_LIMITS,
  clip,
  decisionFingerprint,
  canSend,
  needsConfirmation,
  type Board,
  type Decision,
  type DecisionOption,
} from "@/lib/board";
import { isReady, notConfiguredMessage, resolveConfig, type ReadyConfig } from "@/lib/config";
import { freshness } from "@/lib/freshness";
import { projectFromLocation } from "@/lib/views";
import type { serverContract } from "@/lib/voice-contract";
import { BoardHostContext } from "./board-link";
import { Glyph } from "./glyphs";
import { HomeView, ProjectSwitcher, ProjectView, type DecisionHandlers } from "./sections";
import { useSound } from "./sound";
import { useBoard, useNow } from "./use-board";
import { useNewDecisions } from "./use-new-decisions";
import { useSentMarks } from "./use-sent";
import { IconButton, SpeakerProvider, VoiceButtons, VoiceNote, VoicePicker } from "./voice";
import "./lead-board.css";

const RISK_LABEL: Record<Decision["risk"], string> = {
  none: "",
  staging: "Staging",
  production: "Production",
  money: "Money",
  security: "Security",
  unknown: "Unrecognised-risk",
};

interface PendingChoice {
  decision: Decision;
  option: DecisionOption;
}

/** Which view is showing: the home page (null) or one project. */
export interface ViewControl {
  project: string | null;
  setProject(id: string | null): void;
}

/** The side panel keeps its view in memory; the sidebar page keeps it in the URL. */
export function LeadBoard({ view }: Partial<PluginThreadPanelProps> & { view?: ViewControl }) {
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
  return <LoadedBoard config={config} view={view} />;
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

function LoadedBoard({ config, view }: { config: ReadyConfig; view?: ViewControl }) {
  const sdk = useSdk();
  const [localProject, setLocalProject] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const project = view ? view.project : localProject;
  const setProject = view ? view.setProject : setLocalProject;
  const navigate = useBbNavigate();
  const { board, error, loading, refresh } = useBoard(config.hostId, config.path);
  const forced = useForceRefresh(refresh);
  const now = useNow();
  const sent = useSentMarks(board);
  const highlighted = useNewDecisions(board);
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

  // Explain asks a question; it answers nothing, so it needs no confirmation.
  const explain = useCallback(
    async (phrase: string) => {
      try {
        await sendText(phrase);
        toast.success("Asked the lead to explain.");
      } catch (cause) {
        toast.error(`Not sent: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    },
    [sendText],
  );

  const handlers: DecisionHandlers = {
    inFlight: sent.inFlight,
    sentFor: sent.markFor,
    onChoose: choose,
    onExplain: explain,
    onSendText: sendText,
    voice: config.voice,
    highlighted,
  };
  const fresh = board ? freshness(board, now) : null;

  const content = (
    <BoardHostContext.Provider value={config.hostId}>
    <div className="lb lb-root">
      <header className="lb-hdr">
        <h2>Lead board</h2>
        <div className="lb-hdr-side">
          <span className="lb-muted" data-testid="freshness">{fresh ? fresh.label : loading ? "loading…" : ""}</span>
          <span className="lb-hdr-btns">
            <SoundToggle />
            {config.voice ? (
              <VoiceButtons board={board} onNote={(text) => setNote((previous) => (previous ? `${previous} ${text}` : text))} />
            ) : null}
            <IconButton
              label={forced.running ? "Rebuilding the board…" : "Refresh the board"}
              aria-busy={forced.running}
              data-testid="refresh-board"
              onClick={forced.force}
            >
              <Icon name="RefreshCw" className={forced.running ? "size-4 lb-spin" : "size-4"} />
            </IconButton>
          </span>
        </div>
      </header>

      <SoundHint />

      {error !== null ? (
        <div className="lb-banner lb-banner-error" role="alert">
          {error}
          {board ? " Showing the last board read." : null}
        </div>
      ) : null}

      {forced.problem !== null ? (
        <div className="lb-banner lb-banner-error" role="status" data-testid="refresh-error">
          {forced.problem}
          {board ? " Showing the last board read." : null}
        </div>
      ) : null}

      {board && fresh?.stale ? <StaleBanner board={board} minutes={fresh.staleMinutes} /> : null}

      {board && !view ? <ProjectSwitcher board={board} project={project} onChange={setProject} /> : null}

      {config.voice ? <VoicePicker /> : null}
      {note !== null ? (
        <VoiceNote text={note} onChange={setNote} onDiscard={() => setNote(null)} onSend={sendText} />
      ) : null}

      {board === null ? (
        loading ? (
          <div className="lb-empty" role="status">
            Loading the board…
          </div>
        ) : null
      ) : project === null ? (
        <HomeView board={board} now={now} handlers={handlers} onOpenProject={setProject} />
      ) : (
        <ProjectView board={board} id={project} now={now} handlers={handlers} onHome={() => setProject(null)} />
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
    </BoardHostContext.Provider>
  );
  return config.voice ? <SpeakerProvider>{content}</SpeakerProvider> : content;
}

/**
 * The header's refresh: re-read board.json at once, ask the board host to
 * rebuild the feed (the server allows one rebuild per 15 seconds), then read
 * again. A failure is shown and the last good board stays.
 */
function useForceRefresh(refresh: () => void) {
  const rpc = useRpc<typeof serverContract>();
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const force = useCallback(() => {
    refresh();
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    Promise.resolve()
      .then(() => rpc.call("refreshBoard", {}))
      .then((result) => {
        if (result.ok) {
          setProblem(null);
          refresh();
        } else {
          setProblem(`Could not rebuild the board: ${result.reason}`);
        }
      })
      .catch((cause: unknown) => {
        setProblem(`Could not rebuild the board: ${cause instanceof Error ? cause.message : String(cause)}`);
      })
      .finally(() => {
        busy.current = false;
        setRunning(false);
      });
  }, [refresh, rpc]);
  return { force, running, problem };
}

/** Header: mute or unmute the new-decision chime (persisted). */
function SoundToggle() {
  const sound = useSound();
  const label = sound.muted ? "Unmute the new-decision sound" : "Mute the new-decision sound";
  return (
    <IconButton label={label} pressed={sound.muted} onClick={() => sound.store.toggleMuted()}>
      <Glyph name={sound.muted ? "bell-off" : "bell"} className="size-4" />
    </IconButton>
  );
}

/** Browsers start audio only after a user gesture; say so until one arms the chime. */
function SoundHint() {
  const sound = useSound();
  if (sound.muted || sound.armed || !sound.supported) return null;
  return (
    <p className="lb-sound-hint" data-testid="sound-hint">
      <Glyph name="bell" />
      Tap anywhere on the board to turn on the sound for new decisions.
    </p>
  );
}

function StaleBanner({ board, minutes }: { board: Board; minutes: number | null }) {
  const text =
    board.schema === 1
      ? minutes === null
        ? "The board has no valid update time, so it may be out of date."
        : `The board is ${minutes} min old, so it may be out of date.`
      : minutes === null
        ? "The board has no valid check time, so it may be out of date."
        : `The feed last checked the board ${minutes} min ago, so it may be out of date.`;
  return (
    <div className="lb-banner" role="status" data-testid="stale-banner">
      {text} Check the lead thread before you act on it.
    </div>
  );
}

/**
 * Full-height scrolling frame for the nav-panel page. A project view is
 * `?project=<id>`, or the `project/<id>` sub-path the page navigates to.
 */
export function LeadBoardPage({ subPath = "" }: Partial<PluginNavPanelProps>) {
  const navigate = useBbNavigate();
  const project = projectFromLocation(subPath, typeof window === "undefined" ? "" : window.location.search);
  const view: ViewControl = {
    project,
    setProject: (id) => navigate.toPluginPanel("board", { subPath: id === null ? "" : `project/${encodeURIComponent(id)}` }),
  };
  return (
    <div className="lb-page">
      <LeadBoard view={view} />
    </div>
  );
}
