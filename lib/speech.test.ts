import { describe, expect, it } from "vitest";
import v2 from "../fixtures/board-v2.json";
import { parseBoard, type Board } from "./board";
import { decisionScript, rankVoices, speechKey, type VoiceLike } from "./speech";

function parse(value: unknown): Board {
  const parsed = parseBoard(JSON.stringify(value));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.board;
}

const board = parse(v2);
const decision = (id: string) => board.decisions.find((item) => item.id === id)!;

describe("decisionScript", () => {
  it("reads the title, the context, then the options with the recommended one named", () => {
    expect(decisionScript(decision("demo-release"))).toBe(
      "Release Demo 1.2 to production. Staging accepted. The lead reads the release back before it runs. " +
        "Options: Hold, or Release. Recommended: Release, because staging acceptance is green.",
    );
  });

  it("reads a hygiene card's summary line instead of its inventory", () => {
    const script = decisionScript(decision("machine-hygiene-cloudroom2"));
    expect(script).toContain("cloudroom2: 6 unused images, 705 MB.");
    expect(script).not.toContain("sha256");
  });

  it("does not repeat a leading because", () => {
    const tokens = decision("demo-tokens");
    expect(decisionScript({ ...tokens, options: tokens.options.map((o) => ({ ...o, why: o.why ? `because ${o.why}` : null })) })).toContain(
      "Recommended: Start now, because it is the biggest fix",
    );
  });
});

describe("speechKey", () => {
  it("changes when the card's words change, so a cached clip is never stale", () => {
    expect(speechKey("demo-release", "a")).toBe(speechKey("demo-release", "a"));
    expect(speechKey("demo-release", "a")).not.toBe(speechKey("demo-release", "b"));
    expect(speechKey("demo-release", "a")).toMatch(/^demo-release:[0-9a-z]+$/);
  });
});

describe("rankVoices", () => {
  const voice = (name: string, lang: string, localService = true): VoiceLike => ({ name, lang, localService, voiceURI: name });

  it("prefers premium, enhanced, natural and neural voices in the user's language", () => {
    const voices = [
      voice("Fred", "en-US"),
      voice("Thomas", "fr-FR"),
      voice("Ava (Premium)", "en-US"),
      voice("Samantha (Enhanced)", "en-US"),
      voice("Microsoft Aria Online (Natural) - English (United States)", "en-US", false),
      voice("Daniel", "en-GB"),
    ];
    expect(rankVoices(voices, "en-US").map((v) => v.name)).toEqual([
      "Ava (Premium)",
      "Samantha (Enhanced)",
      "Microsoft Aria Online (Natural) - English (United States)",
      "Fred",
      "Daniel",
    ]);
  });

  it("falls back to the same base language when no exact match exists", () => {
    expect(rankVoices([voice("Daniel", "en-GB"), voice("Anna", "de-DE")], "en-US").map((v) => v.name)).toEqual(["Daniel"]);
  });

  it("returns nothing when no voice speaks the language", () => {
    expect(rankVoices([voice("Anna", "de-DE")], "en-US")).toEqual([]);
  });
});
