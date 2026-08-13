import type { RadarSettings } from "./settings";
import { normalizeLabel, scoreCandidate } from "./scoring";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const VOWELS = "aeiouy";
const CONSONANTS = "bcdfghjklmnpqrstvwxyz";

const SECTORS: Array<{ match: RegExp; roots: string[] }> = [
  { match: /(odzie|ubran|moda|ciuch|fashion|streetwear)/i, roots: ["moda", "wear", "look", "styl", "urban", "fit"] },
  { match: /(trusk|strawber|owoc|fruit)/i, roots: ["berry", "fresh", "ruby", "sweet", "fruit"] },
  { match: /(telewiz|rtv|tv\b|elektron|audio|video)/i, roots: ["vision", "pixel", "screen", "media", "view", "volt"] },
  { match: /(podró|travel|wakac|hotel|loty|wyciecz)/i, roots: ["trip", "route", "voy", "travel", "fly", "stay"] },
  { match: /(grow|ogród|ogrod|roślin|roslin|indoor|garden)/i, roots: ["grow", "leaf", "root", "flora", "plant", "bloom"] },
];

const SHORT_PARTS = ["ai", "go", "up", "on", "one", "x", "ex", "io", "it", "me", "my", "app", "lab", "pro", "web", "now", "hq"];
const BRAND_ENDINGS = ["a", "o", "i", "u", "y", "io", "ia", "eo", "ix", "ex", "on", "or", "ar", "is", "os", "um", "va", "vo", "ra", "ro", "na", "no", "li", "lo", "mi", "mo"];
const KEYBOARD: Record<string, string> = {
  q: "wa", w: "qesa", e: "wrsd", r: "etfd", t: "rygf", y: "tugh", u: "yihj", i: "uojk", o: "ipkl", p: "ol",
  a: "qwsz", s: "awedxz", d: "serfcx", f: "drtgvc", g: "ftyhbv", h: "gyujnb", j: "huikmn", k: "jiolm", l: "kop",
  z: "asx", x: "zsdc", c: "xdfv", v: "cfgb", b: "vghn", n: "bhjm", m: "njk",
};

export type Candidate = { label: string; sources: string[] };

type GenerateOptions = {
  exclude?: string[];
  batch?: number;
  settings: RadarSettings;
};

function clean(value: string) {
  return normalizeLabel(value).slice(0, 24);
}

function addCandidate(map: Map<string, Set<string>>, value: string, source: string, settings: RadarSettings) {
  const label = clean(value);
  if (!label) return;
  if (label.length < settings.minLength || label.length > settings.maxLength) return;
  if (settings.noDigits && /\d/.test(label)) return;
  const sources = map.get(label) ?? new Set<string>();
  sources.add(source);
  map.set(label, sources);
}

function addEditDistance(map: Map<string, Set<string>>, root: string, settings: RadarSettings) {
  addCandidate(map, root, "exact", settings);
  for (let i = 0; i < root.length; i++) {
    addCandidate(map, root.slice(0, i) + root.slice(i + 1), "delete-1", settings);
    if (i < root.length - 1) addCandidate(map, root.slice(0, i) + root[i + 1] + root[i] + root.slice(i + 2), "transpose", settings);
    for (const ch of VOWELS) if (root[i] !== ch) addCandidate(map, root.slice(0, i) + ch + root.slice(i + 1), "vowel-swap", settings);
    const neighbors = KEYBOARD[root[i]] ?? "";
    for (const ch of neighbors) addCandidate(map, root.slice(0, i) + ch + root.slice(i + 1), "keyboard", settings);
  }
  for (let i = 0; i <= root.length; i++) {
    for (const ch of ALPHABET) addCandidate(map, root.slice(0, i) + ch + root.slice(i), "insert-1", settings);
  }
}

function addShortSpace(map: Map<string, Set<string>>, root: string, settings: RadarSettings) {
  if (root.length > 3) return;
  for (const a of ALPHABET) {
    addCandidate(map, `${root}${a}`, "short-space", settings);
    addCandidate(map, `${a}${root}`, "short-space", settings);
    for (const b of ALPHABET) {
      addCandidate(map, `${root}${a}${b}`, "short-space", settings);
      addCandidate(map, `${a}${root}${b}`, "short-space", settings);
      if (root.length === 1) addCandidate(map, `${a}${b}${root}`, "short-space", settings);
    }
  }
}

function addPhonetic(map: Map<string, Set<string>>, root: string, settings: RadarSettings) {
  const replacements: Array<[RegExp, string]> = [
    [/c/g, "k"], [/k/g, "c"], [/v/g, "w"], [/w/g, "v"], [/f/g, "ph"], [/ph/g, "f"], [/y/g, "i"], [/i/g, "y"],
    [/x/g, "ks"], [/ks/g, "x"], [/q/g, "k"], [/oo/g, "u"], [/u/g, "oo"], [/z/g, "s"], [/s/g, "z"],
  ];
  for (const [pattern, replacement] of replacements) {
    const changed = root.replace(pattern, replacement);
    if (changed !== root) addCandidate(map, changed, "phonetic", settings);
  }
  const stem = root.length > 1 ? root.slice(0, -1) : root;
  for (const ending of BRAND_ENDINGS) addCandidate(map, stem + ending, "phonetic-ending", settings);
}

function addShortening(map: Map<string, Set<string>>, root: string, settings: RadarSettings) {
  if (root.length <= 2) return;
  for (let i = 1; i < root.length; i++) {
    addCandidate(map, root.slice(0, i) + root.slice(i + 1), "shorten", settings);
  }
  addCandidate(map, root.replace(/[aeiouy]/g, ""), "vowelless", settings);
  for (let length = Math.max(1, settings.minLength); length < root.length; length++) {
    addCandidate(map, root.slice(0, length), "prefix-short", settings);
    addCandidate(map, root.slice(-length), "suffix-short", settings);
  }
}

function addBrandable(map: Map<string, Set<string>>, root: string, settings: RadarSettings, intensity: number) {
  for (const part of SHORT_PARTS) {
    addCandidate(map, `${root}${part}`, "root-combine", settings);
    addCandidate(map, `${part}${root}`, "root-combine", settings);
  }
  for (const ending of BRAND_ENDINGS) addCandidate(map, `${root}${ending}`, "brand-ending", settings);
  if (intensity >= 3) {
    const stem = root.slice(0, Math.max(1, Math.ceil(root.length / 2)));
    for (const c of CONSONANTS) for (const v of VOWELS) addCandidate(map, `${stem}${c}${v}`, "cvc-brandable", settings);
  }
  if (intensity >= 4) {
    for (const c1 of CONSONANTS.slice(0, 14)) {
      for (const v1 of VOWELS) {
        for (const c2 of CONSONANTS.slice(0, 14)) addCandidate(map, `${c1}${v1}${c2}${root.slice(0, 2)}`, "creative-pattern", settings);
      }
    }
  }
}

function addSemantic(map: Map<string, Set<string>>, prompt: string, settings: RadarSettings) {
  const roots = SECTORS.find((sector) => sector.match.test(prompt))?.roots ?? [];
  for (const root of roots) {
    addCandidate(map, root, "semantic", settings);
    for (const ending of BRAND_ENDINGS.slice(0, 10)) addCandidate(map, `${root}${ending}`, "semantic", settings);
  }
}

function expectedBoost(label: string, expected: string[]) {
  if (!expected.length) return 0;
  return Math.max(...expected.map((item) => scoreCandidate(item, label).similarity), 0) * 0.18;
}

export function generateCandidates(prompt: string, limit = 100, options: GenerateOptions): Candidate[] {
  const query = clean(prompt);
  const batch = Math.max(1, Math.min(options.batch ?? 1, 5));
  const settings = options.settings;
  const excluded = new Set((options.exclude ?? []).map(clean));
  const map = new Map<string, Set<string>>();

  const promptWords = prompt
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const roots = Array.from(new Set([query, ...promptWords.map(clean)])).filter(Boolean).slice(0, 8);

  for (const root of roots) {
    addEditDistance(map, root, settings);
    addShortSpace(map, root, settings);
    addShortening(map, root, settings);
    if (batch >= 2 || settings.mode === "all" || settings.mode === "close") addPhonetic(map, root, settings);
    if (batch >= 3 || ["all", "brandable", "creative"].includes(settings.mode)) addBrandable(map, root, settings, batch);
  }
  if (batch >= 3 || ["all", "semantic"].includes(settings.mode)) addSemantic(map, prompt, settings);

  for (const expected of settings.expected) {
    const root = clean(expected);
    if (!root) continue;
    addCandidate(map, root, "expected", settings);
    addPhonetic(map, root, settings);
    addBrandable(map, root, settings, Math.max(2, batch));
  }

  const candidates = Array.from(map.entries())
    .filter(([label]) => !excluded.has(label))
    .map(([label, sources]) => ({ label, sources: Array.from(sources) }));

  candidates.sort((a, b) => {
    const sa = scoreCandidate(query, a.label);
    const sb = scoreCandidate(query, b.label);
    const ea = expectedBoost(a.label, settings.expected);
    const eb = expectedBoost(b.label, settings.expected);
    const batchDistancePenaltyA = Math.max(0, batch - 1) * Math.max(0, sa.similarity - 70) * 0.03;
    const batchDistancePenaltyB = Math.max(0, batch - 1) * Math.max(0, sb.similarity - 70) * 0.03;
    const totalA = sa.score + ea - batchDistancePenaltyA;
    const totalB = sb.score + eb - batchDistancePenaltyB;
    return totalB - totalA || a.label.length - b.label.length || b.sources.length - a.sources.length || a.label.localeCompare(b.label);
  });

  return candidates.slice(0, Math.max(1, Math.min(limit, 100)));
}

export function generateNames(prompt: string, limit = 100, options: GenerateOptions): string[] {
  return generateCandidates(prompt, limit, options).map((candidate) => candidate.label);
}
