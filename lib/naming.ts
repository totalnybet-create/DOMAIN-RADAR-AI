const SECTORS: Array<{ match: RegExp; roots: string[] }> = [
  { match: /(odzie|ubran|moda|ciuch|fashion|streetwear)/i, roots: ["moda", "wear", "look", "styl", "szafa", "splot", "urban", "fit"] },
  { match: /(trusk|strawber|owoc|fruit)/i, roots: ["berry", "trusk", "fresh", "owoc", "ruby", "sweet", "field", "garden"] },
  { match: /(telewiz|rtv|tv\b|elektron|audio|video)/i, roots: ["vision", "pixel", "screen", "rtv", "media", "view", "volt", "signal"] },
  { match: /(podró|travel|wakac|hotel|loty|wyciecz)/i, roots: ["trip", "route", "go", "voy", "travel", "fly", "stay", "roam"] },
  { match: /(grow|ogród|ogrod|roślin|roslin|indoor|garden)/i, roots: ["grow", "leaf", "root", "flora", "plant", "green", "bloom", "soil"] },
];

const PREFIXES = ["neo", "nova", "pro", "max", "prime", "smart", "true", "my", "go", "evo"];
const SUFFIXES = ["io", "ly", "go", "hub", "lab", "zone", "box", "ly", "up", "eo"];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function generateNames(prompt: string, limit = 12): string[] {
  const normalized = normalize(prompt);
  const promptWords = normalized.split(" ").filter((w) => w.length >= 4 && w.length <= 11);
  const sectorRoots = SECTORS.find((sector) => sector.match.test(prompt))?.roots ?? [];
  const roots = Array.from(new Set([...sectorRoots, ...promptWords.slice(0, 5), "brand", "market"]));
  const names = new Set<string>();

  for (const root of roots) {
    names.add(root);
    for (const suffix of SUFFIXES) names.add(`${root}${suffix}`);
    for (const prefix of PREFIXES) names.add(`${prefix}${root}`);
  }

  for (let i = 0; i < roots.length; i++) {
    for (let j = i + 1; j < roots.length; j++) {
      names.add(`${roots[i]}${roots[j]}`);
      names.add(`${roots[j]}${roots[i]}`);
    }
  }

  return Array.from(names)
    .map((name) => name.replace(/[^a-z0-9]/g, ""))
    .filter((name) => name.length >= 4 && name.length <= 14)
    .sort((a, b) => baseBrandScore(b, sectorRoots) - baseBrandScore(a, sectorRoots) || a.length - b.length)
    .slice(0, Math.max(1, Math.min(limit, 30)));
}

export function baseBrandScore(label: string, sectorRoots: string[] = []): number {
  let score = 70;
  if (label.length <= 8) score += 14;
  else if (label.length <= 11) score += 8;
  else score -= 4;
  if (/\d/.test(label)) score -= 8;
  if (sectorRoots.some((root) => label.includes(root))) score += 8;
  if (/[aeiouy]$/.test(label)) score += 3;
  return Math.max(0, Math.min(100, score));
}

export function scoreDomain(label: string, tld: string, state: "available" | "registered" | "unknown") {
  let score = baseBrandScore(label);
  if (tld === "com") score += 6;
  if (tld === "pl") score += 5;
  if (state === "available") score += 12;
  if (state === "registered") score -= 30;
  if (state === "unknown") score -= 12;
  return Math.max(0, Math.min(100, score));
}
