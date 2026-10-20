// What a card sounds like read aloud, and which browser voice reads it when
// bb-voice's Cartesia voice is not available.
import { recommendedOption, type Decision } from "./board";
import { shortHash } from "./hash";
import { hygieneSummary } from "./hygiene";

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Title, context (a hygiene card's summary line), then the options with the recommended one named. */
export function decisionScript(decision: Decision): string {
  const parts = [sentence(decision.title)];
  const hygiene = hygieneSummary(decision);
  if (hygiene) parts.push(sentence(hygiene.summary));
  else if (decision.context?.trim()) parts.push(sentence(decision.context));
  if (decision.options.length > 0) {
    parts.push(`Options: ${decision.options.map((option) => option.label).join(", or ")}.`);
  }
  const rec = recommendedOption(decision);
  if (rec) {
    const why = rec.why?.trim().replace(/^because\s+/i, "").replace(/[.!?]+$/, "");
    parts.push(`Recommended: ${rec.label}${why ? `, because ${why}` : ""}.`);
  }
  return parts.join(" ");
}

/** Cache key for a card's clip: the card id plus a hash of its words, so a changed card is spoken afresh. */
export function speechKey(id: string, script: string): string {
  return `${id}:${shortHash(script)}`;
}

/** The parts of SpeechSynthesisVoice the ranking reads. */
export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  voiceURI: string;
}

const QUALITY: [RegExp, number][] = [
  [/premium/i, 4],
  [/enhanced/i, 3],
  [/natural/i, 3],
  [/neural/i, 3],
];

function normalize(lang: string): string {
  return lang.replace(/_/g, "-").toLowerCase();
}

/**
 * Voices that speak the user's language, best first: the exact locale before
 * other regions, and Premium, Enhanced, Natural or neural voices before the rest.
 */
export function rankVoices<V extends VoiceLike>(voices: readonly V[], lang: string): V[] {
  const want = normalize(lang);
  const base = want.split("-")[0];
  const score = (voice: V) => {
    const have = normalize(voice.lang);
    const quality = QUALITY.find(([pattern]) => pattern.test(voice.name))?.[1] ?? 0;
    return (have === want ? 10 : 0) + quality;
  };
  return voices
    .filter((voice) => normalize(voice.lang).split("-")[0] === base)
    .map((voice, index) => ({ voice, index, score: score(voice) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.voice);
}
