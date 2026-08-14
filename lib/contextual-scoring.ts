import { isBusinessBrief } from "./conversational-naming";
import { reasonForCandidate, scoreCandidate } from "./scoring";

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreContextualCandidate(query: string, label: string) {
  const base = scoreCandidate(query, label);
  if (!isBusinessBrief(query)) return base;

  const score = clamp(
    base.lengthScore * 0.28 +
    base.brandScore * 0.30 +
    base.pronunciationScore * 0.16 +
    base.memorabilityScore * 0.16 +
    base.typingScore * 0.10,
  );

  return { ...base, score };
}

export function reasonForContextualCandidate(query: string, label: string) {
  if (!isBusinessBrief(query)) return reasonForCandidate(query, label);
  const scores = scoreContextualCandidate(query, label);
  const reasons: string[] = [];
  if (label.length <= 5) reasons.push("krótka nazwa");
  if (scores.brandScore >= 82) reasons.push("mocny potencjał marki");
  if (scores.pronunciationScore >= 84) reasons.push("łatwa wymowa");
  if (scores.memorabilityScore >= 80) reasons.push("łatwa do zapamiętania");
  return reasons.slice(0, 3).join(" · ") || "semantycznie wygenerowana dla opisu biznesu";
}
