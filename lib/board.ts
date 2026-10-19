// board.json schema version 1 (TYP-1568) and the pure helpers the panel uses.
// The file is written by the lead, so it is parsed here at the boundary and
// everything downstream works with typed values.
import { z } from "zod";
import { STALE_AFTER_MS } from "./config";

// No length limits at parse time: an overlong field must never hide the board.
// Long text is clipped for display only; phrases are never altered.
const text = () => z.string().trim().min(1);
const optionalText = () => z.string().nullish().transform((value) => value ?? null);

/**
 * Field limits in UTF-16 code units, the same object as schemas/board-limits.json
 * from TYP-1568 (docs/board-schema.md); lib/board-limits.test.ts fails if
 * they drift.
 */
export const BOARD_LIMITS = {
  board: { updatedAt: 40, updatedBy: 40 },
  decision: { id: 80, title: 200, project: 60, tag: 80, context: 1000, link: 500, approvalId: 80, createdAt: 40 },
  option: { label: 80, phrase: 500, why: 400 },
  comingUp: { title: 200, project: 60, after: 200, eta: 80 },
  inFlightGroup: { project: 60 },
  inFlight: { text: 400, link: 500 },
  done: { text: 400, at: 40, link: 500 },
  maxOptions: 8,
} as const;

/** Clip text to `max` UTF-16 units for display, never splitting a surrogate pair. */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max - 1;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${value.slice(0, end).trimEnd()}…`;
}

export const RISKS = ["none", "staging", "production", "money", "security"] as const;
/** "unknown" stands for a risk value outside schema 1; it fails closed. */
export type Risk = (typeof RISKS)[number] | "unknown";
/** Risks that get a confirmation step before the phrase is sent. */
export const CONFIRM_RISKS: ReadonlySet<Risk> = new Set(["production", "security", "money", "unknown"]);

const riskSchema = z.preprocess(
  (value) => (value === undefined || value === null ? "none" : value),
  z.unknown().transform((value): Risk => {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return (RISKS as readonly string[]).includes(normalized) ? (normalized as Risk) : "unknown";
  }),
);

const optionSchema = z.object({
  label: text(),
  // Kept exactly as the feed wrote it; a malformed phrase disables its decision
  // (isWellFormedPhrase) rather than hiding the whole board.
  phrase: z.string(),
  recommended: z.boolean().default(false),
  why: optionalText(),
});

const decisionSchema = z.object({
  id: text(),
  title: text(),
  project: optionalText(),
  tag: optionalText(),
  context: optionalText(),
  options: z.array(optionSchema),
  risk: riskSchema,
  link: optionalText(),
  approvalId: optionalText(),
  createdAt: optionalText(),
  // TYP-1568 marks migrated legacy decisions that break the current rules.
  // Fail closed: anything but absent/false counts as needing repair.
  invalidLegacy: z.unknown().optional().transform((value) => value !== undefined && value !== null && value !== false),
  invalidReason: z.unknown().optional().transform((value) => (typeof value === "string" ? value : null)),
});

type ParsedDecision = z.infer<typeof decisionSchema>;

/**
 * Each decision parses on its own: one the panel cannot read becomes a
 * needs-repair card with no options instead of hiding the whole board.
 */
const decisionsSchema = z.array(z.unknown()).transform((items) =>
  items.map((item, index): ParsedDecision => {
    const parsed = decisionSchema.safeParse(item);
    if (parsed.success) return parsed.data;
    const raw = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const str = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value : null);
    return {
      id: str(raw.id) ?? `unreadable-${index}`,
      title: str(raw.title) ?? "Unreadable decision",
      project: str(raw.project),
      tag: null,
      context: null,
      options: [],
      risk: "unknown",
      link: null,
      approvalId: null,
      createdAt: null,
      invalidLegacy: true,
      invalidReason: "the panel could not read this decision",
    };
  }),
);

const comingUpSchema = z.object({
  title: text(),
  project: optionalText(),
  after: optionalText(),
  eta: optionalText(),
});

const inFlightItemSchema = z.object({
  text: text(),
  state: z.enum(["ok", "wait", "blocked"]).catch("ok").default("ok"),
  link: optionalText(),
});

const inFlightGroupSchema = z.object({
  project: text(),
  items: z.array(inFlightItemSchema).default([]),
});

const doneSchema = z.object({
  text: text(),
  at: optionalText(),
  link: optionalText(),
});

export const boardSchema = z.object({
  schema: z.literal(1),
  updatedAt: z.string(),
  updatedBy: optionalText(),
  decisions: decisionsSchema.default([]),
  comingUp: z.array(comingUpSchema).default([]),
  inFlight: z.array(inFlightGroupSchema).default([]),
  done: z.array(doneSchema).default([]),
});

export type Board = z.infer<typeof boardSchema>;
export type Decision = Board["decisions"][number];
export type DecisionOption = Decision["options"][number];
export type ComingUp = Board["comingUp"][number];
export type InFlightGroup = Board["inFlight"][number];
export type DoneItem = Board["done"][number];

export type ParseResult = { ok: true; board: Board } | { ok: false; error: string };

export function parseBoard(content: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { ok: false, error: "board.json is not valid JSON." };
  }
  if (typeof raw === "object" && raw !== null && "schema" in raw && raw.schema !== 1) {
    return {
      ok: false,
      error: `board.json uses schema ${String(raw.schema)}; this panel reads schema 1.`,
    };
  }
  const parsed = boardSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? issue.path.join(".") : "board";
    return { ok: false, error: `board.json is invalid at ${where}: ${issue?.message ?? "unknown"}.` };
  }
  return { ok: true, board: parsed.data };
}

/** The recommended option, or null when the lead marked none (schema allows exactly one). */
export function recommendedOption(decision: Decision): DecisionOption | null {
  return decision.options.find((option) => option.recommended) ?? null;
}

/**
 * A phrase is sent verbatim, so it must be non-empty, have no surrounding
 * whitespace and fit the feed's limit; it is never trimmed or clipped.
 */
export function isWellFormedPhrase(phrase: string): boolean {
  return phrase !== "" && phrase === phrase.trim() && phrase.length <= BOARD_LIMITS.option.phrase;
}

/**
 * A decision the feed contract would refuse gets no working buttons: a
 * malformed phrase, or more options than the feed allows (hiding the extras
 * could hide the recommended one).
 */
export function hasMalformedOption(decision: Decision): boolean {
  return (
    decision.options.length === 0 ||
    decision.options.length > BOARD_LIMITS.maxOptions ||
    decision.options.some((option) => !isWellFormedPhrase(option.phrase))
  );
}

/** A legacy decision TYP-1568 flagged (or one the panel could not read): never sendable. */
export function needsRepair(decision: Decision): boolean {
  return decision.invalidLegacy;
}

/** Whether any option of this decision may be sent at all. */
export function canSend(decision: Decision): boolean {
  return !needsRepair(decision) && !hasMalformedOption(decision);
}

export function needsConfirmation(decision: Decision): boolean {
  return CONFIRM_RISKS.has(decision.risk);
}

/**
 * Identifies a decision's content, so a "sent" card resets when the lead
 * changes or re-asks it, and stays sent while unrelated parts of the board move.
 */
export function decisionFingerprint(decision: Decision): string {
  return JSON.stringify([
    decision.id,
    decision.title,
    decision.context,
    decision.risk,
    decision.approvalId,
    decision.createdAt,
    decision.options.map((option) => [option.label, option.phrase, option.recommended]),
  ]);
}

/** Clock skew tolerated before a future updatedAt counts as invalid. */
const FUTURE_SKEW_MS = 2 * 60_000;

/** Age of the board, or null when updatedAt is unparseable or in the future. */
export function ageMs(updatedAt: string, now: number): number | null {
  const at = Date.parse(updatedAt);
  if (Number.isNaN(at) || at - now > FUTURE_SKEW_MS) return null;
  return Math.max(0, now - at);
}

export function isStale(updatedAt: string, now: number): boolean {
  const age = ageMs(updatedAt, now);
  return age === null || age > STALE_AFTER_MS;
}

export function formatAge(updatedAt: string, now: number): string {
  const age = ageMs(updatedAt, now);
  if (age === null) return "update time unknown";
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return "updated just now";
  if (minutes < 60) return `updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `updated ${hours} h ${minutes % 60} min ago`;
  return `updated ${Math.floor(hours / 24)} d ago`;
}

/** Words for speechSynthesis: each decision with its options and recommendation. */
export function readAloudScript(board: Board): string[] {
  if (board.decisions.length === 0) return ["Nothing needs you right now."];
  const count = board.decisions.length;
  const lines = [`${count} ${count === 1 ? "decision needs" : "decisions need"} you.`];
  for (const decision of board.decisions) {
    const rec = recommendedOption(decision);
    const parts = [decision.title + "."];
    if (decision.context) parts.push(decision.context);
    parts.push(`Options: ${decision.options.map((option) => option.label).join(", or ")}.`);
    if (rec) parts.push(`Recommended: ${rec.label}${rec.why ? `, because ${rec.why}` : "."}`);
    lines.push(parts.join(" "));
  }
  return lines;
}
