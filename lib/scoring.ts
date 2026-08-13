function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return prev[b.length];
}

function jaro(a: string, b: string) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = Array(a.length).fill(false);
  const bMatch = Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - range);
    const end = Math.min(i + range + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  const aa = a.split("").filter((_, i) => aMatch[i]);
  const bb = b.split("").filter((_, i) => bMatch[i]);
  let transpositions = 0;
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) transpositions++;
  return (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinkler(a: string, b: string) {
  const base = jaro(a, b);
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return base + prefix * 0.1 * (1 - base);
}

function ngrams(value: string, n: number) {
  const result = new Set<string>();
  if (value.length < n) {
    if (value) result.add(value);
    return result;
  }
  for (let i = 0; i <= value.length - n; i++) result.add(value.slice(i, i + n));
  return result;
}

function dice(a: Set<string>, b: Set<string>) {
  if (!a.size && !b.size) return 1;
  let common = 0;
  for (const item of a) if (b.has(item)) common++;
  return (2 * common) / Math.max(1, a.size + b.size);
}

function prefixSuffixScore(a: string, b: string) {
  const max = Math.max(1, Math.min(a.length, b.length));
  let prefix = 0;
  let suffix = 0;
  while (prefix < max && a[prefix] === b[prefix]) prefix++;
  while (suffix < max && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  return Math.min(1, (prefix + suffix) / Math.max(1, max));
}

function phoneticKey(value: string) {
  return value
    .replace(/ph/g, "f")
    .replace(/ks/g, "x")
    .replace(/[cq]/g, "k")
    .replace(/w/g, "v")
    .replace(/y/g, "i")
    .replace(/oo/g, "u")
    .replace(/(.)\1+/g, "$1");
}

export function similarityScore(queryRaw: string, candidateRaw: string) {
  const query = normalizeLabel(queryRaw);
  const candidate = normalizeLabel(candidateRaw);
  if (!query || !candidate) return 0;
  const lev = 1 - levenshtein(query, candidate) / Math.max(query.length, candidate.length, 1);
  const jw = jaroWinkler(query, candidate);
  const bigram = dice(ngrams(query, 2), ngrams(candidate, 2));
  const trigram = dice(ngrams(query, 3), ngrams(candidate, 3));
  const edge = prefixSuffixScore(query, candidate);
  const phon = jaroWinkler(phoneticKey(query), phoneticKey(candidate));
  const short = query.length <= 3;
  const value = short
    ? lev * 0.35 + jw * 0.25 + edge * 0.2 + phon * 0.15 + bigram * 0.05
    : lev * 0.24 + jw * 0.24 + edge * 0.12 + phon * 0.16 + bigram * 0.12 + trigram * 0.12;
  return clamp(value * 100);
}

export function lengthScore(label: string) {
  const length = normalizeLabel(label).length;
  if (length <= 3) return 100;
  if (length === 4) return 96;
  if (length === 5) return 90;
  if (length === 6) return 84;
  if (length === 7) return 76;
  if (length === 8) return 68;
  if (length === 9) return 58;
  if (length === 10) return 50;
  return clamp(50 - (length - 10) * 5);
}

export function pronunciationScore(labelRaw: string) {
  const label = normalizeLabel(labelRaw);
  const vowels = /[aeiouy]/;
  let badRuns = 0;
  let consonants = 0;
  let vowelCount = 0;
  for (const char of label) {
    if (vowels.test(char)) {
      vowelCount++;
      consonants = 0;
    } else {
      consonants++;
      if (consonants >= 4) badRuns++;
    }
  }
  const vowelRatio = vowelCount / Math.max(1, label.length);
  let score = 92 - badRuns * 18;
  if (vowelRatio < 0.2 || vowelRatio > 0.75) score -= 15;
  if (/q[^u]|[jx]{2}|[^aeiouy]{5}/.test(label)) score -= 12;
  return clamp(score);
}

export function typingScore(labelRaw: string) {
  const label = normalizeLabel(labelRaw);
  let score = 100;
  if (/\d/.test(label)) score -= 18;
  if (/[qzx]{2,}/.test(label)) score -= 12;
  if (/(.)\1\1/.test(label)) score -= 10;
  if (label.length > 10) score -= (label.length - 10) * 3;
  return clamp(score);
}

export function memorabilityScore(labelRaw: string, similarity: number) {
  const label = normalizeLabel(labelRaw);
  let score = 45 + lengthScore(label) * 0.35 + pronunciationScore(label) * 0.2 + similarity * 0.12;
  if (/^(.)\1+$/.test(label)) score -= 20;
  return clamp(score);
}

export function brandScore(labelRaw: string, similarity: number) {
  const label = normalizeLabel(labelRaw);
  let score = pronunciationScore(label) * 0.34 + memorabilityScore(label, similarity) * 0.33 + typingScore(label) * 0.18 + lengthScore(label) * 0.15;
  if (label.length >= 4 && label.length <= 8) score += 6;
  return clamp(score);
}

export function scoreCandidate(query: string, label: string) {
  const similarity = similarityScore(query, label);
  const length = lengthScore(label);
  const pronunciation = pronunciationScore(label);
  const memorability = memorabilityScore(label, similarity);
  const typing = typingScore(label);
  const brand = brandScore(label, similarity);
  const shortQuery = normalizeLabel(query).length <= 2;
  const score = shortQuery
    ? similarity * 0.38 + length * 0.32 + brand * 0.12 + pronunciation * 0.08 + memorability * 0.06 + typing * 0.04
    : similarity * 0.30 + length * 0.25 + brand * 0.20 + pronunciation * 0.10 + memorability * 0.10 + typing * 0.05;
  return {
    score: clamp(score),
    similarity,
    lengthScore: length,
    brandScore: brand,
    pronunciationScore: pronunciation,
    memorabilityScore: memorability,
    typingScore: typing,
  };
}

export function reasonForCandidate(query: string, label: string) {
  const scores = scoreCandidate(query, label);
  const reasons: string[] = [];
  if (label.length <= 4) reasons.push("bardzo krótka");
  else if (label.length <= 6) reasons.push("krótka");
  if (scores.similarity >= 85) reasons.push(`bardzo blisko ${normalizeLabel(query).toUpperCase()}`);
  else if (scores.similarity >= 70) reasons.push("wysokie podobieństwo");
  if (scores.pronunciationScore >= 85) reasons.push("łatwa wymowa");
  if (scores.brandScore >= 85) reasons.push("mocna marka");
  return reasons.slice(0, 3).join(" · ") || "dobry balans nazwy";
}
