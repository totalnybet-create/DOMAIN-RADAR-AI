import { generateSmartNames } from "./ai-naming";
import type { RadarSettings } from "./settings";
import { resolveModel } from "./settings";
import { normalizeLabel } from "./scoring";

type OpenAIResponse = {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
};

function outputText(response: OpenAIResponse) {
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

export function isBusinessBrief(prompt: string) {
  const text = prompt.trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 5) return true;
  return /(firma|firmy|branż|biznes|sklep|portal|serwis|aplikac|gastronom|motoryzac|nieruchomo|turyst|finans|urod|fitness|budow|transport|logist|hotel|restaur|kawiarn|fryzjer|mechanik|warsztat|chciałbym|szukam|potrzebuję|potrzebuje)/i.test(text);
}

function clean(value: string, maxLength: number) {
  return normalizeLabel(value.split(".")[0]).slice(0, maxLength);
}

export async function generateContextAwareNames(
  prompt: string,
  limit: number,
  options: { exclude?: string[]; tld?: string; batch?: number; settings: RadarSettings },
): Promise<{ names: string[]; provider: "openai" | "fallback"; model: string; mode?: "seed" | "business-brief" }> {
  if (!isBusinessBrief(prompt)) {
    const result = await generateSmartNames(prompt, limit, options);
    return { ...result, mode: "seed" };
  }

  const batch = Math.max(1, Math.min(options.batch ?? 1, 5));
  const settings = options.settings;
  const model = resolveModel(settings.model, batch);
  const apiKey = process.env.OPENAI_API_KEY;
  const exclude = Array.from(new Set((options.exclude ?? []).map((x) => clean(x, settings.maxLength)).filter(Boolean))).slice(0, 500);

  if (!apiKey) {
    const result = await generateSmartNames(prompt, limit, options);
    return { ...result, mode: "business-brief" };
  }

  const exploration = [
    "Start from obvious, short category words and the strongest everyday associations.",
    "Expand into objects, tools, slang, verbs, benefits and customer language strongly associated with the industry.",
    "Blend category roots into short brandable names and useful abbreviations.",
    "Explore premium, playful and modern brand territories while staying semantically connected to the business.",
    "Search less obvious but commercially strong semantic territory. Avoid anything already seen.",
  ][batch - 1];

  const exclusions = exclude.length ? `\nNEVER REPEAT THESE LABELS:\n${exclude.join(", ")}` : "";
  const expected = settings.expected.length
    ? `\nPOSITIVE STYLE EXAMPLES: ${settings.expected.join(", ")}. Learn their style, do not merely mutate them.`
    : "";

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model,
        reasoning: { effort: "medium" },
        input: `DOMAIN RADAR AI — SEMANTIC BUSINESS NAMING\n\nUSER BRIEF:\n${prompt}\n\nTARGET TLD: .${options.tld || "pl"}\nBATCH: ${batch}/5\nLANGUAGE MODE: ${settings.language}\nSEARCH MODE: ${settings.mode}\nLABEL LENGTH: ${settings.minLength}-${settings.maxLength}\n\nYour first job is to UNDERSTAND the business, not to imitate the letters of the sentence. Internally infer: industry, products/services, customer vocabulary, objects/tools, verbs, outcomes, emotions, slang/jargon, Polish synonyms, international roots and commercially useful metaphors.\n\nExample behavior: a gastronomy brief may lead to semantic territories such as kuchnia, smak, garnek, piec, stół, chef, gastro, menu, bite, dish — but you must invent the actual candidates yourself and keep them commercially useful. A motoring brief should similarly understand cars, drive, garage, road, motor, parts, speed, workshop, auto-related language and adjacent concepts.\n\nGenerate a MIX of:\n1. short direct category names,\n2. strong semantic associations,\n3. object/tool-based names,\n4. action/benefit names,\n5. short brandable neologisms,\n6. premium or playful names where appropriate.\n\n${exploration}\n\nPrefer short, memorable, pronounceable, easy-to-type labels. Digits and hyphens are ${settings.noDigits && settings.noHyphens ? "forbidden" : "allowed only if settings permit"}. Do not output obvious famous brands or trademarks. Do NOT guess domain availability; another subsystem verifies availability independently.${expected}${exclusions}\n\nReturn exactly ${limit} unique domain labels only, without TLD, in the structured schema.`,
        text: {
          format: {
            type: "json_schema",
            name: "semantic_domain_candidates",
            strict: true,
            schema: {
              type: "object",
              properties: {
                names: {
                  type: "array",
                  items: { type: "string" },
                  minItems: limit,
                  maxItems: limit,
                },
              },
              required: ["names"],
              additionalProperties: false,
            },
          },
        },
        max_output_tokens: 9000,
      }),
    });

    if (!response.ok) throw new Error(`semantic-ai-${response.status}`);
    const payload = (await response.json()) as OpenAIResponse;
    const text = outputText(payload);
    if (!text) throw new Error("semantic-ai-empty");
    const parsed = JSON.parse(text) as { names?: string[] };
    const seen = new Set(exclude);
    const names = Array.from(new Set((parsed.names ?? [])
      .map((value) => clean(value, settings.maxLength))
      .filter((name) => name.length >= settings.minLength && name.length <= settings.maxLength && !seen.has(name))))
      .slice(0, limit);

    if (names.length < Math.min(10, limit)) throw new Error("semantic-ai-too-few");
    return { names, provider: "openai", model, mode: "business-brief" };
  } catch {
    const result = await generateSmartNames(prompt, limit, options);
    return { ...result, mode: "business-brief" };
  }
}
