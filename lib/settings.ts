export type ModelChoice =
  | "auto"
  | "gpt-5.4"
  | "gpt-5.5"
  | "gpt-5.6-luna"
  | "gpt-5.6-terra"
  | "gpt-5.6-sol";

export type SearchMode = "all" | "ultra-short" | "close" | "brandable" | "semantic" | "creative";
export type SearchLanguage = "pl" | "en" | "international" | "all";

export type RadarSettings = {
  model: ModelChoice;
  minLength: number;
  maxLength: number;
  mode: SearchMode;
  language: SearchLanguage;
  onlyAvailable: boolean;
  noDigits: boolean;
  noHyphens: boolean;
  expected: string[];
};

export const DEFAULT_RADAR_SETTINGS: RadarSettings = {
  model: "auto",
  minLength: 1,
  maxLength: 10,
  mode: "all",
  language: "all",
  onlyAvailable: false,
  noDigits: true,
  noHyphens: true,
  expected: [],
};

export function clampSettings(input: Partial<RadarSettings> | undefined): RadarSettings {
  const raw = input ?? {};
  const allowedModels: ModelChoice[] = ["auto", "gpt-5.4", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"];
  const allowedModes: SearchMode[] = ["all", "ultra-short", "close", "brandable", "semantic", "creative"];
  const allowedLanguages: SearchLanguage[] = ["pl", "en", "international", "all"];
  const minLength = Math.max(1, Math.min(Number(raw.minLength) || DEFAULT_RADAR_SETTINGS.minLength, 18));
  const maxLength = Math.max(minLength, Math.min(Number(raw.maxLength) || DEFAULT_RADAR_SETTINGS.maxLength, 24));
  return {
    model: allowedModels.includes(raw.model as ModelChoice) ? (raw.model as ModelChoice) : DEFAULT_RADAR_SETTINGS.model,
    minLength,
    maxLength,
    mode: allowedModes.includes(raw.mode as SearchMode) ? (raw.mode as SearchMode) : DEFAULT_RADAR_SETTINGS.mode,
    language: allowedLanguages.includes(raw.language as SearchLanguage) ? (raw.language as SearchLanguage) : DEFAULT_RADAR_SETTINGS.language,
    onlyAvailable: Boolean(raw.onlyAvailable),
    noDigits: raw.noDigits !== false,
    noHyphens: raw.noHyphens !== false,
    expected: Array.from(new Set((raw.expected ?? []).map((value) => String(value).trim()).filter(Boolean))).slice(0, 30),
  };
}

export function resolveModel(choice: ModelChoice, batch: number): Exclude<ModelChoice, "auto"> {
  if (choice !== "auto") return choice;
  if (batch >= 5) return "gpt-5.6-sol";
  if (batch >= 4) return "gpt-5.6-terra";
  return "gpt-5.6-luna";
}
