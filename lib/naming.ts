const SECTORS: Array<{ match: RegExp; roots: string[] }> = [
  { match: /(odzie|ubran|moda|ciuch|fashion|streetwear)/i, roots: ["moda", "wear", "look", "styl", "szafa", "splot", "urban", "fit"] },
  { match: /(trusk|strawber|owoc|fruit)/i, roots: ["berry", "trusk", "fresh", "owoc", "ruby", "sweet", "field", "garden"] },
  { match: /(telewiz|rtv|tv\b|elektron|audio|video)/i, roots: ["vision", "pixel", "screen", "rtv", "media", "view", "volt", "signal"] },
  { match: /(podró|travel|wakac|hotel|loty|wyciecz)/i, roots: ["trip", "route", "go", "voy", "travel", "fly", "stay", "roam"] },
  { match: /(grow|ogród|ogrod|roślin|roslin|indoor|garden)/i, roots: ["grow", "leaf", "root", "flora", "plant", "green", "bloom", "soil"] },
];

const PREFIXES = ["neo", "nova", "pro", "max", "prime", "smart", "true", "my", "go", "evo", "vi", "ve", "vo", "za", "zo", "na", "no", "re", "be", "bi", "mi", "mo", "la", "lo", "lu", "x", "v", "e"];
const SUFFIXES = ["io", "ia", "eo", "ly", "go", "hub", "lab", "zone", "box", "up", "ix", "ex", "on", "or", "ar", "is", "os", "um", "sy", "fy", "za", "zo", "va", "vo", "ra", "ro", "na", "no", "li", "lo", "mi", "mo", "iq", "iqo", "nest", "base"];

const TLD_PROFILES: Record<string, { prefixes: string[]; suffixes: string[]; offset: number }> = {
  pl: { prefixes: ["dob", "pol", "nas", "neo", "pro"], suffixes: ["owo", "nia", "pol", "dom", "ka"], offset: 0 },
  eu: { prefixes: ["euro", "uni", "via", "nova", "neo"], suffixes: ["eu", "via", "one", "ia", "io"], offset: 173 },
  com: { prefixes: ["go", "my", "neo", "nova", "prime"], suffixes: ["io", "ly", "labs", "hub", "go"], offset: 347 },
  shop: { prefixes: ["buy", "get", "my", "go", "neo"], suffixes: ["shop", "cart", "mart", "box", "go"], offset: 521 },
  store: { prefixes: ["get", "my", "go", "prime", "true"], suffixes: ["store", "mart", "hub", "box", "base"], offset: 695 },
  online: { prefixes: ["e", "go", "my", "web", "neo"], suffixes: ["online", "web", "net", "io", "hub"], offset: 869 },
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18);
}

function phoneticVariants(root: string) {
  const variants = new Set<string>([root]);
  const replacements: Array<[RegExp, string]> = [
    [/c/g, "k"], [/k/g, "c"], [/v/g, "w"], [/w/g, "v"], [/f/g, "ph"], [/ph/g, "f"],
    [/y/g, "i"], [/i/g, "y"], [/x/g, "ks"], [/ks/g, "x"], [/q/g, "k"], [/oo/g, "u"],
  ];
  for (const [pattern, replacement] of replacements) {
    const changed = root.replace(pattern, replacement);
    if (changed !== root) variants.add(changed);
  }
  if (root.length >= 5) {
    variants.add(root.slice(0, -1));
    variants.add(`${root.slice(0, -1)}a`);
    variants.add(`${root.slice(0, -1)}o`);
    variants.add(`${root.slice(0, -1)}i`);
  }
  return Array.from(variants);
}

export function generateNames(
  prompt: string,
  limit = 100,
  options: { exclude?: string[]; tld?: string } = {},
): string[] {
  const normalized = normalize(prompt);
  const promptWords = normalized.split(" ").filter((word) => word.length >= 2 && word.length <= 16);
  const sectorRoots = SECTORS.find((sector) => sector.match.test(prompt))?.roots ?? [];
  const roots = Array.from(new Set([...promptWords.slice(0, 6), ...sectorRoots])).slice(0, 12);
  if (roots.length === 0) roots.push("nova", "brand", "market");

  const profile = TLD_PROFILES[options.tld ?? ""] ?? { prefixes: [], suffixes: [], offset: 0 };
  const prefixes = Array.from(new Set([...profile.prefixes, ...PREFIXES]));
  const suffixes = Array.from(new Set([...profile.suffixes, ...SUFFIXES]));
  const pool: string[] = [];
  const seen = new Set<string>();

  const add = (value: string) => {
    const label = cleanLabel(value);
    if (label.length < 4 || label.length > 18 || seen.has(label)) return;
    seen.add(label);
    pool.push(label);
  };

  for (const rootRaw of roots) {
    const root = cleanLabel(rootRaw).slice(0, 14);
    if (!root) continue;
    const variants = phoneticVariants(root);
    for (const variant of variants) add(variant);

    for (const suffix of suffixes) add(`${root}${suffix}`);
    for (const prefix of prefixes) add(`${prefix}${root}`);

    for (const prefix of prefixes) {
      for (const suffix of suffixes) add(`${prefix}${root}${suffix}`);
    }

    const stem = root.length > 9 ? root.slice(0, 9) : root;
    for (const variant of variants) {
      for (const ending of ["a", "o", "i", "y", "e", "ia", "io", "eo", "ix", "on", "or", "um"]) add(`${variant}${ending}`);
    }
    for (const prefix of ["n", "v", "x", "z", "m", "l", "r", "b", "k"]) {
      for (const ending of ["a", "o", "i", "y", "io", "ia", "ix", "on"]) add(`${prefix}${stem}${ending}`);
    }
  }

  for (let i = 0; i < roots.length; i++) {
    for (let j = 0; j < roots.length; j++) {
      if (i === j) continue;
      const left = cleanLabel(roots[i]).slice(0, 8);
      const right = cleanLabel(roots[j]).slice(0, 8);
      add(`${left}${right}`);
      add(`${left.slice(0, Math.max(2, Math.ceil(left.length / 2)))}${right}`);
    }
  }

  const ordered = pool.sort((a, b) => baseBrandScore(b, sectorRoots) - baseBrandScore(a, sectorRoots) || a.length - b.length || a.localeCompare(b));
  const offset = ordered.length ? profile.offset % ordered.length : 0;
  const rotated = [...ordered.slice(offset), ...ordered.slice(0, offset)];
  const excluded = new Set((options.exclude ?? []).map(cleanLabel));

  return rotated.filter((name) => !excluded.has(name)).slice(0, Math.max(1, Math.min(limit, 100)));
}

export function baseBrandScore(label: string, sectorRoots: string[] = []): number {
  let score = 70;
  if (label.length <= 8) score += 14;
  else if (label.length <= 11) score += 8;
  else if (label.length <= 14) score += 2;
  else score -= 5;
  if (/\d/.test(label)) score -= 8;
  if (sectorRoots.some((root) => label.includes(root))) score += 8;
  if (/[aeiouy]$/.test(label)) score += 3;
  return Math.max(0, Math.min(100, score));
}

export function scoreDomain(label: string, tld: string, state: "available" | "registered" | "unknown") {
  let score = baseBrandScore(label);
  if (tld === "com") score += 6;
  if (tld === "pl") score += 5;
  if (tld === "eu") score += 4;
  if (state === "available") score += 12;
  if (state === "registered") score -= 30;
  if (state === "unknown") score -= 12;
  return Math.max(0, Math.min(100, score));
}
